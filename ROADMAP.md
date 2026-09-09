# Roadmap

Status key: ✅ implemented · 🚧 in progress · 🔲 planned

## Phase 1 — Verifiable on-chain platform ✅

- ✅ Soroban bounty contract (`create` / `release` / `reclaim`) with typed events
  and 21 unit tests (auth, validation, replay/idempotency, failures, inter-contract).
- ✅ Contributors registry contract (7 tests) with strict caller authorization;
  the bounty contract writes payouts to it via `env.invoke_contract`
  (inter-contract communication, proven live on Testnet).
- ✅ Live Testnet deployment: bounty contract + contributors registry + RRD demo
  token + initialisation (IDs and proof transactions recorded in
  `docs/DEPLOYMENT.md`).
- ✅ Backend read-model: SQLite schema, Soroban RPC client, hardened event indexer
  (cursor persistence, duplicate protection, RPC-failure containment, ledger-gap
  detection, DB-failure rollback — 14 indexer tests), transaction relay
  (build → wallet sign → submit).
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

## Phase 3 — Hardening and scale 🚧

- ✅ Metrics endpoint (`GET /metrics`); contract/registry/network gauges published.
- 🚧 Prometheus/Grafana dashboards over `/metrics` (endpoint ready; dashboards not
  yet shipped in-repo).
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

## Phase 4 — Community growth 🔲

- 🔲 Curate a backlog of issues with clear scope and acceptance criteria.
- 🔲 Add `good first issue`, `help wanted`, and `research` labels.
- ✅ Interactive charts and policy heat maps over the analytics API (deployed in
  the dashboard).
- 🔲 Accessibility and readability pass on the dashboard (semantic markup in
  place; full audit pending).