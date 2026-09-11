import { useCallback, useEffect, useState } from 'react';
import { getReputation, getReputationLeaderboard } from '../lib/api';
import { shortAddress } from '../lib/tx';
import type { Reputation, ReputationLeaderboard, ReputationView } from '../lib/types';

type Props = {
  account: { address: string } | null;
};

/**
 * Verifiable contributor/reviewer reputation.
 *
 * The score is derived from on-chain activity the registry itself records —
 * completed payouts, reviews that were upheld, and disputes opened or lost —
 * so it cannot be inflated by off-chain self-reporting. The panel shows the
 * live on-chain figure next to the indexed mirror, which is what makes the
 * number auditable.
 */
export default function ReputationPanel({ account }: Props) {
  const [address, setAddress] = useState(account?.address ?? '');
  const [view, setView] = useState<ReputationView | null>(null);
  const [board, setBoard] = useState<ReputationLeaderboard | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!address && account?.address) setAddress(account.address);
  }, [account, address]);

  const loadBoard = useCallback(async () => {
    try {
      setBoard(await getReputationLeaderboard(10));
    } catch {
      setBoard(null);
    }
  }, []);

  useEffect(() => {
    void loadBoard();
  }, [loadBoard]);

  const lookup = useCallback(async (value: string) => {
    if (!value) return;
    setLoading(true);
    setError(null);
    try {
      setView(await getReputation(value));
    } catch (err) {
      setView(null);
      setError(err instanceof Error ? err.message : 'Lookup failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (account?.address) void lookup(account.address);
  }, [account, lookup]);

  const entries: Reputation[] = board?.entries ?? [];

  return (
    <div className="panel" data-testid="reputation-panel">
      <div className="panel-controls">
        <label className="form-field">
          <span>Contributor / reviewer address</span>
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="G…"
            data-testid="reputation-address"
          />
        </label>
        <button
          type="button"
          className="btn btn-outline btn-sm"
          onClick={() => void lookup(address)}
          disabled={loading || !address}
        >
          Look up
        </button>
      </div>

      {loading && <p className="empty-note">Loading reputation…</p>}
      {error && (
        <p className="form-error" data-testid="reputation-error">
          {error}
        </p>
      )}

      {view?.reputation && (
        <div className="reputation-card" data-testid="reputation-card">
          <div className="reputation-score">
            <span className="reputation-value" data-testid="reputation-score">
              {view.reputation.score}
            </span>
            <span className={`badge badge-${view.reputation.tier}`}>{view.reputation.tier}</span>
          </div>
          <dl className="reputation-stats">
            <div>
              <dt>Payouts</dt>
              <dd>{view.reputation.payouts}</dd>
            </div>
            <div>
              <dt>Paid out</dt>
              <dd>{view.reputation.payoutTotal} RRD</dd>
            </div>
            <div>
              <dt>Reviews upheld</dt>
              <dd>{view.reputation.reviewsUpheld}</dd>
            </div>
            <div>
              <dt>Disputes opened</dt>
              <dd>{view.reputation.disputesOpened}</dd>
            </div>
            <div>
              <dt>Disputes lost</dt>
              <dd>{view.reputation.disputesLost}</dd>
            </div>
          </dl>
          <p className="state-hint">
            {view.onChain
              ? 'Verified against the reputation registry on Stellar.'
              : 'On-chain registry unavailable — showing the indexed mirror.'}
          </p>
        </div>
      )}

      <p className="subheading">Top contributors</p>
      {entries.length === 0 ? (
        <p className="empty-note">No reputation has been recorded yet.</p>
      ) : (
        <table className="events-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Address</th>
              <th>Score</th>
              <th>Tier</th>
              <th>Payouts</th>
              <th>Reviews upheld</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry, i) => (
              <tr key={entry.address} data-testid={`leaderboard-${entry.address}`}>
                <td>{i + 1}</td>
                <td>
                  <code className="contract-id" title={entry.address}>
                    {shortAddress(entry.address, 6)}
                  </code>
                </td>
                <td>{entry.score}</td>
                <td>
                  <span className={`badge badge-${entry.tier}`}>{entry.tier}</span>
                </td>
                <td>{entry.payouts}</td>
                <td>{entry.reviewsUpheld}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
