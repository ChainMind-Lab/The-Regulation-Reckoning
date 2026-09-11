# Roadmap

Status key: ✅ implemented · 🚧 in progress · 🔲 planned

## Phase 1 — Verifiable on-chain platform ✅

- ✅ Soroban bounty contract (`create` / `release` / `reclaim`) with typed events
  and 21 unit tests (auth, validation, replay/idempotency, failures, inter-contract) —
  the v1 foundation, extended by Phase 3 (now 47 tests).
- ✅ Contributors registry contract (7 tests, now 18 with reputation) with strict
  caller authorization; the bounty contract writes payouts to it via
  `env.invoke_contract` (inter-contract communication, proven live on Testnet).
- ✅ Live Testnet deployment: bounty contract + contributors registry + RRD demo
  token + initialisation (IDs and proof transactions recorded in
  `docs/DEPLOYMENT.md`).
- ✅ Backend read-model: SQLite schema, Soroban RPC client, hardened event indexer
  (cursor persistence, duplicate protection, RPC-failure containment, ledger-gap
  detection, DB-failure rollback — 25 indexer tests), transaction relay
  (build → wallet sign → submit). Events from **both** contracts (bounty +
  registry) are indexed.
- ✅ End-to-end Testnet proof script that asserts the full chain — frontend action →
  wallet signature → Soroban tx → bounty→registry call → event → indexer → DB →
  API → dashboard — with recorded transaction hashes.
- ✅ CI: format, lint, typecheck, contract + app tests, dependency audit, secret
  scanning (gitleaks), Trivy image + filesystem scans, SBOM (CycloneDX), builds.

## Phase 2 — Data and signal build ✅

- ✅ Curated regulatory dataset (20 records with primary sources), idempotent
  ingestion pipeline with validation + classification, enriched with curated
  ecosystem-impact areas and project-survival signals (`docs/DATA.md`).
- ✅ Deterministic analytics: jurisdiction/category/severity/year distributions,
  documented risk index, **monthly policy timeline**, **jurisdiction × category
  risk heat map**, **ecosystem-impact aggregation**, **survival-signal
  aggregation**, and **per-jurisdiction risk**.
- ✅ Dashboard sections for bounties, contract events, on-chain verification panel
  (copyable addresses + tx history), and the full regulatory intelligence panel
  with charts and heat map.

## Phase 3 — Milestones, governance & regulatory intelligence ✅

- ✅ **Milestone-based escrow:** `create_bounty` with 1–20 milestones, `claim`, and
  per-milestone `milestone_released` payouts, alongside the v1-compatible single-amount
  `create` path (47 bounty-contract tests).
- ✅ **Reviewer quorum:** `submit_review` (approve/reject) from assigned reviewers only;
  a milestone cannot be released until the configured quorum approves.
- ✅ **Disputes:** `open_dispute` / `vote_on_dispute` / resolution, settling a milestone by
  paying the contributor or refunding the funder, with outcomes recorded on-chain.
- ✅ **Multisig governance:** signer sets and thresholds managed through proposals
  (`propose` → `approve`/`revoke`/`cancel` → execute) covering release, refund, signer
  rotation, reviewer assignment and dispute resolution.
- ✅ **Verifiable reputation:** the contributors registry records payouts, upheld reviews
  and dispute outcomes and exposes a derived score (18 registry tests); the API
  reconciles on-chain reputation against the indexed mirror and serves a leaderboard.
- ✅ **Regulation change detection:** append-only, content-hashed revision history with
  field-level diffs and severity-classified alerts (`/api/regulations/*`, `/api/alerts`).
- ✅ **Jurisdiction comparison:** per-jurisdiction profiles and side-by-side comparison
  where every cell carries its primary sources (`/api/jurisdictions*`).
- ✅ **Dashboard panels** for milestones/reviews/disputes, multisig governance,
  regulation history & alerts, jurisdiction comparison and reputation.
- ✅ **Typed TypeScript SDK** (`sdk/`, `@regulation-reckoning/sdk`) covering the whole API.

## Phase 4 — Hardening and scale 🚧

- ✅ Metrics endpoint (`GET /metrics`); contract/registry/network gauges published,
  HTTP responses counted by method+status for every request, and Prometheus-valid
  (cumulative, `+Inf`) histograms.
- ✅ Prometheus + Grafana stack shipped in-repo (`monitoring/`): provisioned
  datasource + dashboard covering upstream health, indexer throughput, Soroban
  latency, HTTP status, and ingestion rates (`docs/MONITORING.md`).
- ✅ On-chain storage hardening: bounties, milestones, reviews, disputes, proposals and
  reputation statistics use persistent storage with TTL extension; instance storage is
  limited to the admin/signer configuration.
- 🔲 **Reclaim deadline (requires a redeploy):** add a reclaim deadline so a funder
  cannot cancel a bounty after work is done.
- 🔲 Reverse-proxy-ready rate limiting beyond a single instance (shared store).
- ✅ On-chain verification panel: deployed contract IDs, admin, network, and
  successful transaction history with copy buttons and explorer links.
- ✅ Frontend wallet hardening: wrong-network detection, disconnection, copyable
  addresses/hashes, skeleton loading states, mobile-responsive layout.
- 🔲 Structured audit trail for admin actions (release/reclaim) beyond raw events
  and on-chain registry stats.
- 🔲 GitHub issues integration (`GITHUB_REPO` / `GITHUB_TOKEN` already supported by
  the ingestion pipeline — populate with real issue data and document it).
- 🔲 Mainnet readiness: config audit, deployment guide for mainnet, and a
  permissioned release flow.
- 🔲 Webhook/websocket push so the dashboard updates without polling.

## Phase 5 — Community growth 🔲

- 🔲 Curate a backlog of issues with clear scope and acceptance criteria.
- 🔲 Add `good first issue`, `help wanted`, and `research` labels.
- ✅ Interactive charts and policy heat maps over the analytics API (deployed in
  the dashboard).
- 🔲 Accessibility and readability pass on the dashboard (semantic markup in
  place; full audit pending).