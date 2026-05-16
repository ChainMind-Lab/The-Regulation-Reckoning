import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import cors from 'cors';
import apiRouter from '../src/routes/api';

// Mock the Horizon service so tests never hit the network
vi.mock('../src/services/horizon', () => ({
  fetchNetworkStatus: vi.fn().mockResolvedValue({
    network: 'Public Global Stellar Network ; September 2015',
    horizon: 'https://horizon.stellar.org',
    protocolVersion: '21',
    latestLedger: '50000000',
    closedAt: '2026-05-16T14:00:00Z',
  }),
  fetchRecentPayments: vi.fn().mockResolvedValue([
    { id: 'p1', type: 'payment', createdAt: '2026-05-16T14:00:00Z', transactionHash: 'abc123' },
  ]),
}));

function buildApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use('/api', apiRouter);
  return app;
}

describe('GET /api/network', () => {
  it('returns 200 with network status fields', async () => {
    const res = await request(buildApp()).get('/api/network');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      network: expect.any(String),
      horizon: expect.any(String),
      protocolVersion: expect.any(String),
      latestLedger: expect.any(String),
    });
  });
});

describe('GET /api/wave', () => {
  it('returns Wave 5 metadata', async () => {
    const res = await request(buildApp()).get('/api/wave');
    expect(res.status).toBe(200);
    expect(res.body.number).toBe(5);
    expect(res.body.budget).toBeTruthy();
    expect(res.body.dripsUrl).toContain('drips.network');
  });
});

describe('GET /api/issues', () => {
  it('returns array of issues with required fields', async () => {
    const res = await request(buildApp()).get('/api/issues');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    res.body.forEach((issue: { id: string; title: string; points: number; tags: string[] }) => {
      expect(issue.id).toBeTruthy();
      expect(issue.title).toBeTruthy();
      expect(issue.points).toBeGreaterThan(0);
      expect(Array.isArray(issue.tags)).toBe(true);
    });
  });
});

describe('GET /api/payments', () => {
  it('returns array of payments', async () => {
    const res = await request(buildApp()).get('/api/payments');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('respects limit query param', async () => {
    const res = await request(buildApp()).get('/api/payments?limit=5');
    expect(res.status).toBe(200);
  });
});

describe('GET /api/network — error handling', () => {
  it('returns 502 when Horizon is unreachable', async () => {
    const { fetchNetworkStatus } = await import('../src/services/horizon');
    vi.mocked(fetchNetworkStatus).mockRejectedValueOnce(new Error('timeout'));
    const res = await request(buildApp()).get('/api/network');
    expect(res.status).toBe(502);
    expect(res.body.error).toBeTruthy();
  });
});
