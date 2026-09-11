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
| Wallet signing | Malicious site tricks user into signing a harmful tx | The backend only builds whitelisted user-facing calls (`create`, `createBounty`, `claim`, `reclaim`, `propose*`, `approve`, `revoke`, `cancel`, `submitReview`, `openDispute`, `voteDispute`) with validated args; the privileged one-time `init` is not buildable through the relay; the wallet signs the exact XDR the user is shown |
| Transaction replay | Re-submitting a signed XDR to double-spend | Soroban transactions are single-use (sequence numbers); the contract itself treats re-create/release/reclaim as errors, never as second payouts (unit-tested) |
| API abuse | Brute force, scraping, memory exhaustion | Per-IP fixed-window rate limiting (`RATE_LIMIT_WINDOW_MS`/`RATE_LIMIT_MAX`; set `TRUST_PROXY=true` behind a proxy); JSON body limited to 256 KB; `x-powered-by` disabled |
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
- For real deployments, terminate TLS at the proxy and set `TRUST_PROXY=true` so rate
  limiting keys on real client IPs instead of the proxy's (see `backend/src/config.ts`;
  the bundled `docker-compose.yml` already sets it for the nginx proxy).

## Contract hardening

### `contracts/bounty`

- **Authorization**: every privileged path uses `require_auth` — `create`/`create_bounty`
  authorize the funder's token transfer, `claim`/`submit_review`/`open_dispute` authorize
  the acting address, `reclaim` authorizes the funder, and every multisig action
  (`propose`/`approve`/`revoke`/`cancel`) requires signer signatures. A privileged action
  (release, refund, signer/reviewer change, dispute resolution) only executes once the
  configured threshold of signer approvals is reached.
- **Inter-contract auth**: on an executed release the bounty contract calls the
  contributors registry's `record`/`record_review` with its own auth; the registry
  rejects any other caller (`allowed_caller.require_auth()`), so only the bounty can write
  stats or reputation.
- **Validation**: amounts must be `> 0`; issue IDs and milestone titles are non-empty;
  milestone counts are bounded (1–20); reviewer quorum and threshold are validated;
  duplicate creation, release, reclaim, review or dispute is rejected with typed errors.
- **Checks-Effects-Interactions**: state is persisted *before* external token transfers
  (and registry calls), so a malicious funder-supplied token cannot re-enter and
  double-spend.
- **Events**: every state change emits a typed event with enough data for indexers
  (funder, contributor, amount, issue id, milestone, decision) — no sensitive data is
  emitted.
- 47 unit tests cover authorization failures (wrong caller, non-signer, non-reviewer),
  invalid inputs, idempotency/replay, milestone and quorum rules, disputes, multisig
  proposals, event contents, and the inter-contract registry writes.

### `contracts/contributors`

- **Authorization**: `record`, `record_review` and `record_dispute` require the allowed
  caller (the bounty contract) to have authorized the invocation — direct calls from any
  other address are rejected (unit-tested with granular auth mocks).
- **Validation**: amounts must be `> 0`, issue IDs non-empty, and review/dispute subjects
  valid.
- **Replay model**: the write entry points are *not* self-guarding — they trust their
  single authorised caller, and the bounty contract is the replay guard (it refuses to
  release the same milestone twice or record the same review/dispute twice). Re-recording
  would increment stats again, which is why authorisation is restricted to exactly the
  bounty contract; replay guards keyed by issue+milestone are also enforced.
- 18 unit tests cover authorization, validation, accumulation math, review/dispute
  accounting, the reputation score formula, and events.

## Indexer resilience

- Duplicate-event protection: events are keyed by the Soroban RPC event id with
  `INSERT … ON CONFLICT DO NOTHING`, so re-indexing a batch is a no-op.
- Cursor persistence + restart recovery (`indexer_state` table).
- RPC-failure containment: a failed pass is logged and retried on the next poll, the
  cursor is preserved, and health reflects `soroban_up`.
- Ledger-gap detection when the RPC returns a non-contiguous cursor.
- DB-failure rollback: a failed insert rolls back the batch without corrupting the cursor.
- 25 indexer tests (`indexer.test.ts` + `indexer-v2.test.ts`), including injected RPC
  and DB failures and the v2 milestone/review/proposal/dispute/reputation rebuilds.

## Monitoring

- `GET /metrics` exposes Prometheus text metrics; `monitoring/` ships a Prometheus
  + Grafana stack provisioned via docker-compose (`docs/MONITORING.md`).
- Grafana runs with sign-up disabled; set `GRAFANA_ADMIN_PASSWORD` and never
  commit a real password.

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

## Known limitations

These are accepted for a Testnet demo and tracked in `ROADMAP.md`. The deployed
contracts are immutable, so the first two require a redeploy to change:

- **Reclaim has no deadline.** A funder can cancel a bounty at any time before release.
- **Registry configuration uses instance storage.** Bounty, milestone, review, dispute,
  proposal and reputation entries are persistent with TTL extension; the registry's
  admin/`allowed_caller` still uses instance storage (acceptable for the demo).
- **The rate limiter is in-memory**, so it is per-instance; multi-instance deployments
  need a shared store.

## Reporting a vulnerability

Open a private issue in this repository (label `security`) describing the behavior.
Do not include secret values in the report. See the repository `SECURITY.md`.