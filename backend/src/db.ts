/**
 * SQLite persistence (Node's built-in `node:sqlite`, no native deps).
 *
 * The database is the application's read model:
 *  - `regulatory_events` — validated, classified policy dataset (ingested).
 *  - `issues`            — bounty/issue list (ingested from GitHub or seed).
 *  - `soroban_events`    — raw contract events pulled from Soroban RPC.
 *  - `bounties`          — derived bounty state (rebuildable from events).
 *  - `ingest_runs`       — audit log of ingestion runs.
 *  - `indexer_state`     — RPC event cursor.
 */

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config';
import { logger } from './logger';

let db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (db) return db;
  if (config.dbPath !== ':memory:') {
    mkdirSync(dirname(config.dbPath), { recursive: true });
  }
  db = new DatabaseSync(config.dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  migrate(db);
  return db;
}

export function closeDb(): void {
  db?.close();
  db = null;
}

/** Re-open a fresh database at the configured path (used by tests). */
export function resetDb(): void {
  closeDb();
  getDb();
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS regulatory_events (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  jurisdiction  TEXT NOT NULL,
  category      TEXT NOT NULL,
  event_date    TEXT NOT NULL,
  severity      INTEGER NOT NULL,
  summary       TEXT NOT NULL,
  source_name   TEXT NOT NULL,
  source_url    TEXT NOT NULL,
  ingested_at   TEXT NOT NULL,
  ingestion_source TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS issues (
  id          TEXT PRIMARY KEY,
  repo        TEXT NOT NULL,
  title       TEXT NOT NULL,
  points      INTEGER NOT NULL DEFAULT 0,
  tags        TEXT NOT NULL,
  state       TEXT NOT NULL DEFAULT 'open',
  source      TEXT NOT NULL,
  ingested_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS soroban_events (
  id         TEXT PRIMARY KEY,
  tx_hash    TEXT NOT NULL,
  ledger     INTEGER NOT NULL,
  contract_id TEXT NOT NULL,
  topic      TEXT NOT NULL,
  issue_id   TEXT,
  payload    TEXT NOT NULL,
  created_at TEXT NOT NULL,
  indexed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_soroban_events_topic ON soroban_events (topic);
CREATE INDEX IF NOT EXISTS idx_soroban_events_ledger ON soroban_events (ledger);

CREATE TABLE IF NOT EXISTS bounties (
  issue_id     TEXT PRIMARY KEY,
  funder       TEXT NOT NULL,
  contributor  TEXT,
  token        TEXT NOT NULL,
  amount       TEXT NOT NULL,
  released     INTEGER NOT NULL DEFAULT 0,
  created_tx   TEXT,
  released_tx  TEXT,
  updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ingest_runs (
  id          TEXT PRIMARY KEY,
  pipeline    TEXT NOT NULL,
  status      TEXT NOT NULL,
  records     INTEGER NOT NULL DEFAULT 0,
  message     TEXT,
  started_at  TEXT NOT NULL,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS indexer_state (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Per-milestone escrow state, derived from milestone_released events.
CREATE TABLE IF NOT EXISTS milestones (
  issue_id    TEXT NOT NULL,
  idx         INTEGER NOT NULL,
  title       TEXT NOT NULL DEFAULT '',
  amount      TEXT NOT NULL DEFAULT '0',
  settled     INTEGER NOT NULL DEFAULT 0,
  released_tx TEXT,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (issue_id, idx)
);

-- Reviewer assignment per bounty, derived from reviewers_set events.
CREATE TABLE IF NOT EXISTS bounty_reviewers (
  issue_id   TEXT NOT NULL,
  reviewer   TEXT NOT NULL,
  quorum     INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (issue_id, reviewer)
);

-- Reviewer submissions, derived from review_submitted events.
CREATE TABLE IF NOT EXISTS reviews (
  id           TEXT PRIMARY KEY,
  issue_id     TEXT NOT NULL,
  milestone    INTEGER NOT NULL,
  reviewer     TEXT NOT NULL,
  decision     TEXT NOT NULL,
  comment_hash TEXT,
  ledger       INTEGER,
  tx_hash      TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reviews_issue ON reviews (issue_id, milestone);

-- Multisig proposals, derived from proposal_* events.
CREATE TABLE IF NOT EXISTS proposals (
  id          INTEGER PRIMARY KEY,
  proposer    TEXT NOT NULL,
  action      TEXT NOT NULL,
  action_json TEXT NOT NULL,
  approvals   TEXT NOT NULL DEFAULT '[]',
  executed    INTEGER NOT NULL DEFAULT 0,
  cancelled   INTEGER NOT NULL DEFAULT 0,
  created_tx  TEXT,
  updated_at  TEXT NOT NULL
);

-- Disputes, derived from dispute_* events.
CREATE TABLE IF NOT EXISTS disputes (
  id                    INTEGER PRIMARY KEY,
  issue_id              TEXT NOT NULL,
  milestone             INTEGER NOT NULL,
  opener                TEXT NOT NULL,
  reason_hash           TEXT,
  votes_pay_contributor INTEGER NOT NULL DEFAULT 0,
  votes_refund_funder   INTEGER NOT NULL DEFAULT 0,
  resolved              INTEGER NOT NULL DEFAULT 0,
  pay_contributor       INTEGER NOT NULL DEFAULT 0,
  opened_tx             TEXT,
  resolved_tx           TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_disputes_issue ON disputes (issue_id);

-- Verifiable reputation, derived from registry_* events (and reconcilable
-- against the on-chain registry contract via GET /api/reputation/:address).
CREATE TABLE IF NOT EXISTS reputation (
  address         TEXT PRIMARY KEY,
  payouts         INTEGER NOT NULL DEFAULT 0,
  payout_total    TEXT NOT NULL DEFAULT '0',
  reviews_upheld  INTEGER NOT NULL DEFAULT 0,
  disputes_opened INTEGER NOT NULL DEFAULT 0,
  disputes_lost   INTEGER NOT NULL DEFAULT 0,
  score           INTEGER NOT NULL DEFAULT 0,
  updated_at      TEXT NOT NULL
);

-- Immutable regulation version history (one row per detected revision).
CREATE TABLE IF NOT EXISTS regulation_versions (
  id             TEXT PRIMARY KEY,
  policy_id      TEXT NOT NULL,
  version        INTEGER NOT NULL,
  title          TEXT NOT NULL,
  jurisdiction   TEXT NOT NULL,
  category       TEXT NOT NULL,
  event_date     TEXT NOT NULL,
  severity       INTEGER NOT NULL,
  summary        TEXT NOT NULL,
  source_name    TEXT NOT NULL,
  source_url     TEXT NOT NULL,
  content_hash   TEXT NOT NULL,
  changed_fields TEXT NOT NULL DEFAULT '[]',
  change_type    TEXT NOT NULL,
  detected_at    TEXT NOT NULL,
  impact           TEXT NOT NULL DEFAULT '[]',
  survival_signals TEXT NOT NULL DEFAULT '[]',
  UNIQUE (policy_id, version)
);
CREATE INDEX IF NOT EXISTS idx_reg_versions_policy ON regulation_versions (policy_id, version);

-- Alerts raised by regulation change detection.
CREATE TABLE IF NOT EXISTS regulation_alerts (
  id             TEXT PRIMARY KEY,
  policy_id      TEXT NOT NULL,
  version        INTEGER NOT NULL,
  alert_type     TEXT NOT NULL,
  severity       TEXT NOT NULL,
  title          TEXT NOT NULL,
  message        TEXT NOT NULL,
  changed_fields TEXT NOT NULL DEFAULT '[]',
  source_url     TEXT,
  created_at     TEXT NOT NULL,
  acknowledged   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_reg_alerts_policy ON regulation_alerts (policy_id, created_at);
`;

const MIGRATIONS: string[] = [
  // v2: ecosystem-impact areas and project-survival signals per policy record.
  "ALTER TABLE regulatory_events ADD COLUMN impact TEXT NOT NULL DEFAULT '[]';",
  "ALTER TABLE regulatory_events ADD COLUMN survival_signals TEXT NOT NULL DEFAULT '[]';",
  // v3: v2 bounty escrow fields (milestone accounting + refund state).
  `ALTER TABLE bounties ADD COLUMN refunded INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE bounties ADD COLUMN released_amount TEXT NOT NULL DEFAULT '0';
   ALTER TABLE bounties ADD COLUMN milestones INTEGER NOT NULL DEFAULT 0;`,
  // v4: content hash used by regulation change detection.
  "ALTER TABLE regulatory_events ADD COLUMN content_hash TEXT NOT NULL DEFAULT '';",
  // v5: which revision of a regulation the current row represents.
  "ALTER TABLE regulatory_events ADD COLUMN version INTEGER NOT NULL DEFAULT 1;",
  // v6: all decoded event topics (JSON), so reputation events can recover the
  // subject address, which lives in topic[1] rather than the data map.
  "ALTER TABLE soroban_events ADD COLUMN topics TEXT NOT NULL DEFAULT '[]';",
];

function migrate(database: DatabaseSync): void {
  database.exec(SCHEMA);
  const versionRow = database
    .prepare("SELECT value FROM indexer_state WHERE key = 'schema_version'")
    .get() as { value: string } | undefined;
  const version = versionRow ? Number(versionRow.value) : 0;
  for (let i = version; i < MIGRATIONS.length; i += 1) {
    logger.info(`db: applying migration ${i + 1}`);
    database.exec('BEGIN');
    try {
      database.exec(MIGRATIONS[i]);
      database
        .prepare(
          "INSERT INTO indexer_state (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        )
        .run(String(i + 1));
      database.exec('COMMIT');
    } catch (err) {
      database.exec('ROLLBACK');
      throw err;
    }
  }
}
