# Contracts — Regulation Reckoning (Soroban)

Two Soroban smart contracts built with **soroban-sdk 27** and deployed on
**Stellar Testnet**: the bounty escrow and a contributors registry that the bounty
contract calls via inter-contract invocation.

## contracts/bounty — Bounty escrow

`BountyContract` lets a funder lock RRD demo tokens against an issue ID. Once the
issue is resolved, the admin releases the funds to the contributor's Stellar address.
The funder can reclaim tokens if a bounty goes unclaimed.

```
create(funder, token, amount, issue_id)  →  locks tokens in escrow (event: bounty_created)
release(issue_id, contributor)           →  admin releases; records the contributor in the
                                           registry contract (event: bounty_released)
reclaim(issue_id)                        →  funder reclaims if unclaimed (event: bounty_reclaimed)
get_bounty(issue_id)                     →  read bounty state
init(admin, registry)                    →  one-time bootstrap: admin + registry contract ID
                                           (event: admin_initialised)
```

On `release`, the contract calls `record(contributor, issue_id, amount)` on the
configured registry via `env.invoke_contract`, so every payout is permanently
recorded on-chain in a second contract — verifiable inter-contract communication.

## contracts/contributors — Contributors registry

`ContributorsRegistry` accumulates per-contributor payout stats:

```
init(allowed)    →  one-time bootstrap: the only address allowed to call `record`
record(contributor, issue_id, amount)  →  requires the allowed caller's auth (event:
                                           contributor_recorded)
stats(address)  →  { count, total } earned so far
```

Only the bounty contract (set as `allowed` at init) can write; anyone can read.

The backend exposes the registry stats live via `GET /api/contributors/:address`.

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
cargo test                                              # 21 unit tests (incl. inter-contract)
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo build --release --target wasm32v1-none            # production WASM
# Output: target/wasm32v1-none/release/regulation_reckoning_bounty.wasm

cd contracts/contributors
cargo test                                              # 7 unit tests
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo build --release --target wasm32v1-none            # production WASM
# Output: target/wasm32v1-none/release/regulation_reckoning_contributors.wasm
```

## Live Testnet deployment

| Artifact | ID |
|---|---|
| Bounty contract | `CCVDE7Q3UF4O223ONMLUPYPUZWFO7STOQJWCDD3C5LELDLU4GHOFLCH7` |
| Contributors registry | `CBIA55MJABCVVMZ6BMF3GNZ7USTNJW2ZJQMO2MNUXHFPRN34JOOES3CS` |
| Demo token (RRD SAC) | `CCOAF5DIHLO4457S6EGQYSLXGGDRQPTO42DU6N5KVH4M2MSA2VDW2NB4` |
| Admin | `GBRVOQSLP32BGOCYA56DCTM5PUQWW7YLBBAKVXBHDTJ6SNKVLGMWFRQI` |

### Deploy to Testnet (manual)

```bash
For the reproducible full sequence (both contracts + init + env file), run
`scripts/deploy-testnet.sh` from the repo root. Manual equivalent:

```bash
# 1. deploy bounty + registry + token (record the returned IDs)
stellar contract deploy --wasm <bounty.wasm> --source <SECRET> \
  --rpc-url https://soroban-testnet.stellar.org --network-passphrase "Test SDF Network ; September 2015"
stellar contract deploy --wasm <registry.wasm> --source <SECRET> \
  --rpc-url https://soroban-testnet.stellar.org --network-passphrase "Test SDF Network ; September 2015"
stellar contract asset deploy --asset "RRD:<PUBLIC>" --source <SECRET> \
  --rpc-url https://soroban-testnet.stellar.org --network-passphrase "Test SDF Network ; September 2015"

# 2. init registry (admin + allowed caller = bounty contract)
stellar contract invoke --id <REGISTRY_ID> --source <SECRET> \
  --rpc-url https://soroban-testnet.stellar.org --network-passphrase "Test SDF Network ; September 2015" \
  -- init --admin <PUBLIC> --allowed <BOUNTY_ID>

# 3. init bounty (admin + registry)
stellar contract invoke --id <BOUNTY_ID> --source <SECRET> \
  --rpc-url https://soroban-testnet.stellar.org --network-passphrase "Test SDF Network ; September 2015" \
  -- init --admin <PUBLIC> --registry <REGISTRY_ID>
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