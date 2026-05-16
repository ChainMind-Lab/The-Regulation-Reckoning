import { Server, Networks } from 'stellar-sdk';

const HORIZON_URL = process.env.HORIZON_URL ?? 'https://horizon.stellar.org';
export const server = new Server(HORIZON_URL);

export async function fetchNetworkStatus() {
  const ledgers = await server.ledgers().limit(1).order('desc').call();
  const latest = ledgers.records[0];
  return {
    network: Networks.PUBLIC,
    horizon: HORIZON_URL,
    protocolVersion: String(latest.protocol_version),
    latestLedger: String(latest.sequence),
    closedAt: latest.closed_at,
  };
}

export async function fetchRecentPayments(limit = 10) {
  const payments = await server.payments().limit(limit).order('desc').call();
  return payments.records.map((p) => ({
    id: p.id,
    type: p.type,
    createdAt: p.created_at,
    transactionHash: p.transaction_hash,
  }));
}
