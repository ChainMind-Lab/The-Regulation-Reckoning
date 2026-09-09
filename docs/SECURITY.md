# Security

This document describes the security posture of the application: the threat model,
secrets handling, transport, contract hardening, and the checks enforced in CI.

> Status: Testnet application. Treat the deployed contract and demo token as
> test artifacts. The admin secret grants on-chain control of the Testnet contract
> only. Nothing here is configured for mainnet.

## Threat model

| Asset | Threat | Mitigation |
|---|---|---|
| Admin secret key (`BOUNTY_ADMIN_SECRET`) | Exfiltration → attacker releases/reclaims all bounties | Environment-only; never committed, never returned by any API; `.env*` gitignored; `backend/.env.deployed` written with `chmod 600`; the e2e script receives it via env var only |
| Wallet signing | Malicious site tricks user into signing a harmful tx | The backend only builds whitelisted contract calls (`create`, `release`, `reclaim`, `init`) with validated args; the wallet signs the exact XDR the user is shown |
| Transaction replay | Re-submitting a signed XDR to double-spend | Soroban transactions are single-use (sequence numbers); the contract itself treats re-create/release/reclaim as errors, never as second payouts (unit-tested) |
| API abuse | Brute force, scraping, memory exhaustion | Per-IP sliding-window rate limiting (`RATE_LIMIT_WINDOW_MS`/`RATE_LIMIT_MAX`); JSON body limited to 256 KB; `x-powered-by` disabled |
| Ingested data | Malformed/malicious records | Validation at ingestion time (shape, enums, severity bounds); row counts are bounded; `ADMIN_TOKEN` gates manual re-runs |
| Dependency supply chain | Compromised packages | `npm audit --audit-level=high` runs in CI; lockfiles committed; `npm ci` used in CI and Docker |
| Secrets in logs/errors | Admin address/secret leakage | Logs redact secrets (only addresses/ids are logged); API errors return generic messages with machine codes |

## Secrets handling

- `BOUNTY_ADMIN_SECRET` (the deploy account's secret key) is **not** read by the
  backend at all — it is only used by the e2e script and the deploy script. The
  backend needs only the public `BOUNTY_ADMIN_ADDRESS`.
- `ADMIN_TOKEN` guards `/api/ingest/run` when set; pass it via environment, not config files.
- `.gitignore` excludes `.env`, `.env.*`, `*.local`, and the backend DB.
- `backend/.env.deployed` is generated with `chmod 600` by `scripts/deploy-testnet.sh`.

## Transport and CORS

- CORS is locked to `FRONTEND_URL` (default `http://localhost:4173`).
- Behind the Docker frontend, nginx proxies `/api` and `/health` to the backend.
- For real deployments, terminate TLS at the proxy and set
  `trust proxy` appropriately so rate limiting keys real client IPs
  (see `backend/src/server.ts`).

## Contract hardening (`contracts/bounty`)

- **Authorization**: `release` requires the admin's signature; `reclaim` requires the
  funder's signature; `create` requires the funder's authorization to transfer the
  escrowed tokens (`require_auth` on every privileged path).
- **Validation**: amounts must be `> 0`; issue IDs are non-empty strings; duplicate
  creation, release, or reclaim is rejected with typed errors (`AlreadyExists`,
  `NotFunded`, `NotReleased`…).
- **Events**: every state change emits a typed event with enough data for indexers
  (funder, contributor, amount, issue id) — no sensitive data is emitted.
- 19 unit tests cover authorization failures (wrong caller), invalid inputs,
  idempotency/replay, and event contents.

## CI security checks

`.github/workflows/ci.yml` runs for every push/PR:

- `npm audit --audit-level=high` (frontend + backend)
- `cargo clippy --all-targets -- -D warnings` and `cargo fmt --check`
- lint (ESLint), typecheck (`tsc --noEmit`), full test suites, and production builds

## Reporting a vulnerability

Open a private issue in this repository (label `security`) describing the behavior.
Do not include secret values in the report. See the repository `SECURITY.md`.