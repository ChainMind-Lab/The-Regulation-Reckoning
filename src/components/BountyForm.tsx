import { useState, type FormEvent } from 'react';
import { buildTransaction, submitTransaction } from '../lib/api';
import { signTransactionXdr } from '../lib/wallet';
import type { WalletAccount } from '../lib/wallet';
import type { Bounty, TxAction } from '../lib/types';

type Props = {
  account: WalletAccount;
  bounties: Bounty[];
  onDone: () => void;
};

type Step = 'idle' | 'building' | 'signing' | 'submitting' | 'done';
type Mode = 'create' | 'release';

const STEPS: Record<Step, string> = {
  idle: '',
  building: 'Building transaction…',
  signing: 'Waiting for Freighter signature…',
  submitting: 'Submitting to Stellar Testnet…',
  done: 'Transaction confirmed ✓',
};

export default function BountyForm({ account, bounties, onDone }: Props) {
  const [mode, setMode] = useState<Mode>('create');
  const [issueId, setIssueId] = useState('');
  const [amount, setAmount] = useState('250');
  const [contributor, setContributor] = useState('');
  const [step, setStep] = useState<Step>('idle');
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const openBounties = bounties.filter((b) => !b.released);

  async function runFlow(action: TxAction, extra: Record<string, string>) {
    setStep('building');
    setError(null);
    setTxHash(null);
    try {
      const built = await buildTransaction(action, account.address, extra);
      setStep('signing');
      const signedXdr = await signTransactionXdr(built.txXdr, built.networkPassphrase);
      setStep('submitting');
      const result = await submitTransaction(signedXdr);
      setTxHash(result.hash);
      setStep('done');
      onDone();
    } catch (err) {
      setStep('idle');
      setError(err instanceof Error ? err.message : 'Transaction failed');
    }
  }

  function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!issueId.trim() || !amount.trim()) {
      setError('Issue ID and amount are required.');
      return;
    }
    void runFlow('create', { issueId: issueId.trim(), amount: amount.trim() });
  }

  function handleRelease(e: FormEvent) {
    e.preventDefault();
    if (!contributor.trim() || !/^G[A-Z2-7]{55}$/.test(contributor.trim())) {
      setError('Enter a valid Stellar G… address for the contributor.');
      return;
    }
    const selected = (e.target as HTMLFormElement).elements.namedItem(
      'bounty',
    ) as HTMLSelectElement;
    const selectedId = selected?.value;
    if (!selectedId) {
      setError('Select an open bounty to release.');
      return;
    }
    void runFlow('release', { issueId: selectedId, contributor: contributor.trim() });
  }

  return (
    <div className="bounty-form">
      <div className="bounty-form-tabs">
        <button
          type="button"
          className={`tab ${mode === 'create' ? 'active' : ''}`}
          onClick={() => {
            setMode('create');
            setError(null);
          }}
        >
          Fund a bounty
        </button>
        <button
          type="button"
          className={`tab ${mode === 'release' ? 'active' : ''}`}
          onClick={() => {
            setMode('release');
            setError(null);
          }}
          disabled={openBounties.length === 0}
        >
          Release a bounty
        </button>
      </div>

      {mode === 'create' ? (
        <form onSubmit={handleCreate}>
          <label className="form-field">
            <span>Issue ID (e.g. repo#42)</span>
            <input
              value={issueId}
              onChange={(e) => setIssueId(e.target.value)}
              placeholder="ChainMind-Lab/The-Regulation-Reckoning#12"
              data-testid="create-issue"
            />
          </label>
          <label className="form-field">
            <span>Amount (RRD demo tokens)</span>
            <input
              type="number"
              min="1"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              data-testid="create-amount"
            />
          </label>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={step !== 'idle' && step !== 'done'}
          >
            {step === 'done' ? 'Fund another' : 'Create bounty'}
          </button>
        </form>
      ) : (
        <form onSubmit={handleRelease}>
          <label className="form-field">
            <span>Open bounty</span>
            <select
              name="bounty"
              data-testid="release-select"
              defaultValue={openBounties[0]?.issueId ?? ''}
            >
              {openBounties.map((b) => (
                <option key={b.issueId} value={b.issueId}>
                  {b.issueId} · {b.amount} RRD
                </option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span>Contributor address (G…)</span>
            <input
              value={contributor}
              onChange={(e) => setContributor(e.target.value)}
              placeholder="G…"
              data-testid="release-contributor"
            />
          </label>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={step !== 'idle' && step !== 'done'}
          >
            {step === 'done' ? 'Release another' : 'Release bounty'}
          </button>
        </form>
      )}

      {step !== 'idle' && step !== 'done' && (
        <p className="form-progress" data-testid="form-progress">
          {STEPS[step]}
        </p>
      )}
      {txHash && step === 'done' && (
        <p className="form-success">
          Transaction confirmed —{' '}
          <a
            href={`https://stellar.expert/explorer/testnet/tx/${txHash}`}
            target="_blank"
            rel="noreferrer"
          >
            {txHash.slice(0, 12)}… ↗
          </a>
        </p>
      )}
      {error && (
        <p className="form-error" data-testid="form-error">
          {error}
        </p>
      )}
    </div>
  );
}
