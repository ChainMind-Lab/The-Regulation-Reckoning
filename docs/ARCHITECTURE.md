# Architecture

The Regulation Reckoning is a Soroban bounty platform where **Stellar Testnet is the
source of truth** for bounty and event data. The backend maintains a SQLite read-model
built from on-chain events plus a documented data-ingestion pipeline; the React
dashboard is a thin client over the backend API.

## System diagram

```
                        ┌────────────────────────────────────────────┐
                        │              Stellar Testnet               │
                        │                                            │
  Freighter wallet ─────┤  Soroban RPC (soroban-testnet.stellar.org) │
  (browser, signs XDR)  │  · bounty contract CB4OI57Y…QLWT            │
                        │  · contributors registry CC53MJDM…W4W7Q     │
                        │  · RRD token CB7NFW2W…A6Y6P                 │
                        │  Horizon (network status, payments)        │
                        │  (bounty → registry: env.invoke_contract  │
                        │   records payouts on release)              │
                        └──────┬────────────────────────┬────────────┘
                               │                        │
        POST /api/tx/build     │                        │ getEvents() (ledger cursor)
        POST /api/tx/submit    │                        ▼
                        ┌──────▼──────────────┐  ┌──────────────────┐
                        │  Express API        │  │  Event indexer   │
                        │  (backend/src)      │  │  (services/      │
                        └──────┬──────────────┘  │   indexer.ts)    │
                               │                 └────────┬─────────┘
                               │                          │ upsert
                               ▼                          ▼
                        ┌───────────────────────────────────────────┐
                        │  SQLite read-model (node:sqlite)          │
                        │  · bounty + milestone read-model          │
                        │  · soroban_events (raw indexed events)    │
                        │  · policies, revisions + alerts           │
                        └───────────────────┬───────────────────────┘
                                            │
    GET /api/bounties, /api/events,         ▼
    /api/policies, /api/analytics   ┌────────────────┐
    ───────────────────────────────▶│  React dashboard │
                                    │  (src/)          │
                                    └────────────────┘
```

## Components

### Soroban contracts

#### Bounty escrow (`contracts/bounty`)

Escrow is **milestone-based**, and privileged changes go through **multisig
governance**:

- `init(admin, signers, threshold, registry)` — one-time bootstrap: admin, initial
  signer set/threshold and the registry contract ID. Emits `admin_initialised`.
- `create(funder, token, amount, issue_id)` / `create_bounty(funder, token, issue_id,
  milestones)` — lock funds in escrow (a single amount, or 1–20 per-milestone amounts).
  Emits `bounty_created`.
- `claim(issue_id, contributor)` — a contributor claims the bounty. Emits
  `contributor_claimed`.
- `submit_review(reviewer, issue_id, milestone, decision, comment_hash)` — an assigned
  reviewer records an approve/reject decision. Emits `review_submitted`.
- `open_dispute(opener, issue_id, milestone, reason_hash)` and
  `vote_on_dispute(reviewer, dispute_id, pay_contributor)` — open and vote on a dispute.
  Emit `dispute_opened` / `dispute_vote_cast`.
- `propose(proposer, action)` → `approve` / `revoke` / `cancel` — multisig proposals for
  `Release`, `Reclaim`, `SetSigners`, `SetReviewers` and `ResolveDispute`. A proposal
  executes once `threshold` signers approve, emitting `proposal_created`,
  `proposal_approved`, `proposal_executed` and `proposal_cancelled`. On release the
  contract **invokes the contributors registry** (inter-contract call) and emits
  `milestone_released`.
- `reclaim(issue_id)` — funder-only direct refund of an unclaimed bounty (emits
  `bounty_reclaimed`); a `Reclaim` proposal refunds the *remaining* escrow of a claimed
  bounty (emits `bounty_refunded`).
- Reads: `get_bounty`, `get_proposal`/`proposal_count`, `get_review`/`review_tally`,
  `get_dispute`/`dispute_count`, `get_signers`, `get_registry`.

All state changes emit typed events (Soroban `#[contractevent]`), which the indexer
consumes. The contract has 47 tests covering authorization, validation, idempotency
(re-creating/releasing/reclaiming is a no-op error, never a double spend), milestone and
reviewer-quorum rules, disputes, multisig proposals, events, and the inter-contract
registry writes. Bounty, milestone, review, dispute and proposal entries live in
**persistent** storage with TTL extension — only the admin/signer configuration uses
instance storage.

#### Contributors registry (`contracts/contributors`)

- `init(admin, allowed_caller)` — one-time bootstrap: the admin (retained for future
  ops) and the only contract allowed to write.
- `record(contributor, issue_id, amount)` — requires the allowed caller's auth (the
  bounty contract). Emits `contributor_recorded`.
- `record_review(subject, upheld)` / `record_dispute(subject, won)` — record upheld
  reviews and won/lost disputes. Emit `review_recorded` / `dispute_recorded`.
- `stats(address)` — `{ count, total }`; `reputation(address)` / `score(address)` expose
  the derived 0–1000 reputation; `total_contributors()`, `allowed_caller()`,
  `is_initialised()` are public reads.

The registry gives payout history and reputation an on-chain home outside the bounty
contract and is read live by the backend (`GET /api/contributors/:address`,
`GET /api/reputation/:address`). It has 18 tests covering authorization (direct callers
rejected), validation, accumulation math, review/dispute accounting, the score formula,
and events.

### Backend (`backend/`)

- **`services/soroban.ts`** — RPC client. Builds and simulates Soroban transactions
  (`buildContractTransaction`), submits wallet-signed XDR and waits for inclusion
  (`submitSignedTransaction`), reads live state (`readBounty`, `readBountyV2`,
  `readProposal`, `readDispute`, `readSigners`, `readReputation`, `readContributorStats`),
  and fetches contract events with a ledger cursor (`fetchContractEvents`). Reads the
  **bounty and registry** contracts. Uses raw JSON-RPC for `getTransaction` polling to
  stay XDR-version independent. On-chain reads distinguish "not found" (contract error
  #6) from an upstream failure, which is surfaced as `502`.
- **`services/indexer.ts`** — polls both contracts for new events and upserts them into
  `soroban_events` (keyed by the RPC event id, so replays are no-ops), then rebuilds the
  `bounties`, `milestones`, `reviews`, `bounty_reviewers`, `proposals`, `disputes` and
  `reputation` read-model tables from those events. Cursor-based, with ledger-gap
  detection.
- **`services/ingest/`** — the regulatory data pipeline (see `docs/DATA.md`):
  validates, classifies, and idempotently upserts `regulatory_events` and `issues`.
- **`services/regulations.ts`** — content-hashes each policy on every ingestion run,
  appends immutable revisions to `regulation_versions`, computes field-level diffs and
  raises severity-classified `regulation_alerts`.
- **`services/jurisdictions.ts`** — per-jurisdiction profiles and comparisons over the
  ingested dataset, reusing the documented category weights; every figure carries its
  primary sources.
- **`services/reputation.ts`** — the indexed reputation mirror, the leaderboard, and the
  normaliser that gives on-chain and indexed reputation one JSON shape.
- **`services/analytics.ts`** — deterministic aggregates over the ingested dataset
  (jurisdiction/category/severity/year distributions, a documented risk index).
- **`middleware/rateLimit.ts`** — per-IP fixed-window rate limiting (set
  `TRUST_PROXY=true` behind a reverse proxy so it keys on real client IPs).
- **`middleware/error.ts`** — central error handler mapping `ApiError` to JSON
  `{ error, code }` responses.
- **`db.ts`** — `node:sqlite` schema and prepared statements.

### Frontend (`src/`)

- **`lib/api.ts`** — typed client for the backend REST API.
- **`lib/wallet.ts`** — Freighter integration: connect, detect availability, sign
  transaction XDR, and detect wrong-network state. The frontend never holds a secret key.
- **`components/VerificationPanel.tsx`** — on-chain verification: deployed contract
  IDs, admin, network, and successful transaction history with copy buttons and
  explorer links.
- **`components/BountyForm.tsx`** — the wallet flow: `POST /api/tx/build` →
  `signTransactionXdr` in Freighter → `POST /api/tx/submit` → refresh.
- **`components/EventsFeed.tsx`** — indexed on-chain events with explorer links.
- **`components/PolicyPanel.tsx`** — ingested regulatory data + analytics tiles,
  policy timeline chart, jurisdiction risk heat map, ecosystem-impact and
  survival-signal aggregations.
- **`components/MilestonePanel.tsx`** — milestone escrow state, reviewer tallies, and the
  proposal/review/dispute actions a participant can take.
- **`components/GovernancePanel.tsx`** — the live signer set/threshold and pending
  multisig proposals (approve / revoke / cancel).
- **`components/JurisdictionPanel.tsx`** — side-by-side jurisdiction comparison with
  per-cell sources.
- **`components/RegulationHistoryPanel.tsx`** — regulation revision history, field-level
  diffs, and change alerts (with acknowledgement).
- **`components/ReputationPanel.tsx`** — verifiable reputation lookup (on-chain vs
  indexed) and the reputation leaderboard.

## Transaction flow (fund a bounty)

1. User connects Freighter → backend learns the `G…` address.
2. User submits the form → `POST /api/tx/build` with `{ action: 'create', source, issueId, amount }`.
3. Backend builds + simulates the Soroban call via RPC, returns the unsigned XDR.
4. Freighter signs the XDR in the browser (`signTransaction(xdr, { networkPassphrase })`).
5. `POST /api/tx/submit` relays the signed XDR; backend submits to Soroban RPC and
   waits for `SUCCESS`.
6. The indexer picks up the `bounty_created` event; `GET /api/bounties` reflects it.

## Data flow (regulatory dataset)

1. Curated dataset in `backend/data/policy-regulations.json` (citable sources).
2. `ingestPolicies()` validates shape, classifies category/jurisdiction/severity, and
   upserts rows (idempotent, deterministic).
3. `detectRegulationChanges()` content-hashes each record; a changed record appends an
   immutable `regulation_versions` row (with its field diff) and raises a
   `regulation_alerts` row classified by severity.
4. `computeAnalytics()` derives aggregates — pure functions over persisted rows.
   `jurisdictions.ts` reuses the same category weights for per-jurisdiction profiles
   and comparisons.
5. `GET /api/policies`, `/api/analytics`, `/api/regulations/*`, `/api/alerts` and
   `/api/jurisdictions*` serve the read-model.

## Multisig release flow

Privileged actions are proposals, not direct calls:

1. A signer calls `propose` (via `POST /api/tx/build` action `proposeRelease`, etc.).
2. Other signers `approve` until the threshold is met (`revoke` withdraws an approval;
   the proposer can `cancel`).
3. On the final approval the contract executes the action in the same transaction —
   for a release it transfers the milestone amount and invokes the registry's
   `record`/`record_review`, all before returning.

## Non-goals / boundaries

- The dashboard never talks to Horizon/Soroban directly — the backend is the only
  client of Stellar, which keeps signing, rate limiting, and indexing in one place.
- No mainnet deployment is configured; everything targets Stellar Testnet.
- Secrets (`BOUNTY_ADMIN_SECRET`, `ADMIN_TOKEN`) are environment-only, never committed,
  and never returned by the API.

## Known limitations

These are tracked in [`ROADMAP.md`](../ROADMAP.md); they are documented rather than
silently omitted:

- **Reclaim window.** `reclaim` has no deadline, so a funder may cancel at any time
  before release. A production revision should add an expiry to `create`.
- **Registry admin/`allowed_caller` uses instance storage** (bounty and reputation state
  is persistent with TTL extension). Fine for the demo dataset, but a production
  revision should move the configuration to persistent storage with TTL as well.
- **Single-instance rate limiter** (in-memory). Multi-instance deployments need a
  shared store (Redis).
- **No push updates.** The dashboard refreshes on load/after a transaction; live updates
  would need websockets/webhooks.