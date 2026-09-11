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
  | { type: 'i128'; value: string }
  | { type: 'u32'; value: number | string }
  | { type: 'u64'; value: number | string }
  | { type: 'bool'; value: boolean }
  | { type: 'option'; value: TxArg | null }
  | { type: 'vec'; value: TxArg[] }
  /** A `#[contracttype]` struct: rendered as a map of field name → value. */
  | { type: 'struct'; value: Record<string, TxArg> }
  /**
   * A `#[contracttype]` enum with data-bearing (tuple) variants.
   *
   * The soroban-sdk derive macro picks one of two representations (verified
   * against soroban-sdk-macros 27.0.6 `lib.rs`):
   *   - all variants carry an explicit integer discriminant (e.g.
   *     `enum ReviewDecision { Approve = 0, Reject = 1 }`) → encoded as `u32`
   *     of the discriminant, so use `{ type: 'u32' }`;
   *   - otherwise (`enum ProposalAction { Release(String, u32), .. }`) →
   *     encoded as a vector of `[Symbol(variant), ...fields]`, which is what
   *     this `enum` type produces.
   */
  | { type: 'enum'; variant: string; value: TxArg[] };

/** Encode a typed argument into a Soroban `ScVal`. */
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
    case 'u32': {
      const n = Number(arg.value);
      if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) {
        throw new SorobanError(`Invalid u32 argument: ${String(arg.value)}`, 'BAD_ARG');
      }
      return xdr.ScVal.scvU32(n);
    }
    case 'u64': {
      const big = BigInt(arg.value);
      if (big < 0n || big > (1n << 64n) - 1n) {
        throw new SorobanError(`Invalid u64 argument: ${String(arg.value)}`, 'BAD_ARG');
      }
      return xdr.ScVal.scvU64(xdr.Uint64.fromString(big.toString()));
    }
    case 'bool':
      return xdr.ScVal.scvBool(arg.value);
    case 'option':
      return arg.value === null ? xdr.ScVal.scvVoid() : encodeArg(arg.value);
    case 'vec':
      return xdr.ScVal.scvVec(arg.value.map(encodeArg));
    case 'struct':
      return xdr.ScVal.scvMap(
        Object.entries(arg.value).map(
          ([key, val]) =>
            new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(key), val: encodeArg(val) }),
        ),
      );
    case 'enum':
      return xdr.ScVal.scvVec([
        xdr.ScVal.scvSymbol(arg.variant),
        ...arg.value.map(encodeArg),
      ]);
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
      // Bounded time bounds — avoids transactions that stay valid indefinitely.
      .setTimeout(180)
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
    // The upstream RPC answered successfully; record it for the health gauge.
    metrics.setGauge('soroban_up', 1);
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
      .setTimeout(180)
      .build();
    const sim = await sorobanServer.simulateTransaction(tx);
    if ('error' in sim && sim.error) {
      // BountyError::BountyNotFound (contract error code 6) means the bounty
      // genuinely does not exist. Any other error is an upstream failure and
      // must not be reported to clients as "not found".
      if (/BountyNotFound|Error\(Contract, #6\)/.test(String(sim.error))) return null;
      throw new SorobanError(`Failed to read bounty ${issueId}`, 'READ_FAILED', sim);
    }
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
    if (err instanceof SorobanError) throw err;
    logger.warn('soroban.readBounty failed', { issueId, err: String(err) });
    throw new SorobanError(`Failed to read bounty ${issueId}`, 'READ_FAILED', err);
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
      .setTimeout(180)
      .build();
    const sim = await sorobanServer.simulateTransaction(tx);
    if ('error' in sim && sim.error) {
      throw new SorobanError(
        `Failed to read registry stats for ${contributor}`,
        'READ_FAILED',
        sim,
      );
    }
    const retval = ('result' in sim ? sim.result?.retval : undefined) as xdr.ScVal | undefined;
    // `stats` returns Option<ContributorStats>; void means "never recorded".
    if (!retval || retval.switch().name === 'scvVoid') return null;
    const native = decodeScVal(retval) as Record<string, unknown>;
    return {
      count: Number(native.count ?? 0),
      total: String(native.total ?? '0'),
    };
  } catch (err) {
    if (err instanceof SorobanError) throw err;
    logger.warn('soroban.readContributorStats failed', { contributor, err: String(err) });
    throw new SorobanError(`Failed to read registry stats for ${contributor}`, 'READ_FAILED', err);
  }
}

/** Read `is_initialised` from the ledger. */
export async function isContractInitialised(): Promise<boolean> {
  requireContractConfigured();
  const source = config.bountyAdminAddress;
  if (!source) throw new SorobanError('BOUNTY_ADMIN_ADDRESS required', 'ADMIN_NOT_CONFIGURED');
  // Throws on upstream failure; callers that need a soft answer wrap this in
  // try/catch (e.g. the readiness probe and /api/contract).
  const account = await sorobanServer.getAccount(source);
  const tx = new TransactionBuilder(account, {
    fee: '100',
    networkPassphrase: config.stellarNetworkPassphrase,
  })
    .addOperation(invokeHostFunctionOp('is_initialised', [], source))
    .setTimeout(180)
    .build();
  const sim = await sorobanServer.simulateTransaction(tx);
  if ('error' in sim && sim.error) {
    throw new SorobanError('Failed to read contract initialisation state', 'READ_FAILED', sim);
  }
  return Boolean('result' in sim && sim.result?.retval?.b?.());
}

// ── Events ────────────────────────────────────────────────────────

export interface SorobanContractEvent {
  id: string;
  txHash: string;
  ledger: number;
  contractId: string;
  /** The event name (first topic). */
  topic: string;
  /** All decoded topics, including the event name. */
  topics: unknown[];
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
    // Index both contracts: the bounty emits create/release/reclaim and the
    // registry emits contributor_recorded (the inter-contract proof point).
    const contractIds = [config.bountyContractId, config.contributorRegistryId].filter(
      (id): id is string => Boolean(id),
    );
    const filters = [
      {
        type: 'contract' as const,
        contractIds,
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

/** Events whose second topic is the issue id (see the contracts directory). */
const ISSUE_TOPIC_EVENTS = new Set([
  'bounty_created',
  'bounty_released',
  'bounty_reclaimed',
  'bounty_refunded',
  'contributor_claimed',
  'milestone_released',
  'reviewers_set',
  'review_submitted',
  'dispute_opened',
  'dispute_resolved',
]);

function parseEvent(e: rpc.Api.EventResponse): SorobanContractEvent | null {
  if (!e.topic || e.topic.length === 0) return null;
  const name = String(decodeScVal(e.topic[0]) ?? '');
  if (!name) return null;
  // For these events topic[1] is the issue id. For `contributor_recorded`,
  // `review_recorded` and `dispute_recorded` topic[1] is an *address*, and for
  // `proposal_*` it is the proposal id — so the issue id comes from the data
  // map for those.
  let issueId: string | null = null;
  if (ISSUE_TOPIC_EVENTS.has(name) && e.topic.length > 1) {
    const second = decodeScVal(e.topic[1]);
    if (typeof second === 'string') issueId = second;
  }
  const payload = (decodeScVal(e.value) ?? {}) as Record<string, unknown>;
  if (!issueId && typeof payload.issue_id === 'string') issueId = payload.issue_id;
  return {
    id: e.id ?? `${e.ledger}:${e.txHash}`,
    txHash: e.txHash,
    ledger: e.ledger,
    contractId: String(e.contractId ?? config.bountyContractId),
    topic: name,
    topics: e.topic.map((t) => decodeScVal(t)),
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

// ── Generic read-only contract calls (v2 surface) ─────────────────

/**
 * Simulate a read-only contract call and return the decoded value, or `null`
 * when the contract returned `Void` (e.g. `Option::None`).
 *
 * Contract errors are surfaced as [`SorobanError`] so callers can distinguish
 * "not found" from "upstream unreachable".
 */
export async function simulateRead(
  contractId: string,
  fn: string,
  args: TxArg[],
  source?: string,
): Promise<unknown | null> {
  const src = source ?? config.bountyAdminAddress;
  if (!src) {
    throw new SorobanError(
      'BOUNTY_ADMIN_ADDRESS is required for on-chain reads',
      'ADMIN_NOT_CONFIGURED',
    );
  }
  try {
    const account = await sorobanServer.getAccount(src);
    const tx = new TransactionBuilder(account, {
      fee: '100',
      networkPassphrase: config.stellarNetworkPassphrase,
    })
      .addOperation(invokeHostFunctionOp(fn, args, src, contractId))
      .setTimeout(180)
      .build();
    const sim = await sorobanServer.simulateTransaction(tx);
    metrics.setGauge('soroban_up', 1);
    if ('error' in sim && sim.error) {
      throw new SorobanError(`Failed to simulate ${fn}`, 'READ_FAILED', sim.error);
    }
    const retval = ('result' in sim ? sim.result?.retval : undefined) as xdr.ScVal | undefined;
    if (!retval || retval.switch().name === 'scvVoid') return null;
    return decodeScVal(retval);
  } catch (err) {
    if (err instanceof SorobanError) throw err;
    metrics.setGauge('soroban_up', 0);
    throw new SorobanError(`Failed to simulate ${fn}`, 'READ_FAILED', err);
  }
}

/** True when a simulation error means "the contract says this does not exist". */
function isContractError(err: unknown, code: number): boolean {
  const text = err instanceof SorobanError ? JSON.stringify(err.detail ?? err.message) : '';
  return new RegExp(`Error\\(Contract, #${code}\\)`).test(text);
}

export interface MilestoneOnChain {
  title: string;
  amount: string;
  settled: boolean;
}

/** Full v2 bounty state, including milestones and reviewer assignment. */
export interface BountyV2 {
  funder: string;
  contributor: string | null;
  token: string;
  amount: string;
  issue_id: string;
  released: boolean;
  refunded: boolean;
  released_amount: string;
  milestones: MilestoneOnChain[];
  reviewers: string[];
  reviewer_quorum: number;
}

/** Read the full v2 bounty (milestones + reviewers) from the ledger. */
export async function readBountyV2(issueId: string): Promise<BountyV2 | null> {
  requireContractConfigured();
  try {
    const native = (await simulateRead(config.bountyContractId, 'get_bounty', [
      { type: 'string', value: issueId },
    ])) as Record<string, unknown> | null;
    if (!native) return null;
    return {
      funder: String(native.funder ?? ''),
      contributor: native.contributor ? String(native.contributor) : null,
      token: String(native.token ?? ''),
      amount: String(native.amount ?? '0'),
      issue_id: String(native.issue_id ?? ''),
      released: Boolean(native.released),
      refunded: Boolean(native.refunded),
      released_amount: String(native.released_amount ?? '0'),
      milestones: Array.isArray(native.milestones)
        ? (native.milestones as Record<string, unknown>[]).map((m) => ({
            title: String(m.title ?? ''),
            amount: String(m.amount ?? '0'),
            settled: Boolean(m.settled),
          }))
        : [],
      reviewers: Array.isArray(native.reviewers) ? native.reviewers.map(String) : [],
      reviewer_quorum: Number(native.reviewer_quorum ?? 0),
    };
  } catch (err) {
    // BountyError::BountyNotFound is code 6 in v1 and v2 — an absent bounty is
    // a legitimate `null`, anything else is an upstream failure.
    if (isContractError(err, 6)) return null;
    throw err;
  }
}

export interface SignerSetOnChain {
  signers: string[];
  threshold: number;
}

/** Read the current multisig signer set and threshold. */
export async function readSigners(): Promise<SignerSetOnChain | null> {
  requireContractConfigured();
  const native = (await simulateRead(config.bountyContractId, 'get_signers', [])) as Record<
    string,
    unknown
  > | null;
  if (!native) return null;
  return {
    signers: Array.isArray(native.signers) ? native.signers.map(String) : [],
    threshold: Number(native.threshold ?? 0),
  };
}

export interface ProposalOnChain {
  id: string;
  action: unknown;
  proposer: string;
  approvals: string[];
  executed: boolean;
  cancelled: boolean;
}

/** Read a multisig proposal. `null` when the id does not exist. */
export async function readProposal(id: number | string): Promise<ProposalOnChain | null> {
  requireContractConfigured();
  try {
    const native = (await simulateRead(config.bountyContractId, 'get_proposal', [
      { type: 'u64', value: id },
    ])) as Record<string, unknown> | null;
    if (!native) return null;
    return {
      id: String(native.id ?? id),
      action: native.action ?? null,
      proposer: String(native.proposer ?? ''),
      approvals: Array.isArray(native.approvals) ? native.approvals.map(String) : [],
      executed: Boolean(native.executed),
      cancelled: Boolean(native.cancelled),
    };
  } catch (err) {
    if (isContractError(err, 16)) return null; // ProposalNotFound
    throw err;
  }
}

export interface DisputeOnChain {
  id: string;
  issue_id: string;
  milestone: number;
  opener: string;
  reason_hash: string;
  votes_pay_contributor: number;
  votes_refund_funder: number;
  resolved: boolean;
  pay_contributor: boolean;
}

/** Read a dispute. `null` when the id does not exist. */
export async function readDispute(id: number | string): Promise<DisputeOnChain | null> {
  requireContractConfigured();
  try {
    const native = (await simulateRead(config.bountyContractId, 'get_dispute', [
      { type: 'u64', value: id },
    ])) as Record<string, unknown> | null;
    if (!native) return null;
    return {
      id: String(native.id ?? id),
      issue_id: String(native.issue_id ?? ''),
      milestone: Number(native.milestone ?? 0),
      opener: String(native.opener ?? ''),
      reason_hash: String(native.reason_hash ?? ''),
      votes_pay_contributor: Number(native.votes_pay_contributor ?? 0),
      votes_refund_funder: Number(native.votes_refund_funder ?? 0),
      resolved: Boolean(native.resolved),
      pay_contributor: Boolean(native.pay_contributor),
    };
  } catch (err) {
    if (isContractError(err, 24)) return null; // DisputeNotFound
    throw err;
  }
}

export interface ReputationOnChain {
  payouts: number;
  payout_total: string;
  reviews_upheld: number;
  disputes_opened: number;
  disputes_lost: number;
  score: number;
}

/**
 * Read an address's verifiable reputation from the registry contract, plus the
 * on-chain deterministic score. `null` when the registry is unset or the
 * address has no recorded activity.
 */
export async function readReputation(address: string): Promise<ReputationOnChain | null> {
  const registryId = config.contributorRegistryId;
  if (!registryId || !config.bountyAdminAddress) return null;
  const rep = (await simulateRead(
    registryId,
    'reputation',
    [{ type: 'address', value: address }],
    config.bountyAdminAddress,
  )) as Record<string, unknown> | null;
  if (!rep) return null;
  const score = (await simulateRead(
    registryId,
    'score',
    [{ type: 'address', value: address }],
    config.bountyAdminAddress,
  )) as number | null;
  return {
    payouts: Number(rep.payouts ?? 0),
    payout_total: String(rep.payout_total ?? '0'),
    reviews_upheld: Number(rep.reviews_upheld ?? 0),
    disputes_opened: Number(rep.disputes_opened ?? 0),
    disputes_lost: Number(rep.disputes_lost ?? 0),
    score: Number(score ?? 0),
  };
}

/** Deterministic account (for simulations) — exported for tests. */
export { Horizon };
