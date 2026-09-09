import type { AnalyticsSnapshot, ImpactArea, PolicyRecord, SurvivalSignal } from '../lib/types';

const CATEGORY_LABELS: Record<string, string> = {
  'stablecoin-regulation': 'Stablecoin regulation',
  sanctions: 'Sanctions',
  'anti-money-laundering': 'Anti-money laundering',
  'crypto-markets': 'Crypto markets',
  'cross-border-payments': 'Cross-border payments',
  securities: 'Securities',
  'consumer-protection': 'Consumer protection',
  'data-protection': 'Data protection',
  taxation: 'Taxation',
  'operational-resilience': 'Operational resilience',
};

const IMPACT_LABELS: Record<ImpactArea, string> = {
  'stablecoin-issuers': 'Stablecoin issuers',
  exchanges: 'Exchanges',
  'cross-border-payments': 'Cross-border payments',
  'wallets-and-custody': 'Wallets & custody',
  'defi-protocols': 'DeFi protocols',
  'institutional-adoption': 'Institutional adoption',
  tokenization: 'Tokenization',
  'sanctions-compliance': 'Sanctions compliance',
  'consumer-protection': 'Consumer protection',
  'infrastructure-providers': 'Infrastructure providers',
};

const SIGNAL_LABELS: Record<SurvivalSignal, string> = {
  'higher-compliance-cost': 'Higher compliance cost',
  'licensing-requirements': 'Licensing requirements',
  'jurisdiction-shift': 'Jurisdiction shift',
  'delisting-risk': 'Delisting risk',
  'reserve-and-audit-requirements': 'Reserve & audit requirements',
  'disclosure-burden': 'Disclosure burden',
  'operational-risk-management': 'Operational risk management',
  'enforcement-action': 'Enforcement action',
  'market-access-barrier': 'Market access barrier',
  'capital-requirement': 'Capital requirement',
};

function label(category: string): string {
  return CATEGORY_LABELS[category] ?? category.replace(/-/g, ' ');
}

function SeverityBadge({ severity }: { severity: number }) {
  const tone = severity >= 4 ? 'high' : severity === 3 ? 'med' : 'low';
  return <span className={`severity severity-${tone}`}>sev {severity}</span>;
}

/** Simple accessible bar chart rendered with divs — no chart dependency. */
function TimelineChart({ analytics }: { analytics: AnalyticsSnapshot }) {
  const points = analytics.timeline;
  if (points.length === 0) {
    return <p className="empty-note">No timeline data yet.</p>;
  }
  const max = Math.max(...points.map((p) => p.count));
  return (
    <div className="timeline-chart" role="img" aria-label="Regulatory events per month">
      {points.map((p) => (
        <div key={p.month} className="timeline-bar-col" title={`${p.month}: ${p.count} event(s)`}>
          <div
            className="timeline-bar"
            style={{ height: `${Math.max(8, Math.round((p.count / max) * 100))}%` }}
          />
          <span className="timeline-bar-label">{p.month.slice(2)}</span>
          <span className="timeline-bar-count">{p.count}</span>
        </div>
      ))}
    </div>
  );
}

/** Jurisdiction × category severity-weighted heat map (CSS grid). */
function JurisdictionHeatmap({ analytics }: { analytics: AnalyticsSnapshot }) {
  const cells = analytics.heatmap;
  if (cells.length === 0) {
    return <p className="empty-note">No heat map data yet.</p>;
  }
  const jurisdictions = [...new Set(cells.map((c) => c.jurisdiction))].sort();
  const categories = [...new Set(cells.map((c) => c.category))].sort();
  return (
    <div className="heatmap" role="img" aria-label="Jurisdiction risk heat map">
      <div className="heatmap-row heatmap-head">
        <span className="heatmap-cell heatmap-corner">Jurisdiction</span>
        {categories.map((c) => (
          <span key={c} className="heatmap-cell heatmap-head-cell" title={label(c)}>
            {label(c)}
          </span>
        ))}
      </div>
      {jurisdictions.map((j) => (
        <div key={j} className="heatmap-row">
          <span className="heatmap-cell heatmap-jurisdiction">{j}</span>
          {categories.map((c) => {
            const cell = cells.find((x) => x.jurisdiction === j && x.category === c);
            if (!cell) {
              return <span key={c} className="heatmap-cell heatmap-empty" />;
            }
            const tone =
              cell.risk >= 66 ? 'hot' : cell.risk >= 33 ? 'warm' : cell.risk > 0 ? 'cool' : 'none';
            return (
              <span
                key={c}
                className={`heatmap-cell heatmap-${tone}`}
                title={`${j} · ${label(c)}: ${cell.count} event(s), risk ${cell.risk}`}
              >
                {cell.risk}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export default function PolicyPanel({
  policies,
  analytics,
}: {
  policies: PolicyRecord[];
  analytics: AnalyticsSnapshot | null;
}) {
  return (
    <div className="policy-panel">
      {analytics && (
        <>
          <div className="analytics-tiles">
            <div className="analytics-tile">
              <div className="analytics-value">{analytics.totals.events}</div>
              <div className="analytics-label">Regulatory events tracked</div>
            </div>
            <div className="analytics-tile">
              <div className="analytics-value">{analytics.totals.jurisdictions}</div>
              <div className="analytics-label">Jurisdictions</div>
            </div>
            <div className="analytics-tile">
              <div className="analytics-value">{analytics.riskIndex}</div>
              <div className="analytics-label">Regulatory risk index (0–100)</div>
            </div>
            <div className="analytics-tile">
              <div className="analytics-value">{analytics.totals.averageSeverity}</div>
              <div className="analytics-label">Average severity (1–5)</div>
            </div>
          </div>

          <div className="analytics-grid">
            <div className="analytics-block">
              <h4 className="analytics-block-title">Policy timeline (events per month)</h4>
              <TimelineChart analytics={analytics} />
            </div>
            <div className="analytics-block">
              <h4 className="analytics-block-title">Jurisdiction risk heat map</h4>
              <JurisdictionHeatmap analytics={analytics} />
            </div>
          </div>

          <div className="analytics-grid">
            {analytics.impact.length > 0 && (
              <div className="analytics-block">
                <h4 className="analytics-block-title">Ecosystem impact areas</h4>
                <ul className="signal-list">
                  {analytics.impact.map((a) => (
                    <li key={a.area} className="signal-row">
                      <span className="signal-name">{IMPACT_LABELS[a.area] ?? a.area}</span>
                      <span className="signal-bar-track">
                        <span
                          className="signal-bar"
                          style={{ width: `${Math.min(100, a.count * 8)}%` }}
                        />
                      </span>
                      <span className="signal-count">
                        {a.count} · sev {a.totalSeverity}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {analytics.survivalSignals.length > 0 && (
              <div className="analytics-block">
                <h4 className="analytics-block-title">Project-survival signals</h4>
                <ul className="signal-list">
                  {analytics.survivalSignals.map((s) => (
                    <li key={s.signal} className="signal-row">
                      <span className="signal-name">{SIGNAL_LABELS[s.signal] ?? s.signal}</span>
                      <span className="signal-bar-track">
                        <span
                          className="signal-bar"
                          style={{ width: `${Math.min(100, s.count * 8)}%` }}
                        />
                      </span>
                      <span className="signal-count">
                        {s.count} · sev {s.totalSeverity}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </>
      )}
      <ul className="policy-list">
        {policies.map((p) => (
          <li key={p.id} className="policy-item">
            <div className="policy-item-top">
              <a href={p.sourceUrl} target="_blank" rel="noreferrer" className="policy-title">
                {p.title} ↗
              </a>
              <SeverityBadge severity={p.severity} />
            </div>
            <p className="policy-meta">
              {label(p.category)} · {p.jurisdiction} · {p.eventDate} ·{' '}
              <a href={p.sourceUrl} target="_blank" rel="noreferrer">
                {p.sourceName}
              </a>
            </p>
            <p className="policy-summary">{p.summary}</p>
            {(p.impact.length > 0 || p.survivalSignals.length > 0) && (
              <div className="policy-chips">
                {p.impact.map((a) => (
                  <span key={a} className="chip chip-impact" title="Ecosystem impact area">
                    {IMPACT_LABELS[a] ?? a}
                  </span>
                ))}
                {p.survivalSignals.map((s) => (
                  <span key={s} className="chip chip-signal" title="Project-survival signal">
                    {SIGNAL_LABELS[s] ?? s}
                  </span>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
