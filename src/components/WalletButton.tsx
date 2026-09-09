import { useState } from 'react';
import { connectWallet, isFreighterAvailable, type WalletAccount } from '../lib/wallet';

type Props = {
  account: WalletAccount | null;
  onConnect: (account: WalletAccount) => void;
  onDisconnect: () => void;
};

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export default function WalletButton({ account, onConnect, onDisconnect }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  if (account) {
    return (
      <div className="wallet-box">
        <span className="wallet-address" title={account.address}>
          <span className="status-dot live" />
          {shortAddress(account.address)}
        </span>
        <button type="button" className="btn btn-outline btn-sm" onClick={onDisconnect}>
          Disconnect
        </button>
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
