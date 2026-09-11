import { describe, it, expect, beforeEach } from 'vitest';
import { getDb, resetDb } from '../src/db';
import {
  indexedReputation,
  leaderboard,
  reputationCount,
  reputationScore,
  reputationTier,
} from '../src/services/reputation';

/**
 * The score formula is defined in the contract
 * (`score_of` in contracts/contributors/src/lib.rs) as
 *   clamp(12*payouts + 10*reviews_upheld - 15*disputes_lost, 0, 1000)
 * These tests pin the backend mirror to that definition.
 */
describe('reputationScore parity with the contract', () => {
  it('weights payouts, upheld reviews and lost disputes', () => {
    expect(reputationScore(1, 0, 0)).toBe(12);
    expect(reputationScore(0, 1, 0)).toBe(10);
    expect(reputationScore(0, 0, 1)).toBe(0); // clamped, never negative
    expect(reputationScore(5, 3, 1)).toBe(60 + 30 - 15);
  });

  it('clamps at 0 and 1000', () => {
    expect(reputationScore(0, 0, 100)).toBe(0);
    expect(reputationScore(1000, 0, 0)).toBe(1000);
  });
});

describe('reputationTier', () => {
  it('bands the score', () => {
    expect(reputationTier(0)).toBe('newcomer');
    expect(reputationTier(49)).toBe('newcomer');
    expect(reputationTier(50)).toBe('contributor');
    expect(reputationTier(200)).toBe('established');
    expect(reputationTier(500)).toBe('trusted');
    expect(reputationTier(1000)).toBe('authority');
  });
});

describe('indexed reputation', () => {
  const A = 'GB2OVPTEO2BYRRRRWNRPZZOC3VW77IQDXJPBY2WYV2MXSU7C5HQDZ6E6';
  const B = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

  beforeEach(() => {
    resetDb();
  });

  function insertReputation(address: string, payouts: number, reviews: number, lost: number) {
    getDb()
      .prepare(
        `INSERT INTO reputation (address, payouts, payout_total, reviews_upheld, disputes_opened, disputes_lost, score, updated_at)
         VALUES (?, ?, '0', ?, ?, ?, ?, '2026-09-09T00:00:00Z')`,
      )
      .run(address, payouts, reviews, lost, lost, reputationScore(payouts, reviews, lost));
  }

  it('returns null for an unknown address', () => {
    expect(indexedReputation(A)).toBeNull();
    expect(reputationCount()).toBe(0);
  });

  it('derives the tier from the stored score', () => {
    insertReputation(A, 2, 0, 0); // score 24 → newcomer
    const record = indexedReputation(A);
    expect(record).not.toBeNull();
    expect(record!.score).toBe(24);
    expect(record!.tier).toBe('newcomer');
    expect(record!.source).toBe('indexed');
  });

  it('ranks the leaderboard by score descending', () => {
    insertReputation(B, 1, 0, 0); // 12
    insertReputation(A, 10, 5, 0); // 170
    const board = leaderboard(10);
    expect(board).toHaveLength(2);
    expect(board[0].address).toBe(A);
    expect(board[1].address).toBe(B);
    expect(reputationCount()).toBe(2);
  });

  it('caps the leaderboard limit', () => {
    insertReputation(A, 1, 0, 0);
    insertReputation(B, 1, 0, 0);
    expect(leaderboard(1)).toHaveLength(1);
  });
});
