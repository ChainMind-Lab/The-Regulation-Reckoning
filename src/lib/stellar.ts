import { Server } from 'stellar-sdk';

export type NetworkStatus = {
  network: string;
  horizon: string;
  protocolVersion: string;
};

const HORIZON_URL = import.meta.env.VITE_HORIZON_URL ?? 'https://horizon.stellar.org';
const server = new Server(HORIZON_URL);

export async function getNetworkStatus(): Promise<NetworkStatus> {
  const root = await server.root();
  return {
    network: root.network_passphrase,
    horizon: HORIZON_URL,
    protocolVersion: String(root.protocol_version),
  };
}

export async function fetchAccountBalances(accountId: string) {
  const account = await server.loadAccount(accountId);
  return account.balances;
}

export async function fetchRecentPayments(limit = 10) {
  const payments = await server.payments().limit(limit).order('desc').call();
  return payments.records;
}
