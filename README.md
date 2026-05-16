# The Regulation Reckoning

**Stellar Drips Wave 5** — open-source contributor platform for regulatory resilience and on-chain signal analysis.

[![Stellar](https://img.shields.io/badge/Stellar-Wave%205-6382ff)](https://www.drips.network/wave/stellar)
[![Soroban](https://img.shields.io/badge/Soroban-Smart%20Contracts-rust)](./contracts)

## What this is

A full-stack Stellar-native platform that maps how global regulations shape network health, project survival, and the Web3 ecosystem. Contributors earn Drips Wave Points by fixing issues — redeemable for real rewards from the Wave 5 reward pool.

## Project structure

```
.
├── src/                    # React frontend (Vite + TypeScript)
│   ├── components/         # NavBar, HeroSection, WaveBanner, NetworkStatusCard,
│   │                       # IssueCard, TopicCard, ContributorCTA
│   ├── data/               # policyTopics, openIssues, waveInfo
│   ├── lib/stellar.ts      # API client (calls backend)
│   └── styles/global.css   # Dark theme, Stellar blue palette
│
├── backend/                # Node.js / Express API (TypeScript)
│   └── src/
│       ├── server.ts       # Entry point (port 3001)
│       ├── routes/api.ts   # GET /api/network, /api/wave, /api/issues, /api/payments
│       └── services/
│           └── horizon.ts  # Stellar Horizon integration (stellar-sdk)
│
├── contracts/              # Soroban smart contracts (Rust)
│   └── bounty/
│       ├── Cargo.toml
│       └── src/lib.rs      # BountyContract — on-chain escrow for Wave bounties
│
├── docs/                   # Architecture and contributor documentation
├── .env.example            # All environment variables
└── README.md
```

## Quick start

### Frontend

```bash
npm install
npm run dev          # http://localhost:4173
```

### Backend

```bash
cd backend
npm install
npm run dev          # http://localhost:3001
```

### Smart contracts

```bash
cd contracts/bounty
cargo test           # run unit tests
stellar contract build
```

See [`contracts/README.md`](./contracts/README.md) for deploy instructions.

## Environment variables

Copy `.env.example` to `.env` and fill in:

| Variable | Description |
|---|---|
| `VITE_API_URL` | Backend API URL (frontend) |
| `PORT` | Backend server port |
| `HORIZON_URL` | Stellar Horizon endpoint |
| `BOUNTY_CONTRACT_ID` | Deployed Soroban contract ID |
| `SOROBAN_RPC_URL` | Soroban RPC endpoint |

## Contributing — Stellar Drips Wave 5

This repo is approved for the [Stellar Wave Program](https://www.drips.network/wave/stellar). Every merged PR earns Points toward the Wave 5 reward pool.

1. Browse [open issues](https://www.drips.network/wave/stellar/issues) tagged for this repo
2. Fork, fix, open a PR
3. Get merged → earn Points → redeem rewards

Read [`CONTRIBUTING.md`](./CONTRIBUTING.md) before submitting.

## Stack

| Layer | Tech |
|---|---|
| Frontend | React 18, Vite 6, TypeScript |
| Backend | Node.js, Express 4, TypeScript |
| Smart contracts | Rust, Soroban SDK 21 |
| Blockchain | Stellar (Horizon + Soroban) |
| Funding | Stellar Drips Wave 5 |
