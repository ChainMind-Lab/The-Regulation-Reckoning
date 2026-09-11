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
init(admin, allowed_caller)  →  one-time bootstrap: admin (retained for future ops)
                               and the only contract allowed to call `record`
record(contributor, issue_id, amount)  →  requires the allowed caller's auth (event:
                                           contributor_recorded)
stats(address)  →  { count, total } earned so far
```

Only the bounty contract (set as `allowed_caller` at init) can write; anyone can read.

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
cargo test                                              # 47 unit tests (milestones, reviews, disputes, multisig, inter-contract)
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo build --release --target wasm32v1-none            # production WASM
# Output: target/wasm32v1-none/release/regulation_reckoning_bounty.wasm

cd contracts/contributors
cargo test                                              # 18 unit tests (incl. reputation)
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo build --release --target wasm32v1-none            # production WASM
# Output: target/wasm32v1-none/release/regulation_reckoning_contributors.wasm
```

## Live Testnet deployment

| Artifact | ID |
|---|---|
| Bounty contract | `CB4OI57YRKLAIX2RGFS7DX3GIGEST4MSI447VAJPRCBCNFUHWLWLQLWT` |
| Contributors registry | `CC53MJDM5M76GMZONKC56ONW4MM74MX3KF4LSXMWTRE7W66RASDP4W7Q` |
| Demo token (RRD SAC) | `CB7NFW2WD3FXKBYANZX7J3FO6PBST2H3IE6SPHXHSWIQESII2P2A6Y6P` |
| Admin | `GB2OVPTEO2BYRRRRWNRPZZOC3VW77IQDXJPBY2WYV2MXSU7C5HQDZ6E6` |

### Deploy to Testnet

The recommended path is the automated script at the repo root, which performs the whole
sequence (build both WASMs → fund a fresh account → deploy both contracts + the RRD
token → init the registry → init the bounty → write `backend/.env.deployed`):

```bash
./scripts/deploy-testnet.sh
```

See [`docs/DEPLOYMENT.md`](../docs/DEPLOYMENT.md) for the recorded deployment and the
manual equivalent. If you do deploy by hand, note the exact argument names:

```bash
# deploy bounty + registry + the RRD SAC (record the returned IDs)
stellar contract deploy --wasm <bounty.wasm> --source-account <SECRET> \
  --rpc-url https://soroban-testnet.stellar.org --network-passphrase "Test SDF Network ; September 2015"
stellar contract deploy --wasm <registry.wasm> --source-account <SECRET> \
  --rpc-url https://soroban-testnet.stellar.org --network-passphrase "Test SDF Network ; September 2015"
stellar contract asset deploy --asset "RRD:<PUBLIC>" --source-account <SECRET> \
  --rpc-url https://soroban-testnet.stellar.org --network-passphrase "Test SDF Network ; September 2015"

# init registry (admin + allowed caller = bounty contract). NOTE: --allowed-caller
stellar contract invoke --id <REGISTRY_ID> --source-account <SECRET> \
  --rpc-url https://soroban-testnet.stellar.org --network-passphrase "Test SDF Network ; September 2015" \
  -- init --admin <PUBLIC> --allowed-caller <BOUNTY_ID>

# init bounty (admin + registry). The registry is Option<Address>, passed as a JSON string.
stellar contract invoke --id <BOUNTY_ID> --source-account <SECRET> \
  --rpc-url https://soroban-testnet.stellar.org --network-passphrase "Test SDF Network ; September 2015" \
  -- init --admin <PUBLIC> --registry '"<REGISTRY_ID>"'
```