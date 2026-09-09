# Deployment — Stellar Testnet

This document records the **live Testnet deployment** and how to reproduce it. The
contracts below are real: every address links to the Testnet explorer.

## Live deployment (2026-09-09, redeployed)

| Artifact | Address / value |
|---|---|
| Bounty contract | [`CDE5G6LZC27ZXEYTZAELNSMHLZAR6PNLTP3UMJZNAQ7TXDG337A7DBR6`](https://stellar.expert/explorer/testnet/contract/CDE5G6LZC27ZXEYTZAELNSMHLZAR6PNLTP3UMJZNAQ7TXDG337A7DBR6) |
| Contributors registry | [`CALHU2WW55X5RZMHSN4LVLU2K46SGJNYW3BFGAPDJYBQRRD6T3EEUFD2`](https://stellar.expert/explorer/testnet/contract/CALHU2WW55X5RZMHSN4LVLU2K46SGJNYW3BFGAPDJYBQRRD6T3EEUFD2) |
| Demo token (RRD SAC) | [`CCOAF5DIHLO4457S6EGQYSLXGGDRQPTO42DU6N5KVH4M2MSA2VDW2NB4`](https://stellar.expert/explorer/testnet/contract/CCOAF5DIHLO4457S6EGQYSLXGGDRQPTO42DU6N5KVH4M2MSA2VDW2NB4) |
| Contract admin | `GBRVOQSLP32BGOCYA56DCTM5PUQWW7YLBBAKVXBHDTJ6SNKVLGMWFRQI` |
| Network | Test SDF Network ; September 2015 |
| RPC | `https://soroban-testnet.stellar.org` |
| Horizon | `https://horizon-testnet.stellar.org` |

The **contributors registry** is the second Soroban contract: the bounty contract
calls it via inter-contract invocation (`env.invoke_contract`) on every release,
and it accumulates per-contributor totals on-chain. The backend reads it live
(`/api/registry`) to prove the inter-contract link.

### Proof transactions (recorded during verification)

| Step | Transaction hash |
|---|---|
| Registry initialised (allowed caller = bounty) | [`b211edd3e84cf691e65cf96980ea69bf1a49bfc8d31b672e9390d34a8d47da78`](https://stellar.expert/explorer/testnet/tx/b211edd3e84cf691e65cf96980ea69bf1a49bfc8d31b672e9390d34a8d47da78) |
| Bounty initialised (admin + registry) | [`a099ff84df7142b12daac71673b95b88846924537ec4e4bd385c11a884c4d052`](https://stellar.expert/explorer/testnet/tx/a099ff84df7142b12daac71673b95b88846924537ec4e4bd385c11a884c4d052) |
| Create bounty (`e2e-…`, 250 RRD) | [`51e0d18457320f7b858f672cc6fd5d0d733c21b529f0eacf0c9c758f36709332`](https://stellar.expert/explorer/testnet/tx/51e0d18457320f7b858f672cc6fd5d0d733c21b529f0eacf0c9c758f36709332) |
| Release bounty → contributor recorded in registry | [`733365c09660dbd05bac8d85658f6bd438a7d811560de865c06ab8c2a0ed3d37`](https://stellar.expert/explorer/testnet/tx/733365c09660dbd05bac8d85658f6bd438a7d811560de865c06ab8c2a0ed3d37) |

The last two hashes are the tail of the full proof chain exercised by
`backend/e2e/testnet-e2e.mjs`: funder account → trustline → mint → build/sign/submit
create → event indexed → dashboard → admin release → **bounty → registry
inter-contract call** → event indexed → dashboard → registry stats (`count=1,
total=250`) read back from the chain.

## Live demo

The dashboard is hosted with public port forwarding from a GitHub Codespace:

- Frontend: `https://crispy-palm-tree-6vggrx996gvqfxxjx-4173.app.github.dev`
- Backend API: `https://crispy-palm-tree-6vggrx996gvqfxxjx-3001.app.github.dev`

The backend runs the committed code with `BOUNTY_CONTRACT_ID` / `DEMO_TOKEN_ID` /
`CONTRIBUTOR_REGISTRY_ID` / `BOUNTY_ADMIN_ADDRESS` set to the live deployment above
and `INDEXER_ENABLED=true`; the frontend is the Vite production build with
`VITE_API_URL` set to the public backend URL. The indexer has already ingested the
full on-chain history of both contracts, so the dashboard shows real transactions —
not seeds.

### Host it yourself (Codespaces or any host)

```bash
# 1. Run the backend against the live Testnet deployment
cd backend && npm ci && npm run build
BOUNTY_CONTRACT_ID=CDE5G6LZC27ZXEYTZAELNSMHLZAR6PNLTP3UMJZNAQ7TXDG337A7DBR6 \
DEMO_TOKEN_ID=CCOAF5DIHLO4457S6EGQYSLXGGDRQPTO42DU6N5KVH4M2MSA2VDW2NB4 \
CONTRIBUTOR_REGISTRY_ID=CALHU2WW55X5RZMHSN4LVLU2K46SGJNYW3BFGAPDJYBQRRD6T3EEUFD2 \
BOUNTY_ADMIN_ADDRESS=GBRVOQSLP32BGOCYA56DCTM5PUQWW7YLBBAKVXBHDTJ6SNKVLGMWFRQI \
FRONTEND_URL=<your-frontend-origin> node dist/server.js

# 2. Build + serve the frontend pointed at the public backend
VITE_API_URL=https://<your-host>/ npm run build
npx vite preview --port 4173 --host 0.0.0.0
```

In a Codespace, make the ports public so the `.app.github.dev` URLs are reachable:

```bash
gh codespace ports visibility 3001:public 4173:public
```

Note: `.app.github.dev` URLs live for as long as the codespace runs; for an
always-on demo, deploy `docker compose up` to any host (see below).

## Reproduce the deployment

Prerequisites: Rust with the `wasm32v1-none` target, a `stellar-cli` binary, and Node ≥ 22.

```bash
# One-time: stellar-cli (any of)
cargo install --locked stellar-cli --features opt          # or
curl -sSL -o /tmp/stellar-cli.tar.gz <release tarball>     # prebuilt binary

# Full reproducible deploy: build WASMs → fund account → deploy both contracts +
# token → init registry (allowed caller) → init bounty (admin + registry)
./scripts/deploy-testnet.sh
# writes backend/.env.deployed with BOUNTY_CONTRACT_ID, DEMO_TOKEN_ID,
# CONTRIBUTOR_REGISTRY_ID, BOUNTY_ADMIN_ADDRESS, BOUNTY_ADMIN_SECRET
```

`scripts/deploy-testnet.sh` is the exact sequence used for the live deployment. It is
idempotent in the sense that each run produces a *new* contract (contracts are
immutable); the recorded IDs above remain the canonical live ones.

## Run the backend against the deployment

```bash
cd backend
npm install
cp .env.deployed .env        # or export the variables
npm run dev                  # starts server + ingestion + event indexer
curl localhost:3001/health/ready
```

Required variables:

| Variable | Value |
|---|---|
| `BOUNTY_CONTRACT_ID` | `CDE5G6LZC27ZXEYTZAELNSMHLZAR6PNLTP3UMJZNAQ7TXDG337A7DBR6` |
| `DEMO_TOKEN_ID` | `CCOAF5DIHLO4457S6EGQYSLXGGDRQPTO42DU6N5KVH4M2MSA2VDW2NB4` |
| `CONTRIBUTOR_REGISTRY_ID` | `CALHU2WW55X5RZMHSN4LVLU2K46SGJNYW3BFGAPDJYBQRRD6T3EEUFD2` |
| `BOUNTY_ADMIN_ADDRESS` | `GBRVOQSLP32BGOCYA56DCTM5PUQWW7YLBBAKVXBHDTJ6SNKVLGMWFRQI` |

## Run the end-to-end Testnet proof

With the backend running (above), from `backend/`:

```bash
ADMIN_SECRET=<deploy-account-secret> npm run e2e
```

The script funds two ephemeral accounts, establishes RRD trustlines, mints demo tokens,
creates a bounty through the build→sign→submit relay, asserts the event is indexed and
the dashboard reflects it, releases the bounty (which triggers the inter-contract
registry write), asserts the released state **and** reads the registry stats back
(`count`, `total`), and exits non-zero on any failed assertion. It prints the fresh
transaction hashes.

## Docker

```bash
docker compose up --build
# frontend on http://localhost:8080, API proxied to the backend
```

`BOUNTY_CONTRACT_ID`, `DEMO_TOKEN_ID`, `CONTRIBUTOR_REGISTRY_ID`, and
`BOUNTY_ADMIN_ADDRESS` default to the live deployment values in `docker-compose.yml`.

## Rollback / migration notes

- Contracts are immutable; a new deploy creates a new contract ID (update the env).
- The SQLite read-model rebuilds itself from indexed events. To start clean,
  delete the DB file and restart the backend (the indexer re-fetches from
  `INDEXER_START_LEDGER`).