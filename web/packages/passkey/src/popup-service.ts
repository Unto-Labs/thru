import type {
  PasskeyPopupAction,
  PasskeyPopupAccount,
  PasskeyPopupContext,
  PasskeyPopupResponse,
  PasskeyPopupSigningResult,
  PasskeyPopupStoredPasskey,
  PasskeyPopupStoredSigningResult,
  PasskeyMetadata,
  PasskeySigningResult,
} from './types';
import {
  PASSKEY_POPUP_RESPONSE_EVENT,
} from './popup';
import { bytesToBase64Url, base64UrlToBytes } from '@thru/passkey-manager';
import { signWithPasskey, signWithDiscoverablePasskey } from './sign';

type PasskeySignResult =
  | Awaited<ReturnType<typeof signWithDiscoverablePasskey>>
  | Awaited<ReturnType<typeof signWithPasskey>>;

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

export function getPopupDisplayInfo(context?: PasskeyPopupContext): {
  name: string;
  url?: string;
  imageUrl?: string;
  logoText: string;
} {
  const name = context?.appName || context?.origin || 'A dApp';
  const url = context?.appUrl || context?.origin;
  const logoText = name.charAt(0).toUpperCase() || 'A';
  return {
    name,
    url,
    imageUrl: context?.imageUrl,
    logoText,
  };
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

export async function signWithPreferredPasskey(
  preferredPasskey: PasskeyMetadata | null,
  challenge: Uint8Array,
  log?: (message: string) => void
): Promise<{ result: PasskeySignResult; credentialId: string; rpId: string }> {
  const resolvedRpId = preferredPasskey?.rpId ?? window.location.hostname;

  if (preferredPasskey?.credentialId && preferredPasskey.rpId) {
    try {
      const storedResult = await signWithPasskey(
        preferredPasskey.credentialId,
        challenge,
        preferredPasskey.rpId
      );
      return {
        result: storedResult,
        credentialId: preferredPasskey.credentialId,
        rpId: preferredPasskey.rpId,
      };
    } catch (error) {
      if (!shouldFallbackToDiscoverable(error)) {
        throw error;
      }
      if (log) {
        log('stored passkey failed; falling back to discoverable prompt');
      }
    }
  }

  const discovered = await signWithDiscoverablePasskey(challenge, resolvedRpId);
  return {
    result: discovered,
    credentialId: discovered.credentialId,
    rpId: resolvedRpId,
  };
}

export function buildStoredPasskeyResult(
  signed: { result: PasskeySignResult; credentialId: string; rpId: string },
  preferredPasskey: PasskeyMetadata | null,
  profiles: Array<{ passkey: PasskeyMetadata | null }>,
  accounts: PasskeyPopupAccount[]
): PasskeyPopupStoredSigningResult {
  const now = new Date().toISOString();
  const matchingPasskey =
    profiles.find((profile) => profile.passkey?.credentialId === signed.credentialId)?.passkey ??
    null;

  const passkey: PasskeyPopupStoredPasskey = (matchingPasskey ?? {
    credentialId: signed.credentialId,
    publicKeyX: '',
    publicKeyY: '',
    rpId: signed.rpId,
    label: preferredPasskey?.label,
    createdAt: now,
    lastUsedAt: now,
  }) as PasskeyPopupStoredPasskey;

  return {
    ...toPopupSigningResult(signed.result),
    passkey: matchingPasskey ? { ...passkey, lastUsedAt: now } : passkey,
    accounts,
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

function shouldFallbackToDiscoverable(error: unknown): boolean {
  const normalized = normalizeError(error).normalized;
  return (
    normalized.includes('notfounderror') ||
    normalized.includes('notallowederror') ||
    normalized.includes('securityerror')
  );
}
