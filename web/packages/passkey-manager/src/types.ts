/**
 * Result of passkey registration (credential creation).
 */
export interface PasskeyRegistrationResult {
  credentialId: string; // base64url-encoded
  publicKeyX: string; // hex-encoded (32 bytes)
  publicKeyY: string; // hex-encoded (32 bytes)
  rpId: string;
}

/**
 * Result of passkey signing (assertion).
 */
export interface PasskeySigningResult {
  signature: Uint8Array; // Raw P-256 signature (r || s, 64 bytes)
  authenticatorData: Uint8Array;
  clientDataJSON: Uint8Array;
  signatureR: Uint8Array; // 32 bytes
  signatureS: Uint8Array; // 32 bytes
}

/**
 * Signing result with discoverable credential info.
 */
export interface PasskeyDiscoverableSigningResult extends PasskeySigningResult {
  credentialId: string; // base64url-encoded
  rpId: string;
}

/**
 * Passkey metadata stored locally (the actual private key lives in the device's secure enclave).
 */
export interface PasskeyMetadata {
  credentialId: string;
  publicKeyX: string;
  publicKeyY: string;
  rpId: string;
  label?: string;
  createdAt: string;
  lastUsedAt: string;
}

export type Authority =
  | {
      tag: 1; // passkey
      pubkeyX: Uint8Array; // 32 bytes
      pubkeyY: Uint8Array; // 32 bytes
    }
  | {
      tag: 2; // pubkey
      pubkey: Uint8Array; // 32 bytes
    };

export interface CreateInstructionParams {
  walletAccountIdx: number;
  authority: Authority;
  seed: Uint8Array;
  stateProof: Uint8Array;
}

export interface TransferInstructionParams {
  walletAccountIdx: number;
  toAccountIdx: number;
  amount: bigint;
}

export interface ValidateInstructionParams {
  walletAccountIdx: number;
  authIdx: number;
  signatureR: Uint8Array;
  signatureS: Uint8Array;
  authenticatorData: Uint8Array;
  clientDataJSON: Uint8Array;
}

export interface AccountContext {
  readWriteAddresses: string[];
  readOnlyAddresses: string[];
  accountAddresses: string[];
  walletAccountIdx: number;
  getAccountIndex: (pubkey: Uint8Array) => number;
}

export type WalletSigner = {
  signTransaction: (payloadBase64: string) => Promise<string>;
};

export type TransactionExecutionSummary = {
  executionResult?: bigint | number | null;
  userErrorCode?: bigint | number | null;
  vmError?: number | string | bigint | null;
};
