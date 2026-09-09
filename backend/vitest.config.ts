import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    fileParallelism: false,
    env: {
      DB_PATH: ':memory:',
      HORIZON_URL: 'https://horizon-testnet.stellar.org',
      SOROBAN_RPC_URL: 'https://soroban-testnet.stellar.org',
      STELLAR_NETWORK_PASSPHRASE: 'Test SDF Network ; September 2015',
      INGEST_ON_START: 'false',
      INDEXER_ENABLED: 'false',
      RATE_LIMIT_MAX: '1000',
      BOUNTY_CONTRACT_ID: 'CDE5G6LZC27ZXEYTZAELNSMHLZAR6PNLTP3UMJZNAQ7TXDG337A7DBR6',
      DEMO_TOKEN_ID: 'CCOAF5DIHLO4457S6EGQYSLXGGDRQPTO42DU6N5KVH4M2MSA2VDW2NB4',
      CONTRIBUTOR_REGISTRY_ID: 'CALHU2WW55X5RZMHSN4LVLU2K46SGJNYW3BFGAPDJYBQRRD6T3EEUFD2',
      BOUNTY_ADMIN_ADDRESS: 'GBRVOQSLP32BGOCYA56DCTM5PUQWW7YLBBAKVXBHDTJ6SNKVLGMWFRQI',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/server.ts', 'src/scripts/**'],
    },
  },
});
