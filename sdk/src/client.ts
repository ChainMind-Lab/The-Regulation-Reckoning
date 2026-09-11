/**
 * `@regulation-reckoning/sdk` — a typed client for the Regulation Reckoning
 * regulatory-research and bounty API.
 *
 * Zero runtime dependencies (uses the global `fetch`, injectable for tests and
 * for Node < 18).
 *
 * ```ts
 * import { RegulationReckoningClient } from '@regulation-reckoning/sdk';
 *
 * const rr = new RegulationReckoningClient('https://api.example.com');
 * const alerts = await rr.getAlerts({ severity: 'critical' });
 * const comparison = await rr.compareJurisdictions(['EU', 'US'], 'stablecoin-regulation');
 * ```
 */

import type {
  AnalyticsSnapshot,
  Bounty,
  BountyOnChain,
  ComparisonResult,
  ContractEvent,
  ContractInfo,
  ContributorStats,
  Dispute,
  JurisdictionProfile,
  JurisdictionSummary,
  MilestoneInput,
  MilestoneView,
  NetworkStatus,
  PolicyRecord,
  Proposal,
  RegulationAlert,
  RegulationDiff,
  RegulationVersion,
  ReputationLeaderboard,
  ReputationView,
  Review,
  ReviewDecision,
  SignerSet,
  TxBuildResponse,
  TxSubmitResponse,
} from './types';

export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

export interface ClientOptions {
  /** API origin, e.g. `https://api.example.com`. Trailing slash is ignored. */
  baseUrl: string;
  /** Custom fetch implementation (defaults to the global). */
  fetch?: FetchLike;
  /** Extra headers sent with every request. */
  headers?: Record<string, string>;
  /** Per-request timeout in ms (default 20_000). */
  timeoutMs?: number;
}

/** An error returned by the API, carrying the machine-readable `code`. */
export class RegulationReckoningError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = 'RegulationReckoningError';
  }
}

interface AlertQuery {
  policyId?: string;
  severity?: 'info' | 'warning' | 'critical';
  acknowledged?: boolean;
  limit?: number;
}

interface ReviewQuery {
  issueId?: string;
  milestone?: number;
  reviewer?: string;
  limit?: number;
}

interface DisputeQuery {
  issueId?: string;
  open?: boolean;
  limit?: number;
}

interface EventQuery {
  limit?: number;
}

function assertAddress(address: string, field = 'address'): string {
  if (!/^[GC][A-Z2-7]{55}$/.test(address)) {
    throw new RegulationReckoningError(
      `${field} must be a valid Stellar G.../C... address`,
      400,
      'BAD_ADDRESS',
    );
  }
  return address;
}

function qs(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    search.set(key, String(value));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}

export class RegulationReckoningClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly headers: Record<string, string>;
  private readonly timeoutMs: number;

  constructor(options: ClientOptions | string) {
    const resolved: ClientOptions = typeof options === 'string' ? { baseUrl: options } : options;
    if (!resolved.baseUrl) {
      throw new RegulationReckoningError('baseUrl is required', 400, 'BAD_OPTIONS');
    }
    this.baseUrl = resolved.baseUrl.replace(/\/+$/, '');
    const globalFetch = (globalThis as { fetch?: unknown }).fetch;
    const impl = resolved.fetch ?? (globalFetch as FetchLike | undefined);
    if (!impl) {
      throw new RegulationReckoningError(
        'No fetch implementation available — pass one via options.fetch',
        400,
        'NO_FETCH',
      );
    }
    this.fetchImpl = impl;
    this.headers = { Accept: 'application/json', ...(resolved.headers ?? {}) };
    this.timeoutMs = resolved.timeoutMs ?? 20_000;
  }

  // ── Transport ───────────────────────────────────────────────────

  private async request<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
    const controller = typeof AbortController === 'undefined' ? undefined : new AbortController();
    const timer =
      controller && this.timeoutMs > 0
        ? setTimeout(() => controller.abort(), this.timeoutMs)
        : undefined;
    try {
      const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: init?.method ?? 'GET',
        headers:
          init?.body === undefined
            ? this.headers
            : { ...this.headers, 'Content-Type': 'application/json' },
        body: init?.body === undefined ? undefined : JSON.stringify(init.body),
        signal: controller?.signal,
      });

      if (!res.ok) {
        let message = `API error ${res.status} on ${path}`;
        let code: string | undefined;
        let detail: unknown;
        try {
          const body = (await res.json()) as { error?: string; code?: string; detail?: unknown };
          message = body.error ?? message;
          code = body.code;
          detail = body.detail;
        } catch {
          /* non-JSON error body */
        }
        throw new RegulationReckoningError(message, res.status, code, detail);
      }
      if (res.status === 204) return undefined as T;
      return (await res.json()) as T;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  // ── Regulatory data ─────────────────────────────────────────────

  /** The full curated, source-cited policy dataset. */
  getPolicies(): Promise<PolicyRecord[]> {
    return this.request<PolicyRecord[]>('/api/policies');
  }

  /** One policy record by id (client-side lookup over the dataset). */
  async getPolicy(id: string): Promise<PolicyRecord | null> {
    const all = await this.getPolicies();
    return all.find((p) => p.id === id) ?? null;
  }

  /** Deterministic aggregates over the dataset. */
  getAnalytics(): Promise<AnalyticsSnapshot> {
    return this.request<AnalyticsSnapshot>('/api/analytics');
  }

  /** Headline figures for every jurisdiction in the dataset. */
  getJurisdictions(): Promise<JurisdictionSummary[]> {
    return this.request<JurisdictionSummary[]>('/api/jurisdictions');
  }

  /** Full profile for one jurisdiction, with its primary sources. */
  getJurisdiction(id: string): Promise<JurisdictionProfile> {
    return this.request<JurisdictionProfile>(`/api/jurisdictions/${encodeURIComponent(id)}`);
  }

  /**
   * Compare jurisdictions side by side. Every returned cell carries the sources
   * behind it, so results are traceable rather than asserted.
   */
  compareJurisdictions(ids: string[], category?: string): Promise<ComparisonResult> {
    return this.request<ComparisonResult>(
      `/api/jurisdictions/compare${qs({ ids: ids.join(','), category })}`,
    );
  }

  // ── Regulation history & alerts ─────────────────────────────────

  /** Recent revisions across all policies. */
  getRegulationVersions(limit = 100): Promise<RegulationVersion[]> {
    return this.request<RegulationVersion[]>(`/api/regulations/versions${qs({ limit })}`);
  }

  /** Full revision history for one policy, newest first. */
  getPolicyVersions(policyId: string): Promise<RegulationVersion[]> {
    return this.request<RegulationVersion[]>(
      `/api/regulations/${encodeURIComponent(policyId)}/versions`,
    );
  }

  /** Field-level diff between two revisions of a policy. */
  getRegulationDiff(policyId: string, from: number, to: number): Promise<RegulationDiff> {
    return this.request<RegulationDiff>(
      `/api/regulations/${encodeURIComponent(policyId)}/diff${qs({ from, to })}`,
    );
  }

  /** Alerts raised by regulation change detection. */
  getAlerts(query: AlertQuery = {}): Promise<RegulationAlert[]> {
    return this.request<RegulationAlert[]>(`/api/alerts${qs({ ...query })}`);
  }

  /** Mark an alert acknowledged. */
  acknowledgeAlert(id: string): Promise<{ id: string; acknowledged: boolean }> {
    return this.request(`/api/alerts/${encodeURIComponent(id)}/acknowledge`, {
      method: 'POST',
    });
  }

  // ── Bounties, milestones, reviews, proposals, disputes ──────────

  /** Indexed bounty state (derived purely from contract events). */
  getBounties(): Promise<Bounty[]> {
    return this.request<Bounty[]>('/api/bounties');
  }

  /** Live on-chain verification of a single bounty. */
  getBounty(issueId: string): Promise<BountyOnChain> {
    return this.request<BountyOnChain>(`/api/bounties/${encodeURIComponent(issueId)}`);
  }

  /** Live milestone state merged with indexed release history. */
  getMilestones(issueId: string): Promise<MilestoneView> {
    return this.request<MilestoneView>(`/api/bounties/${encodeURIComponent(issueId)}/milestones`);
  }

  /** Reviewer submissions, filterable by bounty/milestone/reviewer. */
  getReviews(query: ReviewQuery = {}): Promise<Review[]> {
    return this.request<Review[]>(`/api/reviews${qs({ ...query })}`);
  }

  /** Multisig proposals (indexed). */
  getProposals(limit = 50): Promise<Proposal[]> {
    return this.request<Proposal[]>(`/api/proposals${qs({ limit })}`);
  }

  /** One proposal — the live on-chain state when available. */
  getProposal(id: number): Promise<Proposal> {
    return this.request<Proposal>(`/api/proposals/${id}`);
  }

  /** Disputes, filterable by bounty and open/resolved. */
  getDisputes(query: DisputeQuery = {}): Promise<Dispute[]> {
    return this.request<Dispute[]>(`/api/disputes${qs({ ...query })}`);
  }

  /** One dispute — the live on-chain state when available. */
  getDispute(id: number): Promise<Dispute> {
    return this.request<Dispute>(`/api/disputes/${id}`);
  }

  /** The current multisig signer set and threshold. */
  getSigners(): Promise<SignerSet> {
    return this.request<SignerSet>('/api/signers');
  }

  // ── Reputation ──────────────────────────────────────────────────

  /** Verifiable reputation, reconciled between the ledger and the index. */
  getReputation(address: string): Promise<ReputationView> {
    return this.request<ReputationView>(`/api/reputation/${assertAddress(address)}`);
  }

  /** Reputation leaderboard, highest score first. */
  getReputationLeaderboard(limit = 25): Promise<ReputationLeaderboard> {
    return this.request<ReputationLeaderboard>(`/api/reputation/leaderboard${qs({ limit })}`);
  }

  /** Live on-chain registry stats for a contributor. */
  getContributor(address: string): Promise<ContributorStats> {
    return this.request<ContributorStats>(`/api/contributors/${assertAddress(address)}`);
  }

  // ── Protocol metadata ───────────────────────────────────────────

  /** Deployed contract metadata, including the multisig configuration. */
  getContract(): Promise<ContractInfo> {
    return this.request<ContractInfo>('/api/contract');
  }

  /** Live Stellar network status. */
  getNetwork(): Promise<NetworkStatus> {
    return this.request<NetworkStatus>('/api/network');
  }

  /** Indexed contract events, newest first. */
  getEvents(query: EventQuery = {}): Promise<ContractEvent[]> {
    return this.request<ContractEvent[]>(`/api/events${qs({ ...query })}`);
  }

  // ── Transaction relay ──────────────────────────────────────────

  /**
   * Build + simulate an unsigned contract transaction. Sign the returned XDR
   * with the user's wallet, then submit it via {@link submitTransaction}.
   */
  buildTransaction(
    action: string,
    source: string,
    extra: Record<string, unknown> = {},
  ): Promise<TxBuildResponse> {
    return this.request<TxBuildResponse>('/api/tx/build', {
      method: 'POST',
      body: { action, source, ...extra },
    });
  }

  /** Submit a wallet-signed transaction XDR to Stellar. */
  submitTransaction(signedXdr: string): Promise<TxSubmitResponse> {
    return this.request<TxSubmitResponse>('/api/tx/submit', {
      method: 'POST',
      body: { signedXdr },
    });
  }

  // ── Typed relay helpers ─────────────────────────────────────────

  /** Fund a single-milestone bounty (v1-compatible `create`). */
  buildCreateBounty(params: {
    source: string;
    funder: string;
    token: string;
    amount: string | number;
    issueId: string;
  }): Promise<TxBuildResponse> {
    return this.buildTransaction('create', params.source, {
      funder: params.funder,
      token: params.token,
      amount: String(params.amount),
      issueId: params.issueId,
    });
  }

  /** Fund a milestone-based bounty. */
  buildCreateMilestoneBounty(params: {
    source: string;
    funder: string;
    token: string;
    issueId: string;
    milestones: MilestoneInput[];
  }): Promise<TxBuildResponse> {
    return this.buildTransaction('createBounty', params.source, {
      funder: params.funder,
      token: params.token,
      issueId: params.issueId,
      milestones: params.milestones.map((m) => ({
        title: m.title,
        amount: String(m.amount),
      })),
    });
  }

  /** Claim a bounty as its contributor. */
  buildClaimBounty(params: {
    source: string;
    issueId: string;
    contributor: string;
  }): Promise<TxBuildResponse> {
    return this.buildTransaction('claim', params.source, {
      issueId: params.issueId,
      contributor: params.contributor,
    });
  }

  /** Propose releasing a milestone (multisig approval cycle). */
  buildProposeRelease(params: {
    source: string;
    proposer: string;
    issueId: string;
    milestone: number;
  }): Promise<TxBuildResponse> {
    return this.buildTransaction('proposeRelease', params.source, {
      proposer: params.proposer,
      issueId: params.issueId,
      milestone: params.milestone,
    });
  }

  /** Propose replacing the multisig signer set and threshold. */
  buildProposeSetSigners(params: {
    source: string;
    proposer: string;
    signers: string[];
    threshold: number;
  }): Promise<TxBuildResponse> {
    return this.buildTransaction('proposeSetSigners', params.source, {
      proposer: params.proposer,
      signers: params.signers,
      threshold: params.threshold,
    });
  }

  /** Propose assigning reviewers (and their quorum) to a bounty. */
  buildProposeSetReviewers(params: {
    source: string;
    proposer: string;
    issueId: string;
    reviewers: string[];
    quorum: number;
  }): Promise<TxBuildResponse> {
    return this.buildTransaction('proposeSetReviewers', params.source, {
      proposer: params.proposer,
      issueId: params.issueId,
      reviewers: params.reviewers,
      quorum: params.quorum,
    });
  }

  /** Approve a pending proposal (executes it when the threshold is met). */
  buildApproveProposal(params: {
    source: string;
    signer: string;
    proposalId: number;
  }): Promise<TxBuildResponse> {
    return this.buildTransaction('approve', params.source, {
      signer: params.signer,
      proposalId: params.proposalId,
    });
  }

  /** Submit a reviewer decision on a milestone. */
  buildSubmitReview(params: {
    source: string;
    reviewer: string;
    issueId: string;
    milestone: number;
    decision: ReviewDecision;
    commentHash?: string;
  }): Promise<TxBuildResponse> {
    return this.buildTransaction('submitReview', params.source, {
      reviewer: params.reviewer,
      issueId: params.issueId,
      milestone: params.milestone,
      decision: params.decision,
      commentHash: params.commentHash ?? '',
    });
  }

  /** Open a dispute on a milestone (funder or contributor only). */
  buildOpenDispute(params: {
    source: string;
    opener: string;
    issueId: string;
    milestone: number;
    reasonHash?: string;
  }): Promise<TxBuildResponse> {
    return this.buildTransaction('openDispute', params.source, {
      opener: params.opener,
      issueId: params.issueId,
      milestone: params.milestone,
      reasonHash: params.reasonHash ?? '',
    });
  }

  /** Vote on a dispute as an assigned reviewer. */
  buildVoteDispute(params: {
    source: string;
    reviewer: string;
    disputeId: number;
    payContributor: boolean;
  }): Promise<TxBuildResponse> {
    return this.buildTransaction('voteDispute', params.source, {
      reviewer: params.reviewer,
      disputeId: params.disputeId,
      payContributor: params.payContributor,
    });
  }
}
