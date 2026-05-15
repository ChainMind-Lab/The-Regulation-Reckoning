import { useEffect, useState } from 'react';
import SectionCard from './components/SectionCard';
import NetworkStatusCard from './components/NetworkStatusCard';
import stellarTopics from './data/policyTopics';
import { getNetworkStatus, type NetworkStatus } from './lib/stellar';

function App() {
  const [networkStatus, setNetworkStatus] = useState<NetworkStatus | null>(null);

  useEffect(() => {
    getNetworkStatus()
      .then(setNetworkStatus)
      .catch(() =>
        setNetworkStatus({ network: 'Unknown', horizon: 'Unavailable', protocolVersion: 'unknown' })
      );
  }, []);

  return (
    <main className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">The Regulation Reckoning</p>
          <h1>Stellar policy signals and network health for Web3 builders</h1>
          <p>
            A Stellar-focused platform for tracking regulation, on-chain metrics, and
            ecosystem resilience across the broader Web3 landscape.
          </p>
        </div>
      </header>

      <NetworkStatusCard status={networkStatus} />

      <section className="section-grid">
        {stellarTopics.map((topic) => (
          <SectionCard key={topic.id} topic={topic} />
        ))}
      </section>

      <section className="callout">
        <h2>Contributor pathways</h2>
        <p>
          Contributors can help build Stellar network integrations, add policy
          signals, refine analytics, or author research narratives grounded in
          on-chain data.
        </p>
      </section>
    </main>
  );
}

export default App;
