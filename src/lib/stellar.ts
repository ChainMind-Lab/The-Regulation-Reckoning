// Frontend Stellar lib — calls the backend API instead of Horizon directly.
// Set VITE_API_URL in .env to point at the backend (default: http://localhost:3001).

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

export type NetworkStatus = {
  network: string;
  horizon: string;
  protocolVersion: string;
  latestLedger: string;
  closedAt: string;
};

export async function getNetworkStatus(): Promise<NetworkStatus> {
  const res = await fetch(`${API_URL}/api/network`);
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

export async function getWaveInfo() {
  const res = await fetch(`${API_URL}/api/wave`);
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

export async function getOpenIssues() {
  const res = await fetch(`${API_URL}/api/issues`);
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}
