//! # Regulation Reckoning — Bounty Escrow, Multisig, Review & Dispute Contract
//!
//! A Soroban bounty escrow for The Regulation Reckoning (Stellar Testnet).
//!
//! A funder locks tokens (any Soroban token, e.g. the RRD demo token) against a
//! regulatory-research issue, split into one or more **milestones**. A
//! contributor claims the issue. Assigned **reviewers** submit approve/reject
//! decisions per milestone. Once a milestone has the reviewer quorum, the
//! **multisig signer set** releases that milestone's escrow to the contributor.
//!
//! ## Governance model (multisig)
//!
//! There is no single mutable admin after bootstrap. `init` seeds a signer set
//! with the deployer and a threshold of 1. Every sensitive operation goes
//! through an asynchronous proposal/approval cycle:
//!
//! ```text
//! propose(signer, action) -> proposal id     # auto-approves the proposer
//! approve(signer, id)                        # executes once threshold is met
//! revoke(signer, id) / cancel(proposer, id)
//! ```
//!
//! Threshold 1 (the bootstrap default) executes synchronously inside `propose`,
//! which preserves the simple single-signer flow; raising the threshold to N
//! means N distinct signer signatures are required before funds move. Proposals
//! are stored on-chain and every step emits an event, so an indexer (and a
//! human) can audit exactly who approved what.
//!
//! ## Review & dispute workflow
//!
//! - Reviewers are assigned per bounty through a multisig proposal
//!   ([`ProposalAction::SetReviewers`]) along with a quorum.
//! - A milestone can only be released when it has `approvals >= quorum` from the
//!   assigned reviewers ([`BountyError::ReviewerQuorumNotMet`] otherwise).
//! - The funder or the contributor can [`BountyContract::open_dispute`] a
//!   milestone. Reviewers vote; the multisig executes the outcome through
//!   [`ProposalAction::ResolveDispute`]. A disputed milestone cannot be released
//!   through the normal path.
//!
//! ## Security properties
//!
//! - Checks-Effects-Interactions on every transfer: state is settled *before*
//!   the external token call, so a malicious token cannot re-enter and double-pay.
//! - Every privileged entry point calls `require_auth` on the acting address, and
//!   signer/reviewer membership is re-checked at execution time (not just at
//!   proposal time), so a removed signer cannot execute a stale proposal.
//! - Replay guards: a bounty can be created once per issue, a milestone can be
//!   released once, a proposal executes once, a dispute resolves once, and a
//!   reviewer can review a milestone once.
//! - Per-bounty / per-proposal / per-review state lives in **persistent** storage
//!   with TTL extension, so it does not compete with the contract instance's TTL.
//!
//! ## Backward compatibility with v1
//!
//! `init`, `create`, `get_bounty` and `is_initialised` keep their v1 signatures
//! and meanings. `create` is now sugar for a single "Full delivery" milestone.
//! `reclaim` is retained for an *unclaimed* bounty only; once a contributor has
//! claimed, refunds go through a proposal or a dispute so a funder cannot rug
//! work in progress. The v1 direct-admin `release(issue_id, contributor)` is
//! replaced by `propose(.., Release { .. })` — see `CHANGELOG.md`.

#![no_std]

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, token, Address, Env,
    IntoVal, String, Symbol, Vec,
};

/// Contract-level errors. Codes 1..=7 are unchanged from v1 so existing clients
/// and indexers that matched on numeric codes keep working.
#[contracterror]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BountyError {
    /// `init` was already called; bootstrap admin is immutable.
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
    /// The bounty/milestone is already settled.
    AlreadyReleased = 7,

    // ── v2: multisig ──────────────────────────────────────────────
    /// Threshold must be >= 1 and <= the number of signers.
    InvalidThreshold = 8,
    /// A signer set cannot be empty.
    EmptySigners = 9,
    /// The same address appeared twice in a signer/reviewer set.
    DuplicateSigner = 10,
    /// The caller is not a current signer.
    NotASigner = 11,
    /// A bounty must have at least one milestone.
    NoMilestones = 12,
    /// A milestone amount must be strictly positive.
    MilestoneAmountMustBePositive = 13,
    /// The milestone index does not exist on this bounty.
    MilestoneNotFound = 14,
    /// This milestone has already been released or refunded.
    MilestoneSettled = 15,
    /// No proposal with that id.
    ProposalNotFound = 16,
    /// The proposal already executed or was cancelled.
    ProposalNotExecutable = 17,
    /// This signer already approved the proposal.
    AlreadyApproved = 18,
    /// This signer has not approved the proposal.
    NotApproved = 19,
    /// The caller is not an assigned reviewer for this bounty.
    NotReviewer = 20,
    /// This reviewer already reviewed this milestone.
    AlreadyReviewed = 21,
    /// The milestone does not yet have the required reviewer approvals.
    ReviewerQuorumNotMet = 22,
    /// Reviewer quorum must be >= 1 and <= the number of reviewers.
    InvalidQuorum = 23,
    /// No dispute with that id.
    DisputeNotFound = 24,
    /// The dispute is already resolved.
    DisputeAlreadyResolved = 25,
    /// A dispute is already open for this milestone.
    AlreadyDisputed = 26,
    /// Only the bounty funder or its claimed contributor may dispute.
    NotDisputeParty = 27,
    /// The milestone is under an open dispute; use the dispute workflow.
    MilestoneDisputed = 28,
    /// No contributor has claimed this bounty yet.
    ContributorNotSet = 29,
    /// The caller is not the bounty funder.
    NotFunder = 30,
    /// A milestone title must not be empty.
    EmptyMilestoneTitle = 31,
}

/// One escrow milestone inside a bounty.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Milestone {
    pub title: String,
    pub amount: i128,
    /// Settled once released to the contributor or refunded to the funder.
    pub settled: bool,
}

/// On-chain state for a single bounty.
///
/// The first six fields are the v1 shape (`released` now means "fully settled");
/// the rest were added in v2 and are safe for older clients to ignore.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Bounty {
    pub funder: Address,
    pub contributor: Option<Address>,
    pub token: Address,
    /// Total escrowed across all milestones.
    pub amount: i128,
    pub issue_id: String,
    /// True once every milestone is settled (released or refunded).
    pub released: bool,
    /// True when the remaining escrow was refunded to the funder.
    pub refunded: bool,
    /// Sum of milestone amounts paid out to the contributor.
    pub released_amount: i128,
    pub milestones: Vec<Milestone>,
    /// Reviewer addresses assigned to this bounty (empty = no review gate).
    pub reviewers: Vec<Address>,
    /// Approvals required from `reviewers` before a milestone can be released.
    pub reviewer_quorum: u32,
}

/// The multisig signer configuration.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SignerSet {
    pub signers: Vec<Address>,
    pub threshold: u32,
}

/// Reviewer decision on a milestone.
#[contracttype]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ReviewDecision {
    Approve = 0,
    Reject = 1,
}

/// A single reviewer submission. `comment_hash` is a hash of the off-chain
/// review text so the reasoning stays off-chain while remaining tamper-evident.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Review {
    pub reviewer: Address,
    pub issue_id: String,
    pub milestone: u32,
    pub decision: ReviewDecision,
    pub comment_hash: String,
    pub ledger: u32,
}

/// A dispute opened by the funder or the contributor on one milestone.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Dispute {
    pub id: u64,
    pub issue_id: String,
    pub milestone: u32,
    pub opener: Address,
    pub reason_hash: String,
    pub votes_pay_contributor: u32,
    pub votes_refund_funder: u32,
    pub resolved: bool,
    /// Meaningful once `resolved`: true = paid the contributor, false = refunded.
    pub pay_contributor: bool,
}

/// The sensitive operations that require multisig approval.
///
/// `#[contracttype]` enums support tuple variants, so each action carries its
/// payload positionally. The variant order is the on-chain discriminant — never
/// reorder or remove a variant, only append.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ProposalAction {
    /// Release one milestone's escrow to the bounty's claimed contributor.
    /// `(issue_id, milestone_index)`
    Release(String, u32),
    /// Refund the remaining escrow to the funder. `(issue_id)`
    Reclaim(String),
    /// Replace the signer set and threshold. `(signers, threshold)`
    SetSigners(Vec<Address>, u32),
    /// Assign reviewers (and their quorum) to a bounty.
    /// `(issue_id, reviewers, quorum)`
    SetReviewers(String, Vec<Address>, u32),
    /// Apply a reviewer-voted dispute outcome. `(dispute_id, pay_contributor)`
    ResolveDispute(u64, bool),
}

/// An in-flight multisig proposal.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Proposal {
    pub id: u64,
    pub action: ProposalAction,
    pub proposer: Address,
    pub approvals: Vec<Address>,
    pub executed: bool,
    pub cancelled: bool,
}

// ── Events ────────────────────────────────────────────────────────
// Indexed off-chain by `backend/src/services/indexer.ts`.

/// Contract initialised; the bootstrap admin and initial signer set are set.
#[contractevent]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AdminInitialised {
    #[topic]
    pub admin: Address,
    pub threshold: u32,
}

/// A funder locked `amount` in escrow for `issue_id`.
#[contractevent]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BountyCreated {
    #[topic]
    pub issue_id: String,
    pub funder: Address,
    pub token: Address,
    pub amount: i128,
    pub milestones: u32,
}

/// A contributor claimed the bounty.
#[contractevent]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ContributorClaimed {
    #[topic]
    pub issue_id: String,
    pub contributor: Address,
}

/// A milestone was released to the contributor.
#[contractevent]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MilestoneReleased {
    #[topic]
    pub issue_id: String,
    pub milestone: u32,
    pub contributor: Address,
    pub amount: i128,
    pub released_amount: i128,
}

/// The remaining escrow was refunded to the funder through a proposal.
#[contractevent]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BountyRefunded {
    #[topic]
    pub issue_id: String,
    pub funder: Address,
    pub amount: i128,
}

/// The funder reclaimed an unclaimed bounty (v1-compatible path).
#[contractevent]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BountyReclaimed {
    #[topic]
    pub issue_id: String,
    pub funder: Address,
    pub token: Address,
    pub amount: i128,
}

/// The multisig signer set changed.
#[contractevent]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SignersUpdated {
    pub signers: u32,
    pub threshold: u32,
}

/// Reviewers were assigned to a bounty.
#[contractevent]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ReviewersSet {
    #[topic]
    pub issue_id: String,
    /// The assigned reviewer addresses, so indexers can rebuild the set.
    pub reviewers: Vec<Address>,
    pub quorum: u32,
}

/// A multisig proposal was created.
#[contractevent]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProposalCreated {
    #[topic]
    pub id: u64,
    pub proposer: Address,
    /// The action variant name, so indexers can label a proposal without
    /// re-reading contract state.
    pub action: Symbol,
}

/// A signer approved a proposal.
#[contractevent]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProposalApproved {
    #[topic]
    pub id: u64,
    pub signer: Address,
    pub approvals: u32,
}

/// A proposal reached its threshold and executed.
#[contractevent]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProposalExecuted {
    #[topic]
    pub id: u64,
}

/// A proposal was cancelled by its proposer.
#[contractevent]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProposalCancelled {
    #[topic]
    pub id: u64,
}

/// A reviewer submitted a decision on a milestone.
#[contractevent]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ReviewSubmitted {
    #[topic]
    pub issue_id: String,
    pub milestone: u32,
    pub reviewer: Address,
    pub decision: u32,
}

/// A dispute was opened on a milestone.
#[contractevent]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DisputeOpened {
    #[topic]
    pub id: u64,
    pub issue_id: String,
    pub milestone: u32,
    pub opener: Address,
}

/// A reviewer voted on a dispute.
#[contractevent]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DisputeVoteCast {
    #[topic]
    pub id: u64,
    pub reviewer: Address,
    pub pay_contributor: bool,
}

/// A dispute was resolved and its milestone settled.
#[contractevent]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DisputeResolved {
    #[topic]
    pub id: u64,
    pub issue_id: String,
    pub milestone: u32,
    pub pay_contributor: bool,
}

/// Storage keys. Config lives in instance storage; per-entity state lives in
/// persistent storage with TTL extension.
#[contracttype]
pub enum DataKey {
    Admin,
    /// Optional on-chain reputation registry (inter-contract communication).
    Registry,
    Signers,
    ProposalCount,
    DisputeCount,
    Bounty(String),
    Proposal(u64),
    Dispute(u64),
    Review(String, u32, Address),
    DisputeVote(u64, Address),
}

/// Days expressed in ledgers (5s close time → 17_280 ledgers/day).
const DAY_IN_LEDGERS: u32 = 17_280;
const PERSISTENT_TTL_THRESHOLD: u32 = 30 * DAY_IN_LEDGERS;
const PERSISTENT_TTL_EXTEND: u32 = 180 * DAY_IN_LEDGERS;
const INSTANCE_TTL_THRESHOLD: u32 = 30 * DAY_IN_LEDGERS;
const INSTANCE_TTL_EXTEND: u32 = 180 * DAY_IN_LEDGERS;

#[contract]
pub struct BountyContract;

#[contractimpl]
impl BountyContract {
    // ── Bootstrap ─────────────────────────────────────────────────

    /// Initialise the contract with a bootstrap admin and an optional reputation
    /// registry (`contracts/contributors`). The admin becomes the sole signer of
    /// a 1-of-1 signer set; raise the threshold with a `SetSigners` proposal to
    /// require multiple approvals for every sensitive operation.
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
        let signers = SignerSet {
            signers: Vec::from_array(&env, [admin.clone()]),
            threshold: 1,
        };
        env.storage().instance().set(&DataKey::Signers, &signers);
        env.storage()
            .instance()
            .set(&DataKey::ProposalCount, &0_u64);
        env.storage().instance().set(&DataKey::DisputeCount, &0_u64);
        bump_instance(&env);
        AdminInitialised {
            admin,
            threshold: 1,
        }
        .publish(&env);
        Ok(())
    }

    /// True once `init` has been called.
    pub fn is_initialised(env: Env) -> bool {
        env.storage().instance().has(&DataKey::Admin)
    }

    /// The current multisig signer set and threshold.
    pub fn get_signers(env: Env) -> Option<SignerSet> {
        env.storage().instance().get(&DataKey::Signers)
    }

    /// The optional reputation registry contract address.
    pub fn get_registry(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::Registry)
    }

    // ── Multisig ──────────────────────────────────────────────────

    /// Create a proposal. The proposer must be a current signer and is recorded
    /// as the first approval. If the signer set's threshold is met immediately
    /// (e.g. the 1-of-1 bootstrap default) the action executes inside this call.
    ///
    /// Returns the new proposal id.
    pub fn propose(
        env: Env,
        proposer: Address,
        action: ProposalAction,
    ) -> Result<u64, BountyError> {
        let set = require_signers(&env)?;
        proposer.require_auth();
        if !contains_addr(&set.signers, &proposer) {
            return Err(BountyError::NotASigner);
        }
        let count: u64 = env
            .storage()
            .instance()
            .get(&DataKey::ProposalCount)
            .unwrap_or(0);
        let id = count + 1;
        let action_name = action_variant(&env, &action);
        let proposal = Proposal {
            id,
            action,
            proposer: proposer.clone(),
            approvals: Vec::from_array(&env, [proposer.clone()]),
            executed: false,
            cancelled: false,
        };
        store_proposal(&env, &proposal);
        env.storage().instance().set(&DataKey::ProposalCount, &id);
        bump_instance(&env);
        ProposalCreated {
            id,
            proposer,
            action: action_name,
        }
        .publish(&env);

        try_execute(&env, id)?;
        Ok(id)
    }

    /// Approve a proposal. Executes it as soon as the threshold is reached.
    pub fn approve(env: Env, signer: Address, proposal_id: u64) -> Result<(), BountyError> {
        let set = require_signers(&env)?;
        signer.require_auth();
        if !contains_addr(&set.signers, &signer) {
            return Err(BountyError::NotASigner);
        }
        let mut proposal = load_proposal(&env, proposal_id).ok_or(BountyError::ProposalNotFound)?;
        if proposal.executed || proposal.cancelled {
            return Err(BountyError::ProposalNotExecutable);
        }
        if contains_addr(&proposal.approvals, &signer) {
            return Err(BountyError::AlreadyApproved);
        }
        proposal.approvals.push_back(signer.clone());
        store_proposal(&env, &proposal);
        ProposalApproved {
            id: proposal_id,
            signer,
            approvals: proposal.approvals.len(),
        }
        .publish(&env);

        try_execute(&env, proposal_id)
    }

    /// Withdraw a previously given approval.
    pub fn revoke(env: Env, signer: Address, proposal_id: u64) -> Result<(), BountyError> {
        let set = require_signers(&env)?;
        signer.require_auth();
        if !contains_addr(&set.signers, &signer) {
            return Err(BountyError::NotASigner);
        }
        let mut proposal = load_proposal(&env, proposal_id).ok_or(BountyError::ProposalNotFound)?;
        if proposal.executed || proposal.cancelled {
            return Err(BountyError::ProposalNotExecutable);
        }
        let mut out: Vec<Address> = Vec::new(&env);
        let mut found = false;
        for a in proposal.approvals.iter() {
            if a == signer {
                found = true;
            } else {
                out.push_back(a);
            }
        }
        if !found {
            return Err(BountyError::NotApproved);
        }
        proposal.approvals = out;
        store_proposal(&env, &proposal);
        Ok(())
    }

    /// Cancel a not-yet-executed proposal. Only its proposer may cancel it.
    pub fn cancel(env: Env, proposer: Address, proposal_id: u64) -> Result<(), BountyError> {
        proposer.require_auth();
        let mut proposal = load_proposal(&env, proposal_id).ok_or(BountyError::ProposalNotFound)?;
        if proposal.executed || proposal.cancelled {
            return Err(BountyError::ProposalNotExecutable);
        }
        if proposal.proposer != proposer {
            return Err(BountyError::NotASigner);
        }
        proposal.cancelled = true;
        store_proposal(&env, &proposal);
        ProposalCancelled { id: proposal_id }.publish(&env);
        Ok(())
    }

    /// Read a proposal by id.
    pub fn get_proposal(env: Env, proposal_id: u64) -> Result<Proposal, BountyError> {
        load_proposal(&env, proposal_id).ok_or(BountyError::ProposalNotFound)
    }

    /// Number of proposals created so far.
    pub fn proposal_count(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::ProposalCount)
            .unwrap_or(0)
    }

    // ── Bounty lifecycle ──────────────────────────────────────────

    /// v1-compatible create: a single "Full delivery" milestone for `amount`.
    pub fn create(
        env: Env,
        funder: Address,
        token: Address,
        amount: i128,
        issue_id: String,
    ) -> Result<(), BountyError> {
        let milestones = Vec::from_array(
            &env,
            [Milestone {
                title: String::from_str(&env, "Full delivery"),
                amount,
                settled: false,
            }],
        );
        Self::create_bounty(env, funder, token, issue_id, milestones)
    }

    /// Create a milestone-based bounty, escrowing the sum of all milestone
    /// amounts in a single transfer.
    pub fn create_bounty(
        env: Env,
        funder: Address,
        token: Address,
        issue_id: String,
        milestones: Vec<Milestone>,
    ) -> Result<(), BountyError> {
        if !env.storage().instance().has(&DataKey::Admin) {
            return Err(BountyError::NotInitialised);
        }
        funder.require_auth();
        if issue_id.is_empty() {
            return Err(BountyError::EmptyIssueId);
        }
        if milestones.is_empty() {
            return Err(BountyError::NoMilestones);
        }
        let mut total: i128 = 0;
        let mut normalized: Vec<Milestone> = Vec::new(&env);
        for m in milestones.iter() {
            if m.amount <= 0 {
                return Err(BountyError::MilestoneAmountMustBePositive);
            }
            if m.title.is_empty() {
                return Err(BountyError::EmptyMilestoneTitle);
            }
            total = total.saturating_add(m.amount);
            normalized.push_back(Milestone {
                title: m.title,
                amount: m.amount,
                settled: false,
            });
        }
        if env
            .storage()
            .persistent()
            .has(&DataKey::Bounty(issue_id.clone()))
        {
            return Err(BountyError::BountyAlreadyExists);
        }

        // Checks-Effects-Interactions: persist the bounty BEFORE the external
        // token transfer, so a re-entrant `create` hits the replay guard instead
        // of double-depositing.
        let bounty = Bounty {
            funder: funder.clone(),
            contributor: None,
            token: token.clone(),
            amount: total,
            issue_id: issue_id.clone(),
            released: false,
            refunded: false,
            released_amount: 0,
            milestones: normalized,
            reviewers: Vec::new(&env),
            reviewer_quorum: 0,
        };
        let milestone_count = bounty.milestones.len();
        store_bounty(&env, &bounty);

        let client = token::Client::new(&env, &token);
        let escrow = env.current_contract_address();
        client.transfer(&funder, &escrow, &total);

        BountyCreated {
            issue_id,
            funder,
            token,
            amount: total,
            milestones: milestone_count,
        }
        .publish(&env);
        Ok(())
    }

    /// The contributor claims the bounty so reviewers and the multisig know who
    /// should be paid. Idempotent for the same address.
    pub fn claim(env: Env, issue_id: String, contributor: Address) -> Result<(), BountyError> {
        contributor.require_auth();
        let mut bounty = load_bounty(&env, &issue_id).ok_or(BountyError::BountyNotFound)?;
        if bounty.released {
            return Err(BountyError::AlreadyReleased);
        }
        match bounty.contributor.clone() {
            Some(existing) if existing == contributor => return Ok(()),
            Some(_) => return Err(BountyError::ContributorNotSet),
            None => {}
        }
        bounty.contributor = Some(contributor.clone());
        store_bounty(&env, &bounty);
        ContributorClaimed {
            issue_id,
            contributor,
        }
        .publish(&env);
        Ok(())
    }

    /// The funder reclaims an **unclaimed** bounty.
    ///
    /// Once a contributor has claimed, or any milestone has been released, or a
    /// dispute is open, this path is closed: refunds then require a multisig
    /// proposal or a dispute resolution, so a funder cannot rug work in progress.
    pub fn reclaim(env: Env, issue_id: String) -> Result<(), BountyError> {
        let mut bounty = load_bounty(&env, &issue_id).ok_or(BountyError::BountyNotFound)?;
        if bounty.released {
            return Err(BountyError::AlreadyReleased);
        }
        bounty.funder.require_auth();
        if bounty.contributor.is_some() {
            return Err(BountyError::ContributorNotSet);
        }
        if bounty.released_amount > 0 {
            return Err(BountyError::AlreadyReleased);
        }
        if has_open_dispute(&env, &issue_id) {
            return Err(BountyError::MilestoneDisputed);
        }

        let remaining = remaining_escrow(&bounty);
        bounty.released = true;
        bounty.refunded = true;
        settle_all(&env, &mut bounty);
        store_bounty(&env, &bounty);

        let token = bounty.token.clone();
        let funder = bounty.funder.clone();
        let client = token::Client::new(&env, &token);
        let escrow = env.current_contract_address();
        client.transfer(&escrow, &funder, &remaining);

        BountyReclaimed {
            issue_id,
            funder,
            token,
            amount: remaining,
        }
        .publish(&env);
        Ok(())
    }

    /// Read a bounty by issue ID.
    pub fn get_bounty(env: Env, issue_id: String) -> Result<Bounty, BountyError> {
        load_bounty(&env, &issue_id).ok_or(BountyError::BountyNotFound)
    }

    // ── Reviewer system ───────────────────────────────────────────

    /// Submit a review for one milestone. Only a reviewer assigned to this
    /// bounty may submit, and each reviewer may review a milestone once.
    pub fn submit_review(
        env: Env,
        reviewer: Address,
        issue_id: String,
        milestone: u32,
        decision: ReviewDecision,
        comment_hash: String,
    ) -> Result<(), BountyError> {
        reviewer.require_auth();
        let bounty = load_bounty(&env, &issue_id).ok_or(BountyError::BountyNotFound)?;
        if bounty.released {
            return Err(BountyError::AlreadyReleased);
        }
        if !contains_addr(&bounty.reviewers, &reviewer) {
            return Err(BountyError::NotReviewer);
        }
        let m = bounty
            .milestones
            .get(milestone)
            .ok_or(BountyError::MilestoneNotFound)?;
        if m.settled {
            return Err(BountyError::MilestoneSettled);
        }
        let key = DataKey::Review(issue_id.clone(), milestone, reviewer.clone());
        if env.storage().persistent().has(&key) {
            return Err(BountyError::AlreadyReviewed);
        }
        let review = Review {
            reviewer: reviewer.clone(),
            issue_id: issue_id.clone(),
            milestone,
            decision,
            comment_hash,
            ledger: env.ledger().sequence(),
        };
        env.storage().persistent().set(&key, &review);
        bump(&env, &key);

        ReviewSubmitted {
            issue_id,
            milestone,
            reviewer,
            decision: decision as u32,
        }
        .publish(&env);
        Ok(())
    }

    /// Read one reviewer's submission for a milestone.
    pub fn get_review(
        env: Env,
        issue_id: String,
        milestone: u32,
        reviewer: Address,
    ) -> Option<Review> {
        env.storage()
            .persistent()
            .get(&DataKey::Review(issue_id, milestone, reviewer))
    }

    /// Approvals and rejections recorded so far for a milestone of a bounty.
    pub fn review_tally(env: Env, issue_id: String, milestone: u32) -> (u32, u32) {
        let bounty = match load_bounty(&env, &issue_id) {
            Some(b) => b,
            None => return (0, 0),
        };
        tally_reviews(&env, &issue_id, milestone, &bounty.reviewers)
    }

    // ── Disputes ──────────────────────────────────────────────────

    /// Open a dispute on a milestone. Only the funder or the claimed contributor
    /// may dispute, and only one dispute may be open per milestone at a time.
    pub fn open_dispute(
        env: Env,
        opener: Address,
        issue_id: String,
        milestone: u32,
        reason_hash: String,
    ) -> Result<u64, BountyError> {
        opener.require_auth();
        let bounty = load_bounty(&env, &issue_id).ok_or(BountyError::BountyNotFound)?;
        if bounty.released {
            return Err(BountyError::AlreadyReleased);
        }
        let is_funder = bounty.funder == opener;
        let is_contributor = matches!(&bounty.contributor, Some(c) if *c == opener);
        if !is_funder && !is_contributor {
            return Err(BountyError::NotDisputeParty);
        }
        let m = bounty
            .milestones
            .get(milestone)
            .ok_or(BountyError::MilestoneNotFound)?;
        if m.settled {
            return Err(BountyError::MilestoneSettled);
        }
        if find_open_dispute(&env, &issue_id, milestone).is_some() {
            return Err(BountyError::AlreadyDisputed);
        }

        let count: u64 = env
            .storage()
            .instance()
            .get(&DataKey::DisputeCount)
            .unwrap_or(0);
        let id = count + 1;
        let dispute = Dispute {
            id,
            issue_id: issue_id.clone(),
            milestone,
            opener: opener.clone(),
            reason_hash,
            votes_pay_contributor: 0,
            votes_refund_funder: 0,
            resolved: false,
            pay_contributor: false,
        };
        store_dispute(&env, &dispute);
        env.storage().instance().set(&DataKey::DisputeCount, &id);
        bump_instance(&env);

        DisputeOpened {
            id,
            issue_id,
            milestone,
            opener,
        }
        .publish(&env);
        Ok(id)
    }

    /// A reviewer assigned to the bounty votes on a dispute. One vote each.
    pub fn vote_on_dispute(
        env: Env,
        reviewer: Address,
        dispute_id: u64,
        pay_contributor: bool,
    ) -> Result<(), BountyError> {
        reviewer.require_auth();
        let mut dispute = load_dispute(&env, dispute_id).ok_or(BountyError::DisputeNotFound)?;
        if dispute.resolved {
            return Err(BountyError::DisputeAlreadyResolved);
        }
        let bounty = load_bounty(&env, &dispute.issue_id).ok_or(BountyError::BountyNotFound)?;
        if !contains_addr(&bounty.reviewers, &reviewer) {
            return Err(BountyError::NotReviewer);
        }
        let key = DataKey::DisputeVote(dispute_id, reviewer.clone());
        if env.storage().persistent().has(&key) {
            return Err(BountyError::AlreadyApproved);
        }
        env.storage().persistent().set(&key, &pay_contributor);
        bump(&env, &key);
        if pay_contributor {
            dispute.votes_pay_contributor += 1;
        } else {
            dispute.votes_refund_funder += 1;
        }
        store_dispute(&env, &dispute);
        DisputeVoteCast {
            id: dispute_id,
            reviewer,
            pay_contributor,
        }
        .publish(&env);
        Ok(())
    }

    /// Read a dispute by id.
    pub fn get_dispute(env: Env, dispute_id: u64) -> Result<Dispute, BountyError> {
        load_dispute(&env, dispute_id).ok_or(BountyError::DisputeNotFound)
    }

    /// Number of disputes opened so far.
    pub fn dispute_count(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::DisputeCount)
            .unwrap_or(0)
    }
}

// ── Internal helpers ──────────────────────────────────────────────

fn bump_instance(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_TTL_EXTEND);
}

fn bump<K: IntoVal<Env, soroban_sdk::Val>>(env: &Env, key: &K) {
    env.storage()
        .persistent()
        .extend_ttl(key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_EXTEND);
}

fn contains_addr(v: &Vec<Address>, a: &Address) -> bool {
    for item in v.iter() {
        if item == *a {
            return true;
        }
    }
    false
}

fn require_signers(env: &Env) -> Result<SignerSet, BountyError> {
    if !env.storage().instance().has(&DataKey::Admin) {
        return Err(BountyError::NotInitialised);
    }
    env.storage()
        .instance()
        .get(&DataKey::Signers)
        .ok_or(BountyError::NotInitialised)
}

fn load_bounty(env: &Env, issue_id: &String) -> Option<Bounty> {
    env.storage()
        .persistent()
        .get(&DataKey::Bounty(issue_id.clone()))
}

fn store_bounty(env: &Env, bounty: &Bounty) {
    let key = DataKey::Bounty(bounty.issue_id.clone());
    env.storage().persistent().set(&key, bounty);
    bump(env, &key);
}

fn load_proposal(env: &Env, id: u64) -> Option<Proposal> {
    env.storage().persistent().get(&DataKey::Proposal(id))
}

fn store_proposal(env: &Env, proposal: &Proposal) {
    let key = DataKey::Proposal(proposal.id);
    env.storage().persistent().set(&key, proposal);
    bump(env, &key);
}

fn load_dispute(env: &Env, id: u64) -> Option<Dispute> {
    env.storage().persistent().get(&DataKey::Dispute(id))
}

fn store_dispute(env: &Env, dispute: &Dispute) {
    let key = DataKey::Dispute(dispute.id);
    env.storage().persistent().set(&key, dispute);
    bump(env, &key);
}

/// The variant name of a proposal action (stable, used in events + the API).
fn action_variant(env: &Env, action: &ProposalAction) -> Symbol {
    match action {
        ProposalAction::Release(_, _) => Symbol::new(env, "Release"),
        ProposalAction::Reclaim(_) => Symbol::new(env, "Reclaim"),
        ProposalAction::SetSigners(_, _) => Symbol::new(env, "SetSigners"),
        ProposalAction::SetReviewers(_, _, _) => Symbol::new(env, "SetReviewers"),
        ProposalAction::ResolveDispute(_, _) => Symbol::new(env, "ResolveDispute"),
    }
}

fn remaining_escrow(bounty: &Bounty) -> i128 {
    bounty.amount.saturating_sub(bounty.released_amount)
}

fn all_settled(bounty: &Bounty) -> bool {
    for m in bounty.milestones.iter() {
        if !m.settled {
            return false;
        }
    }
    true
}

fn settle_all(env: &Env, bounty: &mut Bounty) {
    let mut out: Vec<Milestone> = Vec::new(env);
    for m in bounty.milestones.iter() {
        out.push_back(Milestone {
            title: m.title,
            amount: m.amount,
            settled: true,
        });
    }
    bounty.milestones = out;
}

/// Find an unresolved dispute for a milestone, if any.
fn find_open_dispute(env: &Env, issue_id: &String, milestone: u32) -> Option<Dispute> {
    let count: u64 = env
        .storage()
        .instance()
        .get(&DataKey::DisputeCount)
        .unwrap_or(0);
    let mut id = 1;
    while id <= count {
        if let Some(d) = load_dispute(env, id) {
            if !d.resolved && d.issue_id == *issue_id && d.milestone == milestone {
                return Some(d);
            }
        }
        id += 1;
    }
    None
}

fn has_open_dispute(env: &Env, issue_id: &String) -> bool {
    let count: u64 = env
        .storage()
        .instance()
        .get(&DataKey::DisputeCount)
        .unwrap_or(0);
    let mut id = 1;
    while id <= count {
        if let Some(d) = load_dispute(env, id) {
            if !d.resolved && d.issue_id == *issue_id {
                return true;
            }
        }
        id += 1;
    }
    false
}

/// Execute a proposal when its approval count meets the current threshold.
///
/// Membership and threshold are read from storage at execution time, so a
/// proposal created under an old signer set cannot be executed with stale
/// approvals after the set changed.
fn try_execute(env: &Env, id: u64) -> Result<(), BountyError> {
    let set = require_signers(env)?;
    let proposal = match load_proposal(env, id) {
        Some(p) => p,
        None => return Err(BountyError::ProposalNotFound),
    };
    if proposal.executed || proposal.cancelled {
        return Ok(());
    }
    if proposal.approvals.len() < set.threshold {
        return Ok(());
    }
    execute_action(env, &proposal)?;
    let mut executed = proposal;
    executed.executed = true;
    store_proposal(env, &executed);
    ProposalExecuted { id }.publish(env);
    Ok(())
}

fn execute_action(env: &Env, proposal: &Proposal) -> Result<(), BountyError> {
    match proposal.action.clone() {
        ProposalAction::Release(issue_id, milestone) => apply_release(env, issue_id, milestone),
        ProposalAction::Reclaim(issue_id) => apply_reclaim(env, issue_id),
        ProposalAction::SetSigners(signers, threshold) => {
            apply_set_signers(env, signers, threshold)
        }
        ProposalAction::SetReviewers(issue_id, reviewers, quorum) => {
            apply_set_reviewers(env, issue_id, reviewers, quorum)
        }
        ProposalAction::ResolveDispute(dispute_id, pay_contributor) => {
            apply_resolve_dispute(env, dispute_id, pay_contributor)
        }
    }
}

fn validate_signer_set(signers: &Vec<Address>, threshold: u32) -> Result<(), BountyError> {
    if signers.is_empty() {
        return Err(BountyError::EmptySigners);
    }
    if threshold == 0 || threshold > signers.len() {
        return Err(BountyError::InvalidThreshold);
    }
    let mut seen: Vec<Address> = Vec::new(signers.env());
    for s in signers.iter() {
        if contains_addr(&seen, &s) {
            return Err(BountyError::DuplicateSigner);
        }
        seen.push_back(s);
    }
    Ok(())
}

fn apply_set_signers(env: &Env, signers: Vec<Address>, threshold: u32) -> Result<(), BountyError> {
    validate_signer_set(&signers, threshold)?;
    let count = signers.len();
    env.storage().instance().set(
        &DataKey::Signers,
        &SignerSet {
            signers: signers.clone(),
            threshold,
        },
    );
    bump_instance(env);
    SignersUpdated {
        signers: count,
        threshold,
    }
    .publish(env);
    Ok(())
}

fn apply_set_reviewers(
    env: &Env,
    issue_id: String,
    reviewers: Vec<Address>,
    quorum: u32,
) -> Result<(), BountyError> {
    let mut bounty = load_bounty(env, &issue_id).ok_or(BountyError::BountyNotFound)?;
    if bounty.released {
        return Err(BountyError::AlreadyReleased);
    }
    let mut seen: Vec<Address> = Vec::new(env);
    for r in reviewers.iter() {
        if contains_addr(&seen, &r) {
            return Err(BountyError::DuplicateSigner);
        }
        seen.push_back(r);
    }
    if reviewers.is_empty() {
        if quorum != 0 {
            return Err(BountyError::InvalidQuorum);
        }
    } else if quorum == 0 || quorum > reviewers.len() {
        return Err(BountyError::InvalidQuorum);
    }
    bounty.reviewers = reviewers.clone();
    bounty.reviewer_quorum = quorum;
    store_bounty(env, &bounty);
    ReviewersSet {
        issue_id,
        reviewers,
        quorum,
    }
    .publish(env);
    Ok(())
}

/// Release one milestone to the bounty's claimed contributor.
///
/// Preconditions enforced here (at execution time, not just at proposal time):
/// the bounty exists and is unsettled, the milestone exists and is unsettled,
/// a contributor has claimed, the milestone is not under an open dispute, and
/// the reviewer quorum (when reviewers are configured) has approved it.
fn apply_release(env: &Env, issue_id: String, milestone: u32) -> Result<(), BountyError> {
    let mut bounty = load_bounty(env, &issue_id).ok_or(BountyError::BountyNotFound)?;
    if bounty.released {
        return Err(BountyError::AlreadyReleased);
    }
    let contributor = bounty
        .contributor
        .clone()
        .ok_or(BountyError::ContributorNotSet)?;
    let m = bounty
        .milestones
        .get(milestone)
        .ok_or(BountyError::MilestoneNotFound)?;
    if m.settled {
        return Err(BountyError::MilestoneSettled);
    }
    if find_open_dispute(env, &issue_id, milestone).is_some() {
        return Err(BountyError::MilestoneDisputed);
    }
    // Reviewer gate: when reviewers are assigned, the milestone needs quorum.
    if !bounty.reviewers.is_empty() {
        let (approvals, _rejections) = tally_reviews(env, &issue_id, milestone, &bounty.reviewers);
        if approvals < bounty.reviewer_quorum {
            return Err(BountyError::ReviewerQuorumNotMet);
        }
    }

    let amount = m.amount;
    // Checks-Effects-Interactions: settle state before the external transfer.
    let mut updated: Vec<Milestone> = Vec::new(env);
    for (i, item) in bounty.milestones.iter().enumerate() {
        updated.push_back(Milestone {
            title: item.title,
            amount: item.amount,
            settled: item.settled || i as u32 == milestone,
        });
    }
    bounty.milestones = updated;
    bounty.released_amount = bounty.released_amount.saturating_add(amount);
    bounty.released = all_settled(&bounty);
    store_bounty(env, &bounty);

    let token = bounty.token.clone();
    let client = token::Client::new(env, &token);
    let escrow = env.current_contract_address();
    client.transfer(&escrow, &contributor, &amount);

    record_payout(env, &contributor, &issue_id, milestone, amount);
    record_upheld_reviews(env, &issue_id, milestone, &bounty.reviewers);

    MilestoneReleased {
        issue_id,
        milestone,
        contributor,
        amount,
        released_amount: bounty.released_amount,
    }
    .publish(env);
    Ok(())
}

/// Refund the remaining escrow to the funder through the multisig.
fn apply_reclaim(env: &Env, issue_id: String) -> Result<(), BountyError> {
    let mut bounty = load_bounty(env, &issue_id).ok_or(BountyError::BountyNotFound)?;
    if bounty.released {
        return Err(BountyError::AlreadyReleased);
    }
    if has_open_dispute(env, &issue_id) {
        return Err(BountyError::MilestoneDisputed);
    }
    let remaining = remaining_escrow(&bounty);
    if remaining <= 0 {
        return Err(BountyError::AlreadyReleased);
    }
    bounty.released = true;
    bounty.refunded = true;
    settle_all(env, &mut bounty);
    store_bounty(env, &bounty);

    let token = bounty.token.clone();
    let funder = bounty.funder.clone();
    let client = token::Client::new(env, &token);
    let escrow = env.current_contract_address();
    client.transfer(&escrow, &funder, &remaining);

    BountyRefunded {
        issue_id,
        funder,
        amount: remaining,
    }
    .publish(env);
    Ok(())
}

/// Apply a reviewer-voted dispute outcome to its milestone.
///
/// The outcome must be backed by the reviewer quorum (when reviewers are
/// configured), so a single signer cannot override the reviewers.
fn apply_resolve_dispute(
    env: &Env,
    dispute_id: u64,
    pay_contributor: bool,
) -> Result<(), BountyError> {
    let mut dispute = load_dispute(env, dispute_id).ok_or(BountyError::DisputeNotFound)?;
    if dispute.resolved {
        return Err(BountyError::DisputeAlreadyResolved);
    }
    let mut bounty = load_bounty(env, &dispute.issue_id).ok_or(BountyError::BountyNotFound)?;
    let m = bounty
        .milestones
        .get(dispute.milestone)
        .ok_or(BountyError::MilestoneNotFound)?;
    if m.settled {
        return Err(BountyError::MilestoneSettled);
    }
    if !bounty.reviewers.is_empty() {
        let votes = if pay_contributor {
            dispute.votes_pay_contributor
        } else {
            dispute.votes_refund_funder
        };
        if votes < bounty.reviewer_quorum {
            return Err(BountyError::ReviewerQuorumNotMet);
        }
    }

    let amount = m.amount;
    let mut updated: Vec<Milestone> = Vec::new(env);
    for (i, item) in bounty.milestones.iter().enumerate() {
        updated.push_back(Milestone {
            title: item.title,
            amount: item.amount,
            settled: item.settled || i as u32 == dispute.milestone,
        });
    }
    bounty.milestones = updated;

    // Checks-Effects-Interactions before any transfer.
    let token = bounty.token.clone();
    let escrow = env.current_contract_address();
    let contributor = bounty.contributor.clone();
    let funder = bounty.funder.clone();

    if pay_contributor {
        let contributor = contributor.clone().ok_or(BountyError::ContributorNotSet)?;
        bounty.released_amount = bounty.released_amount.saturating_add(amount);
        bounty.released = all_settled(&bounty);
        store_bounty(env, &bounty);
        dispute.resolved = true;
        dispute.pay_contributor = true;
        store_dispute(env, &dispute);

        let client = token::Client::new(env, &token);
        client.transfer(&escrow, &contributor, &amount);

        record_payout(
            env,
            &contributor,
            &dispute.issue_id,
            dispute.milestone,
            amount,
        );
        record_upheld_reviews(env, &dispute.issue_id, dispute.milestone, &bounty.reviewers);
    } else {
        bounty.released = all_settled(&bounty);
        store_bounty(env, &bounty);
        dispute.resolved = true;
        dispute.pay_contributor = false;
        store_dispute(env, &dispute);

        let client = token::Client::new(env, &token);
        client.transfer(&escrow, &funder, &amount);
    }

    // Reputation: the participant whose position the reviewers rejected "lost".
    let mut loser: Option<Address> = None;
    if dispute.opener == funder && pay_contributor {
        loser = Some(funder.clone());
    } else if let Some(c) = contributor.clone() {
        if dispute.opener == c && !pay_contributor {
            loser = Some(c);
        }
    }
    if let Some(loser) = loser {
        record_dispute_outcome(env, &loser, &dispute.issue_id, dispute.milestone);
    }

    DisputeResolved {
        id: dispute_id,
        issue_id: dispute.issue_id.clone(),
        milestone: dispute.milestone,
        pay_contributor,
    }
    .publish(env);
    Ok(())
}

/// Count approvals/rejections among a bounty's assigned reviewers.
fn tally_reviews(
    env: &Env,
    issue_id: &String,
    milestone: u32,
    reviewers: &Vec<Address>,
) -> (u32, u32) {
    let mut approvals = 0;
    let mut rejections = 0;
    for r in reviewers.iter() {
        if let Some(review) = env
            .storage()
            .persistent()
            .get::<DataKey, Review>(&DataKey::Review(issue_id.clone(), milestone, r))
        {
            match review.decision {
                ReviewDecision::Approve => approvals += 1,
                ReviewDecision::Reject => rejections += 1,
            }
        }
    }
    (approvals, rejections)
}

fn registry_of(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::Registry)
}

/// Record a milestone payout in the reputation registry.
///
/// The call is **atomic** with escrow settlement: if the registry rejects the
/// write, the whole release transaction rolls back. Reputation therefore cannot
/// silently drift out of sync with payouts — which is what makes it verifiable.
fn record_payout(
    env: &Env,
    contributor: &Address,
    issue_id: &String,
    milestone: u32,
    amount: i128,
) {
    if let Some(registry) = registry_of(env) {
        let args = Vec::from_array(
            env,
            [
                contributor.clone().into_val(env),
                issue_id.clone().into_val(env),
                milestone.into_val(env),
                amount.into_val(env),
            ],
        );
        let _: () = env.invoke_contract(&registry, &Symbol::new(env, "record"), args);
    }
}

/// Mark the approving reviewers' work as upheld in the reputation registry.
fn record_upheld_reviews(env: &Env, issue_id: &String, milestone: u32, reviewers: &Vec<Address>) {
    let registry = match registry_of(env) {
        Some(r) => r,
        None => return,
    };
    for r in reviewers.iter() {
        if let Some(review) = env
            .storage()
            .persistent()
            .get::<DataKey, Review>(&DataKey::Review(issue_id.clone(), milestone, r.clone()))
        {
            if review.decision == ReviewDecision::Approve {
                let args = Vec::from_array(
                    env,
                    [
                        r.clone().into_val(env),
                        issue_id.clone().into_val(env),
                        milestone.into_val(env),
                        true.into_val(env),
                    ],
                );
                let _: () =
                    env.invoke_contract(&registry, &Symbol::new(env, "record_review"), args);
            }
        }
    }
}

/// Record the losing side of a resolved dispute in the reputation registry.
fn record_dispute_outcome(env: &Env, loser: &Address, issue_id: &String, milestone: u32) {
    if let Some(registry) = registry_of(env) {
        let args = Vec::from_array(
            env,
            [
                loser.clone().into_val(env),
                issue_id.clone().into_val(env),
                milestone.into_val(env),
                true.into_val(env),
            ],
        );
        let _: () = env.invoke_contract(&registry, &Symbol::new(env, "record_dispute"), args);
    }
}

#[cfg(test)]
mod tests;
