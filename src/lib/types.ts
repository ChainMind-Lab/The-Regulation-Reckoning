/** Shared frontend types — mirror the backend API responses (see backend/docs). */

export type NetworkStatus = {
  network: string;
  horizon: string;
  protocolVersion: string;
  latestLedger: string;
  closedAt: string;
};

export type ContractInfo = {
  configured: boolean;
  contractId: string | null;
  tokenId: string | null;
  admin: string | null;
  network: string;
  rpcUrl: string;
  horizonUrl: string;
  initialised: boolean;
};

export type Bounty = {
  issueId: string;
  funder: string;
  contributor: string | null;
  token: string;
  amount: string;
  released: boolean;
  createdTx: string | null;
  releasedTx: string | null;
  updatedAt: string;
  createdUrl: string | null;
  releasedUrl: string | null;
};

export type BountyOnChain = {
  issueId: string;
  funder: string;
  contributor: string | null;
  token: string;
  amount: string;
  released: boolean;
  verified: boolean;
  source: 'stellar';
};

export type ContractEvent = {
  id: number;
  txHash: string;
  ledger: number;
  contractId: string;
  topic: string;
  issueId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
  explorerUrl: string;
};

export type PolicyRecord = {
  id: string;
  title: string;
  jurisdiction: string;
  category: string;
  eventDate: string;
  severity: number;
  summary: string;
  sourceName: string;
  sourceUrl: string;
  source: string;
};

export type AnalyticsSnapshot = {
  generatedAt: string;
  totals: {
    events: number;
    jurisdictions: number;
    categories: number;
    averageSeverity: number;
  };
  riskIndex: number;
  byJurisdiction: Record<string, number>;
  byCategory: Record<string, number>;
  bySeverity: Record<number, number>;
  byYear: Record<string, number>;
};

export type Issue = {
  id: string;
  repo: string;
  title: string;
  points: number;
  tags: string[];
  state: string;
  source: string;
  ingestedAt: string;
};

export type TxBuildResponse = {
  txXdr: string;
  action: string;
  networkPassphrase: string;
};

export type TxSubmitResponse = {
  status: string;
  hash: string;
  explorerUrl: string;
};

export type TxAction = 'create' | 'release' | 'reclaim';
