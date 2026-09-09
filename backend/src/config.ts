/**
 * Centralised, validated environment configuration.
 *
 * Every value the backend reads from the environment is declared here with a
 * default and (where required) a runtime validation. Fail-fast at boot instead
 * of failing mysteriously at request time.
 *
 * Loads backend/.env (and .env.local) when present — see deploy-testnet.sh.
 */

import 'dotenv/config';

export type NetworkKind = 'testnet' | 'public';

function intEnv(name: string, fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`Invalid ${name}: expected integer in [${min}, ${max}], got "${raw}"`);
  }
  return n;
}

function boolEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  throw new Error(`Invalid ${name}: expected boolean, got "${raw}"`);
}

export const config = {
  // Server
  port: intEnv('PORT', 3001, 1, 65535),
  env: process.env.NODE_ENV ?? 'development',
  frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:4173',
  adminToken: process.env.ADMIN_TOKEN ?? '',

  // Database
  dbPath: process.env.DB_PATH ?? 'data/regulation-reckoning.db',

  // Stellar / Horizon
  horizonUrl: process.env.HORIZON_URL ?? 'https://horizon-testnet.stellar.org',
  stellarNetworkPassphrase:
    process.env.STELLAR_NETWORK_PASSPHRASE ?? 'Test SDF Network ; September 2015',
  sorobanRpcUrl: process.env.SOROBAN_RPC_URL ?? 'https://soroban-testnet.stellar.org',

  // Contract
  bountyContractId: process.env.BOUNTY_CONTRACT_ID ?? '',
  demoTokenId: process.env.DEMO_TOKEN_ID ?? '',
  // Admin public key (G...) used by the dashboard to gate release/reclaim UI.
  bountyAdminAddress: process.env.BOUNTY_ADMIN_ADDRESS ?? '',

  // Data ingestion
  githubRepo: process.env.GITHUB_REPO ?? '',
  githubToken: process.env.GITHUB_TOKEN ?? '',
  ingestOnStart: boolEnv('INGEST_ON_START', true),
  // If set, always re-ingest on boot (otherwise only when tables are empty).
  reingestOnStart: boolEnv('REINGEST_ON_START', false),

  // Indexer
  indexerEnabled: boolEnv('INDEXER_ENABLED', true),
  indexerIntervalMs: intEnv('INDEXER_INTERVAL_MS', 15_000, 2_000, 300_000),
  indexerStartLedger: intEnv('INDEXER_START_LEDGER', 0, 0),

  // Observability
  logLevel: process.env.LOG_LEVEL ?? 'info',

  // Rate limiting
  rateLimitWindowMs: intEnv('RATE_LIMIT_WINDOW_MS', 60_000, 1_000),
  rateLimitMax: intEnv('RATE_LIMIT_MAX', 120, 1),
} as const;

export type Config = typeof config;

/** True when the Soroban contract integration is fully configured. */
export function isContractConfigured(): boolean {
  return Boolean(config.bountyContractId);
}

export function getNetworkKind(): NetworkKind {
  return config.stellarNetworkPassphrase.includes('Test') ? 'testnet' : 'public';
}

/** Explorer base URL for linking transaction hashes in dashboards/logs. */
export function explorerTxUrl(hash: string): string {
  const network = getNetworkKind();
  return network === 'testnet'
    ? `https://stellar.expert/explorer/testnet/tx/${hash}`
    : `https://stellar.expert/explorer/public/tx/${hash}`;
}
