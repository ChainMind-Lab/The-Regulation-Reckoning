# The Regulation Reckoning

**Soroban bounty platform for regulatory resilience** — a full-stack Stellar application
where regulatory-research issues are funded and settled on-chain, with Stellar Testnet
as the verifiable source of truth.

[![CI](https://github.com/ChainMind-Lab/The-Regulation-Reckoning/actions/workflows/ci.yml/badge.svg)](https://github.com/ChainMind-Lab/The-Regulation-Reckoning/actions/workflows/ci.yml)
[![Soroban SDK 27](https://img.shields.io/badge/Soroban-SDK%2027-rust)](./contracts)

## What this is

A production-oriented Stellar/Soroban application (not a prototype):

- **Soroban bounty contract** (`contracts/bounty`) — milestone-based escrow for funding
  issues: `create_bounty` with per-milestone amounts, `claim`, reviewer-gated
  `submit_review`, `open_dispute`/`vote_on_dispute`, and **multisig governance** where
  privileged operations (release, refund, signer/reviewer changes, dispute resolution)
  execute only after a signer threshold is reached. Emits typed on-chain events.
- **Contributors registry contract** (`contracts/contributors`) — the bounty contract
  calls it through `env.invoke_contract` on releases, upheld reviews, and resolved
  disputes, recording **verifiable payouts and reputation** on-chain (inter-contract
  communication).
- **Live on Stellar Testnet** — both contracts are deployed and exercised with real
  transactions; every event is indexed and available in the API/dashboard.
- **Backend read-model** (`backend/`) — SQLite database built by (a) a documented,
  reproducible data-ingestion pipeline for regulatory policy data and (b) an indexer
  that polls both contracts for events. It also keeps an **append-only regulation
  revision history** with change detection and alerts, and serves **jurisdiction
  comparisons** and **reputation leaderboards**.
- **React dashboard** (`src/`) — Freighter wallet connect; fund/claim flows; milestone
  escrow, review and dispute panels; multisig governance; on-chain verification; an
  events feed; the regulatory analytics panel; jurisdiction comparison; regulation
  change history; and contributor reputation.
- **TypeScript SDK** (`sdk/`) — a typed client for the whole API (`@regulation-reckoning/sdk`).

> **Live demo:** there is no permanently hosted instance — public Codespace URLs expire.
> Run the whole stack locally in a few minutes (below); the deployment it targets is
> recorded in [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md).

### Live Testnet deployment

| Artifact | Value |
|---|---|
| Bounty contract | `CB4OI57YRKLAIX2RGFS7DX3GIGEST4MSI447VAJPRCBCNFUHWLWLQLWT` |
| Contributors registry | `CC53MJDM5M76GMZONKC56ONW4MM74MX3KF4LSXMWTRE7W66RASDP4W7Q` |
| Demo token (RRD, SAC) | `CB7NFW2WD3FXKBYANZX7J3FO6PBST2H3IE6SPHXHSWIQESII2P2A6Y6P` |
| Contract admin | `GB2OVPTEO2BYRRRRWNRPZZOC3VW77IQDXJPBY2WYV2MXSU7C5HQDZ6E6` |
| Deployment ledger | `4588860` (use as `INDEXER_START_LEDGER` to index full history) |
| Network | Stellar Testnet (`soroban-testnet.stellar.org`) |

The end-to-end proof (frontend action → wallet-style signature → Soroban transaction →
bounty→registry inter-contract call → event indexing → backend → dashboard) is a runnable
script with recorded transactions:

- Registry initialised (allowed caller = bounty): `6105dd78…0182`
- Bounty initialised (admin + registry): `27e6a457…9b77`
- Create bounty: `8e04ed19…67c3e`
- Release bounty → contributor recorded in registry: `bfe1d5d2…709c5`

Full hashes and explorer links are in [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md). View
them on the [Testnet explorer](https://stellar.expert/explorer/testnet) or re-run the whole
flow yourself:

```bash
cd backend
npm ci
npm run build
BOUNTY_CONTRACT_ID=CB4OI57YRKLAIX2RGFS7DX3GIGEST4MSI447VAJPRCBCNFUHWLWLQLWT \
DEMO_TOKEN_ID=CB7NFW2WD3FXKBYANZX7J3FO6PBST2H3IE6SPHXHSWIQESII2P2A6Y6P \
CONTRIBUTOR_REGISTRY_ID=CC53MJDM5M76GMZONKC56ONW4MM74MX3KF4LSXMWTRE7W66RASDP4W7Q \
BOUNTY_ADMIN_ADDRESS=GB2OVPTEO2BYRRRRWNRPZZOC3VW77IQDXJPBY2WYV2MXSU7C5HQDZ6E6 \
INDEXER_START_LEDGER=4588860 \
node dist/server.js &   # backend on :3001, indexer enabled
ADMIN_SECRET=<deploy-account-secret> node e2e/testnet-e2e.mjs
```

## Project structure

```
.
├── src/                       # React dashboard (Vite + TypeScript)
│   ├── components/            # WalletButton, NetworkStatusCard, VerificationPanel,
│   │                          # BountyForm/BountyCard, MilestonePanel, GovernancePanel,
│   │                          # EventsFeed, PolicyPanel, JurisdictionPanel,
│   │                          # RegulationHistoryPanel, ReputationPanel, NavBar, Hero, CTA
│   ├── lib/                   # api.ts (backend client), wallet.ts (Freighter), tx.ts, types.ts
│   ├── styles/global.css
│   └── test/                  # component + v2-panel + wallet tests (vitest + testing-library)
├── public/                    # static assets (favicon)
├── sdk/                       # @regulation-reckoning/sdk — typed API client
│
├── backend/                   # Express API + read-model (TypeScript)
│   ├── src/
│   │   ├── config.ts          # validated env config (+ dotenv)
│   │   ├── db.ts              # SQLite schema (node:sqlite)
│   │   ├── services/
│   │   │   ├── soroban.ts     # Soroban RPC: build/simulate/submit, reads, event fetch
│   │   │   ├── horizon.ts     # live network status + payments
│   │   │   ├── indexer.ts     # contract events → SQLite (both contracts)
│   │   │   ├── ingest/        # regulatory dataset + issue pipelines (idempotent)
│   │   │   ├── regulations.ts # revision history, field diffs, change alerts
│   │   │   ├── jurisdictions.ts # per-jurisdiction profiles + comparison
│   │   │   ├── reputation.ts  # indexed/on-chain reputation + leaderboard
│   │   │   └── analytics.ts   # deterministic policy analytics
│   │   ├── middleware/        # rate limiting, error handling
│   │   └── routes/api.ts      # REST API (see docs/API.md)
│   ├── data/                  # curated, citable regulatory dataset + seed issues
│   ├── test/                  # unit + API integration tests
│   └── e2e/testnet-e2e.mjs    # live Testnet proof script
│
├── contracts/bounty/          # Soroban bounty escrow + milestones, reviews, disputes,
│   │                          # multisig governance (Rust, soroban-sdk 27)
│   └── src/lib.rs             # create_bounty/claim/propose/approve/submit_review/…
├── contracts/contributors/    # Soroban contributors registry (inter-contract)
│   └── src/lib.rs             # record()/record_review()/record_dispute() + reputation
│
├── scripts/deploy-testnet.sh  # reproducible Testnet deployment (both contracts)
├── Dockerfile, backend/Dockerfile, docker-compose.yml
├── docs/                      # ARCHITECTURE, API, DATA, DEPLOYMENT, SECURITY, AUDIT…
└── .github/workflows/ci.yml   # format, lint, typecheck, tests, audit, builds
```

## Quick start

Requires **Node.js ≥ 22.13** (the backend uses the built-in `node:sqlite`, which is
behind a flag before 22.13).

### 1. Backend

```bash
cd backend
npm ci
cp .env.example .env   # already contains the live Testnet contract IDs
npm run dev            # http://localhost:3001  (ingestion + indexer run on boot)
```

`INDEXER_START_LEDGER` defaults to the deployment ledger (`4588860`) so the dashboard
shows the real on-chain history. Set it to `0` only if you want to scan just the most
recent ledgers.

### 2. Frontend

```bash
npm ci
npm run dev            # http://localhost:4173
```

Connect the Freighter wallet (configured for Testnet) to fund or release bounties with
the RRD demo token.

### 3. Soroban contracts

```bash
cd contracts/bounty
cargo test             # 47 unit tests: auth, validation, idempotency, milestones,
                       # reviews, disputes, multisig proposals, inter-contract
cargo clippy --all-targets -- -D warnings
cargo fmt --check
cd ../contributors
cargo test             # 18 unit tests: auth, validation, accumulation, reviews,
                       # disputes, reputation score, events
cargo clippy --all-targets -- -D warnings
cargo fmt --check
```

## Testing

Every layer has automated tests, and CI runs all of them on every push/PR:

```bash
# Frontend (51) + SDK (13) tests: components, v2 panels, wallet bridge, API client
npm ci && npm test

# Backend (141 tests): API routes, ingestion, analytics, indexer, metrics,
# regulations, jurisdictions, reputation, scval encoding
cd backend && npm ci && npm test

# Soroban contracts (47 + 18 tests): auth, validation, idempotency, milestones,
# reviews, disputes, multisig, reputation, inter-contract
cd contracts/bounty && cargo test
cd contracts/contributors && cargo test

# Live Testnet end-to-end proof: frontend → wallet → Soroban → event → indexer →
# DB → API → dashboard, plus on-chain registry stats. Requires a running backend.
cd backend && ADMIN_SECRET=<deploy-account-secret> npm run e2e
```

The e2e exits non-zero on any failed assertion and prints fresh transaction hashes;
recorded proof transactions are in [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md).

## Security

- **Threat model** and mitigations: [`docs/SECURITY.md`](./docs/SECURITY.md)
- Admin secret is environment-only, never served by the API, and gitignored.
- Per-IP rate limiting on the API (set `TRUST_PROXY=true` behind a reverse proxy so the
  limiter keys on real client IPs); CORS locked to the frontend origin.
- Soroban contracts use `require_auth` on every privileged path; the registry only
  accepts writes authorized by the bounty contract.
- CI runs **gitleaks** secret scanning, **Trivy** image + filesystem scans,
  **CycloneDX SBOMs**, and `npm audit` — plus both Dockerfiles run as non-root users.

## Monitoring

Prometheus-format metrics at `GET /metrics`; a provisioned Prometheus + Grafana
stack ships in `monitoring/` (see [`docs/MONITORING.md`](./docs/MONITORING.md)).

## Docker

```bash
cp .env.example .env    # or export the BOUNTY_* variables
docker compose up --build
# frontend → http://localhost:8080  (serves the SPA and proxies /api to the backend)
# prometheus → http://localhost:9090 · grafana → http://localhost:3000
```

## Testnet deployment

`scripts/deploy-testnet.sh` reproduces the live deployment end-to-end: it builds both
WASMs, funds a fresh account via Friendbot, deploys the bounty contract, the
contributors registry, and the RRD demo token, initialises the registry (allowed
caller = bounty) and the bounty (admin + registry), records the deployment ledger, and
writes `backend/.env.deployed`. See [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md).

## Documentation

- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — system design and data flow
- [`docs/API.md`](./docs/API.md) — REST API reference
- [`docs/DATA.md`](./docs/DATA.md) — data-ingestion pipeline, validation, and analytics
- [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) — Testnet deployment + live addresses
- [`docs/SECURITY.md`](./docs/SECURITY.md) — threat model, secrets, hardening
- [`docs/MONITORING.md`](./docs/MONITORING.md) — /metrics, Prometheus, Grafana
- [`docs/CONTRIBUTOR_GUIDE.md`](./docs/CONTRIBUTOR_GUIDE.md) — how to contribute
- [`docs/AUDIT.md`](./docs/AUDIT.md) — audit findings and known limitations
- [`CHANGELOG.md`](./CHANGELOG.md) — version history

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) and [`docs/CONTRIBUTOR_GUIDE.md`](./docs/CONTRIBUTOR_GUIDE.md).

## Stack

| Layer | Tech |
|---|---|
| Frontend | React 18, Vite 6, TypeScript, Freighter |
| Backend | Node.js ≥ 22.13, Express 4, `node:sqlite`, `@stellar/stellar-sdk` 16 |
| Smart contract | Rust, Soroban SDK 27 |
| Blockchain | Stellar Testnet (Soroban RPC + Horizon) |
| CI | GitHub Actions: prettier, eslint, tsc, vitest, cargo fmt/clippy/test, gitleaks, Trivy, SBOM, npm audit |
