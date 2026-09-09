const REPO = 'https://github.com/ChainMind-Lab/The-Regulation-Reckoning';

const STEPS = [
  {
    num: '01',
    text: 'Connect Freighter and fund a bounty: pick an issue and lock RRD demo tokens on the Soroban contract.',
  },
  {
    num: '02',
    text: 'Submit a pull request for the issue and reference it in the bounty description.',
  },
  {
    num: '03',
    text: 'The maintainer releases the bounty from the contract — the contributor receives the tokens on-chain.',
  },
  {
    num: '04',
    text: 'Every create, release, and reclaim is a verifiable Stellar event, indexed and shown on the dashboard.',
  },
];

export default function ContributorCTA() {
  return (
    <section className="cta" id="contribute">
      <h2>Contribute</h2>
      <p>
        The Regulation Reckoning is an open-source Soroban application. Everything here runs on
        Stellar Testnet with real transactions — no mocks. Contribute code, research, or data, and
        get paid on-chain when a bounty is released to you.
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
        <a className="btn btn-primary" href={`${REPO}/issues`} target="_blank" rel="noreferrer">
          Open issues
        </a>
        <a
          className="btn btn-outline"
          href="https://github.com/ChainMind-Lab/The-Regulation-Reckoning/blob/main/docs/CONTRIBUTOR_GUIDE.md"
          target="_blank"
          rel="noreferrer"
        >
          Contributor guide
        </a>
      </div>
    </section>
  );
}
