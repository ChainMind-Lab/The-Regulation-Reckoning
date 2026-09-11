/**
 * Freighter (Stellar wallet) integration.
 *
 * The frontend never holds a secret key. The flow is:
 *   1. connectWallet() — user approves access in Freighter, we learn the address.
 *   2. signTransactionXdr() — the backend builds+simulates an unsigned XDR;
 *      Freighter signs it in the browser; the signed XDR is relayed to the
 *      backend for submission.
 *
 * Freighter exposes itself as `window.freighterApi` (the injected global; also
 * wrapped by the `@stellar/freighter-api` package). Response shapes differ
 * between versions, so the helpers below accept both the current documented
 * shape and the legacy one:
 *   signTransaction(xdr, opts) -> { signedTxXdr, signerAddress } | string
 *   getAddress()               -> { address } | { publicKey } | string
 *   getNetwork()               -> { network, networkPassphrase }
 *   isConnected()              -> boolean | { isConnected }
 * Errors are *returned* (as `{ error }`) rather than thrown in recent versions.
 *
 * See https://docs.freighter.app/
 */

export type WalletAccount = {
  address: string;
};

type FreighterError = { message?: string } | string | undefined;

type FreighterApi = {
  isConnected?: () => Promise<boolean | { isConnected?: boolean; error?: FreighterError }>;
  getAddress?: () => Promise<
    { address?: string; publicKey?: string; error?: FreighterError } | string
  >;
  getNetwork?: () => Promise<{
    network?: string;
    networkPassphrase?: string;
    error?: FreighterError;
  }>;
  signTransaction?: (
    xdr: string,
    opts?: { networkPassphrase?: string; network?: string },
  ) => Promise<
    | string
    | {
        signedTxXdr?: string;
        signedXdr?: string;
        signerAddress?: string;
        error?: FreighterError;
      }
  >;
};

/** Stellar Testnet passphrase (must match the deployed Soroban network). */
export const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';

function errorMessage(err: FreighterError, fallback: string): string {
  if (!err) return fallback;
  if (typeof err === 'string') return err;
  return err.message ?? fallback;
}

/** True when Freighter returned an error object/string instead of a result. */
function returnedError(result: unknown): FreighterError {
  if (!result || typeof result !== 'object') return undefined;
  const maybe = (result as { error?: FreighterError }).error;
  return maybe || undefined;
}

/**
 * Read the network Freighter is currently on. Returns null when Freighter does
 * not expose getNetwork (older versions) or when the wallet is disconnected.
 */
export async function getWalletNetwork(): Promise<string | null> {
  const api = freighterApi();
  if (!api?.getNetwork) return null;
  try {
    const result = await api.getNetwork();
    return result?.networkPassphrase ?? result?.network ?? null;
  } catch {
    return null;
  }
}

/** True when the wallet reports a network other than Stellar Testnet. */
export async function isWrongNetwork(): Promise<boolean> {
  const network = await getWalletNetwork();
  if (network === null) return false; // cannot determine — assume fine
  return network !== TESTNET_PASSPHRASE;
}

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
    // Current API returns { isConnected, error? }; legacy returns a boolean.
    const isConnected =
      typeof connected === 'boolean' ? connected : (connected?.isConnected ?? false);
    if (!isConnected) {
      throw new Error('Freighter is locked or not connected. Unlock Freighter and try again.');
    }
  }
  if (!api.getAddress) {
    throw new Error('Freighter API is unavailable — upgrade Freighter to the latest version.');
  }
  const result = await api.getAddress();
  if (returnedError(result)) {
    throw new Error(errorMessage(returnedError(result), 'Freighter did not return an address.'));
  }
  const address = typeof result === 'string' ? result : (result.address ?? result.publicKey);
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

  // Legacy Freighter returned the signed XDR as a plain string.
  if (typeof result === 'string') {
    if (!result) throw new Error('Freighter returned an empty signed transaction.');
    return result;
  }

  const err = returnedError(result);
  if (err) {
    throw new Error(errorMessage(err, 'Freighter rejected the signing request.'));
  }

  // Current API: { signedTxXdr }. Older wrappers used { signedXdr }.
  const signed = result?.signedTxXdr ?? result?.signedXdr;
  if (!signed) {
    throw new Error('Freighter did not return a signed transaction (signing cancelled?).');
  }
  return signed;
}
