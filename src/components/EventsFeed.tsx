import { useState } from 'react';
import type { ContractEvent } from '../lib/types';

const TOPIC_LABELS: Record<string, string> = {
  bounty_created: 'Bounty created',
  bounty_released: 'Bounty released',
  bounty_reclaimed: 'Bounty reclaimed',
  admin_initialised: 'Contract initialised',
  contributor_recorded: 'Contributor recorded',
};

function TxHash({ ev }: { ev: ContractEvent }) {
  const [copied, setCopied] = useState(false);
  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(ev.txHash);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }
  return (
    <span className="tx-hash-cell">
      <code className="tx-hash" title={ev.txHash}>
        {ev.txHash.slice(0, 10)}…
      </code>
      <button
        type="button"
        className="copy-btn copy-btn-sm"
        onClick={handleCopy}
        aria-label="Copy transaction hash"
        data-testid={`copy-tx-${ev.id}`}
      >
        {copied ? '✓' : '⧉'}
      </button>
      <a href={ev.explorerUrl} target="_blank" rel="noreferrer" title={ev.txHash}>
        ↗
      </a>
    </span>
  );
}

export default function EventsFeed({ events }: { events: ContractEvent[] }) {
  if (events.length === 0) {
    return <p className="empty-note">No contract events indexed yet.</p>;
  }
  return (
    <div className="events-table-wrap">
      <table className="events-table">
        <thead>
          <tr>
            <th>Event</th>
            <th>Issue</th>
            <th>Ledger</th>
            <th>Transaction</th>
          </tr>
        </thead>
        <tbody>
          {events.map((ev) => (
            <tr key={ev.id}>
              <td>
                <span className={`event-topic ${ev.topic}`}>
                  {TOPIC_LABELS[ev.topic] ?? ev.topic}
                </span>
              </td>
              <td className="event-issue">{ev.issueId ?? '—'}</td>
              <td>#{ev.ledger.toLocaleString()}</td>
              <td>
                <TxHash ev={ev} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
