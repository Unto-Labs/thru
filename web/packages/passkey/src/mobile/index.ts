export type {
  PasskeyMetadata,
  PasskeySigningResult,
  PasskeyMobileConfig,
  PasskeyRegistrationResult,
  DiscoverablePasskeyResult,
  StoredPasskeySigningResult,
} from './types';

export { classifyPasskeyError, type PasskeyErrorKind } from './errors';

export { bytesToBase64 } from '@thru/passkey-manager';

export {
  storePasskeyMetadata,
  touchPasskeyLastUsedAt,
  getStoredPasskeyMetadata,
  hasStoredPasskey,
  clearPasskeyMetadata,
  storeWalletInfo,
  getStoredAddress,
  getStoredUserId,
  getStoredTokenAccount,
  hasStoredWallet,
  clearSession,
} from './storage';

export {
  registerPasskey,
  signWithPasskey,
  authenticateWithDiscoverablePasskey,
  extractP256Coordinates,
} from './passkey';
