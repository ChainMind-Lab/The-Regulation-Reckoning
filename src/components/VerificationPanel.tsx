import { useState } from 'react';
import type { ContractEvent, ContractInfo, NetworkStatus } from '../lib/types';

/**
 * Stellar Expert explorer network segment, derived from the configured network
 * passphrase — mirrors the backend's explorerTxUrl(). Previously hardcoded to
 * testnet, which produced wrong links against a mainnet deployment.
 */
export function explorerNetwork(network: string | null | undefined): 'testnet' | 'public' {
  return network && network.includes('Test') ? 'testnet' : 'public';
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable (non-secure context) — ignore */
    }
  }
  return (
    <button
      type="button"
      className="copy-btn"
      onClick={handleCopy}
      aria-label={`Copy ${label}`}
      data-testid={`copy-${label}`}
    >
      {copied ? '✓ copied' : '⧉ copy'}
    </button>
  );
}

function AddressRow({
  label,
  value,
  explorerHref,
}: {
  label: string;
  value: string | null;
  explorerHref?: string;
}) {
  if (!value) return null;
  return (
    <div className="verify-row">
      <span className="verify-label">{label}</span>
      <code className="verify-address" title={value}>
        {value}
      </code>
      <div className="verify-actions">
        <CopyButton text={value} label={label.toLowerCase().replace(/\s+/g, '-')} />
        {explorerHref && (
          <a className="verify-link" href={explorerHref} target="_blank" rel="noreferrer">
            explorer ↗
          </a>
        )}
      </div>
    </div>
  );
}

const TOPIC_LABELS: Record<string, string> = {
  bounty_created: 'Bounty created',
  bounty_released: 'Bounty released',
  bounty_reclaimed: 'Bounty reclaimed',
  admin_initialised: 'Contract initialised',
  contributor_recorded: 'Contributor recorded',
};

export default function VerificationPanel({
  contract,
  network,
  events,
}: {
  contract: ContractInfo | null;
  network: NetworkStatus | null;
  events: ContractEvent[];
}) {
  const explorerContract = `https://stellar.expert/explorer/${explorerNetwork(
    contract?.network,
  )}/contract`;

  if (!contract?.configured) {
    return (
      <section className="verify-panel" id="verification">
        <h2>On-chain verification</h2>
        <p className="empty-note">
          Contract not configured — set BOUNTY_CONTRACT_ID (and friends) in the backend environment.
        </p>
      </section>
    );
  }

  return (
    <section className="verify-panel" id="verification">
      <div className="verify-header">
        <span className="status-dot live" />
        <h2>On-chain verification · Stellar Testnet</h2>
      </div>

      <div className="verify-rows">
        <AddressRow
          label="Bounty contract"
          value={contract.contractId}
          explorerHref={`${explorerContract}/${contract.contractId ?? ''}`}
        />
        <AddressRow
          label="RRD token (SAC)"
          value={contract.tokenId}
          explorerHref={`${explorerContract}/${contract.tokenId ?? ''}`}
        />
        <AddressRow
          label="Contributors registry"
          value={contract.registryId}
          explorerHref={`${explorerContract}/${contract.registryId ?? ''}`}
        />
        <AddressRow label="Admin" value={contract.admin} />
        <div className="verify-row">
          <span className="verify-label">Network</span>
          <code className="verify-address">{contract.network}</code>
          <div className="verify-actions">
            {network && (
              <span className="verify-status">
                ledger {Number(network.latestLedger).toLocaleString()} · protocol v
                {network.protocolVersion}
              </span>
            )}
          </div>
        </div>
        <div className="verify-row">
          <span className="verify-label">RPC endpoint</span>
          <code className="verify-address">{contract.rpcUrl}</code>
        </div>
      </div>

      <h3 className="verify-subhead">Successful transactions</h3>
      {events.length === 0 ? (
        <p className="empty-note">
          No transactions indexed yet — fund the first bounty to see it here.
        </p>
      ) : (
        <div className="tx-history">
          {events.slice(0, 12).map((ev) => (
            <div key={ev.id} className="tx-row">
              <span className={`event-topic ${ev.topic}`}>
                {TOPIC_LABELS[ev.topic] ?? ev.topic}
              </span>
              <span className="tx-issue">{ev.issueId ?? '—'}</span>
              <code className="tx-hash" title={ev.txHash}>
                {ev.txHash.slice(0, 18)}…
              </code>
              <div className="verify-actions">
                <CopyButton text={ev.txHash} label={`tx-${ev.id}`} />
                <a className="verify-link" href={ev.explorerUrl} target="_blank" rel="noreferrer">
                  explorer ↗
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
