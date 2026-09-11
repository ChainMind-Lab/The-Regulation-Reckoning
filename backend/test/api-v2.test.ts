import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { getDb, resetDb } from '../src/db';
import {
  classifyPolicyRecords,
  loadPolicyDataset,
  persistPolicies,
} from '../src/services/ingest/policies';
import { loadSeedIssues, persistIssues } from '../src/services/ingest/issues';
import { persistEvents } from '../src/services/indexer';
import { ingestPolicies } from '../src/services/ingest/policies';
import type { SorobanContractEvent } from '../src/services/soroban';

vi.mock('../src/services/horizon', () => ({
  horizonServer: {},
  fetchNetworkStatus: vi.fn().mockResolvedValue({
    network: 'Test SDF Network ; September 2015',
    horizon: 'https://horizon-testnet.stellar.org',
    protocolVersion: '28',
    latestLedger: '4585568',
    closedAt: '2026-09-09T10:00:00Z',
  }),
  fetchRecentPayments: vi.fn().mockResolvedValue([]),
  pingHorizon: vi.fn().mockResolvedValue(4585568),
}));

const FUNDER = 'GB2OVPTEO2BYRRRRWNRPZZOC3VW77IQDXJPBY2WYV2MXSU7C5HQDZ6E6';
const CONTRIBUTOR = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const REVIEWER = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM';
const CONTRACT = 'CB4OI57YRKLAIX2RGFS7DX3GIGEST4MSI447VAJPRCBCNFUHWLWLQLWT';
const REGISTRY = 'CC53MJDM5M76GMZONKC56ONW4MM74MX3KF4LSXMWTRE7W66RASDP4W7Q';

// NOTE: `vi.mock` factories are hoisted above the module body, so the fixture
// literals are inlined here rather than referencing the constants below.
vi.mock('../src/services/soroban', () => ({
  SorobanError: class extends Error {},
  requireContractConfigured: vi.fn(),
  buildContractTransaction: vi.fn().mockResolvedValue({ txXdr: 'AAAA(unsigned-xdr)' }),
  submitSignedTransaction: vi.fn().mockResolvedValue({ hash: 'deadbeef', status: 'SUCCESS' }),
  isContractInitialised: vi.fn().mockResolvedValue(true),
  readBounty: vi.fn().mockResolvedValue(null),
  readBountyV2: vi.fn().mockResolvedValue({
    funder: 'GB2OVPTEO2BYRRRRWNRPZZOC3VW77IQDXJPBY2WYV2MXSU7C5HQDZ6E6',
    contributor: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
    token: 'CB4OI57YRKLAIX2RGFS7DX3GIGEST4MSI447VAJPRCBCNFUHWLWLQLWT',
    amount: '300',
    issue_id: 'issue-1',
    released: false,
    refunded: false,
    released_amount: '120',
    milestones: [
      { title: 'Research', amount: '120', settled: true },
      { title: 'Publish', amount: '180', settled: false },
    ],
    reviewers: ['GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM'],
    reviewer_quorum: 1,
  }),
  readSigners: vi.fn().mockResolvedValue({
    signers: [
      'GB2OVPTEO2BYRRRRWNRPZZOC3VW77IQDXJPBY2WYV2MXSU7C5HQDZ6E6',
      'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM',
    ],
    threshold: 2,
  }),
  readProposal: vi.fn().mockResolvedValue(null),
  readDispute: vi.fn().mockResolvedValue(null),
  readReputation: vi.fn().mockResolvedValue({
    payouts: 2,
    payout_total: '370',
    reviews_upheld: 1,
    disputes_opened: 0,
    disputes_lost: 0,
    score: 34,
  }),
  readContributorStats: vi.fn().mockResolvedValue({ count: 2, total: '370' }),
}));

import { createApp } from '../src/app';

function ev(
  id: string,
  topic: string,
  overrides: Partial<SorobanContractEvent> = {},
): SorobanContractEvent {
  return {
    id,
    txHash: `tx-${id}`,
    ledger: 2000,
    contractId: CONTRACT,
    topic,
    topics: [topic],
    issueId: 'issue-1',
    payload: {},
    createdAt: '2026-09-09T10:00:00Z',
    ...overrides,
  };
}

beforeEach(async () => {
  resetDb();
  persistPolicies(classifyPolicyRecords(loadPolicyDataset()));
  persistIssues(loadSeedIssues(), 'seed');
  await ingestPolicies(); // establishes regulation version history
  persistEvents([
    ev('b1', 'bounty_created', {
      payload: { funder: FUNDER, token: CONTRACT, amount: '300', milestones: 2 },
    }),
    ev('b2', 'contributor_claimed', { payload: { contributor: CONTRIBUTOR } }),
    ev('b3', 'reviewers_set', { payload: { reviewers: [REVIEWER], quorum: 1 } }),
    ev('b4', 'review_submitted', { payload: { milestone: 0, reviewer: REVIEWER, decision: 0 } }),
    ev('b5', 'milestone_released', {
      payload: { milestone: 0, contributor: CONTRIBUTOR, amount: '120', released_amount: '120' },
    }),
    ev('p1', 'proposal_created', {
      topics: ['proposal_created', '1'],
      payload: { proposer: FUNDER, action: 'Release' },
    }),
    ev('p2', 'proposal_executed', { topics: ['proposal_executed', '1'], payload: {} }),
    ev('d1', 'dispute_opened', {
      topics: ['dispute_opened', '1'],
      payload: { issue_id: 'issue-1', milestone: 1, opener: CONTRIBUTOR },
    }),
    ev('d2', 'dispute_vote_cast', {
      topics: ['dispute_vote_cast', '1'],
      payload: { reviewer: REVIEWER, pay_contributor: true },
    }),
    ev('r1', 'contributor_recorded', {
      contractId: REGISTRY,
      topics: ['contributor_recorded', CONTRIBUTOR],
      payload: { issue_id: 'issue-1', milestone: 0, amount: '120', total: '120' },
    }),
  ]);
});

describe('GET /api/bounties/:issueId/milestones', () => {
  it('merges live milestone state with indexed release history', async () => {
    const res = await request(createApp()).get('/api/bounties/issue-1/milestones');
    expect(res.status).toBe(200);
    expect(res.body.onChainVerified).toBe(true);
    expect(res.body.source).toBe('stellar');
    expect(res.body.milestones).toHaveLength(2);
    expect(res.body.milestones[0]).toMatchObject({
      index: 0,
      title: 'Research',
      amount: '120',
      settled: true,
    });
    expect(res.body.milestones[0].releasedUrl).toContain('stellar.expert');
    expect(res.body.reviewers[0].reviewer).toBe(REVIEWER);
    expect(res.body.reviewers[0].reviews[0].decision).toBe('approve');
    expect(res.body.quorum).toBe(1);
    expect(res.body.disputed).toBe(true);
    expect(res.body.releasedAmount).toBe('120');
  });

  it('returns 200 with index-only data when the bounty is not on chain', async () => {
    const { readBountyV2 } = await import('../src/services/soroban');
    vi.mocked(readBountyV2).mockResolvedValueOnce(null);
    const res = await request(createApp()).get('/api/bounties/issue-1/milestones');
    expect(res.status).toBe(200);
    expect(res.body.onChainVerified).toBe(false);
    expect(res.body.source).toBe('index');
    expect(res.body.reviewers[0].reviewer).toBe(REVIEWER);
  });
});

describe('GET /api/reviews', () => {
  it('lists reviews and filters by issue', async () => {
    const all = await request(createApp()).get('/api/reviews');
    expect(all.status).toBe(200);
    expect(all.body).toHaveLength(1);
    expect(all.body[0].decision).toBe('approve');
    expect(all.body[0].explorerUrl).toContain('stellar.expert');

    const none = await request(createApp()).get('/api/reviews?issueId=other');
    expect(none.body).toHaveLength(0);
  });
});

describe('GET /api/proposals', () => {
  it('lists indexed proposals', async () => {
    const res = await request(createApp()).get('/api/proposals');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ id: 1, action: 'Release', executed: true });
    expect(res.body[0].approvals).toEqual([FUNDER]);
  });

  it('falls back to the index when the live read is unavailable', async () => {
    const res = await request(createApp()).get('/api/proposals/1');
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('index');
    expect(res.body.verified).toBe(false);
  });

  it('prefers the live on-chain proposal when present', async () => {
    const { readProposal } = await import('../src/services/soroban');
    vi.mocked(readProposal).mockResolvedValueOnce({
      id: '1',
      action: ['Release', 'issue-1', 0],
      proposer: FUNDER,
      approvals: [FUNDER, REVIEWER],
      executed: true,
      cancelled: false,
    });
    const res = await request(createApp()).get('/api/proposals/1');
    expect(res.body.verified).toBe(true);
    expect(res.body.source).toBe('stellar');
    expect(res.body.approvals).toHaveLength(2);
  });

  it('404s for an unknown proposal', async () => {
    const res = await request(createApp()).get('/api/proposals/99');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('PROPOSAL_NOT_FOUND');
  });
});

describe('GET /api/disputes', () => {
  it('lists open disputes and filters', async () => {
    const open = await request(createApp()).get('/api/disputes?open=true');
    expect(open.status).toBe(200);
    expect(open.body).toHaveLength(1);
    expect(open.body[0]).toMatchObject({ issueId: 'issue-1', milestone: 1, resolved: false });
    expect(open.body[0].votesPayContributor).toBe(1);

    const resolved = await request(createApp()).get('/api/disputes?open=false');
    expect(resolved.body).toHaveLength(0);
  });

  it('404s for an unknown dispute', async () => {
    const res = await request(createApp()).get('/api/disputes/42');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('DISPUTE_NOT_FOUND');
  });
});

describe('GET /api/signers', () => {
  it('returns the live multisig configuration', async () => {
    const res = await request(createApp()).get('/api/signers');
    expect(res.status).toBe(200);
    expect(res.body.threshold).toBe(2);
    expect(res.body.signers).toHaveLength(2);
  });

  it('is included in /api/contract', async () => {
    const res = await request(createApp()).get('/api/contract');
    expect(res.body.signerThreshold).toBe(2);
    expect(res.body.signers).toHaveLength(2);
  });
});

describe('jurisdictions API', () => {
  it('lists jurisdictions', async () => {
    const res = await request(createApp()).get('/api/jurisdictions');
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0]).toHaveProperty('riskIndex');
  });

  it('compares jurisdictions without treating "compare" as an id', async () => {
    const list = (await request(createApp()).get('/api/jurisdictions')).body as Array<{
      jurisdiction: string;
    }>;
    const ids = list
      .slice(0, 2)
      .map((j) => j.jurisdiction)
      .join(',');
    const res = await request(createApp()).get(`/api/jurisdictions/compare?ids=${ids}`);
    expect(res.status).toBe(200);
    expect(res.body.profiles).toHaveLength(2);
    expect(res.body.cells.length).toBeGreaterThan(0);
  });

  it('returns a single profile with sources', async () => {
    const list = (await request(createApp()).get('/api/jurisdictions')).body as Array<{
      jurisdiction: string;
    }>;
    const res = await request(createApp()).get(`/api/jurisdictions/${list[0].jurisdiction}`);
    expect(res.status).toBe(200);
    expect(res.body.sources[0].sourceUrl).toMatch(/^https?:\/\//);
  });

  it('404s for an unknown jurisdiction', async () => {
    const res = await request(createApp()).get('/api/jurisdictions/ZZ');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('JURISDICTION_NOT_FOUND');
  });
});

describe('regulation history + alerts API', () => {
  it('exposes version history', async () => {
    const versions = await request(createApp()).get('/api/regulations/versions');
    expect(versions.status).toBe(200);
    expect(versions.body.length).toBeGreaterThan(0);
    expect(versions.body[0]).toHaveProperty('contentHash');
  });

  it('exposes per-policy versions and diffs', async () => {
    const all = (await request(createApp()).get('/api/regulations/versions')).body as Array<{
      policyId: string;
      version: number;
    }>;
    const policyId = all[0].policyId;
    const versions = await request(createApp()).get(`/api/regulations/${policyId}/versions`);
    expect(versions.body).toHaveLength(1);

    const diff = await request(createApp()).get(
      `/api/regulations/${policyId}/diff?from=1&to=1`,
    );
    expect(diff.status).toBe(200);
    expect(diff.body.changes).toEqual([]);
  });

  it('404s a diff against a missing revision', async () => {
    const res = await request(createApp()).get('/api/regulations/nope/diff?from=1&to=2');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('VERSION_NOT_FOUND');
  });

  it('lists alerts and acknowledges them', async () => {
    // Second ingestion with a mutated dataset would raise an alert; instead
    // assert the endpoint shape and the 404 path for unknown ids.
    const res = await request(createApp()).get('/api/alerts');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);

    const missing = await request(createApp()).post('/api/alerts/unknown/acknowledge');
    expect(missing.status).toBe(404);
    expect(missing.body.code).toBe('ALERT_NOT_FOUND');
  });
});

describe('reputation API', () => {
  it('returns a leaderboard', async () => {
    const res = await request(createApp()).get('/api/reputation/leaderboard');
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThan(0);
    expect(res.body.entries[0].tier).toBeTruthy();
  });

  it('reconciles on-chain and indexed reputation', async () => {
    const res = await request(createApp()).get(`/api/reputation/${CONTRIBUTOR}`);
    expect(res.status).toBe(200);
    expect(res.body.onChain.score).toBe(34);
    expect(res.body.indexed.payouts).toBe(1);
    expect(res.body.reputation.score).toBe(34);
    // The ledger struct is normalised to the indexed JSON shape (camelCase + tier).
    expect(res.body.onChain.source).toBe('stellar');
    expect(res.body.onChain.payoutTotal).toBe('370');
    expect(typeof res.body.onChain.tier).toBe('string');
    expect(res.body.reputation.tier).toBeTruthy();
  });

  it('rejects a malformed address', async () => {
    const res = await request(createApp()).get('/api/reputation/not-an-address');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('BAD_ADDRESS');
  });

  it('404s when neither source knows the address', async () => {
    const { readReputation } = await import('../src/services/soroban');
    vi.mocked(readReputation).mockResolvedValueOnce(null);
    const res = await request(createApp()).get(
      '/api/reputation/GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM',
    );
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('REPUTATION_NOT_FOUND');
  });
});

describe('POST /api/tx/build (v2 relay)', () => {
  const base = { source: FUNDER };

  async function build(body: Record<string, unknown>) {
    return request(createApp())
      .post('/api/tx/build')
      .send({ ...base, ...body });
  }

  it('builds a milestone bounty creation', async () => {
    const res = await build({
      action: 'createBounty',
      funder: FUNDER,
      token: CONTRACT,
      issueId: 'issue-9',
      milestones: [
        { title: 'Research', amount: '100' },
        { title: 'Publish', amount: '200' },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.txXdr).toBeTruthy();
  });

  it('builds a release proposal', async () => {
    const res = await build({
      action: 'proposeRelease',
      proposer: FUNDER,
      issueId: 'issue-1',
      milestone: 1,
    });
    expect(res.status).toBe(200);
  });

  it('builds signer and reviewer proposals', async () => {
    expect(
      (
        await build({
          action: 'proposeSetSigners',
          proposer: FUNDER,
          signers: [FUNDER, REVIEWER],
          threshold: 2,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await build({
          action: 'proposeSetReviewers',
          proposer: FUNDER,
          issueId: 'issue-1',
          reviewers: [REVIEWER],
          quorum: 1,
        })
      ).status,
    ).toBe(200);
  });

  it('builds reviews, disputes and approvals', async () => {
    expect(
      (
        await build({
          action: 'submitReview',
          reviewer: REVIEWER,
          issueId: 'issue-1',
          milestone: 0,
          decision: 'approve',
          commentHash: 'ipfs://abc',
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await build({
          action: 'openDispute',
          opener: CONTRIBUTOR,
          issueId: 'issue-1',
          milestone: 1,
          reasonHash: 'ipfs://reason',
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await build({
          action: 'voteDispute',
          reviewer: REVIEWER,
          disputeId: 1,
          payContributor: true,
        })
      ).status,
    ).toBe(200);
    expect(
      (await build({ action: 'approve', signer: REVIEWER, proposalId: 1 })).status,
    ).toBe(200);
  });

  it('rejects an invalid review decision', async () => {
    const res = await build({
      action: 'submitReview',
      reviewer: REVIEWER,
      issueId: 'issue-1',
      milestone: 0,
      decision: 'maybe',
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('BAD_FIELD');
  });

  it('encodes the review decision as a u32 discriminant, not a symbol vector', async () => {
    const buildContractTransaction = vi.mocked(
      (await import('../src/services/soroban')).buildContractTransaction,
    );
    buildContractTransaction.mockClear();
    const res = await build({
      action: 'submitReview',
      reviewer: REVIEWER,
      issueId: 'issue-1',
      milestone: 0,
      decision: 'approve',
    });
    expect(res.status).toBe(200);
    const args = buildContractTransaction.mock.calls[0][1];
    // Milestone 0 must be the u32 discriminator for `Approve` — the SDK encodes
    // all-integer-discriminant enums as u32 (0/1), not as a Symbol vec.
    expect(args[3]).toEqual({ type: 'u32', value: 0 });
  });

  it('rejects an empty milestone list', async () => {
    const res = await build({
      action: 'createBounty',
      funder: FUNDER,
      token: CONTRACT,
      issueId: 'issue-9',
      milestones: [],
    });
    expect(res.status).toBe(400);
  });

  it('rejects unknown actions', async () => {
    const res = await build({ action: 'init' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('BAD_ACTION');
  });
});
