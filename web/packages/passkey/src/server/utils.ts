import { encodeAddress, encodeSignature } from '@thru/sdk/helpers';
import type {
  ThruClient,
  TransactionExecutionResultLike,
  TransactionResult,
} from './types';

const feePayerQueueSymbol = Symbol.for('thru.sharedFeePayerQueues');
const SUBMISSION_STATUS_ACCEPTED = 2;
const CONSENSUS_STATUS_FINALIZED = 3;
const CONSENSUS_STATUS_CLUSTER_EXECUTED = 5;

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
  let finalizedSeen = false;

  try {
    for await (const update of client.transactions.track(signature, { timeoutMs })) {
      if (update.executionResult) {
        return executionResultToTransactionResult(signature, update.executionResult);
      }

      if (isFinalConsensusStatus(update.statusCode)) {
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
    if (finalizedSeen) {
      return {
        signature,
        status: 'finalized_without_execution',
      };
    }

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

export async function sendAndTrackTransaction(
  client: ThruClient,
  rawTransaction: Uint8Array,
  timeoutMs: number = 5000
): Promise<TransactionResult> {
  let signature = signatureFromRawTransaction(rawTransaction);
  let accepted = false;
  let finalizedSeen = false;

  try {
    for await (const update of client.transactions.sendAndTrack(rawTransaction, { timeoutMs })) {
      if (update.signature?.value) {
        signature = encodeSignature(update.signature.value);
      }
      if (update.status === SUBMISSION_STATUS_ACCEPTED) {
        accepted = true;
      }
      if (isFinalConsensusStatus(update.consensusStatus)) {
        finalizedSeen = true;
      }
      if (update.executionResult) {
        return executionResultToTransactionResult(signature, update.executionResult);
      }
    }
  } catch (error) {
    if (finalizedSeen && signature) {
      return {
        signature,
        status: 'finalized_without_execution',
      };
    }

    if (accepted && signature) {
      return {
        signature,
        status: 'timeout',
      };
    }

    throw error;
  }

  if (finalizedSeen && signature) {
    return {
      signature,
      status: 'finalized_without_execution',
    };
  }

  if (accepted && signature) {
    return {
      signature,
      status: 'timeout',
    };
  }

  throw new Error('SendAndTrackTxn did not accept the transaction');
}

export function toThruAddress(bytes: Uint8Array): string {
  return encodeAddress(bytes);
}

function executionResultToTransactionResult(
  signature: string,
  executionResult: TransactionExecutionResultLike
): TransactionResult {
  const vmError =
    executionResult.vmError !== undefined && executionResult.vmError !== null
      ? BigInt(executionResult.vmError)
      : 0n;
  const userErrorCode =
    executionResult.userErrorCode !== undefined && executionResult.userErrorCode !== null
      ? BigInt(executionResult.userErrorCode)
      : 0n;
  const executionError =
    executionResult.executionResult !== undefined &&
    executionResult.executionResult !== null
      ? BigInt(executionResult.executionResult)
      : 0n;
  const success = vmError === 0n && executionError === 0n && userErrorCode === 0n;

  return {
    signature,
    status: success ? 'finalized' : 'failed',
    errorCode: vmError !== 0n ? vmError : executionError !== 0n ? executionError : userErrorCode,
  };
}

function isFinalConsensusStatus(status?: number): boolean {
  return status === CONSENSUS_STATUS_FINALIZED || status === CONSENSUS_STATUS_CLUSTER_EXECUTED;
}

function signatureFromRawTransaction(rawTransaction: Uint8Array): string {
  if (rawTransaction.length < 64) {
    throw new Error(`Raw transaction too short to contain a signature: ${rawTransaction.length} bytes`);
  }
  return encodeSignature(rawTransaction.slice(rawTransaction.length - 64));
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
