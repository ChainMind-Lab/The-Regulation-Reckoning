# The Regulation Reckoning

**Soroban bounty platform for regulatory resilience** — a full-stack Stellar application
where regulatory-research issues are funded and settled on-chain, with Stellar Testnet
as the verifiable source of truth.

[![CI](https://github.com/ChainMind-Lab/The-Regulation-Reckoning/actions/workflows/ci.yml/badge.svg)](https://github.com/ChainMind-Lab/The-Regulation-Reckoning/actions/workflows/ci.yml)
[![Soroban SDK 27](https://img.shields.io/badge/Soroban-SDK%2027-rust)](./contracts)

## Live demo

A hosted instance of the dashboard is running against the live Testnet deployment:

- **Frontend:** https://crispy-palm-tree-6vggrx996gvqfxxjx-4173.app.github.dev
- **Backend API:** https://crispy-palm-tree-6vggrx996gvqfxxjx-3001.app.github.dev
  (`/health`, `/api/contract`, `/api/bounties`, `/api/events`, `/api/policies`, `/api/analytics`)

The frontend is served from a GitHub Codespace with public port forwarding; the
backend runs the committed code against the deployed contract above, with the
Soroban event indexer enabled. Connect the Freighter wallet to fund or release a
bounty live. The URL is valid while the codespace is running — see
[`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md#live-demo) to host it yourself.

## What this is

A production-oriented Stellar/Soroban application (not a prototype):

- **Soroban bounty contract** (`contracts/bounty`) — escrow for funding issues, releasing
  rewards to contributors, and reclaiming unclaimed funds. Emits typed on-chain events.
- **Live on Stellar Testnet** — the contract below is deployed and exercised with real
  transactions; every event is indexed and visible in the dashboard.
- **Backend read-model** (`backend/`) — SQLite database built by (a) a documented,
  reproducible data-ingestion pipeline for regulatory policy data and (b) a Soroban event
  indexer. The dashboard and API never guess — they serve what Stellar recorded.
- **React dashboard** (`src/`) — Freighter wallet connect, fund/release flows
  (build → wallet signature → submit), an events feed, and the regulatory analytics panel.

### Live Testnet deployment

| Artifact | Value |
|---|---|
| Bounty contract | `CDE5G6LZC27ZXEYTZAELNSMHLZAR6PNLTP3UMJZNAQ7TXDG337A7DBR6` |
| Contributors registry | `CALHU2WW55X5RZMHSN4LVLU2K46SGJNYW3BFGAPDJYBQRRD6T3EEUFD2` |
| Demo token (RRD, SAC) | `CCOAF5DIHLO4457S6EGQYSLXGGDRQPTO42DU6N5KVH4M2MSA2VDW2NB4` |
| Contract admin | `GBRVOQSLP32BGOCYA56DCTM5PUQWW7YLBBAKVXBHDTJ6SNKVLGMWFRQI` |
| Network | Stellar Testnet (`soroban-testnet.stellar.org`) |

The end-to-end proof (frontend action → Freighter-style signature → Soroban transaction →
bounty→registry inter-contract call → event indexing → backend → dashboard) is a runnable
script with recorded transactions:

- Registry initialised (allowed caller = bounty): `b211edd3…da78`
- Bounty initialised (admin + registry): `a099ff84…d052`
- Create bounty: `043c8e6d…3809`
- Release bounty → contributor recorded in registry: `97c2b71e…c9ee`

Full hashes and explorer links are in `docs/DEPLOYMENT.md`. View them on the
[Testnet explorer](https://stellar.expert/explorer/testnet) or re-run the whole flow
yourself:

```bash
cd backend
npm run build
BOUNTY_CONTRACT_ID=CDE5G6LZC27ZXEYTZAELNSMHLZAR6PNLTP3UMJZNAQ7TXDG337A7DBR6 \
DEMO_TOKEN_ID=CCOAF5DIHLO4457S6EGQYSLXGGDRQPTO42DU6N5KVH4M2MSA2VDW2NB4 \
CONTRIBUTOR_REGISTRY_ID=CALHU2WW55X5RZMHSN4LVLU2K46SGJNYW3BFGAPDJYBQRRD6T3EEUFD2 \
BOUNTY_ADMIN_ADDRESS=GBRVOQSLP32BGOCYA56DCTM5PUQWW7YLBBAKVXBHDTJ6SNKVLGMWFRQI \
node dist/server.js &   # backend on :3001, indexer enabled
ADMIN_SECRET=<deploy-account-secret> node e2e/testnet-e2e.mjs
```

## Project structure

```
.
├── src/                       # React dashboard (Vite + TypeScript)
│   ├── components/            # WalletButton, BountyForm, BountyCard, EventsFeed,
│   │                          # PolicyPanel, NetworkStatusCard, NavBar, Hero, CTA
│   ├── lib/                   # api.ts (backend client), wallet.ts (Freighter), types.ts
│   ├── styles/global.css
│   └── test/                  # component tests (vitest + testing-library)
│
├── backend/                   # Express API + read-model (TypeScript)
│   ├── src/
│   │   ├── config.ts          # validated env config (+ dotenv)
│   │   ├── db.ts              # SQLite schema (node:sqlite)
│   │   ├── services/
│   │   │   ├── soroban.ts     # Soroban RPC: build/simulate/submit, event fetch
│   │   │   ├── horizon.ts     # live network status + payments
│   │   │   ├── indexer.ts     # contract events → SQLite
│   │   │   ├── ingest/        # regulatory dataset + issue pipelines (idempotent)
│   │   │   └── analytics.ts   # deterministic policy analytics
│   │   ├── middleware/        # rate limiting, error handling
│   │   └── routes/api.ts      # REST API (see docs/API.md)
│   ├── data/                  # curated, citable regulatory dataset + seed issues
│   ├── test/                  # unit + API integration tests
│   └── e2e/testnet-e2e.mjs    # live Testnet proof script
│
├── contracts/bounty/          # Soroban bounty escrow (Rust, soroban-sdk 27)
│   └── src/lib.rs             # create/release/reclaim + registry inter-contract call
├── contracts/contributors/    # Soroban contributors registry (inter-contract)
│   └── src/lib.rs             # record() gated to the bounty contract
│
├── scripts/deploy-testnet.sh  # reproducible Testnet deployment (both contracts)
├── Dockerfile, backend/Dockerfile, docker-compose.yml
├── docs/                      # ARCHITECTURE, API, DATA, DEPLOYMENT, SECURITY, AUDIT
└── .github/workflows/ci.yml   # format, lint, typecheck, tests, audit, builds
```

## Quick start

### 1. Backend

```bash
cd backend
npm install
cp .env.example .env   # fill in BOUNTY_CONTRACT_ID / DEMO_TOKEN_ID / BOUNTY_ADMIN_ADDRESS
npm run dev            # http://localhost:3001  (indexer + ingestion run on boot)
```

### 2. Frontend

```bash
npm install
npm run dev            # http://localhost:4173
```

Connect the Freighter wallet to fund or release bounties with the RRD demo token.

### 3. Soroban contract

```bash
cd contracts/bounty
cargo test             # 21 unit tests: auth, validation, idempotency, inter-contract
cargo clippy --all-targets -- -D warnings
cargo fmt --check
cd ../contributors
cargo test             # 7 unit tests: auth, validation, accumulation, events
cargo clippy --all-targets -- -D warnings
cargo fmt --check
```

## Testing

Every layer has automated tests, and CI runs all of them on every push/PR:

```bash
# Frontend (30 tests): wallet flow, verification panel, charts, copy, wrong-network
cd . && npm ci && npm test

# Backend (46 tests): API routes, ingestion, analytics, indexer hardening
cd backend && npm ci && npm test

# Soroban contracts (21 + 7 tests): auth, validation, idempotency, inter-contract
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
- Per-IP rate limiting on the API; CORS locked to the frontend origin.
- Soroban contracts use `require_auth` on every privileged path; the registry only
  accepts writes from the bounty contract.
- CI runs **gitleaks** secret scanning, **Trivy** image + filesystem scans,
  **CycloneDX SBOMs**, and `npm audit` — plus both Dockerfiles run as non-root users.

## Monitoring

Prometheus-format metrics at `GET /metrics`; a provisioned Prometheus + Grafana
stack ships in `monitoring/` (see [`docs/MONITORING.md`](./docs/MONITORING.md)).

## Docker

```bash
cp .env.example .env    # or export the BOUNTY_* variables
docker compose up --build
# frontend → http://localhost:8080  (proxies /api to the backend)
# prometheus → http://localhost:9090 · grafana → http://localhost:3000
```

## Testnet deployment

`scripts/deploy-testnet.sh` reproduces the live deployment end-to-end: it builds both
WASMs, funds a fresh account via Friendbot, deploys the bounty contract, the
contributors registry, and the RRD demo token, initialises the registry (allowed
caller = bounty) and the bounty (admin + registry), and writes
`backend/.env.deployed`. See [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md).

## Documentation

- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — system design and data flow
- [`docs/API.md`](./docs/API.md) — REST API reference
- [`docs/DATA.md`](./docs/DATA.md) — data-ingestion pipeline, validation, and analytics
- [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) — Testnet deployment + live addresses
- [`docs/SECURITY.md`](./docs/SECURITY.md) — threat model, secrets, hardening
- [`docs/MONITORING.md`](./docs/MONITORING.md) — /metrics, Prometheus, Grafana
- [`docs/CONTRIBUTOR_GUIDE.md`](./docs/CONTRIBUTOR_GUIDE.md) — how to contribute
- [`docs/AUDIT.md`](./docs/AUDIT.md) — prototype→production audit findings

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) and [`docs/CONTRIBUTOR_GUIDE.md`](./docs/CONTRIBUTOR_GUIDE.md).

## Stack

| Layer | Tech |
|---|---|
| Frontend | React 18, Vite 6, TypeScript, Freighter |
| Backend | Node.js, Express 4, `node:sqlite`, `@stellar/stellar-sdk` 16 |
| Smart contract | Rust, Soroban SDK 27 |
| Blockchain | Stellar Testnet (Soroban RPC + Horizon) |
| CI | GitHub Actions: prettier, eslint, tsc, vitest, cargo fmt/clippy/test, gitleaks, Trivy, SBOM, npm audit |