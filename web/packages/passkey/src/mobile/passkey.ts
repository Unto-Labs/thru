import { create as passkeyCreate, get as passkeyGet } from 'react-native-passkeys';
import {
  bytesToBase64Url,
  base64UrlToBytes,
  normalizeLowS,
  parseDerSignature,
  type PasskeySigningResult,
} from '@thru/passkey-manager';
import type {
  DiscoverablePasskeyResult,
  PasskeyMobileConfig,
  PasskeyRegistrationResult,
} from './types';

type ProcessLike = typeof globalThis & {
  process?: {
    env?: Record<string, string | undefined>;
  };
};

function getDefaultConfig(config?: PasskeyMobileConfig): Required<PasskeyMobileConfig> {
  const env = (globalThis as ProcessLike).process?.env ?? {};

  return {
    rpId: config?.rpId ?? env.EXPO_PUBLIC_PASSKEY_RP_ID ?? 'wallet.thru.org',
    rpName: config?.rpName ?? env.EXPO_PUBLIC_PASSKEY_RP_NAME ?? 'Thru Wallet',
  };
}

export async function registerPasskey(
  alias: string,
  userId: string,
  config?: PasskeyMobileConfig
): Promise<PasskeyRegistrationResult> {
  const { rpId, rpName } = getDefaultConfig(config);
  const challenge = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const userIdB64 = bytesToBase64Url(new TextEncoder().encode(userId));

  const result = await passkeyCreate({
    challenge,
    rp: { id: rpId, name: rpName },
    user: { id: userIdB64, name: alias, displayName: alias },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
    authenticatorSelection: {
      authenticatorAttachment: 'platform',
      userVerification: 'required',
      residentKey: 'required',
    },
    attestation: 'none',
    timeout: 60000,
  });

  if (!result) {
    throw new Error('Passkey registration was cancelled');
  }

  const publicKeyB64 = result.response.getPublicKey?.();
  if (!publicKeyB64) {
    throw new Error('Failed to retrieve public key from registration');
  }

  const keyBytes = base64UrlToBytes(publicKeyB64);
  const { x, y } = extractP256Coordinates(keyBytes);

  return {
    credentialId: result.id,
    publicKeyX: x,
    publicKeyY: y,
    rpId,
  };
}

export async function signWithPasskey(
  credentialId: string,
  challenge: Uint8Array,
  rpId?: string
): Promise<PasskeySigningResult> {
  const resolvedRpId = rpId ?? getDefaultConfig().rpId;
  const challengeB64 = bytesToBase64Url(challenge);

  const result = await passkeyGet({
    challenge: challengeB64,
    rpId: resolvedRpId,
    allowCredentials: [{ type: 'public-key', id: credentialId }],
    userVerification: 'required',
    timeout: 60000,
  });

  if (!result) {
    throw new Error('Passkey authentication was cancelled');
  }

  const derSignature = base64UrlToBytes(result.response.signature);
  let { r, s } = parseDerSignature(derSignature);
  s = normalizeLowS(s);

  return {
    signature: new Uint8Array([...r, ...s]),
    authenticatorData: base64UrlToBytes(result.response.authenticatorData),
    clientDataJSON: base64UrlToBytes(result.response.clientDataJSON),
    signatureR: r,
    signatureS: s,
  };
}

export async function authenticateWithDiscoverablePasskey(
  config?: Pick<PasskeyMobileConfig, 'rpId'>
): Promise<DiscoverablePasskeyResult | null> {
  const { rpId } = getDefaultConfig(config);

  try {
    const challenge = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
    const result = await passkeyGet({
      challenge,
      rpId,
      userVerification: 'required',
      timeout: 60000,
    });

    return result ? { credentialId: result.id, rpId } : null;
  } catch {
    return null;
  }
}

export function extractP256Coordinates(
  keyBytes: Uint8Array
): { x: Uint8Array; y: Uint8Array } {
  if (keyBytes.length === 64) {
    return {
      x: keyBytes.slice(0, 32),
      y: keyBytes.slice(32, 64),
    };
  }

  if (keyBytes.length === 65 && keyBytes[0] === 0x04) {
    return {
      x: keyBytes.slice(1, 33),
      y: keyBytes.slice(33, 65),
    };
  }

  const pointStart = keyBytes.length - 65;
  if (pointStart > 0 && keyBytes[pointStart] === 0x04) {
    return {
      x: keyBytes.slice(pointStart + 1, pointStart + 33),
      y: keyBytes.slice(pointStart + 33, pointStart + 65),
    };
  }

  throw new Error(
    `Unsupported public key format (${keyBytes.length} bytes). Expected raw X||Y (64), uncompressed point (65), or SPKI DER (91).`
  );
}
