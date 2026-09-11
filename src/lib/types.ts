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
  registryId: string | null;
  admin: string | null;
  network: string;
  rpcUrl: string;
  horizonUrl: string;
  initialised: boolean;
  /** False when Soroban RPC could not be reached to confirm initialisation. */
  sorobanReachable?: boolean;
  /** Multisig signer set (live from the contract). */
  signers: string[];
  /** Approvals required before a privileged action executes. */
  signerThreshold: number;
};

export type Bounty = {
  issueId: string;
  funder: string;
  contributor: string | null;
  token: string;
  amount: string;
  released: boolean;
  /** True when the remaining escrow was refunded to the funder. */
  refunded: boolean;
  /** Sum of milestone amounts paid to the contributor so far. */
  releasedAmount: string;
  /** Number of milestones in the escrow. */
  milestones: number;
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
  /** Soroban RPC event id (a string, e.g. "0000001234-0000"). */
  id: string;
  txHash: string;
  ledger: number;
  contractId: string;
  topic: string;
  issueId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
  explorerUrl: string;
};

/** Ecosystem-impact area covered by a policy event (curated taxonomy — must match backend/src/services/ingest/policies.ts). */
export type ImpactArea =
  | 'stablecoin-issuers'
  | 'exchanges'
  | 'cross-border-payments'
  | 'wallets-and-custody'
  | 'defi-protocols'
  | 'institutional-adoption'
  | 'tokenization'
  | 'sanctions-compliance'
  | 'consumer-protection'
  | 'infrastructure-providers';

/** Project-survival signal attached to a policy event (curated taxonomy — must match backend). */
export type SurvivalSignal =
  | 'higher-compliance-cost'
  | 'licensing-requirements'
  | 'jurisdiction-shift'
  | 'delisting-risk'
  | 'reserve-and-audit-requirements'
  | 'disclosure-burden'
  | 'operational-risk-management'
  | 'enforcement-action'
  | 'market-access-barrier'
  | 'capital-requirement';

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
  impact: ImpactArea[];
  survivalSignals: SurvivalSignal[];
};

export type TimelinePoint = {
  month: string; // YYYY-MM
  count: number;
  averageSeverity: number;
};

export type HeatmapCell = {
  jurisdiction: string;
  category: string;
  count: number;
  severityScore: number;
  risk: number; // 0..100 within this cell
};

export type ImpactAggregate = {
  area: ImpactArea;
  count: number;
  totalSeverity: number;
};

export type SurvivalSignalAggregate = {
  signal: SurvivalSignal;
  count: number;
  totalSeverity: number;
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
  timeline: TimelinePoint[];
  heatmap: HeatmapCell[];
  impact: ImpactAggregate[];
  survivalSignals: SurvivalSignalAggregate[];
  jurisdictionRisk: Record<string, number>;
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

// ── Milestones, reviews, disputes, proposals (contract v2) ────────

export type ReviewDecision = 'approve' | 'reject';

export type ReviewView = {
  milestone: number;
  decision: ReviewDecision;
  ledger: number | null;
  txHash: string | null;
  explorerUrl: string | null;
  createdAt: string;
};

export type ReviewerEntry = {
  reviewer: string;
  reviews: ReviewView[];
};

export type DisputeView = {
  id: number;
  milestone: number;
  opener: string;
  votesPayContributor: number;
  votesRefundFunder: number;
  resolved: boolean;
  payContributor: boolean;
  openedTx: string | null;
  resolvedTx: string | null;
  createdAt: string;
};

export type MilestoneView = {
  issueId: string;
  onChainVerified: boolean;
  source: 'stellar' | 'index';
  quorum: number;
  reviewers: ReviewerEntry[];
  milestones: Array<{
    index: number;
    title: string;
    amount: string;
    settled: boolean;
    releasedTx: string | null;
    releasedUrl: string | null;
  }>;
  releasedAmount: string | null;
  disputed: boolean;
  disputes: DisputeView[];
};

export type Review = {
  id: string;
  issueId: string;
  milestone: number;
  reviewer: string;
  decision: ReviewDecision;
  ledger: number | null;
  txHash: string | null;
  explorerUrl: string | null;
  createdAt: string;
};

export type Proposal = {
  id: number;
  proposer: string;
  action: string;
  actionDetail?: unknown;
  approvals: string[];
  executed: boolean;
  cancelled: boolean;
  createdTx?: string | null;
  explorerUrl?: string | null;
  updatedAt?: string;
  verified?: boolean;
  source?: 'stellar' | 'index';
};

export type SignerSet = {
  signers: string[];
  threshold: number;
};

// ── Reputation ────────────────────────────────────────────────────

export type Reputation = {
  address: string;
  payouts: number;
  payoutTotal: string;
  reviewsUpheld: number;
  disputesOpened: number;
  disputesLost: number;
  score: number;
  tier: string;
  source?: 'indexed' | 'stellar';
  updatedAt?: string;
};

export type ReputationView = {
  address: string;
  stellarReachable: boolean;
  onChain: (Omit<Reputation, 'tier' | 'address'> & { source: 'stellar' }) | null;
  indexed: Reputation | null;
  reputation: Reputation | null;
};

export type ReputationLeaderboard = {
  generatedAt: string;
  total: number;
  entries: Reputation[];
};

// ── Jurisdiction comparison ───────────────────────────────────────

export type SourceRef = {
  id: string;
  title: string;
  category: string;
  severity: number;
  eventDate: string;
  sourceName: string;
  sourceUrl: string;
};

export type JurisdictionSummary = {
  jurisdiction: string;
  regulationCount: number;
  riskIndex: number;
  latestEventDate: string;
};

export type JurisdictionProfile = JurisdictionSummary & {
  categories: Record<string, number>;
  averageSeverity: number;
  maxSeverity: number;
  impactAreas: Array<{ area: string; count: number }>;
  survivalSignals: Array<{ signal: string; count: number }>;
  sources: SourceRef[];
};

export type ComparisonCell = {
  jurisdiction: string;
  category: string;
  count: number;
  averageSeverity: number;
  maxSeverity: number;
  risk: number;
  sources: SourceRef[];
};

export type ComparisonResult = {
  generatedAt: string;
  jurisdictions: string[];
  categories: string[];
  cells: ComparisonCell[];
  coverage: Record<string, number>;
  profiles: JurisdictionProfile[];
};

// ── Regulation version history & change detection ─────────────────

export type FieldChange = {
  field: string;
  from: string | number | string[];
  to: string | number | string[];
};

export type RegulationVersion = {
  id: string;
  policyId: string;
  version: number;
  title: string;
  jurisdiction: string;
  category: string;
  eventDate: string;
  severity: number;
  summary: string;
  sourceName: string;
  sourceUrl: string;
  contentHash: string;
  changedFields: FieldChange[];
  changeType: 'new' | 'updated';
  detectedAt: string;
  impact: string[];
  survivalSignals: string[];
};

export type RegulationDiff = {
  policyId: string;
  from: RegulationVersion;
  to: RegulationVersion;
  changes: FieldChange[];
  sourceUrl: string;
};

export type AlertSeverity = 'info' | 'warning' | 'critical';

export type RegulationAlert = {
  id: string;
  policyId: string;
  version: number;
  alertType: 'new-regulation' | 'regulation-changed' | 'severity-escalation';
  severity: AlertSeverity;
  title: string;
  message: string;
  changedFields: FieldChange[];
  sourceUrl: string | null;
  createdAt: string;
  acknowledged: boolean;
};

// ── Transaction relay ──────────────────────────────────────────────

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

/** Relay actions whitelisted by `POST /api/tx/build`. */
export type TxAction =
  | 'create'
  | 'createBounty'
  | 'claim'
  | 'reclaim'
  | 'proposeRelease'
  | 'proposeReclaim'
  | 'proposeSetSigners'
  | 'proposeSetReviewers'
  | 'proposeResolveDispute'
  | 'approve'
  | 'revoke'
  | 'cancel'
  | 'submitReview'
  | 'openDispute'
  | 'voteDispute';
