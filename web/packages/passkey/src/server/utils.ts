import { encodeAddress } from '@thru/helpers';
import type { ThruClient, TransactionResult } from './types';

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
    for await (const update of client.transactions.track(signature, { timeoutMs })) {
      if (update.executionResult) {
        return {
          signature,
          status: update.executionResult.userErrorCode === 0n ? 'finalized' : 'failed',
          errorCode: update.executionResult.userErrorCode,
        };
      }

      if (update.statusCode === 3) {
        return {
          signature,
          status: 'finalized',
        };
      }
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
