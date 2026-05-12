import { encodeAddress } from '@thru/helpers';
import type { ThruClient, TransactionResult } from './types';

const feePayerQueueSymbol = Symbol.for('thru.sharedFeePayerQueues');

function getFeePayerQueues(): Map<string, Promise<void>> {
  const globalQueues = globalThis as typeof globalThis & {
    [feePayerQueueSymbol]?: Map<string, Promise<void>>;
  };

  if (!globalQueues[feePayerQueueSymbol]) {
    globalQueues[feePayerQueueSymbol] = new Map<string, Promise<void>>();
  }

  return globalQueues[feePayerQueueSymbol];
}

export async function getStateProof(
  client: ThruClient,
  address: string,
  proofType: number = 1,
  targetSlot?: bigint
): Promise<Uint8Array> {
  const proofRequest: {
    address: string;
    proofType: number;
    targetSlot?: bigint;
  } = {
    address,
    proofType,
  };

  if (targetSlot !== undefined) {
    proofRequest.targetSlot = targetSlot;
  }

  const proof = await client.proofs.generate(proofRequest);

  if (!proof.proof || proof.proof.length === 0) {
    throw new Error(`No state proof returned for ${address}`);
  }

  return proof.proof;
}

export async function trackTransaction(
  client: ThruClient,
  signature: string,
  timeoutMs: number = 5000
): Promise<TransactionResult> {
  try {
    let finalizedSeen = false;

    for await (const update of client.transactions.track(signature, { timeoutMs })) {
      if (update.executionResult) {
        const vmError =
          update.executionResult.vmError !== undefined && update.executionResult.vmError !== null
            ? BigInt(update.executionResult.vmError)
            : 0n;
        const userErrorCode = update.executionResult.userErrorCode;
        const executionError =
          update.executionResult.executionResult !== undefined &&
          update.executionResult.executionResult !== null
            ? BigInt(update.executionResult.executionResult)
            : 0n;
        const success = vmError === 0n && executionError === 0n && userErrorCode === 0n;

        return {
          signature,
          status: success ? 'finalized' : 'failed',
          errorCode: vmError !== 0n ? vmError : executionError !== 0n ? executionError : userErrorCode,
        };
      }

      if (update.statusCode === 3) {
        finalizedSeen = true;
      }
    }

    if (finalizedSeen) {
      return {
        signature,
        status: 'finalized_without_execution',
      };
    }
  } catch {
    return {
      signature,
      status: 'timeout',
    };
  }

  return {
    signature,
    status: 'timeout',
  };
}

export function toThruAddress(bytes: Uint8Array): string {
  return encodeAddress(bytes);
}

export async function withSerializedFeePayer<T>(
  feePayerPublicKey: Uint8Array,
  work: () => Promise<T>
): Promise<T> {
  const queueKey = toThruAddress(feePayerPublicKey);
  const feePayerQueues = getFeePayerQueues();
  const previous = feePayerQueues.get(queueKey) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => current);
  feePayerQueues.set(queueKey, tail);

  await previous;

  try {
    return await work();
  } finally {
    release();
    if (feePayerQueues.get(queueKey) === tail) {
      feePayerQueues.delete(queueKey);
    }
  }
}
