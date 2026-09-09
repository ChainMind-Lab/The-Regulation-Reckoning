//! # Regulation Reckoning — Bounty Escrow Contract
//!
//! A Soroban bounty escrow contract for The Regulation Reckoning (Stellar Testnet).
//!
//! A funder locks tokens (any Soroban token, e.g. USDC or a project demo token)
//! against a specific issue ID. Once a contributor's work is verified, the admin
//! releases the escrow to the contributor. If the bounty goes unclaimed, the
//! funder can reclaim the funds.
//!
//! Every state transition emits a meaningful on-chain event (`admin_initialised`,
//! `bounty_created`, `bounty_released`, `bounty_reclaimed`) so that off-chain
//! indexers (see `backend/src/services/indexer.ts`) can rebuild application
//! state from Stellar as the source of truth.
//!
//! ## Security model
//!
//! - `init` is one-time: the admin is set exactly once and cannot be rotated.
//! - `create` requires the funder's signature (`funder.require_auth()`).
//! - `release` requires the admin's signature.
//! - `reclaim` requires the funder's signature.
//! - Idempotency: a bounty cannot be created twice for the same issue, released
//!   twice, or released/reclaimed after settlement — replaying a transaction
//!   against the contract is rejected by the state machine.
//!
//! All state-changing methods return `Result<_, BountyError>` so that typed
//! errors are visible to indexers and clients (and testable in Rust).

#![no_std]

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, token, Address, Env,
    IntoVal, String, Symbol, Vec,
};

/// Contract-level errors. Returning typed errors (instead of opaque panics)
/// makes failure modes machine-readable for indexers and tests.
#[contracterror]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BountyError {
    /// `init` was already called; admin is immutable.
    AlreadyInitialised = 1,
    /// `init` has not been called yet.
    NotInitialised = 2,
    /// Escrow amount must be strictly positive.
    AmountMustBePositive = 3,
    /// Issue ID must not be empty.
    EmptyIssueId = 4,
    /// A bounty for this issue ID already exists (replay guard).
    BountyAlreadyExists = 5,
    /// No bounty exists for this issue ID.
    BountyNotFound = 6,
    /// The bounty is already settled (released or reclaimed).
    AlreadyReleased = 7,
}

/// On-chain state for a single bounty.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Bounty {
    pub funder: Address,
    pub contributor: Option<Address>,
    pub token: Address,
    pub amount: i128,
    pub issue_id: String,
    pub released: bool,
}

// On-chain events. Indexed off-chain by `backend/src/services/indexer.ts`.
// Each event's struct name becomes the first event topic (snake_case), and
// `#[topic]` fields become additional topics; the remaining fields become the
// event data map.

/// Contract initialised; the admin is set for the lifetime of the contract.
#[contractevent]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AdminInitialised {
    #[topic]
    pub admin: Address,
}

/// A funder locked `amount` of `token` in escrow for `issue_id`.
#[contractevent]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BountyCreated {
    #[topic]
    pub issue_id: String,
    pub funder: Address,
    pub token: Address,
    pub amount: i128,
}

/// The admin released the escrow to `contributor`.
#[contractevent]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BountyReleased {
    #[topic]
    pub issue_id: String,
    pub contributor: Address,
    pub token: Address,
    pub amount: i128,
}

/// The funder reclaimed the escrow.
#[contractevent]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BountyReclaimed {
    #[topic]
    pub issue_id: String,
    pub funder: Address,
    pub token: Address,
    pub amount: i128,
}

/// Storage key variants.
#[contracttype]
pub enum DataKey {
    Bounty(String),
    Admin,
    /// Optional on-chain contributor registry (inter-contract communication).
    Registry,
}

#[contract]
pub struct BountyContract;

#[contractimpl]
impl BountyContract {
    /// Initialise the contract with an immutable admin address and an optional
    /// contributor registry (`contracts/contributors`). When a registry is set,
    /// every successful `release` records the payout on-chain in it — the
    /// inter-contract communication layer of the product.
    ///
    /// Errors with [`BountyError::AlreadyInitialised`] if called twice.
    pub fn init(env: Env, admin: Address, registry: Option<Address>) -> Result<(), BountyError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(BountyError::AlreadyInitialised);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        if let Some(registry) = registry {
            env.storage().instance().set(&DataKey::Registry, &registry);
        }
        AdminInitialised {
            admin: admin.clone(),
        }
        .publish(&env);
        Ok(())
    }

    /// Funder creates a bounty by depositing `amount` of `token` into escrow
    /// for `issue_id`.
    ///
    /// Errors with [`BountyError::NotInitialised`], [`BountyError::AmountMustBePositive`],
    /// [`BountyError::EmptyIssueId`] or [`BountyError::BountyAlreadyExists`]
    /// (replay guard), or an auth failure if `funder` did not sign.
    pub fn create(
        env: Env,
        funder: Address,
        token: Address,
        amount: i128,
        issue_id: String,
    ) -> Result<(), BountyError> {
        if !env.storage().instance().has(&DataKey::Admin) {
            return Err(BountyError::NotInitialised);
        }
        funder.require_auth();
        if amount <= 0 {
            return Err(BountyError::AmountMustBePositive);
        }
        if issue_id.is_empty() {
            return Err(BountyError::EmptyIssueId);
        }
        if env
            .storage()
            .instance()
            .has(&DataKey::Bounty(issue_id.clone()))
        {
            return Err(BountyError::BountyAlreadyExists);
        }

        // Checks-Effects-Interactions: store the bounty BEFORE the external
        // token transfer. The token is funder-supplied and therefore untrusted;
        // settling first means a reentrant `create` with the same arguments
        // (same auth tree) hits the replay guard instead of double-depositing.
        let bounty = Bounty {
            funder: funder.clone(),
            contributor: None,
            token: token.clone(),
            amount,
            issue_id: issue_id.clone(),
            released: false,
        };
        env.storage()
            .instance()
            .set(&DataKey::Bounty(issue_id.clone()), &bounty);

        // Move tokens from the funder into this contract's escrow.
        let client = token::Client::new(&env, &token);
        let escrow = env.current_contract_address();
        client.transfer(&funder, &escrow, &amount);

        BountyCreated {
            issue_id,
            funder,
            token,
            amount,
        }
        .publish(&env);
        Ok(())
    }

    /// Admin releases the escrow to `contributor` after the work is verified.
    ///
    /// Errors with [`BountyError::NotInitialised`], [`BountyError::BountyNotFound`]
    /// or [`BountyError::AlreadyReleased`] (idempotency guard), or an auth
    /// failure if the caller is not the admin.
    pub fn release(env: Env, issue_id: String, contributor: Address) -> Result<(), BountyError> {
        let admin: Address = match env.storage().instance().get(&DataKey::Admin) {
            Some(admin) => admin,
            None => return Err(BountyError::NotInitialised),
        };
        admin.require_auth();

        let mut bounty: Bounty = match env
            .storage()
            .instance()
            .get(&DataKey::Bounty(issue_id.clone()))
        {
            Some(bounty) => bounty,
            None => return Err(BountyError::BountyNotFound),
        };

        if bounty.released {
            return Err(BountyError::AlreadyReleased);
        }

        // Checks-Effects-Interactions: settle state BEFORE the external token
        // transfer. The token address is funder-supplied (create), so it must
        // be treated as untrusted — a malicious token contract could otherwise
        // re-enter `release` with the same arguments (the admin auth tree
        // already satisfies the inner call) and double-pay while state is
        // still unsettled.
        bounty.released = true;
        bounty.contributor = Some(contributor.clone());
        env.storage()
            .instance()
            .set(&DataKey::Bounty(issue_id.clone()), &bounty);

        let token = bounty.token.clone();
        let amount = bounty.amount;
        let client = token::Client::new(&env, &token);
        let escrow = env.current_contract_address();
        client.transfer(&escrow, &contributor, &amount);

        // Inter-contract communication: record the payout in the contributor
        // registry when one is configured. If the registry call fails, the
        // entire release transaction rolls back (atomic).
        let registry: Option<Address> = env.storage().instance().get(&DataKey::Registry);
        if let Some(registry) = registry {
            let args = Vec::from_array(
                &env,
                [
                    contributor.clone().into_val(&env),
                    issue_id.clone().into_val(&env),
                    amount.into_val(&env),
                ],
            );
            let _: () = env.invoke_contract(&registry, &Symbol::new(&env, "record"), args);
        }

        BountyReleased {
            issue_id,
            contributor,
            token,
            amount,
        }
        .publish(&env);
        Ok(())
    }

    /// Funder reclaims the escrow when the bounty goes unclaimed.
    ///
    /// Errors with [`BountyError::BountyNotFound`] or
    /// [`BountyError::AlreadyReleased`] (idempotency guard), or an auth failure
    /// if the caller is not the original funder.
    pub fn reclaim(env: Env, issue_id: String) -> Result<(), BountyError> {
        let mut bounty: Bounty = match env
            .storage()
            .instance()
            .get(&DataKey::Bounty(issue_id.clone()))
        {
            Some(bounty) => bounty,
            None => return Err(BountyError::BountyNotFound),
        };

        if bounty.released {
            return Err(BountyError::AlreadyReleased);
        }
        bounty.funder.require_auth();

        // Checks-Effects-Interactions: settle state before the external token
        // transfer, for the same reason as `release` — the funder supplied the
        // token address and could re-enter `reclaim` to drain the escrow.
        bounty.released = true;
        env.storage()
            .instance()
            .set(&DataKey::Bounty(issue_id.clone()), &bounty);

        let token = bounty.token.clone();
        let amount = bounty.amount;
        let funder = bounty.funder.clone();
        let client = token::Client::new(&env, &token);
        let escrow = env.current_contract_address();
        client.transfer(&escrow, &funder, &amount);

        BountyReclaimed {
            issue_id,
            funder,
            token,
            amount,
        }
        .publish(&env);
        Ok(())
    }

    /// Read a bounty by issue ID.
    ///
    /// Errors with [`BountyError::BountyNotFound`] if it does not exist.
    pub fn get_bounty(env: Env, issue_id: String) -> Result<Bounty, BountyError> {
        match env.storage().instance().get(&DataKey::Bounty(issue_id)) {
            Some(bounty) => Ok(bounty),
            None => Err(BountyError::BountyNotFound),
        }
    }

    /// True once `init` has been called.
    pub fn is_initialised(env: Env) -> bool {
        env.storage().instance().has(&DataKey::Admin)
    }
}

#[cfg(test)]
mod tests {
    extern crate alloc;

    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, Events as _, MockAuth, MockAuthInvoke},
        token::{Client as TokenClient, StellarAssetClient},
        xdr, Address, Env, IntoVal, Map, Symbol, TryFromVal, Val, Vec,
    };

    /// Environment + addresses + deployed contract for one test.
    struct Harness {
        env: Env,
        contract_id: Address,
        funder: Address,
        contributor: Address,
        token_id: Address,
        issue: String,
    }

    fn issue(env: &Env, s: &str) -> String {
        String::from_str(env, s)
    }

    /// Build a fully deployed + initialised harness with `mock_all_auths`.
    fn harness() -> Harness {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let funder = Address::generate(&env);
        let contributor = Address::generate(&env);
        let contract_id = env.register(BountyContract, ());
        let token_id = env
            .register_stellar_asset_contract_v2(admin.clone())
            .address();
        let token_admin = StellarAssetClient::new(&env, &token_id);
        token_admin.mint(&funder, &1_000_000);

        let client = BountyContractClient::new(&env, &contract_id);
        client.init(&admin, &None);

        let issue = String::from_str(&env, "issue-42");
        Harness {
            env,
            contract_id,
            funder,
            contributor,
            token_id,
            issue,
        }
    }

    fn client<'a>(env: &'a Env, contract_id: &'a Address) -> BountyContractClient<'a> {
        BountyContractClient::new(env, contract_id)
    }

    fn token<'a>(env: &'a Env, token_id: &'a Address) -> TokenClient<'a> {
        TokenClient::new(env, token_id)
    }

    /// A function invocation to authorize: `contract.fn_name(args)` with the
    /// given sub-invocations.
    fn invoke<'a>(
        contract: &'a Address,
        fn_name: &'a str,
        args: Vec<Val>,
        sub_invokes: &'a [MockAuthInvoke<'a>],
    ) -> MockAuthInvoke<'a> {
        MockAuthInvoke {
            contract,
            fn_name,
            args,
            sub_invokes,
        }
    }

    /// Granular mock auth: `signer` authorizes `inv`. Pass to `env.mock_auths`.
    fn contract_auth<'a>(signer: &'a Address, inv: &'a MockAuthInvoke<'a>) -> MockAuth<'a> {
        MockAuth {
            address: signer,
            invoke: inv,
        }
    }

    /// Invocation for the SAC `mint(to, amount)` call (signed by the token admin).
    fn mint_invoke<'a>(
        token_id: &'a Address,
        to: &'a Address,
        amount: i128,
        env: &Env,
    ) -> MockAuthInvoke<'a> {
        invoke(
            token_id,
            "mint",
            Vec::from_array(env, [to.clone().into_val(env), amount.into_val(env)]),
            &[],
        )
    }

    type EventSummary = (Symbol, Option<String>, Option<Map<Symbol, Val>>);

    /// Summarize emitted events as `(event_name, optional issue_id, optional
    /// data map)` so tests can assert on names, topics, ordering and payloads.
    /// NOTE: the test env's event view reflects the most recent invocation, so
    /// call this immediately after the emitting call.
    fn event_summaries(env: &Env, contract_id: &Address) -> alloc::vec::Vec<EventSummary> {
        env.events()
            .all()
            .filter_by_contract(contract_id)
            .events()
            .iter()
            .map(|e| {
                let xdr::ContractEventBody::V0(v0) = &e.body;
                let name =
                    Symbol::try_from_val(env, &Val::try_from_val(env, &v0.topics[0]).unwrap())
                        .unwrap();
                // Topic 1 is the issue id for bounty events (absent for
                // `admin_initialised`, whose topic 1 is an address).
                let issue = if v0.topics.len() > 1 {
                    Val::try_from_val(env, &v0.topics[1])
                        .ok()
                        .and_then(|v| String::try_from_val(env, &v).ok())
                } else {
                    None
                };
                let data = Val::try_from_val(env, &v0.data)
                    .ok()
                    .and_then(|v| Map::<Symbol, Val>::try_from_val(env, &v).ok());
                (name, issue, data)
            })
            .collect()
    }

    fn data_i128(data: &Option<Map<Symbol, Val>>, key: &str, env: &Env) -> i128 {
        i128::try_from_val(
            env,
            &data.as_ref().unwrap().get(Symbol::new(env, key)).unwrap(),
        )
        .unwrap()
    }

    // ── Happy paths ────────────────────────────────────────────────

    #[test]
    fn test_init_sets_admin_and_emits_event() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let contract_id = env.register(BountyContract, ());
        let client = BountyContractClient::new(&env, &contract_id);
        client.init(&admin, &None);

        let events = event_summaries(&env, &contract_id);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].0, Symbol::new(&env, "admin_initialised"));
        assert_eq!(events[0].1, None);

        assert!(client.is_initialised());
    }

    #[test]
    fn test_create_release_flow_with_balances_and_events() {
        let h = harness();
        let env = &h.env;
        let client = client(env, &h.contract_id);

        client.create(&h.funder, &h.token_id, &500, &h.issue);

        let created = event_summaries(env, &h.contract_id);
        assert_eq!(created.len(), 1);
        assert_eq!(created[0].0, Symbol::new(env, "bounty_created"));
        assert_eq!(created[0].1, Some(issue(env, "issue-42")));
        assert_eq!(data_i128(&created[0].2, "amount", env), 500);

        // Escrow holds the funds.
        assert_eq!(token(env, &h.token_id).balance(&h.contract_id), 500);
        let bounty = client.get_bounty(&h.issue);
        assert_eq!(bounty.amount, 500);
        assert_eq!(bounty.funder, h.funder);
        assert!(!bounty.released);

        client.release(&h.issue, &h.contributor);

        // The test env's event view reflects the most recent invocation.
        let released = event_summaries(env, &h.contract_id);
        assert_eq!(released.len(), 1);
        assert_eq!(released[0].0, Symbol::new(env, "bounty_released"));
        assert_eq!(released[0].1, Some(issue(env, "issue-42")));
        assert_eq!(data_i128(&released[0].2, "amount", env), 500);

        let bounty = client.get_bounty(&h.issue);
        assert!(bounty.released);
        assert_eq!(bounty.contributor, Some(h.contributor.clone()));
        assert_eq!(token(env, &h.token_id).balance(&h.contributor), 500);
        assert_eq!(token(env, &h.token_id).balance(&h.contract_id), 0);
    }

    #[test]
    fn test_reclaim_returns_funds_to_funder() {
        let h = harness();
        let env = &h.env;
        let client = client(env, &h.contract_id);

        client.create(&h.funder, &h.token_id, &250, &h.issue);
        client.reclaim(&h.issue);

        let events = event_summaries(env, &h.contract_id);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].0, Symbol::new(env, "bounty_reclaimed"));
        assert_eq!(events[0].1, Some(issue(env, "issue-42")));
        assert_eq!(data_i128(&events[0].2, "amount", env), 250);

        let bounty = client.get_bounty(&h.issue);
        assert!(bounty.released);
        // Funds returned to the funder (250 back + 999_750 remaining).
        assert_eq!(token(env, &h.token_id).balance(&h.funder), 1_000_000);
        assert_eq!(token(env, &h.token_id).balance(&h.contract_id), 0);
    }

    // ── Invalid inputs ─────────────────────────────────────────────

    #[test]
    fn test_cannot_init_twice() {
        let h = harness();
        let client = client(&h.env, &h.contract_id);
        let another_admin = Address::generate(&h.env);
        let res = client.try_init(&another_admin, &None);
        assert_eq!(res, Err(Ok(BountyError::AlreadyInitialised)));
    }

    #[test]
    fn test_cannot_create_before_init() {
        let env = Env::default();
        env.mock_all_auths();
        let funder = Address::generate(&env);
        let admin = Address::generate(&env);
        let contract_id = env.register(BountyContract, ());
        let token_id = env
            .register_stellar_asset_contract_v2(admin.clone())
            .address();
        let client = BountyContractClient::new(&env, &contract_id);

        let res = client.try_create(&funder, &token_id, &100, &issue(&env, "x"));
        assert_eq!(res, Err(Ok(BountyError::NotInitialised)));
    }

    #[test]
    fn test_cannot_create_zero_or_negative_amount() {
        let h = harness();
        let client = client(&h.env, &h.contract_id);

        let zero = client.try_create(&h.funder, &h.token_id, &0, &h.issue);
        assert_eq!(zero, Err(Ok(BountyError::AmountMustBePositive)));

        let negative = client.try_create(&h.funder, &h.token_id, &-5, &h.issue);
        assert_eq!(negative, Err(Ok(BountyError::AmountMustBePositive)));
    }

    #[test]
    fn test_cannot_create_empty_issue_id() {
        let h = harness();
        let client = client(&h.env, &h.contract_id);
        let res = client.try_create(&h.funder, &h.token_id, &100, &issue(&h.env, ""));
        assert_eq!(res, Err(Ok(BountyError::EmptyIssueId)));
    }

    #[test]
    fn test_cannot_create_duplicate_bounty_replay_guard() {
        let h = harness();
        let client = client(&h.env, &h.contract_id);
        client.create(&h.funder, &h.token_id, &100, &h.issue);

        // Replaying the same creation must be rejected — idempotency guard.
        let replay = client.try_create(&h.funder, &h.token_id, &100, &h.issue);
        assert_eq!(replay, Err(Ok(BountyError::BountyAlreadyExists)));

        // A different funder cannot squat the same issue either.
        let squatter = client.try_create(&h.contributor, &h.token_id, &50, &h.issue);
        assert_eq!(squatter, Err(Ok(BountyError::BountyAlreadyExists)));

        // Escrow still holds only the original amount.
        assert_eq!(token(&h.env, &h.token_id).balance(&h.contract_id), 100);
    }

    #[test]
    fn test_cannot_release_missing_bounty() {
        let h = harness();
        let client = client(&h.env, &h.contract_id);
        let res = client.try_release(&issue(&h.env, "nope"), &h.contributor);
        assert_eq!(res, Err(Ok(BountyError::BountyNotFound)));
    }

    #[test]
    fn test_cannot_get_missing_bounty() {
        let h = harness();
        let client = client(&h.env, &h.contract_id);
        let res = client.try_get_bounty(&issue(&h.env, "nope"));
        assert_eq!(res, Err(Ok(BountyError::BountyNotFound)));
    }

    #[test]
    fn test_cannot_reclaim_missing_bounty() {
        let h = harness();
        let client = client(&h.env, &h.contract_id);
        let res = client.try_reclaim(&issue(&h.env, "nope"));
        assert_eq!(res, Err(Ok(BountyError::BountyNotFound)));
    }

    // ── Idempotency / replay ───────────────────────────────────────

    #[test]
    fn test_cannot_release_twice() {
        let h = harness();
        let client = client(&h.env, &h.contract_id);
        client.create(&h.funder, &h.token_id, &500, &h.issue);
        client.release(&h.issue, &h.contributor);

        let replay = client.try_release(&h.issue, &h.contributor);
        assert_eq!(replay, Err(Ok(BountyError::AlreadyReleased)));

        // Contributor was paid exactly once.
        assert_eq!(token(&h.env, &h.token_id).balance(&h.contributor), 500);
    }

    #[test]
    fn test_cannot_reclaim_after_release() {
        let h = harness();
        let client = client(&h.env, &h.contract_id);
        client.create(&h.funder, &h.token_id, &500, &h.issue);
        client.release(&h.issue, &h.contributor);

        let res = client.try_reclaim(&h.issue);
        assert_eq!(res, Err(Ok(BountyError::AlreadyReleased)));
    }

    #[test]
    fn test_cannot_release_after_reclaim() {
        let h = harness();
        let client = client(&h.env, &h.contract_id);
        client.create(&h.funder, &h.token_id, &500, &h.issue);
        client.reclaim(&h.issue);

        let res = client.try_release(&h.issue, &h.contributor);
        assert_eq!(res, Err(Ok(BountyError::AlreadyReleased)));
    }

    // ── Authorization ──────────────────────────────────────────────
    //
    // These tests run WITHOUT mock_all_auths and use `env.mock_auths` to
    // authorize exactly the intended signer for each invocation, so wrong-caller
    // and missing-signature calls are genuinely rejected. The real signature
    // flow is exercised on Testnet by `scripts/demo-flow.mjs` and the e2e suite.

    /// init + create with explicit, per-signer mock auths (no mock_all_auths).
    /// Returns `(env, contract_id, admin, funder, token_id, issue_id)`.
    fn setup_with_explicit_auths() -> (Env, Address, Address, Address, Address, String) {
        let env = Env::default();
        let admin = Address::generate(&env);
        let funder = Address::generate(&env);
        let contract_id = env.register(BountyContract, ());
        let token_id = env
            .register_stellar_asset_contract_v2(admin.clone())
            .address();
        let issue_id = issue(&env, "i1");

        // Mint 1000 to the funder (signed by the token admin).
        let mint_inv = mint_invoke(&token_id, &funder, 1000, &env);
        env.mock_auths(&[contract_auth(&admin, &mint_inv)]);
        let token_admin = StellarAssetClient::new(&env, &token_id);
        token_admin.mint(&funder, &1000);

        let client = BountyContractClient::new(&env, &contract_id);

        // init — signed by admin, no registry.
        let init_inv = invoke(
            &contract_id,
            "init",
            Vec::from_array(
                &env,
                [
                    admin.clone().into_val(&env),
                    Option::<Address>::None.into_val(&env),
                ],
            ),
            &[],
        );
        env.mock_auths(&[contract_auth(&admin, &init_inv)]);
        client.init(&admin, &None);

        // create — signed by funder, with the token transfer as sub-invocation.
        let transfer = invoke(
            &token_id,
            "transfer",
            Vec::from_array(
                &env,
                [
                    funder.clone().into_val(&env),
                    contract_id.clone().into_val(&env),
                    100_i128.into_val(&env),
                ],
            ),
            &[],
        );
        let create_inv = invoke(
            &contract_id,
            "create",
            Vec::from_array(
                &env,
                [
                    funder.clone().into_val(&env),
                    token_id.clone().into_val(&env),
                    100_i128.into_val(&env),
                    issue_id.clone().into_val(&env),
                ],
            ),
            core::slice::from_ref(&transfer),
        );
        env.mock_auths(&[contract_auth(&funder, &create_inv)]);
        client.create(&funder, &token_id, &100, &issue_id);

        (env, contract_id, admin, funder, token_id, issue_id)
    }

    #[test]
    fn test_init_requires_admin_auth() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let contract_id = env.register(BountyContract, ());
        let client = BountyContractClient::new(&env, &contract_id);

        let init_args = Vec::from_array(
            &env,
            [
                admin.clone().into_val(&env),
                Option::<Address>::None.into_val(&env),
            ],
        );
        let init_inv = invoke(&contract_id, "init", init_args, &[]);

        // No auths at all → rejected.
        let res = client.try_init(&admin, &None);
        assert!(res.is_err());

        // Authorize a non-admin signer → rejected.
        let imposter = Address::generate(&env);
        env.mock_auths(&[contract_auth(&imposter, &init_inv)]);
        let res = client.try_init(&admin, &None);
        assert!(res.is_err());

        // Authorize the admin's invocation → accepted.
        env.mock_auths(&[contract_auth(&admin, &init_inv)]);
        client.init(&admin, &None);
        assert!(client.is_initialised());
    }

    #[test]
    fn test_create_requires_funder_auth() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let funder = Address::generate(&env);
        let contract_id = env.register(BountyContract, ());
        let token_id = env
            .register_stellar_asset_contract_v2(admin.clone())
            .address();
        let issue_id = issue(&env, "i1");

        let mint_inv = mint_invoke(&token_id, &funder, 1000, &env);
        env.mock_auths(&[contract_auth(&admin, &mint_inv)]);
        let token_admin = StellarAssetClient::new(&env, &token_id);
        token_admin.mint(&funder, &1000);

        let client = BountyContractClient::new(&env, &contract_id);

        let init_inv = invoke(
            &contract_id,
            "init",
            Vec::from_array(
                &env,
                [
                    admin.clone().into_val(&env),
                    Option::<Address>::None.into_val(&env),
                ],
            ),
            &[],
        );
        env.mock_auths(&[contract_auth(&admin, &init_inv)]);
        client.init(&admin, &None);

        // Unauthorized create → rejected.
        let res = client.try_create(&funder, &token_id, &100, &issue_id);
        assert!(res.is_err());

        // Create signed by a non-funder → rejected.
        let imposter = Address::generate(&env);
        let wrong_transfer = invoke(
            &token_id,
            "transfer",
            Vec::from_array(
                &env,
                [
                    imposter.clone().into_val(&env),
                    contract_id.clone().into_val(&env),
                    100_i128.into_val(&env),
                ],
            ),
            &[],
        );
        let wrong_create = invoke(
            &contract_id,
            "create",
            Vec::from_array(
                &env,
                [
                    funder.clone().into_val(&env),
                    token_id.clone().into_val(&env),
                    100_i128.into_val(&env),
                    issue_id.clone().into_val(&env),
                ],
            ),
            core::slice::from_ref(&wrong_transfer),
        );
        env.mock_auths(&[contract_auth(&imposter, &wrong_create)]);
        let res = client.try_create(&funder, &token_id, &100, &issue_id);
        assert!(res.is_err());

        // Create signed by the funder → accepted.
        let transfer = invoke(
            &token_id,
            "transfer",
            Vec::from_array(
                &env,
                [
                    funder.clone().into_val(&env),
                    contract_id.clone().into_val(&env),
                    100_i128.into_val(&env),
                ],
            ),
            &[],
        );
        let create_inv = invoke(
            &contract_id,
            "create",
            Vec::from_array(
                &env,
                [
                    funder.clone().into_val(&env),
                    token_id.clone().into_val(&env),
                    100_i128.into_val(&env),
                    issue_id.clone().into_val(&env),
                ],
            ),
            core::slice::from_ref(&transfer),
        );
        env.mock_auths(&[contract_auth(&funder, &create_inv)]);
        client.create(&funder, &token_id, &100, &issue_id);
        assert_eq!(client.get_bounty(&issue_id).amount, 100);
    }

    #[test]
    fn test_release_requires_admin_auth_and_rejects_non_admin() {
        let (env, contract_id, admin, _funder, token_id, issue_id) = setup_with_explicit_auths();
        let client = BountyContractClient::new(&env, &contract_id);
        let contributor = Address::generate(&env);
        let release_args = Vec::from_array(
            &env,
            [
                issue_id.clone().into_val(&env),
                contributor.clone().into_val(&env),
            ],
        );

        // No auths → rejected.
        let res = client.try_release(&issue_id, &contributor);
        assert!(res.is_err());

        // Authorized by the funder (not the admin) → rejected.
        let transfer = invoke(
            &token_id,
            "transfer",
            Vec::from_array(
                &env,
                [
                    contract_id.clone().into_val(&env),
                    contributor.clone().into_val(&env),
                    100_i128.into_val(&env),
                ],
            ),
            &[],
        );
        let wrong_release = invoke(
            &contract_id,
            "release",
            release_args.clone(),
            core::slice::from_ref(&transfer),
        );
        env.mock_auths(&[contract_auth(&_funder, &wrong_release)]);
        let res = client.try_release(&issue_id, &contributor);
        assert!(res.is_err());

        // Funds still in escrow, state untouched.
        assert_eq!(token(&env, &token_id).balance(&contract_id), 100);
        assert!(!client.get_bounty(&issue_id).released);

        // Authorized by the admin → accepted.
        let release_inv = invoke(&contract_id, "release", release_args, &[]);
        env.mock_auths(&[contract_auth(&admin, &release_inv)]);
        client.release(&issue_id, &contributor);
        assert!(client.get_bounty(&issue_id).released);
        assert_eq!(token(&env, &token_id).balance(&contributor), 100);
    }

    #[test]
    fn test_reclaim_requires_funder_auth_and_rejects_admin() {
        let (env, contract_id, admin, funder, token_id, issue_id) = setup_with_explicit_auths();
        let client = BountyContractClient::new(&env, &contract_id);

        // No auths → rejected.
        let res = client.try_reclaim(&issue_id);
        assert!(res.is_err());

        // Authorized by the admin (not the funder) → rejected.
        let reclaim_inv = invoke(
            &contract_id,
            "reclaim",
            Vec::from_array(&env, [issue_id.clone().into_val(&env)]),
            &[],
        );
        env.mock_auths(&[contract_auth(&admin, &reclaim_inv)]);
        let res = client.try_reclaim(&issue_id);
        assert!(res.is_err());
        assert_eq!(token(&env, &token_id).balance(&contract_id), 100);

        // Authorized by the funder → accepted.
        env.mock_auths(&[contract_auth(&funder, &reclaim_inv)]);
        client.reclaim(&issue_id);
        assert!(client.get_bounty(&issue_id).released);
        // Funds returned to the funder (100 back + 900 remaining = 1000).
        assert_eq!(token(&env, &token_id).balance(&funder), 1000);
        assert_eq!(token(&env, &token_id).balance(&contract_id), 0);
    }

    // ── Inter-contract communication (contributor registry) ────────
    //
    // A minimal registry with the same `record`/`stats` interface as
    // `contracts/contributors`, registered in-test so the bounty contract's
    // cross-contract call can be exercised without shipping the registry wasm.

    #[contract]
    struct TestRegistry;

    #[contractimpl]
    impl TestRegistry {
        pub fn init(env: Env, admin: Address, allowed_caller: Address) {
            admin.require_auth();
            env.storage()
                .instance()
                .set(&Symbol::new(&env, "admin"), &admin);
            env.storage()
                .instance()
                .set(&Symbol::new(&env, "allowed"), &allowed_caller);
        }

        pub fn record(env: Env, contributor: Address, issue_id: String, amount: i128) {
            let allowed: Address = env
                .storage()
                .instance()
                .get(&Symbol::new(&env, "allowed"))
                .unwrap();
            // Same cross-contract auth as the real registry: only the configured
            // caller (the bounty contract) can satisfy this.
            allowed.require_auth();
            let mut stats: Map<Address, (u32, i128)> = env
                .storage()
                .instance()
                .get(&Symbol::new(&env, "stats"))
                .unwrap_or_else(|| Map::new(&env));
            let entry = stats.get(contributor.clone()).unwrap_or((0, 0));
            stats.set(contributor, (entry.0 + 1, entry.1 + amount));
            env.storage()
                .instance()
                .set(&Symbol::new(&env, "stats"), &stats);
            env.storage()
                .instance()
                .set(&Symbol::new(&env, "last_issue"), &issue_id);
        }

        pub fn stats(env: Env, contributor: Address) -> (u32, i128) {
            let stats: Map<Address, (u32, i128)> = env
                .storage()
                .instance()
                .get(&Symbol::new(&env, "stats"))
                .unwrap_or_else(|| Map::new(&env));
            stats.get(contributor).unwrap_or((0, 0))
        }
    }

    fn harness_with_registry() -> (Harness, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let funder = Address::generate(&env);
        let contributor = Address::generate(&env);
        let contract_id = env.register(BountyContract, ());
        let token_id = env
            .register_stellar_asset_contract_v2(admin.clone())
            .address();
        let token_admin = StellarAssetClient::new(&env, &token_id);
        token_admin.mint(&funder, &1_000_000);

        let registry_id = env.register(TestRegistry, ());
        let registry_client = TestRegistryClient::new(&env, &registry_id);
        registry_client.init(&admin, &contract_id);

        let client = BountyContractClient::new(&env, &contract_id);
        client.init(&admin, &Some(registry_id.clone()));

        let issue = String::from_str(&env, "issue-42");
        (
            Harness {
                env,
                contract_id,
                funder,
                contributor,
                token_id,
                issue,
            },
            registry_id,
        )
    }

    #[test]
    fn test_release_records_contributor_in_registry() {
        let (h, registry_id) = harness_with_registry();
        let env = &h.env;
        let client = client(env, &h.contract_id);
        let registry_client = TestRegistryClient::new(env, &registry_id);
        let other = Address::generate(env);

        assert_eq!(registry_client.stats(&h.contributor), (0, 0));
        assert_eq!(registry_client.stats(&other), (0, 0));

        client.create(&h.funder, &h.token_id, &250, &h.issue);
        client.release(&h.issue, &h.contributor);

        // The bounty contract's release recorded the payout in the registry,
        // keyed per contributor.
        assert_eq!(registry_client.stats(&h.contributor), (1, 250));
        // Other addresses were not recorded.
        assert_eq!(registry_client.stats(&other), (0, 0));

        // Bounty state is settled and funds moved as before.
        let bounty = client.get_bounty(&h.issue);
        assert!(bounty.released);
        assert_eq!(token(env, &h.token_id).balance(&h.contributor), 250);
        assert_eq!(token(env, &h.token_id).balance(&h.contract_id), 0);
    }

    #[test]
    fn test_release_without_registry_still_works() {
        let h = harness();
        let env = &h.env;
        let client = client(env, &h.contract_id);

        client.create(&h.funder, &h.token_id, &250, &h.issue);
        client.release(&h.issue, &h.contributor);

        // No registry configured → release succeeds without a record call.
        let bounty = client.get_bounty(&h.issue);
        assert!(bounty.released);
        assert_eq!(token(env, &h.token_id).balance(&h.contributor), 250);
    }

    #[test]
    fn test_insufficient_balance_fails_create() {
        let h = harness();
        let client = client(&h.env, &h.contract_id);
        // Funder was minted 1_000_000; a much larger amount must fail at the
        // token transfer (transaction failure path).
        let res = client.try_create(&h.funder, &h.token_id, &i128::MAX, &h.issue);
        assert!(res.is_err());
        assert!(!client
            .try_get_bounty(&h.issue)
            .map(|b| b.is_ok())
            .unwrap_or(false));
    }
}
