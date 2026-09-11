/**
 * Soroban event indexer.
 *
 * Polls `getEvents` for the bounty and reputation contracts, persists every
 * contract event (idempotently, keyed by event id) and deterministically
 * rebuilds the application read-model from the event log — so every figure the
 * dashboard and API serve is verifiably derived from Stellar, not from
 * user-submitted data.
 *
 * Rebuilt tables: `bounties`, `milestones`, `bounty_reviewers`, `reviews`,
 * `proposals`, `disputes`, `reputation`.
 *
 * The cursor is stored in `indexer_state` so restarts resume where they stopped.
 * Re-indexing a batch is a no-op (replay-safe), and a rebuild is a pure function
 * of the stored events, so replaying the same log always yields the same state.
 */

import { getDb } from '../db';
import { logger } from '../logger';
import { metrics } from '../metrics';
import { config, isContractConfigured } from '../config';
import { fetchContractEvents, type SorobanContractEvent } from './soroban';

const CURSOR_KEY = 'soroban_events_cursor';
const LEDGER_KEY = 'last_indexed_ledger';

/** Event names that carry bounty lifecycle state. */
const BOUNTY_TOPICS = [
  'bounty_created',
  'milestone_released',
  'bounty_released',
  'bounty_reclaimed',
  'bounty_refunded',
  'contributor_claimed',
];

function getStateValue(key: string): string | null {
  const db = getDb();
  const row = db.prepare(`SELECT value FROM indexer_state WHERE key = ?`).get(key) as
    | { value: string }
    | undefined;
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

interface EventRow {
  id: string;
  tx_hash: string;
  ledger: number;
  topic: string;
  issue_id: string | null;
  payload: string;
  topics: string;
  created_at: string;
}

function parseObject(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function parseArray(raw: string | null): unknown[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Read all stored events for the given topics, oldest first. */
function loadEvents(topics: string[]): EventRow[] {
  const db = getDb();
  const placeholders = topics.map(() => '?').join(', ');
  return db
    .prepare(
      `SELECT id, tx_hash, ledger, topic, issue_id, payload, topics, created_at
       FROM soroban_events WHERE topic IN (${placeholders})
       ORDER BY ledger ASC, id ASC`,
    )
    .all(...(topics as never[])) as unknown as EventRow[];
}

// ── Persistence ───────────────────────────────────────────────────

/** Persist one batch of contract events; returns the number of new events. */
export function persistEvents(events: SorobanContractEvent[]): number {
  const db = getDb();
  const upsert = db.prepare(`
    INSERT INTO soroban_events (id, tx_hash, ledger, contract_id, topic, issue_id, payload, topics, created_at, indexed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        JSON.stringify(e.topics ?? []),
        e.createdAt,
        now,
      );
      if (result.changes > 0) inserted += 1;
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  if (inserted > 0) {
    rebuildReadModels();
    metrics.inc('events_indexed_total', {}, inserted);
  }
  return inserted;
}

// ── Read-model rebuilds ───────────────────────────────────────────

interface BountyState {
  issue_id: string;
  funder: string;
  contributor: string | null;
  token: string;
  amount: string;
  released: number;
  refunded: number;
  released_amount: string;
  milestones: number;
  created_tx: string | null;
  released_tx: string | null;
  updated_at: string;
}

/**
 * Rebuild `bounties` from the event log. Deterministic: replaying the same
 * events always yields the same state.
 */
export function rebuildBountyState(): void {
  const db = getDb();
  const rows = loadEvents(BOUNTY_TOPICS);
  const bounties = new Map<string, BountyState>();

  for (const row of rows) {
    const payload = parseObject(row.payload);
    const issueId = row.issue_id ?? String(payload.issue_id ?? '');
    if (!issueId) continue;
    const current: BountyState =
      bounties.get(issueId) ?? {
        issue_id: issueId,
        funder: '',
        contributor: null,
        token: '',
        amount: '0',
        released: 0,
        refunded: 0,
        released_amount: '0',
        milestones: 0,
        created_tx: null,
        released_tx: null,
        updated_at: row.created_at,
      };

    switch (row.topic) {
      case 'bounty_created':
        current.funder = String(payload.funder ?? '');
        current.token = String(payload.token ?? '');
        current.amount = String(payload.amount ?? '0');
        current.milestones = Number(payload.milestones ?? 0);
        current.created_tx = row.tx_hash;
        current.updated_at = row.created_at;
        break;
      case 'contributor_claimed':
        current.contributor = String(payload.contributor ?? '');
        current.updated_at = row.created_at;
        break;
      case 'milestone_released':
        current.contributor = String(payload.contributor ?? current.contributor ?? '');
        current.released_amount = String(payload.released_amount ?? current.released_amount);
        current.released_tx = row.tx_hash;
        current.released = Number(current.released_amount) >= Number(current.amount) ? 1 : 0;
        current.updated_at = row.created_at;
        break;
      case 'bounty_released': // v1 event, still emitted for compatibility
        current.contributor = String(payload.contributor ?? current.contributor ?? '');
        current.released = 1;
        current.released_tx = row.tx_hash;
        current.updated_at = row.created_at;
        break;
      case 'bounty_reclaimed':
      case 'bounty_refunded':
        current.released = 1;
        current.refunded = 1;
        current.released_tx = row.tx_hash;
        current.updated_at = row.created_at;
        break;
      default:
        break;
    }
    bounties.set(issueId, current);
  }

  const upsert = db.prepare(`
    INSERT INTO bounties (issue_id, funder, contributor, token, amount, released, refunded, released_amount, milestones, created_tx, released_tx, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(issue_id) DO UPDATE SET
      funder = excluded.funder,
      contributor = excluded.contributor,
      token = excluded.token,
      amount = excluded.amount,
      released = excluded.released,
      refunded = excluded.refunded,
      released_amount = excluded.released_amount,
      milestones = excluded.milestones,
      created_tx = excluded.created_tx,
      released_tx = excluded.released_tx,
      updated_at = excluded.updated_at
  `);
  db.exec('BEGIN');
  try {
    db.exec('DELETE FROM bounties');
    for (const b of bounties.values()) {
      upsert.run(
        b.issue_id,
        b.funder,
        b.contributor,
        b.token,
        b.amount,
        b.released,
        b.refunded,
        b.released_amount,
        b.milestones,
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

/** Rebuild per-milestone release history from `milestone_released` events. */
export function rebuildMilestones(): void {
  const db = getDb();
  const rows = loadEvents(['milestone_released']);
  const insert = db.prepare(`
    INSERT INTO milestones (issue_id, idx, title, amount, settled, released_tx, updated_at)
    VALUES (?, ?, '', ?, 1, ?, ?)
    ON CONFLICT(issue_id, idx) DO UPDATE SET
      amount = excluded.amount,
      settled = 1,
      released_tx = excluded.released_tx,
      updated_at = excluded.updated_at
  `);
  db.exec('BEGIN');
  try {
    db.exec('DELETE FROM milestones');
    for (const row of rows) {
      const payload = parseObject(row.payload);
      const issueId = row.issue_id ?? String(payload.issue_id ?? '');
      if (!issueId) continue;
      insert.run(
        issueId,
        Number(payload.milestone ?? 0),
        String(payload.amount ?? '0'),
        row.tx_hash,
        row.created_at,
      );
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  metrics.setGauge('milestones_tracked', rows.length);
}

/** Rebuild reviewer assignments from `reviewers_set` events. */
export function rebuildReviewers(): void {
  const db = getDb();
  const rows = loadEvents(['reviewers_set']);
  const insert = db.prepare(`
    INSERT INTO bounty_reviewers (issue_id, reviewer, quorum, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(issue_id, reviewer) DO UPDATE SET
      quorum = excluded.quorum,
      updated_at = excluded.updated_at
  `);
  db.exec('BEGIN');
  try {
    db.exec('DELETE FROM bounty_reviewers');
    for (const row of rows) {
      const payload = parseObject(row.payload);
      const issueId = row.issue_id ?? String(payload.issue_id ?? '');
      if (!issueId) continue;
      const reviewers = Array.isArray(payload.reviewers) ? payload.reviewers.map(String) : [];
      const quorum = Number(payload.quorum ?? 0);
      for (const reviewer of reviewers) {
        insert.run(issueId, reviewer, quorum, row.created_at);
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/** Rebuild reviewer submissions from `review_submitted` events. */
export function rebuildReviews(): void {
  const db = getDb();
  const rows = loadEvents(['review_submitted']);
  const insert = db.prepare(`
    INSERT INTO reviews (id, issue_id, milestone, reviewer, decision, comment_hash, ledger, tx_hash, created_at)
    VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)
    ON CONFLICT(id) DO NOTHING
  `);
  db.exec('BEGIN');
  try {
    db.exec('DELETE FROM reviews');
    for (const row of rows) {
      const payload = parseObject(row.payload);
      const issueId = row.issue_id ?? String(payload.issue_id ?? '');
      const milestone = Number(payload.milestone ?? 0);
      const reviewer = String(payload.reviewer ?? '');
      if (!issueId || !reviewer) continue;
      // Contract `ReviewDecision`: 0 = Approve, 1 = Reject.
      const decision = Number(payload.decision ?? 0) === 0 ? 'approve' : 'reject';
      insert.run(
        `${issueId}:${milestone}:${reviewer}`,
        issueId,
        milestone,
        reviewer,
        decision,
        row.ledger,
        row.tx_hash,
        row.created_at,
      );
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  metrics.setGauge('reviews_tracked', rows.length);
}

/** Rebuild multisig proposals from `proposal_*` events. */
export function rebuildProposals(): void {
  const db = getDb();
  const rows = loadEvents([
    'proposal_created',
    'proposal_approved',
    'proposal_executed',
    'proposal_cancelled',
  ]);
  interface ProposalState {
    id: number;
    proposer: string;
    action: string;
    action_json: string;
    approvals: string[];
    executed: number;
    cancelled: number;
    created_tx: string | null;
    updated_at: string;
  }
  const proposals = new Map<number, ProposalState>();
  const proposalId = (row: EventRow, payload: Record<string, unknown>): number => {
    const fromTopic = parseArray(row.topics)[1];
    const raw = fromTopic ?? payload.id;
    return Number(raw ?? 0);
  };

  for (const row of rows) {
    const payload = parseObject(row.payload);
    const id = proposalId(row, payload);
    if (!id) continue;
    const current: ProposalState =
      proposals.get(id) ?? {
        id,
        proposer: '',
        action: 'Unknown',
        action_json: '{}',
        approvals: [],
        executed: 0,
        cancelled: 0,
        created_tx: null,
        updated_at: row.created_at,
      };
    switch (row.topic) {
      case 'proposal_created':
        // The contract records the proposer as the first approval, so the
        // indexed set must start from them (echoing an on-chain invariant).
        current.proposer = String(payload.proposer ?? '');
        if (current.proposer) current.approvals = [current.proposer];
        current.action = String(payload.action ?? 'Unknown');
        current.action_json = JSON.stringify(payload);
        current.created_tx = row.tx_hash;
        current.updated_at = row.created_at;
        break;
      case 'proposal_approved': {
        const signer = String(payload.signer ?? '');
        if (signer && !current.approvals.includes(signer)) current.approvals.push(signer);
        current.updated_at = row.created_at;
        break;
      }
      case 'proposal_executed':
        current.executed = 1;
        current.updated_at = row.created_at;
        break;
      case 'proposal_cancelled':
        current.cancelled = 1;
        current.updated_at = row.created_at;
        break;
      default:
        break;
    }
    proposals.set(id, current);
  }

  const insert = db.prepare(`
    INSERT INTO proposals (id, proposer, action, action_json, approvals, executed, cancelled, created_tx, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      proposer = excluded.proposer,
      action = excluded.action,
      action_json = excluded.action_json,
      approvals = excluded.approvals,
      executed = excluded.executed,
      cancelled = excluded.cancelled,
      created_tx = excluded.created_tx,
      updated_at = excluded.updated_at
  `);
  db.exec('BEGIN');
  try {
    db.exec('DELETE FROM proposals');
    for (const p of proposals.values()) {
      insert.run(
        p.id,
        p.proposer,
        p.action,
        p.action_json,
        JSON.stringify(p.approvals),
        p.executed,
        p.cancelled,
        p.created_tx,
        p.updated_at,
      );
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  metrics.setGauge('proposals_tracked', proposals.size);
}

/** Rebuild disputes from `dispute_*` events. */
export function rebuildDisputes(): void {
  const db = getDb();
  const rows = loadEvents([
    'dispute_opened',
    'dispute_vote_cast',
    'dispute_resolved',
  ]);
  interface DisputeState {
    id: number;
    issue_id: string;
    milestone: number;
    opener: string;
    reason_hash: string;
    votes_pay_contributor: number;
    votes_refund_funder: number;
    resolved: number;
    pay_contributor: number;
    opened_tx: string | null;
    resolved_tx: string | null;
    created_at: string;
    updated_at: string;
  }
  const disputes = new Map<number, DisputeState>();

  for (const row of rows) {
    const payload = parseObject(row.payload);
    const fromTopic = parseArray(row.topics)[1];
    const id = Number(fromTopic ?? payload.id ?? 0);
    if (!id) continue;

    if (row.topic === 'dispute_opened') {
      disputes.set(id, {
        id,
        issue_id: String(payload.issue_id ?? row.issue_id ?? ''),
        milestone: Number(payload.milestone ?? 0),
        opener: String(payload.opener ?? ''),
        reason_hash: String(payload.reason_hash ?? ''),
        votes_pay_contributor: 0,
        votes_refund_funder: 0,
        resolved: 0,
        pay_contributor: 0,
        opened_tx: row.tx_hash,
        resolved_tx: null,
        created_at: row.created_at,
        updated_at: row.created_at,
      });
      continue;
    }

    const current = disputes.get(id);
    if (!current) continue;
    if (row.topic === 'dispute_vote_cast') {
      if (Boolean(payload.pay_contributor)) current.votes_pay_contributor += 1;
      else current.votes_refund_funder += 1;
    } else if (row.topic === 'dispute_resolved') {
      current.resolved = 1;
      current.pay_contributor = Boolean(payload.pay_contributor) ? 1 : 0;
      current.resolved_tx = row.tx_hash;
    }
    current.updated_at = row.created_at;
    disputes.set(id, current);
  }

  const insert = db.prepare(`
    INSERT INTO disputes (id, issue_id, milestone, opener, reason_hash, votes_pay_contributor, votes_refund_funder, resolved, pay_contributor, opened_tx, resolved_tx, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      votes_pay_contributor = excluded.votes_pay_contributor,
      votes_refund_funder = excluded.votes_refund_funder,
      resolved = excluded.resolved,
      pay_contributor = excluded.pay_contributor,
      resolved_tx = excluded.resolved_tx,
      updated_at = excluded.updated_at
  `);
  db.exec('BEGIN');
  try {
    db.exec('DELETE FROM disputes');
    for (const d of disputes.values()) {
      insert.run(
        d.id,
        d.issue_id,
        d.milestone,
        d.opener,
        d.reason_hash,
        d.votes_pay_contributor,
        d.votes_refund_funder,
        d.resolved,
        d.pay_contributor,
        d.opened_tx,
        d.resolved_tx,
        d.created_at,
        d.updated_at,
      );
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  metrics.setGauge('disputes_tracked', disputes.size);
}

/**
 * Deterministic reputation score. MUST match `score_of` in
 * `contracts/contributors/src/lib.rs`:
 *   clamp(12*payouts + 10*reviews_upheld - 15*disputes_lost, 0, 1000)
 */
export function reputationScore(
  payouts: number,
  reviewsUpheld: number,
  disputesLost: number,
): number {
  const raw = 12 * payouts + 10 * reviewsUpheld - 15 * disputesLost;
  return Math.max(0, Math.min(1000, raw));
}

/** Rebuild the indexed reputation table from registry events. */
export function rebuildReputation(): void {
  const db = getDb();
  const rows = loadEvents(['contributor_recorded', 'review_recorded', 'dispute_recorded']);
  interface RepState {
    payouts: number;
    payout_total: bigint;
    reviews_upheld: number;
    disputes_opened: number;
    disputes_lost: number;
    updated_at: string;
  }
  const reps = new Map<string, RepState>();
  // Dedup, mirroring the registry's on-chain replay guards.
  const seen = new Set<string>();
  const get = (address: string, at: string): RepState => {
    let state = reps.get(address);
    if (!state) {
      state = {
        payouts: 0,
        payout_total: 0n,
        reviews_upheld: 0,
        disputes_opened: 0,
        disputes_lost: 0,
        updated_at: at,
      };
      reps.set(address, state);
    }
    return state;
  };

  for (const row of rows) {
    const payload = parseObject(row.payload);
    const topics = parseArray(row.topics);
    const subject = topics[1];
    if (typeof subject !== 'string' || !subject) continue;
    const issueId = String(payload.issue_id ?? row.issue_id ?? '');
    const milestone = Number(payload.milestone ?? 0);
    const guard = `${subject}|${issueId}|${milestone}`;
    if (seen.has(guard)) continue;
    seen.add(guard);
    const state = get(subject, row.created_at);
    state.updated_at = row.created_at;
    if (row.topic === 'contributor_recorded') {
      state.payouts += 1;
      state.payout_total += BigInt(String(payload.amount ?? '0'));
    } else if (row.topic === 'review_recorded') {
      if (Number(payload.upheld ?? 0) > 0 || payload.upheld === true) state.reviews_upheld += 1;
    } else if (row.topic === 'dispute_recorded') {
      state.disputes_opened += 1;
      if (payload.lost === true || payload.lost === 'true') state.disputes_lost += 1;
    }
  }

  const insert = db.prepare(`
    INSERT INTO reputation (address, payouts, payout_total, reviews_upheld, disputes_opened, disputes_lost, score, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(address) DO UPDATE SET
      payouts = excluded.payouts,
      payout_total = excluded.payout_total,
      reviews_upheld = excluded.reviews_upheld,
      disputes_opened = excluded.disputes_opened,
      disputes_lost = excluded.disputes_lost,
      score = excluded.score,
      updated_at = excluded.updated_at
  `);
  db.exec('BEGIN');
  try {
    db.exec('DELETE FROM reputation');
    for (const [address, state] of reps) {
      insert.run(
        address,
        state.payouts,
        state.payout_total.toString(),
        state.reviews_upheld,
        state.disputes_opened,
        state.disputes_lost,
        reputationScore(state.payouts, state.reviews_upheld, state.disputes_lost),
        state.updated_at,
      );
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  metrics.setGauge('reputation_entries', reps.size);
}

/** Rebuild every derived table from the stored event log. */
export function rebuildReadModels(): void {
  rebuildBountyState();
  rebuildMilestones();
  rebuildReviewers();
  rebuildReviews();
  rebuildProposals();
  rebuildDisputes();
  rebuildReputation();
}

// ── Poll loop ─────────────────────────────────────────────────────

/**
 * One indexer pass: fetch events since the stored cursor and persist them.
 *
 * Failure handling:
 *  - RPC failures are contained here: the cursor is never advanced, a warn is
 *    logged, `indexer_up` drops to 0, and the next poll retries.
 *  - DB failures roll back inside `persistEvents` and re-throw into this
 *    handler — again the cursor is preserved for the next attempt.
 *  - Missed-ledger gaps are detected and logged so operators can investigate.
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
    } else if (events.length === 0 && !cursor && config.indexerStartLedger === 0) {
      logger.warn(
        'indexer: no events found on first pass; set INDEXER_START_LEDGER to the ' +
          'contract deploy ledger to backfill history',
        { scannedFrom: 'last ~1000 ledgers' },
      );
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
