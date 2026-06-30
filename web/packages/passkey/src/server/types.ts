import type { AccountContext } from '@thru/programs/passkey-manager';
import type { TransactionHeaderConfig } from '@thru/sdk';

export type PasskeyTransactionHeaderOverrides = TransactionHeaderConfig;

export interface BuiltPasskeyTransaction {
  transaction: {
    sign: (privateKey: Uint8Array) => Promise<unknown>;
    toWire: () => Uint8Array;
  };
  rawTransaction: Uint8Array;
}

export interface TransactionExecutionResultLike {
  userErrorCode?: bigint | number | null;
  vmError?: bigint | number | null;
  executionResult?: bigint | number | null;
  consumedComputeUnits?: number;
}

export interface ThruClient {
  accounts: {
    get: (address: string) => Promise<{ data?: { data?: Uint8Array } }>;
  };
  blocks: {
    getBlockHeight: () => Promise<{ finalized: bigint }>;
  };
  proofs: {
    generate: (params: {
      address: string;
      proofType: number;
      targetSlot: bigint;
    }) => Promise<{ proof?: Uint8Array }>;
  };
  transactions: {
    build: (params: {
      feePayer: { publicKey: Uint8Array };
      program: string;
      instructionData: Uint8Array;
      accounts: {
        readWrite: string[];
        readOnly: string[];
      };
      header?: TransactionHeaderConfig;
    }) => Promise<{
      sign: (privateKey: Uint8Array) => Promise<unknown>;
      toWire: () => Uint8Array;
    }>;
    send: (transaction: Uint8Array) => Promise<string>;
    track: (
      signature: string,
      opts: { timeoutMs: number }
    ) => AsyncIterable<{
      executionResult?: TransactionExecutionResultLike;
      statusCode?: number;
    }>;
    sendAndTrack: (
      transaction: Uint8Array,
      opts: { timeoutMs: number }
    ) => AsyncIterable<{
      status?: number;
      signature?: { value: Uint8Array };
      consensusStatus?: number;
      executionResult?: TransactionExecutionResultLike;
    }>;
  };
}

export interface PasskeySignaturePayload {
  signatureR: string;
  signatureS: string;
  authenticatorData: string;
  clientDataJSON: string;
}

export interface PasskeyChallengeSubmitPayload extends PasskeySignaturePayload {
  challenge: string;
  nonce: string;
}

export interface TransactionResult {
  signature: string;
  status: 'finalized' | 'failed' | 'timeout' | 'finalized_without_execution';
  errorCode?: bigint;
}

export interface PasskeyChallengeResult {
  challenge: string;
  nonce: string;
}

export interface PasskeyContextResult {
  accountCtx: AccountContext;
  targetProgramAddress: string;
  instructionData: Uint8Array;
  authIdx?: number;
}
