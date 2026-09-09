/**
 * Freighter (Stellar wallet) integration.
 *
 * The frontend never holds a secret key. The flow is:
 *   1. connectWallet() — user approves access in Freighter, we learn the address.
 *   2. signTransactionXdr() — the backend builds+simulates an unsigned XDR;
 *      Freighter signs it in the browser; the signed XDR is relayed to the
 *      backend for submission.
 *
 * Freighter injects `window.freighterApi`. See
 * https://docs.freighter.app/docs/guide/use-freighter-sdk/api
 */

export type WalletAccount = {
  address: string;
};

type FreighterApi = {
  isConnected?: () => Promise<boolean>;
  getAddress?: () => Promise<{ address?: string; publicKey?: string }>;
  signTransaction?: (
    xdr: string,
    opts?: { networkPassphrase?: string; network?: string },
  ) => Promise<{ signedXdr?: string }>;
};

function freighterApi(): FreighterApi | null {
  if (typeof window === 'undefined') return null;
  const api = (window as unknown as { freighterApi?: FreighterApi }).freighterApi;
  return api ?? null;
}

export function isFreighterAvailable(): boolean {
  return freighterApi() !== null;
}

export async function connectWallet(): Promise<WalletAccount> {
  const api = freighterApi();
  if (!api) {
    throw new Error(
      'Freighter is not installed. Install the Freighter browser extension, then reload.',
    );
  }
  if (api.isConnected) {
    const connected = await api.isConnected();
    if (!connected) {
      throw new Error('Freighter is locked or not connected. Unlock Freighter and try again.');
    }
  }
  if (!api.getAddress) {
    throw new Error('Freighter API is unavailable — upgrade Freighter to the latest version.');
  }
  const result = await api.getAddress();
  const address = result.address ?? result.publicKey;
  if (!address) {
    throw new Error('Freighter did not return an account address.');
  }
  return { address };
}

export async function signTransactionXdr(xdr: string, networkPassphrase: string): Promise<string> {
  const api = freighterApi();
  if (!api?.signTransaction) {
    throw new Error('Freighter is not available — cannot sign the transaction.');
  }
  const result = await api.signTransaction(xdr, { networkPassphrase });
  if (!result?.signedXdr) {
    throw new Error('Freighter did not return a signed transaction (signing cancelled?).');
  }
  return result.signedXdr;
}
