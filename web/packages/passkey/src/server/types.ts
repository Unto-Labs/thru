import type { AccountContext } from '@thru/passkey-manager';

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
      header: { fee: bigint };
    }) => Promise<{
      sign: (privateKey: string) => Promise<unknown>;
      toWire: () => Uint8Array;
    }>;
    send: (transaction: Uint8Array) => Promise<string>;
    track: (
      signature: string,
      opts: { timeoutMs: number }
    ) => AsyncIterable<{
      executionResult?: {
        userErrorCode: bigint;
      };
      statusCode?: number;
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
  status: 'finalized' | 'failed' | 'timeout';
  errorCode?: bigint;
}

export interface PasskeyChallengeResult {
  challenge: string;
  nonce: string;
}

export interface PasskeyContextResult {
  accountCtx: AccountContext;
  invokeIx: Uint8Array;
}
