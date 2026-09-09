/**
 * Soroban event indexer.
 *
 * Polls `getEvents` on the bounty contract, persists every contract event
 * (idempotently, keyed by event id) and rebuilds the `bounties` read-model
 * from the event log — so the dashboard's bounty state is verifiably derived
 * from Stellar, not from user-submitted data.
 *
 * The cursor is stored in `indexer_state` so restarts resume where they
 * stopped. Re-running an event is a no-op (replay-safe).
 */

import { getDb } from '../db';
import { logger } from '../logger';
import { metrics } from '../metrics';
import { config, isContractConfigured } from '../config';
import { fetchContractEvents, type SorobanContractEvent } from './soroban';

const CURSOR_KEY = 'soroban_events_cursor';
const LEDGER_KEY = 'last_indexed_ledger';

function getStateValue(key: string): string | null {
  const db = getDb();
  const row = db.prepare(`SELECT value FROM indexer_state WHERE key = ?`).get(key) as
    { value: string } | undefined;
  return row?.value ?? null;
}

function setStateValue(key: string, value: string): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO indexer_state (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, value);
}

export function getCursor(): string | null {
  return getStateValue(CURSOR_KEY);
}

export function setCursor(cursor: string): void {
  setStateValue(CURSOR_KEY, cursor);
}

/** Last ledger sequence indexed so far (used for missed-ledger detection). */
export function getLastIndexedLedger(): number {
  const raw = getStateValue(LEDGER_KEY);
  const n = raw === null ? 0 : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Detect a ledger gap between the last indexed ledger and a new batch.
 * Returns the number of skipped ledgers (0 when contiguous or first run).
 */
export function detectLedgerGap(events: SorobanContractEvent[]): number {
  if (events.length === 0) return 0;
  const last = getLastIndexedLedger();
  if (last === 0) return 0; // first run: nothing to compare against
  const first = Math.min(...events.map((e) => e.ledger));
  return Math.max(0, first - last - 1);
}

/** Persist one batch of contract events; returns the number of new events. */
export function persistEvents(events: SorobanContractEvent[]): number {
  const db = getDb();
  const upsert = db.prepare(`
    INSERT INTO soroban_events (id, tx_hash, ledger, contract_id, topic, issue_id, payload, created_at, indexed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO NOTHING
  `);
  const now = new Date().toISOString();
  let inserted = 0;
  db.exec('BEGIN');
  try {
    for (const e of events) {
      const result = upsert.run(
        e.id,
        e.txHash,
        e.ledger,
        e.contractId,
        e.topic,
        e.issueId,
        JSON.stringify(e.payload),
        e.createdAt,
        now,
      );
      // node:sqlite returns { changes } for INSERT ... ON CONFLICT DO NOTHING.
      if (result.changes > 0) inserted += 1;
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  if (inserted > 0) {
    rebuildBountyState();
    metrics.inc('events_indexed_total', {}, inserted);
  }
  return inserted;
}

/**
 * Rebuild the `bounties` read-model from the stored event log.
 * Deterministic: replaying the same events always yields the same state.
 */
export function rebuildBountyState(): void {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT tx_hash, topic, issue_id, payload, created_at
       FROM soroban_events
       WHERE topic IN ('bounty_created', 'bounty_released', 'bounty_reclaimed')
       ORDER BY ledger ASC, id ASC`,
    )
    .all() as unknown as {
    tx_hash: string;
    topic: string;
    issue_id: string | null;
    payload: string;
    created_at: string;
  }[];

  const bounties = new Map<string, Record<string, string | number | null>>();
  for (const row of rows) {
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(row.payload) as Record<string, unknown>;
    } catch {
      // Malformed payloads are skipped; the raw event remains for inspection.
      continue;
    }
    const issueId = row.issue_id ?? String(payload.issue_id ?? '');
    if (!issueId) continue;
    const current = bounties.get(issueId) ?? { issue_id: issueId };
    switch (row.topic) {
      case 'bounty_created':
        current.funder = String(payload.funder ?? '');
        current.contributor = null;
        current.token = String(payload.token ?? '');
        current.amount = String(payload.amount ?? '0');
        current.released = 0;
        current.created_tx = row.tx_hash;
        current.released_tx = null;
        current.updated_at = row.created_at;
        break;
      case 'bounty_released':
        current.contributor = String(payload.contributor ?? '');
        current.released = 1;
        current.released_tx = row.tx_hash;
        current.updated_at = row.created_at;
        break;
      case 'bounty_reclaimed':
        current.released = 1;
        current.released_tx = row.tx_hash;
        current.updated_at = row.created_at;
        break;
      default:
        break;
    }
    bounties.set(issueId, current);
  }

  const upsert = db.prepare(`
    INSERT INTO bounties (issue_id, funder, contributor, token, amount, released, created_tx, released_tx, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(issue_id) DO UPDATE SET
      funder = excluded.funder,
      contributor = excluded.contributor,
      token = excluded.token,
      amount = excluded.amount,
      released = excluded.released,
      created_tx = excluded.created_tx,
      released_tx = excluded.released_tx,
      updated_at = excluded.updated_at
  `);
  db.exec('BEGIN');
  try {
    for (const [issueId, b] of bounties) {
      upsert.run(
        issueId,
        b.funder,
        b.contributor,
        b.token,
        b.amount,
        b.released,
        b.created_tx,
        b.released_tx,
        b.updated_at,
      );
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  metrics.setGauge('bounties_tracked', bounties.size);
}

/**
 * One indexer pass: fetch events since the stored cursor and persist them.
 *
 * Failure handling:
 *  - RPC failures are contained here: the cursor is never advanced, a warn is
 *    logged, `indexer_up` drops to 0, and the next poll retries.
 *  - DB failures roll back inside `persistEvents` and re-throw into this
 *    handler — again the cursor is preserved for the next attempt.
 *  - Missed-ledger gaps (ledgers skipped between batches, e.g. after a long
 *    outage) are detected and logged so operators can investigate.
 */
export async function indexOnce(): Promise<number> {
  if (!isContractConfigured()) {
    logger.warn('indexer: skipped, BOUNTY_CONTRACT_ID not configured');
    return 0;
  }
  const cursor = getCursor();
  try {
    const { events, nextCursor } = await fetchContractEvents(cursor);

    const gap = detectLedgerGap(events);
    if (gap > 0) {
      logger.warn('indexer: missed-ledger gap detected', {
        gap,
        fromLedger: getLastIndexedLedger(),
        toLedger: Math.min(...events.map((e) => e.ledger)),
      });
      metrics.inc('indexer_ledger_gaps_total', {});
    }

    const inserted = persistEvents(events);
    // Persist succeeded: only now advance the cursor and last-ledger state.
    if (nextCursor) setCursor(nextCursor);
    if (events.length > 0) {
      setStateValue(LEDGER_KEY, String(Math.max(...events.map((e) => e.ledger))));
    }
    metrics.setGauge('indexer_up', 1);
    if (inserted > 0) {
      logger.info('indexer: processed batch', {
        fetched: events.length,
        inserted,
        cursor: nextCursor,
      });
    }
    return inserted;
  } catch (err) {
    metrics.setGauge('indexer_up', 0);
    logger.warn('indexer: pass failed, cursor preserved for retry', { err: String(err) });
    return 0;
  }
}

let timer: NodeJS.Timeout | null = null;

/** Start the periodic indexer loop (idempotent). */
export function startIndexer(): void {
  if (timer || !config.indexerEnabled || !isContractConfigured()) return;
  // Run once immediately, then on an interval.
  indexOnce().catch((err) => logger.error('indexer: initial pass failed', { err: String(err) }));
  timer = setInterval(() => {
    indexOnce().catch((err) => logger.error('indexer: pass failed', { err: String(err) }));
  }, config.indexerIntervalMs);
  if (timer.unref) timer.unref();
}

export function stopIndexer(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
