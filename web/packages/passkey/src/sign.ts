import {
  reportPasskeyCeremony,
  serializePasskeyCredential,
  type PasskeyReportingOptions,
} from './reporter';
import type {
  PasskeySigningResult,
  PasskeyStoredSigningResult,
  PasskeyDiscoverableSigningResult,
  PasskeyMetadata,
  PasskeyPopupContext,
  PasskeyPopupSigningResult,
  PasskeyPopupStoredSigningResult,
  PasskeyStoredSigningOptions,
} from './types';
import {
  arrayBufferToBase64Url,
  base64UrlToArrayBuffer,
  bytesToBase64Url,
  base64UrlToBytes,
  parseDerSignature,
  normalizeLowS,
} from '@thru/programs/passkey-manager';
import {
  isWebAuthnSupported,
  getPasskeyPromptMode,
  isInIframe,
  maybePreopenPopup,
  shouldFallbackToPopup,
  type PasskeyPromptAction,
} from './capabilities';
import { requestPasskeyPopup, openPasskeyPopupWindow, closePopup } from './popup';

const WEB_AUTHN_FOCUS_RETRY_DELAYS_MS = [150, 300, 600, 1000, 1500];

/**
 * Sign a challenge with an existing passkey (by credential ID).
 */
export async function signWithPasskey(
  credentialId: string,
  challenge: Uint8Array,
  rpId: string,
  options: PasskeyReportingOptions = {}
): Promise<PasskeySigningResult> {
  if (!isWebAuthnSupported()) {
    throw new Error('WebAuthn is not supported in this browser');
  }

  return runWithPromptMode(
    'get',
    () => signWithPasskeyInline(credentialId, challenge, rpId, options),
    (preopenedPopup) =>
      signWithPasskeyViaPopup(credentialId, challenge, rpId, preopenedPopup, options)
  );
}

/**
 * Sign with stored passkey (for embedded/popup contexts).
 */
export async function signWithStoredPasskey(
  challenge: Uint8Array,
  rpId: string,
  preferredPasskey: PasskeyMetadata | null,
  allPasskeys: PasskeyMetadata[],
  context?: PasskeyPopupContext,
  options: PasskeyStoredSigningOptions = {}
): Promise<PasskeyStoredSigningResult> {
  if (!isWebAuthnSupported()) {
    throw new Error('WebAuthn is not supported in this browser');
  }

  const allowPopupFallback = options.allowPopupFallback ?? true;
  const allowDiscoverableFallback = options.allowDiscoverableFallback ?? true;
  const preopenedPopup = allowPopupFallback
    ? maybePreopenPopup('get', openPasskeyPopupWindow)
    : null;
  const promptMode = allowPopupFallback ? await getPasskeyPromptMode('get') : 'inline';
  const storedPasskey = preferredPasskey;
  const canUsePopup = allowPopupFallback && isInIframe();

  if (!allowDiscoverableFallback && !storedPasskey) {
    closePopup(preopenedPopup);
    throw new Error('No stored passkey available for this wallet');
  }

  if (options.preferDiscoverable) {
    closePopup(preopenedPopup);
    return signWithDiscoverableStoredPasskey(
      challenge,
      storedPasskey?.rpId ?? rpId,
      allPasskeys,
      options
    );
  }

  if (promptMode === 'popup' || (canUsePopup && !storedPasskey)) {
    return requestStoredPasskeyPopup(challenge, preopenedPopup, context, options);
  }

  closePopup(preopenedPopup);

  try {
    if (storedPasskey) {
      try {
        const result = await signWithPasskeyInline(
          storedPasskey.credentialId,
          challenge,
          storedPasskey.rpId,
          options
        );
        return {
          ...result,
          passkey: storedPasskey,
        };
      } catch (error) {
        if (!allowDiscoverableFallback || !shouldFallbackToDiscoverable(error)) {
          throw error;
        }
        return signWithDiscoverableStoredPasskey(
          challenge,
          storedPasskey.rpId,
          allPasskeys,
          options
        );
      }
    }

    return signWithDiscoverableStoredPasskey(challenge, rpId, allPasskeys, options);
  } catch (error) {
    if (canUsePopup && shouldFallbackToPopup(error)) {
      return requestStoredPasskeyPopup(challenge, undefined, context, options);
    }

    throw error;
  }
}

async function signWithDiscoverableStoredPasskey(
  challenge: Uint8Array,
  rpId: string,
  allPasskeys: PasskeyMetadata[],
  options: PasskeyReportingOptions
): Promise<PasskeyStoredSigningResult> {
  const discoverable = await signWithDiscoverablePasskey(challenge, rpId, options);
  const matchingPasskey =
    allPasskeys.find((p) => p.credentialId === discoverable.credentialId) ?? null;
  const now = new Date().toISOString();
  const passkey = matchingPasskey ?? {
    credentialId: discoverable.credentialId,
    publicKeyX: '',
    publicKeyY: '',
    rpId: discoverable.rpId,
    createdAt: now,
    lastUsedAt: now,
  };

  return {
    credentialJson: discoverable.credentialJson,
    signature: discoverable.signature,
    authenticatorData: discoverable.authenticatorData,
    clientDataJSON: discoverable.clientDataJSON,
    signatureR: discoverable.signatureR,
    signatureS: discoverable.signatureS,
    authenticatorAttachment: discoverable.authenticatorAttachment,
    passkey,
  };
}

function shouldFallbackToDiscoverable(error: unknown): boolean {
  const name =
    error && typeof error === 'object' && 'name' in error
      ? String((error as { name?: unknown }).name)
      : '';
  const message =
    error && typeof error === 'object' && 'message' in error
      ? String((error as { message?: unknown }).message)
      : '';
  const normalized = `${name} ${message}`.toLowerCase();

  if (
    normalized.includes('user rejected') ||
    normalized.includes('user canceled') ||
    normalized.includes('user cancelled')
  ) {
    return false;
  }

  return (
    normalized.includes('notallowederror') ||
    normalized.includes('invalidstateerror') ||
    normalized.includes('notfounderror') ||
    normalized.includes('not found') ||
    normalized.includes('no passkey') ||
    normalized.includes('no credential') ||
    normalized.includes('saved for this app')
  );
}

/**
 * Sign with a discoverable passkey (no credential ID - browser prompts user to select).
 */
export async function signWithDiscoverablePasskey(
  challenge: Uint8Array,
  rpId: string,
  options: PasskeyReportingOptions = {}
): Promise<PasskeyDiscoverableSigningResult> {
  if (!isWebAuthnSupported()) {
    throw new Error('WebAuthn is not supported in this browser');
  }

  const resolvedRpId = rpId;
  const result = await signWithPasskeyAssertion(challenge, resolvedRpId, undefined, options);

  return {
    credentialJson: result.credentialJson,
    signature: result.signature,
    authenticatorData: result.authenticatorData,
    clientDataJSON: result.clientDataJSON,
    signatureR: result.signatureR,
    signatureS: result.signatureS,
    credentialId: result.credentialId,
    rpId: resolvedRpId,
    authenticatorAttachment: result.authenticatorAttachment,
  };
}

// Internal helpers

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

async function signWithPasskeyInline(
  credentialId: string,
  challenge: Uint8Array,
  rpId: string,
  options: PasskeyReportingOptions = {}
): Promise<PasskeySigningResult> {
  const result = await signWithPasskeyAssertion(challenge, rpId, credentialId, options);
  return {
    credentialJson: result.credentialJson,
    signature: result.signature,
    authenticatorData: result.authenticatorData,
    clientDataJSON: result.clientDataJSON,
    signatureR: result.signatureR,
    signatureS: result.signatureS,
    authenticatorAttachment: result.authenticatorAttachment,
  };
}

async function signWithPasskeyAssertion(
  challenge: Uint8Array,
  rpId: string,
  credentialId: string | undefined,
  options: PasskeyReportingOptions
): Promise<PasskeySigningResult & { credentialId: string }> {
  const challengeBytes = new Uint8Array(challenge);
  const getOptions: PublicKeyCredentialRequestOptions = {
    challenge: challengeBytes,
    rpId,
    userVerification: 'required',
    timeout: 60000,
  };

  if (credentialId) {
    const credentialIdBuffer = base64UrlToArrayBuffer(credentialId);
    getOptions.allowCredentials = [
      {
        type: 'public-key',
        id: credentialIdBuffer,
        transports: ['internal', 'hybrid', 'usb', 'ble', 'nfc'],
      },
    ];
  }

  return reportPasskeyCeremony(
    options.ceremonyReporter,
    { kind: 'get', mode: 'inline', allowCredentials: Boolean(credentialId) },
    async () => {
      const assertion = await getPasskeyAssertionWithFocusRetry(getOptions);

      if (!assertion) {
        throw new Error('Passkey authentication was cancelled');
      }

      const response = assertion.response as AuthenticatorAssertionResponse;

      const signature = new Uint8Array(response.signature);
      let { r, s } = parseDerSignature(signature);
      s = normalizeLowS(s);

      /* `authenticatorAttachment` distinguishes a same-device passkey
     ('platform') from a cross-device one signed via QR / hybrid
     transport ('cross-platform'). Drives the wallet's add-device
     prompt. Browsers may report null. */
      const rawAttachment =
        (
          assertion as PublicKeyCredential & {
            authenticatorAttachment?: AuthenticatorAttachment | null;
          }
        ).authenticatorAttachment ?? null;

      return {
        signature: new Uint8Array([...r, ...s]),
        authenticatorData: new Uint8Array(response.authenticatorData),
        clientDataJSON: new Uint8Array(response.clientDataJSON),
        signatureR: r,
        signatureS: s,
        credentialId: arrayBufferToBase64Url(assertion.rawId),
        authenticatorAttachment: rawAttachment,
        credentialJson: serializePasskeyCredential(assertion, 'get'),
      };
    }
  );
}

async function getPasskeyAssertionWithFocusRetry(
  publicKey: PublicKeyCredentialRequestOptions
): Promise<PublicKeyCredential | null> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return (await navigator.credentials.get({
        publicKey,
      })) as PublicKeyCredential | null;
    } catch (error) {
      const retryDelayMs = WEB_AUTHN_FOCUS_RETRY_DELAYS_MS[attempt];
      if (retryDelayMs === undefined || !isDocumentNotFocusedError(error)) {
        throw error;
      }
      await waitForFocusRetry(retryDelayMs);
    }
  }
}

function isDocumentNotFocusedError(error: unknown): boolean {
  const name =
    error && typeof error === 'object' && 'name' in error
      ? String((error as { name?: unknown }).name)
      : '';
  const message =
    error && typeof error === 'object' && 'message' in error
      ? String((error as { message?: unknown }).message)
      : '';
  const normalized = `${name} ${message}`.toLowerCase();
  return normalized.includes('document is not focused');
}

function waitForFocusRetry(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => setTimeout(resolve, delayMs);
    if (typeof requestAnimationFrame !== 'function') {
      finish();
      return;
    }
    requestAnimationFrame(() => requestAnimationFrame(finish));
  });
}

async function signWithPasskeyViaPopup(
  credentialId: string,
  challenge: Uint8Array,
  rpId: string,
  preopenedPopup: Window | null | undefined,
  options: PasskeyReportingOptions
): Promise<PasskeySigningResult> {
  const result = await requestPasskeyPopup<PasskeyPopupSigningResult>(
    'get',
    {
      credentialId,
      challengeBase64Url: bytesToBase64Url(challenge),
      rpId,
    },
    preopenedPopup,
    options
  );

  return decodePopupSigningResult(result);
}

async function requestStoredPasskeyPopup(
  challenge: Uint8Array,
  preopenedPopup: Window | null | undefined,
  context: PasskeyPopupContext | undefined,
  options: PasskeyReportingOptions
): Promise<PasskeyStoredSigningResult> {
  const result = await requestPasskeyPopup<PasskeyPopupStoredSigningResult>(
    'getStored',
    {
      challengeBase64Url: bytesToBase64Url(challenge),
      context,
    },
    preopenedPopup,
    options
  );
  return decodePopupStoredSigningResult(result);
}

function decodePopupSigningResult(result: PasskeyPopupSigningResult): PasskeySigningResult {
  return {
    credentialJson: result.credentialJson,
    signature: base64UrlToBytes(result.signatureBase64Url),
    authenticatorData: base64UrlToBytes(result.authenticatorDataBase64Url),
    clientDataJSON: base64UrlToBytes(result.clientDataJSONBase64Url),
    signatureR: base64UrlToBytes(result.signatureRBase64Url),
    signatureS: base64UrlToBytes(result.signatureSBase64Url),
    authenticatorAttachment: result.authenticatorAttachment ?? null,
  };
}

function decodePopupStoredSigningResult(
  result: PasskeyPopupStoredSigningResult
): PasskeyStoredSigningResult {
  return {
    ...decodePopupSigningResult(result),
    passkey: result.passkey,
    accounts: result.accounts,
  };
}
