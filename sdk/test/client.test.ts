import { describe, it, expect, vi } from 'vitest';
import { RegulationReckoningClient, RegulationReckoningError, type FetchLike } from '../src';

interface Call {
  url: string;
  init?: { method?: string; headers?: Record<string, string>; body?: string };
}

/** Build a mock fetch that records calls and returns the given JSON payload. */
function mockFetch(payload: unknown, status = 200) {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    };
  };
  return { fetchImpl, calls };
}

const ADDRESS = 'GB2OVPTEO2BYRRRRWNRPZZOC3VW77IQDXJPBY2WYV2MXSU7C5HQDZ6E6';

describe('constructor', () => {
  it('accepts a base URL string and strips trailing slashes', async () => {
    const { fetchImpl, calls } = mockFetch([]);
    const client = new RegulationReckoningClient({
      baseUrl: 'https://api.test/',
      fetch: fetchImpl,
    });
    await client.getPolicies();
    expect(calls[0].url).toBe('https://api.test/api/policies');
  });

  it('requires a base URL', () => {
    expect(
      () => new RegulationReckoningClient({ baseUrl: '', fetch: mockFetch([]).fetchImpl }),
    ).toThrow(RegulationReckoningError);
  });

  it('sends configured headers on every request', async () => {
    const { fetchImpl, calls } = mockFetch([]);
    const client = new RegulationReckoningClient({
      baseUrl: 'https://api.test',
      fetch: fetchImpl,
      headers: { 'X-Api-Key': 'secret' },
    });
    await client.getNetwork();
    expect(calls[0].init?.headers?.['X-Api-Key']).toBe('secret');
    expect(calls[0].init?.headers?.Accept).toBe('application/json');
  });
});

describe('read endpoints', () => {
  it('fetches regulatory data and jurisdictions', async () => {
    const { fetchImpl, calls } = mockFetch({ ok: true });
    const client = new RegulationReckoningClient({ baseUrl: 'https://api.test', fetch: fetchImpl });

    await client.getPolicies();
    await client.getAnalytics();
    await client.getJurisdictions();
    await client.getJurisdiction('EU');
    await client.getContract();
    await client.getSigners();
    await client.getBounties();
    await client.getMilestones('issue-1');
    await client.getProposals();
    await client.getProposal(3);
    await client.getDisputes();
    await client.getDispute(2);
    await client.getReputationLeaderboard(5);
    await client.getContributor(ADDRESS);

    expect(calls.map((c) => c.url)).toEqual([
      'https://api.test/api/policies',
      'https://api.test/api/analytics',
      'https://api.test/api/jurisdictions',
      'https://api.test/api/jurisdictions/EU',
      'https://api.test/api/contract',
      'https://api.test/api/signers',
      'https://api.test/api/bounties',
      'https://api.test/api/bounties/issue-1/milestones',
      'https://api.test/api/proposals?limit=50',
      'https://api.test/api/proposals/3',
      'https://api.test/api/disputes',
      'https://api.test/api/disputes/2',
      'https://api.test/api/reputation/leaderboard?limit=5',
      `https://api.test/api/contributors/${ADDRESS}`,
    ]);
  });

  it('encodes query filters', async () => {
    const { fetchImpl, calls } = mockFetch([]);
    const client = new RegulationReckoningClient({ baseUrl: 'https://api.test', fetch: fetchImpl });

    await client.getAlerts({ severity: 'critical', acknowledged: false, limit: 5 });
    await client.getReviews({ issueId: 'i1', milestone: 0 });
    await client.getDisputes({ open: true });
    await client.compareJurisdictions(['EU', 'US'], 'sanctions');
    await client.getRegulationDiff('eu-mica', 1, 2);

    expect(calls[0].url).toBe(
      'https://api.test/api/alerts?severity=critical&acknowledged=false&limit=5',
    );
    expect(calls[1].url).toBe('https://api.test/api/reviews?issueId=i1&milestone=0');
    expect(calls[2].url).toBe('https://api.test/api/disputes?open=true');
    expect(calls[3].url).toBe(
      'https://api.test/api/jurisdictions/compare?ids=EU%2CUS&category=sanctions',
    );
    expect(calls[4].url).toBe('https://api.test/api/regulations/eu-mica/diff?from=1&to=2');
  });

  it('looks up a single policy client-side', async () => {
    const { fetchImpl } = mockFetch([{ id: 'a' }, { id: 'b' }]);
    const client = new RegulationReckoningClient({ baseUrl: 'https://api.test', fetch: fetchImpl });
    expect(await client.getPolicy('b')).toEqual({ id: 'b' });
    expect(await client.getPolicy('zz')).toBeNull();
  });

  it('validates addresses before issuing a request', () => {
    const { fetchImpl, calls } = mockFetch({});
    const client = new RegulationReckoningClient({ baseUrl: 'https://api.test', fetch: fetchImpl });
    // Validation is synchronous: an invalid address throws without a request.
    expect(() => client.getReputation('nope')).toThrow(RegulationReckoningError);
    expect(() => client.getContributor('nope')).toThrow(/valid Stellar/);
    expect(calls).toHaveLength(0);
  });
});

describe('error handling', () => {
  it('maps an API error body onto a typed error', async () => {
    const { fetchImpl } = mockFetch({ error: 'Bounty not found', code: 'BOUNTY_NOT_FOUND' }, 404);
    const client = new RegulationReckoningClient({ baseUrl: 'https://api.test', fetch: fetchImpl });
    await expect(client.getBounty('x')).rejects.toMatchObject({
      name: 'RegulationReckoningError',
      status: 404,
      code: 'BOUNTY_NOT_FOUND',
      message: 'Bounty not found',
    });
  });

  it('falls back to a generic message for a non-JSON error body', async () => {
    const fetchImpl: FetchLike = async () => ({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error('not json');
      },
      text: async () => 'boom',
    });
    const client = new RegulationReckoningClient({ baseUrl: 'https://api.test', fetch: fetchImpl });
    await expect(client.getPolicies()).rejects.toThrow(/API error 500 on \/api\/policies/);
  });
});

describe('transaction relay', () => {
  it('posts the action, source and extras as JSON', async () => {
    const { fetchImpl, calls } = mockFetch({
      txXdr: 'AAAA',
      action: 'create',
      networkPassphrase: 'Test',
    });
    const client = new RegulationReckoningClient({ baseUrl: 'https://api.test', fetch: fetchImpl });

    const res = await client.buildCreateBounty({
      source: ADDRESS,
      funder: ADDRESS,
      token: 'CB4OI57YRKLAIX2RGFS7DX3GIGEST4MSI447VAJPRCBCNFUHWLWLQLWT',
      amount: '250',
      issueId: 'issue-1',
    });

    expect(res.txXdr).toBe('AAAA');
    expect(calls[0].url).toBe('https://api.test/api/tx/build');
    expect(calls[0].init?.method).toBe('POST');
    expect(calls[0].init?.headers?.['Content-Type']).toBe('application/json');
    expect(JSON.parse(calls[0].init?.body ?? '{}')).toEqual({
      action: 'create',
      source: ADDRESS,
      funder: ADDRESS,
      token: 'CB4OI57YRKLAIX2RGFS7DX3GIGEST4MSI447VAJPRCBCNFUHWLWLQLWT',
      amount: '250',
      issueId: 'issue-1',
    });
  });

  it('maps typed helpers onto the right relay actions', async () => {
    const { fetchImpl, calls } = mockFetch({ txXdr: 'x', action: 'a', networkPassphrase: 'p' });
    const client = new RegulationReckoningClient({ baseUrl: 'https://api.test', fetch: fetchImpl });

    await client.buildCreateMilestoneBounty({
      source: ADDRESS,
      funder: ADDRESS,
      token: 'CABC',
      issueId: 'i1',
      milestones: [
        { title: 'Research', amount: '100' },
        { title: 'Publish', amount: 200 },
      ],
    });
    await client.buildProposeRelease({
      source: ADDRESS,
      proposer: ADDRESS,
      issueId: 'i1',
      milestone: 1,
    });
    await client.buildProposeSetSigners({
      source: ADDRESS,
      proposer: ADDRESS,
      signers: [ADDRESS],
      threshold: 1,
    });
    await client.buildProposeSetReviewers({
      source: ADDRESS,
      proposer: ADDRESS,
      issueId: 'i1',
      reviewers: [ADDRESS],
      quorum: 1,
    });
    await client.buildApproveProposal({ source: ADDRESS, signer: ADDRESS, proposalId: 7 });
    await client.buildSubmitReview({
      source: ADDRESS,
      reviewer: ADDRESS,
      issueId: 'i1',
      milestone: 0,
      decision: 'reject',
    });
    await client.buildOpenDispute({
      source: ADDRESS,
      opener: ADDRESS,
      issueId: 'i1',
      milestone: 0,
    });
    await client.buildVoteDispute({
      source: ADDRESS,
      reviewer: ADDRESS,
      disputeId: 1,
      payContributor: true,
    });
    await client.buildClaimBounty({ source: ADDRESS, issueId: 'i1', contributor: ADDRESS });
    await client.submitTransaction('AAAA');

    const actions = calls.map((c) => JSON.parse(c.init?.body ?? '{}').action);
    expect(actions).toEqual([
      'createBounty',
      'proposeRelease',
      'proposeSetSigners',
      'proposeSetReviewers',
      'approve',
      'submitReview',
      'openDispute',
      'voteDispute',
      'claim',
      undefined,
    ]);

    const milestones = JSON.parse(calls[0].init?.body ?? '{}').milestones;
    expect(milestones).toEqual([
      { title: 'Research', amount: '100' },
      { title: 'Publish', amount: '200' },
    ]);
    const review = JSON.parse(calls[5].init?.body ?? '{}');
    expect(review.decision).toBe('reject');
    expect(review.commentHash).toBe('');
  });

  it('acknowledges an alert with a POST and no body', async () => {
    const { fetchImpl, calls } = mockFetch({ id: 'a1', acknowledged: true });
    const client = new RegulationReckoningClient({ baseUrl: 'https://api.test', fetch: fetchImpl });
    const res = await client.acknowledgeAlert('a1');
    expect(res.acknowledged).toBe(true);
    expect(calls[0].url).toBe('https://api.test/api/alerts/a1/acknowledge');
    expect(calls[0].init?.method).toBe('POST');
    expect(calls[0].init?.body).toBeUndefined();
  });
});

describe('fetch injection', () => {
  it('uses the injected fetch instead of the global', async () => {
    const spy = vi.fn(mockFetch([]).fetchImpl);
    const client = new RegulationReckoningClient({ baseUrl: 'https://api.test', fetch: spy });
    await client.getPolicies();
    expect(spy).toHaveBeenCalledOnce();
  });
});
