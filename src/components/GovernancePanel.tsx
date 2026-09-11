import { useCallback, useEffect, useState } from 'react';
import { getProposals, getSigners } from '../lib/api';
import { runTx, shortAddress, TX_STEP_LABEL, type TxStep } from '../lib/tx';
import type { WalletAccount } from '../lib/wallet';
import type { ContractInfo, Proposal, SignerSet } from '../lib/types';

type Props = {
  account: WalletAccount | null;
  contract: ContractInfo | null;
  onDone: () => void;
};

/**
 * Multisig administration.
 *
 * Privileged contract operations (releasing a milestone, refunding an escrow,
 * changing the signer set, resolving a dispute) are proposals: one signer
 * proposes, then `threshold` signers approve before the target is executed.
 * This panel shows the live signer set and lets a signer approve, revoke or
 * cancel a pending proposal.
 */
export default function GovernancePanel({ account, contract, onDone }: Props) {
  const [signers, setSigners] = useState<SignerSet>({
    signers: contract?.signers ?? [],
    threshold: contract?.signerThreshold ?? 0,
  });
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<TxStep>('idle');
  const [txHash, setTxHash] = useState<string | null>(null);
  const [txUrl, setTxUrl] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const [signerRes, proposalRes] = await Promise.allSettled([getSigners(), getProposals(50)]);
    if (signerRes.status === 'fulfilled') setSigners(signerRes.value);
    else if (contract) {
      setSigners({ signers: contract.signers, threshold: contract.signerThreshold });
    }
    if (proposalRes.status === 'fulfilled') setProposals(proposalRes.value);
    if (signerRes.status === 'rejected' && proposalRes.status === 'rejected') {
      setError('Could not load multisig state from the backend.');
    }
  }, [contract]);

  useEffect(() => {
    void load();
  }, [load]);

  const address = account?.address ?? null;
  const isSigner = Boolean(address && signers.signers.includes(address));
  const busy = step !== 'idle' && step !== 'done';

  async function act(
    action: 'approve' | 'revoke' | 'cancel',
    proposalId: number,
    proposer: string,
  ) {
    if (!address) return;
    setError(null);
    setTxHash(null);
    setTxUrl(null);
    try {
      const outcome = await runTx(
        action,
        address,
        action === 'cancel' ? { proposer, proposalId } : { signer: address, proposalId },
        setStep,
      );
      setTxHash(outcome.hash);
      setTxUrl(outcome.explorerUrl);
      await load();
      onDone();
    } catch (err) {
      setStep('idle');
      setError(err instanceof Error ? err.message : 'Transaction failed');
    }
  }

  const pending = proposals.filter((p) => !p.executed && !p.cancelled);

  return (
    <div className="panel" data-testid="governance-panel">
      <div className="panel-meta">
        <span className="badge badge-stellar">
          {signers.threshold}-of-{signers.signers.length} multisig
        </span>
        {isSigner ? (
          <span className="badge badge-healthy">you are a signer</span>
        ) : (
          <span className="muted">read-only — connect a signer account to approve</span>
        )}
      </div>

      <p className="subheading">Signer set</p>
      {signers.signers.length === 0 ? (
        <p className="empty-note">No signer set has been initialised on this contract yet.</p>
      ) : (
        <ul className="signer-list">
          {signers.signers.map((s) => (
            <li key={s} data-testid={`signer-${s}`}>
              <code className="contract-id" title={s}>
                {shortAddress(s, 8)}
              </code>
              {s === address && <span className="muted"> (you)</span>}
            </li>
          ))}
        </ul>
      )}

      <p className="subheading">Pending proposals</p>
      {pending.length === 0 ? (
        <p className="empty-note">No pending proposals.</p>
      ) : (
        <table className="events-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Action</th>
              <th>Proposer</th>
              <th>Approvals</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {pending.map((p) => (
              <tr key={p.id} data-testid={`proposal-${p.id}`}>
                <td>{p.id}</td>
                <td>{p.action}</td>
                <td>
                  <code className="contract-id">{shortAddress(p.proposer, 6)}</code>
                </td>
                <td data-testid={`proposal-approvals-${p.id}`}>
                  {p.approvals.length}/{signers.threshold || '—'}
                </td>
                <td>
                  {isSigner && (
                    <div className="action-row">
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        data-testid={`approve-proposal-${p.id}`}
                        disabled={busy || p.approvals.includes(address ?? '')}
                        onClick={() => void act('approve', p.id, p.proposer)}
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        data-testid={`revoke-proposal-${p.id}`}
                        disabled={busy || !p.approvals.includes(address ?? '')}
                        onClick={() => void act('revoke', p.id, p.proposer)}
                      >
                        Revoke
                      </button>
                      {address === p.proposer && (
                        <button
                          type="button"
                          className="btn btn-outline btn-sm"
                          data-testid={`cancel-proposal-${p.id}`}
                          disabled={busy}
                          onClick={() => void act('cancel', p.id, p.proposer)}
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {step !== 'idle' && step !== 'done' && (
        <p className="form-progress" data-testid="governance-progress">
          {TX_STEP_LABEL[step]}
        </p>
      )}
      {txHash && (
        <p className="form-success">
          Confirmed —{' '}
          <a href={txUrl ?? '#'} target="_blank" rel="noreferrer">
            {txHash.slice(0, 12)}… ↗
          </a>
        </p>
      )}
      {error && (
        <p className="form-error" data-testid="governance-error">
          {error}
        </p>
      )}
    </div>
  );
}
