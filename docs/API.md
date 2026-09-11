# API Reference

Base URL: `http://localhost:3001` (override with `VITE_API_URL` on the frontend).

All responses are JSON. Errors follow the shape:

```json
{ "error": "human-readable message", "code": "MACHINE_CODE" }
```

HTTP status codes: `400` bad input, `401` unauthorized, `404` not found,
`429` rate limited, `500` internal, `502` upstream (Horizon/RPC) failure,
`503` dependency not configured/unavailable.

---

## Network

### `GET /api/network`
Live Stellar network status from Horizon.
```json
{
  "network": "Test SDF Network ; September 2015",
  "horizon": "https://horizon-testnet.stellar.org",
  "protocolVersion": "28",
  "latestLedger": "4619417",
  "closedAt": "2026-09-11T09:57:52Z"
}
```

### `GET /api/payments?limit=10`
Recent Stellar payments (limit 1–50, default 10).

---

## Application data (read-model)

### `GET /api/issues`
Open ingested issues, ordered by points desc. Tags are arrays.

### `GET /api/policies`
Validated regulatory dataset, newest first.
```json
[
  {
    "id": "eu-mica-2025-07-01",
    "title": "EU MiCA stablecoin rules apply",
    "jurisdiction": "EU",
    "category": "stablecoin-regulation",
    "eventDate": "2025-07-01",
    "severity": 4,
    "summary": "…",
    "sourceName": "European Commission",
    "sourceUrl": "https://…",
    "source": "dataset"
  }
]
```

### `GET /api/analytics`
Deterministic aggregates over the policy dataset:
```json
{
  "generatedAt": "2026-…Z",
  "totals": { "events": 20, "jurisdictions": 9, "categories": 9, "averageSeverity": 4.1 },
  "riskIndex": 66.4,
  "byJurisdiction": { "US": 6 },
  "byCategory": { "crypto-markets": 5 },
  "bySeverity": { "4": 3 },
  "byYear": { "2024": 12 }
}
```
See `docs/DATA.md` for the risk-index formula.

---

## Regulation history & change detection

Every ingestion run hashes each policy over the fields that define it and appends a new,
**immutable** revision when anything materially changed. History is append-only, so you
can audit what a regulation said at any point in time and what changed between versions.

### `GET /api/regulations/versions?limit=100`
Recent revisions across all policies, newest first (limit 1–500).
```json
[
  {
    "id": "eu-mica-2025-07-01:v2",
    "policyId": "eu-mica-2025-07-01",
    "version": 2,
    "changeType": "updated",
    "contentHash": "9f2c…",
    "changedFields": [{ "field": "severity", "from": 3, "to": 4 }],
    "detectedAt": "2026-…Z",
    "title": "EU MiCA stablecoin rules apply",
    "jurisdiction": "EU",
    "category": "stablecoin-regulation",
    "eventDate": "2025-07-01",
    "severity": 4,
    "summary": "…",
    "sourceName": "European Commission",
    "sourceUrl": "https://…",
    "impact": ["…"],
    "survivalSignals": ["…"]
  }
]
```

### `GET /api/regulations/:policyId/versions`
Full revision history for one policy, newest first.

### `GET /api/regulations/:policyId/diff?from=1&to=2`
Field-level diff between two stored revisions:
```json
{
  "policyId": "eu-mica-2025-07-01",
  "from": 1,
  "to": 2,
  "changes": [{ "field": "severity", "from": 3, "to": 4 }],
  "sourceUrl": "https://…"
}
```
`400 BAD_FIELD` when `from`/`to` are missing; `404 VERSION_NOT_FOUND` when either
revision does not exist.

### `GET /api/alerts?policyId=&severity=&acknowledged=&limit=50`
Alerts raised by change detection, newest first (limit 1–200). `severity` is one of
`info`, `warning`, `critical` — a severity escalation of ≥2 levels is `critical`, and a
brand-new regulation is `info`.

### `POST /api/alerts/:id/acknowledge`
Marks an alert acknowledged. Response `{ "id": "…", "acknowledged": true }`;
`404 ALERT_NOT_FOUND` for an unknown id.

---

## Jurisdiction comparison

How regulatory requirements differ across jurisdictions, computed over the curated,
source-cited dataset. Every figure carries the primary sources behind it.

### `GET /api/jurisdictions`
Headline figures per jurisdiction, highest risk first:
```json
[{ "jurisdiction": "US", "regulationCount": 6, "riskIndex": 72.5, "latestEventDate": "2026-01-15" }]
```

### `GET /api/jurisdictions/compare?ids=US,EU&category=stablecoin-regulation`
Side-by-side comparison. `ids` is a comma-separated list (defaults to every jurisdiction
in the dataset); `category` optionally narrows to one. `cells` is sparse — only
jurisdiction × category combinations with data appear — and every cell carries its
primary `sources`, so the comparison is traceable rather than hand-entered.
```json
{
  "generatedAt": "2026-…Z",
  "jurisdictions": ["EU", "US"],
  "categories": ["stablecoin-regulation"],
  "coverage": { "EU": 1, "US": 1 },
  "cells": [
    {
      "jurisdiction": "EU",
      "category": "stablecoin-regulation",
      "count": 1,
      "averageSeverity": 4,
      "maxSeverity": 4,
      "risk": 80,
      "sources": [
        { "id": "eu-mica-2025-07-01", "title": "…", "sourceName": "European Commission", "sourceUrl": "https://…" }
      ]
    }
  ],
  "profiles": [ /* full JurisdictionProfile per requested id */ ]
}
```

### `GET /api/jurisdictions/:id`
Full profile for one jurisdiction (case-insensitive id): category counts, average/max
severity, risk index, latest event date, impact areas, survival signals, and every
contributing source. `404 JURISDICTION_NOT_FOUND` when the dataset has no records for it.

---

## Contract state (from Stellar)

### `GET /api/contract`
Deployed contract metadata and initialisation status:
```json
{
  "configured": true,
  "contractId": "CB4OI57YRKLAIX2RGFS7DX3GIGEST4MSI447VAJPRCBCNFUHWLWLQLWT",
  "tokenId": "CB7NFW2WD3FXKBYANZX7J3FO6PBST2H3IE6SPHXHSWIQESII2P2A6Y6P",
  "registryId": "CC53MJDM5M76GMZONKC56ONW4MM74MX3KF4LSXMWTRE7W66RASDP4W7Q",
  "admin": "GB2OVPTEO2BYRRRRWNRPZZOC3VW77IQDXJPBY2WYV2MXSU7C5HQDZ6E6",
  "network": "Test SDF Network ; September 2015",
  "rpcUrl": "https://soroban-testnet.stellar.org",
  "horizonUrl": "https://horizon-testnet.stellar.org",
  "initialised": true,
  "sorobanReachable": true,
  "signers": ["G…"],
  "signerThreshold": 1
}
```

`sorobanReachable` is `false` (and `initialised` `false`) when Soroban RPC could not be
reached — the deployment metadata is still returned in that case. `signers` /
`signerThreshold` reflect the live multisig configuration (`[]` / `0` when it could not be
read).

### `GET /api/signers`
Live multisig configuration read from the contract:
```json
{ "signers": ["G…", "G…"], "threshold": 2 }
```
`503 CONTRACT_NOT_CONFIGURED` when no bounty contract is configured.

### `GET /api/contributors/:address`
Live on-chain stats from the contributors registry (inter-contract contract):
```json
{
  "contributor": "G…FRQI",
  "count": 1,
  "total": "250",
  "verified": true,
  "source": "stellar"
}
```
Reads the registry contract directly via Soroban RPC — proof that the bounty
contract recorded the payout on-chain.

### `GET /api/reputation/leaderboard?limit=25`
Indexed reputation ranking, highest score first (limit 1–200):
```json
{
  "generatedAt": "2026-…Z",
  "total": 4,
  "entries": [
    {
      "address": "G…",
      "payouts": 3,
      "payoutTotal": "750",
      "reviewsUpheld": 2,
      "disputesOpened": 1,
      "disputesLost": 0,
      "score": 420,
      "tier": "established",
      "source": "indexed",
      "updatedAt": "2026-…Z"
    }
  ]
}
```

### `GET /api/reputation/:address`
**Verifiable reputation** — reconciles the on-chain registry against the indexed mirror:
```json
{
  "address": "G…",
  "stellarReachable": true,
  "onChain": { "address": "G…", "score": 420, "tier": "established", "source": "stellar", "…": "…" },
  "indexed": { "address": "G…", "score": 420, "tier": "established", "source": "indexed", "…": "…" },
  "reputation": { "address": "G…", "score": 420, "tier": "established", "…": "…" }
}
```
Reputation is *derived* from on-chain activity — completed payouts, upheld reviews, and
disputes opened/lost — and cannot be self-reported. The score formula lives in the
contract and is mirrored by the indexer; `tier` bands the 0–1000 score
(`newcomer` < 50, `contributor` < 200, `established` < 500, `trusted` < 800,
`authority` ≥ 800). `reputation` is the ledger value when reachable, otherwise the index.
`400 BAD_ADDRESS` for a malformed address; `404 REPUTATION_NOT_FOUND` when neither
source has a record.

### `GET /api/bounties`
Bounty state derived from indexed contract events, newest first:
```json
[
  {
    "issueId": "repo#42",
    "funder": "G…",
    "contributor": "G…",
    "token": "CB7NFW2W…",
    "amount": "250",
    "released": false,
    "refunded": false,
    "releasedAmount": "0",
    "milestones": 2,
    "createdTx": "88e97e17…",
    "releasedTx": null,
    "updatedAt": "2026-…Z",
    "createdUrl": "https://stellar.expert/explorer/testnet/tx/88e97e17…",
    "releasedUrl": null
  }
]
```

### `GET /api/bounties/:issueId`
**Live on-chain verification** — reads the bounty directly from the contract via RPC:
```json
{ "issueId": "repo#42", "funder": "G…", "contributor": null, "token": "CB7NFW2W…",
  "amount": "250", "released": false, "verified": true, "source": "stellar" }
```
`404` when the bounty does not exist on chain.

### `GET /api/bounties/:issueId/milestones`
Live milestone state (read from the contract) merged with the indexed release/review
history. This is the read behind the milestone panel:
```json
{
  "issueId": "repo#42",
  "onChainVerified": true,
  "source": "stellar",
  "quorum": 2,
  "reviewers": [
    {
      "reviewer": "G…",
      "reviews": [{ "milestone": 0, "decision": "approve", "ledger": 4589001, "txHash": "88e9…", "explorerUrl": "https://…", "createdAt": "2026-…Z" }]
    }
  ],
  "milestones": [
    { "index": 0, "title": "Dataset", "amount": "250", "settled": true, "releasedTx": "ab12…", "releasedUrl": "https://…" }
  ],
  "releasedAmount": "250",
  "disputed": false,
  "disputes": []
}
```
`source` is `stellar` when the contract answered, `index` when only the read-model has
data. Reviewer/decision tallies are derived from `reviews`.

### `GET /api/reviews?issueId=&milestone=&reviewer=&limit=100`
Indexed reviewer decisions, newest first (limit 1–500). Each row includes
`explorerUrl` for its `txHash`.

### `GET /api/proposals?limit=50`
Indexed multisig proposals, newest first (limit 1–200):
```json
[
  {
    "id": 1,
    "proposer": "G…",
    "action": "Release",
    "actionDetail": { "issueId": "repo#42", "milestone": 0 },
    "approvals": ["G…"],
    "executed": false,
    "cancelled": false,
    "createdTx": "88e9…",
    "explorerUrl": "https://…",
    "updatedAt": "2026-…Z"
  }
]
```

### `GET /api/proposals/:id`
**Live proposal state** from the contract when configured, falling back to the index.
The response is tagged `verified: true, source: "stellar"` or `verified: false,
source: "index"`. `400 BAD_FIELD` for a non-numeric id; `404 PROPOSAL_NOT_FOUND` when
neither source has it.

### `GET /api/disputes?issueId=&open=&limit=100`
Indexed disputes, newest first (limit 1–500). `open=true` returns unresolved disputes,
`open=false` resolved ones.

### `GET /api/disputes/:id`
**Live dispute state** from the contract when configured, falling back to the index
(tagged `verified`/`source` the same way as proposals). `404 DISPUTE_NOT_FOUND` when
neither source has it.

### `GET /api/events?limit=50`
Indexed Soroban contract events (limit 1–200):
```json
[
  {
    "id": 1,
    "txHash": "88e97e17…",
    "ledger": 4588933,
    "contractId": "CB4OI57Y…",
    "topic": "bounty_created",
    "issueId": "repo#42",
    "payload": { "amount": "250", "funder": "G…" },
    "createdAt": "2026-…Z",
    "explorerUrl": "https://stellar.expert/explorer/testnet/tx/88e97e17…"
  }
]
```
Topics from the **bounty** contract: `admin_initialised`, `bounty_created`,
`contributor_claimed`, `milestone_released`, `bounty_refunded`, `bounty_reclaimed`,
`signers_updated`, `reviewers_set`, `proposal_created`, `proposal_approved`,
`proposal_executed`, `proposal_cancelled`, `review_submitted`, `dispute_opened`,
`dispute_vote_cast`, `dispute_resolved` (the indexer also still parses the legacy
`bounty_released` topic for older deployments). Topics from the
**contributors registry** (inter-contract calls): `contributor_recorded`,
`review_recorded`, `dispute_recorded`. Events from both contracts are indexed.
`contractId` is the contract that emitted the event.

---

## Transaction relay

The backend builds and simulates transactions; the wallet signs; the backend submits.

### `POST /api/tx/build`
Body:
```json
{ "action": "createBounty", "source": "G…", "funder": "G…", "token": "CB7NFW2W…",
  "issueId": "repo#42", "milestones": [{ "title": "Dataset", "amount": "250" }] }
```
Response:
```json
{
  "txXdr": "AAAA…",
  "action": "createBounty",
  "networkPassphrase": "Test SDF Network ; September 2015"
}
```
`source` must be a valid `G…` address (the wallet account that signs and pays fees).
`action` is whitelisted; the privileged one-time `init` bootstrap is **not** buildable
through the public relay. Every argument is validated and encoded server-side:

| `action` | Required body fields | Contract call |
|---|---|---|
| `create` | `funder`, `token`, `amount`, `issueId` | `create` (v1 single-amount escrow) |
| `createBounty` | `funder`, `token`, `issueId`, `milestones[]` (1–20 × `{title, amount}`) | `create_bounty` |
| `claim` | `issueId`, `contributor` | `claim` |
| `reclaim` | `issueId` | `reclaim` |
| `proposeRelease` | `proposer`, `issueId`, `milestone` | `propose(Release)` |
| `proposeReclaim` | `proposer`, `issueId` | `propose(Reclaim)` |
| `proposeSetSigners` | `proposer`, `signers[]` (1–20), `threshold` | `propose(SetSigners)` |
| `proposeSetReviewers` | `proposer`, `issueId`, `reviewers[]` (≤20), `quorum` | `propose(SetReviewers)` |
| `proposeResolveDispute` | `proposer`, `disputeId`, `payContributor` | `propose(ResolveDispute)` |
| `approve` | `signer`, `proposalId` | `approve` |
| `revoke` | `signer`, `proposalId` | `revoke` |
| `cancel` | `proposer`, `proposalId` | `cancel` |
| `submitReview` | `reviewer`, `issueId`, `milestone`, `decision` (`approve`/`reject`), `commentHash` (optional) | `submit_review` |
| `openDispute` | `opener`, `issueId`, `milestone`, `reasonHash` (optional) | `open_dispute` |
| `voteDispute` | `reviewer`, `disputeId`, `payContributor` | `vote_on_dispute` |

`400 BAD_SOURCE` for an invalid `source`; `400 BAD_ACTION` for an unknown action;
`400 BAD_FIELD` for malformed field values; `502` if simulation fails (e.g. insufficient
balance, missing trustline, or a contract-level rejection).

### `POST /api/tx/submit`
Body: `{ "signedXdr": "AAAA…" }` — the XDR returned by Freighter's `signTransaction`.

Response:
```json
{
  "status": "SUCCESS",
  "hash": "88e97e17…",
  "explorerUrl": "https://stellar.expert/explorer/testnet/tx/88e97e17…"
}
```
`400 BAD_XDR` for empty/malformed XDR; `502` on submission failure. A successful
submit triggers an immediate indexer pass so the dashboard reflects the change.

---

## Ops

### `POST /api/ingest/run`
Manually re-runs the ingestion pipelines. Requires `Authorization: Bearer <ADMIN_TOKEN>`
when `ADMIN_TOKEN` is configured. Response: `{ "policies": {...}, "issues": {...} }`.

---

## Observability

### `GET /health`
Liveness — `{ "status": "ok", "uptime": 123.4 }` (used by the Docker healthcheck).

### `GET /health/ready`
Readiness — checks the DB, Horizon reachability, and (when configured) Soroban
contract initialisation. Returns `200` only when all configured dependencies are
reachable:
```json
{ "status": "ready", "db": true, "horizon": true, "soroban": true }
```
`503` with `status: "degraded"` otherwise.

### `GET /metrics`
Prometheus-format text metrics (requests, ingest runs, indexed events, tx relay
results). Example:
```
http_requests_total{method="GET",status="200"} 42
soroban_request_duration_ms_bucket{le="+Inf"} 12
```

Every response — successful or not — increments `http_requests_total{method,status}`.