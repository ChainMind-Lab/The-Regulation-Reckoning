# Contracts — Regulation Reckoning Bounty Escrow

Soroban smart contract for on-chain bounty escrow, built with **soroban-sdk 27** and
deployed on **Stellar Testnet**.

## What it does

`BountyContract` lets a funder lock RRD demo tokens against an issue ID. Once the
issue is resolved, the admin releases the funds to the contributor's Stellar address.
The funder can reclaim tokens if a bounty goes unclaimed.

```
create(funder, token, amount, issue_id)  →  locks tokens in escrow (event: bounty_created)
release(issue_id, contributor)           →  admin releases to contributor (event: bounty_released)
reclaim(issue_id)                        →  funder reclaims if unclaimed (event: bounty_reclaimed)
get_bounty(issue_id)                     →  read bounty state
init(admin)                              →  one-time admin bootstrap (event: admin_initialised)
```

## Prerequisites

```bash
# Rust (stable)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# WASM target used by Soroban SDK 27
rustup target add wasm32v1-none

# Stellar CLI (for deploy)
cargo install --locked stellar-cli --features opt
```

## Build, test, lint

```bash
cd contracts/bounty
cargo test                                              # 19 unit tests
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo build --release --target wasm32v1-none            # production WASM
# Output: target/wasm32v1-none/release/regulation_reckoning_bounty.wasm
```

## Live Testnet deployment

| Artifact | ID |
|---|---|
| Bounty contract | `CC2YEX6U7HV7L7L45HVOLVWGN2POARLPS3XICZS6KQH5Y52OTAHK7LVY` |
| Demo token (RRD SAC) | `CCOAF5DIHLO4457S6EGQYSLXGGDRQPTO42DU6N5KVH4M2MSA2VDW2NB4` |
| Admin | `GBRVOQSLP32BGOCYA56DCTM5PUQWW7YLBBAKVXBHDTJ6SNKVLGMWFRQI` |

### Deploy to Testnet (manual)

```bash
stellar contract deploy \
  --wasm target/wasm32v1-none/release/regulation_reckoning_bounty.wasm \
  --source <YOUR_SECRET_KEY> \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015"
```

### Deploy the demo token

```bash
stellar contract asset deploy \
  --asset "RRD:<ISSUER_PUBLIC_KEY>" \
  --source <YOUR_SECRET_KEY> \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015"
```

### Initialise

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <ADMIN_SECRET_KEY> \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015" \
  -- init --admin <ADMIN_ADDRESS>
```

The entire sequence (build → fund → deploy contract + token → init) is automated by
`scripts/deploy-testnet.sh` at the repo root — see `docs/DEPLOYMENT.md`.