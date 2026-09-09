import type { NetworkStatus } from '../lib/types';

type Props = { status: NetworkStatus | null; error: boolean };

export default function NetworkStatusCard({ status, error }: Props) {
  const dotClass = error ? 'error' : status ? 'live' : 'loading';

  return (
    <section className="network-card" id="network">
      <div className="network-card-header">
        <span className={`status-dot ${dotClass}`} />
        <h2>Stellar Horizon · Live Network Status</h2>
      </div>
      {error ? (
        <p className="network-error">
          Unable to reach Horizon — check your connection or VITE_HORIZON_URL.
        </p>
      ) : !status ? (
        <p style={{ color: 'var(--muted)', fontSize: '0.875rem' }}>Connecting to Horizon…</p>
      ) : (
        <div className="network-grid">
          <div className="network-stat">
            <div className="network-stat-label">Network</div>
            <div className="network-stat-value">{status.network}</div>
          </div>
          <div className="network-stat">
            <div className="network-stat-label">Protocol version</div>
            <div className="network-stat-value">v{status.protocolVersion}</div>
          </div>
          <div className="network-stat">
            <div className="network-stat-label">Latest ledger</div>
            <div className="network-stat-value">#{status.latestLedger}</div>
          </div>
          <div className="network-stat">
            <div className="network-stat-label">Horizon endpoint</div>
            <div className="network-stat-value">{status.horizon}</div>
          </div>
        </div>
      )}
    </section>
  );
}
