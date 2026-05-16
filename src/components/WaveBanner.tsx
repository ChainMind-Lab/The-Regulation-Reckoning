import type { WaveInfo } from '../data/waveInfo';

export default function WaveBanner({ wave }: { wave: WaveInfo }) {
  return (
    <div className="wave-banner" id="wave">
      <div className="wave-banner-left">
        <span className="wave-label">Stellar Drips</span>
        <span className="wave-title">Wave {wave.number}</span>
        <p className="wave-desc">
          A 7-day open-source sprint across 540+ Stellar repos. Contributors earn
          Points redeemable for real rewards. Wave {wave.number} budget:{' '}
          <strong style={{ color: 'var(--accent-2)' }}>{wave.budget}</strong>.
        </p>
        <div style={{ marginTop: 8 }}>
          <span className={`wave-status-pill ${wave.status}`}>
            <span className="pulse" />
            {wave.status === 'upcoming' ? `Upcoming · ${wave.startDate}` : wave.status === 'live' ? 'Live now' : 'Ended'}
          </span>
        </div>
      </div>
      <div className="wave-stats">
        <div className="wave-stat">
          <div className="wave-stat-value">{wave.totalRepos.toLocaleString()}</div>
          <div className="wave-stat-label">Repos</div>
        </div>
        <div className="wave-stat">
          <div className="wave-stat-value">{(wave.totalIssues / 1000).toFixed(0)}k+</div>
          <div className="wave-stat-label">Issues</div>
        </div>
        <div className="wave-stat">
          <div className="wave-stat-value">{wave.budget}</div>
          <div className="wave-stat-label">Budget</div>
        </div>
      </div>
    </div>
  );
}
