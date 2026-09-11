#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# Reproducible Stellar Testnet deployment for The Regulation Reckoning.
#
# What it does (each step prints the on-chain artifacts):
#   1. Builds both Soroban contracts (bounty + contributors) to WASM (wasm32v1-none).
#   2. Generates a fresh deploy account (or reuses DEPLOY_SECRET if set).
#   3. Funds it via the Testnet Friendbot.
#   4. Deploys the bounty contract and records its ID.
#   5. Deploys the contributors registry contract and records its ID.
#   6. Deploys the RRD demo token (Soroban Asset Contract) and records its ID.
#   7. Initialises the registry (allowed caller = bounty contract) and the
#      bounty contract (admin + registry) — the inter-contract link.
#   8. Writes backend/.env.deployed with every value the backend needs.
#
# Requirements: cargo (rust) with wasm32v1-none target, a stellar-cli binary
# (STELLAR_CLI env var, defaults to `stellar` on PATH or /tmp/stellar-cli/stellar),
# and curl + node for account generation.
#
# Usage:
#   ./scripts/deploy-testnet.sh [--wasm /path/to/contract.wasm]
#
# The deployed IDs from the current live deployment are recorded in
# docs/DEPLOYMENT.md — run this again at any time to reproduce them.
# ─────────────────────────────────────────────────────────────────────
set -euo pipefail

cd "$(dirname "$0")/.."

export PATH="$HOME/.cargo/bin:$PATH"

STELLAR="${STELLAR_CLI:-}"
if [ -z "$STELLAR" ]; then
  if command -v stellar >/dev/null 2>&1; then
    STELLAR="stellar"
  elif [ -x /tmp/stellar-cli/stellar ]; then
    STELLAR="/tmp/stellar-cli/stellar"
  else
    echo "ERROR: stellar-cli not found. Set STELLAR_CLI=/path/to/stellar or install it." >&2
    exit 1
  fi
fi

RPC_URL="${SOROBAN_RPC_URL:-https://soroban-testnet.stellar.org}"
PASSPHRASE="${STELLAR_NETWORK_PASSPHRASE:-Test SDF Network ; September 2015}"
FRIENDBOT_URL="${FRIENDBOT_URL:-https://friendbot.stellar.org}"

# Latest ledger sequence from Soroban RPC (used as the indexer's start ledger
# so a fresh backend indexes the full history of the contracts deployed here).
rpc_latest_ledger() {
  curl -sS -X POST "$RPC_URL" -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"getLatestLedger","params":{}}' \
    | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{console.log(JSON.parse(s).result.sequence)}catch(e){console.log('0')}})"
}

echo "── Building bounty contract WASM ─────────────────────────────"
(cd contracts/bounty && cargo build --release --target wasm32v1-none)
WASM="contracts/bounty/target/wasm32v1-none/release/regulation_reckoning_bounty.wasm"
[ -f "$WASM" ] || { echo "ERROR: WASM not found at $WASM" >&2; exit 1; }
echo "WASM: $WASM ($(wc -c < "$WASM") bytes)"

echo "── Building contributors registry WASM ───────────────────────"
(cd contracts/contributors && cargo build --release --target wasm32v1-none)
REG_WASM="contracts/contributors/target/wasm32v1-none/release/regulation_reckoning_contributors.wasm"
[ -f "$REG_WASM" ] || { echo "ERROR: WASM not found at $REG_WASM" >&2; exit 1; }
echo "WASM: $REG_WASM ($(wc -c < "$REG_WASM") bytes)"

# Generate a Stellar keypair with zero dependencies (node:crypto + RFC4648
# base32 + CRC16-XModem, little-endian checksum — byte-compatible with
# @stellar/stellar-base). Prints JSON { G, S }.
GEN_KEYPAIR='
const crypto = require("node:crypto");
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function crc16(buf){let c=0;for(const b of buf){c^=b<<8;for(let i=0;i<8;i++)c=(c&0x8000)?((c<<1)^0x1021)&0xffff:(c<<1)&0xffff;}return c;}
function strKey(v,p){const w=Buffer.concat([Buffer.from([v]),p]);const k=crc16(w);const f=Buffer.concat([w,Buffer.from([k&0xff,(k>>8)&0xff])]);let bits=0,val=0,out="";for(const b of f){val=(val<<8)|b;bits+=8;while(bits>=5){out+=ALPHABET[(val>>>(bits-5))&31];bits-=5;}}if(bits>0)out+=ALPHABET[(val<<(5-bits))&31];return out;}
const {publicKey,privateKey}=crypto.generateKeyPairSync("ed25519");
const pub=Buffer.from(publicKey.export({format:"jwk"}).x,"base64url");
const seed=Buffer.from(privateKey.export({format:"jwk"}).d,"base64url");
console.log(JSON.stringify({G:strKey(0x30,pub),S:strKey(0x90,seed)}));
'

echo "── Deploy account ────────────────────────────────────────────"
if [ -n "${DEPLOY_SECRET:-}" ]; then
  SECRET="$DEPLOY_SECRET"
  PUBLIC=$(node -e "
    const crypto = require('node:crypto');
    const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    function crc16(buf){let c=0;for(const b of buf){c^=b<<8;for(let i=0;i<8;i++)c=(c&0x8000)?((c<<1)^0x1021)&0xffff:(c<<1)&0xffff;}return c;}
    function decode(s){let bits=0,val=0;const out=[];for(const ch of s){val=(val<<5)|ALPHABET.indexOf(ch);bits+=5;if(bits>=8){out.push((val>>>(bits-8))&0xff);bits-=8;}}
      const raw=Buffer.from(out);return raw.subarray(1,raw.length-2);}
    const seed=decode('$SECRET');
    const der=Buffer.concat([Buffer.from([0x30,0x2e,0x02,0x01,0x00,0x30,0x05,0x06,0x03,0x2b,0x65,0x70,0x04,0x22,0x04,0x20]),seed]);
    const pub=crypto.createPublicKey(crypto.createPrivateKey({key:der,format:'der',type:'pkcs8'}));
    const pubJwk=pub.export({format:'jwk'});
    function strKey(v,p){const w=Buffer.concat([Buffer.from([v]),p]);const k=crc16(w);const f=Buffer.concat([w,Buffer.from([k&0xff,(k>>8)&0xff])]);let bits=0,val=0,out='';for(const b of f){val=(val<<8)|b;bits+=8;while(bits>=5){out+=ALPHABET[(val>>>(bits-5))&31];bits-=5;}}if(bits>0)out+=ALPHABET[(val<<(5-bits))&31];return out;}
    console.log(strKey(0x30,Buffer.from(pubJwk.x,'base64url')));
  ")
  echo "Reusing DEPLOY_SECRET (account $PUBLIC)"
else
  ACCT_JSON=$(node -e "$GEN_KEYPAIR")
  PUBLIC=$(echo "$ACCT_JSON" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).G))")
  SECRET=$(echo "$ACCT_JSON" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).S))")
  echo "Generated new account $PUBLIC"
fi

echo "── Funding via Friendbot ─────────────────────────────────────"
curl -sS "${FRIENDBOT_URL}?addr=${PUBLIC}" >/dev/null || { echo "ERROR: friendbot failed" >&2; exit 1; }
echo "Funded $PUBLIC (10,000 XLM)"

echo "── Recording deployment ledger ───────────────────────────────"
DEPLOY_LEDGER=$(rpc_latest_ledger)
if [ -z "$DEPLOY_LEDGER" ] || [ "$DEPLOY_LEDGER" = "0" ]; then
  DEPLOY_LEDGER=0
  echo "WARNING: could not read the latest ledger; INDEXER_START_LEDGER will be 0" >&2
fi
echo "Indexer start ledger: $DEPLOY_LEDGER"

echo "── Deploying bounty contract ─────────────────────────────────"
BOUNTY_ID=$("$STELLAR" contract deploy \
  --wasm "$WASM" \
  --source-account "$SECRET" \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$PASSPHRASE" 2>&1 | tail -1)
echo "Bounty contract: $BOUNTY_ID"

echo "── Deploying contributors registry ────────────────────────────"
REGISTRY_ID=$("$STELLAR" contract deploy \
  --wasm "$REG_WASM" \
  --source-account "$SECRET" \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$PASSPHRASE" 2>&1 | tail -1)
echo "Registry contract: $REGISTRY_ID"

echo "── Deploying RRD demo token (SAC) ────────────────────────────"
# The SAC address is deterministic (issuer + asset code). Try to deploy it;
# if the token already exists on-chain the deploy fails with "contract already
# exists" — in that case reuse the deterministic ID. (A fresh issuer has no
# token yet, so always attempt the deploy first; merely computing the ID is
# NOT proof of deployment.)
TOKEN_DEPLOY_OUTPUT=$("$STELLAR" contract asset deploy \
  --asset "RRD:${PUBLIC}" \
  --source-account "$SECRET" \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$PASSPHRASE" 2>&1 || true)
if echo "$TOKEN_DEPLOY_OUTPUT" | grep -q "already exists"; then
  TOKEN_ID=$("$STELLAR" contract id asset --asset "RRD:${PUBLIC}" 2>/dev/null | tail -1)
  echo "Demo token already exists (deterministic SAC id): $TOKEN_ID"
elif [ -n "$TOKEN_DEPLOY_OUTPUT" ]; then
  TOKEN_ID=$(echo "$TOKEN_DEPLOY_OUTPUT" | tail -1)
  echo "Demo token deployed: $TOKEN_ID"
else
  echo "ERROR: token deploy returned no output" >&2
  exit 1
fi

echo "── Initialising contributors registry ────────────────────────"
"$STELLAR" contract invoke \
  --id "$REGISTRY_ID" \
  --source-account "$SECRET" \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$PASSPHRASE" \
  -- init --admin "$PUBLIC" --allowed-caller "$BOUNTY_ID" >/dev/null
echo "Registry initialised (admin: $PUBLIC, allowed caller: $BOUNTY_ID)"

echo "── Initialising bounty contract ──────────────────────────────"
# The registry argument is Option<Address>, which the CLI parses as JSON —
# pass the contract id as a JSON string so the address type is unambiguous.
"$STELLAR" contract invoke \
  --id "$BOUNTY_ID" \
  --source-account "$SECRET" \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$PASSPHRASE" \
  -- init --admin "$PUBLIC" --registry "\"$REGISTRY_ID\"" >/dev/null
echo "Contract initialised (admin: $PUBLIC, registry: $REGISTRY_ID)"

echo "── Writing backend/.env.deployed ─────────────────────────────"
cat > backend/.env.deployed <<EOF
# Generated by scripts/deploy-testnet.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ)
# Testnet deployment — do not use these values in production.
BOUNTY_CONTRACT_ID=$BOUNTY_ID
DEMO_TOKEN_ID=$TOKEN_ID
CONTRIBUTOR_REGISTRY_ID=$REGISTRY_ID
BOUNTY_ADMIN_ADDRESS=$PUBLIC
BOUNTY_ADMIN_SECRET=$SECRET
SOROBAN_RPC_URL=$RPC_URL
HORIZON_URL=https://horizon-testnet.stellar.org
STELLAR_NETWORK_PASSPHRASE=$PASSPHRASE
# Ledger the contracts above were deployed at — lets the indexer backfill history.
INDEXER_START_LEDGER=$DEPLOY_LEDGER
EOF
chmod 600 backend/.env.deployed

echo
echo "── Done ──────────────────────────────────────────────────────"
echo "  bounty contract:   $BOUNTY_ID"
echo "  contributors reg.: $REGISTRY_ID"
echo "  demo token:        $TOKEN_ID"
echo "  admin:             $PUBLIC"
echo "  env file:          backend/.env.deployed (keep it secret)"
echo
echo "Next: cp backend/.env.deployed backend/.env and start the backend."