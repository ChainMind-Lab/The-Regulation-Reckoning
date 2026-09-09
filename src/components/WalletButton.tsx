import { useEffect, useState } from 'react';
import {
  connectWallet,
  getWalletNetwork,
  isFreighterAvailable,
  isWrongNetwork,
  TESTNET_PASSPHRASE,
  type WalletAccount,
} from '../lib/wallet';

type Props = {
  account: WalletAccount | null;
  onConnect: (account: WalletAccount) => void;
  onDisconnect: () => void;
};

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

export default function WalletButton({ account, onConnect, onDisconnect }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [walletNetwork, setWalletNetwork] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (account) {
      void isWrongNetwork().then((wrong) => {
        if (!cancelled && wrong) {
          void getWalletNetwork().then((n) => {
            if (!cancelled) setWalletNetwork(n);
          });
        }
      });
    } else {
      setWalletNetwork(null);
    }
    return () => {
      cancelled = true;
    };
  }, [account]);

  async function handleConnect() {
    setBusy(true);
    setError(null);
    try {
      const acc = await connectWallet();
      onConnect(acc);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect Freighter');
    } finally {
      setBusy(false);
    }
  }

  async function handleCopy() {
    if (!account) return;
    await copyText(account.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (account) {
    return (
      <div className="wallet-box">
        <button
          type="button"
          className="wallet-address"
          title={`${account.address} — click to copy`}
          onClick={handleCopy}
          data-testid="copy-address"
        >
          <span className="status-dot live" />
          {shortAddress(account.address)}
          {copied && <span className="copied-hint">copied</span>}
        </button>
        <button type="button" className="btn btn-outline btn-sm" onClick={onDisconnect}>
          Disconnect
        </button>
        {walletNetwork && (
          <span className="network-warning" role="alert" data-testid="wrong-network">
            Wrong network: Freighter is on “{walletNetwork}”. Switch to Stellar Testnet (“
            {TESTNET_PASSPHRASE}”) to fund or release bounties.
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="wallet-box">
      <button
        type="button"
        className="btn btn-primary btn-sm"
        onClick={handleConnect}
        disabled={busy || !isFreighterAvailable()}
        data-testid="connect-wallet"
      >
        {busy ? 'Connecting…' : isFreighterAvailable() ? 'Connect Freighter' : 'Freighter required'}
      </button>
      {error && (
        <span className="form-error" data-testid="wallet-error">
          {error}
        </span>
      )}
    </div>
  );
}
