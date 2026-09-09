/**
 * Public API routes. All state is served from the SQLite read-model which is
 * built by the ingestion pipeline and the Soroban event indexer — Stellar is
 * the source of truth for bounty and event data.
 *
 * Endpoint docs: docs/API.md
 */

import { Router, type NextFunction, type Request, type Response } from 'express';
import { getDb } from '../db';
import { config, explorerTxUrl, isContractConfigured } from '../config';
import { fetchNetworkStatus, fetchRecentPayments } from '../services/horizon';
import {
  buildContractTransaction,
  isContractInitialised,
  readBounty,
  submitSignedTransaction,
  SorobanError,
  type TxArg,
} from '../services/soroban';
import { ingestPolicies } from '../services/ingest/policies';
import { ingestIssues } from '../services/ingest/issues';
import { computeAnalytics } from '../services/analytics';
import { indexOnce } from '../services/indexer';
import { ApiError } from '../middleware/error';
import { logger } from '../logger';

const router = Router();

/** Wrap async handlers so rejections reach the central error handler. */
function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}

// ── Network ───────────────────────────────────────────────────────

// GET /api/network — live Stellar Horizon network status
router.get(
  '/network',
  asyncHandler(async (_req, res) => {
    try {
      res.json(await fetchNetworkStatus());
    } catch (err) {
      throw new ApiError('Failed to reach Horizon', 502, 'HORIZON_UNREACHABLE', String(err));
    }
  }),
);

// GET /api/payments — recent Stellar payments from Horizon
router.get(
  '/payments',
  asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 50);
    try {
      res.json(await fetchRecentPayments(limit));
    } catch (err) {
      throw new ApiError('Failed to fetch payments', 502, 'PAYMENTS_FETCH_FAILED', String(err));
    }
  }),
);

// ── Application data (ingested + persisted) ──────────────────────

// GET /api/issues — ingested bounty issues
router.get('/issues', (_req, res) => {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, repo, title, points, tags, state, source, ingested_at AS ingestedAt
       FROM issues WHERE state = 'open' ORDER BY points DESC`,
    )
    .all();
  res.json(
    rows.map((r: Record<string, unknown>) => ({
      ...r,
      tags: JSON.parse(String(r.tags ?? '[]')),
    })),
  );
});

// GET /api/policies — validated regulatory dataset
router.get('/policies', (_req, res) => {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, title, jurisdiction, category, event_date AS eventDate, severity,
              summary, source_name AS sourceName, source_url AS sourceUrl,
              ingestion_source AS source
       FROM regulatory_events ORDER BY event_date DESC`,
    )
    .all();
  res.json(rows);
});

// GET /api/analytics — reproducible aggregates over the policy dataset
router.get('/analytics', (_req, res) => {
  res.json(computeAnalytics());
});

// ── Contract state (from Stellar) ─────────────────────────────────

// GET /api/contract — deployed contract metadata
router.get(
  '/contract',
  asyncHandler(async (_req, res) => {
    res.json({
      configured: isContractConfigured(),
      contractId: config.bountyContractId || null,
      tokenId: config.demoTokenId || null,
      admin: config.bountyAdminAddress || null,
      network: config.stellarNetworkPassphrase,
      rpcUrl: config.sorobanRpcUrl,
      horizonUrl: config.horizonUrl,
      initialised: isContractConfigured() ? await isContractInitialised() : false,
    });
  }),
);

// GET /api/bounties — derived bounty state (from indexed events)
router.get('/bounties', (_req, res) => {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT issue_id AS issueId, funder, contributor, token, amount, released,
              created_tx AS createdTx, released_tx AS releasedTx, updated_at AS updatedAt
       FROM bounties ORDER BY updated_at DESC`,
    )
    .all();
  res.json(
    rows.map((r: Record<string, unknown>) => ({
      ...r,
      released: Boolean(r.released),
      amount: String(r.amount),
      createdUrl: r.createdTx ? explorerTxUrl(String(r.createdTx)) : null,
      releasedUrl: r.releasedTx ? explorerTxUrl(String(r.releasedTx)) : null,
    })),
  );
});

// GET /api/bounties/:issueId — live on-chain verification
router.get(
  '/bounties/:issueId',
  asyncHandler(async (req, res) => {
    try {
      const onChain = await readBounty(req.params.issueId);
      if (!onChain) {
        throw new ApiError('Bounty not found on chain', 404, 'BOUNTY_NOT_FOUND');
      }
      res.json({ ...onChain, verified: true, source: 'stellar' });
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new ApiError('Failed to verify bounty on chain', 502, 'VERIFY_FAILED', String(err));
    }
  }),
);

// GET /api/events — indexed Soroban contract events
router.get('/events', (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, tx_hash AS txHash, ledger, contract_id AS contractId, topic,
              issue_id AS issueId, payload, created_at AS createdAt
       FROM soroban_events ORDER BY ledger DESC, id DESC LIMIT ?`,
    )
    .all(limit);
  res.json(
    rows.map((r: Record<string, unknown>) => ({
      ...r,
      payload: JSON.parse(String(r.payload ?? '{}')),
      explorerUrl: explorerTxUrl(String(r.txHash)),
    })),
  );
});

// ── Transaction relay (wallet signs, backend submits) ────────────

interface TxAction {
  fn: string;
  args: TxArg[];
}

function actionToInvocation(action: string, body: Record<string, unknown>): TxAction {
  switch (action) {
    case 'create':
      return {
        fn: 'create',
        args: [
          { type: 'address', value: String(body.funder) },
          { type: 'address', value: String(body.token) },
          { type: 'i128', value: String(body.amount) },
          { type: 'string', value: String(body.issueId) },
        ],
      };
    case 'release':
      return {
        fn: 'release',
        args: [
          { type: 'string', value: String(body.issueId) },
          { type: 'address', value: String(body.contributor) },
        ],
      };
    case 'reclaim':
      return {
        fn: 'reclaim',
        args: [{ type: 'string', value: String(body.issueId) }],
      };
    case 'init':
      return {
        fn: 'init',
        args: [{ type: 'address', value: String(body.admin) }],
      };
    default:
      throw new ApiError(`Unknown action: ${action}`, 400, 'BAD_ACTION');
  }
}

// POST /api/tx/build — build + simulate an unsigned transaction for the wallet
router.post(
  '/tx/build',
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const action = String(body.action ?? '');
    const source = String(body.source ?? '');
    if (!source || !/^G[A-Z2-7]{55}$/.test(source)) {
      throw new ApiError('A valid G... source address is required', 400, 'BAD_SOURCE');
    }
    const { fn, args } = actionToInvocation(action, body);
    try {
      const { txXdr } = await buildContractTransaction(fn, args, source);
      res.json({ txXdr, action, networkPassphrase: config.stellarNetworkPassphrase });
    } catch (err) {
      logger.warn('tx.build failed', { action, source, err: String(err) });
      if (err instanceof SorobanError) throw err;
      throw new ApiError(`Failed to build transaction: ${String(err)}`, 502, 'BUILD_FAILED');
    }
  }),
);

// POST /api/tx/submit — submit a wallet-signed transaction XDR
router.post(
  '/tx/submit',
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const signedXdr = String(body.signedXdr ?? '');
    if (!signedXdr || signedXdr.length < 64) {
      throw new ApiError('A signed transaction XDR is required', 400, 'BAD_XDR');
    }
    try {
      const result = await submitSignedTransaction(signedXdr);
      res.json({ ...result, explorerUrl: explorerTxUrl(result.hash) });
      // Kick an immediate indexer pass so the dashboard reflects the change.
      if (isContractConfigured()) {
        indexOnce().catch(() => undefined);
      }
    } catch (err) {
      if (err instanceof SorobanError) throw err;
      throw new ApiError(`Failed to submit transaction: ${String(err)}`, 502, 'SUBMIT_FAILED');
    }
  }),
);

// ── Ops ───────────────────────────────────────────────────────────

// POST /api/ingest/run — manually trigger the ingestion pipelines
router.post(
  '/ingest/run',
  asyncHandler(async (req, res) => {
    if (config.adminToken && req.headers.authorization !== `Bearer ${config.adminToken}`) {
      throw new ApiError('Unauthorized', 401, 'UNAUTHORIZED');
    }
    const policies = await ingestPolicies().catch((err: Error) => {
      logger.error('ingest.policies failed', { err: String(err) });
      throw new ApiError(`Policy ingestion failed: ${err.message}`, 500, 'INGEST_POLICIES_FAILED');
    });
    const issues = await ingestIssues().catch((err: Error) => {
      logger.error('ingest.issues failed', { err: String(err) });
      throw new ApiError(`Issue ingestion failed: ${err.message}`, 500, 'INGEST_ISSUES_FAILED');
    });
    res.json({ policies, issues });
  }),
);

export default router;
