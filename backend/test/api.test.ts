import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { getDb, resetDb } from '../src/db';
import {
  loadPolicyDataset,
  classifyPolicyRecords,
  persistPolicies,
} from '../src/services/ingest/policies';
import { loadSeedIssues, persistIssues } from '../src/services/ingest/issues';

// Mock the Stellar services so tests never touch the network.
vi.mock('../src/services/horizon', () => ({
  horizonServer: {},
  fetchNetworkStatus: vi.fn().mockResolvedValue({
    network: 'Test SDF Network ; September 2015',
    horizon: 'https://horizon-testnet.stellar.org',
    protocolVersion: '28',
    latestLedger: '4585568',
    closedAt: '2026-09-09T10:00:00Z',
    sequence: 'abc',
  }),
  fetchRecentPayments: vi.fn().mockResolvedValue([
    {
      id: 'p1',
      type: 'payment',
      createdAt: '2026-09-09T10:00:00Z',
      transactionHash: 'aa11',
      amount: '5.5',
      asset: 'native',
    },
  ]),
  pingHorizon: vi.fn().mockResolvedValue(4585568),
}));

vi.mock('../src/services/soroban', () => ({
  SorobanError: class extends Error {},
  buildContractTransaction: vi.fn().mockResolvedValue({ txXdr: 'AAAA(unsigned-simulated-xdr)' }),
  submitSignedTransaction: vi.fn().mockResolvedValue({ hash: 'deadbeef', status: 'SUCCESS' }),
  readBounty: vi.fn().mockResolvedValue({
    funder: 'GB2OVPTEO2BYRRRRWNRPZZOC3VW77IQDXJPBY2WYV2MXSU7C5HQDZ6E6',
    contributor: null,
    token: 'CB7NFW2WD3FXKBYANZX7J3FO6PBST2H3IE6SPHXHSWIQESII2P2A6Y6P',
    amount: '150',
    issue_id: 'gh-2',
    released: false,
  }),
  isContractInitialised: vi.fn().mockResolvedValue(true),
  requireContractConfigured: vi.fn(),
}));

// Import after mocks are registered.
import { createApp } from '../src/app';

function seedAppData(): void {
  const db = getDb();
  persistPolicies(classifyPolicyRecords(loadPolicyDataset()));
  persistIssues(loadSeedIssues(), 'seed');
  db.prepare(
    `INSERT INTO soroban_events (id, tx_hash, ledger, contract_id, topic, issue_id, payload, created_at, indexed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    'evt-1',
    'aa11bb',
    1000,
    'CB4OI57YRKLAIX2RGFS7DX3GIGEST4MSI447VAJPRCBCNFUHWLWLQLWT',
    'bounty_created',
    'gh-2',
    JSON.stringify({
      funder: 'GB2OVPTEO2BYRRRRWNRPZZOC3VW77IQDXJPBY2WYV2MXSU7C5HQDZ6E6',
      token: 'CB7NFW2WD3FXKBYANZX7J3FO6PBST2H3IE6SPHXHSWIQESII2P2A6Y6P',
      amount: '150',
    }),
    '2026-09-09T10:00:00Z',
    '2026-09-09T10:00:01Z',
  );
  db.prepare(
    `INSERT INTO bounties (issue_id, funder, contributor, token, amount, released, created_tx, released_tx, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    'gh-2',
    'GB2OVPTEO2BYRRRRWNRPZZOC3VW77IQDXJPBY2WYV2MXSU7C5HQDZ6E6',
    null,
    'CB7NFW2WD3FXKBYANZX7J3FO6PBST2H3IE6SPHXHSWIQESII2P2A6Y6P',
    '150',
    0,
    'aa11bb',
    null,
    '2026-09-09T10:00:01Z',
  );
}

beforeEach(() => {
  resetDb();
  seedAppData();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('GET /health', () => {
  it('returns ok', async () => {
    const res = await request(createApp()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

describe('GET /api/network', () => {
  it('returns live network status', async () => {
    const res = await request(createApp()).get('/api/network');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      network: expect.any(String),
      horizon: expect.any(String),
      protocolVersion: expect.any(String),
    });
  });
});

describe('GET /api/payments', () => {
  it('returns payments with default limit', async () => {
    const res = await request(createApp()).get('/api/payments');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });
});

describe('GET /api/issues', () => {
  it('returns ingested open issues with tags parsed', async () => {
    const res = await request(createApp()).get('/api/issues');
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(Array.isArray(res.body[0].tags)).toBe(true);
    expect(res.body[0].source).toBe('seed');
  });
});

describe('GET /api/policies', () => {
  it('returns the persisted regulatory dataset sorted by date desc', async () => {
    const res = await request(createApp()).get('/api/policies');
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(15);
    expect(res.body[0].eventDate >= res.body[1].eventDate).toBe(true);
  });
});

describe('GET /api/analytics', () => {
  it('returns deterministic analytics', async () => {
    const res = await request(createApp()).get('/api/analytics');
    expect(res.status).toBe(200);
    expect(res.body.totals.events).toBeGreaterThan(0);
    expect(res.body.riskIndex).toBeGreaterThan(0);
  });
});

describe('GET /api/contract', () => {
  it('reports configured contract metadata', async () => {
    const res = await request(createApp()).get('/api/contract');
    expect(res.status).toBe(200);
    expect(res.body.contractId).toBe('CB4OI57YRKLAIX2RGFS7DX3GIGEST4MSI447VAJPRCBCNFUHWLWLQLWT');
    expect(res.body.initialised).toBe(true);
  });
});

describe('GET /api/bounties', () => {
  it('returns derived bounty state', async () => {
    const res = await request(createApp()).get('/api/bounties');
    expect(res.status).toBe(200);
    const bounty = res.body.find((b: { issueId: string }) => b.issueId === 'gh-2');
    expect(bounty).toBeTruthy();
    expect(bounty.released).toBe(false);
    expect(bounty.createdUrl).toContain('stellar.expert');
  });
});

describe('GET /api/bounties/:issueId (on-chain verification)', () => {
  it('verifies an existing bounty from the ledger', async () => {
    const res = await request(createApp()).get('/api/bounties/gh-2');
    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(true);
    expect(res.body.source).toBe('stellar');
  });

  it('returns 404 when the bounty is missing on chain', async () => {
    const { readBounty } = await import('../src/services/soroban');
    vi.mocked(readBounty).mockResolvedValueOnce(null);
    const res = await request(createApp()).get('/api/bounties/nope');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('BOUNTY_NOT_FOUND');
  });
});

describe('GET /api/events', () => {
  it('returns indexed events with explorer links', async () => {
    const res = await request(createApp()).get('/api/events');
    expect(res.status).toBe(200);
    expect(res.body[0].topic).toBe('bounty_created');
    expect(res.body[0].explorerUrl).toContain('stellar.expert');
  });
});

describe('POST /api/tx/build', () => {
  it('builds an unsigned transaction for a create action', async () => {
    const res = await request(createApp()).post('/api/tx/build').send({
      action: 'create',
      source: 'GB2OVPTEO2BYRRRRWNRPZZOC3VW77IQDXJPBY2WYV2MXSU7C5HQDZ6E6',
      funder: 'GB2OVPTEO2BYRRRRWNRPZZOC3VW77IQDXJPBY2WYV2MXSU7C5HQDZ6E6',
      token: 'CB7NFW2WD3FXKBYANZX7J3FO6PBST2H3IE6SPHXHSWIQESII2P2A6Y6P',
      amount: '100',
      issueId: 'gh-9',
    });
    expect(res.status).toBe(200);
    expect(res.body.txXdr).toContain('unsigned');
    expect(res.body.networkPassphrase).toContain('Test');
  });

  it('rejects an invalid source address', async () => {
    const res = await request(createApp())
      .post('/api/tx/build')
      .send({ action: 'create', source: 'not-an-address' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('BAD_SOURCE');
  });

  it('rejects an unknown action', async () => {
    const res = await request(createApp())
      .post('/api/tx/build')
      .send({ action: 'hack', source: 'GB2OVPTEO2BYRRRRWNRPZZOC3VW77IQDXJPBY2WYV2MXSU7C5HQDZ6E6' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('BAD_ACTION');
  });
});

describe('POST /api/tx/submit', () => {
  it('submits a signed XDR and returns the hash + explorer link', async () => {
    const res = await request(createApp())
      .post('/api/tx/submit')
      .send({ signedXdr: 'AAAAA'.repeat(20) });
    expect(res.status).toBe(200);
    expect(res.body.hash).toBe('deadbeef');
    expect(res.body.explorerUrl).toContain('stellar.expert');
  });

  it('rejects a missing/too-short XDR', async () => {
    const res = await request(createApp()).post('/api/tx/submit').send({ signedXdr: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('BAD_XDR');
  });
});

describe('POST /api/ingest/run', () => {
  it('re-runs both pipelines idempotently', async () => {
    const res = await request(createApp()).post('/api/ingest/run');
    expect(res.status).toBe(200);
    expect(res.body.policies.records).toBeGreaterThan(0);
    expect(res.body.issues.records).toBeGreaterThan(0);
    // No duplicates after re-ingest.
    const db = getDb();
    const count = (db.prepare('SELECT COUNT(*) AS c FROM regulatory_events').get() as { c: number })
      .c;
    expect(count).toBe(res.body.policies.records);
  });
});

describe('error handling', () => {
  it('returns JSON 404 for unknown routes', async () => {
    const res = await request(createApp()).get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('returns 400 for malformed JSON bodies', async () => {
    const res = await request(createApp())
      .post('/api/tx/submit')
      .set('Content-Type', 'application/json')
      .send('{not json');
    expect(res.status).toBe(400);
  });
});
