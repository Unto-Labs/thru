/**
 * @deprecated Import browser APIs from `@thru/passkey/web` and popup APIs from
 * `@thru/passkey/popup`. The root export path remains as a temporary
 * compatibility shim and will be removed after downstream consumers migrate.
 */
export type {
  PasskeyRegistrationResult,
  PasskeySigningResult,
  PasskeyDiscoverableSigningResult,
  PasskeyStoredSigningResult,
  PasskeyMetadata,
  PasskeyClientCapabilities,
  PasskeyPopupContext,
  PasskeyPopupAccount,
} from './web';

/**
 * @deprecated Import browser APIs from `@thru/passkey/web`.
 */
export {
  registerPasskey,
  signWithPasskey,
  signWithStoredPasskey,
  signWithDiscoverablePasskey,
  parseDerSignature,
  normalizeLowS,
  normalizeSignatureComponent,
  P256_N,
  P256_HALF_N,
  bytesToBigIntBE,
  bigIntToBytesBE,
  isWebAuthnSupported,
  preloadPasskeyClientCapabilities,
  getPasskeyClientCapabilities,
  getCachedPasskeyClientCapabilities,
  shouldUsePasskeyPopup,
  isInIframe,
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
  type PasskeyPromptAction,
} from './web';

/**
 * @deprecated Import popup APIs from `@thru/passkey/popup`.
 */
export type {
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
} from './popup-entry';

/**
 * @deprecated Import popup APIs from `@thru/passkey/popup`.
 */
export {
  PASSKEY_POPUP_PATH,
  PASSKEY_POPUP_READY_EVENT,
  PASSKEY_POPUP_REQUEST_EVENT,
  PASSKEY_POPUP_RESPONSE_EVENT,
  PASSKEY_POPUP_CHANNEL,
  openPasskeyPopupWindow,
  closePopup,
  requestPasskeyPopup,
  toPopupSigningResult,
  buildSuccessResponse,
  decodeChallenge,
  getResponseError,
} from './popup-entry';
