import { beforeEach, describe, expect, it } from 'vitest';
import { encodeSignature } from '@thru/sdk/helpers';
import type { ThruClient } from './types';
import { sendAndTrackTransaction, trackTransaction } from './utils';

const feePayerQueueSymbol = Symbol.for('thru.sharedFeePayerQueues');

function clearFeePayerQueues(): void {
  const globalQueues = globalThis as typeof globalThis & {
    [feePayerQueueSymbol]?: Map<string, Promise<void>>;
  };

  globalQueues[feePayerQueueSymbol]?.clear();
  delete globalQueues[feePayerQueueSymbol];
}

describe('trackTransaction', () => {
  beforeEach(() => {
    clearFeePayerQueues();
  });

  it('returns a distinct status when finalized arrives without an execution payload', async () => {
    const client = {
      transactions: {
        track: async function* () {
          yield { statusCode: 3 };
        },
      },
    } as ThruClient;

    await expect(trackTransaction(client, 'sig-1')).resolves.toEqual({
      signature: 'sig-1',
      status: 'finalized_without_execution',
    });
  });

  it('preserves finalized status if the tracking stream errors afterward', async () => {
    const client = {
      transactions: {
        track: async function* () {
          yield { statusCode: 3 };
          throw new Error('stream closed');
        },
      },
    } as ThruClient;

    await expect(trackTransaction(client, 'sig-2')).resolves.toEqual({
      signature: 'sig-2',
      status: 'finalized_without_execution',
    });
  });
});

describe('sendAndTrackTransaction', () => {
  beforeEach(() => {
    clearFeePayerQueues();
  });

  const rawTransaction = new Uint8Array(64).fill(9);

  it('returns execution results from the send-and-track stream', async () => {
    const signatureBytes = new Uint8Array(64).fill(3);
    const client = {
      transactions: {
        sendAndTrack: async function* () {
          yield {
            status: 2,
            signature: { value: signatureBytes },
            executionResult: {
              userErrorCode: 0n,
              vmError: 0,
              executionResult: 0n,
            },
          };
        },
      },
    } as ThruClient;

    await expect(
      sendAndTrackTransaction(client, rawTransaction)
    ).resolves.toEqual({
      signature: encodeSignature(signatureBytes),
      status: 'finalized',
      errorCode: 0n,
    });
  });

  it('preserves an accepted transaction as a timeout if the stream closes early', async () => {
    const signatureBytes = new Uint8Array(64).fill(4);
    const client = {
      transactions: {
        sendAndTrack: async function* () {
          yield {
            status: 2,
            signature: { value: signatureBytes },
          };
          throw new Error('stream closed');
        },
      },
    } as ThruClient;

    await expect(
      sendAndTrackTransaction(client, rawTransaction)
    ).resolves.toEqual({
      signature: encodeSignature(signatureBytes),
      status: 'timeout',
    });
  });

  it('rejects malformed raw transactions before submitting them', async () => {
    const client = {
      transactions: {
        sendAndTrack: async function* () {
          yield {
            status: 2,
          };
        },
      },
    } as ThruClient;

    await expect(
      sendAndTrackTransaction(client, new Uint8Array([1, 2, 3]))
    ).rejects.toThrow('Raw transaction too short to contain a signature: 3 bytes');
  });
});
