# Roadmap

Status key: ✅ implemented · 🚧 in progress · 🔲 planned

## Phase 1 — Verifiable on-chain platform ✅

- ✅ Soroban bounty contract (`create` / `release` / `reclaim`) with typed events
  and 19 unit tests (auth, validation, replay/idempotency, failures).
- ✅ Live Testnet deployment: bounty contract + RRD demo token + initialisation
  (IDs recorded in `docs/DEPLOYMENT.md`).
- ✅ Backend read-model: SQLite schema, Soroban RPC client, event indexer,
  transaction relay (build → wallet sign → submit).
- ✅ End-to-end Testnet proof script with recorded transaction hashes.
- ✅ CI: format, lint, typecheck, contract + app tests, dependency audit, builds.

## Phase 2 — Data and signal build ✅

- ✅ Curated regulatory dataset (20 records with primary sources) and idempotent
  ingestion pipeline with validation + classification (`docs/DATA.md`).
- ✅ Deterministic analytics: jurisdiction/category/severity/year distributions and
  the documented risk index.
- ✅ Dashboard sections for bounties, contract events, and regulatory analytics.

## Phase 3 — Hardening and scale 🔲

- 🚧 Metrics endpoint exists (`GET /metrics`); wire Prometheus/Grafana dashboards.
- 🔲 Structured audit trail for admin actions (release/reclaim) beyond raw events.
- 🔲 GitHub issues integration (`GITHUB_REPO` / `GITHUB_TOKEN` already supported by
  the ingestion pipeline — populate with real issue data and document it).
- 🔲 Mainnet readiness: config audit, deployment guide for mainnet, and a
  permissioned release flow.
- 🔲 Webhook/websocket push so the dashboard updates without polling.

## Phase 4 — Community growth 🔲

- 🔲 Curate a backlog of issues with clear scope and acceptance criteria.
- 🔲 Add `good first issue`, `help wanted`, and `research` labels.
- 🔲 Interactive charts and policy heat maps over the analytics API.
- 🔲 Accessibility and readability pass on the dashboard.