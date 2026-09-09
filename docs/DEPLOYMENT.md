# Deployment — Stellar Testnet

This document records the **live Testnet deployment** and how to reproduce it. The
contract and token below are real: every address links to the Testnet explorer.

## Live deployment (2026-09-09)

| Artifact | Address / value |
|---|---|
| Bounty contract | [`CC2YEX6U7HV7L7L45HVOLVWGN2POARLPS3XICZS6KQH5Y52OTAHK7LVY`](https://stellar.expert/explorer/testnet/contract/CC2YEX6U7HV7L7L45HVOLVWGN2POARLPS3XICZS6KQH5Y52OTAHK7LVY) |
| Demo token (RRD SAC) | [`CCOAF5DIHLO4457S6EGQYSLXGGDRQPTO42DU6N5KVH4M2MSA2VDW2NB4`](https://stellar.expert/explorer/testnet/contract/CCOAF5DIHLO4457S6EGQYSLXGGDRQPTO42DU6N5KVH4M2MSA2VDW2NB4) |
| Contract admin | `GBRVOQSLP32BGOCYA56DCTM5PUQWW7YLBBAKVXBHDTJ6SNKVLGMWFRQI` |
| Network | Test SDF Network ; September 2015 |
| RPC | `https://soroban-testnet.stellar.org` |
| Horizon | `https://horizon-testnet.stellar.org` |

### Proof transactions (recorded during verification)

| Step | Transaction hash |
|---|---|
| Mint 1,000 RRD to e2e funder | [`3902c7e5bab688042852552fb2da1d6107570d47367d4552a16e54f5145b5188`](https://stellar.expert/explorer/testnet/tx/3902c7e5bab688042852552fb2da1d6107570d47367d4552a16e54f5145b5188) |
| Create bounty (`repo#42`, 250 RRD) | [`88e97e1750253c8bedc88383d28c37dcf9834d9168a7e2bbc2461948b48d72c6`](https://stellar.expert/explorer/testnet/tx/88e97e1750253c8bedc88383d28c37dcf9834d9168a7e2bbc2461948b48d72c6) |
| Release bounty to contributor | [`ee7f058ece2d81519c4762e265f82d277b2a245537878db4ef60e197db92c901`](https://stellar.expert/explorer/testnet/tx/ee7f058ece2d81519c4762e265f82d277b2a245537878db4ef60e197db92c901) |

These three hashes are the tail of the full proof chain exercised by
`backend/e2e/testnet-e2e.mjs`: funder account → trustline → mint → build/sign/submit
create → event indexed → dashboard → admin release → event indexed → dashboard.

## Reproduce the deployment

Prerequisites: Rust with the `wasm32v1-none` target, a `stellar-cli` binary, and Node ≥ 22.

```bash
# One-time: stellar-cli (any of)
cargo install --locked stellar-cli --features opt          # or
curl -sSL -o /tmp/stellar-cli.tar.gz <release tarball>     # prebuilt binary

# Full reproducible deploy: build WASM → fund account → deploy contract + token → init
./scripts/deploy-testnet.sh
# writes backend/.env.deployed with BOUNTY_CONTRACT_ID, DEMO_TOKEN_ID,
# BOUNTY_ADMIN_ADDRESS, BOUNTY_ADMIN_SECRET
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
| `BOUNTY_CONTRACT_ID` | `CC2YEX6U7HV7L7L45HVOLVWGN2POARLPS3XICZS6KQH5Y52OTAHK7LVY` |
| `DEMO_TOKEN_ID` | `CCOAF5DIHLO4457S6EGQYSLXGGDRQPTO42DU6N5KVH4M2MSA2VDW2NB4` |
| `BOUNTY_ADMIN_ADDRESS` | `GBRVOQSLP32BGOCYA56DCTM5PUQWW7YLBBAKVXBHDTJ6SNKVLGMWFRQI` |

## Run the end-to-end Testnet proof

With the backend running (above), from `backend/`:

```bash
ADMIN_SECRET=<deploy-account-secret> npm run e2e
```

The script funds two ephemeral accounts, establishes RRD trustlines, mints demo tokens,
creates a bounty through the build→sign→submit relay, asserts the event is indexed and
the dashboard reflects it, releases the bounty, and asserts the released state — exiting
non-zero on any failed assertion. It prints the fresh transaction hashes.

## Docker

```bash
docker compose up --build
# frontend on http://localhost:8080, API proxied to the backend
```

`BOUNTY_CONTRACT_ID`, `DEMO_TOKEN_ID`, and `BOUNTY_ADMIN_ADDRESS` default to the live
deployment values in `docker-compose.yml`.

## Rollback / migration notes

- Contracts are immutable; a new deploy creates a new contract ID (update the env).
- The SQLite read-model rebuilds itself from indexed events. To start clean,
  delete the DB file and restart the backend (the indexer re-fetches from
  `INDEXER_START_LEDGER`).