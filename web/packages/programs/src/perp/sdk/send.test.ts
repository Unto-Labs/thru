import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SubmissionStatus } from '@thru/sdk/proto';

import { TransactionFailedError, isStateUnitsExhausted } from './errors';
import type { ThruClient } from './rpc';
import { sendAndConfirm, waitForTransaction, wireSignature } from './send';
import { callsOf, simulatedRpc } from './test-rpc';

/** Drives fake timers until `promise` settles; returns its outcome and the
    virtual time it took. */
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
  for (let step = 0; step < 100_000; step++) {
    await vi.advanceTimersByTimeAsync(0);
    if (settled) break;
    await vi.advanceTimersToNextTimerAsync();
  }
  if (!settled) throw new Error('promise never settled');
  return { value, error, ms: Date.now() - start };
}

function wire(tag: number): Uint8Array {
  const raw = new Uint8Array(176);
  raw[raw.length - 1] = tag;
  return raw;
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('sendAndConfirm', () => {
  it('confirms over one sendAndTrack stream as soon as the node executes', async () => {
    const rpc = simulatedRpc({ rttMs: 100, execMs: 500 });
    const onSubmitted = vi.fn();
    const raw = wire(1);
    const { value, ms } = await timed(sendAndConfirm(rpc.sdk, raw, 'order', { onSubmitted }));
    expect(value).toBe(wireSignature(raw));
    /* Half a round trip out, the execution, half a round trip back. */
    expect(ms).toBe(600);
    expect(rpc.calls.map((call) => call.method)).toEqual(['transactions.sendAndTrack']);
    expect(onSubmitted).toHaveBeenCalledTimes(1);
    expect(onSubmitted).toHaveBeenCalledWith(wireSignature(raw));
  });

  it('is faster than send plus a 750 ms status poll', async () => {
    const before = simulatedRpc({ rttMs: 100, execMs: 500 });
    const raw = wire(2);
    const old = await timed(
      (async () => {
        const signature = await before.sdk.transactions.send(raw);
        await waitForTransaction(before.sdk, signature, 'order');
      })(),
    );
    const after = simulatedRpc({ rttMs: 100, execMs: 500 });
    const now = await timed(sendAndConfirm(after.sdk, raw, 'order'));
    /* send (100) + polls every 200 ms in the first 2 s, each a round trip:
       execution seen at 800 ms. */
    expect(old.ms).toBe(800);
    expect(now.ms).toBe(600);
  });

  it('decodes a failed execution', async () => {
    const rpc = simulatedRpc({ vmError: () => -763 });
    const { error } = await timed(sendAndConfirm(rpc.sdk, wire(3), 'order'));
    expect(error).toBeInstanceOf(TransactionFailedError);
    expect(isStateUnitsExhausted(error)).toBe(true);
  });

  it('falls back to a plain send of the same bytes when the RPC has no sendAndTrack', async () => {
    const rpc = simulatedRpc({ noSendAndTrack: true });
    const raw = wire(4);
    const { value } = await timed(sendAndConfirm(rpc.sdk, raw, 'order'));
    expect(value).toBe(wireSignature(raw));
    expect(rpc.received).toEqual([raw]);
    expect(callsOf(rpc.calls, 'transactions.send')).toHaveLength(1);
  });

  it('polls, and never resends, when the stream breaks after the node accepted', async () => {
    const rpc = simulatedRpc({ rttMs: 100, execMs: 500 });
    const send = vi.fn(rpc.sdk.transactions.send);
    const sdk = {
      ...rpc.sdk,
      transactions: {
        ...rpc.sdk.transactions,
        send,
        sendAndTrack: (raw: Uint8Array, options: { signal?: AbortSignal }) => {
          const inner = rpc.sdk.transactions.sendAndTrack(raw, options);
          return (async function* () {
            for await (const update of inner) {
              yield update;
              if (update.status === SubmissionStatus.ACCEPTED) throw new Error('[unavailable] stream reset');
            }
          })();
        },
      },
    } as unknown as ThruClient;
    const { value, ms } = await timed(sendAndConfirm(sdk, wire(5), 'order', { pollMs: 250 }));
    expect(value).toBeDefined();
    expect(send).not.toHaveBeenCalled();
    expect(rpc.received).toHaveLength(1);
    /* Accepted at 100 (executes at 550); the poll runs every 200 ms in its
       first 2 s (each a round trip) and sees it at 800. */
    expect(ms).toBe(800);
  });

  it('throws without polling when the node rejects the transaction', async () => {
    const getStatus = vi.fn();
    const send = vi.fn();
    const sdk = {
      transactions: {
        send,
        getStatus,
        sendAndTrack: () =>
          (async function* () {
            yield { status: SubmissionStatus.RECEIVED, consensusStatus: 0 };
            throw new Error('[unavailable] transaction rejected: code=3');
          })(),
      },
    } as unknown as ThruClient;
    const { error } = await timed(sendAndConfirm(sdk, wire(6), 'order'));
    expect(String(error)).toMatch(/transaction rejected/);
    expect(send).not.toHaveBeenCalled();
    expect(getStatus).not.toHaveBeenCalled();
  });

  it('takes the status poll when the stream stalls', async () => {
    const rpc = simulatedRpc({ rttMs: 100, execMs: 500 });
    const sdk = {
      ...rpc.sdk,
      transactions: {
        ...rpc.sdk.transactions,
        sendAndTrack: (raw: Uint8Array, options: { signal?: AbortSignal }) => {
          const inner = rpc.sdk.transactions.sendAndTrack(raw, options);
          return (async function* () {
            for await (const update of inner) {
              if (update.executionResult) await new Promise(() => {});
              yield update;
            }
          })();
        },
      },
    } as unknown as ThruClient;
    const { value, ms } = await timed(sendAndConfirm(sdk, wire(7), 'order', { fallbackDelayMs: 1_500, pollMs: 250 }));
    expect(value).toBeDefined();
    /* The poll starts 1.5 s in and sees the execution on its first answer. */
    expect(ms).toBe(1_600);
  });
});
