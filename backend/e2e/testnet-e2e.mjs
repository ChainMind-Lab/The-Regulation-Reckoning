#!/usr/bin/env node
/**
 * End-to-end Testnet proof: frontend action → wallet signature → Soroban
 * transaction → event/indexing → backend → dashboard.
 *
 * Prerequisites:
 *  - Backend running against Testnet with the deployed contract configured
 *    (BOUNTY_CONTRACT_ID, DEMO_TOKEN_ID, BOUNTY_ADMIN_ADDRESS) and the
 *    indexer enabled.
 *  - ADMIN_SECRET: the admin/deploy account secret (mints demo tokens and
 *    releases bounties). Passed via environment only — never committed.
 *
 * Run (from backend/):
 *   ADMIN_SECRET=S... node e2e/testnet-e2e.mjs
 *
 * The script exits non-zero on any failed assertion.
 */

import { Keypair, TransactionBuilder, Networks, rpc, xdr, StrKey } from '@stellar/stellar-sdk';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';
const RPC_URL = process.env.SOROBAN_RPC_URL ?? 'https://soroban-testnet.stellar.org';
const NETWORK_PASSPHRASE = process.env.STELLAR_NETWORK_PASSPHRASE ?? 'Test SDF Network ; September 2015';
const ADMIN_SECRET = process.env.ADMIN_SECRET;

function assert(cond, msg) {
  if (!cond) {
    console.error(`✗ FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`✓ ${msg}`);
}

async function get(path) {
  const res = await fetch(`${API_URL}${path}`);
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}

async function post(path, body) {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}

async function fundViaFriendbot(publicKey) {
  const res = await fetch(`https://friendbot.stellar.org?addr=${publicKey}`);
  if (!res.ok) throw new Error(`friendbot failed: ${res.status} ${await res.text()}`);
  return res.json();
}

// ── Soroban helpers (mint demo tokens as the issuer) ─────────────

const server = new rpc.Server(RPC_URL);
const HORIZON_URL = process.env.HORIZON_URL ?? 'https://horizon-testnet.stellar.org';

async function changeTrustRRD(account, issuerPublicKey) {
  const { Operation, Asset, TransactionBuilder, Horizon, Account } = await import('@stellar/stellar-sdk');
  const horizon = new Horizon.Server(HORIZON_URL);
  const acc = await horizon.loadAccount(account.publicKey());
  const tx = new TransactionBuilder(new Account(account.publicKey(), acc.sequence), {
    fee: '100',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(Operation.changeTrust({ asset: new Asset('RRD', issuerPublicKey), source: account.publicKey() }))
    .setTimeout(30)
    .build();
  tx.sign(account);
  await horizon.submitTransaction(tx);
}

function i128Val(value) {
  const big = BigInt(value);
  const lo = big & ((1n << 64n) - 1n);
  const hi = big >> 64n;
  return xdr.ScVal.scvI128(
    new xdr.Int128Parts({ lo: xdr.Uint64.fromString(lo.toString()), hi: xdr.Int64.fromString(hi.toString()) }),
  );
}

function addressVal(s) {
  if (s.startsWith('G')) {
    return xdr.ScVal.scvAddress(
      xdr.ScAddress.scAddressTypeAccount(xdr.PublicKey.publicKeyTypeEd25519(StrKey.decodeEd25519PublicKey(s))),
    );
  }
  return xdr.ScVal.scvAddress(
    xdr.ScAddress.scAddressTypeContract(xdr.Hash.fromXDR(StrKey.decodeContract(s))),
  );
}

async function waitForTransaction(hash) {
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTransaction', params: { hash } });
  for (let i = 0; i < 30; i += 1) {
    const res = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    const data = await res.json();
    const status = data.result?.status;
    if (status === 'SUCCESS') return;
    if (status === 'FAILED') throw new Error(`transaction ${hash} failed on ledger`);
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`transaction ${hash} timed out`);
}

async function invokeAndSubmit(contractId, fn, args, signer, label) {
  const account = await server.getAccount(signer.publicKey());
  const hostFn = xdr.HostFunction.hostFunctionTypeInvokeContract(
    new xdr.InvokeContractArgs({
      contractAddress: xdr.ScAddress.scAddressTypeContract(xdr.Hash.fromXDR(StrKey.decodeContract(contractId))),
      functionName: fn,
      args,
    }),
  );
  const { Operation, Account } = await import('@stellar/stellar-sdk');
  const tx = new TransactionBuilder(account, { fee: '100', networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(Operation.invokeHostFunction({ func: hostFn, source: signer.publicKey() }))
    .setTimeout(0)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (!sim || sim.error) throw new Error(`simulate ${fn} failed: ${sim?.error}`);
  const assembled = rpc.assembleTransaction(tx, sim).build();
  assembled.sign(signer);
  const send = await server.sendTransaction(assembled);
  if (send.status === 'ERROR') throw new Error(`send ${fn} failed: ${JSON.stringify(send.errorResult)}`);
  // Wait for finalization via raw JSON-RPC (XDR-parse-free).
  await waitForTransaction(send.hash);
  console.log(`✓ ${label} — tx ${send.hash}`);
  return send.hash;
}

async function pollUntil(fn, msg, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await fn()) {
      console.log(`✓ ${msg}`);
      return;
    }
    if (Date.now() > deadline) throw new Error(`Timed out waiting for: ${msg}`);
    await new Promise((r) => setTimeout(r, 2000));
  }
}

async function main() {
  assert(ADMIN_SECRET, 'ADMIN_SECRET env var is required');
  const admin = Keypair.fromSecret(ADMIN_SECRET);

  const contract = await get('/api/contract');
  assert(contract.configured, `backend reports contract configured (got ${JSON.stringify(contract)})`);
  const CONTRACT_ID = contract.contractId;
  const TOKEN_ID = contract.tokenId;
  assert(CONTRACT_ID && TOKEN_ID, 'contractId + tokenId reported by backend');

  // Fresh funder + contributor accounts (testnet, ephemeral).
  const funder = Keypair.random();
  const contributor = Keypair.random();
  await fundViaFriendbot(funder.publicKey());
  await fundViaFriendbot(contributor.publicKey());
  console.log(`✓ funded ephemeral accounts (funder ${funder.publicKey().slice(0, 8)}…)`);

  // Funder and contributor must trust the RRD asset before receiving minted tokens.
  await changeTrustRRD(funder, admin.publicKey());
  await changeTrustRRD(contributor, admin.publicKey());
  console.log('✓ funder + contributor trustlines to RRD established');

  // Admin mints demo tokens to the funder.
  await invokeAndSubmit(
    TOKEN_ID,
    'mint',
    [addressVal(funder.publicKey()), i128Val('1000')],
    admin,
    'minted 1000 RRD to funder',
  );

  const issueId = `e2e-${Date.now()}`;

  // ── Step 1+2: frontend action → backend builds unsigned tx → wallet signs ──
  const build = await post('/api/tx/build', {
    action: 'create',
    source: funder.publicKey(),
    funder: funder.publicKey(),
    token: TOKEN_ID,
    amount: '250',
    issueId,
  });
  assert(build.txXdr, 'POST /api/tx/build returned an unsigned transaction XDR');
  const unsigned = TransactionBuilder.fromXDR(build.txXdr, NETWORK_PASSPHRASE);
  unsigned.sign(funder); // = Freighter signTransaction(xdr, { networkPassphrase })
  const signedXdr = unsigned.toXDR();
  assert(signedXdr.length > 0, 'wallet (keypair) signed the transaction');

  // ── Step 3: submit the signed transaction ──
  const submitted = await post('/api/tx/submit', { signedXdr });
  assert(submitted.status === 'SUCCESS', `tx submitted (hash ${submitted.hash})`);
  const createTx = submitted.hash;

  // ── Step 4: event indexing → dashboard ──
  await pollUntil(
    async () => {
      const events = await get('/api/events');
      return events.some((e) => e.issueId === issueId && e.topic === 'bounty_created');
    },
    'bounty_created event indexed and visible at GET /api/events',
  );

  await pollUntil(
    async () => {
      const bounties = await get('/api/bounties');
      const b = bounties.find((x) => x.issueId === issueId);
      return b && !b.released;
    },
    'open bounty visible on dashboard (GET /api/bounties)',
  );
  const bounty = (await get('/api/bounties')).find((b) => b.issueId === issueId);
  assert(bounty.amount === '250', `dashboard shows amount 250 (got ${bounty.amount})`);
  assert(bounty.funder === funder.publicKey(), 'dashboard shows correct funder');

  // On-chain verification endpoint.
  const verified = await get(`/api/bounties/${issueId}`);
  assert(verified.verified === true && verified.amount === '250', 'GET /api/bounties/:id verifies state from the ledger');

  // ── Step 5: admin releases to the contributor ──
  const relBuild = await post('/api/tx/build', {
    action: 'release',
    source: admin.publicKey(),
    issueId,
    contributor: contributor.publicKey(),
  });
  const relUnsigned = TransactionBuilder.fromXDR(relBuild.txXdr, NETWORK_PASSPHRASE);
  relUnsigned.sign(admin);
  const relSubmitted = await post('/api/tx/submit', { signedXdr: relUnsigned.toXDR() });
  assert(relSubmitted.status === 'SUCCESS', `release tx submitted (hash ${relSubmitted.hash})`);
  const releaseTx = relSubmitted.hash;

  await pollUntil(
    async () => {
      const bounties = await get('/api/bounties');
      const b = bounties.find((x) => x.issueId === issueId);
      return b && b.released && b.contributor === contributor.publicKey();
    },
    'dashboard reflects released state with contributor',
  );

  // ── Step 6: inter-contract proof — the release recorded the payout in the
  // on-chain contributor registry (bounty contract → registry contract).
  await pollUntil(
    async () => {
      try {
        const stats = await get(`/api/contributors/${contributor.publicKey()}`);
        return stats.verified && Number(stats.count) === 1 && stats.total === '250';
      } catch {
        return false;
      }
    },
    'contributor registry shows count=1, total=250 on-chain',
  );

  console.log('\n── E2E PASSED ─────────────────────────────────────────────');
  console.log(`  issue:      ${issueId}`);
  console.log(`  create tx:  ${createTx}`);
  console.log(`  release tx: ${releaseTx}`);
  console.log(`  explorer:   https://stellar.expert/explorer/testnet/tx/${createTx}`);
  console.log('────────────────────────────────────────────────────────────');
}

main().catch((err) => {
  console.error('✗ E2E FAILED:', err.message);
  if (err.stack) console.error(err.stack.split('\n').slice(0, 8).join('\n'));
  process.exit(1);
});