import { useCallback, useEffect, useState } from 'react';
import {
  acknowledgeAlert,
  getAlerts,
  getPolicyVersions,
  getRegulationDiff,
  getRegulationVersions,
} from '../lib/api';
import type { RegulationAlert, RegulationDiff, RegulationVersion } from '../lib/types';

function formatChange(value: string | number | string[]): string {
  if (Array.isArray(value)) return value.join(', ') || '—';
  return String(value);
}

/**
 * Regulation change detection and version history.
 *
 * The ingestion pipeline hashes each policy record; when a monitored source
 * changes it writes a new immutable revision and raises an alert. This panel
 * surfaces both so a researcher can audit exactly what changed, when, and from
 * which source — and acknowledge alerts once reviewed.
 */
export default function RegulationHistoryPanel() {
  const [versions, setVersions] = useState<RegulationVersion[]>([]);
  const [alerts, setAlerts] = useState<RegulationAlert[]>([]);
  const [selectedPolicy, setSelectedPolicy] = useState<string | null>(null);
  const [diff, setDiff] = useState<RegulationDiff | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const [versionRes, alertRes] = await Promise.allSettled([
      getRegulationVersions(50),
      getAlerts({ limit: 30 }),
    ]);
    if (versionRes.status === 'fulfilled') setVersions(versionRes.value);
    if (alertRes.status === 'fulfilled') setAlerts(alertRes.value);
    if (versionRes.status === 'rejected' && alertRes.status === 'rejected') {
      setError('Could not load regulation history from the backend.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const showHistory = useCallback(async (policyId: string) => {
    setSelectedPolicy(policyId);
    setDiff(null);
    try {
      const history = await getPolicyVersions(policyId);
      if (history.length >= 2) {
        const latest = history[history.length - 1];
        const previous = history[history.length - 2];
        setDiff(await getRegulationDiff(policyId, previous.version, latest.version));
      }
    } catch {
      setDiff(null);
    }
  }, []);

  async function ack(id: string) {
    try {
      await acknowledgeAlert(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to acknowledge alert');
    }
  }

  return (
    <div className="panel" data-testid="regulation-history-panel">
      <p className="subheading">Change alerts</p>
      {alerts.length === 0 ? (
        <p className="empty-note">No regulation changes detected yet.</p>
      ) : (
        <ul className="alert-list">
          {alerts.map((a) => (
            <li
              key={a.id}
              className={`alert alert-${a.severity} ${a.acknowledged ? 'acknowledged' : ''}`}
              data-testid={`alert-${a.id}`}
            >
              <div className="alert-head">
                <span className={`badge badge-alert-${a.severity}`}>{a.severity}</span>
                <strong>{a.title}</strong>
                {a.acknowledged && <span className="muted">acknowledged</span>}
              </div>
              <p className="muted">{a.message}</p>
              <div className="action-row">
                {a.sourceUrl && (
                  <a href={a.sourceUrl} target="_blank" rel="noreferrer">
                    source ↗
                  </a>
                )}
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={() => void showHistory(a.policyId)}
                >
                  View history
                </button>
                {!a.acknowledged && (
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    data-testid={`ack-${a.id}`}
                    onClick={() => void ack(a.id)}
                  >
                    Acknowledge
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="subheading">Recent revisions</p>
      {versions.length === 0 ? (
        <p className="empty-note">No revisions recorded yet.</p>
      ) : (
        <table className="events-table">
          <thead>
            <tr>
              <th>Policy</th>
              <th>Rev</th>
              <th>Type</th>
              <th>Jurisdiction</th>
              <th>Severity</th>
              <th>Detected</th>
              <th>Source</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {versions.map((v) => (
              <tr key={v.id} data-testid={`version-${v.id}`}>
                <td>{v.policyId}</td>
                <td>v{v.version}</td>
                <td>{v.changeType}</td>
                <td>{v.jurisdiction}</td>
                <td>{v.severity}</td>
                <td>{new Date(v.detectedAt).toLocaleDateString()}</td>
                <td>
                  <a href={v.sourceUrl} target="_blank" rel="noreferrer">
                    link ↗
                  </a>
                </td>
                <td>
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    onClick={() => void showHistory(v.policyId)}
                  >
                    History
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {selectedPolicy && (
        <div className="diff-box" data-testid="regulation-diff">
          <p className="subheading">Latest change — {selectedPolicy}</p>
          {diff ? (
            <>
              <p className="muted">
                v{diff.from.version} → v{diff.to.version} ·{' '}
                {diff.changes.length === 0 ? 'no field changes' : `${diff.changes.length} field(s)`}
              </p>
              {diff.changes.length > 0 && (
                <table className="events-table">
                  <thead>
                    <tr>
                      <th>Field</th>
                      <th>Before</th>
                      <th>After</th>
                    </tr>
                  </thead>
                  <tbody>
                    {diff.changes.map((c) => (
                      <tr key={c.field}>
                        <td>{c.field}</td>
                        <td className="muted">{formatChange(c.from)}</td>
                        <td>{formatChange(c.to)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          ) : (
            <p className="empty-note">
              Only one revision exists for this policy, so there is nothing to diff yet.
            </p>
          )}
        </div>
      )}

      {error && (
        <p className="form-error" data-testid="regulation-history-error">
          {error}
        </p>
      )}
    </div>
  );
}
