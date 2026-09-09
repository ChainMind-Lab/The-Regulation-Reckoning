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
`;

const MIGRATIONS: string[] = [
  // v1 is the base schema above; future migrations append here, e.g.:
  // "ALTER TABLE bounties ADD COLUMN reclaimed_tx TEXT;",
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
