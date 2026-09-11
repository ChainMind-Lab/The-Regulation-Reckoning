import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import NavBar from '../components/NavBar';
import HeroSection from '../components/HeroSection';
import NetworkStatusCard from '../components/NetworkStatusCard';
import VerificationPanel from '../components/VerificationPanel';
import WalletButton from '../components/WalletButton';
import BountyCard from '../components/BountyCard';
import BountyForm from '../components/BountyForm';
import EventsFeed from '../components/EventsFeed';
import PolicyPanel from '../components/PolicyPanel';
import App from '../App';
import * as api from '../lib/api';
import * as wallet from '../lib/wallet';
import type { Bounty, ContractEvent, PolicyRecord, AnalyticsSnapshot } from '../lib/types';
import type { WalletAccount } from '../lib/wallet';

const ACCOUNT: WalletAccount = {
  address: 'GB2OVPTEO2BYRRRRWNRPZZOC3VW77IQDXJPBY2WYV2MXSU7C5HQDZ6E6',
};

const CONTRACT = {
  configured: true,
  contractId: 'CB4OI57YRKLAIX2RGFS7DX3GIGEST4MSI447VAJPRCBCNFUHWLWLQLWT',
  tokenId: 'CB7NFW2WD3FXKBYANZX7J3FO6PBST2H3IE6SPHXHSWIQESII2P2A6Y6P',
  registryId: 'CC53MJDM5M76GMZONKC56ONW4MM74MX3KF4LSXMWTRE7W66RASDP4W7Q',
  admin: 'GB2OVPTEO2BYRRRRWNRPZZOC3VW77IQDXJPBY2WYV2MXSU7C5HQDZ6E6',
  network: 'Test SDF Network ; September 2015',
  rpcUrl: 'https://soroban-testnet.stellar.org',
  horizonUrl: 'https://horizon-testnet.stellar.org',
  initialised: true,
  signers: [
    'GB2OVPTEO2BYRRRRWNRPZZOC3VW77IQDXJPBY2WYV2MXSU7C5HQDZ6E6',
    'GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37',
  ],
  signerThreshold: 2,
};

const BOUNTY: Bounty = {
  issueId: 'repo#42',
  funder: 'GB2OVPTEO2BYRRRRWNRPZZOC3VW77IQDXJPBY2WYV2MXSU7C5HQDZ6E6',
  contributor: null,
  token: 'CB7NFW2WD3FXKBYANZX7J3FO6PBST2H3IE6SPHXHSWIQESII2P2A6Y6P',
  amount: '250',
  released: false,
  refunded: false,
  releasedAmount: '0',
  milestones: 2,
  createdTx: 'abc123',
  releasedTx: null,
  updatedAt: '2026-05-16T00:00:00Z',
  createdUrl: 'https://stellar.expert/explorer/testnet/tx/abc123',
  releasedUrl: null,
};

const EVENT: ContractEvent = {
  id: 'evt-1',
  txHash: 'abc123def456',
  ledger: 19695405,
  contractId: 'CB4OI57YRKLAIX2RGFS7DX3GIGEST4MSI447VAJPRCBCNFUHWLWLQLWT',
  topic: 'bounty_created',
  issueId: 'repo#42',
  payload: {},
  createdAt: '2026-05-16T00:00:00Z',
  explorerUrl: 'https://stellar.expert/explorer/testnet/tx/abc123def456',
};

const POLICY: PolicyRecord = {
  id: 'p1',
  title: 'EU MiCA stablecoin rules apply',
  jurisdiction: 'EU',
  category: 'stablecoin-regulation',
  eventDate: '2025-07-01',
  severity: 4,
  summary: 'Stablecoin issuers must hold a license.',
  sourceName: 'EU',
  sourceUrl: 'https://example.com/mica',
  source: 'curated',
  impact: ['stablecoin-issuers', 'exchanges'],
  survivalSignals: ['licensing-requirements', 'higher-compliance-cost'],
};

const ANALYTICS: AnalyticsSnapshot = {
  generatedAt: '2026-05-16T00:00:00Z',
  totals: { events: 20, jurisdictions: 8, categories: 6, averageSeverity: 3.1 },
  riskIndex: 42.5,
  byJurisdiction: { EU: 5 },
  byCategory: { 'stablecoin-regulation': 4 },
  bySeverity: { 4: 3 },
  byYear: { 2025: 20 },
  timeline: [
    { month: '2025-06', count: 3, averageSeverity: 3.5 },
    { month: '2025-07', count: 5, averageSeverity: 3.8 },
  ],
  heatmap: [
    {
      jurisdiction: 'EU',
      category: 'stablecoin-regulation',
      count: 4,
      severityScore: 16,
      risk: 80,
    },
  ],
  impact: [{ area: 'stablecoin-issuers', count: 4, totalSeverity: 16 }],
  survivalSignals: [{ signal: 'licensing-requirements', count: 3, totalSeverity: 12 }],
  jurisdictionRisk: { EU: 64 },
};

const NETWORK = {
  network: 'Test SDF Network ; September 2015',
  horizon: 'https://horizon-testnet.stellar.org',
  protocolVersion: '22',
  latestLedger: '50000000',
  closedAt: '2026-05-16T14:00:00Z',
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
});

// ── NavBar ────────────────────────────────────────────────────────
describe('NavBar', () => {
  it('renders brand and nav links', () => {
    render(<NavBar account={null} onConnect={() => undefined} onDisconnect={() => undefined} />);
    expect(screen.getByText(/Regulation Reckoning/i)).toBeInTheDocument();
    ['Network', 'Bounties', 'Events', 'Regulatory', 'GitHub'].forEach((link) =>
      expect(screen.getByRole('link', { name: link })).toBeInTheDocument(),
    );
  });

  it('links to the real repository', () => {
    render(<NavBar account={null} onConnect={() => undefined} onDisconnect={() => undefined} />);
    expect(screen.getByRole('link', { name: 'GitHub' }).getAttribute('href')).toContain(
      'ChainMind-Lab/The-Regulation-Reckoning',
    );
  });

  it('shows wallet address when connected', () => {
    render(<NavBar account={ACCOUNT} onConnect={() => undefined} onDisconnect={() => undefined} />);
    expect(screen.getByText(/GB2OVP…Z6E6/)).toBeInTheDocument();
  });
});

// ── WalletButton ──────────────────────────────────────────────────
describe('WalletButton', () => {
  it('shows Freighter required when unavailable', () => {
    vi.spyOn(wallet, 'isFreighterAvailable').mockReturnValue(false);
    render(
      <WalletButton account={null} onConnect={() => undefined} onDisconnect={() => undefined} />,
    );
    expect(screen.getByText('Freighter required')).toBeInTheDocument();
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('connects and reports the account', async () => {
    vi.spyOn(wallet, 'isFreighterAvailable').mockReturnValue(true);
    vi.spyOn(wallet, 'connectWallet').mockResolvedValue(ACCOUNT);
    const onConnect = vi.fn();
    render(<WalletButton account={null} onConnect={onConnect} onDisconnect={() => undefined} />);
    fireEvent.click(screen.getByTestId('connect-wallet'));
    await waitFor(() => expect(onConnect).toHaveBeenCalledWith(ACCOUNT));
  });

  it('surfaces connection errors', async () => {
    vi.spyOn(wallet, 'isFreighterAvailable').mockReturnValue(true);
    vi.spyOn(wallet, 'connectWallet').mockRejectedValue(new Error('Freighter is locked'));
    render(
      <WalletButton account={null} onConnect={() => undefined} onDisconnect={() => undefined} />,
    );
    fireEvent.click(screen.getByTestId('connect-wallet'));
    await waitFor(() => expect(screen.getByTestId('wallet-error')).toHaveTextContent(/locked/));
  });

  it('warns when the wallet is on the wrong network', async () => {
    vi.spyOn(wallet, 'isWrongNetwork').mockResolvedValue(true);
    vi.spyOn(wallet, 'getWalletNetwork').mockResolvedValue('Test SDF Network ; Future');
    render(
      <WalletButton account={ACCOUNT} onConnect={() => undefined} onDisconnect={() => undefined} />,
    );
    await waitFor(() => expect(screen.getByTestId('wrong-network')).toBeInTheDocument());
    expect(screen.getByTestId('wrong-network')).toHaveTextContent(/Wrong network/);
  });

  it('copies the wallet address on click', async () => {
    render(
      <WalletButton account={ACCOUNT} onConnect={() => undefined} onDisconnect={() => undefined} />,
    );
    fireEvent.click(screen.getByTestId('copy-address'));
    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(ACCOUNT.address),
    );
  });
});

// ── NetworkStatusCard ─────────────────────────────────────────────
describe('NetworkStatusCard', () => {
  it('shows loading state when status is null', () => {
    render(<NetworkStatusCard status={null} error={false} />);
    expect(screen.getByText(/connecting/i)).toBeInTheDocument();
  });

  it('shows error state', () => {
    render(<NetworkStatusCard status={null} error={true} />);
    expect(screen.getByText(/unable to reach/i)).toBeInTheDocument();
  });

  it('renders live network data', () => {
    render(<NetworkStatusCard status={NETWORK} error={false} />);
    expect(screen.getByText('v22')).toBeInTheDocument();
    expect(screen.getByText('#50000000')).toBeInTheDocument();
  });
});

// ── VerificationPanel ─────────────────────────────────────────────
describe('VerificationPanel', () => {
  it('shows contract, token, registry and admin addresses with explorer links', () => {
    render(<VerificationPanel contract={CONTRACT} network={NETWORK} events={[EVENT]} />);
    expect(screen.getByText('Bounty contract')).toBeInTheDocument();
    expect(screen.getByText(CONTRACT.contractId)).toBeInTheDocument();
    expect(screen.getByText(CONTRACT.tokenId)).toBeInTheDocument();
    expect(screen.getByText(CONTRACT.registryId)).toBeInTheDocument();
    expect(screen.getByText(CONTRACT.admin)).toBeInTheDocument();
    const explorerLinks = screen.getAllByRole('link', { name: /explorer/ });
    expect(explorerLinks.length).toBeGreaterThanOrEqual(3);
    expect(explorerLinks[0].getAttribute('href')).toContain('stellar.expert');
  });

  it('lists indexed transactions with copy + explorer links', async () => {
    render(<VerificationPanel contract={CONTRACT} network={NETWORK} events={[EVENT]} />);
    expect(screen.getByText('Bounty created')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('copy-tx-evt-1'));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(EVENT.txHash));
  });

  it('shows an unconfigured state when the contract is missing', () => {
    render(
      <VerificationPanel
        contract={{ ...CONTRACT, configured: false }}
        network={NETWORK}
        events={[]}
      />,
    );
    expect(screen.getByText(/not configured/i)).toBeInTheDocument();
  });
});

// ── BountyCard ────────────────────────────────────────────────────
describe('BountyCard', () => {
  it('renders issue, amount and open status', () => {
    render(<BountyCard bounty={BOUNTY} />);
    expect(screen.getByText('repo#42')).toBeInTheDocument();
    expect(screen.getByText('250 RRD')).toBeInTheDocument();
    expect(screen.getByText('Open')).toBeInTheDocument();
  });

  it('shows released state with contributor', () => {
    const released = { ...BOUNTY, released: true, contributor: ACCOUNT.address };
    render(<BountyCard bounty={released} />);
    expect(screen.getByText('Released')).toBeInTheDocument();
    expect(screen.getAllByText(/GB2OVP…Z6E6/).length).toBeGreaterThanOrEqual(2);
  });

  it('links to the explorer for the create tx', () => {
    render(<BountyCard bounty={BOUNTY} />);
    expect(screen.getByRole('link', { name: /create tx/ }).getAttribute('href')).toContain(
      'stellar.expert',
    );
  });

  it('copies the funder address', async () => {
    render(<BountyCard bounty={BOUNTY} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Copy address' })[0]);
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(BOUNTY.funder));
  });
});

// ── BountyForm (wallet flow) ─────────────────────────────────────
describe('BountyForm', () => {
  function renderForm(overrides: Partial<{ onDone: () => void }> = {}) {
    return render(
      <BountyForm
        account={ACCOUNT}
        contract={CONTRACT}
        bounties={[BOUNTY]}
        onDone={overrides.onDone ?? (() => undefined)}
      />,
    );
  }

  it('runs the full milestone-escrow fund flow: build → sign → submit', async () => {
    vi.spyOn(api, 'buildTransaction').mockResolvedValue({
      txXdr: 'AAAA…unsigned',
      action: 'createBounty',
      networkPassphrase: 'Test SDF Network ; September 2015',
    });
    vi.spyOn(wallet, 'signTransactionXdr').mockResolvedValue('AAAA…signed');
    vi.spyOn(api, 'submitTransaction').mockResolvedValue({
      status: 'SUCCESS',
      hash: 'deadbeef',
      explorerUrl: 'https://stellar.expert/explorer/testnet/tx/deadbeef',
    });
    const onDone = vi.fn();
    renderForm({ onDone });

    fireEvent.change(screen.getByTestId('create-issue'), { target: { value: 'repo#42' } });
    fireEvent.change(screen.getByTestId('milestone-title-0'), { target: { value: 'Draft' } });
    fireEvent.change(screen.getByTestId('milestone-amount-0'), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create bounty' }));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(api.buildTransaction).toHaveBeenCalledWith('createBounty', ACCOUNT.address, {
      funder: ACCOUNT.address,
      token: CONTRACT.tokenId,
      issueId: 'repo#42',
      milestones: [
        { title: 'Draft', amount: '100' },
        { title: 'Final submission', amount: '150' },
      ],
    });
    expect(wallet.signTransactionXdr).toHaveBeenCalledWith(
      'AAAA…unsigned',
      'Test SDF Network ; September 2015',
    );
    expect(api.submitTransaction).toHaveBeenCalledWith('AAAA…signed');
    expect(screen.getByText(/Transaction confirmed/)).toBeInTheDocument();
  });

  it('lets a funder add a milestone', () => {
    vi.spyOn(api, 'buildTransaction');
    renderForm();
    fireEvent.click(screen.getByTestId('add-milestone'));
    expect(screen.getByTestId('milestone-title-2')).toBeInTheDocument();
  });

  it('claims an open bounty as the connected account', async () => {
    vi.spyOn(api, 'buildTransaction').mockResolvedValue({
      txXdr: 'AAAA…unsigned',
      action: 'claim',
      networkPassphrase: 'Test SDF Network ; September 2015',
    });
    vi.spyOn(wallet, 'signTransactionXdr').mockResolvedValue('AAAA…signed');
    vi.spyOn(api, 'submitTransaction').mockResolvedValue({
      status: 'SUCCESS',
      hash: 'cafe',
      explorerUrl: 'https://stellar.expert/explorer/testnet/tx/cafe',
    });
    renderForm();
    fireEvent.click(screen.getByRole('button', { name: 'Claim a bounty' }));
    fireEvent.click(screen.getByRole('button', { name: 'Claim bounty' }));
    await waitFor(() =>
      expect(api.buildTransaction).toHaveBeenCalledWith('claim', ACCOUNT.address, {
        issueId: 'repo#42',
        contributor: ACCOUNT.address,
      }),
    );
  });

  it('surfaces build failures', async () => {
    vi.spyOn(api, 'buildTransaction').mockRejectedValue(new Error('Simulation failed'));
    renderForm();
    fireEvent.change(screen.getByTestId('create-issue'), { target: { value: 'repo#42' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create bounty' }));
    await waitFor(() =>
      expect(screen.getByTestId('form-error')).toHaveTextContent(/Simulation failed/),
    );
  });

  it('requires an issue id and does not build a transaction when blank', () => {
    vi.spyOn(api, 'buildTransaction');
    renderForm();
    fireEvent.change(screen.getByTestId('create-issue'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create bounty' }));
    expect(screen.getByTestId('form-error')).toHaveTextContent(/required/);
    expect(api.buildTransaction).not.toHaveBeenCalled();
  });

  it('never builds a transaction for an out-of-range milestone amount', () => {
    vi.spyOn(api, 'buildTransaction');
    renderForm();
    fireEvent.change(screen.getByTestId('create-issue'), { target: { value: 'repo#42' } });
    // The number input enforces min=1 natively, so the browser blocks submit.
    fireEvent.change(screen.getByTestId('milestone-amount-0'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create bounty' }));
    expect(api.buildTransaction).not.toHaveBeenCalled();
  });

  it('rejects a milestone with no title', () => {
    vi.spyOn(api, 'buildTransaction');
    renderForm();
    fireEvent.change(screen.getByTestId('create-issue'), { target: { value: 'repo#42' } });
    fireEvent.change(screen.getByTestId('milestone-title-0'), { target: { value: '  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create bounty' }));
    expect(screen.getByTestId('form-error')).toHaveTextContent(/needs a title/);
    expect(api.buildTransaction).not.toHaveBeenCalled();
  });
});

// ── EventsFeed ────────────────────────────────────────────────────
describe('EventsFeed', () => {
  it('renders events with explorer links', () => {
    render(<EventsFeed events={[EVENT]} />);
    expect(screen.getByText('Bounty created')).toBeInTheDocument();
    expect(screen.getByText('repo#42')).toBeInTheDocument();
    expect(screen.getByRole('link').getAttribute('href')).toContain('stellar.expert');
  });

  it('copies the tx hash', async () => {
    render(<EventsFeed events={[EVENT]} />);
    fireEvent.click(screen.getByTestId('copy-tx-evt-1'));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(EVENT.txHash));
  });

  it('shows an empty state', () => {
    render(<EventsFeed events={[]} />);
    expect(screen.getByText(/no contract events/i)).toBeInTheDocument();
  });
});

// ── PolicyPanel ───────────────────────────────────────────────────
describe('PolicyPanel', () => {
  it('renders analytics tiles, timeline, heat map and policy items', () => {
    render(<PolicyPanel policies={[POLICY]} analytics={ANALYTICS} />);
    expect(screen.getByText('20')).toBeInTheDocument();
    expect(screen.getByText('42.5')).toBeInTheDocument();
    expect(screen.getByText(/Policy timeline/)).toBeInTheDocument();
    expect(screen.getByText(/Jurisdiction risk heat map/)).toBeInTheDocument();
    expect(screen.getByText(/Ecosystem impact areas/)).toBeInTheDocument();
    expect(screen.getByText(/Project-survival signals/)).toBeInTheDocument();
    expect(screen.getByText(/EU MiCA stablecoin rules apply/)).toBeInTheDocument();
    expect(screen.getByText('sev 4')).toBeInTheDocument();
  });

  it('renders impact and survival chips on policy items', () => {
    render(<PolicyPanel policies={[POLICY]} analytics={ANALYTICS} />);
    // Impact area appears in the aggregate list and on the policy chip.
    expect(screen.getAllByText('Stablecoin issuers').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('Licensing requirements').length).toBeGreaterThanOrEqual(2);
  });

  it('renders without analytics', () => {
    render(<PolicyPanel policies={[POLICY]} analytics={null} />);
    expect(screen.getByText(/EU MiCA stablecoin rules apply/)).toBeInTheDocument();
  });
});

// ── HeroSection ───────────────────────────────────────────────────
describe('HeroSection', () => {
  it('describes the Soroban bounty platform without placeholder claims', () => {
    render(<HeroSection />);
    expect(screen.getByText(/Regulatory resilience, funded on-chain/)).toBeInTheDocument();
    expect(screen.queryByText(/Drips Wave 5/i)).not.toBeInTheDocument();
  });
});

// ── App (dashboard shell) ─────────────────────────────────────────
describe('App', () => {
  /** Mock the v2 panels so the dashboard test never touches the network. */
  function mockSecondaryPanels() {
    vi.spyOn(api, 'getMilestones').mockResolvedValue({
      issueId: 'repo#42',
      onChainVerified: true,
      source: 'stellar',
      quorum: 1,
      reviewers: [],
      milestones: [
        {
          index: 0,
          title: 'Draft',
          amount: '100',
          settled: false,
          releasedTx: null,
          releasedUrl: null,
        },
      ],
      releasedAmount: '0',
      disputed: false,
      disputes: [],
    });
    vi.spyOn(api, 'getSigners').mockResolvedValue({
      signers: CONTRACT.signers,
      threshold: CONTRACT.signerThreshold,
    });
    vi.spyOn(api, 'getProposals').mockResolvedValue([]);
    vi.spyOn(api, 'getReputationLeaderboard').mockResolvedValue({
      generatedAt: '2026-05-16T00:00:00Z',
      total: 0,
      entries: [],
    });
    vi.spyOn(api, 'getJurisdictions').mockResolvedValue([]);
    vi.spyOn(api, 'getRegulationVersions').mockResolvedValue([]);
    vi.spyOn(api, 'getAlerts').mockResolvedValue([]);
  }

  it('shows a skeleton while loading', () => {
    vi.spyOn(api, 'getNetworkStatus').mockReturnValue(new Promise(() => undefined));
    vi.spyOn(api, 'getContractInfo').mockReturnValue(new Promise(() => undefined));
    vi.spyOn(api, 'getBounties').mockReturnValue(new Promise(() => undefined));
    vi.spyOn(api, 'getEvents').mockReturnValue(new Promise(() => undefined));
    vi.spyOn(api, 'getPolicies').mockReturnValue(new Promise(() => undefined));
    vi.spyOn(api, 'getAnalytics').mockReturnValue(new Promise(() => undefined));
    render(<App />);
    expect(screen.getByTestId('loading')).toBeInTheDocument();
  });

  it('renders the full dashboard with verification panel when data loads', async () => {
    vi.spyOn(api, 'getNetworkStatus').mockResolvedValue(NETWORK);
    vi.spyOn(api, 'getContractInfo').mockResolvedValue(CONTRACT);
    vi.spyOn(api, 'getBounties').mockResolvedValue([BOUNTY]);
    vi.spyOn(api, 'getEvents').mockResolvedValue([EVENT]);
    vi.spyOn(api, 'getPolicies').mockResolvedValue([POLICY]);
    vi.spyOn(api, 'getAnalytics').mockResolvedValue(ANALYTICS);
    mockSecondaryPanels();
    render(<App />);
    await waitFor(() => expect(screen.getByText(/On-chain verification/)).toBeInTheDocument());
    expect(screen.getByText('Bounties on-chain')).toBeInTheDocument();
    expect(screen.getByText(/Contract events/)).toBeInTheDocument();
    // Every v2 feature has a first-class section in the dashboard shell.
    expect(screen.getByText(/Milestone escrow/)).toBeInTheDocument();
    expect(screen.getByText('Multisig administration')).toBeInTheDocument();
    expect(screen.getByText('Jurisdiction comparison')).toBeInTheDocument();
    expect(screen.getByText(/Regulation change detection/)).toBeInTheDocument();
    expect(screen.getByText(/Contributor & reviewer reputation/)).toBeInTheDocument();
  });

  it('renders the sections it can when one endpoint fails (no total blank-out)', async () => {
    vi.spyOn(api, 'getNetworkStatus').mockResolvedValue(NETWORK);
    vi.spyOn(api, 'getContractInfo').mockResolvedValue(CONTRACT);
    vi.spyOn(api, 'getBounties').mockResolvedValue([BOUNTY]);
    vi.spyOn(api, 'getEvents').mockResolvedValue([EVENT]);
    vi.spyOn(api, 'getPolicies').mockResolvedValue([POLICY]);
    vi.spyOn(api, 'getAnalytics').mockRejectedValue(new Error('Horizon unreachable'));
    mockSecondaryPanels();
    render(<App />);
    await waitFor(() => expect(screen.getByText('Bounties on-chain')).toBeInTheDocument());
    expect(screen.getByTestId('partial-error')).toHaveTextContent(/Some sections could not load/);
  });
});
