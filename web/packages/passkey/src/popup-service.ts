import type {
  PasskeyPopupAction,
  PasskeyPopupResponse,
  PasskeyPopupSigningResult,
  PasskeySigningResult,
} from './types';
import {
  PASSKEY_POPUP_RESPONSE_EVENT,
} from './popup';
import { bytesToBase64Url, base64UrlToBytes } from '@thru/passkey-manager';
export function toPopupSigningResult(result: PasskeySigningResult): PasskeyPopupSigningResult {
  return {
    signatureBase64Url: bytesToBase64Url(result.signature),
    authenticatorDataBase64Url: bytesToBase64Url(result.authenticatorData),
    clientDataJSONBase64Url: bytesToBase64Url(result.clientDataJSON),
    signatureRBase64Url: bytesToBase64Url(result.signatureR),
    signatureSBase64Url: bytesToBase64Url(result.signatureS),
  };
}

export function buildSuccessResponse<T>(
  requestId: string,
  action: PasskeyPopupAction,
  result: T
): PasskeyPopupResponse {
  return {
    type: PASSKEY_POPUP_RESPONSE_EVENT,
    requestId,
    action,
    success: true,
    result,
  } as PasskeyPopupResponse;
}

export function decodeChallenge(base64Url: string): Uint8Array {
  return base64UrlToBytes(base64Url);
}

export function getResponseError(action: PasskeyPopupAction, error: unknown): { name?: string; message: string } {
  const { name, message } = normalizeError(error);
  const actionLabel = `Popup ${action}`;
  const messageText = message || 'Passkey popup failed';
  const detailedMessage = messageText.includes('Popup')
    ? messageText
    : `${actionLabel}: ${messageText}`;
  return {
    name,
    message: detailedMessage,
  };
}
function normalizeError(error: unknown): { name?: string; message?: string; normalized: string } {
  const name =
    error && typeof error === 'object' && 'name' in error
      ? String((error as { name?: unknown }).name)
      : '';
  const message =
    error && typeof error === 'object' && 'message' in error
      ? String((error as { message?: unknown }).message)
      : '';
  return {
    name,
    message,
    normalized: `${name} ${message}`.toLowerCase(),
  };
}
