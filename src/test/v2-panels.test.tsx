import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import MilestonePanel from '../components/MilestonePanel';
import GovernancePanel from '../components/GovernancePanel';
import ReputationPanel from '../components/ReputationPanel';
import JurisdictionPanel from '../components/JurisdictionPanel';
import RegulationHistoryPanel from '../components/RegulationHistoryPanel';
import * as api from '../lib/api';
import type { WalletAccount } from '../lib/wallet';
import type { ComparisonResult, ContractInfo, MilestoneView } from '../lib/types';

const ACCOUNT: WalletAccount = {
  address: 'GB2OVPTEO2BYRRRRWNRPZZOC3VW77IQDXJPBY2WYV2MXSU7C5HQDZ6E6',
};
const OTHER = 'GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37';

const CONTRACT: ContractInfo = {
  configured: true,
  contractId: 'CB4OI57YRKLAIX2RGFS7DX3GIGEST4MSI447VAJPRCBCNFUHWLWLQLWT',
  tokenId: 'CB7NFW2WD3FXKBYANZX7J3FO6PBST2H3IE6SPHXHSWIQESII2P2A6Y6P',
  registryId: 'CC53MJDM5M76GMZONKC56ONW4MM74MX3KF4LSXMWTRE7W66RASDP4W7Q',
  admin: ACCOUNT.address,
  network: 'Test SDF Network ; September 2015',
  rpcUrl: 'https://soroban-testnet.stellar.org',
  horizonUrl: 'https://horizon-testnet.stellar.org',
  initialised: true,
  signers: [ACCOUNT.address, OTHER],
  signerThreshold: 2,
};

const MILESTONES: MilestoneView = {
  issueId: 'repo#42',
  onChainVerified: true,
  source: 'stellar',
  quorum: 2,
  reviewers: [{ reviewer: ACCOUNT.address, reviews: [] }],
  milestones: [
    {
      index: 0,
      title: 'Draft',
      amount: '100',
      settled: false,
      releasedTx: null,
      releasedUrl: null,
    },
    {
      index: 1,
      title: 'Final',
      amount: '150',
      settled: true,
      releasedTx: 'tx1',
      releasedUrl: 'https://x',
    },
  ],
  releasedAmount: '150',
  disputed: false,
  disputes: [],
};

beforeEach(() => {
  vi.restoreAllMocks();
});

// ── MilestonePanel ────────────────────────────────────────────────
describe('MilestonePanel', () => {
  it('shows milestones, reviewer tally and the actions a signer/reviewer may take', async () => {
    vi.spyOn(api, 'getMilestones').mockResolvedValue(MILESTONES);
    render(
      <MilestonePanel
        account={ACCOUNT}
        contract={CONTRACT}
        bounties={[{ issueId: 'repo#42' }]}
        onDone={() => undefined}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('review-tally-0')).toBeInTheDocument());
    expect(screen.getByTestId('propose-release-0')).toBeInTheDocument();
    expect(screen.getByTestId('approve-0')).toBeInTheDocument();
    expect(screen.getByTestId('reject-0')).toBeInTheDocument();
    // The settled milestone offers no release action.
    expect(screen.queryByTestId('propose-release-1')).not.toBeInTheDocument();
  });

  it('renders an open dispute with reviewer votes', async () => {
    vi.spyOn(api, 'getMilestones').mockResolvedValue({
      ...MILESTONES,
      disputed: true,
      disputes: [
        {
          id: 7,
          milestone: 0,
          opener: ACCOUNT.address,
          votesPayContributor: 1,
          votesRefundFunder: 0,
          resolved: false,
          payContributor: false,
          openedTx: 'open1',
          resolvedTx: null,
          createdAt: '2026-05-16T00:00:00Z',
        },
      ],
    });
    render(
      <MilestonePanel
        account={ACCOUNT}
        contract={CONTRACT}
        bounties={[{ issueId: 'repo#42' }]}
        onDone={() => undefined}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('open-dispute')).toBeInTheDocument());
    expect(screen.getByTestId('vote-pay')).toBeInTheDocument();
    expect(screen.getByTestId('vote-refund')).toBeInTheDocument();
  });
});

// ── GovernancePanel ───────────────────────────────────────────────
describe('GovernancePanel', () => {
  it('renders the signer set and pending proposals', async () => {
    vi.spyOn(api, 'getSigners').mockResolvedValue({
      signers: CONTRACT.signers,
      threshold: 2,
    });
    vi.spyOn(api, 'getProposals').mockResolvedValue([
      {
        id: 1,
        proposer: ACCOUNT.address,
        action: 'Release',
        approvals: [ACCOUNT.address],
        executed: false,
        cancelled: false,
      },
      {
        id: 2,
        proposer: OTHER,
        action: 'SetReviewers',
        approvals: [],
        executed: true,
        cancelled: false,
      },
    ]);
    render(<GovernancePanel account={ACCOUNT} contract={CONTRACT} onDone={() => undefined} />);
    await waitFor(() => expect(screen.getByTestId('proposal-1')).toBeInTheDocument());
    expect(screen.getByTestId(`signer-${ACCOUNT.address}`)).toBeInTheDocument();
    expect(screen.getByText('2-of-2 multisig')).toBeInTheDocument();
    // Already-approved signer cannot approve again, but can revoke.
    expect(screen.getByTestId('approve-proposal-1')).toBeDisabled();
    expect(screen.getByTestId('revoke-proposal-1')).toBeEnabled();
    // Executed proposals are not pending.
    expect(screen.queryByTestId('proposal-2')).not.toBeInTheDocument();
  });

  it('is read-only for a non-signer', async () => {
    vi.spyOn(api, 'getSigners').mockResolvedValue({ signers: [OTHER], threshold: 1 });
    vi.spyOn(api, 'getProposals').mockResolvedValue([
      {
        id: 1,
        proposer: OTHER,
        action: 'Release',
        approvals: [],
        executed: false,
        cancelled: false,
      },
    ]);
    render(<GovernancePanel account={ACCOUNT} contract={CONTRACT} onDone={() => undefined} />);
    await waitFor(() => expect(screen.getByTestId('proposal-1')).toBeInTheDocument());
    expect(screen.queryByTestId('approve-proposal-1')).not.toBeInTheDocument();
  });
});

// ── ReputationPanel ───────────────────────────────────────────────
describe('ReputationPanel', () => {
  it('renders the leaderboard', async () => {
    vi.spyOn(api, 'getReputationLeaderboard').mockResolvedValue({
      generatedAt: '2026-05-16T00:00:00Z',
      total: 1,
      entries: [
        {
          address: ACCOUNT.address,
          payouts: 3,
          payoutTotal: '450',
          reviewsUpheld: 4,
          disputesOpened: 1,
          disputesLost: 0,
          score: 72,
          tier: 'gold',
          source: 'indexed',
        },
      ],
    });
    render(<ReputationPanel account={null} />);
    await waitFor(() =>
      expect(screen.getByTestId(`leaderboard-${ACCOUNT.address}`)).toBeInTheDocument(),
    );
    expect(screen.getByText('72')).toBeInTheDocument();
    expect(screen.getByText('gold')).toBeInTheDocument();
  });
});

// ── JurisdictionPanel ─────────────────────────────────────────────
describe('JurisdictionPanel', () => {
  it('compares jurisdictions and links each cell to its source', async () => {
    vi.spyOn(api, 'getJurisdictions').mockResolvedValue([
      { jurisdiction: 'EU', regulationCount: 3, riskIndex: 55, latestEventDate: '2025-07-01' },
      { jurisdiction: 'US', regulationCount: 2, riskIndex: 40, latestEventDate: '2025-06-01' },
    ]);
    vi.spyOn(api, 'compareJurisdictions').mockResolvedValue({
      generatedAt: '2026-05-16T00:00:00Z',
      jurisdictions: ['EU', 'US'],
      categories: ['stablecoin-regulation'],
      cells: [
        {
          jurisdiction: 'EU',
          category: 'stablecoin-regulation',
          count: 2,
          averageSeverity: 4,
          maxSeverity: 5,
          risk: 80,
          sources: [
            {
              id: 'p1',
              title: 'MiCA',
              category: 'stablecoin-regulation',
              severity: 4,
              eventDate: '2025-07-01',
              sourceName: 'EU',
              sourceUrl: 'https://example.com/mica',
            },
          ],
        },
      ],
      coverage: { EU: 2 },
      profiles: [
        {
          jurisdiction: 'EU',
          regulationCount: 3,
          riskIndex: 55,
          latestEventDate: '2025-07-01',
          categories: {},
          averageSeverity: 3.5,
          maxSeverity: 5,
          impactAreas: [],
          survivalSignals: [],
          sources: [],
        },
        {
          jurisdiction: 'US',
          regulationCount: 2,
          riskIndex: 40,
          latestEventDate: '2025-06-01',
          categories: {},
          averageSeverity: 3,
          maxSeverity: 4,
          impactAreas: [],
          survivalSignals: [],
          sources: [],
        },
      ],
    } satisfies ComparisonResult);

    render(<JurisdictionPanel />);
    await waitFor(() => expect(screen.getByTestId('comparison')).toBeInTheDocument());
    expect(screen.getByTestId('comparison-EU')).toBeInTheDocument();
    expect(screen.getByTestId('cell-EU-stablecoin-regulation')).toBeInTheDocument();
    expect(api.compareJurisdictions).toHaveBeenCalledWith(['EU', 'US']);
  });
});

// ── RegulationHistoryPanel ────────────────────────────────────────
describe('RegulationHistoryPanel', () => {
  it('lists change alerts and acknowledges one', async () => {
    vi.spyOn(api, 'getRegulationVersions').mockResolvedValue([
      {
        id: 'v1',
        policyId: 'p1',
        version: 2,
        title: 'MiCA update',
        jurisdiction: 'EU',
        category: 'stablecoin-regulation',
        eventDate: '2025-08-01',
        severity: 5,
        summary: 'Reserve requirements tightened.',
        sourceName: 'EU',
        sourceUrl: 'https://example.com/mica',
        contentHash: 'abc',
        changedFields: [{ field: 'severity', from: 4, to: 5 }],
        changeType: 'updated',
        detectedAt: '2026-05-16T00:00:00Z',
        impact: [],
        survivalSignals: [],
      },
    ]);
    const alert = {
      id: 'a1',
      policyId: 'p1',
      version: 2,
      alertType: 'severity-escalation' as const,
      severity: 'critical' as const,
      title: 'Severity escalated for p1',
      message: 'severity moved to 5',
      changedFields: [{ field: 'severity', from: 4, to: 5 }],
      sourceUrl: 'https://example.com/mica',
      createdAt: '2026-05-16T00:00:00Z',
      acknowledged: false,
    };
    const alertSpy = vi.spyOn(api, 'getAlerts').mockResolvedValue([alert]);
    const ackSpy = vi
      .spyOn(api, 'acknowledgeAlert')
      .mockResolvedValue({ id: 'a1', acknowledged: true });

    render(<RegulationHistoryPanel />);
    await waitFor(() => expect(screen.getByTestId('alert-a1')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('ack-a1'));
    await waitFor(() => expect(ackSpy).toHaveBeenCalledWith('a1'));
    // After acknowledging, the panel reloads the alert list.
    expect(alertSpy).toHaveBeenCalledTimes(2);
  });
});
