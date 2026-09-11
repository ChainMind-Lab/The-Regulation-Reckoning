import { useCallback, useEffect, useState } from 'react';
import NavBar from './components/NavBar';
import HeroSection from './components/HeroSection';
import NetworkStatusCard from './components/NetworkStatusCard';
import VerificationPanel from './components/VerificationPanel';
import BountyCard from './components/BountyCard';
import BountyForm from './components/BountyForm';
import EventsFeed from './components/EventsFeed';
import PolicyPanel from './components/PolicyPanel';
import ContributorCTA from './components/ContributorCTA';
import MilestonePanel from './components/MilestonePanel';
import GovernancePanel from './components/GovernancePanel';
import ReputationPanel from './components/ReputationPanel';
import JurisdictionPanel from './components/JurisdictionPanel';
import RegulationHistoryPanel from './components/RegulationHistoryPanel';
import * as api from './lib/api';
import type { WalletAccount } from './lib/wallet';
import type {
  AnalyticsSnapshot,
  Bounty,
  ContractEvent,
  ContractInfo,
  NetworkStatus,
  PolicyRecord,
} from './lib/types';

type LoadState = 'loading' | 'ready' | 'error';

function Skeleton() {
  return (
    <div className="skeleton-stack" data-testid="loading">
      <div className="skeleton skeleton-wide" />
      <div className="skeleton skeleton-grid">
        <div className="skeleton" />
        <div className="skeleton" />
      </div>
      <div className="skeleton" />
      <div className="skeleton" />
      <div className="skeleton" />
    </div>
  );
}

export default function App() {
  const [account, setAccount] = useState<WalletAccount | null>(null);
  const [network, setNetwork] = useState<NetworkStatus | null>(null);
  const [contract, setContract] = useState<ContractInfo | null>(null);
  const [bounties, setBounties] = useState<Bounty[]>([]);
  const [events, setEvents] = useState<ContractEvent[]>([]);
  const [policies, setPolicies] = useState<PolicyRecord[]>([]);
  const [analytics, setAnalytics] = useState<AnalyticsSnapshot | null>(null);
  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setState('loading');
    setError(null);
    // Load every section independently: a transient failure in one upstream
    // (e.g. Horizon) must not blank the whole dashboard. We only show the
    // blocking error state when nothing at all could be loaded.
    const [networkRes, contractRes, bountyRes, eventRes, policyRes, analyticsRes] =
      await Promise.allSettled([
        api.getNetworkStatus(),
        api.getContractInfo(),
        api.getBounties(),
        api.getEvents(50),
        api.getPolicies(),
        api.getAnalytics(),
      ]);

    const results = [networkRes, contractRes, bountyRes, eventRes, policyRes, analyticsRes];
    if (networkRes.status === 'fulfilled') setNetwork(networkRes.value);
    if (contractRes.status === 'fulfilled') setContract(contractRes.value);
    if (bountyRes.status === 'fulfilled') setBounties(bountyRes.value);
    if (eventRes.status === 'fulfilled') setEvents(eventRes.value);
    if (policyRes.status === 'fulfilled') setPolicies(policyRes.value);
    if (analyticsRes.status === 'fulfilled') setAnalytics(analyticsRes.value);

    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length === results.length) {
      const first = failed[0] as PromiseRejectedResult;
      setState('error');
      setError(
        first.reason instanceof Error ? first.reason.message : 'Failed to load dashboard data',
      );
      return;
    }

    setState('ready');
    if (failed.length > 0) {
      setError(
        `Some sections could not load (${failed.length}/${results.length}). ` +
          'Data shown below may be incomplete — retry in a moment.',
      );
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const refresh = useCallback(() => {
    void loadAll();
  }, [loadAll]);

  return (
    <>
      <NavBar account={account} onConnect={setAccount} onDisconnect={() => setAccount(null)} />
      <div className="page">
        <HeroSection />

        {state === 'loading' && <Skeleton />}
        {state === 'error' && (
          <div className="state-box error" data-testid="load-error">
            <p>{error}</p>
            <p className="state-hint">
              Is the backend running? Start it with <code>npm run dev</code> in{' '}
              <code>backend/</code>, then reload.
            </p>
            <button type="button" className="btn btn-outline btn-sm" onClick={refresh}>
              Retry
            </button>
          </div>
        )}

        {state === 'ready' && (
          <>
            {error && (
              <div className="state-box warning" data-testid="partial-error">
                <p>{error}</p>
                <button type="button" className="btn btn-outline btn-sm" onClick={refresh}>
                  Retry
                </button>
              </div>
            )}

            <NetworkStatusCard status={network} error={false} />

            <VerificationPanel contract={contract} network={network} events={events} />

            <section id="bounties">
              <div className="section-row">
                <p className="section-heading">Bounties on-chain</p>
                {contract && (
                  <span className="section-link contract-id" title={contract.contractId ?? ''}>
                    contract {contract.contractId?.slice(0, 12)}…
                  </span>
                )}
              </div>
              <div className="card-grid-2">
                {bounties.length === 0 ? (
                  <p className="empty-note">No bounties yet — fund the first one below.</p>
                ) : (
                  bounties.map((b) => <BountyCard key={b.issueId} bounty={b} />)
                )}
              </div>
            </section>

            <section id="fund">
              <p className="section-heading">Fund or release a bounty</p>
              {account ? (
                <BountyForm
                  account={account}
                  contract={contract}
                  bounties={bounties}
                  onDone={refresh}
                />
              ) : (
                <div className="state-box">
                  Connect Freighter (top-right) to fund bounties, claim work, or approve releases.
                </div>
              )}
            </section>

            <section id="milestones">
              <p className="section-heading">Milestone escrow, reviews &amp; disputes</p>
              <p className="section-subheading">
                Releases, reviewer decisions and dispute votes are all on-chain actions.
              </p>
              <MilestonePanel
                account={account}
                contract={contract}
                bounties={bounties}
                onDone={refresh}
              />
            </section>

            <section id="governance">
              <p className="section-heading">Multisig administration</p>
              <p className="section-subheading">
                Privileged operations execute once the signer threshold is reached.
              </p>
              <GovernancePanel account={account} contract={contract} onDone={refresh} />
            </section>

            <section id="events">
              <p className="section-heading">Contract events (from Stellar Testnet)</p>
              <EventsFeed events={events} />
            </section>

            <section id="regulatory">
              <p className="section-heading">Regulatory dataset (ingested + validated)</p>
              <PolicyPanel policies={policies} analytics={analytics} />
            </section>

            <section id="jurisdictions">
              <p className="section-heading">Jurisdiction comparison</p>
              <p className="section-subheading">
                Compare regulatory requirements across jurisdictions, traceable to primary sources.
              </p>
              <JurisdictionPanel />
            </section>

            <section id="regulation-history">
              <p className="section-heading">Regulation change detection &amp; version history</p>
              <p className="section-subheading">
                Every revision is hashed and retained so you can audit what changed and when.
              </p>
              <RegulationHistoryPanel />
            </section>

            <section id="reputation">
              <p className="section-heading">Contributor &amp; reviewer reputation</p>
              <p className="section-subheading">
                Reputation is derived from on-chain payouts, reviews and disputes.
              </p>
              <ReputationPanel account={account} />
            </section>

            <ContributorCTA />
          </>
        )}
      </div>
    </>
  );
}
