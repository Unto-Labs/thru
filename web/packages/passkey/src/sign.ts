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
import { runPasskeyCeremony } from './ceremony';
import { requestPasskeyPopup } from './popup';

/**
 * Sign a challenge with an existing passkey (by credential ID).
 */
export async function signWithPasskey(
  credentialId: string,
  challenge: Uint8Array,
  rpId: string,
  options: PasskeyReportingOptions = {}
): Promise<PasskeySigningResult> {
  return runPasskeyCeremony(
    'get',
    (signal) => signWithPasskeyInline(credentialId, challenge, rpId, { ...options, signal }),
    (preopenedPopup, signal) =>
      signWithPasskeyViaPopup(credentialId, challenge, rpId, preopenedPopup, {
        ...options,
        signal,
      }),
    options
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
  if (options.allowDiscoverableFallback === false && !preferredPasskey) {
    throw new Error('No stored passkey available for this wallet');
  }
  return runPasskeyCeremony(
    'get',
    async (signal) => {
      const inlineOptions = { ...options, signal };
      if (preferredPasskey && !options.preferDiscoverable) {
        try {
          const result = await signWithPasskeyInline(
            preferredPasskey.credentialId,
            challenge,
            preferredPasskey.rpId,
            inlineOptions
          );
          return { ...result, passkey: preferredPasskey };
        } catch (error) {
          if (options.allowDiscoverableFallback === false || !shouldFallbackToDiscoverable(error))
            throw error;
        }
      }
      return signWithDiscoverableStoredPasskey(
        challenge,
        preferredPasskey?.rpId ?? rpId,
        allPasskeys,
        inlineOptions
      );
    },
    async (opened, signal) => {
      // Preserve the selected signing credential; a popup must not switch accounts.
      if (preferredPasskey && !options.preferDiscoverable) {
        const signed = await signWithPasskeyViaPopup(
          preferredPasskey.credentialId,
          challenge,
          preferredPasskey.rpId,
          opened,
          { ...options, signal }
        );
        return { ...signed, passkey: preferredPasskey };
      }
      return requestStoredPasskeyPopup(
        challenge,
        opened,
        context,
        { ...options, signal },
        rpId,
        true
      );
    },
    options
  );
}

async function signWithDiscoverableStoredPasskey(
  challenge: Uint8Array,
  rpId: string,
  allPasskeys: PasskeyMetadata[],
  options: PasskeyReportingOptions
): Promise<PasskeyStoredSigningResult> {
  const discoverable = await signWithDiscoverablePasskeyInline(challenge, rpId, options);
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
  return runPasskeyCeremony(
    'get',
    (signal) => signWithDiscoverablePasskeyInline(challenge, rpId, { ...options, signal }),
    async (opened, signal) => {
      const result = await requestStoredPasskeyPopup(
        challenge,
        opened,
        undefined,
        { ...options, signal },
        rpId,
        true
      );
      return { ...result, credentialId: result.passkey.credentialId, rpId: result.passkey.rpId };
    },
    options
  );
}

async function signWithDiscoverablePasskeyInline(
  challenge: Uint8Array,
  rpId: string,
  options: PasskeyReportingOptions
): Promise<PasskeyDiscoverableSigningResult> {
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
  /* `hints` is WebAuthn L3; this package's DOM lib predates it. */
  const getOptions: PublicKeyCredentialRequestOptions & { hints?: string[] } = {
    challenge: challengeBytes,
    rpId,
    userVerification: 'required',
    timeout: 60000,
  };
  if (options.preferHybrid) {
    getOptions.hints = ['hybrid'];
  }

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
      const assertion = (await navigator.credentials.get({
        publicKey: getOptions,
        signal: options.signal,
      })) as PublicKeyCredential | null;

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
  options: PasskeyReportingOptions,
  rpId: string,
  preferDiscoverable = false
): Promise<PasskeyStoredSigningResult> {
  const result = await requestPasskeyPopup<PasskeyPopupStoredSigningResult>(
    'getStored',
    {
      challengeBase64Url: bytesToBase64Url(challenge),
      rpId,
      preferDiscoverable,
      ...(options.preferHybrid ? { preferHybrid: true } : {}),
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
