import { beforeEach, describe, expect, it } from 'vitest';
import type { ThruClient } from './types';
import { trackTransaction } from './utils';

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
