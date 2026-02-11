import type { PasskeyRegistrationResult, PasskeyPopupRegistrationResult } from './types';
import { arrayBufferToBase64Url, bytesToHex } from '@thru/passkey-manager';
import {
  isWebAuthnSupported,
  getPasskeyPromptMode,
  maybePreopenPopup,
  shouldFallbackToPopup,
  type PasskeyPromptAction,
} from './capabilities';
import { requestPasskeyPopup, openPasskeyPopupWindow, closePopup } from './popup';

/**
 * Register a new passkey for a profile.
 */
export async function registerPasskey(
  alias: string,
  userId: string,
  rpId: string
): Promise<PasskeyRegistrationResult> {
  if (!isWebAuthnSupported()) {
    throw new Error('WebAuthn is not supported in this browser');
  }

  return runWithPromptMode(
    'create',
    () => registerPasskeyInline(alias, userId, rpId),
    (preopenedPopup) => registerPasskeyViaPopup(alias, userId, rpId, preopenedPopup)
  );
}

async function runWithPromptMode<T>(
  action: PasskeyPromptAction,
  inlineFn: () => Promise<T>,
  popupFn: (preopenedPopup?: Window | null) => Promise<T>
): Promise<T> {
  const preopenedPopup = maybePreopenPopup(action, openPasskeyPopupWindow);
  const promptMode = await getPasskeyPromptMode(action);
  if (promptMode === 'popup') {
    return popupFn(preopenedPopup);
  }

  closePopup(preopenedPopup);

  try {
    return await inlineFn();
  } catch (error) {
    if (shouldFallbackToPopup(error)) {
      return popupFn();
    }
    throw error;
  }
}

async function registerPasskeyInline(
  alias: string,
  userId: string,
  rpId: string
): Promise<PasskeyRegistrationResult> {
  const rpName = 'Thru Wallet';

  const userIdBytes = new TextEncoder().encode(userId);
  const userIdBuffer = userIdBytes.slice(0, 64);

  const challenge = crypto.getRandomValues(new Uint8Array(32));

  const createOptions: PublicKeyCredentialCreationOptions = {
    challenge,
    rp: {
      id: rpId,
      name: rpName,
    },
    user: {
      id: userIdBuffer,
      name: alias,
      displayName: alias,
    },
    pubKeyCredParams: [
      { type: 'public-key', alg: -7 },
    ],
    authenticatorSelection: {
      authenticatorAttachment: 'platform',
      userVerification: 'required',
      residentKey: 'required',
      requireResidentKey: true,
    },
    attestation: 'none',
    timeout: 60000,
  };

  const credential = (await navigator.credentials.create({
    publicKey: createOptions,
  })) as PublicKeyCredential | null;

  if (!credential) {
    throw new Error('Passkey registration was cancelled');
  }

  const response = credential.response as AuthenticatorAttestationResponse;
  const { x, y } = extractP256PublicKey(response);

  return {
    credentialId: arrayBufferToBase64Url(credential.rawId),
    publicKeyX: bytesToHex(x),
    publicKeyY: bytesToHex(y),
    rpId,
  };
}

async function registerPasskeyViaPopup(
  alias: string,
  userId: string,
  rpId: string,
  preopenedPopup?: Window | null
): Promise<PasskeyRegistrationResult> {
  const result = await requestPasskeyPopup<PasskeyPopupRegistrationResult>(
    'create',
    { alias, userId, rpId },
    preopenedPopup
  );
  return result;
}

// Key extraction helpers

function extractP256PublicKey(
  response: AuthenticatorAttestationResponse
): { x: Uint8Array; y: Uint8Array } {
  if (typeof response.getPublicKey === 'function') {
    const spkiKey = response.getPublicKey();
    if (spkiKey) {
      return extractFromSpki(new Uint8Array(spkiKey));
    }
  }

  if (typeof response.getAuthenticatorData === 'function') {
    const authData = new Uint8Array(response.getAuthenticatorData());
    return extractFromAuthenticatorData(authData);
  }

  throw new Error('Unable to extract public key: browser does not support required WebAuthn methods');
}

function extractFromSpki(spki: Uint8Array): { x: Uint8Array; y: Uint8Array } {
  const pointStart = spki.length - 65;

  if (spki[pointStart] !== 0x04) {
    throw new Error('Invalid SPKI format: expected uncompressed point');
  }

  const x = spki.slice(pointStart + 1, pointStart + 33);
  const y = spki.slice(pointStart + 33, pointStart + 65);

  if (x.length !== 32 || y.length !== 32) {
    throw new Error('Invalid SPKI format: incorrect coordinate length');
  }

  return { x, y };
}

function extractFromAuthenticatorData(authData: Uint8Array): { x: Uint8Array; y: Uint8Array } {
  const rpIdHashLength = 32;
  const flagsLength = 1;
  const counterLength = 4;
  const offset = rpIdHashLength + flagsLength + counterLength;
  const aaguidLength = 16;
  const credIdLenOffset = offset + aaguidLength;
  const credIdLength = (authData[credIdLenOffset] << 8) | authData[credIdLenOffset + 1];
  const coseKeyOffset = credIdLenOffset + 2 + credIdLength;
  const coseKey = authData.slice(coseKeyOffset);

  return extractFromCoseKey(coseKey);
}

function extractFromCoseKey(coseKey: Uint8Array): { x: Uint8Array; y: Uint8Array } {
  const mapStart = coseKey[0];
  if (mapStart !== 0xa5 && mapStart !== 0xa4) {
    throw new Error('Invalid COSE key format');
  }

  let offset = 1;
  let x: Uint8Array | null = null;
  let y: Uint8Array | null = null;

  while (offset < coseKey.length) {
    const key = coseKey[offset++];
    const valueType = coseKey[offset++];

    if (key === 0x21) {
      const length = valueType & 0x1f;
      x = coseKey.slice(offset, offset + length);
      offset += length;
      continue;
    }

    if (key === 0x22) {
      const length = valueType & 0x1f;
      y = coseKey.slice(offset, offset + length);
      offset += length;
      continue;
    }

    if (valueType >= 0x40 && valueType <= 0x5f) {
      const length = valueType & 0x1f;
      offset += length;
      continue;
    }

    if (valueType === 0x01 || valueType === 0x02 || valueType === 0x03) {
      continue;
    }

    if (valueType >= 0x18 && valueType <= 0x1b) {
      const size = 1 << (valueType - 0x18);
      offset += size;
      continue;
    }
  }

  if (!x || !y) {
    throw new Error('Failed to extract P-256 public key from COSE data');
  }

  if (x.length !== 32 || y.length !== 32) {
    throw new Error('Invalid COSE key: incorrect coordinate length');
  }

  return { x, y };
}
