import { useState, type FormEvent } from 'react';
import { runTx, TX_STEP_LABEL, type TxStep } from '../lib/tx';
import type { WalletAccount } from '../lib/wallet';
import type { Bounty, ContractInfo, TxAction } from '../lib/types';

type Props = {
  account: WalletAccount;
  contract: ContractInfo | null;
  bounties: Bounty[];
  onDone: () => void;
};

type Mode = 'fund' | 'claim';

type MilestoneDraft = { title: string; amount: string };

const DEFAULT_MILESTONES: MilestoneDraft[] = [
  { title: 'Draft outline', amount: '100' },
  { title: 'Final submission', amount: '150' },
];

export default function BountyForm({ account, contract, bounties, onDone }: Props) {
  const [mode, setMode] = useState<Mode>('fund');
  const [issueId, setIssueId] = useState('');
  const [milestones, setMilestones] = useState<MilestoneDraft[]>(DEFAULT_MILESTONES);
  const [step, setStep] = useState<TxStep>('idle');
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [txUrl, setTxUrl] = useState<string | null>(null);

  const openBounties = bounties.filter((b) => !b.released && !b.refunded);
  const token = contract?.tokenId ?? '';

  function updateMilestone(index: number, patch: Partial<MilestoneDraft>) {
    setMilestones((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function addMilestone() {
    setMilestones((rows) => (rows.length >= 20 ? rows : [...rows, { title: '', amount: '' }]));
  }

  function removeMilestone(index: number) {
    setMilestones((rows) => (rows.length <= 1 ? rows : rows.filter((_, i) => i !== index)));
  }

  async function run(action: TxAction, extra: Record<string, unknown>) {
    setError(null);
    setTxHash(null);
    setTxUrl(null);
    try {
      const outcome = await runTx(action, account.address, extra, setStep);
      setTxHash(outcome.hash);
      setTxUrl(outcome.explorerUrl);
      onDone();
    } catch (err) {
      setStep('idle');
      setError(err instanceof Error ? err.message : 'Transaction failed');
    }
  }

  function validateMilestones(): string | null {
    if (milestones.length === 0 || milestones.length > 20) {
      return 'A bounty needs between 1 and 20 milestones.';
    }
    for (const [i, m] of milestones.entries()) {
      if (!m.title.trim()) return `Milestone ${i + 1} needs a title.`;
      const amount = Number(m.amount);
      if (!Number.isInteger(amount) || amount <= 0) {
        return `Milestone ${i + 1} needs a positive whole-number amount.`;
      }
    }
    return null;
  }

  function handleFund(e: FormEvent) {
    e.preventDefault();
    if (!issueId.trim()) {
      setError('Issue ID is required.');
      return;
    }
    if (!token) {
      setError(
        'The configured token address is unavailable — the backend has not reported a demo token.',
      );
      return;
    }
    const problem = validateMilestones();
    if (problem) {
      setError(problem);
      return;
    }
    void run('createBounty', {
      funder: account.address,
      token,
      issueId: issueId.trim(),
      milestones: milestones.map((m) => ({ title: m.title.trim(), amount: String(m.amount) })),
    });
  }

  function handleClaim(e: FormEvent) {
    e.preventDefault();
    const selected = (e.target as HTMLFormElement).elements.namedItem(
      'bounty',
    ) as HTMLSelectElement;
    const selectedId = selected?.value;
    if (!selectedId) {
      setError('Select an open bounty to claim.');
      return;
    }
    void run('claim', { issueId: selectedId, contributor: account.address });
  }

  const busy = step !== 'idle' && step !== 'done';

  return (
    <div className="bounty-form">
      <div className="bounty-form-tabs">
        <button
          type="button"
          className={`tab ${mode === 'fund' ? 'active' : ''}`}
          onClick={() => {
            setMode('fund');
            setError(null);
          }}
        >
          Fund a bounty
        </button>
        <button
          type="button"
          className={`tab ${mode === 'claim' ? 'active' : ''}`}
          onClick={() => {
            setMode('claim');
            setError(null);
          }}
          disabled={openBounties.length === 0}
        >
          Claim a bounty
        </button>
      </div>

      {mode === 'fund' ? (
        <form onSubmit={handleFund}>
          <label className="form-field">
            <span>Issue ID (e.g. repo#42)</span>
            <input
              value={issueId}
              onChange={(e) => setIssueId(e.target.value)}
              placeholder="ChainMind-Lab/The-Regulation-Reckoning#12"
              data-testid="create-issue"
            />
          </label>

          <p className="subheading">Milestones (paid out as each is approved)</p>
          <div className="milestone-editor">
            {milestones.map((m, i) => (
              <div className="milestone-editor-row" key={i}>
                <input
                  value={m.title}
                  onChange={(e) => updateMilestone(i, { title: e.target.value })}
                  placeholder={`Milestone ${i + 1} title`}
                  data-testid={`milestone-title-${i}`}
                />
                <input
                  type="number"
                  min="1"
                  value={m.amount}
                  onChange={(e) => updateMilestone(i, { amount: e.target.value })}
                  placeholder="Amount"
                  data-testid={`milestone-amount-${i}`}
                />
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={() => removeMilestone(i)}
                  disabled={milestones.length <= 1}
                  aria-label={`Remove milestone ${i + 1}`}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={addMilestone}
            disabled={milestones.length >= 20}
            data-testid="add-milestone"
          >
            + Add milestone
          </button>
          <p className="state-hint">
            Total escrow: {milestones.reduce((sum, m) => sum + (Number(m.amount) || 0), 0)} RRD
            across {milestones.length} milestone{milestones.length === 1 ? '' : 's'}.
          </p>

          <button type="submit" className="btn btn-primary" disabled={busy}>
            {step === 'done' ? 'Fund another' : 'Create bounty'}
          </button>
        </form>
      ) : (
        <form onSubmit={handleClaim}>
          <label className="form-field">
            <span>Open bounty</span>
            <select
              name="bounty"
              data-testid="claim-select"
              defaultValue={openBounties[0]?.issueId ?? ''}
            >
              {openBounties.map((b) => (
                <option key={b.issueId} value={b.issueId}>
                  {b.issueId} · {b.releasedAmount || b.amount} RRD
                </option>
              ))}
            </select>
          </label>
          <p className="state-hint">
            You will claim the bounty as <code className="contract-id">{account.address}</code>.
            Release happens by multisig proposal after reviewer approval.
          </p>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {step === 'done' ? 'Claim another' : 'Claim bounty'}
          </button>
        </form>
      )}

      {step !== 'idle' && step !== 'done' && (
        <p className="form-progress" data-testid="form-progress">
          {TX_STEP_LABEL[step]}
        </p>
      )}
      {txHash && step === 'done' && (
        <p className="form-success">
          Transaction confirmed —{' '}
          <a href={txUrl ?? '#'} target="_blank" rel="noreferrer">
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
