# Deployment — Stellar Testnet

This document records the **live Testnet deployment** and how to reproduce it. The
contracts below are real: every address links to the Testnet explorer.

## Live deployment (2026-09-09, redeployed)

| Artifact | Address / value |
|---|---|
| Bounty contract | [`CB4OI57YRKLAIX2RGFS7DX3GIGEST4MSI447VAJPRCBCNFUHWLWLQLWT`](https://stellar.expert/explorer/testnet/contract/CB4OI57YRKLAIX2RGFS7DX3GIGEST4MSI447VAJPRCBCNFUHWLWLQLWT) |
| Contributors registry | [`CC53MJDM5M76GMZONKC56ONW4MM74MX3KF4LSXMWTRE7W66RASDP4W7Q`](https://stellar.expert/explorer/testnet/contract/CC53MJDM5M76GMZONKC56ONW4MM74MX3KF4LSXMWTRE7W66RASDP4W7Q) |
| Demo token (RRD SAC) | [`CB7NFW2WD3FXKBYANZX7J3FO6PBST2H3IE6SPHXHSWIQESII2P2A6Y6P`](https://stellar.expert/explorer/testnet/contract/CB7NFW2WD3FXKBYANZX7J3FO6PBST2H3IE6SPHXHSWIQESII2P2A6Y6P) |
| Contract admin | `GB2OVPTEO2BYRRRRWNRPZZOC3VW77IQDXJPBY2WYV2MXSU7C5HQDZ6E6` |
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
| Registry initialised (allowed caller = bounty) | [`6105dd787dc2dc57cb3fd5806c7fc2a37bbad11eb1a0ba86bb33d32f6d790182`](https://stellar.expert/explorer/testnet/tx/6105dd787dc2dc57cb3fd5806c7fc2a37bbad11eb1a0ba86bb33d32f6d790182) |
| Bounty initialised (admin + registry) | [`27e6a457261cbae1bfb711391c95ff85d9dfef3860f69a4d4017f265ac8c9b77`](https://stellar.expert/explorer/testnet/tx/27e6a457261cbae1bfb711391c95ff85d9dfef3860f69a4d4017f265ac8c9b77) |
| Create bounty (`e2e-…`, 250 RRD) | [`8e04ed19cf52b20d53271bf7103c64568ad68e79bb70f1da048fe7ebd0a67c3e`](https://stellar.expert/explorer/testnet/tx/8e04ed19cf52b20d53271bf7103c64568ad68e79bb70f1da048fe7ebd0a67c3e) |
| Release bounty → contributor recorded in registry | [`bfe1d5d2e1efb3d3b60706ef9bec4c31ec00e11c6de6b6c18e365df0106709c5`](https://stellar.expert/explorer/testnet/tx/bfe1d5d2e1efb3d3b60706ef9bec4c31ec00e11c6de6b6c18e365df0106709c5) |

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
BOUNTY_CONTRACT_ID=CB4OI57YRKLAIX2RGFS7DX3GIGEST4MSI447VAJPRCBCNFUHWLWLQLWT \
DEMO_TOKEN_ID=CB7NFW2WD3FXKBYANZX7J3FO6PBST2H3IE6SPHXHSWIQESII2P2A6Y6P \
CONTRIBUTOR_REGISTRY_ID=CC53MJDM5M76GMZONKC56ONW4MM74MX3KF4LSXMWTRE7W66RASDP4W7Q \
BOUNTY_ADMIN_ADDRESS=GB2OVPTEO2BYRRRRWNRPZZOC3VW77IQDXJPBY2WYV2MXSU7C5HQDZ6E6 \
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
| `BOUNTY_CONTRACT_ID` | `CB4OI57YRKLAIX2RGFS7DX3GIGEST4MSI447VAJPRCBCNFUHWLWLQLWT` |
| `DEMO_TOKEN_ID` | `CB7NFW2WD3FXKBYANZX7J3FO6PBST2H3IE6SPHXHSWIQESII2P2A6Y6P` |
| `CONTRIBUTOR_REGISTRY_ID` | `CC53MJDM5M76GMZONKC56ONW4MM74MX3KF4LSXMWTRE7W66RASDP4W7Q` |
| `BOUNTY_ADMIN_ADDRESS` | `GB2OVPTEO2BYRRRRWNRPZZOC3VW77IQDXJPBY2WYV2MXSU7C5HQDZ6E6` |

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