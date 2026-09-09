/**
 * Stellar Horizon integration (live network data).
 *
 * Uses @stellar/stellar-sdk v16 against the configured Horizon endpoint
 * (default: Stellar Testnet). All read-only.
 */

import { Horizon } from '@stellar/stellar-sdk';
import { config } from '../config';
import { metrics } from '../metrics';

export const horizonServer = new Horizon.Server(config.horizonUrl);

export interface NetworkStatus {
  network: string;
  horizon: string;
  protocolVersion: string;
  latestLedger: string;
  closedAt: string;
  sequence: string;
}

export async function fetchNetworkStatus(): Promise<NetworkStatus> {
  const started = Date.now();
  try {
    const ledgers = await horizonServer.ledgers().limit(1).order('desc').call();
    const latest = ledgers.records[0];
    metrics.observe('horizon_request_duration_ms', Date.now() - started);
    metrics.setGauge('horizon_up', 1);
    return {
      network: config.stellarNetworkPassphrase,
      horizon: config.horizonUrl,
      protocolVersion: String(latest.protocol_version),
      latestLedger: String(latest.sequence),
      closedAt: latest.closed_at,
      sequence: latest.id,
    };
  } catch (err) {
    metrics.setGauge('horizon_up', 0);
    throw err;
  }
}

export interface PaymentRecord {
  id: string;
  type: string;
  createdAt: string;
  transactionHash: string;
  amount: string | null;
  asset: string | null;
}

export async function fetchRecentPayments(limit = 10): Promise<PaymentRecord[]> {
  const started = Date.now();
  try {
    const payments = await horizonServer.payments().limit(limit).order('desc').call();
    metrics.observe('horizon_request_duration_ms', Date.now() - started);
    return payments.records.map((p) => ({
      id: p.id,
      type: p.type,
      createdAt: p.created_at,
      transactionHash: p.transaction_hash,
      amount: 'amount' in p ? p.amount : null,
      asset: 'asset_type' in p ? p.asset_type : null,
    }));
  } catch (err) {
    metrics.setGauge('horizon_up', 0);
    throw err;
  }
}

/** Quick liveness probe: latest ledger sequence, or throws. */
export async function pingHorizon(): Promise<number> {
  const ledgers = await horizonServer.ledgers().limit(1).order('desc').call();
  return Number(ledgers.records[0].sequence);
}
