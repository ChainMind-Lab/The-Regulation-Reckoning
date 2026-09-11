import { describe, it, expect, beforeEach } from 'vitest';
import { getDb } from '../src/db';
import { persistEvents, rebuildReadModels, reputationScore } from '../src/services/indexer';
import type { SorobanContractEvent } from '../src/services/soroban';

const BOUNTY = 'CB4OI57YRKLAIX2RGFS7DX3GIGEST4MSI447VAJPRCBCNFUHWLWLQLWT';
const REGISTRY = 'CC53MJDM5M76GMZONKC56ONW4MM74MX3KF4LSXMWTRE7W66RASDP4W7Q';
const FUNDER = 'GB2OVPTEO2BYRRRRWNRPZZOC3VW77IQDXJPBY2WYV2MXSU7C5HQDZ6E6';
const CONTRIBUTOR = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const REVIEWER_1 = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM';
const REVIEWER_2 = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAK3IM';

let seq = 0;
function ev(
  topic: string,
  overrides: Partial<SorobanContractEvent> = {},
): SorobanContractEvent {
  seq += 1;
  return {
    id: `evt-${seq}`,
    txHash: `tx-${seq}`,
    ledger: 1000 + seq,
    contractId: BOUNTY,
    topic,
    topics: [topic],
    issueId: 'issue-1',
    payload: {},
    createdAt: `2026-09-09T10:00:${String(seq).padStart(2, '0')}Z`,
    ...overrides,
  };
}

beforeEach(() => {
  const db = getDb();
  for (const table of [
    'soroban_events',
    'bounties',
    'milestones',
    'bounty_reviewers',
    'reviews',
    'proposals',
    'disputes',
    'reputation',
  ]) {
    db.exec(`DELETE FROM ${table}`);
  }
  seq = 0;
});

function seedFullFlow(): void {
  persistEvents([
    ev('bounty_created', {
      payload: { funder: FUNDER, token: REGISTRY, amount: '300', milestones: 2 },
    }),
    ev('contributor_claimed', { payload: { contributor: CONTRIBUTOR } }),
    ev('reviewers_set', {
      payload: { reviewers: [REVIEWER_1, REVIEWER_2], quorum: 2 },
    }),
    ev('review_submitted', {
      payload: { milestone: 0, reviewer: REVIEWER_1, decision: 0 },
    }),
    ev('milestone_released', {
      payload: {
        milestone: 0,
        contributor: CONTRIBUTOR,
        amount: '120',
        released_amount: '120',
      },
    }),
    ev('proposal_created', {
      topics: ['proposal_created', '1'],
      payload: { proposer: FUNDER, action: 'Release' },
    }),
    ev('proposal_approved', {
      topics: ['proposal_approved', '1'],
      payload: { signer: REVIEWER_1, approvals: 2 },
    }),
    ev('proposal_executed', { topics: ['proposal_executed', '1'], payload: {} }),
    ev('dispute_opened', {
      topics: ['dispute_opened', '1'],
      payload: { issue_id: 'issue-1', milestone: 1, opener: CONTRIBUTOR },
    }),
    ev('dispute_vote_cast', {
      topics: ['dispute_vote_cast', '1'],
      payload: { reviewer: REVIEWER_1, pay_contributor: true },
    }),
    ev('dispute_resolved', {
      topics: ['dispute_resolved', '1'],
      payload: { issue_id: 'issue-1', milestone: 1, pay_contributor: true },
    }),
    // Registry (inter-contract) events carry the subject address in topic[1].
    ev('contributor_recorded', {
      contractId: REGISTRY,
      topics: ['contributor_recorded', CONTRIBUTOR],
      payload: { issue_id: 'issue-1', milestone: 0, amount: '120', total: '120' },
    }),
    ev('review_recorded', {
      contractId: REGISTRY,
      topics: ['review_recorded', REVIEWER_1],
      payload: { issue_id: 'issue-1', milestone: 0, upheld: 1 },
    }),
    ev('dispute_recorded', {
      contractId: REGISTRY,
      topics: ['dispute_recorded', CONTRIBUTOR],
      payload: { issue_id: 'issue-1', milestone: 1, lost: true },
    }),
  ]);
}

describe('v2 read-model rebuilds', () => {
  it('derives milestone accounting on the bounty row', () => {
    seedFullFlow();
    const row = getDb()
      .prepare(
        `SELECT amount, released_amount AS releasedAmount, contributor, milestones, released
         FROM bounties WHERE issue_id = 'issue-1'`,
      )
      .get() as {
      amount: string;
      releasedAmount: string;
      contributor: string;
      milestones: number;
      released: number;
    };
    expect(row.amount).toBe('300');
    expect(row.releasedAmount).toBe('120');
    expect(row.contributor).toBe(CONTRIBUTOR);
    expect(row.milestones).toBe(2);
    // One of two milestones paid, so the bounty is not fully settled.
    expect(row.released).toBe(0);
  });

  it('records each released milestone with its transaction', () => {
    seedFullFlow();
    const rows = getDb()
      .prepare(
        `SELECT idx, amount, settled, released_tx AS releasedTx FROM milestones ORDER BY idx`,
      )
      .all() as unknown as Array<{
      idx: number;
      amount: string;
      settled: number;
      releasedTx: string;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].idx).toBe(0);
    expect(rows[0].amount).toBe('120');
    expect(rows[0].settled).toBe(1);
    expect(rows[0].releasedTx).toContain('tx-');
  });

  it('rebuilds the reviewer set with its quorum', () => {
    seedFullFlow();
    const rows = getDb()
      .prepare(`SELECT reviewer, quorum FROM bounty_reviewers ORDER BY reviewer`)
      .all() as unknown as Array<{ reviewer: string; quorum: number }>;
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.reviewer)).toEqual([REVIEWER_1, REVIEWER_2]);
    expect(rows[0].quorum).toBe(2);
  });

  it('rebuilds reviews with a decoded decision', () => {
    seedFullFlow();
    const row = getDb()
      .prepare(
        `SELECT id, issue_id AS issueId, milestone, reviewer, decision FROM reviews`,
      )
      .get() as {
      id: string;
      issueId: string;
      milestone: number;
      reviewer: string;
      decision: string;
    };
    expect(row.issueId).toBe('issue-1');
    expect(row.milestone).toBe(0);
    expect(row.reviewer).toBe(REVIEWER_1);
    expect(row.decision).toBe('approve');
  });

  it('rebuilds proposals with approvals and execution state', () => {
    seedFullFlow();
    const row = getDb()
      .prepare(
        `SELECT id, proposer, action, approvals, executed, cancelled FROM proposals WHERE id = 1`,
      )
      .get() as {
      id: number;
      proposer: string;
      action: string;
      approvals: string;
      executed: number;
      cancelled: number;
    };
    expect(row.proposer).toBe(FUNDER);
    expect(row.action).toBe('Release');
    expect(JSON.parse(row.approvals)).toEqual([FUNDER, REVIEWER_1]);
    expect(row.executed).toBe(1);
    expect(row.cancelled).toBe(0);
  });

  it('rebuilds disputes with vote tallies and outcome', () => {
    seedFullFlow();
    const row = getDb()
      .prepare(
        `SELECT id, issue_id AS issueId, milestone, opener, votes_pay_contributor AS yes,
                votes_refund_funder AS no, resolved, pay_contributor AS pay FROM disputes`,
      )
      .get() as {
      id: number;
      issueId: string;
      milestone: number;
      opener: string;
      yes: number;
      no: number;
      resolved: number;
      pay: number;
    };
    expect(row.issueId).toBe('issue-1');
    expect(row.milestone).toBe(1);
    expect(row.opener).toBe(CONTRIBUTOR);
    expect(row.yes).toBe(1);
    expect(row.no).toBe(0);
    expect(row.resolved).toBe(1);
    expect(row.pay).toBe(1);
  });

  it('rebuilds verifiable reputation from registry events', () => {
    seedFullFlow();
    const db = getDb();
    const contributor = db
      .prepare(`SELECT * FROM reputation WHERE address = ?`)
      .get(CONTRIBUTOR) as {
      payouts: number;
      payout_total: string;
      disputes_opened: number;
      disputes_lost: number;
      score: number;
    };
    expect(contributor.payouts).toBe(1);
    expect(contributor.payout_total).toBe('120');
    expect(contributor.disputes_opened).toBe(1);
    expect(contributor.disputes_lost).toBe(1);
    expect(contributor.score).toBe(reputationScore(1, 0, 1)); // 12 - 15 → clamped to 0

    const reviewer = db
      .prepare(`SELECT reviews_upheld AS upheld, score FROM reputation WHERE address = ?`)
      .get(REVIEWER_1) as { upheld: number; score: number };
    expect(reviewer.upheld).toBe(1);
    expect(reviewer.score).toBe(10);
  });

  it('is replay-safe: re-persisting the same batch adds nothing', () => {
    seedFullFlow();
    const before = JSON.stringify(getDb().prepare('SELECT * FROM bounties').all());
    persistEvents([
      ev('bounty_created', {
        id: 'evt-1',
        payload: { funder: FUNDER, token: REGISTRY, amount: '300', milestones: 2 },
      }),
    ]);
    const after = JSON.stringify(getDb().prepare('SELECT * FROM bounties').all());
    expect(after).toBe(before);
  });

  it('is deterministic: rebuilding twice yields identical state', () => {
    seedFullFlow();
    cleanupAndRebuild();
    const first = snapshot();
    cleanupAndRebuild();
    const second = snapshot();
    expect(second).toBe(first);
  });

  it('does not double-count reputation when the same event is stored twice', () => {
    // Two events with the same (subject, issue, milestone) but different ids
    // model a replay with a different event id — the dedup guard must hold.
    persistEvents([
      ev('contributor_recorded', {
        contractId: REGISTRY,
        topics: ['contributor_recorded', CONTRIBUTOR],
        payload: { issue_id: 'issue-1', milestone: 0, amount: '120', total: '120' },
      }),
      ev('contributor_recorded', {
        contractId: REGISTRY,
        topics: ['contributor_recorded', CONTRIBUTOR],
        payload: { issue_id: 'issue-1', milestone: 0, amount: '120', total: '240' },
      }),
    ]);
    const row = getDb()
      .prepare(`SELECT payouts FROM reputation WHERE address = ?`)
      .get(CONTRIBUTOR) as { payouts: number };
    expect(row.payouts).toBe(1);
  });
});

function cleanupAndRebuild(): void {
  const db = getDb();
  for (const table of [
    'bounties',
    'milestones',
    'bounty_reviewers',
    'reviews',
    'proposals',
    'disputes',
    'reputation',
  ]) {
    db.exec(`DELETE FROM ${table}`);
  }
  rebuildReadModels();
}

function snapshot(): string {
  const db = getDb();
  return ['bounties', 'milestones', 'bounty_reviewers', 'reviews', 'proposals', 'disputes', 'reputation']
    .map((t) => JSON.stringify(db.prepare(`SELECT * FROM ${t}`).all()))
    .join('|');
}
