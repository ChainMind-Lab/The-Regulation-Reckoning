# Contributor Guide

This guide maps the real codebase so new contributors can find their way around and
know what "done" looks like for each area.

## Repo map

```
src/               React dashboard — wallet (Freighter), bounty flows, events, policies
backend/src/       Express API + SQLite read-model + ingestion + indexer
backend/e2e/       Live Testnet proof script
contracts/bounty/  Soroban bounty contract (Rust)
docs/              Architecture, API, Data, Deployment, Security, Audit
scripts/           deploy-testnet.sh (reproducible Testnet deployment)
```

## Areas and "done" definitions

### Contract (`contracts/bounty/src/lib.rs`)

- Every public function handles auth, validation, and failure cases — mirror the
  existing 19 tests.
- Any state change emits a typed event (`#[contractevent]`) so indexers can derive
  state; extend `backend/src/services/indexer.ts` and the events table when the
  event set changes.
- Run `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`.
- Note in the PR whether the Testnet deployment must be redone (`docs/DEPLOYMENT.md`).

### Backend (`backend/src/`)

- Routes live in `routes/api.ts` with `asyncHandler`; errors are `ApiError`
  instances with machine codes, documented in `docs/API.md`.
- State served to clients must come from the read-model (SQLite) or live Stellar
  reads — never from in-memory mocks.
- New endpoints need tests in `backend/test/` (unit + API integration with mocked
  Stellar services) and an `docs/API.md` entry.

### Frontend (`src/`)

- Components are presentational; data comes from `lib/api.ts`. Wallet interactions
  go through `lib/wallet.ts` (Freighter) — never handle secret keys.
- New UI needs a component test in `src/test/components.test.tsx` (loading, error,
  and success states).

### Data (`backend/data/`)

- Every regulatory record needs `source_name` + `source_url` (primary, citable).
- Follow the taxonomy in `docs/DATA.md`; keep `id` stable (source + date) so
  upserts are idempotent.

## Quality expectations

- PRs must pass the checks listed in `CONTRIBUTING.md` (CI runs the same set).
- Explain the impact and reference the issue.
- Never commit secrets, `.env*` files, or the SQLite database.
- When behavior changes, update the relevant doc (`docs/API.md`, `docs/DATA.md`,
  `docs/DEPLOYMENT.md`, `docs/ARCHITECTURE.md`).