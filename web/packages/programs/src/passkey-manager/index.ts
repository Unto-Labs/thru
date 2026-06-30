// Constants
export {
  PASSKEY_MANAGER_PROGRAM_ADDRESS,
  INSTRUCTION_CREATE,
  INSTRUCTION_VALIDATE,
  INSTRUCTION_TRANSFER,
  INSTRUCTION_ADD_AUTHORITY,
  INSTRUCTION_REMOVE_AUTHORITY,
  INSTRUCTION_REGISTER_CREDENTIAL,
  AUTHORITY_TAG_PASSKEY,
  AUTHORITY_TAG_PUBKEY,
  AUTHORITY_BYTES,
  AUTHORITY_RECORD_BYTES,
  LONG_LIVED_AUTHORITY_EXPIRY_SECONDS,
} from './constants';

// Types
export type {
  Authority,
  AuthorityRecord,
  CreateInstructionParams,
  TransferInstructionParams,
  TargetInstructionParams,
  ValidateInstructionParams,
  AddAuthorityInstructionParams,
  RemoveAuthorityInstructionParams,
  RegisterCredentialInstructionParams,
  AccountContext,
  WalletSigner,
  TransactionExecutionSummary,
  PasskeyMetadata,
  PasskeyRegistrationResult,
  PasskeySigningResult,
  PasskeyDiscoverableSigningResult,
} from './types';

// Instructions
export {
  buildAuthority,
  buildAuthorityRecord,
  createAuthorityRecord,
  createSessionAuthorityRecord,
  encodeCreateInstruction,
  encodeLegacyCreateInstruction,
} from './instructions/create';
export { encodeValidateInstruction } from './instructions/validate';
export { encodeTransferInstruction } from './instructions/transfer';
export { encodeInvokeInstruction } from './instructions/invoke';
export {
  encodeAddAuthorityInstruction,
  encodeLegacyAddAuthorityInstruction,
} from './instructions/add-authority';
export { encodeRemoveAuthorityInstruction } from './instructions/remove-authority';
export { encodeRegisterCredentialInstruction } from './instructions/register-credential';
export { concatenateInstructions } from './instructions/shared';

// Challenge
export { createValidateChallenge, VALIDATE_CHALLENGE_DOMAIN } from './challenge';

// Seeds & derivation
export { createWalletSeed, deriveWalletAddress, createCredentialLookupSeed, deriveCredentialLookupAddress } from './seeds';

// Account context building
export { buildAccountContext, buildPasskeyReadWriteAccounts } from './context';
export { decodeAddress, encodeAddress } from '@thru/sdk/helpers';

// Account parsing
export {
  parseWalletNonce,
  fetchWalletNonce,
  parseCredentialLookupWallet,
  parseWalletAuthorities,
  formatAuthorityPubkey,
} from './accounts';
export type { ParsedAuthority, WalletAuthorities } from './accounts';

// Authority matching
export {
  findPasskeyAuthorityIndexForIdentity,
  findPasskeyAuthorityIndexInWalletData,
  isPasskeyAuthorityCheckable,
  preparePasskeyAuthorityTargets,
  resolvePasskeyAuthorityIndex,
} from './authority';
export type {
  CheckablePasskeyAuthorityIdentity,
  PasskeyAuthorityIdentity,
  PasskeyAuthorityTarget,
  PreparePasskeyAuthorityTargetsOptions,
} from './authority';

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
  bytesToBase64,
  bytesToBase64Url,
  base64UrlToBytes,
  bytesToHex,
  hexToBytes,
  bytesEqual,
  compareBytes,
  uniqueAccounts,
} from './encoding';
