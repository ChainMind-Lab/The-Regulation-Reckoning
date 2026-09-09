export default function HeroSection() {
  return (
    <header className="hero">
      <p className="eyebrow">
        <span className="eyebrow-dot" />
        Stellar Soroban · Stellar Testnet
      </p>
      <h1>Regulatory resilience, funded on-chain</h1>
      <p className="hero-sub">
        The Regulation Reckoning is a Soroban bounty platform: fund regulatory-research issues with
        Stellar assets, release rewards to contributors, and watch every event land on-chain —
        indexed and served back through this dashboard. Stellar Testnet is the source of truth; the
        backend and dashboard are read-models.
      </p>
      <div className="hero-actions">
        <a className="btn btn-primary" href="#bounties">
          Browse bounties ↓
        </a>
        <a
          className="btn btn-outline"
          href="https://github.com/ChainMind-Lab/The-Regulation-Reckoning"
          target="_blank"
          rel="noreferrer"
        >
          View source
        </a>
      </div>
    </header>
  );
}
