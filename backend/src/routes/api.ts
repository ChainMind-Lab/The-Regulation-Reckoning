/**
 * Public API routes.
 *
 * All state is served from the SQLite read-model built by the ingestion
 * pipeline and the Soroban event indexer — Stellar is the source of truth for
 * bounty, milestone, review, proposal, dispute and reputation data. Endpoints
 * under `/api/bounties/:issueId/*`, `/api/proposals/:id`, `/api/disputes/:id`,
 * `/api/reputation/:address` and `/api/signers` additionally reconcile against
 * the ledger via a simulated read, so a client can always tell whether what it
 * sees is confirmed on-chain.
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
  readBountyV2,
  readContributorStats,
  readDispute,
  readProposal,
  readReputation,
  readSigners,
  submitSignedTransaction,
  SorobanError,
  type TxArg,
} from '../services/soroban';
import { ingestPolicies } from '../services/ingest/policies';
import { ingestIssues } from '../services/ingest/issues';
import { computeAnalytics } from '../services/analytics';
import {
  acknowledgeAlert,
  diffVersions,
  listAlerts,
  listAllVersions,
  listVersions,
} from '../services/regulations';
import {
  compareJurisdictions,
  jurisdictionProfile,
  listJurisdictions,
} from '../services/jurisdictions';
import {
  indexedReputation,
  leaderboard,
  normalizeOnChainReputation,
  reputationCount,
} from '../services/reputation';
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

function intQuery(raw: unknown, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

function requireAddress(value: unknown, field: string): string {
  const s = String(value ?? '');
  if (!/^[GC][A-Z2-7]{55}$/.test(s)) {
    throw new ApiError(`${field} must be a valid Stellar G.../C... address`, 400, 'BAD_ADDRESS');
  }
  return s;
}

function requireString(value: unknown, field: string, max = 256): string {
  const s = String(value ?? '');
  if (!s || s.length > max) {
    throw new ApiError(`${field} is required (max ${max} chars)`, 400, 'BAD_FIELD');
  }
  return s;
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
    const limit = intQuery(req.query.limit, 10, 1, 50);
    try {
      res.json(await fetchRecentPayments(limit));
    } catch (err) {
      throw new ApiError('Failed to fetch payments', 502, 'PAYMENTS_FETCH_FAILED', String(err));
    }
  }),
);

// ── Regulatory data (ingested + persisted) ───────────────────────

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
              ingestion_source AS source, impact, survival_signals AS survivalSignals,
              content_hash AS contentHash, version
       FROM regulatory_events ORDER BY event_date DESC`,
    )
    .all() as Array<Record<string, unknown>>;
  res.json(
    rows.map((r) => ({
      ...r,
      impact: JSON.parse(String(r.impact ?? '[]')),
      survivalSignals: JSON.parse(String(r.survivalSignals ?? '[]')),
    })),
  );
});

// GET /api/analytics — reproducible aggregates over the policy dataset
router.get('/analytics', (_req, res) => {
  res.json(computeAnalytics());
});

// ── Regulation version history & change detection ────────────────

// GET /api/regulations/versions — recent revisions across all policies
router.get('/regulations/versions', (req, res) => {
  res.json(listAllVersions(intQuery(req.query.limit, 100, 1, 500)));
});

// GET /api/regulations/:policyId/versions — full revision history
router.get('/regulations/:policyId/versions', (req, res) => {
  res.json(listVersions(String(req.params.policyId)));
});

// GET /api/regulations/:policyId/diff?from=1&to=2 — field-level diff
router.get('/regulations/:policyId/diff', (req, res) => {
  const from = intQuery(req.query.from, 0, 1, 1_000_000);
  const to = intQuery(req.query.to, 0, 1, 1_000_000);
  if (!from || !to) {
    throw new ApiError('from and to revision numbers are required', 400, 'BAD_FIELD');
  }
  const diff = diffVersions(String(req.params.policyId), from, to);
  if (!diff) {
    throw new ApiError('One or both revisions were not found', 404, 'VERSION_NOT_FOUND');
  }
  res.json({
    policyId: String(req.params.policyId),
    from: diff.from,
    to: diff.to,
    changes: diff.changes,
    sourceUrl: diff.to.sourceUrl,
  });
});

// GET /api/alerts — regulation change alerts
router.get('/alerts', (req, res) => {
  const acknowledged =
    req.query.acknowledged === undefined ? undefined : String(req.query.acknowledged) === 'true';
  res.json(
    listAlerts({
      policyId: req.query.policyId ? String(req.query.policyId) : undefined,
      severity: req.query.severity
        ? (String(req.query.severity) as 'info' | 'warning' | 'critical')
        : undefined,
      acknowledged,
      limit: intQuery(req.query.limit, 50, 1, 200),
    }),
  );
});

// POST /api/alerts/:id/acknowledge — mark an alert acknowledged
router.post('/alerts/:id/acknowledge', (req, res) => {
  if (!acknowledgeAlert(String(req.params.id))) {
    throw new ApiError('Alert not found', 404, 'ALERT_NOT_FOUND');
  }
  res.json({ id: String(req.params.id), acknowledged: true });
});

// ── Jurisdiction comparison ──────────────────────────────────────

// GET /api/jurisdictions — headline figures per jurisdiction
router.get('/jurisdictions', (_req, res) => {
  res.json(listJurisdictions());
});

// GET /api/jurisdictions/compare?ids=US,EU&category=stablecoin-regulation
// NOTE: must be declared before `/jurisdictions/:id` so "compare" is not
// captured as a jurisdiction id.
router.get('/jurisdictions/compare', (req, res) => {
  const ids = String(req.query.ids ?? '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  const category = req.query.category ? String(req.query.category) : undefined;
  res.json(compareJurisdictions(ids, category));
});

// GET /api/jurisdictions/:id — full profile with sources
router.get('/jurisdictions/:id', (req, res) => {
  const profile = jurisdictionProfile(String(req.params.id).toUpperCase());
  if (!profile) {
    throw new ApiError('Jurisdiction not found in the dataset', 404, 'JURISDICTION_NOT_FOUND');
  }
  res.json(profile);
});

// ── Contract state (from Stellar) ────────────────────────────────

// GET /api/contract — deployed contract metadata
router.get(
  '/contract',
  asyncHandler(async (_req, res) => {
    let initialised = false;
    let sorobanReachable = true;
    let signers: Awaited<ReturnType<typeof readSigners>> = null;
    if (isContractConfigured()) {
      try {
        initialised = await isContractInitialised();
        signers = await readSigners();
      } catch (err) {
        // A Soroban RPC outage must not hide the deployment metadata; report
        // that we could not confirm initialisation instead.
        sorobanReachable = false;
        logger.warn('contract metadata: soroban unreachable', { err: String(err) });
      }
    }
    res.json({
      configured: isContractConfigured(),
      contractId: config.bountyContractId || null,
      tokenId: config.demoTokenId || null,
      registryId: config.contributorRegistryId || null,
      admin: config.bountyAdminAddress || null,
      network: config.stellarNetworkPassphrase,
      rpcUrl: config.sorobanRpcUrl,
      horizonUrl: config.horizonUrl,
      initialised,
      sorobanReachable,
      signers: signers?.signers ?? [],
      signerThreshold: signers?.threshold ?? 0,
    });
  }),
);

// GET /api/signers — live multisig configuration
router.get(
  '/signers',
  asyncHandler(async (_req, res) => {
    if (!isContractConfigured()) {
      throw new ApiError('Contract is not configured', 503, 'CONTRACT_NOT_CONFIGURED');
    }
    const signers = await readSigners();
    res.json(signers ?? { signers: [], threshold: 0 });
  }),
);

// GET /api/bounties — derived bounty state (from indexed events)
router.get('/bounties', (_req, res) => {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT issue_id AS issueId, funder, contributor, token, amount, released,
              refunded, released_amount AS releasedAmount, milestones,
              created_tx AS createdTx, released_tx AS releasedTx, updated_at AS updatedAt
       FROM bounties ORDER BY updated_at DESC`,
    )
    .all();
  res.json(
    rows.map((r: Record<string, unknown>) => ({
      ...r,
      released: Boolean(r.released),
      refunded: Boolean(r.refunded),
      amount: String(r.amount),
      releasedAmount: String(r.releasedAmount ?? '0'),
      createdUrl: r.createdTx ? explorerTxUrl(String(r.createdTx)) : null,
      releasedUrl: r.releasedTx ? explorerTxUrl(String(r.releasedTx)) : null,
    })),
  );
});

// GET /api/bounties/:issueId/milestones — live milestone state + release history
router.get(
  '/bounties/:issueId/milestones',
  asyncHandler(async (req, res) => {
    const issueId = String(req.params.issueId);
    const db = getDb();
    const history = db
      .prepare(
        `SELECT idx, amount, released_tx AS releasedTx, updated_at AS updatedAt
         FROM milestones WHERE issue_id = ? ORDER BY idx`,
      )
      .all(issueId) as unknown as Array<Record<string, unknown>>;
    const reviews = db
      .prepare(
        `SELECT milestone, reviewer, decision, ledger, tx_hash AS txHash, created_at AS createdAt
         FROM reviews WHERE issue_id = ? ORDER BY milestone, created_at`,
      )
      .all(issueId) as unknown as Array<Record<string, unknown>>;
    const reviewers = db
      .prepare(`SELECT reviewer, quorum FROM bounty_reviewers WHERE issue_id = ?`)
      .all(issueId) as unknown as Array<Record<string, unknown>>;
    const disputes = db
      .prepare(`SELECT * FROM disputes WHERE issue_id = ? ORDER BY id`)
      .all(issueId) as unknown as Array<Record<string, unknown>>;

    let onChain: Awaited<ReturnType<typeof readBountyV2>> = null;
    let onChainVerified = false;
    if (isContractConfigured()) {
      onChain = await readBountyV2(issueId);
      onChainVerified = onChain !== null;
    }

    const historyByIndex = new Map(history.map((h) => [Number(h.idx), h]));
    res.json({
      issueId,
      onChainVerified,
      source: onChainConfirmed(onChainVerified),
      quorum: Number(reviewers[0]?.quorum ?? onChain?.reviewer_quorum ?? 0),
      reviewers: (onChain?.reviewers.length
        ? onChain.reviewers
        : reviewers.map((r) => String(r.reviewer))
      ).map((reviewer) => ({
        reviewer,
        reviews: reviews
          .filter((r) => String(r.reviewer) === reviewer)
          .map((r) => ({
            milestone: Number(r.milestone),
            decision: String(r.decision),
            ledger: r.ledger === null ? null : Number(r.ledger),
            txHash: r.txHash ? String(r.txHash) : null,
            explorerUrl: r.txHash ? explorerTxUrl(String(r.txHash)) : null,
            createdAt: String(r.createdAt),
          })),
      })),
      milestones: (onChain?.milestones ?? []).map((m, idx) => ({
        index: idx,
        title: m.title,
        amount: m.amount,
        settled: m.settled,
        releasedTx: (historyByIndex.get(idx)?.releasedTx as string | undefined) ?? null,
        releasedUrl: historyByIndex.get(idx)?.releasedTx
          ? explorerTxUrl(String(historyByIndex.get(idx)?.releasedTx))
          : null,
      })),
      releasedAmount: onChain?.released_amount ?? null,
      disputed: disputes.filter((d) => !d.resolved).length > 0,
      disputes: disputes.map((d) => ({
        id: Number(d.id),
        milestone: Number(d.milestone),
        opener: String(d.opener),
        votesPayContributor: Number(d.votes_pay_contributor),
        votesRefundFunder: Number(d.votes_refund_funder),
        resolved: Boolean(d.resolved),
        payContributor: Boolean(d.pay_contributor),
        openedTx: d.opened_tx ? String(d.opened_tx) : null,
        resolvedTx: d.resolved_tx ? String(d.resolved_tx) : null,
        createdAt: String(d.created_at),
      })),
    });
  }),
);

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

// ── Reviews ──────────────────────────────────────────────────────

// GET /api/reviews?issueId=&milestone=&reviewer=&limit=
router.get('/reviews', (req, res) => {
  const db = getDb();
  const clauses: string[] = [];
  const params: string[] = [];
  if (req.query.issueId) {
    clauses.push('issue_id = ?');
    params.push(String(req.query.issueId));
  }
  if (req.query.milestone !== undefined) {
    clauses.push('milestone = ?');
    params.push(String(intQuery(req.query.milestone, 0, 0, 1_000_000)));
  }
  if (req.query.reviewer) {
    clauses.push('reviewer = ?');
    params.push(String(req.query.reviewer));
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = intQuery(req.query.limit, 100, 1, 500);
  const rows = db
    .prepare(
      `SELECT id, issue_id AS issueId, milestone, reviewer, decision, ledger,
              tx_hash AS txHash, created_at AS createdAt
       FROM reviews ${where} ORDER BY created_at DESC LIMIT ?`,
    )
    .all(...(params as never[]), limit) as unknown as Array<Record<string, unknown>>;
  res.json(
    rows.map((r) => ({
      ...r,
      explorerUrl: r.txHash ? explorerTxUrl(String(r.txHash)) : null,
    })),
  );
});

// ── Proposals (multisig) ─────────────────────────────────────────

// GET /api/proposals — indexed proposals, newest first
router.get('/proposals', (req, res) => {
  const db = getDb();
  const limit = intQuery(req.query.limit, 50, 1, 200);
  const rows = db
    .prepare(
      `SELECT id, proposer, action, action_json AS actionJson, approvals, executed,
              cancelled, created_tx AS createdTx, updated_at AS updatedAt
       FROM proposals ORDER BY id DESC LIMIT ?`,
    )
    .all(limit) as unknown as Array<Record<string, unknown>>;
  res.json(
    rows.map((r) => ({
      id: Number(r.id),
      proposer: String(r.proposer),
      action: String(r.action),
      actionDetail: JSON.parse(String(r.actionJson ?? '{}')),
      approvals: JSON.parse(String(r.approvals ?? '[]')),
      executed: Boolean(r.executed),
      cancelled: Boolean(r.cancelled),
      createdTx: r.createdTx ? String(r.createdTx) : null,
      explorerUrl: r.createdTx ? explorerTxUrl(String(r.createdTx)) : null,
      updatedAt: String(r.updatedAt),
    })),
  );
});

// GET /api/proposals/:id — live proposal state (falls back to the index)
router.get(
  '/proposals/:id',
  asyncHandler(async (req, res) => {
    const id = intQuery(String(req.params.id), 0, 0, Number.MAX_SAFE_INTEGER);
    if (!id) throw new ApiError('A numeric proposal id is required', 400, 'BAD_FIELD');
    if (isContractConfigured()) {
      const live = await readProposal(id);
      if (live) {
        res.json({ ...live, verified: true, source: 'stellar' });
        return;
      }
    }
    const db = getDb();
    const row = db.prepare(`SELECT * FROM proposals WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    if (!row) throw new ApiError('Proposal not found', 404, 'PROPOSAL_NOT_FOUND');
    res.json({ ...row, verified: false, source: 'index' });
  }),
);

// ── Disputes ─────────────────────────────────────────────────────

// GET /api/disputes?issueId=&open=
router.get('/disputes', (req, res) => {
  const db = getDb();
  const clauses: string[] = [];
  const params: string[] = [];
  if (req.query.issueId) {
    clauses.push('issue_id = ?');
    params.push(String(req.query.issueId));
  }
  if (req.query.open !== undefined) {
    clauses.push('resolved = ?');
    params.push(String(req.query.open) === 'true' ? '0' : '1');
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = intQuery(req.query.limit, 100, 1, 500);
  const rows = db
    .prepare(
      `SELECT id, issue_id AS issueId, milestone, opener, votes_pay_contributor AS votesPayContributor,
              votes_refund_funder AS votesRefundFunder, resolved, pay_contributor AS payContributor,
              opened_tx AS openedTx, resolved_tx AS resolvedTx, created_at AS createdAt, updated_at AS updatedAt
       FROM disputes ${where} ORDER BY id DESC LIMIT ?`,
    )
    .all(...(params as never[]), limit) as unknown as Array<Record<string, unknown>>;
  res.json(
    rows.map((r) => ({
      ...r,
      resolved: Boolean(r.resolved),
      payContributor: Boolean(r.payContributor),
      openedUrl: r.openedTx ? explorerTxUrl(String(r.openedTx)) : null,
      resolvedUrl: r.resolvedTx ? explorerTxUrl(String(r.resolvedTx)) : null,
    })),
  );
});

// GET /api/disputes/:id — live dispute state
router.get(
  '/disputes/:id',
  asyncHandler(async (req, res) => {
    const id = intQuery(String(req.params.id), 0, 0, Number.MAX_SAFE_INTEGER);
    if (!id) throw new ApiError('A numeric dispute id is required', 400, 'BAD_FIELD');
    if (isContractConfigured()) {
      const live = await readDispute(id);
      if (live) {
        res.json({ ...live, verified: true, source: 'stellar' });
        return;
      }
    }
    const db = getDb();
    const row = db.prepare(`SELECT * FROM disputes WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    if (!row) throw new ApiError('Dispute not found', 404, 'DISPUTE_NOT_FOUND');
    res.json({ ...row, verified: false, source: 'index' });
  }),
);

// ── Reputation ───────────────────────────────────────────────────

// GET /api/reputation/leaderboard — indexed reputation ranking
router.get('/reputation/leaderboard', (req, res) => {
  res.json({
    generatedAt: new Date().toISOString(),
    total: reputationCount(),
    entries: leaderboard(intQuery(req.query.limit, 25, 1, 200)),
  });
});

// GET /api/reputation/:address — verifiable reputation (on-chain + indexed)
router.get(
  '/reputation/:address',
  asyncHandler(async (req, res) => {
    const address = requireAddress(req.params.address, 'address');
    const indexed = indexedReputation(address);

    let onChain: Awaited<ReturnType<typeof readReputation>> = null;
    let stellarReachable = true;
    if (isContractConfigured() && config.contributorRegistryId) {
      try {
        onChain = await readReputation(address);
      } catch (err) {
        stellarReachable = false;
        logger.warn('reputation: registry read failed', { address, err: String(err) });
      }
    }

    if (!indexed && !onChain) {
      throw new ApiError('No reputation recorded for this address', 404, 'REPUTATION_NOT_FOUND');
    }

    // Normalise the ledger struct into the indexed shape so every client sees
    // exactly one JSON shape (camelCase + tier) whichever source answered.
    const onChainView = onChain ? normalizeOnChainReputation(address, onChain) : null;

    res.json({
      address,
      stellarReachable,
      onChain: onChainView,
      indexed,
      // Prefer the ledger, fall back to the index.
      reputation: onChainView ?? indexed,
    });
  }),
);

// ── Contributors ─────────────────────────────────────────────────

// GET /api/contributors/:address — live on-chain registry stats
router.get(
  '/contributors/:address',
  asyncHandler(async (req, res) => {
    const address = requireAddress(req.params.address, 'address');
    const stats = await readContributorStats(address);
    if (!stats) {
      throw new ApiError(
        'Registry not configured or contributor not found',
        config.contributorRegistryId ? 404 : 503,
        config.contributorRegistryId ? 'CONTRIBUTOR_NOT_FOUND' : 'REGISTRY_NOT_CONFIGURED',
      );
    }
    res.json({ contributor: address, ...stats, verified: true, source: 'stellar' });
  }),
);

// ── Events ───────────────────────────────────────────────────────

// GET /api/events — indexed Soroban contract events
router.get('/events', (req, res) => {
  const limit = intQuery(req.query.limit, 50, 1, 200);
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

const MILESTONE_STRUCT_SETTLED = { type: 'bool', value: false } satisfies TxArg;

function reviewDecisionArg(decision: unknown): TxArg {
  const value = String(decision ?? '').toLowerCase();
  if (value !== 'approve' && value !== 'reject') {
    throw new ApiError("decision must be 'approve' or 'reject'", 400, 'BAD_FIELD');
  }
  // `ReviewDecision` has an explicit integer discriminant on every variant, so
  // the SDK encodes it as a u32 (0 = Approve, 1 = Reject) — not a Symbol vec.
  return { type: 'u32', value: value === 'approve' ? 0 : 1 };
}

/**
 * Map a public relay action onto a typed contract invocation.
 *
 * Only user-facing actions are whitelisted; the one-time `init` bootstrap is
 * deliberately not buildable through the public relay.
 */
function actionToInvocation(action: string, body: Record<string, unknown>): { fn: string; args: TxArg[] } {
  switch (action) {
    case 'create':
      return {
        fn: 'create',
        args: [
          { type: 'address', value: requireAddress(body.funder, 'funder') },
          { type: 'address', value: requireAddress(body.token, 'token') },
          { type: 'i128', value: String(body.amount ?? '') },
          { type: 'string', value: requireString(body.issueId, 'issueId') },
        ],
      };
    case 'createBounty': {
      const milestones = Array.isArray(body.milestones) ? body.milestones : [];
      if (milestones.length === 0 || milestones.length > 20) {
        throw new ApiError('milestones must contain 1..20 entries', 400, 'BAD_FIELD');
      }
      return {
        fn: 'create_bounty',
        args: [
          { type: 'address', value: requireAddress(body.funder, 'funder') },
          { type: 'address', value: requireAddress(body.token, 'token') },
          { type: 'string', value: requireString(body.issueId, 'issueId') },
          {
            type: 'vec',
            value: milestones.map((m) => {
              const entry = (m ?? {}) as Record<string, unknown>;
              return {
                type: 'struct' as const,
                value: {
                  title: { type: 'string' as const, value: requireString(entry.title, 'title') },
                  amount: { type: 'i128' as const, value: String(entry.amount ?? '') },
                  settled: MILESTONE_STRUCT_SETTLED,
                },
              };
            }),
          },
        ],
      };
    }
    case 'reclaim':
      return {
        fn: 'reclaim',
        args: [{ type: 'string', value: requireString(body.issueId, 'issueId') }],
      };
    case 'claim':
      return {
        fn: 'claim',
        args: [
          { type: 'string', value: requireString(body.issueId, 'issueId') },
          { type: 'address', value: requireAddress(body.contributor, 'contributor') },
        ],
      };
    case 'proposeRelease':
      return {
        fn: 'propose',
        args: [
          { type: 'address', value: requireAddress(body.proposer, 'proposer') },
          {
            type: 'enum',
            variant: 'Release',
            value: [
              { type: 'string', value: requireString(body.issueId, 'issueId') },
              { type: 'u32', value: intQuery(body.milestone, 0, 0, 1_000_000) },
            ],
          },
        ],
      };
    case 'proposeReclaim':
      return {
        fn: 'propose',
        args: [
          { type: 'address', value: requireAddress(body.proposer, 'proposer') },
          {
            type: 'enum',
            variant: 'Reclaim',
            value: [{ type: 'string', value: requireString(body.issueId, 'issueId') }],
          },
        ],
      };
    case 'proposeSetSigners': {
      const signers = Array.isArray(body.signers) ? body.signers.map(String) : [];
      if (signers.length === 0 || signers.length > 20) {
        throw new ApiError('signers must contain 1..20 addresses', 400, 'BAD_FIELD');
      }
      return {
        fn: 'propose',
        args: [
          { type: 'address', value: requireAddress(body.proposer, 'proposer') },
          {
            type: 'enum',
            variant: 'SetSigners',
            value: [
              { type: 'vec', value: signers.map((s) => ({ type: 'address' as const, value: requireAddress(s, 'signer') })) },
              { type: 'u32', value: intQuery(body.threshold, 0, 0, 1_000) },
            ],
          },
        ],
      };
    }
    case 'proposeSetReviewers': {
      const reviewers = Array.isArray(body.reviewers) ? body.reviewers.map(String) : [];
      if (reviewers.length > 20) {
        throw new ApiError('reviewers must contain at most 20 addresses', 400, 'BAD_FIELD');
      }
      return {
        fn: 'propose',
        args: [
          { type: 'address', value: requireAddress(body.proposer, 'proposer') },
          {
            type: 'enum',
            variant: 'SetReviewers',
            value: [
              { type: 'string', value: requireString(body.issueId, 'issueId') },
              {
                type: 'vec',
                value: reviewers.map((r) => ({
                  type: 'address' as const,
                  value: requireAddress(r, 'reviewer'),
                })),
              },
              { type: 'u32', value: intQuery(body.quorum, 0, 0, 1_000) },
            ],
          },
        ],
      };
    }
    case 'proposeResolveDispute':
      return {
        fn: 'propose',
        args: [
          { type: 'address', value: requireAddress(body.proposer, 'proposer') },
          {
            type: 'enum',
            variant: 'ResolveDispute',
            value: [
              { type: 'u64', value: intQuery(body.disputeId, 0, 0, Number.MAX_SAFE_INTEGER) },
              { type: 'bool', value: Boolean(body.payContributor) },
            ],
          },
        ],
      };
    case 'approve':
      return {
        fn: 'approve',
        args: [
          { type: 'address', value: requireAddress(body.signer, 'signer') },
          { type: 'u64', value: intQuery(body.proposalId, 0, 0, Number.MAX_SAFE_INTEGER) },
        ],
      };
    case 'revoke':
      return {
        fn: 'revoke',
        args: [
          { type: 'address', value: requireAddress(body.signer, 'signer') },
          { type: 'u64', value: intQuery(body.proposalId, 0, 0, Number.MAX_SAFE_INTEGER) },
        ],
      };
    case 'cancel':
      return {
        fn: 'cancel',
        args: [
          { type: 'address', value: requireAddress(body.proposer, 'proposer') },
          { type: 'u64', value: intQuery(body.proposalId, 0, 0, Number.MAX_SAFE_INTEGER) },
        ],
      };
    case 'submitReview':
      return {
        fn: 'submit_review',
        args: [
          { type: 'address', value: requireAddress(body.reviewer, 'reviewer') },
          { type: 'string', value: requireString(body.issueId, 'issueId') },
          { type: 'u32', value: intQuery(body.milestone, 0, 0, 1_000_000) },
          reviewDecisionArg(body.decision),
          { type: 'string', value: String(body.commentHash ?? '').slice(0, 256) },
        ],
      };
    case 'openDispute':
      return {
        fn: 'open_dispute',
        args: [
          { type: 'address', value: requireAddress(body.opener, 'opener') },
          { type: 'string', value: requireString(body.issueId, 'issueId') },
          { type: 'u32', value: intQuery(body.milestone, 0, 0, 1_000_000) },
          { type: 'string', value: String(body.reasonHash ?? '').slice(0, 256) },
        ],
      };
    case 'voteDispute':
      return {
        fn: 'vote_on_dispute',
        args: [
          { type: 'address', value: requireAddress(body.reviewer, 'reviewer') },
          { type: 'u64', value: intQuery(body.disputeId, 0, 0, Number.MAX_SAFE_INTEGER) },
          { type: 'bool', value: Boolean(body.payContributor) },
        ],
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

function onChainConfirmed(verified: boolean): 'stellar' | 'index' {
  return verified ? 'stellar' : 'index';
}

export default router;
