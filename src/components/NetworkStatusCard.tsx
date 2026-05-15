import type { NetworkStatus } from '../lib/stellar';

type Props = {
  status: NetworkStatus | null;
};

export default function NetworkStatusCard({ status }: Props) {
  return (
    <section className="status-card">
      <h2>Stellar Horizon network status</h2>
      {status ? (
        <div>
          <p>
            <strong>Network:</strong> {status.network}
          </p>
          <p>
            <strong>Protocol:</strong> {status.protocolVersion}
          </p>
          <p>
            <strong>Horizon endpoint:</strong> {status.horizon}
          </p>
        </div>
      ) : (
        <p>Loading network status…</p>
      )}
    </section>
  );
}
