import type { AnalyticsSnapshot, PolicyRecord } from '../lib/types';

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

function label(category: string): string {
  return CATEGORY_LABELS[category] ?? category.replace(/-/g, ' ');
}

function SeverityBadge({ severity }: { severity: number }) {
  const tone = severity >= 4 ? 'high' : severity === 3 ? 'med' : 'low';
  return <span className={`severity severity-${tone}`}>sev {severity}</span>;
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
              {label(p.category)} · {p.jurisdiction} · {p.eventDate}
            </p>
            <p className="policy-summary">{p.summary}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
