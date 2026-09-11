/**
 * Public response types for `@regulation-reckoning/sdk`.
 *
 * These mirror the backend REST API (`docs/API.md`). The SDK deliberately
 * declares its own types instead of importing backend internals so it can be
 * published and consumed standalone.
 */

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

export interface PolicyRecord {
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
  contentHash: string;
  version: number;
}

export interface AnalyticsSnapshot {
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
  bySeverity: Record<string, number>;
  byYear: Record<string, number>;
  timeline: Array<{ month: string; count: number; averageSeverity: number }>;
  heatmap: Array<{
    jurisdiction: string;
    category: string;
    count: number;
    severityScore: number;
    risk: number;
  }>;
  impact: Array<{ area: ImpactArea; count: number; totalSeverity: number }>;
  survivalSignals: Array<{ signal: SurvivalSignal; count: number; totalSeverity: number }>;
  jurisdictionRisk: Record<string, number>;
}

export interface FieldChange {
  field: string;
  from: string | number | string[];
  to: string | number | string[];
}

export interface RegulationVersion {
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
}

export interface RegulationDiff {
  policyId: string;
  from: RegulationVersion;
  to: RegulationVersion;
  changes: FieldChange[];
  sourceUrl: string;
}

export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface RegulationAlert {
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
}

export interface SourceRef {
  id: string;
  title: string;
  category: string;
  severity: number;
  eventDate: string;
  sourceName: string;
  sourceUrl: string;
}

export interface JurisdictionSummary {
  jurisdiction: string;
  regulationCount: number;
  riskIndex: number;
  latestEventDate: string;
}

export interface JurisdictionProfile extends JurisdictionSummary {
  categories: Record<string, number>;
  averageSeverity: number;
  maxSeverity: number;
  impactAreas: Array<{ area: string; count: number }>;
  survivalSignals: Array<{ signal: string; count: number }>;
  sources: SourceRef[];
}

export interface ComparisonCell {
  jurisdiction: string;
  category: string;
  count: number;
  averageSeverity: number;
  maxSeverity: number;
  risk: number;
  sources: SourceRef[];
}

export interface ComparisonResult {
  generatedAt: string;
  jurisdictions: string[];
  categories: string[];
  cells: ComparisonCell[];
  coverage: Record<string, number>;
  profiles: JurisdictionProfile[];
}

export interface Bounty {
  issueId: string;
  funder: string;
  contributor: string | null;
  token: string;
  amount: string;
  released: boolean;
  refunded: boolean;
  releasedAmount: string;
  milestones: number;
  createdTx: string | null;
  releasedTx: string | null;
  updatedAt: string;
  createdUrl: string | null;
  releasedUrl: string | null;
}

export interface BountyOnChain {
  funder: string;
  contributor: string | null;
  token: string;
  amount: string;
  issue_id: string;
  released: boolean;
  refunded?: boolean;
  released_amount?: string;
  milestones?: Array<{ title: string; amount: string; settled: boolean }>;
  reviewers?: string[];
  reviewer_quorum?: number;
  verified: boolean;
  source: 'stellar' | 'index';
}

export interface ReviewView {
  milestone: number;
  decision: 'approve' | 'reject';
  ledger: number | null;
  txHash: string | null;
  explorerUrl: string | null;
  createdAt: string;
}

export interface ReviewerEntry {
  reviewer: string;
  reviews: ReviewView[];
}

export interface MilestoneView {
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
  disputes: Dispute[];
}

export interface Review {
  id: string;
  issueId: string;
  milestone: number;
  reviewer: string;
  decision: 'approve' | 'reject';
  ledger: number | null;
  txHash: string | null;
  explorerUrl: string | null;
  createdAt: string;
}

export interface Proposal {
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
}

export interface Dispute {
  id: number;
  issueId?: string;
  issue_id?: string;
  milestone: number;
  opener: string;
  reasonHash?: string;
  reason_hash?: string;
  votesPayContributor?: number;
  votesRefundFunder?: number;
  votes_pay_contributor?: number;
  votes_refund_funder?: number;
  resolved: boolean;
  payContributor?: boolean;
  pay_contributor?: boolean;
  openedTx?: string | null;
  resolvedTx?: string | null;
  openedUrl?: string | null;
  resolvedUrl?: string | null;
  createdAt?: string;
  updatedAt?: string;
  verified?: boolean;
  source?: 'stellar' | 'index';
}

export interface Reputation {
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
}

export interface ReputationView {
  address: string;
  stellarReachable: boolean;
  onChain: Omit<Reputation, 'tier' | 'address'> | null;
  indexed: Reputation | null;
  reputation: Reputation | Omit<Reputation, 'tier' | 'address'> | null;
}

export interface ReputationLeaderboard {
  generatedAt: string;
  total: number;
  entries: Reputation[];
}

export interface ContributorStats {
  contributor: string;
  count: number;
  total: string;
  verified: boolean;
  source: 'stellar';
}

export interface ContractInfo {
  configured: boolean;
  contractId: string | null;
  tokenId: string | null;
  registryId: string | null;
  admin: string | null;
  network: string;
  rpcUrl: string;
  horizonUrl: string;
  initialised: boolean;
  sorobanReachable: boolean;
  signers: string[];
  signerThreshold: number;
}

export interface SignerSet {
  signers: string[];
  threshold: number;
}

export interface NetworkStatus {
  network: string;
  horizon: string;
  protocolVersion: string;
  latestLedger: string;
  closedAt: string;
}

export interface ContractEvent {
  id: string;
  txHash: string;
  ledger: number;
  contractId: string;
  topic: string;
  issueId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
  explorerUrl: string;
}

export interface TxBuildResponse {
  txXdr: string;
  action: string;
  networkPassphrase: string;
}

export interface TxSubmitResponse {
  status: string;
  hash: string;
  explorerUrl: string;
}

export interface MilestoneInput {
  title: string;
  amount: string | number;
}

export type ReviewDecision = 'approve' | 'reject';
