import type { ContractEvent } from '../lib/types';

const TOPIC_LABELS: Record<string, string> = {
  bounty_created: 'Bounty created',
  bounty_released: 'Bounty released',
  bounty_reclaimed: 'Bounty reclaimed',
  admin_initialised: 'Contract initialised',
};

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
                <a href={ev.explorerUrl} target="_blank" rel="noreferrer" title={ev.txHash}>
                  {ev.txHash.slice(0, 10)}… ↗
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
