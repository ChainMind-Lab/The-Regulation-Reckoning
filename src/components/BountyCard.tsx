import type { Bounty } from '../lib/types';

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export default function BountyCard({ bounty }: { bounty: Bounty }) {
  return (
    <article className={`bounty-card ${bounty.released ? 'released' : 'open'}`}>
      <div className="bounty-card-top">
        <h3 className="bounty-issue">{bounty.issueId}</h3>
        <span className={`bounty-status ${bounty.released ? 'released' : 'open'}`}>
          {bounty.released ? 'Released' : 'Open'}
        </span>
      </div>
      <div className="bounty-row">
        <span className="bounty-label">Amount</span>
        <span className="bounty-amount">{bounty.amount} RRD</span>
      </div>
      <div className="bounty-row">
        <span className="bounty-label">Funder</span>
        <span className="bounty-addr" title={bounty.funder}>
          {shortAddress(bounty.funder)}
        </span>
      </div>
      {bounty.contributor && (
        <div className="bounty-row">
          <span className="bounty-label">Contributor</span>
          <span className="bounty-addr" title={bounty.contributor}>
            {shortAddress(bounty.contributor)}
          </span>
        </div>
      )}
      <div className="bounty-links">
        {bounty.createdUrl && (
          <a href={bounty.createdUrl} target="_blank" rel="noreferrer">
            create tx ↗
          </a>
        )}
        {bounty.releasedUrl && (
          <a href={bounty.releasedUrl} target="_blank" rel="noreferrer">
            release tx ↗
          </a>
        )}
      </div>
    </article>
  );
}
