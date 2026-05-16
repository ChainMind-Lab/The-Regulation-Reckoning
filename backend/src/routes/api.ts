import { Router } from 'express';
import { fetchNetworkStatus, fetchRecentPayments } from '../services/horizon';

const router = Router();

// GET /api/network — live Stellar Horizon network status
router.get('/network', async (_req, res) => {
  try {
    const status = await fetchNetworkStatus();
    res.json(status);
  } catch (err) {
    res.status(502).json({ error: 'Failed to reach Horizon', detail: String(err) });
  }
});

// GET /api/payments — recent Stellar payments
router.get('/payments', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 10, 50);
  try {
    const payments = await fetchRecentPayments(limit);
    res.json(payments);
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch payments', detail: String(err) });
  }
});

// GET /api/wave — Wave 5 metadata
router.get('/wave', (_req, res) => {
  res.json({
    number: 5,
    status: 'upcoming',
    budget: '$75,000',
    startDate: 'May 2026',
    totalRepos: 540,
    totalIssues: 74283,
    dripsUrl: 'https://www.drips.network/wave/stellar',
  });
});

// GET /api/issues — open bounty issues for this repo
router.get('/issues', (_req, res) => {
  res.json([
    { id: '1', title: 'Add Horizon API integration for live regulatory signal feed', points: 200, tags: ['engineering', 'good-first'] },
    { id: '2', title: 'Build policy jurisdiction mapping component', points: 300, tags: ['engineering'] },
    { id: '3', title: 'Write research chapter: Stellar protocol upgrades and regulatory impact', points: 150, tags: ['research', 'good-first'] },
    { id: '4', title: 'Implement on-chain transaction analytics dashboard', points: 400, tags: ['engineering'] },
    { id: '5', title: 'Add contributor leaderboard with Drips Wave points tracking', points: 250, tags: ['engineering', 'good-first'] },
    { id: '6', title: 'Document Stellar Soroban smart contract compliance patterns', points: 100, tags: ['research', 'good-first'] },
  ]);
});

export default router;
