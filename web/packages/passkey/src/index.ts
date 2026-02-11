// Types
export type {
  PasskeyRegistrationResult,
  PasskeySigningResult,
  PasskeyDiscoverableSigningResult,
  PasskeyStoredSigningResult,
  PasskeyMetadata,
  PasskeyClientCapabilities,
  PasskeyPopupContext,
  PasskeyPopupAccount,
  PasskeyPopupAction,
  PasskeyPopupGetRequestPayload,
  PasskeyPopupCreateRequestPayload,
  PasskeyPopupGetStoredRequestPayload,
  PasskeyPopupRequestPayload,
  PasskeyPopupRequest,
  PasskeyPopupSigningResult,
  PasskeyPopupStoredPasskey,
  PasskeyPopupStoredSigningResult,
  PasskeyPopupRegistrationResult,
  PasskeyPopupResponse,
} from './types';

// Registration
export { registerPasskey } from './register';

// Signing
export { signWithPasskey, signWithStoredPasskey, signWithDiscoverablePasskey } from './sign';

// Crypto (re-exported from @thru/passkey-manager)
export {
  parseDerSignature,
  normalizeLowS,
  normalizeSignatureComponent,
  P256_N,
  P256_HALF_N,
  bytesToBigIntBE,
  bigIntToBytesBE,
} from '@thru/passkey-manager';

// Capabilities
export {
  isWebAuthnSupported,
  preloadPasskeyClientCapabilities,
  getPasskeyClientCapabilities,
  getCachedPasskeyClientCapabilities,
  shouldUsePasskeyPopup,
  isInIframe,
  type PasskeyPromptAction,
} from './capabilities';

// Encoding (re-exported from @thru/passkey-manager)
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
} from '@thru/passkey-manager';

// Popup (parent side)
export {
  PASSKEY_POPUP_PATH,
  PASSKEY_POPUP_READY_EVENT,
  PASSKEY_POPUP_REQUEST_EVENT,
  PASSKEY_POPUP_RESPONSE_EVENT,
  PASSKEY_POPUP_CHANNEL,
  openPasskeyPopupWindow,
  closePopup,
  requestPasskeyPopup,
} from './popup';

// Popup service (popup window side)
export {
  toPopupSigningResult,
  buildSuccessResponse,
  decodeChallenge,
  getPopupDisplayInfo,
  getResponseError,
  signWithPreferredPasskey,
  buildStoredPasskeyResult,
} from './popup-service';
