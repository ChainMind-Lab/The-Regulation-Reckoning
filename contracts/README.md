# Contracts — Regulation Reckoning Bounty Escrow

Soroban smart contract for on-chain bounty escrow, built for **Stellar Drips Wave 5**.

## What it does

The `BountyContract` lets a funder lock USDC (or any Stellar token) against a specific GitHub issue ID. Once a contributor's PR is merged and verified, the admin releases the funds directly to the contributor's Stellar address. The funder can reclaim tokens if the bounty goes unclaimed.

```
create(funder, token, amount, issue_id)  →  locks tokens in escrow
release(issue_id, contributor)           →  admin releases to contributor
reclaim(issue_id)                        →  funder reclaims if unclaimed
get_bounty(issue_id)                     →  read bounty state
```

## Prerequisites

```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Add WASM target
rustup target add wasm32-unknown-unknown

# Install Stellar CLI
cargo install --locked stellar-cli --features opt
```

## Build

```bash
cd contracts/bounty
stellar contract build
# Output: target/wasm32-unknown-unknown/release/regulation_reckoning_bounty.wasm
```

## Test

```bash
cd contracts/bounty
cargo test
```

## Deploy to Testnet

```bash
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/regulation_reckoning_bounty.wasm \
  --source <YOUR_SECRET_KEY> \
  --network testnet
```

Copy the returned contract ID into `.env` as `BOUNTY_CONTRACT_ID`.

## Initialise

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <ADMIN_SECRET_KEY> \
  --network testnet \
  -- init --admin <ADMIN_ADDRESS>
```
