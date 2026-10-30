import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeAddress } from '@thru/sdk/helpers';
import { TransactionVmError } from '@thru/sdk/proto';

import { rpcChainId } from './rpc';
import { createKeypairSigner } from './signers';
import { submitPerpTransaction, type PerpSubmitOptions } from './submit';
import { callsOf, maxConcurrency, simulatedRpc, type SimulatedRpc } from './test-rpc';

const address = (fill: number) => encodeAddress(new Uint8Array(32).fill(fill));
const PAYER = address(1);
const PROGRAM = address(9);
const RTT = 100;
const EXEC = 500;

async function timed<T>(promise: Promise<T>): Promise<{ value?: T; error?: unknown; ms: number }> {
  const start = Date.now();
  let settled = false;
  let value: T | undefined;
  let error: unknown;
  promise.then(
    (result) => {
      settled = true;
      value = result;
    },
    (reason: unknown) => {
      settled = true;
      error = reason;
    },
  );
  for (let step = 0; step < 100_000 && !settled; step++) {
    await vi.advanceTimersByTimeAsync(0);
    if (settled) break;
    await vi.advanceTimersToNextTimerAsync();
  }
  if (!settled) throw new Error('promise never settled');
  return { value, error, ms: Date.now() - start };
}

function submit(rpc: SimulatedRpc, options: PerpSubmitOptions = {}, signer = createKeypairSigner({ address: PAYER, privateKey: new Uint8Array(32), verified: true })) {
  return submitPerpTransaction(
    rpc.sdk,
    signer,
    { programAddress: PROGRAM, tx: { label: 'test', instructionData: async () => new Uint8Array(), readWrite: [address(2)], readOnly: [address(3)] } },
    {
      checkChain: async () => {
        if ((await rpcChainId(rpc.sdk)) !== 1) throw new Error('transaction blocked');
      },
      archived: { signer: { kind: 'keypair', publicKey: PAYER, privateKey: new Uint8Array(32) } },
      ...options,
    },
  );
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('submitPerpTransaction', () => {
  it('reads the header, the chain and the statuses in parallel, then signs and sends', async () => {
    const rpc = simulatedRpc({ rttMs: RTT, execMs: EXEC });
    const t0 = Date.now();
    const { error, ms } = await timed(submit(rpc));
    expect(error).toBeUndefined();
    const reads = rpc.calls.filter((call) => call.method !== 'transactions.sendAndTrack');
    expect(reads.every((call) => call.start === t0)).toBe(true);
    expect(maxConcurrency(reads)).toBe(reads.length);
    /* One round trip of reads, then the send. */
    expect(ms).toBe(RTT + RTT + EXEC);
    /* A steady sender reads nothing: nonce, chain and statuses are cached. */
    rpc.calls.length = 0;
    const steady = await timed(submit(rpc));
    expect(steady.ms).toBe(RTT + EXEC);
    expect(rpc.calls.map((call) => call.method)).toEqual(['transactions.sendAndTrack']);
  });

  it('restores archived accounts after the chain check and reads the nonce again', async () => {
    const rpc = simulatedRpc({ rttMs: RTT, execMs: EXEC, archived: [address(3)] });
    const { error } = await timed(submit(rpc));
    expect(error).toBeUndefined();
    const [restore] = callsOf(rpc.calls, 'compression.decompressAccounts');
    const [chain] = callsOf(rpc.calls, 'chain.getChainId');
    expect(restore!.start).toBeGreaterThanOrEqual(chain!.end);
    /* The nonce read before the restore is stale; it is read again. */
    const nonceReads = callsOf(rpc.calls, 'accounts.get', PAYER);
    expect(nonceReads).toHaveLength(2);
    expect(nonceReads[1]!.start).toBeGreaterThanOrEqual(restore!.end);
    expect(rpc.archived.size).toBe(0);
  });

  it('signs nothing on the wrong chain', async () => {
    const rpc = simulatedRpc();
    const chain = rpc.sdk.chain as { getChainId: () => Promise<number> };
    chain.getChainId = async () => 2;
    const { error } = await timed(submit(rpc));
    expect(String(error)).toContain('transaction blocked');
    expect(rpc.received).toHaveLength(0);
    expect(callsOf(rpc.calls, 'compression.decompressAccounts')).toHaveLength(0);
  });

  it('rebuilds once on a fresh nonce when a cached nonce is rejected, and never resends otherwise', async () => {
    const rpc = simulatedRpc({ vmError: (sent) => (sent === 2 ? TransactionVmError.TRANSACTION_VM_ERROR_NONCE_TOO_LOW : 0) });
    await timed(submit(rpc));
    rpc.calls.length = 0;
    const { error } = await timed(submit(rpc));
    expect(error).toBeUndefined();
    expect(rpc.received).toHaveLength(3);
    expect(rpc.received[1]).not.toEqual(rpc.received[2]);
    expect(callsOf(rpc.calls, 'accounts.get', PAYER)).toHaveLength(1);

    const failing = simulatedRpc({ vmError: () => -1 });
    const failed = await timed(submit(failing));
    expect(String(failed.error)).toContain('failed on-chain');
    expect(failing.received).toHaveLength(1);
  });

  it('drops the cached statuses after a failure', async () => {
    const rpc = simulatedRpc({ vmError: (sent) => (sent === 1 ? -1 : 0) });
    await timed(submit(rpc));
    rpc.calls.length = 0;
    await timed(submit(rpc));
    expect(callsOf(rpc.calls, 'compression.getAccountStatuses')).toHaveLength(3);
  });
});
