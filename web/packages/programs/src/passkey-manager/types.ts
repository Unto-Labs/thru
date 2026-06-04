/**
 * Result of passkey registration (credential creation).
 */
export interface PasskeyRegistrationResult {
  credentialId: string; // base64url-encoded
  publicKeyX: string; // hex-encoded (32 bytes)
  publicKeyY: string; // hex-encoded (32 bytes)
  rpId: string;
  authenticatorAttachment?: 'platform' | 'cross-platform' | null;
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
  /** WebAuthn authenticator attachment, if surfaced by the browser:
   *  - 'platform': built-in / passkey on this device
   *  - 'cross-platform': e.g. signed in via QR using another device
   *  Used by the wallet to decide whether to offer "add this device". */
  authenticatorAttachment?: 'platform' | 'cross-platform' | null;
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
  /** On-chain passkey authority index for this wallet account.
   *  Omitted for the primary authority, which defaults to index 0. */
  authIdx?: number;
  label?: string;
  deviceName?: string;
  devicePlatform?: string;
  browserName?: string;
  authenticatorAttachment?: 'platform' | 'cross-platform' | null;
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

export interface RegisterCredentialInstructionParams {
  walletAccountIdx: number;
  lookupAccountIdx: number;
  seed: Uint8Array; // SHA-256(credentialId), 32 bytes
  stateProof: Uint8Array;
}

export type WalletSigner = {
  signTransaction: (payloadBase64: string) => Promise<string>;
};

export type TransactionExecutionSummary = {
  executionResult?: bigint | number | null;
  userErrorCode?: bigint | number | null;
  vmError?: number | string | bigint | null;
};
