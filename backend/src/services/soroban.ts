/**
 * Soroban RPC integration (Stellar as the verifiable source of truth).
 *
 * Responsibilities:
 *  - Read contract state (`get_bounty`, `is_initialised`) directly from the
 *    ledger via `simulateTransaction`.
 *  - Build + simulate unsigned Soroban transactions server-side, producing the
 *    XDR that the wallet signs (Freighter in the browser, or a keypair in
 *    scripts / e2e tests).
 *  - Submit signed transaction XDR to the network and wait for inclusion.
 *  - Fetch contract events (`getEvents`) for the indexer.
 */

import {
  Asset,
  Horizon,
  Networks,
  Operation,
  StrKey,
  TransactionBuilder,
  xdr,
  rpc,
} from '@stellar/stellar-sdk';
import { config, isContractConfigured } from '../config';
import { logger } from '../logger';
import { metrics } from '../metrics';

export class SorobanError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly detail?: unknown,
  ) {
    super(message);
    this.name = 'SorobanError';
  }
}

export function requireContractConfigured(): void {
  if (!isContractConfigured()) {
    throw new SorobanError(
      'BOUNTY_CONTRACT_ID is not configured; set it to the deployed contract address.',
      'CONTRACT_NOT_CONFIGURED',
    );
  }
}

export const sorobanServer = new rpc.Server(config.sorobanRpcUrl, {
  allowHttp: config.sorobanRpcUrl.startsWith('http://'),
});

export const stellarNetworkPassphrase =
  config.stellarNetworkPassphrase === Networks.TESTNET ? Networks.TESTNET : Networks.PUBLIC;

/** Determine network kind from the passphrase. */
export function networkKind(): 'testnet' | 'public' {
  return config.stellarNetworkPassphrase === Networks.TESTNET ? 'testnet' : 'public';
}

// ── ScVal encoding ─────────────────────────────────────────────────

export type TxArg =
  | { type: 'address'; value: string }
  | { type: 'string'; value: string }
  | { type: 'i128'; value: string };

export function encodeArg(arg: TxArg): xdr.ScVal {
  switch (arg.type) {
    case 'address': {
      const s = arg.value;
      if (s.startsWith('G')) {
        return xdr.ScVal.scvAddress(
          xdr.ScAddress.scAddressTypeAccount(
            xdr.PublicKey.publicKeyTypeEd25519(StrKey.decodeEd25519PublicKey(s)),
          ),
        );
      }
      if (s.startsWith('C')) {
        // v16 types brand Hash as Opaque[]; the runtime accepts raw bytes.
        return xdr.ScVal.scvAddress(
          xdr.ScAddress.scAddressTypeContract(StrKey.decodeContract(s) as unknown as xdr.Hash),
        );
      }
      throw new SorobanError(`Invalid address argument: ${s}`, 'BAD_ARG');
    }
    case 'string':
      return xdr.ScVal.scvString(arg.value);
    case 'i128': {
      const big = BigInt(arg.value);
      const lo = big & ((1n << 64n) - 1n);
      const hi = big >> 64n;
      return xdr.ScVal.scvI128(
        new xdr.Int128Parts({
          lo: xdr.Uint64.fromString(lo.toString()),
          hi: xdr.Int64.fromString(hi.toString()),
        }),
      );
    }
    default:
      throw new SorobanError('Unknown argument type', 'BAD_ARG');
  }
}

// ── ScVal decoding (JSON-safe; scValToNative chokes on BigInt in maps) ──

export function decodeScVal(v: unknown): unknown {
  if (!v || typeof v !== 'object' || typeof (v as { switch?: unknown }).switch !== 'function') {
    return v;
  }
  const scv = v as xdr.ScVal;
  const name = scv.switch().name as string;
  switch (name) {
    case 'scvSymbol':
      return (scv as { sym(): { toString(): string } }).sym().toString();
    case 'scvString':
      return (scv as { str(): { toString(): string } }).str().toString();
    case 'scvAddress': {
      const addr = (scv as { address(): xdr.ScAddress }).address();
      const an = addr.switch().name as string;
      if (an === 'scAddressTypeAccount') {
        return StrKey.encodeEd25519PublicKey(
          (addr as { accountId(): { ed25519(): Buffer } }).accountId().ed25519(),
        );
      }
      return StrKey.encodeContract(
        (addr as unknown as { contractId(): Uint8Array }).contractId() as Buffer,
      );
    }
    case 'scvI128': {
      const parts = (scv as { i128(): { hi(): xdr.Int64; lo(): xdr.Uint64 } }).i128();
      const loBig = bigFromXdr(parts.lo());
      const hiBig = bigFromXdr(parts.hi());
      return ((hiBig << 64n) | (loBig & ((1n << 64n) - 1n))).toString();
    }
    case 'scvU32':
      return (scv as { u32(): number }).u32();
    case 'scvBool':
      return (scv as { b(): boolean }).b();
    case 'scvVoid':
      return null;
    case 'scvMap': {
      const out: Record<string, unknown> = {};
      const entries = (scv as { map(): Array<{ key(): xdr.ScVal; val(): xdr.ScVal }> }).map();
      for (const entry of entries) {
        const k = decodeScVal(entry.key());
        out[String(k)] = decodeScVal(entry.val());
      }
      return out;
    }
    case 'scvVec':
      return (scv as { vec(): Array<xdr.ScVal> }).vec().map(decodeScVal);
    case 'scvU64':
      return bigFromXdr((scv as { u64(): xdr.Uint64 }).u64()).toString();
    case 'scvI64':
      return bigFromXdr((scv as { i64(): xdr.Int64 }).i64()).toString();
    default:
      return null;
  }
}

function bigFromXdr(n: { toBigInt?: () => bigint; toString(): string }): bigint {
  if (typeof n.toBigInt === 'function') return n.toBigInt();
  return BigInt(n.toString());
}

function contractScAddress(contractId: string): xdr.ScAddress {
  // v16 types brand Hash as Opaque[]; the runtime accepts raw bytes.
  return xdr.ScAddress.scAddressTypeContract(
    StrKey.decodeContract(contractId) as unknown as xdr.Hash,
  );
}

// ── Transaction building / submission ─────────────────────────────

function invokeHostFunctionOp(
  fn: string,
  args: TxArg[],
  source: string,
  contractId: string = config.bountyContractId,
): xdr.Operation {
  const hostFn = xdr.HostFunction.hostFunctionTypeInvokeContract(
    new xdr.InvokeContractArgs({
      contractAddress: contractScAddress(contractId),
      functionName: fn,
      args: args.map(encodeArg),
    }),
  );
  return Operation.invokeHostFunction({ func: hostFn, source });
}

/**
 * Build an unsigned, simulated transaction for a contract invocation.
 * The returned XDR carries the simulation's footprint and (for state-changing
 * calls) the authorization entries the signer must approve.
 */
export async function buildContractTransaction(
  fn: string,
  args: TxArg[],
  sourcePublicKey: string,
): Promise<{ txXdr: string }> {
  requireContractConfigured();
  const started = Date.now();
  try {
    const account = await sorobanServer.getAccount(sourcePublicKey);
    const tx = new TransactionBuilder(account, {
      fee: '100',
      networkPassphrase: config.stellarNetworkPassphrase,
    })
      .addOperation(invokeHostFunctionOp(fn, args, sourcePublicKey))
      .setTimeout(0)
      .build();

    const sim = await sorobanServer.simulateTransaction(tx);
    metrics.observe('soroban_request_duration_ms', Date.now() - started);
    if ('error' in sim && sim.error) {
      throw new SorobanError(`Simulation failed for ${fn}: ${sim.error}`, 'SIMULATION_FAILED', sim);
    }
    const simResult = sim as rpc.Api.SimulateTransactionSuccessResponse;
    if (!simResult.result) {
      throw new SorobanError(`Simulation produced no result for ${fn}`, 'SIMULATION_FAILED', sim);
    }
    const assembled = rpc.assembleTransaction(tx, simResult);
    return { txXdr: assembled.build().toXDR() };
  } catch (err) {
    metrics.setGauge('soroban_up', 0);
    if (err instanceof SorobanError) throw err;
    throw new SorobanError(`Failed to build transaction: ${String(err)}`, 'BUILD_FAILED', err);
  }
}

/** Submit a signed transaction XDR and wait for it to be included in a ledger. */
export async function submitSignedTransaction(
  signedXdr: string,
): Promise<{ hash: string; status: string }> {
  const started = Date.now();
  try {
    const tx = TransactionBuilder.fromXDR(signedXdr, config.stellarNetworkPassphrase);
    const send = await sorobanServer.sendTransaction(tx);
    metrics.observe('soroban_request_duration_ms', Date.now() - started);

    if (send.status === 'ERROR') {
      throw new SorobanError(
        `Transaction rejected by network: ${JSON.stringify(send.errorResult ?? send)}`,
        'TX_REJECTED',
        send,
      );
    }
    const deadline = Date.now() + 30_000;
    // Poll until the transaction is finalized. We use the raw JSON-RPC
    // endpoint (not the SDK's getTransaction) because the SDK's XDR parser
    // lags behind newer Testnet protocol versions; `status` needs no parsing.
    for (;;) {
      const result = await rawGetTransaction(send.hash);
      if (result.status === 'SUCCESS') return { hash: send.hash, status: 'SUCCESS' };
      if (result.status === 'FAILED') {
        throw new SorobanError(
          `Transaction failed on ledger: ${result.errorResult?.result?.code?.name ?? 'unknown'}`,
          'TX_FAILED',
          result,
        );
      }
      if (Date.now() > deadline) {
        throw new SorobanError('Transaction submission timed out', 'TX_TIMEOUT', {
          hash: send.hash,
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  } catch (err) {
    if (err instanceof SorobanError) throw err;
    throw new SorobanError(`Failed to submit transaction: ${String(err)}`, 'SUBMIT_FAILED', err);
  }
}

// ── On-chain reads ────────────────────────────────────────────────

export interface BountyOnChain {
  funder: string;
  contributor: string | null;
  token: string;
  amount: string;
  issue_id: string;
  released: boolean;
}

/** Read a bounty directly from the ledger via a simulated `get_bounty` call. */
export async function readBounty(issueId: string): Promise<BountyOnChain | null> {
  requireContractConfigured();
  const source = config.bountyAdminAddress;
  if (!source) {
    throw new SorobanError(
      'BOUNTY_ADMIN_ADDRESS is required for on-chain reads',
      'ADMIN_NOT_CONFIGURED',
    );
  }
  try {
    const account = await sorobanServer.getAccount(source);
    const tx = new TransactionBuilder(account, {
      fee: '100',
      networkPassphrase: config.stellarNetworkPassphrase,
    })
      .addOperation(
        invokeHostFunctionOp('get_bounty', [{ type: 'string', value: issueId }], source),
      )
      .setTimeout(0)
      .build();
    const sim = await sorobanServer.simulateTransaction(tx);
    const retval = ('result' in sim ? sim.result?.retval : undefined) as xdr.ScVal | undefined;
    if (!retval || retval.switch().name === 'scvVoid') return null;
    const native = decodeScVal(retval) as Record<string, unknown>;
    return {
      funder: String(native.funder ?? ''),
      contributor: native.contributor ? String(native.contributor) : null,
      token: String(native.token ?? ''),
      amount: String(native.amount ?? '0'),
      issue_id: String(native.issue_id ?? ''),
      released: Boolean(native.released),
    };
  } catch (err) {
    logger.warn('soroban.readBounty failed', { issueId, err: String(err) });
    return null;
  }
}

export interface ContributorStatsOnChain {
  count: number;
  total: string;
}

/**
 * Read a contributor's aggregated stats directly from the on-chain registry
 * via a simulated `stats` call (inter-contract communication proof point).
 */
export async function readContributorStats(
  contributor: string,
): Promise<ContributorStatsOnChain | null> {
  const registryId = config.contributorRegistryId;
  if (!registryId || !config.bountyAdminAddress) return null;
  try {
    const account = await sorobanServer.getAccount(config.bountyAdminAddress);
    const tx = new TransactionBuilder(account, {
      fee: '100',
      networkPassphrase: config.stellarNetworkPassphrase,
    })
      .addOperation(
        invokeHostFunctionOp(
          'stats',
          [{ type: 'address', value: contributor }],
          config.bountyAdminAddress,
          registryId,
        ),
      )
      .setTimeout(0)
      .build();
    const sim = await sorobanServer.simulateTransaction(tx);
    const retval = ('result' in sim ? sim.result?.retval : undefined) as xdr.ScVal | undefined;
    if (!retval || retval.switch().name === 'scvVoid') return null;
    const native = decodeScVal(retval) as Record<string, unknown>;
    return {
      count: Number(native.count ?? 0),
      total: String(native.total ?? '0'),
    };
  } catch (err) {
    logger.warn('soroban.readContributorStats failed', { contributor, err: String(err) });
    return null;
  }
}

/** Read `is_initialised` from the ledger. */
export async function isContractInitialised(): Promise<boolean> {
  requireContractConfigured();
  const source = config.bountyAdminAddress;
  if (!source) throw new SorobanError('BOUNTY_ADMIN_ADDRESS required', 'ADMIN_NOT_CONFIGURED');
  try {
    const account = await sorobanServer.getAccount(source);
    const tx = new TransactionBuilder(account, {
      fee: '100',
      networkPassphrase: config.stellarNetworkPassphrase,
    })
      .addOperation(invokeHostFunctionOp('is_initialised', [], source))
      .setTimeout(0)
      .build();
    const sim = await sorobanServer.simulateTransaction(tx);
    return Boolean('result' in sim && sim.result?.retval?.b?.());
  } catch {
    return false;
  }
}

// ── Events ────────────────────────────────────────────────────────

export interface SorobanContractEvent {
  id: string;
  txHash: string;
  ledger: number;
  contractId: string;
  topic: string;
  issueId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

/** Fetch contract events from Soroban RPC, oldest first. */
export async function fetchContractEvents(
  cursor: string | null,
  limit = 100,
): Promise<{ events: SorobanContractEvent[]; nextCursor: string | null }> {
  requireContractConfigured();
  const started = Date.now();
  try {
    const latest = await sorobanServer.getLatestLedger();
    const filters = [
      {
        type: 'contract' as const,
        contractIds: [config.bountyContractId],
      },
    ];
    // The RPC rejects requests that set both a cursor and a start ledger, and the
    // SDK types encode that as two mutually exclusive request shapes.
    const request = cursor
      ? { filters, cursor, limit }
      : {
          startLedger: config.indexerStartLedger || Math.max(1, latest.sequence - 1000),
          filters,
          limit,
        };
    const response = await sorobanServer.getEvents(
      request as Parameters<typeof sorobanServer.getEvents>[0],
    );
    metrics.observe('soroban_request_duration_ms', Date.now() - started);
    metrics.setGauge('soroban_up', 1);

    const events: SorobanContractEvent[] = [];
    let nextCursor: string | null = null;
    for (const e of response.events) {
      if (e.inSuccessfulContractCall === false) continue;
      nextCursor = e.id ?? nextCursor;
      const parsed = parseEvent(e);
      if (!parsed) continue;
      events.push(parsed);
    }
    return { events, nextCursor };
  } catch (err) {
    metrics.setGauge('soroban_up', 0);
    throw new SorobanError(
      `Failed to fetch contract events: ${String(err)}`,
      'EVENTS_FETCH_FAILED',
      err,
    );
  }
}

function parseEvent(e: rpc.Api.EventResponse): SorobanContractEvent | null {
  if (!e.topic || e.topic.length === 0) return null;
  const name = String(decodeScVal(e.topic[0]) ?? '');
  if (!name) return null;
  let issueId: string | null = null;
  if (e.topic.length > 1) {
    const second = decodeScVal(e.topic[1]);
    if (typeof second === 'string') issueId = second;
  }
  const payload = (decodeScVal(e.value) ?? {}) as Record<string, unknown>;
  return {
    id: e.id ?? `${e.ledger}:${e.txHash}`,
    txHash: e.txHash,
    ledger: e.ledger,
    contractId: config.bountyContractId,
    topic: name,
    issueId,
    payload,
    createdAt: e.ledgerClosedAt ?? new Date().toISOString(),
  };
}

/** Raw JSON-RPC `getTransaction`, XDR-parse-free (protocol-version tolerant). */
async function rawGetTransaction(hash: string): Promise<{
  status: string;
  errorResult?: { result?: { code?: { name?: string } } };
}> {
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'getTransaction',
    params: { hash },
  });
  const res = await fetch(config.sorobanRpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  if (!res.ok) throw new SorobanError(`RPC getTransaction HTTP ${res.status}`, 'RPC_HTTP');
  const data = (await res.json()) as {
    result?: { status?: string; errorResult?: { result?: { code?: { name?: string } } } };
  };
  return { status: data.result?.status ?? 'UNKNOWN', errorResult: data.result?.errorResult };
}

/** SAC contract id for a classic asset (used by scripts + tests). */
export function assetContractId(code: string, issuer: string): string {
  return new Asset(code, issuer).contractId(config.stellarNetworkPassphrase);
}

/** Deterministic account (for simulations) — exported for tests. */
export { Horizon };
