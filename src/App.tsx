import { useCallback, useEffect, useState } from 'react';
import NavBar from './components/NavBar';
import HeroSection from './components/HeroSection';
import NetworkStatusCard from './components/NetworkStatusCard';
import BountyCard from './components/BountyCard';
import BountyForm from './components/BountyForm';
import EventsFeed from './components/EventsFeed';
import PolicyPanel from './components/PolicyPanel';
import ContributorCTA from './components/ContributorCTA';
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
    try {
      const [networkData, contractData, bountyData, eventData, policyData, analyticsData] =
        await Promise.all([
          api.getNetworkStatus(),
          api.getContractInfo(),
          api.getBounties(),
          api.getEvents(50),
          api.getPolicies(),
          api.getAnalytics(),
        ]);
      setNetwork(networkData);
      setContract(contractData);
      setBounties(bountyData);
      setEvents(eventData);
      setPolicies(policyData);
      setAnalytics(analyticsData);
      setState('ready');
    } catch (err) {
      setState('error');
      setError(err instanceof Error ? err.message : 'Failed to load dashboard data');
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

        {state === 'loading' && (
          <div className="state-box" data-testid="loading">
            <span className="pulse" /> Loading data from the backend…
          </div>
        )}
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
            <NetworkStatusCard status={network} error={false} />

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
                <BountyForm account={account} bounties={bounties} onDone={refresh} />
              ) : (
                <div className="state-box">
                  Connect Freighter (top-right) to fund bounties or release rewards.
                </div>
              )}
            </section>

            <section id="events">
              <p className="section-heading">Contract events (from Stellar Testnet)</p>
              <EventsFeed events={events} />
            </section>

            <section id="regulatory">
              <p className="section-heading">Regulatory dataset (ingested + validated)</p>
              <PolicyPanel policies={policies} analytics={analytics} />
            </section>

            <ContributorCTA />
          </>
        )}
      </div>
    </>
  );
}
