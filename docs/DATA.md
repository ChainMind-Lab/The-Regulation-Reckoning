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

### Enrichment (`backend/scripts/enrich-policy-data.mjs`)

Each record is additionally classified with curated **ecosystem-impact areas** and
**project-survival signals** derived deterministically from its category + severity
taxonomy (`impact`, `survivalSignals` columns). The enrichment script is
version-controlled and reproducible (run: `node backend/scripts/enrich-policy-data.mjs`).

## Pipeline (`backend/src/services/ingest/`)

### `ingestPolicies()`

1. **Load** — read `policy-regulations.json` (embedded in the Docker image).
2. **Validate** — reject records that fail shape checks: `id` slug, title/summary
   length, `eventDate` parseable as ISO date, `jurisdiction` (`ISO-3166 alpha-2` or
   `GLOBAL`), `category` in the known taxonomy, http(s) `sourceUrl`, `scope` and
   `enforcement` enums, and (when present) `impact`/`survival_signals` taxonomy values.
   Severity is **not** an input field — it is derived in the classify step.
3. **Classify** — compute `severity` (1–5) deterministically from `category` base +
   `scope` bonus + `enforcement` bonus (pure function, unit-tested).
4. **Persist** — UPSERT into `regulatory_events` keyed by `id`, so re-runs update in
   place. `ingestion_source` is recorded per row.

### `ingestIssues()`

Loads seed issues (or a configured GitHub repo's open issues via `GITHUB_REPO` /
`GITHUB_TOKEN`) and upserts them into `issues` keyed by `id` with `state`.

### Idempotency

Both pipelines use `INSERT … ON CONFLICT DO UPDATE`. Running them N times yields the
same table contents and the same analytics output.

## Change detection & version history (`backend/src/services/regulations.ts`)

After upserting, each ingestion run content-hashes every policy over the fields that
define it (title, jurisdiction, category, date, severity, summary, source, impact,
survival signals; arrays are order-insensitive). The hash is compared with the latest
stored revision:

- **no revision yet** → a `new` baseline revision (v1);
- **hash unchanged** → no-op (this is what makes re-ingestion idempotent);
- **hash changed** → an append-only `updated` revision with the field-level diff, plus
  an alert classified by the nature of the change — a severity escalation is `warning`
  (+1) or `critical` (+2 or more), a source/summary/title change is `warning`, and
  anything else is `info`.

Because revisions are never updated in place, `GET /api/regulations/:policyId/diff` can
show exactly what a regulation said at any point in time. Alerts are surfaced via
`GET /api/alerts` and acknowledged through `POST /api/alerts/:id/acknowledge`.

## Jurisdiction comparison (`backend/src/services/jurisdictions.ts`)

Per-jurisdiction profiles and side-by-side comparisons are derived from the same
persisted rows, reusing the category weights above so a jurisdiction's risk index is
comparable with the global one. Every profile and comparison cell carries the primary
`sources` (id, title, date, source name/URL) that produced it.

## Persistence (`backend/src/db.ts`)

SQLite (`node:sqlite`, no native deps) at `data/regulation-reckoning.db`:

- `regulatory_events(id, title, jurisdiction, category, event_date, severity, summary, source_name, source_url, ingestion_source, impact, survival_signals)`
- `issues(id, repo, title, points, tags, state, source, ingested_at)`
- `regulation_versions(id, policy_id, version, …, content_hash, changed_fields, change_type, detected_at)` — **append-only** revision history (unique on `policy_id, version`)
- `regulation_alerts(id, policy_id, version, alert_type, severity, title, message, changed_fields, source_url, created_at, acknowledged)` — change alerts
- `soroban_events(id PRIMARY KEY, tx_hash, ledger, contract_id, topic, issue_id, payload, created_at, indexed_at)` — raw contract events from **both** contracts; keyed by the Soroban RPC event id, so re-indexing is idempotent
- `indexer_state(key, value)` — indexer cursor (`soroban_events_cursor`), last indexed ledger, and schema version
- `bounties(issue_id PRIMARY KEY, funder, contributor, token, amount, released, refunded, released_amount, milestones, created_tx, released_tx, updated_at)` — derived from indexed events
- `milestones`, `reviews`, `bounty_reviewers`, `proposals`, `disputes`, `reputation` — the contract v2 read-model, rebuilt purely from indexed events

## Analytics (`backend/src/services/analytics.ts`)

Pure functions over the persisted rows — deterministic, unit-tested, no randomness:

- `totals` — event count, distinct jurisdictions/categories, average severity.
- `byJurisdiction`, `byCategory`, `bySeverity`, `byYear` — distribution maps.
- `timeline` — monthly event counts + average severity (chart source).
- `heatmap` — jurisdiction × category cells with severity-weighted risk 0–100
  (heat map source).
- `impact` — ecosystem-impact area aggregation (count + total severity).
- `survivalSignals` — project-survival signal aggregation (count + total severity).
- `jurisdictionRisk` — the risk index computed per jurisdiction.
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
  classification, and analytics determinism; `regulations.test.ts` and
  `jurisdictions.test.ts` cover hashing, diffs, alert severity, and comparison sources.