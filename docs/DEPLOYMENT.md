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
| Deployment ledger | `4588860` |
| Network | Test SDF Network ; September 2015 |
| RPC | `https://soroban-testnet.stellar.org` |
| Horizon | `https://horizon-testnet.stellar.org` |

The **contributors registry** is the second Soroban contract: the bounty contract
calls it via inter-contract invocation (`env.invoke_contract`) on every release,
and it accumulates per-contributor totals on-chain. The backend reads it live
(`GET /api/contributors/:address`) to prove the inter-contract link, and the indexer
records the registry's `contributor_recorded` event alongside the bounty events.

### Proof transactions (recorded during verification)

| Step | Transaction hash |
|---|---|
| Registry initialised (allowed caller = bounty) | [`6105dd787dc2dc57cb3fd5806c7fc2a37bbad11eb1a0ba86bb33d32f6d790182`](https://stellar.expert/explorer/testnet/tx/6105dd787dc2dc57cb3fd5806c7fc2a37bbad11eb1a0ba86bb33d32f6d790182) |
| Bounty initialised (admin + registry) | [`27e6a457261cbae1bfb711391c95ff85d9dfef3860f69a4d4017f265ac8c9b77`](https://stellar.expert/explorer/testnet/tx/27e6a457261cbae1bfb711391c95ff85d9dfef3860f69a4d4017f265ac8c9b77) |
| Create bounty (`e2e-…`, 250 RRD) | [`8e04ed19cf52b20d53271bf7103c64568ad68e79bb70f1da048fe7ebd0a67c3e`](https://stellar.expert/explorer/testnet/tx/8e04ed19cf52b20d53271bf7103c64568ad68e79bb70f1da048fe7ebd0a67c3e) |
| Release bounty → contributor recorded in registry | [`bfe1d5d2e1efb3d3b60706ef9bec4c31ec00e11c6de6b6c18e365df0106709c5`](https://stellar.expert/explorer/testnet/tx/bfe1d5d2e1efb3d3b60706ef9bec4c31ec00e11c6de6b6c18e365df0106709c5) |

These four transactions are the tail of the full proof chain exercised by
`backend/e2e/testnet-e2e.mjs`: funder account → trustline → mint → build/sign/submit
create → event indexed → dashboard → admin release → **bounty → registry
inter-contract call** → event indexed → dashboard → registry stats (`count=1,
total=250`) read back from the chain.

## Run the stack against the live deployment

There is no permanently hosted instance (public Codespace URLs expire). Run it locally:

```bash
# 1. Backend against the live Testnet deployment
cd backend && npm ci && npm run build
BOUNTY_CONTRACT_ID=CB4OI57YRKLAIX2RGFS7DX3GIGEST4MSI447VAJPRCBCNFUHWLWLQLWT \
DEMO_TOKEN_ID=CB7NFW2WD3FXKBYANZX7J3FO6PBST2H3IE6SPHXHSWIQESII2P2A6Y6P \
CONTRIBUTOR_REGISTRY_ID=CC53MJDM5M76GMZONKC56ONW4MM74MX3KF4LSXMWTRE7W66RASDP4W7Q \
BOUNTY_ADMIN_ADDRESS=GB2OVPTEO2BYRRRRWNRPZZOC3VW77IQDXJPBY2WYV2MXSU7C5HQDZ6E6 \
INDEXER_START_LEDGER=4588860 \
TRUST_PROXY=true \
node dist/server.js

# 2. Frontend pointed at the backend (dev server proxies nothing, so set the URL)
cd .. && VITE_API_URL=http://localhost:3001 npm run build
npx vite preview --port 4173 --host 0.0.0.0

# or simply run both dev servers:
#   cd backend && npm run dev      (http://localhost:3001)
#   npm run dev                    (http://localhost:4173)
```

`INDEXER_START_LEDGER=4588860` is what makes a fresh database show the full on-chain
history. Omitting it (or setting `0`) limits the first indexer pass to a recent window,
so the dashboard starts empty.

Required variables:

| Variable | Value |
|---|---|
| `BOUNTY_CONTRACT_ID` | `CB4OI57YRKLAIX2RGFS7DX3GIGEST4MSI447VAJPRCBCNFUHWLWLQLWT` |
| `DEMO_TOKEN_ID` | `CB7NFW2WD3FXKBYANZX7J3FO6PBST2H3IE6SPHXHSWIQESII2P2A6Y6P` |
| `CONTRIBUTOR_REGISTRY_ID` | `CC53MJDM5M76GMZONKC56ONW4MM74MX3KF4LSXMWTRE7W66RASDP4W7Q` |
| `BOUNTY_ADMIN_ADDRESS` | `GB2OVPTEO2BYRRRRWNRPZZOC3VW77IQDXJPBY2WYV2MXSU7C5HQDZ6E6` |
| `INDEXER_START_LEDGER` | `4588860` |

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
cp .env.example .env    # optional: override BOUNTY_* values
docker compose up --build
# frontend on http://localhost:8080, API proxied to the backend
```

`BOUNTY_CONTRACT_ID`, `DEMO_TOKEN_ID`, `CONTRIBUTOR_REGISTRY_ID`,
`BOUNTY_ADMIN_ADDRESS`, and `INDEXER_START_LEDGER` default to the live deployment values
in `docker-compose.yml`. The frontend image is built with an empty `VITE_API_URL` so the
browser calls the same origin and nginx proxies `/api` to the backend.

## Reproduce the deployment

Prerequisites: Rust with the `wasm32v1-none` target, a `stellar-cli` binary, and
Node ≥ 22.13.

```bash
# One-time: stellar-cli (any of)
cargo install --locked stellar-cli --features opt          # or
curl -sSL -o /tmp/stellar-cli.tar.gz <release tarball>     # prebuilt binary

# Full reproducible deploy: build WASMs → fund account → deploy both contracts +
# token → init registry (allowed caller) → init bounty (admin + registry)
./scripts/deploy-testnet.sh
# writes backend/.env.deployed with BOUNTY_CONTRACT_ID, DEMO_TOKEN_ID,
# CONTRIBUTOR_REGISTRY_ID, BOUNTY_ADMIN_ADDRESS, BOUNTY_ADMIN_SECRET,
# and INDEXER_START_LEDGER (the ledger the deployment landed in)
```

`scripts/deploy-testnet.sh` is the exact sequence used for the live deployment. Each run
produces a *new* contract (contracts are immutable); the recorded IDs above remain the
canonical live ones.

## Rollback / migration notes

- Contracts are immutable; a new deploy creates a new contract ID (update the env and
  set `INDEXER_START_LEDGER` to the new deployment ledger).
- The SQLite read-model rebuilds itself from indexed events. To start clean,
  delete the DB file and restart the backend (the indexer re-fetches from
  `INDEXER_START_LEDGER`).
