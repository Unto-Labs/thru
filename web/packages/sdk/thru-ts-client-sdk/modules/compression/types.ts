import type { TransactionFeePayerConfig } from '../transactions';
import type { ThruTransactionIntent } from '../../domain/transactions/intent';

export interface PendingCompressionTransaction {
  signature: string;
  nonce: bigint;
  validUntilSlot: bigint;
}

/** A durable journal belongs to one network and fee payer; never store keys in it. */
export interface CompressionJournal {
  load(): Promise<PendingCompressionTransaction | undefined>;
  save(pending: PendingCompressionTransaction | undefined): Promise<void>;
}

export interface CompressionOptions {
  programAddresses?: { compression?: string; multicall?: string; uploader?: string; passkeyManager?: string };
  signal?: AbortSignal;
  fee?: bigint;
  timeoutMs?: number;
  pollIntervalMs?: number;
  maxTransactionBytes?: number;
  journal?: CompressionJournal;
}

export type KeypairCompressionOptions = CompressionOptions & {
  feePayer: TransactionFeePayerConfig & { privateKey: Uint8Array };
  walletAddress?: never;
  signTransaction?: never;
};

/** Uses the wallet's existing intent -> base64 signed transaction contract. */
export type WalletCompressionOptions = CompressionOptions & {
  feePayer: Pick<TransactionFeePayerConfig, 'publicKey'> & { privateKey?: never };
  walletAddress: string;
  signTransaction(intent: ThruTransactionIntent): Promise<string>;
};

export type DecompressionOptions = KeypairCompressionOptions | WalletCompressionOptions;

export interface AccountState {
  address: string;
  slot?: bigint;
  deleted: boolean;
  uncompressable: boolean;
  ephemeral: boolean;
  isNew: boolean;
  dataSize: number;
  balance: bigint;
  nonce: bigint;
}

export interface AccountImage extends AccountState {
  /** Runtime image: two-byte prefix followed by the 62-byte SDK metadata. */
  meta: Uint8Array;
  data: Uint8Array;
}

export interface AccountIndices {
  getAccountIndex(address: string): number;
  /** Byte offset of this root instruction within the unsigned transaction wire image. */
  instructionDataOffset: number;
}

export type Instruction = (context: AccountIndices) => Uint8Array | Promise<Uint8Array>;

export interface CompressionTransaction {
  program: string;
  readWrite: string[];
  readOnly?: string[];
  instructionData: Instruction;
  stateUnits: number;
  computeUnits: number;
  flags?: number;
}

export interface UploadPair {
  meta: string;
  buffer: string;
}

export type AccountOutcome = {
  address: string;
  status: "active" | "restored" | "compressed" | "deleted" | "skipped";
  signatures: string[];
};

export interface UploadCleanup extends UploadPair {
  /** Retain the original uploader for cleanup after configuration changes/restarts. */
  uploader?: string;
  status: "pending" | "cleaned" | "failed";
  error?: string;
}

export interface CompressionResult {
  accounts: AccountOutcome[];
  signatures: string[];
  uploads: UploadCleanup[];
}

export type CompressionErrorCode = "MISSING_ACCOUNT" | "NOT_READY" | "INVALID_IMAGE" |
  "TRANSACTION_TOO_LARGE" | "TRANSACTION_FAILED" | "TRANSACTION_UNCERTAIN" |
  "RPC_ERROR" | "CANCELLED" | "CLEANUP_FAILED";

export class CompressionError extends Error {
  readonly cause?: unknown;
  constructor(
    public readonly code: CompressionErrorCode,
    message: string,
    public readonly details: {
      address?: string;
      retrySlot?: bigint;
      signature?: string;
      vmError?: number;
      userErrorCode?: bigint;
      result?: CompressionResult;
      cause?: unknown;
    } = {},
  ) {
    super(message);
    this.cause = details.cause;
    this.name = "CompressionError";
  }
}
