# Changelog

All notable changes to The Regulation Reckoning are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **Frontend wallet signing.** `signTransactionXdr` read a `signedXdr` field that
  Freighter does not return; it now accepts the documented `signedTxXdr` shape, the
  legacy raw-string response, and returned `{ error }` objects — and reports the actual
  error instead of "signing cancelled". Added unit tests for each response shape.
- **Docker deployment.** The frontend build no longer bakes in `http://localhost:3001`;
  production builds call the same origin and nginx proxies `/api` to the backend.
  `docker-compose.yml` now passes `VITE_API_URL` as a build arg and defaults
  `CONTRIBUTOR_REGISTRY_ID` and `INDEXER_START_LEDGER` to the live deployment.
- **Indexer history.** `INDEXER_START_LEDGER` now defaults to the deployment ledger
  (`4588860`) in the env templates, deployment script and compose file, so a fresh
  install indexes the full on-chain history instead of starting empty. A warning is
  logged when the value is `0` and the first pass finds nothing.
- **Registry events.** The indexer now polls **both** contracts, so the inter-contract
  `contributor_recorded` event is indexed and its issue id is read from the event data.
- **Metrics correctness.** `http_requests_total{method,status}` is now incremented for
  every response (previously only errors/429s), and histogram buckets are cumulative with
  an `+Inf` bucket so `histogram_quantile()` is valid.
- **Error reporting.** On-chain reads now distinguish "not found" from an upstream
  failure: a Soroban RPC outage returns `502` instead of a misleading `404`, and
  `/api/contract` returns `sorobanReachable: false` while still serving metadata.
- **Rate limiting behind a proxy.** Added `TRUST_PROXY`; the bundled compose stack sets
  it so the limiter keys on real client IPs.
- **Graceful shutdown.** The server now stops the indexer and closes the HTTP server and
  database on `SIGINT`/`SIGTERM`.
- **Dashboard resilience.** Sections load independently (`Promise.allSettled`); a single
  failing upstream no longer blanks the whole page. Adds a non-blocking warning banner.
- **Network-aware explorer links.** Contract/transaction explorer URLs are derived from
  the configured network instead of being hardcoded to Testnet.
- **Environment templates.** Removed the leftover `[TEMPLATE]` markers and unified the
  contract IDs on the canonical live deployment.
- Transaction builders now use bounded (180s) time bounds instead of `setTimeout(0)`.

### Added

- **Contract v2 — milestones, reviews, disputes and multisig governance** (bounty
  contract, 47 tests). `create_bounty` escrows 1–20 per-milestone amounts; a contributor
  `claim`s a bounty; assigned reviewers `submit_review` (approve/reject) and a milestone
  is released only once the reviewer quorum is met; `open_dispute`/`vote_on_dispute`
  settle a milestone by paying the contributor or refunding the funder; and privileged
  operations run through `propose` → `approve`/`revoke`/`cancel` → execute, gated by a
  signer set and threshold. The single-amount `create` and funder `reclaim` remain
  available for compatibility; release now runs through a multisig proposal.
- **Verifiable reputation** (contributors registry, 18 tests). The registry records
  payouts, upheld reviews and dispute outcomes and exposes a derived 0–1000 score; the
  bounty contract invokes it on release, upheld review and resolved dispute.
- **Regulation change detection** (`backend/src/services/regulations.ts`). Each ingestion
  run content-hashes every policy and appends an immutable revision when something
  changed, with a field-level diff and a severity-classified alert (a severity
  escalation of ≥2 is `critical`). Exposed via `/api/regulations/*` and `/api/alerts`.
- **Jurisdiction comparison** (`backend/src/services/jurisdictions.ts`). Per-jurisdiction
  profiles and side-by-side comparison where every cell carries its primary sources
  (`/api/jurisdictions*`).
- **Reputation API** (`backend/src/services/reputation.ts`). `GET /api/reputation/:address`
  reconciles the live on-chain registry against the indexed mirror in one JSON shape,
  and `GET /api/reputation/leaderboard` serves the ranking.
- **Contract v2 API surface:** `GET /api/signers`,
  `GET /api/bounties/:issueId/milestones`, `GET /api/reviews`, `GET /api/proposals(/:id)`,
  `GET /api/disputes(/:id)`, plus `signers`/`signerThreshold` on `GET /api/contract`.
- **Dashboard v2 panels:** milestone escrow/reviews/disputes (`MilestonePanel`), multisig
  administration (`GovernancePanel`), regulation history & alerts
  (`RegulationHistoryPanel`), jurisdiction comparison (`JurisdictionPanel`) and
  contributor/reviewer reputation (`ReputationPanel`).
- **Typed TypeScript SDK** (`sdk/`, `@regulation-reckoning/sdk`) covering the whole API.
- `CHANGELOG.md`, a brand favicon, and tests for the wallet bridge, metrics rendering,
  registry-event indexing, partial dashboard failure, and contract-RPC-unreachable paths.

### Changed

- The transaction relay now exposes the full v2 action set (`createBounty`, `claim`,
  `propose*`, `approve`, `revoke`, `cancel`, `submitReview`, `openDispute`,
  `voteDispute`); the privileged one-time `init` is still not buildable through it.
- Backend requires Node.js ≥ 22.13.0 (the version where `node:sqlite` left the
  `--experimental-sqlite` flag).
- The public transaction relay no longer accepts the privileged `init` action.
- Removed the advertised Codespace demo URLs (they expire); `docs/DEPLOYMENT.md` now
  documents how to run the stack locally against the live deployment.

## [1.0.0] - 2026-09-09

### Added

- Soroban **bounty escrow** contract (`create`/`release`/`reclaim`/`get_bounty`/`init`)
  with typed events, CEI ordering, and 21 unit tests.
- Soroban **contributors registry** contract, invoked by the bounty contract on release
  (inter-contract communication), with 7 unit tests.
- Live **Stellar Testnet deployment** of both contracts plus an RRD demo token, with
  recorded transaction hashes in `docs/DEPLOYMENT.md`.
- Express + `node:sqlite` backend: Soroban event indexer, regulatory data-ingestion
  pipeline, deterministic analytics, transaction relay, rate limiting, structured
  logging, Prometheus metrics, health checks, and 46 initial tests.
- React dashboard: Freighter wallet connect, fund/release flows, events feed, on-chain
  verification panel, and the regulatory analytics panel (timeline + heat map).
- Reproducible Testnet deployment script, Docker/Docker Compose stack, Prometheus +
  Grafana monitoring, CI (format, lint, typecheck, tests, cargo checks, gitleaks,
  Trivy, SBOM, `npm audit`), and full documentation.
