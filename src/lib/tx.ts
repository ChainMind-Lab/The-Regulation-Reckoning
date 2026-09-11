/**
 * Shared "build → wallet sign → submit" flow.
 *
 * Every write action in the dashboard follows the same three steps, so the
 * sequence lives here rather than being re-implemented per component. The
 * frontend never holds a secret key: the backend builds and simulates the
 * transaction, Freighter signs it in the browser, and the backend submits it.
 */

import { buildTransaction, submitTransaction } from './api';
import { signTransactionXdr } from './wallet';
import type { TxAction } from './types';

export type TxStep = 'idle' | 'building' | 'signing' | 'submitting' | 'done';

export const TX_STEP_LABEL: Record<TxStep, string> = {
  idle: '',
  building: 'Building transaction…',
  signing: 'Waiting for Freighter signature…',
  submitting: 'Submitting to Stellar…',
  done: 'Transaction confirmed ✓',
};

export interface TxOutcome {
  hash: string;
  explorerUrl: string;
}

/**
 * Run the full relay flow for one contract action.
 *
 * `onStep` is called as the flow progresses so callers can render progress.
 * Any failure rejects — callers surface the message and reset their own state.
 */
export async function runTx(
  action: TxAction,
  source: string,
  extra: Record<string, unknown>,
  onStep: (step: TxStep) => void,
): Promise<TxOutcome> {
  onStep('building');
  const built = await buildTransaction(action, source, extra);
  onStep('signing');
  const signedXdr = await signTransactionXdr(built.txXdr, built.networkPassphrase);
  onStep('submitting');
  const result = await submitTransaction(signedXdr);
  onStep('done');
  return { hash: result.hash, explorerUrl: result.explorerUrl };
}

export function isSigner(signers: string[], address: string | null | undefined): boolean {
  if (!address) return false;
  return signers.includes(address);
}

export function shortAddress(address: string | null | undefined, chars = 6): string {
  if (!address) return '—';
  if (address.length <= chars * 2 + 1) return address;
  return `${address.slice(0, chars)}…${address.slice(-chars)}`;
}
