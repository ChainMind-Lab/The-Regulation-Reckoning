/**
 * Typed client for the backend REST API (backend/src/routes/api.ts).
 *
 * The backend is the only place the frontend talks to Stellar: it builds and
 * simulates Soroban transactions, relays wallet-signed XDR, and serves the
 * SQLite read-model built by the event indexer and ingestion pipeline.
 */

import type {
  AlertSeverity,
  AnalyticsSnapshot,
  Bounty,
  BountyOnChain,
  ComparisonResult,
  ContractEvent,
  ContractInfo,
  Issue,
  JurisdictionProfile,
  JurisdictionSummary,
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
  TxAction,
  TxBuildResponse,
  TxSubmitResponse,
} from './types';

// In dev the dashboard talks to the backend directly (vite dev server on 4173,
// API on 3001). In production builds the backend is reached through the same
// origin (nginx proxies /api and /health), so an empty base URL is correct —
// this is what makes the Docker image work without baking in a host. Set
// VITE_API_URL at build time to point at a different backend.
const API_URL: string =
  import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? 'http://localhost:3001' : '');

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, init);
  if (!res.ok) {
    let detail: { error?: string; code?: string } | null = null;
    try {
      detail = (await res.json()) as { error?: string; code?: string };
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(
      detail?.error ?? `API error ${res.status} on ${path}`,
      res.status,
      detail?.code,
    );
  }
  return (await res.json()) as T;
}

export function getNetworkStatus(): Promise<NetworkStatus> {
  return request<NetworkStatus>('/api/network');
}

export function getContractInfo(): Promise<ContractInfo> {
  return request<ContractInfo>('/api/contract');
}

export function getBounties(): Promise<Bounty[]> {
  return request<Bounty[]>('/api/bounties');
}

export function getBounty(issueId: string): Promise<BountyOnChain> {
  return request<BountyOnChain>(`/api/bounties/${encodeURIComponent(issueId)}`);
}

export function getEvents(limit = 50): Promise<ContractEvent[]> {
  return request<ContractEvent[]>(`/api/events?limit=${limit}`);
}

export function getPolicies(): Promise<PolicyRecord[]> {
  return request<PolicyRecord[]>('/api/policies');
}

export function getAnalytics(): Promise<AnalyticsSnapshot> {
  return request<AnalyticsSnapshot>('/api/analytics');
}

export function getIssues(): Promise<Issue[]> {
  return request<Issue[]>('/api/issues');
}

export function getPayments(limit = 10): Promise<unknown[]> {
  return request<unknown[]>(`/api/payments?limit=${limit}`);
}

/**
 * Build an unsigned Soroban transaction for the given action. The wallet signs
 * the returned XDR, which is then submitted via submitTransaction.
 */
export function buildTransaction(
  action: TxAction,
  source: string,
  extra: Record<string, unknown>,
): Promise<TxBuildResponse> {
  return request<TxBuildResponse>('/api/tx/build', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, source, ...extra }),
  });
}

export function submitTransaction(signedXdr: string): Promise<TxSubmitResponse> {
  return request<TxSubmitResponse>('/api/tx/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signedXdr }),
  });
}

// ── Milestones, reviews, proposals, disputes ─────────────────────

export function getMilestones(issueId: string): Promise<MilestoneView> {
  return request<MilestoneView>(`/api/bounties/${encodeURIComponent(issueId)}/milestones`);
}

export function getReviews(
  params: {
    issueId?: string;
    milestone?: number;
    reviewer?: string;
    limit?: number;
  } = {},
): Promise<Review[]> {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) search.set(k, String(v));
  }
  const qs = search.toString();
  return request<Review[]>(`/api/reviews${qs ? `?${qs}` : ''}`);
}

export function getProposals(limit = 50): Promise<Proposal[]> {
  return request<Proposal[]>(`/api/proposals?limit=${limit}`);
}

export function getProposal(id: number): Promise<Proposal> {
  return request<Proposal>(`/api/proposals/${id}`);
}

export function getSigners(): Promise<SignerSet> {
  return request<SignerSet>('/api/signers');
}

export function getDisputes(params: { issueId?: string; open?: boolean; limit?: number } = {}) {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) search.set(k, String(v));
  }
  const qs = search.toString();
  return request<MilestoneView['disputes']>(`/api/disputes${qs ? `?${qs}` : ''}`);
}

// ── Reputation ───────────────────────────────────────────────────

export function getReputation(address: string): Promise<ReputationView> {
  return request<ReputationView>(`/api/reputation/${encodeURIComponent(address)}`);
}

export function getReputationLeaderboard(limit = 25): Promise<ReputationLeaderboard> {
  return request<ReputationLeaderboard>(`/api/reputation/leaderboard?limit=${limit}`);
}

// ── Jurisdiction comparison ──────────────────────────────────────

export function getJurisdictions(): Promise<JurisdictionSummary[]> {
  return request<JurisdictionSummary[]>('/api/jurisdictions');
}

export function getJurisdiction(id: string): Promise<JurisdictionProfile> {
  return request<JurisdictionProfile>(`/api/jurisdictions/${encodeURIComponent(id)}`);
}

export function compareJurisdictions(ids: string[], category?: string): Promise<ComparisonResult> {
  const search = new URLSearchParams({ ids: ids.join(',') });
  if (category) search.set('category', category);
  return request<ComparisonResult>(`/api/jurisdictions/compare?${search.toString()}`);
}

// ── Regulation history & alerts ─────────────────────────────────

export function getRegulationVersions(limit = 100): Promise<RegulationVersion[]> {
  return request<RegulationVersion[]>(`/api/regulations/versions?limit=${limit}`);
}

export function getPolicyVersions(policyId: string): Promise<RegulationVersion[]> {
  return request<RegulationVersion[]>(`/api/regulations/${encodeURIComponent(policyId)}/versions`);
}

export function getRegulationDiff(
  policyId: string,
  from: number,
  to: number,
): Promise<RegulationDiff> {
  return request<RegulationDiff>(
    `/api/regulations/${encodeURIComponent(policyId)}/diff?from=${from}&to=${to}`,
  );
}

export function getAlerts(
  params: {
    policyId?: string;
    severity?: AlertSeverity;
    acknowledged?: boolean;
    limit?: number;
  } = {},
): Promise<RegulationAlert[]> {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) search.set(k, String(v));
  }
  const qs = search.toString();
  return request<RegulationAlert[]>(`/api/alerts${qs ? `?${qs}` : ''}`);
}

export function acknowledgeAlert(id: string): Promise<{ id: string; acknowledged: boolean }> {
  return request(`/api/alerts/${encodeURIComponent(id)}/acknowledge`, { method: 'POST' });
}

// ── Typed transaction builders ───────────────────────────────────

export function buildCreateMilestoneBounty(
  source: string,
  milestones: Array<{ title: string; amount: string | number }>,
  extra: { funder: string; token: string; issueId: string },
): Promise<TxBuildResponse> {
  return buildTransaction('createBounty', source, {
    funder: extra.funder,
    token: extra.token,
    issueId: extra.issueId,
    // Sent as a real array: the backend validates and encodes each milestone.
    milestones: milestones.map((m) => ({ title: m.title, amount: String(m.amount) })),
  });
}

export function buildClaimBounty(
  source: string,
  issueId: string,
  contributor: string,
): Promise<TxBuildResponse> {
  return buildTransaction('claim', source, { issueId, contributor });
}

export function buildProposeRelease(
  source: string,
  proposer: string,
  issueId: string,
  milestone: number,
): Promise<TxBuildResponse> {
  return buildTransaction('proposeRelease', source, {
    proposer,
    issueId,
    milestone: String(milestone),
  });
}

export function buildApproveProposal(
  source: string,
  signer: string,
  proposalId: number,
): Promise<TxBuildResponse> {
  return buildTransaction('approve', source, { signer, proposalId: String(proposalId) });
}

export function buildProposeSetReviewers(
  source: string,
  proposer: string,
  issueId: string,
  reviewers: string[],
  quorum: number,
): Promise<TxBuildResponse> {
  return buildTransaction('proposeSetReviewers', source, {
    proposer,
    issueId,
    reviewers,
    quorum: String(quorum),
  });
}

export function buildSubmitReview(
  source: string,
  reviewer: string,
  issueId: string,
  milestone: number,
  decision: ReviewDecision,
  commentHash = '',
): Promise<TxBuildResponse> {
  return buildTransaction('submitReview', source, {
    reviewer,
    issueId,
    milestone: String(milestone),
    decision,
    commentHash,
  });
}

export function buildOpenDispute(
  source: string,
  opener: string,
  issueId: string,
  milestone: number,
  reasonHash = '',
): Promise<TxBuildResponse> {
  return buildTransaction('openDispute', source, {
    opener,
    issueId,
    milestone: String(milestone),
    reasonHash,
  });
}

export function buildVoteDispute(
  source: string,
  reviewer: string,
  disputeId: number,
  payContributor: boolean,
): Promise<TxBuildResponse> {
  return buildTransaction('voteDispute', source, {
    reviewer,
    disputeId: String(disputeId),
    payContributor: String(payContributor),
  });
}

export { API_URL };

// ── Server-sent events: live contract-event notifications ─────────

/**
 * Connect to the SSE feed of newly indexed contract events.
 *
 * Events are best-effort notifications. The dashboard uses them as a hint to
 * refresh, not as the only source of truth.
 */
export interface SseEvent {
  id: string;
  data: string;
}

export interface SseClient {
  close: () => void;
}

/**
 * Create an SSE connection that automatically reconnects on error/disconnect.
 *
 * `onEvent` receives the event id of each newly indexed contract event. `null`
 * ids are keepalives / control frames and are ignored.
 */
export function autoSse(
  onEvent: (id: string) => void,
  onClosed?: () => void,
  baseUrl?: string,
): SseClient {
  let controller: AbortController | null = null;
  let retryMs = 1000;

  function connect() {
    if (controller) controller.abort();
    controller = new AbortController();
    const url = `${baseUrl ?? API_URL}/api/events/stream`;
    const req = new Request(url, {
      signal: controller.signal,
      headers: { 'Accept': 'text/event-stream' },
    });
    fetch(req)
      .then((res) => {
        if (!res.ok) {
          retryMs = Math.min(30_000, retryMs * 2);
          setTimeout(connect, retryMs);
          return;
        }
        const reader = res.body?.getReader();
        if (!reader) {
          retryMs = Math.min(30_000, retryMs * 2);
          setTimeout(connect, retryMs);
          return;
        }
        const decoder = new TextDecoder();
        let buffer = '';

        (function read() {
          reader
            .read()
            .then(({ done, value }) => {
              if (done) {
                retryMs = 1000;
                setTimeout(connect, 1000);
                return;
              }
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n');
              buffer = lines.pop() ?? '';
              for (const line of lines) {
                if (line.startsWith('id: ')) {
                  const id = line.slice(4).trim();
                  if (id) onEvent(id);
                }
              }
              read();
            })
            .catch(() => {
              retryMs = Math.min(30_000, retryMs * 2);
              setTimeout(connect, retryMs);
            });
        })();
      })
      .catch(() => {
        retryMs = Math.min(30_000, retryMs * 2);
        setTimeout(connect, retryMs);
      });
  }

  connect();
  return {
    close() {
      controller?.abort();
      retryMs = Infinity;
      onClosed?.();
    },
  };
}
