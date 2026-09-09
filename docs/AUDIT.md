# Audit — The Regulation Reckoning (prototype → production)

Audit date: 2026-09-09
Audit scope: entire repository (frontend, backend, Soroban contract, CI, docs, config, metadata).

## Method

Every claim in the README, docs, ROADMAP, and source comments was checked against
working code, tests, deployed artifacts, and reproducible commands. Anything
described but not demonstrably implemented or verifiable was recorded below with
its disposition.

---

## A. Described but not implemented (all fixed in this upgrade)

| # | Claim / feature | Where described | Actual state found | Disposition |
|---|---|---|---|---|
| 1 | "full-stack Stellar-native platform" with wallet connection | README, hero copy | No wallet integration anywhere; no `freighterApi` usage; no transaction building or signing | Implemented: Freighter wallet connect, `POST /api/tx/build` + `POST /api/tx/submit`, signed Soroban transactions |
| 2 | Soroban contract deployed to Testnet, `BOUNTY_CONTRACT_ID` in `.env.example` | README, contracts/README, .env.example | Contract existed as source only; no deployment scripts; no recorded contract ID; no transaction hashes | Deployed to Stellar Testnet; real contract ID and transaction hashes recorded in `docs/DEPLOYMENT.md` and `scripts/deploy-testnet.sh` |
| 3 | Contract emits / app consumes meaningful events | contracts/README ("on-chain escrow") | Contract emitted **no events** (`env.events()` never used) | Contract now emits `bounty_created`, `bounty_released`, `bounty_reclaimed`, `admin_initialised`; backend indexer consumes them via Soroban RPC `getEvents` |
| 4 | "live regulatory signal feed", "policy jurisdiction mapping with Stellar network data" | issue titles in `/api/issues`, `src/data/openIssues.ts` | Static, hand-written JSON hardcoded in the backend route; not ingested, validated, or persisted | Implemented: data-ingestion pipeline (`backend/src/services/ingest/`), schema validation, classification, SQLite persistence, `/api/policies` + `/api/analytics` |
| 5 | Wave stats: "540+ repos", "74k+ issues", "$75,000 budget" | README, WaveBanner, `/api/wave`, `src/data/waveInfo.ts` | Fabricated static numbers with no source | Removed unverifiable totals; `/api/wave` now serves only verifiable data; totals computed from real ingested data |
| 6 | GitHub issue links to `The-Regulation-Reckoning` org | HeroSection, openIssues.ts | Nonexistent GitHub org (real repo is `ChainMind-Lab/The-Regulation-Reckoning`) | Replaced with real repo links; issues served from ingestion pipeline (GitHub API when configured, seed fallback otherwise) |
| 7 | `docs/ARCHITECTURE.md` references `content/` and `analysis/` layers | docs/ARCHITECTURE.md | Directories do not exist anywhere in the repo | Rewritten to describe the real architecture (frontend/backend/contracts/data) with a diagram |
| 8 | Contributor guide references `content/chapters/` and `analysis/` ETL | docs/CONTRIBUTOR_GUIDE.md | Directories do not exist | Rewritten to describe real contribution areas |
| 9 | ROADMAP "Phase 1–4" describing unreleased plans as status | ROADMAP.md | Template-style generic roadmap, no links to actual issues | Rewritten as a concrete roadmap tied to real implemented features |
| 10 | `.env.example` starts with a stray `[TEMPLATE]` marker | .env.example | Leftover template artifact | Removed; file documented and validated by `backend/src/config.ts` |
| 11 | "View all 74k+ issues →" link to Drips Wave | src/App.tsx | Unverifiable count | Removed fabricated count; kept the Drips program link (project funding program) |
| 12 | Backend `/api/wave` and `/api/issues` return static data | backend/src/routes/api.ts | Hardcoded responses | Now served from persisted, ingested data (issues + policies), with provenance (`source`) |
| 13 | No event indexing / no dashboard of on-chain state | README "on-chain signal analysis" | Backend never read contract events; frontend never showed bounty state | Implemented: indexer polls RPC events → SQLite → `/api/bounties`, `/api/events` → dashboard UI |
| 14 | No analytics | README "signal analysis" | No computation anywhere | Implemented deterministic analytics (`/api/analytics`) with tests over the ingested policy dataset |
| 15 | No persistence | README "platform" | Backend was stateless; nothing stored | SQLite (Node built-in `node:sqlite`) with schema + migrations |
| 16 | No production ops concerns | — | No logging, metrics, rate limiting, health readiness, secrets validation | Implemented: structured JSON logging, Prometheus `/metrics`, in-memory rate limiter, `/health` + `/health/ready`, env-config validation, no-secrets-in-code |
| 17 | CI claims "typecheck, build, test" but no formatting/lint/security | .github/workflows/ci.yml | CI ran tsc/tests/build only | Added Prettier, ESLint, `rustfmt`/`clippy`, `npm audit`, build verification |
| 18 | `src/lib/stellar.ts` `getWaveInfo`/`getOpenIssues` | src/lib/stellar.ts | Dead code — never imported | Removed; replaced by typed `src/lib/api.ts` |
| 19 | `stellar-sdk` in root `package.json` | package.json | Unused (frontend never imports it); backend version (10.4.1) lacks Soroban RPC support | Removed from root; backend upgraded to `@stellar/stellar-sdk` v16 (fixes the `toml` advisory via `smol-toml`) |
| 20 | No Docker, no deployment scripts, no API docs, no security doc | — | None existed | Added Docker (frontend+backend), `scripts/deploy-testnet.sh`, `docs/API.md`, `docs/SECURITY.md`, `docs/DEPLOYMENT.md` |

## B. Things that were real and are retained

- **Horizon live network status** (`GET /api/network`) — real, tested against Horizon.
- **Recent payments** (`GET /api/payments`) — real Horizon data.
- **Soroban bounty contract logic** (`create`/`release`/`reclaim`/`get_bounty`) — real, but upgraded (events, hardening, tests).
- **Drips Wave 5 program participation** — this repository is part of the Stellar Drips Wave 5 program; program links and attribution retained (no fabricated stats).
- **MIT license, code of conduct, issue/PR templates** — retained; PR template wording updated to the real repo structure.

## C. Verification evidence

Every item above is backed by one of:

- source code in this repository (run `npm test`, `npm run build`, `cargo test`),
- real deployed artifacts: see `docs/DEPLOYMENT.md` (contract ID, token ID, transaction hashes, explorer links),
- reproducible commands: see `scripts/deploy-testnet.sh`, `docs/DEPLOYMENT.md`, and the e2e test (`npm run e2e` in `backend/`).