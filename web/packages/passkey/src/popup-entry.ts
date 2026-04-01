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
  PasskeyPopupContext,
  PasskeyPopupAccount,
} from './types';

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

export {
  toPopupSigningResult,
  buildSuccessResponse,
  decodeChallenge,
  getResponseError,
} from './popup-service';
