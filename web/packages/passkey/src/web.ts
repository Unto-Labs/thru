export type {
  PasskeyRegistrationResult,
  PasskeySigningResult,
  PasskeyDiscoverableSigningResult,
  PasskeyStoredSigningResult,
  PasskeyMetadata,
  PasskeyClientCapabilities,
  PasskeyPopupContext,
  PasskeyPopupAccount,
  PasskeyStoredSigningOptions,
  PasskeyRegistrationOptions,
} from './types';

export { registerPasskey } from './register';
export { createDistinctPasskeyLabel } from './label';
export type { DistinctPasskeyLabelOptions } from './label';

export {
  signWithPasskey,
  signWithStoredPasskey,
  signWithDiscoverablePasskey,
} from './sign';

export {
  parseDerSignature,
  normalizeLowS,
  normalizeSignatureComponent,
  P256_N,
  P256_HALF_N,
  bytesToBigIntBE,
  bigIntToBytesBE,
} from '@thru/programs/passkey-manager';

export {
  isWebAuthnSupported,
  preloadPasskeyClientCapabilities,
  getPasskeyClientCapabilities,
  getCachedPasskeyClientCapabilities,
  shouldUsePasskeyPopup,
  isInIframe,
  type PasskeyPromptAction,
} from './capabilities';

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
} from '@thru/programs/passkey-manager';
