import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import NavBar from '../components/NavBar';
import HeroSection from '../components/HeroSection';
import NetworkStatusCard from '../components/NetworkStatusCard';
import WalletButton from '../components/WalletButton';
import BountyCard from '../components/BountyCard';
import BountyForm from '../components/BountyForm';
import EventsFeed from '../components/EventsFeed';
import PolicyPanel from '../components/PolicyPanel';
import * as api from '../lib/api';
import * as wallet from '../lib/wallet';
import type { Bounty, ContractEvent, PolicyRecord, AnalyticsSnapshot } from '../lib/types';
import type { WalletAccount } from '../lib/wallet';

const ACCOUNT: WalletAccount = {
  address: 'GBRVOQSLP32BGOCYA56DCTM5PUQWW7YLBBAKVXBHDTJ6SNKVLGMWFRQI',
};

const BOUNTY: Bounty = {
  issueId: 'repo#42',
  funder: 'GBRVOQSLP32BGOCYA56DCTM5PUQWW7YLBBAKVXBHDTJ6SNKVLGMWFRQI',
  contributor: null,
  token: 'CCOAF5DIHLO4457S6EGQYSLXGGDRQPTO42DU6N5KVH4M2MSA2VDW2NB4',
  amount: '250',
  released: false,
  createdTx: 'abc123',
  releasedTx: null,
  updatedAt: '2026-05-16T00:00:00Z',
  createdUrl: 'https://stellar.expert/explorer/testnet/tx/abc123',
  releasedUrl: null,
};

const EVENT: ContractEvent = {
  id: 1,
  txHash: 'abc123def456',
  ledger: 19695405,
  contractId: 'CC2YEX6U7HV7L7L45HVOLVWGN2POARLPS3XICZS6KQH5Y52OTAHK7LVY',
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
};

const ANALYTICS: AnalyticsSnapshot = {
  generatedAt: '2026-05-16T00:00:00Z',
  totals: { events: 20, jurisdictions: 8, categories: 6, averageSeverity: 3.1 },
  riskIndex: 42.5,
  byJurisdiction: { EU: 5 },
  byCategory: { 'stablecoin-regulation': 4 },
  bySeverity: { 4: 3 },
  byYear: { 2025: 20 },
};

beforeEach(() => {
  vi.restoreAllMocks();
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
    expect(screen.getByText(/GBRVOQ…FRQI/)).toBeInTheDocument();
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
    const status = {
      network: 'Test SDF Network ; September 2015',
      horizon: 'https://horizon-testnet.stellar.org',
      protocolVersion: '22',
      latestLedger: '50000000',
      closedAt: '2026-05-16T14:00:00Z',
    };
    render(<NetworkStatusCard status={status} error={false} />);
    expect(screen.getByText('v22')).toBeInTheDocument();
    expect(screen.getByText('#50000000')).toBeInTheDocument();
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
    expect(screen.getAllByText(/GBRVOQ…FRQI/).length).toBeGreaterThanOrEqual(2);
  });

  it('links to the explorer for the create tx', () => {
    render(<BountyCard bounty={BOUNTY} />);
    expect(screen.getByRole('link', { name: /create tx/ }).getAttribute('href')).toContain(
      'stellar.expert',
    );
  });
});

// ── BountyForm (wallet flow) ─────────────────────────────────────
describe('BountyForm', () => {
  it('runs the full create flow: build → sign → submit', async () => {
    vi.spyOn(api, 'buildTransaction').mockResolvedValue({
      txXdr: 'AAAA…unsigned',
      action: 'create',
      networkPassphrase: 'Test SDF Network ; September 2015',
    });
    vi.spyOn(wallet, 'signTransactionXdr').mockResolvedValue('AAAA…signed');
    vi.spyOn(api, 'submitTransaction').mockResolvedValue({
      status: 'SUCCESS',
      hash: 'deadbeef',
      explorerUrl: 'https://stellar.expert/explorer/testnet/tx/deadbeef',
    });
    const onDone = vi.fn();
    render(<BountyForm account={ACCOUNT} bounties={[BOUNTY]} onDone={onDone} />);

    fireEvent.change(screen.getByTestId('create-issue'), { target: { value: 'repo#42' } });
    fireEvent.change(screen.getByTestId('create-amount'), { target: { value: '250' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create bounty' }));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(api.buildTransaction).toHaveBeenCalledWith('create', ACCOUNT.address, {
      issueId: 'repo#42',
      amount: '250',
    });
    expect(wallet.signTransactionXdr).toHaveBeenCalledWith(
      'AAAA…unsigned',
      'Test SDF Network ; September 2015',
    );
    expect(api.submitTransaction).toHaveBeenCalledWith('AAAA…signed');
    expect(screen.getByText(/Transaction confirmed/)).toBeInTheDocument();
  });

  it('requires a valid contributor address for release', async () => {
    vi.spyOn(api, 'buildTransaction');
    render(<BountyForm account={ACCOUNT} bounties={[BOUNTY]} onDone={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'Release a bounty' }));
    fireEvent.change(screen.getByTestId('release-contributor'), {
      target: { value: 'not-an-address' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Release bounty' }));
    expect(screen.getByTestId('form-error')).toHaveTextContent(/valid Stellar G… address/);
    expect(api.buildTransaction).not.toHaveBeenCalled();
  });

  it('surfaces build failures', async () => {
    vi.spyOn(api, 'buildTransaction').mockRejectedValue(new Error('Simulation failed'));
    render(<BountyForm account={ACCOUNT} bounties={[BOUNTY]} onDone={() => undefined} />);
    fireEvent.change(screen.getByTestId('create-issue'), { target: { value: 'repo#42' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create bounty' }));
    await waitFor(() =>
      expect(screen.getByTestId('form-error')).toHaveTextContent(/Simulation failed/),
    );
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

  it('shows an empty state', () => {
    render(<EventsFeed events={[]} />);
    expect(screen.getByText(/no contract events/i)).toBeInTheDocument();
  });
});

// ── PolicyPanel ───────────────────────────────────────────────────
describe('PolicyPanel', () => {
  it('renders analytics and policy items', () => {
    render(<PolicyPanel policies={[POLICY]} analytics={ANALYTICS} />);
    expect(screen.getByText('20')).toBeInTheDocument();
    expect(screen.getByText('42.5')).toBeInTheDocument();
    expect(screen.getByText(/EU MiCA stablecoin rules apply/)).toBeInTheDocument();
    expect(screen.getByText('sev 4')).toBeInTheDocument();
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
