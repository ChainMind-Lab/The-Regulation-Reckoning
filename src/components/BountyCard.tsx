import { useState } from 'react';
import type { Bounty } from '../lib/types';

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function Copyable({ text, short }: { text: string; short: string }) {
  const [copied, setCopied] = useState(false);
  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }
  return (
    <span className="copyable-addr">
      <code title={text}>{short}</code>
      <button
        type="button"
        className="copy-btn copy-btn-sm"
        onClick={handleCopy}
        aria-label="Copy address"
      >
        {copied ? '✓' : '⧉'}
      </button>
    </span>
  );
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
        <Copyable text={bounty.funder} short={shortAddress(bounty.funder)} />
      </div>
      {bounty.contributor && (
        <div className="bounty-row">
          <span className="bounty-label">Contributor</span>
          <Copyable text={bounty.contributor} short={shortAddress(bounty.contributor)} />
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
