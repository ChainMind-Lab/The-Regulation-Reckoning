# Data Ingestion, Validation, and Analytics

The regulatory dataset is **curated, citable, and version-controlled**, not scraped at
runtime. The pipeline is deterministic and idempotent: re-running it never duplicates
rows and always produces the same analytics.

## Sources

| Dataset | File | Contents |
|---|---|---|
| Regulatory events | `backend/data/policy-regulations.json` | 20 records: stablecoin, sanctions, AML, crypto markets, cross-border payments, securities, consumer/data protection, taxation, operational resilience — each with a primary source URL |
| Seed issues | `backend/data/seed-issues.json` | 6 open issues used when no GitHub integration is configured |

Every policy record carries `source_name` and `source_url` so claims are verifiable.

## Pipeline (`backend/src/services/ingest/`)

### `ingestPolicies()`

1. **Load** — read `policy-regulations.json` (embedded in the Docker image).
2. **Validate** — reject records that fail shape checks: required string fields,
   `eventDate` parseable as ISO date, `severity` integer in `1..5`, `category` in the
   known classification taxonomy, jurisdiction non-empty.
3. **Classify** — normalize category slugs (`anti-money-laundering`, …) and severity
   tiers; derive the year used by analytics.
4. **Persist** — UPSERT into `regulatory_events` keyed by `id` (source + date), so
   re-runs update in place. `ingestion_source` is recorded per row.

### `ingestIssues()`

Loads seed issues (or a configured GitHub repo's open issues via `GITHUB_REPO` /
`GITHUB_TOKEN`) and upserts them into `issues` keyed by `id` with `state`.

### Idempotency

Both pipelines use `INSERT … ON CONFLICT DO UPDATE`. Running them N times yields the
same table contents and the same analytics output.

## Persistence (`backend/src/db.ts`)

SQLite (`node:sqlite`, no native deps) at `data/regulation-reckoning.db`:

- `regulatory_events(id, title, jurisdiction, category, event_date, severity, summary, source_name, source_url, ingestion_source)`
- `issues(id, repo, title, points, tags, state, source, ingested_at)`
- `soroban_events(id, tx_hash UNIQUE, ledger, contract_id, topic, issue_id, payload, created_at)`
- `bounties(issue_id PRIMARY KEY, funder, contributor, token, amount, released, created_tx, released_tx, updated_at)` — derived from indexed events

## Analytics (`backend/src/services/analytics.ts`)

Pure functions over the persisted rows — deterministic, unit-tested, no randomness:

- `totals` — event count, distinct jurisdictions/categories, average severity.
- `byJurisdiction`, `byCategory`, `bySeverity`, `byYear` — distribution maps.
- **Risk index (0–100)**: `round( Σ(severity × category_weight) / (N × 5) × 100 )`
  where category weights are:

  | Category | Weight |
  |---|---|
  | stablecoin-regulation, sanctions | 1.0 |
  | anti-money-laundering | 0.9 |
  | crypto-markets | 0.8 |
  | cross-border-payments | 0.7 |
  | securities | 0.6 |
  | consumer-protection | 0.5 |
  | data-protection | 0.4 |
  | taxation, operational-resilience | 0.3 |

  Weights are a documented editorial policy: the more directly a category constrains
  Stellar-native issuers and rails, the higher its weight.

## Operations

- Runs automatically on boot (`INGEST_ON_START=true`), only when tables are empty
  unless `REINGEST_ON_START=true`.
- Manual re-run: `cd backend && npm run ingest`, or `POST /api/ingest/run`
  (bearer-token protected when `ADMIN_TOKEN` is set).
- Tests: `backend/test/ingest.test.ts` covers validation failures, idempotency,
  classification, and analytics determinism.