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

## Contract hardening

### `contracts/bounty`

- **Authorization**: `release` requires the admin's signature; `reclaim` requires the
  funder's signature; `create` requires the funder's authorization to transfer the
  escrowed tokens (`require_auth` on every privileged path).
- **Inter-contract auth**: on `release`, the bounty contract calls the contributors
  registry's `record` with its own auth; the registry rejects any other caller
  (`allowed_caller.require_auth()`), so only the bounty can write stats.
- **Validation**: amounts must be `> 0`; issue IDs are non-empty strings; duplicate
  creation, release, or reclaim is rejected with typed errors (`AlreadyExists`,
  `NotFunded`, `NotReleased`…).
- **Events**: every state change emits a typed event with enough data for indexers
  (funder, contributor, amount, issue id) — no sensitive data is emitted.
- 21 unit tests cover authorization failures (wrong caller), invalid inputs,
  idempotency/replay, event contents, and the inter-contract registry write.

### `contracts/contributors`

- **Authorization**: `record` requires the allowed caller (the bounty contract) to
  have authorized the invocation — direct calls from any other address are rejected
  (unit-tested with granular auth mocks).
- **Validation**: contributor must be a valid address; amounts must be `> 0`;
  duplicate records for the same issue id are rejected.
- 7 unit tests cover authorization, validation, accumulation math, and events.

## Indexer resilience

- Duplicate-event protection (unique `(tx_hash, topic, ledger)` constraint).
- Cursor persistence + restart recovery (`indexer_cursor` table).
- RPC-failure containment (bounded retries, no crash, health reflects `soroban_up`).
- Ledger-gap detection when the RPC returns a non-contiguous cursor.
- DB-failure rollback: a failed insert rolls back the batch without corrupting the
  cursor. (14 indexer tests, including injected RPC/DB failures.)

## CI security checks

`.github/workflows/ci.yml` runs for every push/PR:

- **gitleaks** secret scanning (full history)
- **Trivy** container-image scans (backend + frontend) and filesystem scan,
  HIGH/CRITICAL, SARIF uploaded to the Security tab
- **CycloneDX SBOM** generated for both Node packages and uploaded as artifacts
- `npm audit --audit-level=high` (frontend + backend)
- `cargo clippy --all-targets -- -D warnings` and `cargo fmt --check` (both contracts)
- lint (ESLint), typecheck (`tsc --noEmit`), full test suites, and production builds
- Dockerfiles run as non-root (backend `node` user, nginx `nginx` user); nginx sets
  security headers (X-Content-Type-Options, X-Frame-Options, Referrer-Policy,
  Permissions-Policy)

## Reporting a vulnerability

Open a private issue in this repository (label `security`) describing the behavior.
Do not include secret values in the report. See the repository `SECURITY.md`.