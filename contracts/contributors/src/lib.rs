//! # Regulation Reckoning — Contributor Registry Contract
//!
//! An on-chain reputation registry that aggregates bounty payouts per
//! contributor. The bounty contract (`contracts/bounty`) calls `record()` on
//! every successful `release`, so contributor history is verifiable on Stellar
//! without any off-chain indexing — this is the inter-contract communication
//! layer of the product.
//!
//! ## Security model
//!
//! - `init` is one-time and fixes two addresses:
//!   - `admin` — the deployer, retained for future admin operations.
//!   - `allowed_caller` — the only contract allowed to call `record()`
//!     (the deployed bounty contract). Anyone else is rejected with
//!     `UnauthorizedCaller`, so contributors cannot inflate their own stats.
//! - `record` is idempotent in aggregate: re-recording the same release (a
//!   replay) increments stats again — the *bounty* contract is the replay guard
//!   (it refuses to release the same bounty twice). The registry trusts its
//!   single caller, which is exactly one hop from the user signature.
//! - All state-changing methods return typed `Result` errors.

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
    /// The caller of `record` is not the configured bounty contract.
    UnauthorizedCaller = 3,
    /// Payout amount must be strictly positive.
    AmountMustBePositive = 4,
    /// Issue ID must not be empty.
    EmptyIssueId = 5,
}

/// Aggregated on-chain stats for one contributor.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ContributorStats {
    /// Number of bounties released to this contributor.
    pub count: u32,
    /// Total amount earned (token units, RRD for the current deployment).
    pub total: i128,
}

/// A contributor received a bounty payout. Emitted by `record`.
#[contractevent]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ContributorRecorded {
    #[topic]
    pub contributor: Address,
    pub issue_id: String,
    pub amount: i128,
    pub total: i128,
}

/// Storage keys.
#[contracttype]
pub enum DataKey {
    Admin,
    AllowedCaller,
    Stats(Address),
    TotalContributors,
}

#[contract]
pub struct ContributorsContract;

#[contractimpl]
impl ContributorsContract {
    /// One-time initialisation. `allowed_caller` is the bounty contract that
    /// is permitted to record payouts.
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

    /// Record a payout from the bounty contract. Only `allowed_caller` (the
    /// bounty contract) may invoke this — `env.caller()` must match.
    pub fn record(
        env: Env,
        contributor: Address,
        issue_id: String,
        amount: i128,
    ) -> Result<(), RegistryError> {
        if !env.storage().instance().has(&DataKey::Admin) {
            return Err(RegistryError::NotInitialised);
        }
        let allowed: Address = env
            .storage()
            .instance()
            .get(&DataKey::AllowedCaller)
            .unwrap();
        // Cross-contract auth: only the allowed caller (the bounty contract) can
        // satisfy this — a direct user call has no auth entry for the contract.
        allowed.require_auth();
        if amount <= 0 {
            return Err(RegistryError::AmountMustBePositive);
        }
        if issue_id.is_empty() {
            return Err(RegistryError::EmptyIssueId);
        }

        let mut stats = match env
            .storage()
            .instance()
            .get(&DataKey::Stats(contributor.clone()))
        {
            Some(s) => s,
            None => {
                let total: u32 = env
                    .storage()
                    .instance()
                    .get(&DataKey::TotalContributors)
                    .unwrap_or(0);
                env.storage()
                    .instance()
                    .set(&DataKey::TotalContributors, &(total + 1));
                ContributorStats { count: 0, total: 0 }
            }
        };
        stats.count += 1;
        stats.total += amount;
        env.storage()
            .instance()
            .set(&DataKey::Stats(contributor.clone()), &stats);

        ContributorRecorded {
            contributor: contributor.clone(),
            issue_id,
            amount,
            total: stats.total,
        }
        .publish(&env);
        Ok(())
    }

    /// Read a contributor's aggregated stats. `None` if never recorded.
    pub fn stats(env: Env, contributor: Address) -> Option<ContributorStats> {
        env.storage().instance().get(&DataKey::Stats(contributor))
    }

    /// Number of distinct contributors recorded so far.
    pub fn total_contributors(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::TotalContributors)
            .unwrap_or(0)
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
        xdr, Env, IntoVal, Map, Symbol, TryFromVal, Val, Vec,
    };

    #[allow(dead_code)]
    struct Harness {
        env: Env,
        contract_id: Address,
        #[allow(dead_code)]
        admin: Address,
        #[allow(dead_code)]
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

        // init is one-time.
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

        // No auths → rejected.
        assert!(client.try_init(&admin, &caller).is_err());

        // Authorized by an imposter → rejected.
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

        // Authorized by the admin → accepted.
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &inv,
        }]);
        client.init(&admin, &caller);
        assert!(client.is_initialised());
    }

    #[test]
    fn test_record_accumulates_stats_and_emits_event() {
        let h = harness();
        let env = &h.env;
        let client = ContributorsContractClient::new(env, &h.contract_id);
        let contributor = Address::generate(env);

        // The allowed caller records two payouts.
        client.record(&contributor, &issue(env, "r#1"), &250);
        let events = env
            .events()
            .all()
            .filter_by_contract(&h.contract_id)
            .events()
            .to_vec();
        assert_eq!(events.len(), 1);
        let xdr::ContractEventBody::V0(v0) = &events[0].body;
        let name =
            Symbol::try_from_val(env, &Val::try_from_val(env, &v0.topics[0]).unwrap()).unwrap();
        assert_eq!(name, Symbol::new(env, "contributor_recorded"));
        let data = Val::try_from_val(env, &v0.data)
            .ok()
            .and_then(|v| Map::<Symbol, Val>::try_from_val(env, &v).ok())
            .unwrap();
        let total = i128::try_from_val(env, &data.get(Symbol::new(env, "total")).unwrap()).unwrap();
        assert_eq!(total, 250);

        client.record(&contributor, &issue(env, "r#2"), &125);
        let stats = client.stats(&contributor).unwrap();
        assert_eq!(stats.count, 2);
        assert_eq!(stats.total, 375);
        assert_eq!(client.total_contributors(), 1);
    }

    /// Registry initialised with explicit admin auth (no mock_all_auths).
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
        // No mock_all_auths: only the exact signatures we mock are accepted.
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
                    100_i128.into_val(&env),
                ],
            ),
        );

        // No auths at all → rejected.
        assert!(client.try_record(&contributor, &issue_id, &100).is_err());

        // A random account's signature does not satisfy the allowed caller's
        // auth → rejected (host auth error).
        let random = Address::generate(&env);
        env.mock_auths(&[MockAuth {
            address: &random,
            invoke: &record_inv,
        }]);
        assert!(client.try_record(&contributor, &issue_id, &100).is_err());

        // Even the admin's signature cannot record (only the bounty contract
        // may, via sub-invocation auto-auth) → rejected.
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &record_inv,
        }]);
        assert!(client.try_record(&contributor, &issue_id, &100).is_err());

        assert_eq!(client.stats(&contributor), None);
        assert_eq!(client.total_contributors(), 0);
    }

    #[test]
    fn test_record_before_init_is_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(ContributorsContract, ());
        let client = ContributorsContractClient::new(&env, &contract_id);
        let contributor = Address::generate(&env);
        let res = client.try_record(&contributor, &issue(&env, "r#1"), &100);
        assert_eq!(res, Err(Ok(RegistryError::NotInitialised)));
    }

    #[test]
    fn test_record_validates_inputs() {
        let h = harness();
        let client = ContributorsContractClient::new(&h.env, &h.contract_id);
        let contributor = Address::generate(&h.env);

        let zero = client.try_record(&contributor, &issue(&h.env, "r#1"), &0);
        assert_eq!(zero, Err(Ok(RegistryError::AmountMustBePositive)));

        let empty = client.try_record(&contributor, &issue(&h.env, ""), &100);
        assert_eq!(empty, Err(Ok(RegistryError::EmptyIssueId)));

        assert_eq!(client.stats(&contributor), None);
    }

    #[test]
    fn test_multiple_contributors_tracked() {
        let h = harness();
        let client = ContributorsContractClient::new(&h.env, &h.contract_id);
        let a = Address::generate(&h.env);
        let b = Address::generate(&h.env);

        client.record(&a, &issue(&h.env, "r#1"), &100);
        client.record(&b, &issue(&h.env, "r#2"), &200);
        client.record(&a, &issue(&h.env, "r#3"), &50);

        assert_eq!(client.total_contributors(), 2);
        assert_eq!(client.stats(&a).unwrap().count, 2);
        assert_eq!(client.stats(&a).unwrap().total, 150);
        assert_eq!(client.stats(&b).unwrap().count, 1);
        assert_eq!(client.stats(&b).unwrap().total, 200);
    }
}
