# Contributing

Thanks for contributing to The Regulation Reckoning — a Soroban bounty platform on
Stellar Testnet. Read [`docs/CONTRIBUTOR_GUIDE.md`](./docs/CONTRIBUTOR_GUIDE.md) first.

## Contribution pathways

- **Soroban contract** (`contracts/bounty`) — new contract features, hardening,
  event schema changes. Rust + `soroban-sdk` 27.
- **Backend** (`backend/`) — API routes, ingestion pipeline, event indexer,
  analytics, observability. TypeScript + Express + `node:sqlite`.
- **Frontend** (`src/`) — dashboard components, wallet flows, data presentation.
  React 18 + Vite.
- **Data** (`backend/data/`) — regulatory records. Every entry must carry a
  verifiable `source_url` and fit the documented taxonomy (`docs/DATA.md`).
- **Docs / CI / Docker** — documentation, workflows, deployment tooling.

## Development workflow

1. Find or open an issue with clear scope and acceptance criteria.
2. Fork, branch (`git checkout -b feat/...`), implement.
3. Run the checks below locally — CI runs the same ones.
4. Open a PR referencing the issue; explain the impact in the description.

## Required checks

| Check | Command |
|---|---|
| Frontend format | `npm run format:check` |
| Frontend lint | `npm run lint` |
| Frontend typecheck | `npx tsc --noEmit` |
| Frontend tests | `npm test` |
| Frontend build | `npm run build` |
| Backend format/lint/typecheck | `cd backend && npm run format:check && npm run lint && npm run typecheck` |
| Backend tests | `cd backend && npm test` |
| Backend build | `cd backend && npm run build` |
| Contract format | `cd contracts/bounty && cargo fmt --check` |
| Contract lint | `cd contracts/bounty && cargo clippy --all-targets -- -D warnings` |
| Contract tests | `cd contracts/bounty && cargo test` |

CI additionally runs `npm audit --audit-level=high` on both Node packages.

## Pull request expectations

- One objective per PR; keep it scoped.
- Include tests for behavior changes (contract: failure cases; backend: unit +
  integration; frontend: component tests).
- Do not commit `.env*` files, the SQLite DB, or any secret.
- If you change the contract, run `cargo test` and note whether a Testnet redeploy
  is required (see `docs/DEPLOYMENT.md`).