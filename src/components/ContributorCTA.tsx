const STEPS = [
  { num: '01', text: 'Browse open issues tagged for Wave 5 and pick one that fits your skills.' },
  { num: '02', text: 'Fork the repo, open a PR, and link it to the issue on Drips Wave.' },
  { num: '03', text: 'Get your PR merged and earn Points — redeemable for real rewards.' },
  { num: '04', text: 'Build your on-chain contributor portfolio across the Stellar ecosystem.' },
];

export default function ContributorCTA() {
  return (
    <section className="cta" id="contribute">
      <h2>Contribute to Wave 5</h2>
      <p>
        The Regulation Reckoning is an approved Stellar Drips Wave repo. Every merged
        PR earns Points toward the Wave 5 reward pool. No experience with Stellar
        required — pick a <span style={{ color: 'var(--green)' }}>good first issue</span> and start today.
      </p>
      <div className="cta-steps">
        {STEPS.map((s) => (
          <div key={s.num} className="cta-step">
            <div className="cta-step-num">Step {s.num}</div>
            <p>{s.text}</p>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <a
          className="btn btn-primary"
          href="https://www.drips.network/wave/stellar/issues"
          target="_blank"
          rel="noreferrer"
        >
          Browse Wave 5 issues
        </a>
        <a
          className="btn btn-outline"
          href="https://docs.drips.network/wave/contributors/solving-issues-and-earning-rewards"
          target="_blank"
          rel="noreferrer"
        >
          How it works
        </a>
      </div>
    </section>
  );
}
