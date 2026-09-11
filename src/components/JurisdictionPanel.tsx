import { useCallback, useEffect, useState } from 'react';
import { compareJurisdictions, getJurisdictions } from '../lib/api';
import type { ComparisonResult, JurisdictionSummary } from '../lib/types';

/**
 * Jurisdiction comparison.
 *
 * Every cell is backed by the structured policy records ingested from the
 * regulatory dataset, and each cell carries the source references that produced
 * it, so a comparison is traceable back to primary sources rather than being a
 * hand-entered table.
 */
export default function JurisdictionPanel() {
  const [summaries, setSummaries] = useState<JurisdictionSummary[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [result, setResult] = useState<ComparisonResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getJurisdictions()
      .then((rows) => {
        setSummaries(rows);
        setSelected(rows.slice(0, 3).map((r) => r.jurisdiction));
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Failed to load jurisdictions'),
      );
  }, []);

  const compare = useCallback(async (ids: string[]) => {
    if (ids.length < 2) {
      setResult(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setResult(await compareJurisdictions(ids));
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : 'Comparison failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void compare(selected);
  }, [selected, compare]);

  function toggle(id: string) {
    setSelected((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    );
  }

  return (
    <div className="panel" data-testid="jurisdiction-panel">
      <div className="jurisdiction-picker">
        {summaries.map((s) => (
          <label key={s.jurisdiction} className="check-chip">
            <input
              type="checkbox"
              checked={selected.includes(s.jurisdiction)}
              onChange={() => toggle(s.jurisdiction)}
              data-testid={`jurisdiction-${s.jurisdiction}`}
            />
            <span>
              {s.jurisdiction} · {s.regulationCount}
            </span>
          </label>
        ))}
      </div>

      {selected.length < 2 && (
        <p className="state-hint">Select at least two jurisdictions to compare.</p>
      )}
      {loading && <p className="empty-note">Comparing…</p>}
      {error && (
        <p className="form-error" data-testid="jurisdiction-error">
          {error}
        </p>
      )}

      {result && result.profiles.length > 0 && (
        <div className="comparison" data-testid="comparison">
          <table className="events-table">
            <thead>
              <tr>
                <th>Jurisdiction</th>
                <th>Regulations</th>
                <th>Risk index</th>
                <th>Avg severity</th>
                <th>Max severity</th>
                <th>Latest event</th>
              </tr>
            </thead>
            <tbody>
              {result.profiles.map((p) => (
                <tr key={p.jurisdiction} data-testid={`comparison-${p.jurisdiction}`}>
                  <td>{p.jurisdiction}</td>
                  <td>{p.regulationCount}</td>
                  <td>{p.riskIndex}</td>
                  <td>{p.averageSeverity.toFixed(2)}</td>
                  <td>{p.maxSeverity}</td>
                  <td>{p.latestEventDate}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <p className="subheading">Requirements by category</p>
          <table className="events-table">
            <thead>
              <tr>
                <th>Category</th>
                {result.jurisdictions.map((j) => (
                  <th key={j}>{j}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.categories.map((category) => (
                <tr key={category}>
                  <td>{category}</td>
                  {result.jurisdictions.map((j) => {
                    const cell = result.cells.find(
                      (c) => c.jurisdiction === j && c.category === category,
                    );
                    return (
                      <td key={j} data-testid={`cell-${j}-${category}`}>
                        {cell ? (
                          <>
                            {cell.count} · sev {cell.averageSeverity.toFixed(1)}
                            {cell.sources[0] && (
                              <>
                                {' '}
                                <a
                                  href={cell.sources[0].sourceUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  title={cell.sources[0].title}
                                >
                                  source ↗
                                </a>
                              </>
                            )}
                          </>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="state-hint">
            Each cell aggregates {result.coverage ? 'source-backed' : ''} policy records for that
            jurisdiction and category; the source link opens the primary reference.
          </p>
        </div>
      )}
    </div>
  );
}
