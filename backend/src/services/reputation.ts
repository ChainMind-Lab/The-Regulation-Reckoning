/**
 * Contributor & reviewer reputation.
 *
 * Reputation is *derived*, never self-reported:
 *
 *  - The authoritative counters live on-chain in the reputation registry
 *    contract, which only accepts writes from the bounty contract
 *    (`GET /api/reputation/:address` reconciles against the ledger).
 *  - The indexer keeps a local mirror in the `reputation` table built purely
 *    from registry events, so the API can serve leaderboards and lists without
 *    one RPC round-trip per address.
 *
 * The score formula is defined once, in the contract
 * (`score_of` in `contracts/contributors/src/lib.rs`) and mirrored by
 * `reputationScore` in `services/indexer.ts` — both are asserted equal by tests.
 */

import { getDb } from '../db';
import { reputationScore } from './indexer';

export interface ReputationRecord {
  address: string;
  payouts: number;
  payoutTotal: string;
  reviewsUpheld: number;
  disputesOpened: number;
  disputesLost: number;
  score: number;
  tier: string;
  source: 'indexed' | 'stellar';
  updatedAt: string;
}

/** Coarse banding of the 0..1000 score, for display. */
export function reputationTier(score: number): string {
  if (score >= 800) return 'authority';
  if (score >= 500) return 'trusted';
  if (score >= 200) return 'established';
  if (score >= 50) return 'contributor';
  return 'newcomer';
}

function rowToRecord(row: Record<string, unknown>): ReputationRecord {
  const score = Number(row.score ?? 0);
  return {
    address: String(row.address),
    payouts: Number(row.payouts ?? 0),
    payoutTotal: String(row.payout_total ?? '0'),
    reviewsUpheld: Number(row.reviews_upheld ?? 0),
    disputesOpened: Number(row.disputes_opened ?? 0),
    disputesLost: Number(row.disputes_lost ?? 0),
    score,
    tier: reputationTier(score),
    source: 'indexed',
    updatedAt: String(row.updated_at ?? ''),
  };
}

/**
 * Normalise the registry contract's snake_case `Reputation` struct into the
 * same JSON shape as the indexed mirror, so clients only ever see one shape
 * regardless of which source answered.
 */
export function normalizeOnChainReputation(
  address: string,
  raw: {
    payouts: number;
    payout_total: string;
    reviews_upheld: number;
    disputes_opened: number;
    disputes_lost: number;
    score: number;
  },
): ReputationRecord {
  return {
    address,
    payouts: raw.payouts,
    payoutTotal: raw.payout_total,
    reviewsUpheld: raw.reviews_upheld,
    disputesOpened: raw.disputes_opened,
    disputesLost: raw.disputes_lost,
    score: raw.score,
    tier: reputationTier(raw.score),
    source: 'stellar',
    updatedAt: new Date().toISOString(),
  };
}

/** The indexer's mirror of an address's reputation. `null` when unknown. */
export function indexedReputation(address: string): ReputationRecord | null {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM reputation WHERE address = ?`).get(address) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToRecord(row) : null;
}

/** Reputation leaderboard, highest score first. */
export function leaderboard(limit = 25): ReputationRecord[] {
  const db = getDb();
  const capped = Math.min(Math.max(limit, 1), 200);
  const rows = db
    .prepare(`SELECT * FROM reputation ORDER BY score DESC, payouts DESC, address ASC LIMIT ?`)
    .all(capped) as unknown as Record<string, unknown>[];
  return rows.map(rowToRecord);
}

/** Number of addresses with any recorded reputation. */
export function reputationCount(): number {
  const db = getDb();
  const row = db.prepare(`SELECT COUNT(*) AS n FROM reputation`).get() as { n: number };
  return Number(row?.n ?? 0);
}

/** The pure score function, re-exported so tests can assert parity with the contract. */
export { reputationScore };
