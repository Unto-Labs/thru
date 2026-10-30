/* @thru/programs/perps/testing: a simulated Thru RPC for timing and
   exercising the perps send path in tests (the SDK's own, the perps tools'
   and the demo UI's through @thru/perps-common/testing). Not for
   production use. */
import { encodeSignature } from '@thru/sdk/helpers';
import { SubmissionStatus } from '@thru/sdk/proto';

import { normalizeAddress, type ThruClient } from './rpc';

/* A ThruClient stand-in with modelled latency, for timing the order path in
   tests. Every unary call takes `rttMs` (half out, half back); a sent
   transaction executes `execMs` after it reaches the node. Time is
   setTimeout/Date.now, so tests run it under fake timers and read the
   critical path off the virtual clock. Only the calls the order path makes
   are implemented.

   transactions.build mirrors the SDK: each header field the caller left
   out (nonce, start slot, chain id) costs one read, one after another.

   State compression: compression.getAccountStatuses answers in one round
   trip per call (every account ACTIVE unless listed in `archived`), and
   compression.decompressAccounts sends one restore transaction from the
   fee payer (a round trip plus execution, advancing its nonce) after which
   the accounts are active. */

export interface SimulatedRpcOptions {
  /** Round trip of one unary call (default 100 ms, Betanet's p50 for an account read). */
  rttMs?: number;
  /** Time from the node receiving a transaction to its execution result (default 500 ms, one slot). */
  execMs?: number;
  /** The fee payer's nonce on chain (default 7). */
  nonce?: bigint;
  /** Data returned for an account read (default an empty 10-level cbook). */
  accountData?: (address: string) => Uint8Array;
  /** Execution result of every transaction (default success). */
  vmError?: (sent: number) => number;
  /** The RPC has no sendAndTrack: the stream fails before any message. */
  noSendAndTrack?: boolean;
  /** Accounts state compression archived (default none). */
  archived?: readonly string[];
}

export interface SimulatedCall {
  method: string;
  address?: string;
  start: number;
  end: number;
}

export interface SimulatedRpc {
  sdk: ThruClient;
  calls: SimulatedCall[];
  /** Signed transactions the node received, in order. */
  received: Uint8Array[];
  /** Accounts currently archived (restores remove them; tests may add). */
  archived: Set<string>;
}

/** A 10-level cbook with no orders (best price unset). */
function emptyCbook(): Uint8Array {
  const data = new Uint8Array(16 + 10 * 8);
  new DataView(data.buffer).setBigUint64(8, (1n << 64n) - 1n, true);
  return data;
}

/* Tests may use placeholder addresses that are not valid keys. */
function addressKey(address: string): string {
  try {
    return normalizeAddress(address);
  } catch {
    return address;
  }
}

const sleep = (ms: number) => new Promise<void>((resolveSleep) => setTimeout(resolveSleep, ms));

export function simulatedRpc(options: SimulatedRpcOptions = {}): SimulatedRpc {
  const rttMs = options.rttMs ?? 100;
  const execMs = options.execMs ?? 500;
  const half = rttMs / 2;
  const calls: SimulatedCall[] = [];
  const received: Uint8Array[] = [];
  const executeAt = new Map<string, { at: number; vmError: number }>();
  const wireKey = (raw: Uint8Array) => encodeSignature(raw.subarray(raw.length - 64));
  let nonce = options.nonce ?? 7n;
  const archived = new Set((options.archived ?? []).map(addressKey));

  const unary = async <T>(method: string, result: () => T, address?: string): Promise<T> => {
    const call: SimulatedCall = { method, address, start: Date.now(), end: 0 };
    calls.push(call);
    await sleep(half);
    try {
      return result();
    } finally {
      await sleep(half);
      call.end = Date.now();
    }
  };

  const receive = (raw: Uint8Array) => {
    received.push(raw);
    const vmError = options.vmError?.(received.length) ?? 0;
    executeAt.set(wireKey(raw), { at: Date.now() + execMs, vmError });
    /* The nonce advances when the transaction runs (reads after this see it). */
    if (vmError === 0) nonce += 1n;
  };

  const getAccount = (address: string, readOptions?: { versionContext?: unknown }) =>
    unary(
      'accounts.get',
      () => {
        /* An archived account has no current state; a historical read returns its last. */
        if (archived.has(addressKey(address)) && !readOptions?.versionContext) throw new Error('[not_found] account not found');
        return {
          address,
          data: { data: options.accountData?.(address) ?? emptyCbook() },
          meta: { nonce, flags: { isDeleted: false } },
        };
      },
      address,
    );
  const getBlockHeight = () => unary('blocks.getBlockHeight', () => ({ finalized: 100n }));
  const getChainId = () => unary('chain.getChainId', () => 1);

  let restoreCounter = 0;
  const compression = {
    getAccountStatuses: ({ accounts }: { accounts: readonly string[] }) =>
      unary(
        'compression.getAccountStatuses',
        () =>
          accounts.map((address) => ({
            address: addressKey(address),
            status: archived.has(addressKey(address)) ? 'COMPRESSED' : 'ACTIVE',
          })),
        accounts.length === 1 ? accounts[0] : undefined,
      ),
    decompressAccounts: async ({ accounts }: { accounts: readonly string[] }) => {
      const call: SimulatedCall = { method: 'compression.decompressAccounts', start: Date.now(), end: 0 };
      calls.push(call);
      await sleep(half + execMs + half);
      nonce += 1n;
      const restored = accounts.map(addressKey).filter((address) => archived.delete(address));
      call.end = Date.now();
      return {
        accounts: restored.map((address) => ({ address, status: 'restored' })),
        signatures: [`restore-${++restoreCounter}`],
        uploads: [],
      };
    },
  };

  let wireCounter = 0;
  const sdk = {
    compression,
    accounts: { get: getAccount },
    blocks: { getBlockHeight },
    chain: { getChainId },
    transactions: {
      build: async (params: { feePayer: { publicKey: string }; header?: { nonce?: bigint; startSlot?: bigint; chainId?: number } }) => {
        const header = params.header ?? {};
        if (header.nonce === undefined) await getAccount(params.feePayer.publicKey);
        if (header.startSlot === undefined) await getBlockHeight();
        if (header.chainId === undefined) await getChainId();
        const raw = new Uint8Array(176);
        new DataView(raw.buffer).setUint32(raw.length - 4, ++wireCounter);
        return { sign: async () => {}, toWire: () => raw };
      },
      send: async (raw: Uint8Array) => {
        const call: SimulatedCall = { method: 'transactions.send', start: Date.now(), end: 0 };
        calls.push(call);
        await sleep(half);
        receive(raw);
        await sleep(half);
        call.end = Date.now();
        return wireKey(raw);
      },
      getStatus: (signature: string) =>
        unary('transactions.getStatus', () => {
          const execution = executeAt.get(signature);
          if (!execution || Date.now() < execution.at) return {};
          return { executionResult: { vmError: execution.vmError, userErrorCode: 0n } };
        }),
      sendAndTrack: (raw: Uint8Array, trackOptions: { signal?: AbortSignal } = {}) => {
        const call: SimulatedCall = { method: 'transactions.sendAndTrack', start: Date.now(), end: 0 };
        calls.push(call);
        async function* stream() {
          try {
            await sleep(half);
            if (options.noSendAndTrack) throw new Error('[unimplemented] sendAndTrack');
            receive(raw);
            const execution = executeAt.get(wireKey(raw))!;
            await sleep(half);
            yield { status: SubmissionStatus.RECEIVED, consensusStatus: 0 };
            yield { status: SubmissionStatus.ACCEPTED, consensusStatus: 0 };
            await sleep(Math.max(0, execution.at + half - Date.now()));
            if (trackOptions.signal?.aborted) return;
            yield {
              status: SubmissionStatus.ACCEPTED,
              consensusStatus: 0,
              executionResult: { vmError: execution.vmError, consumedComputeUnits: 0, userErrorCode: 0n },
            };
          } finally {
            call.end = Date.now();
          }
        }
        return stream();
      },
    },
  } as unknown as ThruClient;

  return { sdk, calls, received, archived };
}

/** Calls of `method` (optionally to `address`) in `calls`. */
export function callsOf(calls: SimulatedCall[], method: string, address?: string): SimulatedCall[] {
  return calls.filter((call) => call.method === method && (address === undefined || call.address === address));
}

/** Largest number of calls in flight at once among `calls`. */
export function maxConcurrency(calls: SimulatedCall[]): number {
  const edges = calls.flatMap((call) => [
    [call.start, 1],
    [call.end, -1],
  ]);
  edges.sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]!);
  let current = 0;
  let max = 0;
  for (const [, delta] of edges) {
    current += delta!;
    max = Math.max(max, current);
  }
  return max;
}
