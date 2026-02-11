// Constants
export {
  PASSKEY_MANAGER_PROGRAM_ADDRESS,
  INSTRUCTION_CREATE,
  INSTRUCTION_VALIDATE,
  INSTRUCTION_TRANSFER,
  INSTRUCTION_INVOKE,
  INSTRUCTION_ADD_AUTHORITY,
  INSTRUCTION_REMOVE_AUTHORITY,
  AUTHORITY_TAG_PASSKEY,
  AUTHORITY_TAG_PUBKEY,
} from './constants';

// Types
export type {
  Authority,
  CreateInstructionParams,
  TransferInstructionParams,
  ValidateInstructionParams,
  AccountContext,
  WalletSigner,
  TransactionExecutionSummary,
  PasskeyMetadata,
  PasskeyRegistrationResult,
  PasskeySigningResult,
  PasskeyDiscoverableSigningResult,
} from './types';

// Instructions
export { encodeCreateInstruction } from './instructions/create';
export { encodeValidateInstruction } from './instructions/validate';
export { encodeTransferInstruction } from './instructions/transfer';
export { encodeInvokeInstruction } from './instructions/invoke';
export { encodeAddAuthorityInstruction } from './instructions/add-authority';
export { encodeRemoveAuthorityInstruction } from './instructions/remove-authority';
export { concatenateInstructions } from './instructions/shared';

// Challenge
export { createValidateChallenge } from './challenge';

// Seeds & derivation
export { createWalletSeed, deriveWalletAddress } from './seeds';

// Account context building
export { buildAccountContext, buildPasskeyReadWriteAccounts, FEE_PAYER_ADDRESS } from './context';

// Account parsing
export { parseWalletNonce, fetchWalletNonce } from './accounts';

// Crypto (platform-agnostic P-256 / DER utilities)
export {
  parseDerSignature,
  normalizeLowS,
  normalizeSignatureComponent,
  P256_N,
  P256_HALF_N,
  bytesToBigIntBE,
  bigIntToBytesBE,
} from './crypto';

// Encoding (platform-agnostic byte/base64/hex utilities)
export {
  arrayBufferToBase64Url,
  base64UrlToArrayBuffer,
  bytesToBase64Url,
  base64UrlToBytes,
  bytesToHex,
  hexToBytes,
  bytesEqual,
  compareBytes,
  uniqueAccounts,
} from './encoding';

