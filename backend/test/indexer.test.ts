import { describe, it, expect, beforeEach } from 'vitest';
import { getDb } from '../src/db';
import { persistEvents, rebuildBountyState, getCursor, setCursor } from '../src/services/indexer';
import type { SorobanContractEvent } from '../src/services/soroban';

const CONTRACT = 'CC2YEX6U7HV7L7L45HVOLVWGN2POARLPS3XICZS6KQH5Y52OTAHK7LVY';
const TOKEN = 'CCOAF5DIHLO4457S6EGQYSLXGGDRQPTO42DU6N5KVH4M2MSA2VDW2NB4';
const FUNDER = 'GBRVOQSLP32BGOCYA56DCTM5PUQWW7YLBBAKVXBHDTJ6SNKVLGMWFRQI';

function event(overrides: Partial<SorobanContractEvent> & { id: string }): SorobanContractEvent {
  return {
    txHash: `tx-${overrides.id}`,
    ledger: 100,
    contractId: CONTRACT,
    topic: 'bounty_created',
    issueId: 'gh-1',
    payload: { funder: FUNDER, token: TOKEN, amount: '250' },
    createdAt: '2026-09-09T10:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  const db = getDb();
  db.exec('DELETE FROM soroban_events');
  db.exec('DELETE FROM bounties');
  db.exec("DELETE FROM indexer_state WHERE key = 'soroban_events_cursor'");
});

describe('persistEvents', () => {
  it('inserts events and is replay-safe (idempotent)', () => {
    const e1 = event({
      id: 'e1',
      issueId: 'gh-1',
      payload: { funder: FUNDER, token: TOKEN, amount: '250' },
    });
    expect(persistEvents([e1])).toBe(1);
    // Replaying the exact same event must not duplicate it.
    expect(persistEvents([e1])).toBe(0);
    const db = getDb();
    const count = (db.prepare('SELECT COUNT(*) AS c FROM soroban_events').get() as { c: number }).c;
    expect(count).toBe(1);
  });

  it('skips malformed payloads without crashing', () => {
    const bad = event({ id: 'bad', payload: {} as never });
    expect(() => persistEvents([bad])).not.toThrow();
  });
});

describe('rebuildBountyState', () => {
  it('derives an open bounty from bounty_created', () => {
    persistEvents([
      event({
        id: 'e1',
        issueId: 'gh-1',
        payload: { funder: FUNDER, token: TOKEN, amount: '250' },
      }),
    ]);
    rebuildBountyState();
    const db = getDb();
    const row = db
      .prepare('SELECT issue_id AS issueId, released, amount FROM bounties WHERE issue_id = ?')
      .get('gh-1') as { issueId: string; released: number; amount: string };
    expect(row.issueId).toBe('gh-1');
    expect(row.released).toBe(0);
    expect(row.amount).toBe('250');
  });

  it('releases a bounty when bounty_released arrives', () => {
    persistEvents([
      event({
        id: 'e1',
        issueId: 'gh-1',
        payload: { funder: FUNDER, token: TOKEN, amount: '250' },
      }),
      event({
        id: 'e2',
        topic: 'bounty_released',
        issueId: 'gh-1',
        payload: { contributor: FUNDER, token: TOKEN, amount: '250' },
      }),
    ]);
    rebuildBountyState();
    const db = getDb();
    const row = db
      .prepare(
        'SELECT released, contributor, released_tx AS releasedTx FROM bounties WHERE issue_id = ?',
      )
      .get('gh-1') as { released: number; contributor: string; releasedTx: string };
    expect(row.released).toBe(1);
    expect(row.contributor).toBe(FUNDER);
    expect(row.releasedTx).toBe('tx-e2');
  });

  it('reclaim settles the bounty without a contributor', () => {
    persistEvents([
      event({
        id: 'e1',
        issueId: 'gh-3',
        payload: { funder: FUNDER, token: TOKEN, amount: '100' },
      }),
      event({
        id: 'e2',
        topic: 'bounty_reclaimed',
        issueId: 'gh-3',
        payload: { funder: FUNDER, token: TOKEN, amount: '100' },
      }),
    ]);
    rebuildBountyState();
    const db = getDb();
    const row = db
      .prepare('SELECT released, contributor FROM bounties WHERE issue_id = ?')
      .get('gh-3') as { released: number; contributor: string | null };
    expect(row.released).toBe(1);
    expect(row.contributor).toBeNull();
  });

  it('replaying the same event batch always yields the same state', () => {
    const events = [
      event({
        id: 'e1',
        issueId: 'gh-1',
        payload: { funder: FUNDER, token: TOKEN, amount: '250' },
      }),
      event({
        id: 'e2',
        topic: 'bounty_released',
        issueId: 'gh-1',
        payload: { contributor: FUNDER, token: TOKEN, amount: '250' },
      }),
    ];
    persistEvents(events);
    rebuildBountyState();
    const first = JSON.stringify(getDb().prepare('SELECT * FROM bounties').all());
    rebuildBountyState();
    const second = JSON.stringify(getDb().prepare('SELECT * FROM bounties').all());
    expect(first).toBe(second);
  });
});

describe('cursor', () => {
  it('stores and retrieves the event cursor', () => {
    expect(getCursor()).toBeNull();
    setCursor('001-0001');
    expect(getCursor()).toBe('001-0001');
  });
});
