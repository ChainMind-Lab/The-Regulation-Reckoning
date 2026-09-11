//! # Regulation Reckoning — Contributor & Reviewer Reputation Registry
//!
//! A verifiable on-chain reputation registry. The bounty escrow contract
//! (`contracts/bounty`) writes to it through `env.invoke_contract` whenever a
//! milestone is paid, a review is upheld, or a dispute is resolved. Because the
//! registry accepts writes **only** from the configured `allowed_caller`, no
//! account can inflate its own reputation directly — reputation is a function of
//! confirmed protocol activity, not of self-reported data.
//!
//! ## Recorded signals
//!
//! | Signal | Written when |
//! |---|---|
//! | `payouts` / `payout_total` | a milestone escrow is released to the contributor |
//! | `reviews_upheld` | a reviewer's approval is confirmed by the milestone release |
//! | `disputes_opened` / `disputes_lost` | a participant opens a dispute / loses it |
//!
//! ## Anti-manipulation
//!
//! 1. **Caller gate.** Every mutating entry point calls
//!    `allowed_caller.require_auth()`; a user's own signature can never satisfy
//!    it, so only the bounty contract can write.
//! 2. **Replay gate.** Each write is keyed by `(subject, issue_id, milestone)`
//!    in persistent storage. Re-submitting the same event is rejected with
//!    [`RegistryError::AlreadyRecorded`], so a bug or a replayed transaction
//!    cannot double-count.
//! 3. **No self-serve reputation.** Counters are never settable directly; there
//!    is no `set_reputation`-style entry point.
//!
//! ## Storage & lifecycle
//!
//! Aggregates live in **persistent** storage (not instance storage) and their
//! TTL is extended on every write, so reputation survives as long as it is
//! being used and does not expire with the contract instance.

#![no_std]

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, Address, Env, String,
};

/// Registry-level errors.
#[contracterror]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RegistryError {
    /// `init` was already called.
    AlreadyInitialised = 1,
    /// `init` has not been called yet.
    NotInitialised = 2,
    /// The caller is not the configured bounty contract.
    UnauthorizedCaller = 3,
    /// Payout amount must be strictly positive.
    AmountMustBePositive = 4,
    /// Issue ID (reference) must not be empty.
    EmptyIssueId = 5,
    /// This exact `(subject, issue_id, milestone)` event was already recorded.
    AlreadyRecorded = 6,
    /// Only the admin may rotate the allowed caller.
    NotAdmin = 7,
}

/// Days expressed in ledgers (5s close time → 17_280 ledgers/day).
const DAY_IN_LEDGERS: u32 = 17_280;
/// Extend persistent entries once they fall below ~30 days of TTL.
const PERSISTENT_TTL_THRESHOLD: u32 = 30 * DAY_IN_LEDGERS;
/// Extend them to ~180 days on every write.
const PERSISTENT_TTL_EXTEND: u32 = 180 * DAY_IN_LEDGERS;

/// Aggregated payout stats for one contributor (backward-compatible shape).
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ContributorStats {
    /// Number of milestone payouts received.
    pub count: u32,
    /// Total amount earned (token units of the bounty escrow token).
    pub total: i128,
}

/// Full verifiable reputation record for an address (contributor and/or reviewer).
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Reputation {
    /// Milestone payouts credited to this address.
    pub payouts: u32,
    /// Total value of those payouts.
    pub payout_total: i128,
    /// Reviews by this address that were confirmed by a milestone release.
    pub reviews_upheld: u32,
    /// Disputes this address opened.
    pub disputes_opened: u32,
    /// Disputes this address opened and lost.
    pub disputes_lost: u32,
}

/// A milestone payout was recorded. Emitted by `record`.
#[contractevent]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ContributorRecorded {
    #[topic]
    pub contributor: Address,
    pub issue_id: String,
    pub milestone: u32,
    pub amount: i128,
    pub total: i128,
}

/// An upheld review was recorded. Emitted by `record_review`.
#[contractevent]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ReviewRecorded {
    #[topic]
    pub reviewer: Address,
    pub issue_id: String,
    pub milestone: u32,
    pub upheld: u32,
}

/// A dispute participation was recorded. Emitted by `record_dispute`.
#[contractevent]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DisputeRecorded {
    #[topic]
    pub participant: Address,
    pub issue_id: String,
    pub milestone: u32,
    pub lost: bool,
}

/// Storage keys.
#[contracttype]
pub enum DataKey {
    /// Bootstrap admin (may rotate the allowed caller). Instance storage.
    Admin,
    /// The only contract permitted to write reputation. Instance storage.
    AllowedCaller,
    /// Number of distinct addresses with a payout. Instance storage.
    TotalContributors,
    /// Aggregated payout stats. Persistent.
    Stats(Address),
    /// Full reputation record. Persistent.
    Rep(Address),
    /// Replay guard for a payout — `(contributor, issue_id, milestone)`. Persistent.
    Credited(Address, String, u32),
    /// Replay guard for an upheld review. Persistent.
    ReviewCredited(Address, String, u32),
    /// Replay guard for a dispute participation. Persistent.
    DisputeCredited(Address, String, u32),
}

/// Bump a persistent entry's TTL so reputation does not silently expire.
fn bump<K: soroban_sdk::IntoVal<Env, soroban_sdk::Val>>(env: &Env, key: &K) {
    env.storage()
        .persistent()
        .extend_ttl(key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_EXTEND);
}

/// Deterministic, documented reputation score derived from the raw counters.
///
/// ```text
/// score = clamp(12*payouts + 10*reviews_upheld - 15*disputes_lost, 0, 1000)
/// ```
///
/// It is a pure function of on-chain counters, so it is reproducible by anyone
/// reading the ledger; consumers that prefer a different policy can read
/// [`ContributorsContract::reputation`] and compute their own.
pub fn score_of(rep: &Reputation) -> u32 {
    let raw = 12i64 * i64::from(rep.payouts) + 10i64 * i64::from(rep.reviews_upheld)
        - 15i64 * i64::from(rep.disputes_lost);
    if raw <= 0 {
        0
    } else if raw >= 1000 {
        1000
    } else {
        raw as u32
    }
}

#[contract]
pub struct ContributorsContract;

#[contractimpl]
impl ContributorsContract {
    /// One-time initialisation. `allowed_caller` is the bounty contract that is
    /// permitted to record reputation; `admin` may later rotate it.
    pub fn init(env: Env, admin: Address, allowed_caller: Address) -> Result<(), RegistryError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(RegistryError::AlreadyInitialised);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::AllowedCaller, &allowed_caller);
        env.storage()
            .instance()
            .set(&DataKey::TotalContributors, &0_u32);
        Ok(())
    }

    /// Rotate the contract allowed to write reputation (admin-only). Needed when
    /// a new bounty contract version is deployed.
    pub fn set_allowed_caller(
        env: Env,
        admin: Address,
        allowed_caller: Address,
    ) -> Result<(), RegistryError> {
        let stored: Address = match env.storage().instance().get(&DataKey::Admin) {
            Some(a) => a,
            None => return Err(RegistryError::NotInitialised),
        };
        admin.require_auth();
        if admin != stored {
            return Err(RegistryError::NotAdmin);
        }
        env.storage()
            .instance()
            .set(&DataKey::AllowedCaller, &allowed_caller);
        Ok(())
    }

    /// Record a milestone payout credited to `contributor`.
    ///
    /// Only the allowed bounty contract can satisfy the auth check. The
    /// `(contributor, issue_id, milestone)` triple is stored as a replay guard:
    /// recording the same milestone twice returns [`RegistryError::AlreadyRecorded`].
    pub fn record(
        env: Env,
        contributor: Address,
        issue_id: String,
        milestone: u32,
        amount: i128,
    ) -> Result<(), RegistryError> {
        Self::require_allowed_caller(&env)?;
        if amount <= 0 {
            return Err(RegistryError::AmountMustBePositive);
        }
        if issue_id.is_empty() {
            return Err(RegistryError::EmptyIssueId);
        }
        let guard = DataKey::Credited(contributor.clone(), issue_id.clone(), milestone);
        if env.storage().persistent().has(&guard) {
            return Err(RegistryError::AlreadyRecorded);
        }
        env.storage().persistent().set(&guard, &true);
        bump(&env, &guard);

        // Payout stats (backward-compatible shape).
        let mut stats = env
            .storage()
            .persistent()
            .get(&DataKey::Stats(contributor.clone()))
            .unwrap_or(ContributorStats { count: 0, total: 0 });
        if stats.count == 0 {
            let total: u32 = env
                .storage()
                .instance()
                .get(&DataKey::TotalContributors)
                .unwrap_or(0);
            env.storage()
                .instance()
                .set(&DataKey::TotalContributors, &total.saturating_add(1));
        }
        stats.count = stats.count.saturating_add(1);
        stats.total = stats.total.saturating_add(amount);
        env.storage()
            .persistent()
            .set(&DataKey::Stats(contributor.clone()), &stats);
        bump(&env, &DataKey::Stats(contributor.clone()));

        // Full reputation record.
        let mut rep = Self::load_rep(&env, &contributor);
        rep.payouts = rep.payouts.saturating_add(1);
        rep.payout_total = rep.payout_total.saturating_add(amount);
        env.storage()
            .persistent()
            .set(&DataKey::Rep(contributor.clone()), &rep);
        bump(&env, &DataKey::Rep(contributor.clone()));

        ContributorRecorded {
            contributor,
            issue_id,
            milestone,
            amount,
            total: stats.total,
        }
        .publish(&env);
        Ok(())
    }

    /// Record an **upheld** review: a reviewer whose approval was confirmed by a
    /// milestone release. Rejected reviews and reviews on unreleased milestones
    /// are never recorded, so reviewers cannot farm reputation.
    pub fn record_review(
        env: Env,
        reviewer: Address,
        issue_id: String,
        milestone: u32,
        upheld: bool,
    ) -> Result<(), RegistryError> {
        Self::require_allowed_caller(&env)?;
        if issue_id.is_empty() {
            return Err(RegistryError::EmptyIssueId);
        }
        if !upheld {
            // Only upheld reviews affect reputation; nothing to write.
            return Ok(());
        }
        let guard = DataKey::ReviewCredited(reviewer.clone(), issue_id.clone(), milestone);
        if env.storage().persistent().has(&guard) {
            return Err(RegistryError::AlreadyRecorded);
        }
        env.storage().persistent().set(&guard, &true);
        bump(&env, &guard);

        let mut rep = Self::load_rep(&env, &reviewer);
        rep.reviews_upheld = rep.reviews_upheld.saturating_add(1);
        env.storage()
            .persistent()
            .set(&DataKey::Rep(reviewer.clone()), &rep);
        bump(&env, &DataKey::Rep(reviewer.clone()));

        ReviewRecorded {
            reviewer,
            issue_id,
            milestone,
            upheld: rep.reviews_upheld,
        }
        .publish(&env);
        Ok(())
    }

    /// Record participation in a resolved dispute. `lost` marks the participant
    /// whose position the reviewers rejected.
    pub fn record_dispute(
        env: Env,
        participant: Address,
        issue_id: String,
        milestone: u32,
        lost: bool,
    ) -> Result<(), RegistryError> {
        Self::require_allowed_caller(&env)?;
        if issue_id.is_empty() {
            return Err(RegistryError::EmptyIssueId);
        }
        let guard = DataKey::DisputeCredited(participant.clone(), issue_id.clone(), milestone);
        if env.storage().persistent().has(&guard) {
            return Err(RegistryError::AlreadyRecorded);
        }
        env.storage().persistent().set(&guard, &true);
        bump(&env, &guard);

        let mut rep = Self::load_rep(&env, &participant);
        rep.disputes_opened = rep.disputes_opened.saturating_add(1);
        if lost {
            rep.disputes_lost = rep.disputes_lost.saturating_add(1);
        }
        env.storage()
            .persistent()
            .set(&DataKey::Rep(participant.clone()), &rep);
        bump(&env, &DataKey::Rep(participant.clone()));

        DisputeRecorded {
            participant,
            issue_id,
            milestone,
            lost,
        }
        .publish(&env);
        Ok(())
    }

    /// Read a contributor's aggregated payout stats. `None` if never recorded.
    pub fn stats(env: Env, contributor: Address) -> Option<ContributorStats> {
        env.storage().persistent().get(&DataKey::Stats(contributor))
    }

    /// Read the full reputation record for an address (contributor or reviewer).
    pub fn reputation(env: Env, subject: Address) -> Option<Reputation> {
        env.storage().persistent().get(&DataKey::Rep(subject))
    }

    /// Deterministic reputation score (0..1000). See [`score_of`].
    pub fn score(env: Env, subject: Address) -> u32 {
        match env.storage().persistent().get(&DataKey::Rep(subject)) {
            Some(rep) => score_of(&rep),
            None => 0,
        }
    }

    /// Number of distinct contributors recorded so far.
    pub fn total_contributors(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::TotalContributors)
            .unwrap_or(0)
    }

    /// The contract currently authorised to write reputation.
    pub fn allowed_caller(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::AllowedCaller)
    }

    /// True once `init` has been called.
    pub fn is_initialised(env: Env) -> bool {
        env.storage().instance().has(&DataKey::Admin)
    }

    fn load_rep(env: &Env, subject: &Address) -> Reputation {
        env.storage()
            .persistent()
            .get(&DataKey::Rep(subject.clone()))
            .unwrap_or(Reputation {
                payouts: 0,
                payout_total: 0,
                reviews_upheld: 0,
                disputes_opened: 0,
                disputes_lost: 0,
            })
    }

    /// Fail unless this invocation was authorised by the configured bounty
    /// contract. A user's own signature cannot satisfy `allowed.require_auth()`.
    fn require_allowed_caller(env: &Env) -> Result<(), RegistryError> {
        if !env.storage().instance().has(&DataKey::Admin) {
            return Err(RegistryError::NotInitialised);
        }
        let allowed: Address = env
            .storage()
            .instance()
            .get(&DataKey::AllowedCaller)
            .ok_or(RegistryError::NotInitialised)?;
        allowed.require_auth();
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    extern crate alloc;

    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, Events as _, MockAuth, MockAuthInvoke},
        xdr, Env, IntoVal, Map, Symbol, TryFromVal, Val, Vec,
    };

    struct Harness {
        env: Env,
        contract_id: Address,
        admin: Address,
        caller: Address,
    }

    fn issue(env: &Env, s: &str) -> String {
        String::from_str(env, s)
    }

    fn harness() -> Harness {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let caller = Address::generate(&env);
        let contract_id = env.register(ContributorsContract, ());
        let client = ContributorsContractClient::new(&env, &contract_id);
        client.init(&admin, &caller);
        Harness {
            env,
            contract_id,
            admin,
            caller,
        }
    }

    fn invoke<'a>(contract: &'a Address, fn_name: &'a str, args: Vec<Val>) -> MockAuthInvoke<'a> {
        MockAuthInvoke {
            contract,
            fn_name,
            args,
            sub_invokes: &[],
        }
    }

    fn event_names(env: &Env, contract_id: &Address) -> alloc::vec::Vec<Symbol> {
        env.events()
            .all()
            .filter_by_contract(contract_id)
            .events()
            .iter()
            .map(|e| {
                let xdr::ContractEventBody::V0(v0) = &e.body;
                Symbol::try_from_val(env, &Val::try_from_val(env, &v0.topics[0]).unwrap()).unwrap()
            })
            .collect()
    }

    fn event_data_i128(env: &Env, contract_id: &Address, key: &str) -> i128 {
        let events = env
            .events()
            .all()
            .filter_by_contract(contract_id)
            .events()
            .to_vec();
        let xdr::ContractEventBody::V0(v0) = &events[0].body;
        let data = Val::try_from_val(env, &v0.data)
            .ok()
            .and_then(|v| Map::<Symbol, Val>::try_from_val(env, &v).ok())
            .unwrap();
        i128::try_from_val(env, &data.get(Symbol::new(env, key)).unwrap()).unwrap()
    }

    // ── Bootstrap ──────────────────────────────────────────────────

    #[test]
    fn test_init_sets_allowed_caller() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let caller = Address::generate(&env);
        let contract_id = env.register(ContributorsContract, ());
        let client = ContributorsContractClient::new(&env, &contract_id);

        client.init(&admin, &caller);
        assert!(client.is_initialised());
        assert_eq!(client.allowed_caller(), Some(caller));

        let other = Address::generate(&env);
        let res = client.try_init(&other, &other);
        assert_eq!(res, Err(Ok(RegistryError::AlreadyInitialised)));
    }

    #[test]
    fn test_init_requires_admin_auth() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let caller = Address::generate(&env);
        let contract_id = env.register(ContributorsContract, ());
        let client = ContributorsContractClient::new(&env, &contract_id);

        assert!(client.try_init(&admin, &caller).is_err());

        let imposter = Address::generate(&env);
        let inv = invoke(
            &contract_id,
            "init",
            Vec::from_array(
                &env,
                [admin.clone().into_val(&env), caller.clone().into_val(&env)],
            ),
        );
        env.mock_auths(&[MockAuth {
            address: &imposter,
            invoke: &inv,
        }]);
        assert!(client.try_init(&admin, &caller).is_err());

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &inv,
        }]);
        client.init(&admin, &caller);
        assert!(client.is_initialised());
    }

    #[test]
    fn test_admin_can_rotate_allowed_caller() {
        let h = harness();
        let client = ContributorsContractClient::new(&h.env, &h.contract_id);
        let new_caller = Address::generate(&h.env);
        client.set_allowed_caller(&h.admin, &new_caller);
        assert_eq!(client.allowed_caller(), Some(new_caller));
    }

    #[test]
    fn test_non_admin_cannot_rotate_allowed_caller() {
        let h = harness();
        let client = ContributorsContractClient::new(&h.env, &h.contract_id);
        let imposter = Address::generate(&h.env);
        let new_caller = Address::generate(&h.env);
        let res = client.try_set_allowed_caller(&imposter, &new_caller);
        assert_eq!(res, Err(Ok(RegistryError::NotAdmin)));
        assert_eq!(client.allowed_caller(), Some(h.caller));
    }

    // ── Payouts ────────────────────────────────────────────────────

    #[test]
    fn test_record_accumulates_stats_and_emits_event() {
        let h = harness();
        let env = &h.env;
        let client = ContributorsContractClient::new(env, &h.contract_id);
        let contributor = Address::generate(env);

        client.record(&contributor, &issue(env, "r#1"), &0, &250);
        let names = event_names(env, &h.contract_id);
        assert_eq!(names.len(), 1);
        assert_eq!(names[0], Symbol::new(env, "contributor_recorded"));
        assert_eq!(event_data_i128(env, &h.contract_id, "total"), 250);

        client.record(&contributor, &issue(env, "r#2"), &0, &125);
        let stats = client.stats(&contributor).unwrap();
        assert_eq!(stats.count, 2);
        assert_eq!(stats.total, 375);
        assert_eq!(client.total_contributors(), 1);

        let rep = client.reputation(&contributor).unwrap();
        assert_eq!(rep.payouts, 2);
        assert_eq!(rep.payout_total, 375);
    }

    #[test]
    fn test_milestones_of_same_issue_count_separately() {
        let h = harness();
        let client = ContributorsContractClient::new(&h.env, &h.contract_id);
        let contributor = Address::generate(&h.env);

        client.record(&contributor, &issue(&h.env, "issue-9"), &0, &100);
        client.record(&contributor, &issue(&h.env, "issue-9"), &1, &50);

        let stats = client.stats(&contributor).unwrap();
        assert_eq!(stats.count, 2);
        assert_eq!(stats.total, 150);
    }

    #[test]
    fn test_replay_of_same_milestone_is_rejected() {
        let h = harness();
        let client = ContributorsContractClient::new(&h.env, &h.contract_id);
        let contributor = Address::generate(&h.env);

        client.record(&contributor, &issue(&h.env, "i1"), &0, &100);
        let replay = client.try_record(&contributor, &issue(&h.env, "i1"), &0, &100);
        assert_eq!(replay, Err(Ok(RegistryError::AlreadyRecorded)));

        // Counters unchanged.
        assert_eq!(client.stats(&contributor).unwrap().count, 1);
        assert_eq!(client.reputation(&contributor).unwrap().payouts, 1);
    }

    #[test]
    fn test_record_validates_inputs() {
        let h = harness();
        let client = ContributorsContractClient::new(&h.env, &h.contract_id);
        let contributor = Address::generate(&h.env);

        let zero = client.try_record(&contributor, &issue(&h.env, "r#1"), &0, &0);
        assert_eq!(zero, Err(Ok(RegistryError::AmountMustBePositive)));

        let empty = client.try_record(&contributor, &issue(&h.env, ""), &0, &100);
        assert_eq!(empty, Err(Ok(RegistryError::EmptyIssueId)));

        assert_eq!(client.stats(&contributor), None);
    }

    #[test]
    fn test_record_before_init_is_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(ContributorsContract, ());
        let client = ContributorsContractClient::new(&env, &contract_id);
        let contributor = Address::generate(&env);
        let res = client.try_record(&contributor, &issue(&env, "r#1"), &0, &100);
        assert_eq!(res, Err(Ok(RegistryError::NotInitialised)));
    }

    #[test]
    fn test_multiple_contributors_tracked() {
        let h = harness();
        let client = ContributorsContractClient::new(&h.env, &h.contract_id);
        let a = Address::generate(&h.env);
        let b = Address::generate(&h.env);

        client.record(&a, &issue(&h.env, "r#1"), &0, &100);
        client.record(&b, &issue(&h.env, "r#2"), &0, &200);
        client.record(&a, &issue(&h.env, "r#3"), &0, &50);

        assert_eq!(client.total_contributors(), 2);
        assert_eq!(client.stats(&a).unwrap().count, 2);
        assert_eq!(client.stats(&a).unwrap().total, 150);
        assert_eq!(client.stats(&b).unwrap().count, 1);
        assert_eq!(client.stats(&b).unwrap().total, 200);
    }

    // ── Authorization ──────────────────────────────────────────────

    fn init_with_explicit_auths(
        env: &Env,
        contract_id: &Address,
        client: &ContributorsContractClient<'_>,
        admin: &Address,
        caller: &Address,
    ) {
        let init_inv = invoke(
            contract_id,
            "init",
            Vec::from_array(
                env,
                [admin.clone().into_val(env), caller.clone().into_val(env)],
            ),
        );
        env.mock_auths(&[MockAuth {
            address: admin,
            invoke: &init_inv,
        }]);
        client.init(admin, caller);
    }

    #[test]
    fn test_record_rejects_unauthorized_caller() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let caller = Address::generate(&env);
        let contract_id = env.register(ContributorsContract, ());
        let client = ContributorsContractClient::new(&env, &contract_id);
        init_with_explicit_auths(&env, &contract_id, &client, &admin, &caller);

        let contributor = Address::generate(&env);
        let issue_id = issue(&env, "r#1");
        let record_inv = invoke(
            &contract_id,
            "record",
            Vec::from_array(
                &env,
                [
                    contributor.clone().into_val(&env),
                    issue_id.clone().into_val(&env),
                    0_u32.into_val(&env),
                    100_i128.into_val(&env),
                ],
            ),
        );

        assert!(client
            .try_record(&contributor, &issue_id, &0, &100)
            .is_err());

        let random = Address::generate(&env);
        env.mock_auths(&[MockAuth {
            address: &random,
            invoke: &record_inv,
        }]);
        assert!(client
            .try_record(&contributor, &issue_id, &0, &100)
            .is_err());

        // Even the admin's signature cannot write reputation.
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &record_inv,
        }]);
        assert!(client
            .try_record(&contributor, &issue_id, &0, &100)
            .is_err());

        assert_eq!(client.stats(&contributor), None);
        assert_eq!(client.total_contributors(), 0);
    }

    // ── Reviews ────────────────────────────────────────────────────

    #[test]
    fn test_record_review_increments_reputation() {
        let h = harness();
        let env = &h.env;
        let client = ContributorsContractClient::new(env, &h.contract_id);
        let reviewer = Address::generate(env);

        client.record_review(&reviewer, &issue(env, "i1"), &0, &true);

        let names = event_names(env, &h.contract_id);
        assert_eq!(names[0], Symbol::new(env, "review_recorded"));
        let rep = client.reputation(&reviewer).unwrap();
        assert_eq!(rep.reviews_upheld, 1);
        assert!(client.score(&reviewer) > 0);
    }

    #[test]
    fn test_rejected_review_does_not_accrue_reputation() {
        let h = harness();
        let client = ContributorsContractClient::new(&h.env, &h.contract_id);
        let reviewer = Address::generate(&h.env);

        client.record_review(&reviewer, &issue(&h.env, "i1"), &0, &false);
        assert_eq!(client.reputation(&reviewer), None);
    }

    #[test]
    fn test_duplicate_uphold_is_rejected() {
        let h = harness();
        let client = ContributorsContractClient::new(&h.env, &h.contract_id);
        let reviewer = Address::generate(&h.env);
        client.record_review(&reviewer, &issue(&h.env, "i1"), &0, &true);
        let replay = client.try_record_review(&reviewer, &issue(&h.env, "i1"), &0, &true);
        assert_eq!(replay, Err(Ok(RegistryError::AlreadyRecorded)));
    }

    // ── Disputes ───────────────────────────────────────────────────

    #[test]
    fn test_dispute_outcomes_affect_score() {
        let h = harness();
        let client = ContributorsContractClient::new(&h.env, &h.contract_id);
        let winner = Address::generate(&h.env);
        let loser = Address::generate(&h.env);

        client.record_dispute(&winner, &issue(&h.env, "i1"), &0, &false);
        client.record_dispute(&loser, &issue(&h.env, "i2"), &0, &true);

        // NOTE: the test env's event view reflects the most recent invocation,
        // so read the emitted topics before making further (read-only) calls.
        let names = event_names(&h.env, &h.contract_id);
        assert_eq!(names[0], Symbol::new(&h.env, "dispute_recorded"));

        assert_eq!(client.reputation(&winner).unwrap().disputes_opened, 1);
        assert_eq!(client.reputation(&winner).unwrap().disputes_lost, 0);
        assert_eq!(client.reputation(&loser).unwrap().disputes_lost, 1);
    }

    #[test]
    fn test_duplicate_dispute_record_is_rejected() {
        let h = harness();
        let client = ContributorsContractClient::new(&h.env, &h.contract_id);
        let opener = Address::generate(&h.env);
        client.record_dispute(&opener, &issue(&h.env, "i1"), &0, &false);
        let replay = client.try_record_dispute(&opener, &issue(&h.env, "i1"), &0, &true);
        assert_eq!(replay, Err(Ok(RegistryError::AlreadyRecorded)));
        // The replay did not sneak a loss in.
        assert_eq!(client.reputation(&opener).unwrap().disputes_lost, 0);
    }

    // ── Score ──────────────────────────────────────────────────────

    #[test]
    fn test_score_is_deterministic_and_clamped() {
        let zero = Reputation {
            payouts: 0,
            payout_total: 0,
            reviews_upheld: 0,
            disputes_opened: 0,
            disputes_lost: 0,
        };
        assert_eq!(score_of(&zero), 0);

        let heavy_loss = Reputation {
            payouts: 0,
            payout_total: 0,
            reviews_upheld: 0,
            disputes_opened: 5,
            disputes_lost: 5,
        };
        assert_eq!(score_of(&heavy_loss), 0); // clamped at 0, never negative

        let capped = Reputation {
            payouts: 1_000,
            payout_total: 0,
            reviews_upheld: 0,
            disputes_opened: 0,
            disputes_lost: 0,
        };
        assert_eq!(score_of(&capped), 1000); // clamped at 1000
    }

    #[test]
    fn test_unknown_address_has_zero_score() {
        let h = harness();
        let client = ContributorsContractClient::new(&h.env, &h.contract_id);
        let nobody = Address::generate(&h.env);
        assert_eq!(client.score(&nobody), 0);
        assert_eq!(client.reputation(&nobody), None);
    }
}
