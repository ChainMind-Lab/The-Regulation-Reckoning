//! Bounty contract v2 test suite.
//!
//! Covers the full surface: multisig proposals (propose/approve/revoke/cancel,
//! thresholds, signer-set rotation), milestone escrow, the reviewer gate, the
//! dispute workflow, authorization, replay guards, and the atomic
//! bounty → reputation-registry inter-contract calls.

extern crate alloc;

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Events as _, MockAuth, MockAuthInvoke},
    token::{Client as TokenClient, StellarAssetClient},
    xdr, Address, Env, IntoVal, Map, Symbol, TryFromVal, Val, Vec,
};

// ── Harness ───────────────────────────────────────────────────────

struct Harness {
    env: Env,
    contract_id: Address,
    admin: Address,
    signer_two: Address,
    funder: Address,
    contributor: Address,
    token_id: Address,
}

fn issue(env: &Env, s: &str) -> String {
    String::from_str(env, s)
}

fn ms(env: &Env, title: &str, amount: i128) -> Milestone {
    Milestone {
        title: String::from_str(env, title),
        amount,
        settled: false,
    }
}

fn client<'a>(env: &'a Env, id: &'a Address) -> BountyContractClient<'a> {
    BountyContractClient::new(env, id)
}

fn token<'a>(env: &'a Env, id: &'a Address) -> TokenClient<'a> {
    TokenClient::new(env, id)
}

/// Fully deployed + initialised harness with `mock_all_auths`.
///
/// Addresses are environment-scoped, so the whole harness — including the
/// optional stub registry — must be built inside a single `Env`.
fn build(with_registry: bool) -> (Harness, Option<Address>) {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let signer_two = Address::generate(&env);
    let funder = Address::generate(&env);
    let contributor = Address::generate(&env);
    let contract_id = env.register(BountyContract, ());
    let token_id = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    StellarAssetClient::new(&env, &token_id).mint(&funder, &1_000_000);

    let registry = if with_registry {
        Some(env.register(TestRegistry, ()))
    } else {
        None
    };
    client(&env, &contract_id).init(&admin, &registry);
    if let Some(id) = registry.clone() {
        TestRegistryClient::new(&env, &id).init(&admin, &contract_id);
    }

    (
        Harness {
            env,
            contract_id,
            admin,
            signer_two,
            funder,
            contributor,
            token_id,
        },
        registry,
    )
}

fn harness() -> Harness {
    build(false).0
}

/// A minimal registry with the same interface as `contracts/contributors`,
/// registered in-test so the bounty contract's cross-contract calls can be
/// exercised without shipping the registry wasm.
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

    pub fn record(env: Env, contributor: Address, issue_id: String, milestone: u32, amount: i128) {
        // Same cross-contract gate as the real registry.
        let allowed: Address = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "allowed"))
            .unwrap();
        allowed.require_auth();
        let mut amounts: Vec<i128> = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "amounts"))
            .unwrap_or(Vec::new(&env));
        amounts.push_back(amount);
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "amounts"), &amounts);
        let mut milestones: Vec<u32> = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "milestones"))
            .unwrap_or(Vec::new(&env));
        milestones.push_back(milestone);
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "milestones"), &milestones);
        let mut refs: Vec<String> = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "refs"))
            .unwrap_or(Vec::new(&env));
        refs.push_back(issue_id);
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "refs"), &refs);
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "last_contributor"), &contributor);
    }

    pub fn record_review(
        env: Env,
        reviewer: Address,
        issue_id: String,
        milestone: u32,
        upheld: bool,
    ) {
        let allowed: Address = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "allowed"))
            .unwrap();
        allowed.require_auth();
        let _ = (issue_id, milestone, upheld);
        let mut reviews: Vec<Address> = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "reviews"))
            .unwrap_or(Vec::new(&env));
        reviews.push_back(reviewer);
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "reviews"), &reviews);
    }

    pub fn record_dispute(
        env: Env,
        participant: Address,
        issue_id: String,
        milestone: u32,
        lost: bool,
    ) {
        let allowed: Address = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "allowed"))
            .unwrap();
        allowed.require_auth();
        let _ = (issue_id, milestone, lost);
        let mut disputes: Vec<Address> = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "disputes"))
            .unwrap_or(Vec::new(&env));
        disputes.push_back(participant);
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "disputes"), &disputes);
    }

    pub fn recorded_amounts(env: Env) -> Vec<i128> {
        env.storage()
            .instance()
            .get(&Symbol::new(&env, "amounts"))
            .unwrap_or(Vec::new(&env))
    }

    pub fn recorded_milestones(env: Env) -> Vec<u32> {
        env.storage()
            .instance()
            .get(&Symbol::new(&env, "milestones"))
            .unwrap_or(Vec::new(&env))
    }

    pub fn recorded_reviews(env: Env) -> Vec<Address> {
        env.storage()
            .instance()
            .get(&Symbol::new(&env, "reviews"))
            .unwrap_or(Vec::new(&env))
    }

    pub fn recorded_disputes(env: Env) -> Vec<Address> {
        env.storage()
            .instance()
            .get(&Symbol::new(&env, "disputes"))
            .unwrap_or(Vec::new(&env))
    }
}

fn harness_with_registry() -> (Harness, Address) {
    let (h, registry) = build(true);
    (h, registry.expect("stub registry deployed"))
}

// ── Convenience flows ─────────────────────────────────────────────

fn propose_release(h: &Harness, issue_id: &String, milestone: u32) -> u64 {
    client(&h.env, &h.contract_id).propose(
        &h.admin,
        &ProposalAction::Release(issue_id.clone(), milestone),
    )
}

fn set_reviewers(h: &Harness, issue_id: &String, reviewers: Vec<Address>, quorum: u32) -> u64 {
    client(&h.env, &h.contract_id).propose(
        &h.admin,
        &ProposalAction::SetReviewers(issue_id.clone(), reviewers, quorum),
    )
}

fn create_single(h: &Harness, issue_id: &String, amount: i128) {
    client(&h.env, &h.contract_id).create(&h.funder, &h.token_id, &amount, issue_id);
}

// ── Event helpers ─────────────────────────────────────────────────

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

fn event_data_i128(env: &Env, contract_id: &Address, index: usize, key: &str) -> i128 {
    let events = env
        .events()
        .all()
        .filter_by_contract(contract_id)
        .events()
        .to_vec();
    let xdr::ContractEventBody::V0(v0) = &events[index].body;
    let data = Val::try_from_val(env, &v0.data)
        .ok()
        .and_then(|v| Map::<Symbol, Val>::try_from_val(env, &v).ok())
        .unwrap();
    i128::try_from_val(env, &data.get(Symbol::new(env, key)).unwrap()).unwrap()
}

// ── Bootstrap & multisig ──────────────────────────────────────────

#[test]
fn test_init_sets_1_of_1_signer_set_and_emits_event() {
    let h = harness();
    let c = client(&h.env, &h.contract_id);
    // Read the emitted topics before any further contract call: the test env's
    // event window only reflects the most recent invocation.
    let names = event_names(&h.env, &h.contract_id);
    assert_eq!(names[0], Symbol::new(&h.env, "admin_initialised"));

    let set = c.get_signers().unwrap();
    assert_eq!(set.threshold, 1);
    assert_eq!(set.signers.len(), 1);
    assert_eq!(set.signers.get(0).unwrap(), h.admin);
    assert!(c.is_initialised());
}

#[test]
fn test_cannot_init_twice() {
    let h = harness();
    let other = Address::generate(&h.env);
    let res = client(&h.env, &h.contract_id).try_init(&other, &None);
    assert_eq!(res, Err(Ok(BountyError::AlreadyInitialised)));
}

#[test]
fn test_cannot_create_before_init() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let funder = Address::generate(&env);
    let contract_id = env.register(BountyContract, ());
    let token_id = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let res = client(&env, &contract_id).try_create(&funder, &token_id, &100, &issue(&env, "x"));
    assert_eq!(res, Err(Ok(BountyError::NotInitialised)));
}

#[test]
fn test_propose_rejects_non_signer() {
    let h = harness();
    let outsider = Address::generate(&h.env);
    let res = client(&h.env, &h.contract_id).try_propose(
        &outsider,
        &ProposalAction::SetSigners(Vec::from_array(&h.env, [outsider.clone()]), 1),
    );
    assert_eq!(res, Err(Ok(BountyError::NotASigner)));
}

#[test]
fn test_propose_requires_real_signature() {
    // No mock_all_auths: only the exact mocked signature is accepted.
    let env = Env::default();
    let admin = Address::generate(&env);
    let contract_id = env.register(BountyContract, ());
    let c = BountyContractClient::new(&env, &contract_id);

    let init_inv = MockAuthInvoke {
        contract: &contract_id,
        fn_name: "init",
        args: Vec::from_array(
            &env,
            [
                admin.clone().into_val(&env),
                Option::<Address>::None.into_val(&env),
            ],
        ),
        sub_invokes: &[],
    };
    env.mock_auths(&[MockAuth {
        address: &admin,
        invoke: &init_inv,
    }]);
    c.init(&admin, &None);

    let signers = Vec::from_array(&env, [admin.clone()]);
    let action = ProposalAction::SetSigners(signers.clone(), 1);
    let propose_inv = MockAuthInvoke {
        contract: &contract_id,
        fn_name: "propose",
        args: Vec::from_array(
            &env,
            [admin.clone().into_val(&env), action.clone().into_val(&env)],
        ),
        sub_invokes: &[],
    };

    // Unsigned → rejected.
    assert!(c.try_propose(&admin, &action).is_err());

    // Signed by the admin → accepted (1-of-1 executes immediately).
    env.mock_auths(&[MockAuth {
        address: &admin,
        invoke: &propose_inv,
    }]);
    c.propose(&admin, &action);
    assert_eq!(c.get_signers().unwrap().threshold, 1);
}

#[test]
fn test_set_signers_rotates_set_and_threshold() {
    let h = harness();
    let c = client(&h.env, &h.contract_id);
    let set = Vec::from_array(&h.env, [h.admin.clone(), h.signer_two.clone()]);
    c.propose(&h.admin, &ProposalAction::SetSigners(set.clone(), 2));

    let names = event_names(&h.env, &h.contract_id);
    assert!(names.contains(&Symbol::new(&h.env, "signers_updated")));

    let stored = c.get_signers().unwrap();
    assert_eq!(stored.threshold, 2);
    assert_eq!(stored.signers.len(), 2);
}

#[test]
fn test_invalid_signer_sets_are_rejected() {
    let h = harness();
    let c = client(&h.env, &h.contract_id);

    let empty: Vec<Address> = Vec::new(&h.env);
    assert_eq!(
        c.try_propose(&h.admin, &ProposalAction::SetSigners(empty, 1)),
        Err(Ok(BountyError::EmptySigners))
    );

    let one = Vec::from_array(&h.env, [h.admin.clone()]);
    assert_eq!(
        c.try_propose(&h.admin, &ProposalAction::SetSigners(one.clone(), 0)),
        Err(Ok(BountyError::InvalidThreshold))
    );
    assert_eq!(
        c.try_propose(&h.admin, &ProposalAction::SetSigners(one.clone(), 2)),
        Err(Ok(BountyError::InvalidThreshold))
    );

    let dup = Vec::from_array(&h.env, [h.admin.clone(), h.admin.clone()]);
    assert_eq!(
        c.try_propose(&h.admin, &ProposalAction::SetSigners(dup, 2)),
        Err(Ok(BountyError::DuplicateSigner))
    );
}

#[test]
fn test_multisig_requires_every_approval_before_funds_move() {
    let h = harness();
    let c = client(&h.env, &h.contract_id);
    let issue_id = issue(&h.env, "issue-ms");
    create_single(&h, &issue_id, 500);
    c.claim(&issue_id, &h.contributor);

    // Raise to 2-of-2.
    let set = Vec::from_array(&h.env, [h.admin.clone(), h.signer_two.clone()]);
    c.propose(&h.admin, &ProposalAction::SetSigners(set, 2));

    let id = c.propose(&h.admin, &ProposalAction::Release(issue_id.clone(), 0));

    // One approval is not enough — no funds moved.
    let proposal = c.get_proposal(&id);
    assert!(!proposal.executed);
    assert_eq!(proposal.approvals.len(), 1);
    assert_eq!(token(&h.env, &h.token_id).balance(&h.contributor), 0);
    assert_eq!(token(&h.env, &h.token_id).balance(&h.contract_id), 500);

    // Second signer approves → executes and pays.
    c.approve(&h.signer_two, &id);
    assert!(c.get_proposal(&id).executed);
    assert_eq!(token(&h.env, &h.token_id).balance(&h.contributor), 500);
    assert_eq!(token(&h.env, &h.token_id).balance(&h.contract_id), 0);
}

#[test]
fn test_approve_is_one_per_signer_and_can_be_revoked() {
    let h = harness();
    let c = client(&h.env, &h.contract_id);
    let set = Vec::from_array(&h.env, [h.admin.clone(), h.signer_two.clone()]);
    c.propose(&h.admin, &ProposalAction::SetSigners(set, 2));

    let id = c.propose(&h.admin, &ProposalAction::Reclaim(issue(&h.env, "nope")));

    assert_eq!(
        c.try_approve(&h.admin, &id),
        Err(Ok(BountyError::AlreadyApproved))
    );

    c.revoke(&h.admin, &id);
    assert_eq!(c.get_proposal(&id).approvals.len(), 0);
    assert_eq!(
        c.try_revoke(&h.admin, &id),
        Err(Ok(BountyError::NotApproved))
    );

    c.approve(&h.admin, &id);
    assert_eq!(c.get_proposal(&id).approvals.len(), 1);
}

#[test]
fn test_cancel_only_by_proposer_and_blocks_execution() {
    let h = harness();
    let c = client(&h.env, &h.contract_id);
    let set = Vec::from_array(&h.env, [h.admin.clone(), h.signer_two.clone()]);
    c.propose(&h.admin, &ProposalAction::SetSigners(set, 2));

    let id = c.propose(&h.admin, &ProposalAction::Reclaim(issue(&h.env, "nope")));

    assert_eq!(
        c.try_cancel(&h.signer_two, &id),
        Err(Ok(BountyError::NotASigner))
    );
    c.cancel(&h.admin, &id);
    assert!(c.get_proposal(&id).cancelled);
    assert_eq!(
        c.try_approve(&h.signer_two, &id),
        Err(Ok(BountyError::ProposalNotExecutable))
    );
}

#[test]
fn test_proposal_and_dispute_counters_are_readable() {
    let h = harness();
    let c = client(&h.env, &h.contract_id);
    assert_eq!(c.proposal_count(), 0);
    assert_eq!(c.dispute_count(), 0);

    let set = Vec::from_array(&h.env, [h.admin.clone()]);
    c.propose(&h.admin, &ProposalAction::SetSigners(set, 1));
    assert_eq!(c.proposal_count(), 1);

    // A failed action rolls back atomically — including the counter increment.
    assert!(c
        .try_propose(
            &h.admin,
            &ProposalAction::Release(issue(&h.env, "missing"), 0)
        )
        .is_err());
    assert_eq!(c.proposal_count(), 1);
}

// ── Bounty lifecycle ──────────────────────────────────────────────

#[test]
fn test_create_single_milestone_is_v1_compatible() {
    let h = harness();
    let c = client(&h.env, &h.contract_id);
    let issue_id = issue(&h.env, "issue-42");
    c.create(&h.funder, &h.token_id, &500, &issue_id);

    let created = event_names(&h.env, &h.contract_id);
    assert_eq!(created[0], Symbol::new(&h.env, "bounty_created"));
    assert_eq!(event_data_i128(&h.env, &h.contract_id, 0, "amount"), 500);

    let bounty = c.get_bounty(&issue_id);
    assert_eq!(bounty.funder, h.funder);
    assert_eq!(bounty.token, h.token_id);
    assert_eq!(bounty.amount, 500);
    assert_eq!(bounty.issue_id, issue_id);
    assert!(!bounty.released);
    assert_eq!(bounty.contributor, None);
    assert_eq!(bounty.milestones.len(), 1);
    assert_eq!(token(&h.env, &h.token_id).balance(&h.contract_id), 500);
}

#[test]
fn test_create_bounty_with_milestones_escrows_the_total() {
    let h = harness();
    let c = client(&h.env, &h.contract_id);
    let issue_id = issue(&h.env, "issue-multi");
    let milestones = Vec::from_array(
        &h.env,
        [
            ms(&h.env, "Research", 100),
            ms(&h.env, "Draft", 150),
            ms(&h.env, "Publish", 250),
        ],
    );
    c.create_bounty(&h.funder, &h.token_id, &issue_id, &milestones);

    let bounty = c.get_bounty(&issue_id);
    assert_eq!(bounty.amount, 500);
    assert_eq!(bounty.milestones.len(), 3);
    assert_eq!(token(&h.env, &h.token_id).balance(&h.contract_id), 500);
}

#[test]
fn test_create_validates_inputs() {
    let h = harness();
    let c = client(&h.env, &h.contract_id);

    let empty: Vec<Milestone> = Vec::new(&h.env);
    assert_eq!(
        c.try_create_bounty(&h.funder, &h.token_id, &issue(&h.env, "a"), &empty),
        Err(Ok(BountyError::NoMilestones))
    );

    let zero = Vec::from_array(&h.env, [ms(&h.env, "x", 0)]);
    assert_eq!(
        c.try_create_bounty(&h.funder, &h.token_id, &issue(&h.env, "b"), &zero),
        Err(Ok(BountyError::MilestoneAmountMustBePositive))
    );

    let untitled = Vec::from_array(&h.env, [ms(&h.env, "", 10)]);
    assert_eq!(
        c.try_create_bounty(&h.funder, &h.token_id, &issue(&h.env, "c"), &untitled),
        Err(Ok(BountyError::EmptyMilestoneTitle))
    );

    let ok = Vec::from_array(&h.env, [ms(&h.env, "work", 10)]);
    assert_eq!(
        c.try_create_bounty(&h.funder, &h.token_id, &issue(&h.env, ""), &ok),
        Err(Ok(BountyError::EmptyIssueId))
    );

    assert_eq!(
        c.try_create(&h.funder, &h.token_id, &0, &issue(&h.env, "d")),
        Err(Ok(BountyError::MilestoneAmountMustBePositive))
    );
}

#[test]
fn test_duplicate_issue_is_rejected() {
    let h = harness();
    let c = client(&h.env, &h.contract_id);
    let issue_id = issue(&h.env, "dup");
    create_single(&h, &issue_id, 100);

    assert_eq!(
        c.try_create(&h.funder, &h.token_id, &100, &issue_id),
        Err(Ok(BountyError::BountyAlreadyExists))
    );
    // A different funder cannot squat the same issue.
    assert_eq!(
        c.try_create(&h.contributor, &h.token_id, &50, &issue_id),
        Err(Ok(BountyError::BountyAlreadyExists))
    );
    assert_eq!(token(&h.env, &h.token_id).balance(&h.contract_id), 100);
}

#[test]
fn test_claim_sets_contributor_and_is_idempotent() {
    let h = harness();
    let c = client(&h.env, &h.contract_id);
    let issue_id = issue(&h.env, "claim");
    create_single(&h, &issue_id, 100);

    c.claim(&issue_id, &h.contributor);

    let names = event_names(&h.env, &h.contract_id);
    assert_eq!(names[0], Symbol::new(&h.env, "contributor_claimed"));

    let bounty = c.get_bounty(&issue_id);
    assert_eq!(bounty.contributor, Some(h.contributor.clone()));

    // Re-claiming by the same address is a no-op.
    c.claim(&issue_id, &h.contributor);

    // A different address cannot steal the claim.
    let thief = Address::generate(&h.env);
    assert_eq!(
        c.try_claim(&issue_id, &thief),
        Err(Ok(BountyError::ContributorNotSet))
    );
}

#[test]
fn test_claim_rejects_missing_bounty() {
    let h = harness();
    assert_eq!(
        client(&h.env, &h.contract_id).try_claim(&issue(&h.env, "none"), &h.contributor),
        Err(Ok(BountyError::BountyNotFound))
    );
}

#[test]
fn test_release_requires_a_claim() {
    let h = harness();
    let issue_id = issue(&h.env, "unclaimed");
    create_single(&h, &issue_id, 100);
    let res =
        client(&h.env, &h.contract_id).try_propose(&h.admin, &ProposalAction::Release(issue_id, 0));
    assert_eq!(res, Err(Ok(BountyError::ContributorNotSet)));
}

#[test]
fn test_reclaim_unclaimed_bounty_returns_funds() {
    let h = harness();
    let c = client(&h.env, &h.contract_id);
    let issue_id = issue(&h.env, "reclaim");
    create_single(&h, &issue_id, 250);
    c.reclaim(&issue_id);

    let names = event_names(&h.env, &h.contract_id);
    assert_eq!(names[0], Symbol::new(&h.env, "bounty_reclaimed"));

    let bounty = c.get_bounty(&issue_id);
    assert!(bounty.released);
    assert!(bounty.refunded);
    assert_eq!(token(&h.env, &h.token_id).balance(&h.funder), 1_000_000);
    assert_eq!(token(&h.env, &h.token_id).balance(&h.contract_id), 0);
}

#[test]
fn test_reclaim_is_closed_once_a_contributor_claims() {
    let h = harness();
    let c = client(&h.env, &h.contract_id);
    let issue_id = issue(&h.env, "granular");
    create_single(&h, &issue_id, 250);
    c.claim(&issue_id, &h.contributor);

    // The funder can no longer rug work in progress.
    assert_eq!(
        c.try_reclaim(&issue_id),
        Err(Ok(BountyError::ContributorNotSet))
    );
    assert_eq!(token(&h.env, &h.token_id).balance(&h.contract_id), 250);
}

#[test]
fn test_proposal_reclaim_refunds_after_claim() {
    let h = harness();
    let c = client(&h.env, &h.contract_id);
    let issue_id = issue(&h.env, "proposal-refund");
    create_single(&h, &issue_id, 250);
    c.claim(&issue_id, &h.contributor);

    c.propose(&h.admin, &ProposalAction::Reclaim(issue_id.clone()));

    let names = event_names(&h.env, &h.contract_id);
    assert!(names.contains(&Symbol::new(&h.env, "bounty_refunded")));

    let bounty = c.get_bounty(&issue_id);
    assert!(bounty.refunded);
    assert_eq!(token(&h.env, &h.token_id).balance(&h.funder), 1_000_000);
}

#[test]
fn test_insufficient_balance_fails_create() {
    let h = harness();
    let c = client(&h.env, &h.contract_id);
    let res = c.try_create(&h.funder, &h.token_id, &i128::MAX, &issue(&h.env, "broke"));
    assert!(res.is_err());
    assert!(c.try_get_bounty(&issue(&h.env, "broke")).is_err());
}

// ── Reviewer system ───────────────────────────────────────────────

#[test]
fn test_set_reviewers_and_validate_quorum() {
    let h = harness();
    let c = client(&h.env, &h.contract_id);
    let issue_id = issue(&h.env, "rev");
    create_single(&h, &issue_id, 300);
    let r1 = Address::generate(&h.env);
    let r2 = Address::generate(&h.env);

    set_reviewers(
        &h,
        &issue_id,
        Vec::from_array(&h.env, [r1.clone(), r2.clone()]),
        2,
    );
    let bounty = c.get_bounty(&issue_id);
    assert_eq!(bounty.reviewers.len(), 2);
    assert_eq!(bounty.reviewer_quorum, 2);

    // Invalid quorums are rejected.
    assert_eq!(
        c.try_propose(
            &h.admin,
            &ProposalAction::SetReviewers(
                issue_id.clone(),
                Vec::from_array(&h.env, [r1.clone()]),
                0
            )
        ),
        Err(Ok(BountyError::InvalidQuorum))
    );
    assert_eq!(
        c.try_propose(
            &h.admin,
            &ProposalAction::SetReviewers(
                issue_id.clone(),
                Vec::from_array(&h.env, [r1.clone()]),
                5
            )
        ),
        Err(Ok(BountyError::InvalidQuorum))
    );
    assert_eq!(
        c.try_propose(
            &h.admin,
            &ProposalAction::SetReviewers(issue_id, Vec::new(&h.env), 1)
        ),
        Err(Ok(BountyError::InvalidQuorum))
    );
}

#[test]
fn test_release_blocked_until_reviewer_quorum_is_met() {
    let h = harness();
    let c = client(&h.env, &h.contract_id);
    let issue_id = issue(&h.env, "gate");
    create_single(&h, &issue_id, 300);
    c.claim(&issue_id, &h.contributor);
    let r1 = Address::generate(&h.env);
    let r2 = Address::generate(&h.env);
    set_reviewers(
        &h,
        &issue_id,
        Vec::from_array(&h.env, [r1.clone(), r2.clone()]),
        2,
    );

    // No reviews → blocked.
    assert_eq!(
        c.try_propose(&h.admin, &ProposalAction::Release(issue_id.clone(), 0)),
        Err(Ok(BountyError::ReviewerQuorumNotMet))
    );

    // One of two → still blocked.
    c.submit_review(
        &r1,
        &issue_id,
        &0,
        &ReviewDecision::Approve,
        &issue(&h.env, "ipfs://review-1"),
    );
    assert_eq!(
        c.try_propose(&h.admin, &ProposalAction::Release(issue_id.clone(), 0)),
        Err(Ok(BountyError::ReviewerQuorumNotMet))
    );

    // Quorum reached → release succeeds.
    c.submit_review(
        &r2,
        &issue_id,
        &0,
        &ReviewDecision::Approve,
        &issue(&h.env, "ipfs://review-2"),
    );
    let tally = c.review_tally(&issue_id, &0);
    assert_eq!(tally, (2, 0));
    propose_release(&h, &issue_id, 0);
    assert_eq!(token(&h.env, &h.token_id).balance(&h.contributor), 300);
}

#[test]
fn test_review_only_by_assigned_reviewer() {
    let h = harness();
    let c = client(&h.env, &h.contract_id);
    let issue_id = issue(&h.env, "rev-auth");
    create_single(&h, &issue_id, 100);
    let r1 = Address::generate(&h.env);
    let outsider = Address::generate(&h.env);
    set_reviewers(&h, &issue_id, Vec::from_array(&h.env, [r1]), 1);

    assert_eq!(
        c.try_submit_review(
            &outsider,
            &issue_id,
            &0,
            &ReviewDecision::Approve,
            &issue(&h.env, "h")
        ),
        Err(Ok(BountyError::NotReviewer))
    );
}

#[test]
fn test_duplicate_review_is_rejected() {
    let h = harness();
    let c = client(&h.env, &h.contract_id);
    let issue_id = issue(&h.env, "rev-dup");
    create_single(&h, &issue_id, 100);
    let r1 = Address::generate(&h.env);
    set_reviewers(&h, &issue_id, Vec::from_array(&h.env, [r1.clone()]), 1);

    c.submit_review(
        &r1,
        &issue_id,
        &0,
        &ReviewDecision::Approve,
        &issue(&h.env, "h"),
    );
    assert_eq!(
        c.try_submit_review(
            &r1,
            &issue_id,
            &0,
            &ReviewDecision::Reject,
            &issue(&h.env, "h2")
        ),
        Err(Ok(BountyError::AlreadyReviewed))
    );
}

#[test]
fn test_review_validates_milestone_and_settlement() {
    let h = harness();
    let c = client(&h.env, &h.contract_id);
    let issue_id = issue(&h.env, "rev-ms");
    create_single(&h, &issue_id, 100);
    let r1 = Address::generate(&h.env);
    set_reviewers(&h, &issue_id, Vec::from_array(&h.env, [r1.clone()]), 1);

    assert_eq!(
        c.try_submit_review(
            &r1,
            &issue_id,
            &9,
            &ReviewDecision::Approve,
            &issue(&h.env, "h")
        ),
        Err(Ok(BountyError::MilestoneNotFound))
    );

    c.claim(&issue_id, &h.contributor);
    c.submit_review(
        &r1,
        &issue_id,
        &0,
        &ReviewDecision::Approve,
        &issue(&h.env, "h"),
    );
    propose_release(&h, &issue_id, 0);

    assert_eq!(
        c.try_submit_review(
            &r1,
            &issue_id,
            &0,
            &ReviewDecision::Approve,
            &issue(&h.env, "h")
        ),
        Err(Ok(BountyError::AlreadyReleased))
    );
}

#[test]
fn test_rejected_reviews_do_not_count_towards_quorum() {
    let h = harness();
    let c = client(&h.env, &h.contract_id);
    let issue_id = issue(&h.env, "rev-reject");
    create_single(&h, &issue_id, 100);
    c.claim(&issue_id, &h.contributor);
    let r1 = Address::generate(&h.env);
    let r2 = Address::generate(&h.env);
    set_reviewers(
        &h,
        &issue_id,
        Vec::from_array(&h.env, [r1.clone(), r2.clone()]),
        2,
    );

    c.submit_review(
        &r1,
        &issue_id,
        &0,
        &ReviewDecision::Reject,
        &issue(&h.env, "h"),
    );
    c.submit_review(
        &r2,
        &issue_id,
        &0,
        &ReviewDecision::Approve,
        &issue(&h.env, "h"),
    );
    assert_eq!(c.review_tally(&issue_id, &0), (1, 1));

    assert_eq!(
        c.try_propose(&h.admin, &ProposalAction::Release(issue_id, 0)),
        Err(Ok(BountyError::ReviewerQuorumNotMet))
    );
}

// ── Milestone releases ────────────────────────────────────────────

#[test]
fn test_multi_milestone_release_flow_and_events() {
    let h = harness();
    let c = client(&h.env, &h.contract_id);
    let issue_id = issue(&h.env, "flow");
    let milestones = Vec::from_array(
        &h.env,
        [ms(&h.env, "Research", 100), ms(&h.env, "Publish", 150)],
    );
    c.create_bounty(&h.funder, &h.token_id, &issue_id, &milestones);
    c.claim(&issue_id, &h.contributor);

    propose_release(&h, &issue_id, 0);
    let names = event_names(&h.env, &h.contract_id);
    assert!(names.contains(&Symbol::new(&h.env, "milestone_released")));
    assert_eq!(token(&h.env, &h.token_id).balance(&h.contributor), 100);

    let bounty = c.get_bounty(&issue_id);
    assert!(!bounty.released); // second milestone still open
    assert_eq!(bounty.released_amount, 100);

    propose_release(&h, &issue_id, 1);
    let bounty = c.get_bounty(&issue_id);
    assert!(bounty.released);
    assert_eq!(bounty.released_amount, 250);
    assert_eq!(token(&h.env, &h.token_id).balance(&h.contributor), 250);
    assert_eq!(token(&h.env, &h.token_id).balance(&h.contract_id), 0);
}

#[test]
fn test_cannot_release_a_milestone_twice() {
    let h = harness();
    let c = client(&h.env, &h.contract_id);
    let issue_id = issue(&h.env, "twice");
    create_single(&h, &issue_id, 500);
    c.claim(&issue_id, &h.contributor);
    propose_release(&h, &issue_id, 0);

    assert_eq!(
        c.try_propose(&h.admin, &ProposalAction::Release(issue_id.clone(), 0)),
        Err(Ok(BountyError::AlreadyReleased))
    );
    assert_eq!(token(&h.env, &h.token_id).balance(&h.contributor), 500);
}

#[test]
fn test_release_rejects_unknown_milestone() {
    let h = harness();
    let c = client(&h.env, &h.contract_id);
    let issue_id = issue(&h.env, "ms-missing");
    create_single(&h, &issue_id, 100);
    c.claim(&issue_id, &h.contributor);
    assert_eq!(
        c.try_propose(&h.admin, &ProposalAction::Release(issue_id, 7)),
        Err(Ok(BountyError::MilestoneNotFound))
    );
}

#[test]
fn test_release_rejects_missing_bounty() {
    let h = harness();
    assert_eq!(
        client(&h.env, &h.contract_id).try_propose(
            &h.admin,
            &ProposalAction::Release(issue(&h.env, "ghost"), 0)
        ),
        Err(Ok(BountyError::BountyNotFound))
    );
}

#[test]
fn test_get_bounty_rejects_unknown_issue() {
    let h = harness();
    assert_eq!(
        client(&h.env, &h.contract_id).try_get_bounty(&issue(&h.env, "nope")),
        Err(Ok(BountyError::BountyNotFound))
    );
}

// ── Disputes ──────────────────────────────────────────────────────

#[test]
fn test_open_dispute_only_by_funder_or_contributor() {
    let h = harness();
    let c = client(&h.env, &h.contract_id);
    let issue_id = issue(&h.env, "d-auth");
    create_single(&h, &issue_id, 100);
    c.claim(&issue_id, &h.contributor);
    let outsider = Address::generate(&h.env);

    assert_eq!(
        c.try_open_dispute(&outsider, &issue_id, &0, &issue(&h.env, "h")),
        Err(Ok(BountyError::NotDisputeParty))
    );

    let id = c.open_dispute(&h.funder, &issue_id, &0, &issue(&h.env, "h"));
    let dispute = c.get_dispute(&id);
    assert_eq!(dispute.opener, h.funder);
    assert!(!dispute.resolved);
    assert_eq!(c.dispute_count(), 1);
}

#[test]
fn test_duplicate_dispute_is_rejected() {
    let h = harness();
    let c = client(&h.env, &h.contract_id);
    let issue_id = issue(&h.env, "d-dup");
    create_single(&h, &issue_id, 100);
    c.claim(&issue_id, &h.contributor);
    c.open_dispute(&h.funder, &issue_id, &0, &issue(&h.env, "h"));

    assert_eq!(
        c.try_open_dispute(&h.contributor, &issue_id, &0, &issue(&h.env, "h2")),
        Err(Ok(BountyError::AlreadyDisputed))
    );
}

#[test]
fn test_disputed_milestone_cannot_be_released() {
    let h = harness();
    let c = client(&h.env, &h.contract_id);
    let issue_id = issue(&h.env, "d-block");
    create_single(&h, &issue_id, 400);
    c.claim(&issue_id, &h.contributor);
    c.open_dispute(&h.contributor, &issue_id, &0, &issue(&h.env, "h"));

    assert_eq!(
        c.try_propose(&h.admin, &ProposalAction::Release(issue_id, 0)),
        Err(Ok(BountyError::MilestoneDisputed))
    );
    assert_eq!(token(&h.env, &h.token_id).balance(&h.contract_id), 400);
}

#[test]
fn test_dispute_vote_requires_reviewer_and_is_one_each() {
    let h = harness();
    let c = client(&h.env, &h.contract_id);
    let issue_id = issue(&h.env, "d-vote");
    create_single(&h, &issue_id, 100);
    c.claim(&issue_id, &h.contributor);
    let r1 = Address::generate(&h.env);
    set_reviewers(&h, &issue_id, Vec::from_array(&h.env, [r1.clone()]), 1);
    let id = c.open_dispute(&h.funder, &issue_id, &0, &issue(&h.env, "h"));

    let outsider = Address::generate(&h.env);
    assert_eq!(
        c.try_vote_on_dispute(&outsider, &id, &true),
        Err(Ok(BountyError::NotReviewer))
    );

    c.vote_on_dispute(&r1, &id, &false);
    assert_eq!(
        c.try_vote_on_dispute(&r1, &id, &true),
        Err(Ok(BountyError::AlreadyApproved))
    );
    let dispute = c.get_dispute(&id);
    assert_eq!(dispute.votes_refund_funder, 1);
    assert_eq!(dispute.votes_pay_contributor, 0);
}

#[test]
fn test_dispute_resolution_requires_reviewer_votes() {
    let h = harness();
    let c = client(&h.env, &h.contract_id);
    let issue_id = issue(&h.env, "d-quorum");
    create_single(&h, &issue_id, 100);
    c.claim(&issue_id, &h.contributor);
    let r1 = Address::generate(&h.env);
    set_reviewers(&h, &issue_id, Vec::from_array(&h.env, [r1.clone()]), 1);
    let id = c.open_dispute(&h.contributor, &issue_id, &0, &issue(&h.env, "h"));

    // No votes yet → cannot resolve.
    assert_eq!(
        c.try_propose(&h.admin, &ProposalAction::ResolveDispute(id, true)),
        Err(Ok(BountyError::ReviewerQuorumNotMet))
    );

    c.vote_on_dispute(&r1, &id, &true);
    propose_release_placeholder(&h, id, true);
    assert_eq!(token(&h.env, &h.token_id).balance(&h.contributor), 100);
}

fn propose_release_placeholder(h: &Harness, dispute_id: u64, pay: bool) {
    client(&h.env, &h.contract_id)
        .propose(&h.admin, &ProposalAction::ResolveDispute(dispute_id, pay));
}

#[test]
fn test_dispute_resolution_can_refund_the_funder() {
    let h = harness();
    let c = client(&h.env, &h.contract_id);
    let issue_id = issue(&h.env, "d-refund");
    create_single(&h, &issue_id, 200);
    c.claim(&issue_id, &h.contributor);
    let r1 = Address::generate(&h.env);
    set_reviewers(&h, &issue_id, Vec::from_array(&h.env, [r1.clone()]), 1);
    let id = c.open_dispute(&h.funder, &issue_id, &0, &issue(&h.env, "h"));
    c.vote_on_dispute(&r1, &id, &false);

    c.propose(&h.admin, &ProposalAction::ResolveDispute(id, false));

    let names = event_names(&h.env, &h.contract_id);
    assert!(names.contains(&Symbol::new(&h.env, "dispute_resolved")));

    let dispute = c.get_dispute(&id);
    assert!(dispute.resolved);
    assert!(!dispute.pay_contributor);
    assert_eq!(token(&h.env, &h.token_id).balance(&h.funder), 1_000_000);
    assert_eq!(token(&h.env, &h.token_id).balance(&h.contract_id), 0);
}

#[test]
fn test_dispute_cannot_be_resolved_twice() {
    let h = harness();
    let c = client(&h.env, &h.contract_id);
    let issue_id = issue(&h.env, "d-once");
    create_single(&h, &issue_id, 100);
    c.claim(&issue_id, &h.contributor);
    let r1 = Address::generate(&h.env);
    set_reviewers(&h, &issue_id, Vec::from_array(&h.env, [r1.clone()]), 1);
    let id = c.open_dispute(&h.funder, &issue_id, &0, &issue(&h.env, "h"));
    c.vote_on_dispute(&r1, &id, &true);
    c.propose(&h.admin, &ProposalAction::ResolveDispute(id, true));

    assert_eq!(
        c.try_propose(&h.admin, &ProposalAction::ResolveDispute(id, true)),
        Err(Ok(BountyError::DisputeAlreadyResolved))
    );
    assert_eq!(token(&h.env, &h.token_id).balance(&h.contributor), 100);
}

#[test]
fn test_unknown_dispute_is_rejected() {
    let h = harness();
    let c = client(&h.env, &h.contract_id);
    assert_eq!(
        c.try_get_dispute(&42),
        Err(Ok(BountyError::DisputeNotFound))
    );
    assert_eq!(
        c.try_propose(&h.admin, &ProposalAction::ResolveDispute(42, true)),
        Err(Ok(BountyError::DisputeNotFound))
    );
}

#[test]
fn test_dispute_opening_is_closed_after_settlement() {
    let h = harness();
    let c = client(&h.env, &h.contract_id);
    let issue_id = issue(&h.env, "d-settled");
    create_single(&h, &issue_id, 100);
    c.claim(&issue_id, &h.contributor);
    propose_release(&h, &issue_id, 0);

    assert_eq!(
        c.try_open_dispute(&h.funder, &issue_id, &0, &issue(&h.env, "h")),
        Err(Ok(BountyError::AlreadyReleased))
    );
}

// ── Inter-contract communication ──────────────────────────────────

#[test]
fn test_release_records_each_milestone_in_the_registry() {
    let (h, registry_id) = harness_with_registry();
    let c = client(&h.env, &h.contract_id);
    let registry = TestRegistryClient::new(&h.env, &registry_id);
    let issue_id = issue(&h.env, "registry");
    let milestones = Vec::from_array(&h.env, [ms(&h.env, "One", 100), ms(&h.env, "Two", 50)]);
    c.create_bounty(&h.funder, &h.token_id, &issue_id, &milestones);
    c.claim(&issue_id, &h.contributor);

    propose_release(&h, &issue_id, 0);
    propose_release(&h, &issue_id, 1);

    // Every milestone payout was recorded on-chain in the second contract,
    // with the right amount and index.
    let amounts = registry.recorded_amounts();
    assert_eq!(amounts.len(), 2);
    assert_eq!(amounts.get(0).unwrap(), 100);
    assert_eq!(amounts.get(1).unwrap(), 50);
    let idx = registry.recorded_milestones();
    assert_eq!(idx.get(0).unwrap(), 0);
    assert_eq!(idx.get(1).unwrap(), 1);
    assert_eq!(token(&h.env, &h.token_id).balance(&h.contributor), 150);
}

#[test]
fn test_release_credits_upheld_reviewers_in_the_registry() {
    let (h, registry_id) = harness_with_registry();
    let c = client(&h.env, &h.contract_id);
    let registry = TestRegistryClient::new(&h.env, &registry_id);
    let issue_id = issue(&h.env, "registry-reviews");
    create_single(&h, &issue_id, 100);
    c.claim(&issue_id, &h.contributor);
    let r1 = Address::generate(&h.env);
    let r2 = Address::generate(&h.env);
    set_reviewers(
        &h,
        &issue_id,
        Vec::from_array(&h.env, [r1.clone(), r2.clone()]),
        2,
    );
    c.submit_review(
        &r1,
        &issue_id,
        &0,
        &ReviewDecision::Approve,
        &issue(&h.env, "h"),
    );
    c.submit_review(
        &r2,
        &issue_id,
        &0,
        &ReviewDecision::Reject,
        &issue(&h.env, "h"),
    );
    // Quorum not met (1 approval of 2), so no payout yet.
    assert!(c
        .try_propose(&h.admin, &ProposalAction::Release(issue_id.clone(), 0))
        .is_err());

    // r2 changes their mind? Reviews are one-shot; assign a third reviewer to
    // reach quorum without double-counting r1.
    let r3 = Address::generate(&h.env);
    set_reviewers(
        &h,
        &issue_id,
        Vec::from_array(&h.env, [r1.clone(), r2.clone(), r3.clone()]),
        2,
    );
    c.submit_review(
        &r3,
        &issue_id,
        &0,
        &ReviewDecision::Approve,
        &issue(&h.env, "h"),
    );
    propose_release(&h, &issue_id, 0);

    // r1 and r3 approved → both credited; r2 rejected → not credited.
    let reviews = registry.recorded_reviews();
    assert_eq!(reviews.len(), 2);
    assert_eq!(reviews.get(0).unwrap(), r1);
    assert_eq!(reviews.get(1).unwrap(), r3);
}

#[test]
fn test_resolved_dispute_records_the_loser_in_the_registry() {
    let (h, registry_id) = harness_with_registry();
    let c = client(&h.env, &h.contract_id);
    let registry = TestRegistryClient::new(&h.env, &registry_id);
    let issue_id = issue(&h.env, "registry-dispute");
    create_single(&h, &issue_id, 100);
    c.claim(&issue_id, &h.contributor);
    let r1 = Address::generate(&h.env);
    set_reviewers(&h, &issue_id, Vec::from_array(&h.env, [r1.clone()]), 1);
    let id = c.open_dispute(&h.funder, &issue_id, &0, &issue(&h.env, "h"));
    // Reviewer sides with the contributor; the funder loses.
    c.vote_on_dispute(&r1, &id, &true);
    c.propose(&h.admin, &ProposalAction::ResolveDispute(id, true));

    let losers = registry.recorded_disputes();
    assert_eq!(losers.len(), 1);
    assert_eq!(losers.get(0).unwrap(), h.funder);
    assert_eq!(token(&h.env, &h.token_id).balance(&h.contributor), 100);
}

#[test]
fn test_release_without_registry_still_works() {
    let h = harness();
    let c = client(&h.env, &h.contract_id);
    let issue_id = issue(&h.env, "no-registry");
    create_single(&h, &issue_id, 250);
    c.claim(&issue_id, &h.contributor);
    propose_release(&h, &issue_id, 0);
    assert!(c.get_bounty(&issue_id).released);
    assert_eq!(token(&h.env, &h.token_id).balance(&h.contributor), 250);
}

#[test]
fn test_registry_is_exposed_for_clients() {
    let (h, registry_id) = harness_with_registry();
    let c = client(&h.env, &h.contract_id);
    assert_eq!(c.get_registry(), Some(registry_id));
}
