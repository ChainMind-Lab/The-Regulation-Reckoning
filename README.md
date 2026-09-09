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
| Bounty contract | `CC2YEX6U7HV7L7L45HVOLVWGN2POARLPS3XICZS6KQH5Y52OTAHK7LVY` |
| Demo token (RRD, SAC) | `CCOAF5DIHLO4457S6EGQYSLXGGDRQPTO42DU6N5KVH4M2MSA2VDW2NB4` |
| Contract admin | `GBRVOQSLP32BGOCYA56DCTM5PUQWW7YLBBAKVXBHDTJ6SNKVLGMWFRQI` |
| Network | Stellar Testnet (`soroban-testnet.stellar.org`) |

The end-to-end proof (frontend action → Freighter-style signature → Soroban transaction →
event indexing → backend → dashboard) is a runnable script with recorded transactions:

- Mint 1,000 RRD to funder: `3902c7e5bab688042852552fb2da1d6107570d47367d4552a16e54f5145b5188`
- Create bounty `repo#42`: `88e97e1750253c8bedc88383d28c37dcf9834d9168a7e2bbc2461948b48d72c6`
- Release bounty to contributor: `ee7f058ece2d81519c4762e265f82d277b2a245537878db4ef60e197db92c901`

View them on the [Testnet explorer](https://stellar.expert/explorer/testnet) or re-run the
whole flow yourself:

```bash
cd backend
npm run build
BOUNTY_CONTRACT_ID=CC2YEX6U7HV7L7L45HVOLVWGN2POARLPS3XICZS6KQH5Y52OTAHK7LVY \
DEMO_TOKEN_ID=CCOAF5DIHLO4457S6EGQYSLXGGDRQPTO42DU6N5KVH4M2MSA2VDW2NB4 \
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
├── contracts/bounty/          # Soroban bounty contract (Rust, soroban-sdk 27)
│   └── src/lib.rs             # create/release/reclaim + typed events, 19 tests
│
├── scripts/deploy-testnet.sh  # reproducible Testnet deployment
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
cargo test             # 19 unit tests: auth, validation, idempotency, events
cargo clippy --all-targets -- -D warnings
cargo fmt --check
```

## Docker

```bash
cp .env.example .env    # or export the BOUNTY_* variables
docker compose up --build
# frontend → http://localhost:8080  (proxies /api to the backend)
```

## Testnet deployment

`scripts/deploy-testnet.sh` reproduces the live deployment end-to-end: it builds the
WASM, funds a fresh account via Friendbot, deploys the bounty contract and the RRD
demo token, initialises the contract, and writes `backend/.env.deployed`. See
[`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md).

## Documentation

- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — system design and data flow
- [`docs/API.md`](./docs/API.md) — REST API reference
- [`docs/DATA.md`](./docs/DATA.md) — data-ingestion pipeline, validation, and analytics
- [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) — Testnet deployment + live addresses
- [`docs/SECURITY.md`](./docs/SECURITY.md) — threat model, secrets, hardening
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
| CI | GitHub Actions: prettier, eslint, tsc, vitest, cargo fmt/clippy/test, npm audit |