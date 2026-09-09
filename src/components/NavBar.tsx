import WalletButton from './WalletButton';
import type { WalletAccount } from '../lib/wallet';

type Props = {
  account: WalletAccount | null;
  onConnect: (account: WalletAccount) => void;
  onDisconnect: () => void;
};

export default function NavBar({ account, onConnect, onDisconnect }: Props) {
  return (
    <nav className="navbar">
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <span className="navbar-brand">⬡ Regulation Reckoning</span>
      </div>
      <ul className="navbar-links">
        <li>
          <a href="#network">Network</a>
        </li>
        <li>
          <a href="#bounties">Bounties</a>
        </li>
        <li>
          <a href="#events">Events</a>
        </li>
        <li>
          <a href="#regulatory">Regulatory</a>
        </li>
        <li>
          <a
            href="https://github.com/ChainMind-Lab/The-Regulation-Reckoning"
            target="_blank"
            rel="noreferrer"
          >
            GitHub
          </a>
        </li>
      </ul>
      <WalletButton account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
    </nav>
  );
}
