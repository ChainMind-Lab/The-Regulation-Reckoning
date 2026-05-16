export default function HeroSection() {
  return (
    <header className="hero">
      <p className="eyebrow">
        <span className="eyebrow-dot" />
        Stellar Drips Wave 5 · Open Source
      </p>
      <h1>Regulatory resilience and on-chain signals for Stellar builders</h1>
      <p className="hero-sub">
        A Stellar-native open-source platform mapping how global regulations shape
        network health, project survival, and the Web3 ecosystem. Fix issues.
        Merge code. Earn Wave rewards.
      </p>
      <div className="hero-actions">
        <a
          className="btn btn-primary"
          href="https://www.drips.network/wave/stellar"
          target="_blank"
          rel="noreferrer"
        >
          Join Wave 5 →
        </a>
        <a
          className="btn btn-outline"
          href="https://github.com/The-Regulation-Reckoning"
          target="_blank"
          rel="noreferrer"
        >
          View on GitHub
        </a>
      </div>
    </header>
  );
}
