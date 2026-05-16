import { useEffect, useState } from 'react';
import NavBar from './components/NavBar';
import HeroSection from './components/HeroSection';
import WaveBanner from './components/WaveBanner';
import NetworkStatusCard from './components/NetworkStatusCard';
import IssueCard from './components/IssueCard';
import TopicCard from './components/TopicCard';
import ContributorCTA from './components/ContributorCTA';
import waveInfo from './data/waveInfo';
import openIssues from './data/openIssues';
import policyTopics from './data/policyTopics';
import { getNetworkStatus, type NetworkStatus } from './lib/stellar';

export default function App() {
  const [status, setStatus] = useState<NetworkStatus | null>(null);
  const [networkError, setNetworkError] = useState(false);

  useEffect(() => {
    getNetworkStatus()
      .then((s) => { setStatus(s); setNetworkError(false); })
      .catch(() => setNetworkError(true));
  }, []);

  return (
    <>
      <NavBar />
      <div className="page">
        <HeroSection />
        <WaveBanner wave={waveInfo} />
        <NetworkStatusCard status={status} error={networkError} />

        <section id="issues">
          <div className="section-row">
            <p className="section-heading">Open bounties · Wave 5</p>
            <a
              className="section-link"
              href="https://www.drips.network/wave/stellar/issues"
              target="_blank"
              rel="noreferrer"
            >
              View all 74k+ issues →
            </a>
          </div>
          <div className="card-grid-2">
            {openIssues.map((issue) => (
              <IssueCard key={issue.id} issue={issue} />
            ))}
          </div>
        </section>

        <section id="topics">
          <p className="section-heading">Research topics</p>
          <div className="card-grid">
            {policyTopics.map((topic) => (
              <TopicCard key={topic.id} topic={topic} />
            ))}
          </div>
        </section>

        <ContributorCTA />
      </div>
    </>
  );
}
