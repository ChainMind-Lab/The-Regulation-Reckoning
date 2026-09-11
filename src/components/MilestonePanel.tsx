import { useCallback, useEffect, useState } from 'react';
import { getMilestones } from '../lib/api';
import { runTx, shortAddress, TX_STEP_LABEL, type TxStep } from '../lib/tx';
import type { WalletAccount } from '../lib/wallet';
import type { ContractInfo, MilestoneView } from '../lib/types';

type Props = {
  account: WalletAccount | null;
  contract: ContractInfo | null;
  bounties: Array<{ issueId: string }>;
  onDone: () => void;
};

/**
 * Milestone escrow, on-chain reviews and dispute resolution.
 *
 * Reads the live milestone state (merged with indexed release history) and
 * exposes the three participant actions the contract supports:
 *   - a multisig signer proposes releasing a milestone,
 *   - an assigned reviewer submits an approve/reject decision,
 *   - the funder or contributor opens a dispute, and reviewers vote on it.
 */
export default function MilestonePanel({ account, contract, bounties, onDone }: Props) {
  const [issueId, setIssueId] = useState('');
  const [view, setView] = useState<MilestoneView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<TxStep>('idle');
  const [txHash, setTxHash] = useState<string | null>(null);
  const [txUrl, setTxUrl] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const open = bounties.map((b) => b.issueId);

  useEffect(() => {
    if (!issueId && open.length > 0) setIssueId(open[0]);
  }, [issueId, open]);

  const load = useCallback(async (id: string) => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      setView(await getMilestones(id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load milestones');
      setView(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(issueId);
  }, [issueId, load]);

  const address = account?.address ?? null;
  const signers = contract?.signers ?? [];

  async function run(action: Parameters<typeof runTx>[0], extra: Record<string, unknown>) {
    if (!address) return;
    setError(null);
    setTxHash(null);
    setTxUrl(null);
    try {
      const outcome = await runTx(action, address, extra, setStep);
      setTxHash(outcome.hash);
      setTxUrl(outcome.explorerUrl);
      await load(issueId);
      onDone();
    } catch (err) {
      setStep('idle');
      setError(err instanceof Error ? err.message : 'Transaction failed');
    }
  }

  const isReviewer = Boolean(address && view?.reviewers.some((r) => r.reviewer === address));
  const canPropose = Boolean(address && signers.includes(address));
  const openDispute = view?.disputes.find((d) => !d.resolved);
  const busy = step !== 'idle' && step !== 'done';

  return (
    <div className="panel" data-testid="milestone-panel">
      <div className="panel-controls">
        <label className="form-field">
          <span>Bounty</span>
          <select
            data-testid="milestone-bounty"
            value={issueId}
            onChange={(e) => setIssueId(e.target.value)}
          >
            {open.length === 0 && <option value="">No bounties yet</option>}
            {open.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="btn btn-outline btn-sm"
          onClick={() => void load(issueId)}
          disabled={!issueId || loading}
        >
          Refresh
        </button>
      </div>

      {loading && <p className="empty-note">Loading milestones…</p>}
      {!loading && !view && issueId && (
        <p className="empty-note">No milestone data for {issueId} yet.</p>
      )}

      {view && (
        <>
          <div className="panel-meta">
            <span className={`badge badge-${view.source}`}>
              {view.onChainVerified ? 'verified on-chain' : 'index only'}
            </span>
            <span>
              reviewer quorum: {view.quorum || '—'} · released {view.releasedAmount ?? '0'} of{' '}
              {view.milestones.reduce((sum, m) => sum + Number(m.amount), 0)}
            </span>
            {view.disputed && <span className="badge badge-disputed">dispute open</span>}
          </div>

          <table className="events-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Milestone</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Reviewers</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {view.milestones.map((m) => {
                const approvals = view.reviewers.filter((r) =>
                  r.reviews.some((rv) => rv.milestone === m.index && rv.decision === 'approve'),
                ).length;
                const rejected = view.reviewers.some((r) =>
                  r.reviews.some((rv) => rv.milestone === m.index && rv.decision === 'reject'),
                );
                return (
                  <tr key={m.index}>
                    <td>{m.index}</td>
                    <td>{m.title}</td>
                    <td>{m.amount}</td>
                    <td>
                      {m.settled ? (
                        <>
                          settled
                          {m.releasedUrl && (
                            <>
                              {' '}
                              <a href={m.releasedUrl} target="_blank" rel="noreferrer">
                                ↗
                              </a>
                            </>
                          )}
                        </>
                      ) : (
                        'open'
                      )}
                    </td>
                    <td data-testid={`review-tally-${m.index}`}>
                      {approvals}/{view.quorum || 0} approve
                      {rejected ? ' · 1+ reject' : ''}
                    </td>
                    <td>
                      <div className="action-row">
                        {!m.settled && canPropose && (
                          <button
                            type="button"
                            className="btn btn-outline btn-sm"
                            data-testid={`propose-release-${m.index}`}
                            disabled={busy}
                            onClick={() =>
                              void run('proposeRelease', {
                                proposer: address,
                                issueId,
                                milestone: m.index,
                              })
                            }
                          >
                            Propose release
                          </button>
                        )}
                        {!m.settled && isReviewer && !rejected && (
                          <>
                            <button
                              type="button"
                              className="btn btn-outline btn-sm"
                              data-testid={`approve-${m.index}`}
                              disabled={busy}
                              onClick={() =>
                                void run('submitReview', {
                                  reviewer: address,
                                  issueId,
                                  milestone: m.index,
                                  decision: 'approve',
                                })
                              }
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              className="btn btn-outline btn-sm"
                              data-testid={`reject-${m.index}`}
                              disabled={busy}
                              onClick={() =>
                                void run('submitReview', {
                                  reviewer: address,
                                  issueId,
                                  milestone: m.index,
                                  decision: 'reject',
                                })
                              }
                            >
                              Reject
                            </button>
                          </>
                        )}
                        {!m.settled && address && (
                          <button
                            type="button"
                            className="btn btn-outline btn-sm"
                            data-testid={`open-dispute-${m.index}`}
                            disabled={busy}
                            onClick={() =>
                              void run('openDispute', {
                                opener: address,
                                issueId,
                                milestone: m.index,
                                reasonHash: reason,
                              })
                            }
                          >
                            Dispute
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {view.reviewers.length > 0 && (
            <div className="reviewer-list">
              <p className="subheading">Assigned reviewers</p>
              <ul>
                {view.reviewers.map((r) => (
                  <li key={r.reviewer} data-testid={`reviewer-${r.reviewer}`}>
                    <code className="contract-id">{shortAddress(r.reviewer, 8)}</code>
                    {r.reviews.length === 0 ? (
                      <span className="muted"> no reviews yet</span>
                    ) : (
                      r.reviews.map((rv) => (
                        <span key={`${r.reviewer}-${rv.milestone}`} className="muted">
                          {' '}
                          #{rv.milestone} {rv.decision}
                        </span>
                      ))
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <label className="form-field">
            <span>Dispute reason reference (optional, e.g. an IPFS URI)</span>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="ipfs://…"
              data-testid="dispute-reason"
            />
          </label>

          {openDispute && (
            <div className="dispute-box" data-testid="open-dispute">
              <p className="subheading">
                Dispute #{openDispute.id} on milestone {openDispute.milestone}
              </p>
              <p className="muted">
                opened by {shortAddress(openDispute.opener)} · votes to pay contributor{' '}
                {openDispute.votesPayContributor} · votes to refund {openDispute.votesRefundFunder}
              </p>
              {isReviewer && (
                <div className="action-row">
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    data-testid="vote-pay"
                    disabled={busy}
                    onClick={() =>
                      void run('voteDispute', {
                        reviewer: address,
                        disputeId: openDispute.id,
                        payContributor: true,
                      })
                    }
                  >
                    Vote: pay contributor
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    data-testid="vote-refund"
                    disabled={busy}
                    onClick={() =>
                      void run('voteDispute', {
                        reviewer: address,
                        disputeId: openDispute.id,
                        payContributor: false,
                      })
                    }
                  >
                    Vote: refund funder
                  </button>
                  {canPropose && (
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      data-testid="propose-resolve"
                      disabled={busy}
                      onClick={() =>
                        void run('proposeResolveDispute', {
                          proposer: address,
                          disputeId: openDispute.id,
                          payContributor:
                            openDispute.votesPayContributor >= openDispute.votesRefundFunder,
                        })
                      }
                    >
                      Propose resolution
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {step !== 'idle' && step !== 'done' && (
        <p className="form-progress" data-testid="milestone-progress">
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
        <p className="form-error" data-testid="milestone-error">
          {error}
        </p>
      )}
      {!account && <p className="state-hint">Connect Freighter to propose, review or dispute.</p>}
    </div>
  );
}
