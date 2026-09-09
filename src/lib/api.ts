/**
 * Typed client for the backend REST API (backend/src/routes/api.ts).
 *
 * The backend is the only place the frontend talks to Stellar: it builds and
 * simulates Soroban transactions, relays wallet-signed XDR, and serves the
 * SQLite read-model built by the event indexer and ingestion pipeline.
 */

import type {
  AnalyticsSnapshot,
  Bounty,
  BountyOnChain,
  ContractEvent,
  ContractInfo,
  Issue,
  NetworkStatus,
  PolicyRecord,
  TxAction,
  TxBuildResponse,
  TxSubmitResponse,
} from './types';

const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

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
  extra: Record<string, string>,
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

export { API_URL };
