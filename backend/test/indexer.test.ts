import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { getDb } from '../src/db';
import {
  persistEvents,
  rebuildBountyState,
  getCursor,
  setCursor,
  getLastIndexedLedger,
  detectLedgerGap,
  indexOnce,
} from '../src/services/indexer';
import { fetchContractEvents } from '../src/services/soroban';
import type { SorobanContractEvent } from '../src/services/soroban';

// Mock only the RPC fetcher; everything else in soroban.ts stays real.
vi.mock('../src/services/soroban', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/soroban')>();
  return { ...actual, fetchContractEvents: vi.fn() };
});

const CONTRACT = 'CDE5G6LZC27ZXEYTZAELNSMHLZAR6PNLTP3UMJZNAQ7TXDG337A7DBR6';
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

describe('missed-ledger detection', () => {
  it('reports zero gap on the first run or with no events', () => {
    expect(detectLedgerGap([])).toBe(0);
    expect(detectLedgerGap([event({ id: 'e1', ledger: 500 })])).toBe(0);
  });

  it('reports zero gap when ledgers are contiguous', () => {
    setCursor('c1');
    const db = getDb();
    db.prepare(
      "INSERT INTO indexer_state (key, value) VALUES ('last_indexed_ledger', '500') ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    ).run();
    expect(detectLedgerGap([event({ id: 'e1', ledger: 501 })])).toBe(0);
    expect(detectLedgerGap([event({ id: 'e1', ledger: 502 })])).toBe(1);
  });

  it('detects large gaps after an outage', () => {
    const db = getDb();
    db.prepare(
      "INSERT INTO indexer_state (key, value) VALUES ('last_indexed_ledger', '1000') ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    ).run();
    expect(detectLedgerGap([event({ id: 'e1', ledger: 2000 })])).toBe(999);
  });
});

describe('indexOnce failure handling', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('contains RPC failures: cursor is preserved and nothing is persisted', async () => {
    setCursor('keep-me');
    vi.mocked(fetchContractEvents).mockRejectedValue(new Error('RPC unreachable'));
    const inserted = await indexOnce();
    expect(inserted).toBe(0);
    expect(getCursor()).toBe('keep-me');
    const count = (
      getDb().prepare('SELECT COUNT(*) AS c FROM soroban_events').get() as { c: number }
    ).c;
    expect(count).toBe(0);
  });

  it('rolls back the batch and preserves the cursor when persist fails', async () => {
    setCursor('keep-me');
    vi.mocked(fetchContractEvents).mockResolvedValue({
      events: [event({ id: 'e1' })],
      nextCursor: 'next-cursor',
    });
    // Force the event upsert prepare to throw — simulates a database failure
    // mid-batch (cursor reads must still work).
    const db = getDb();
    const originalPrepare = db.prepare.bind(db);
    const spy = vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
      if (sql.includes('INSERT INTO soroban_events')) {
        throw new Error('database is locked');
      }
      return originalPrepare(sql);
    });
    const inserted = await indexOnce();
    expect(inserted).toBe(0);
    spy.mockRestore();
    // Cursor must NOT advance past the failed batch.
    expect(getCursor()).toBe('keep-me');
    const count = (
      getDb().prepare('SELECT COUNT(*) AS c FROM soroban_events').get() as { c: number }
    ).c;
    expect(count).toBe(0);
  });

  it('advances the cursor and records the last ledger on success', async () => {
    setCursor('c-old');
    vi.mocked(fetchContractEvents).mockResolvedValue({
      events: [event({ id: 'e1', ledger: 555 })],
      nextCursor: 'c-new',
    });
    const inserted = await indexOnce();
    expect(inserted).toBe(1);
    expect(getCursor()).toBe('c-new');
    expect(getLastIndexedLedger()).toBe(555);
  });
});

describe('persistEvents database failure', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('re-throws and leaves no partial batch', () => {
    const db = getDb();
    const originalPrepare = db.prepare.bind(db);
    const spy = vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
      if (sql.includes('INSERT INTO soroban_events')) {
        throw new Error('disk full');
      }
      return originalPrepare(sql);
    });
    expect(() => persistEvents([event({ id: 'e1' })])).toThrow('disk full');
    spy.mockRestore();
    const count = (db.prepare('SELECT COUNT(*) AS c FROM soroban_events').get() as { c: number }).c;
    expect(count).toBe(0);
  });
});
