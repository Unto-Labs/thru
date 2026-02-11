import type { PasskeySigningResult, PasskeyMetadata } from '@thru/passkey-manager';

// Re-export platform-agnostic types for backward compatibility
export type {
  PasskeyRegistrationResult,
  PasskeySigningResult,
  PasskeyDiscoverableSigningResult,
  PasskeyMetadata,
} from '@thru/passkey-manager';

/**
 * Signing result with stored passkey metadata attached.
 */
export interface PasskeyStoredSigningResult extends PasskeySigningResult {
  passkey: PasskeyMetadata;
  accounts?: PasskeyPopupAccount[];
}

/**
 * WebAuthn client capabilities map.
 */
export interface PasskeyClientCapabilities {
  conditionalCreate?: boolean;
  conditionalGet?: boolean;
  credentialProtectionPolicy?: boolean;
  credProps?: boolean;
  minPinLength?: boolean;
  multiFactor?: boolean;
  passkeyPlatformAuthenticator?: boolean;
  largeBlob?: boolean;
  rpId?: boolean;
  userVerifyingPlatformAuthenticator?: boolean;
  relatedOrigins?: boolean;
}

/**
 * Context sent to popup for display purposes.
 */
export interface PasskeyPopupContext {
  appId?: string;
  appName?: string;
  appUrl?: string;
  origin?: string;
  imageUrl?: string;
}

/**
 * Account info passed through popup bridge.
 */
export interface PasskeyPopupAccount {
  index: number;
  label?: string;
  publicKey: string;
  path?: string;
  createdAt?: string;
  addressType?: string;
  publicKeyRawBase64?: string;
}

// Popup types
export type PasskeyPopupAction = 'get' | 'create' | 'getStored';

export interface PasskeyPopupGetRequestPayload {
  credentialId: string;
  challengeBase64Url: string;
  rpId: string;
}

export interface PasskeyPopupCreateRequestPayload {
  alias: string;
  userId: string;
}

export interface PasskeyPopupGetStoredRequestPayload {
  challengeBase64Url: string;
  context?: PasskeyPopupContext;
}

export type PasskeyPopupRequestPayload =
  | PasskeyPopupGetRequestPayload
  | PasskeyPopupCreateRequestPayload
  | PasskeyPopupGetStoredRequestPayload;

export interface PasskeyPopupRequest {
  type: string;
  requestId: string;
  action: PasskeyPopupAction;
  payload: PasskeyPopupRequestPayload;
}

export interface PasskeyPopupSigningResult {
  signatureBase64Url: string;
  authenticatorDataBase64Url: string;
  clientDataJSONBase64Url: string;
  signatureRBase64Url: string;
  signatureSBase64Url: string;
}

export interface PasskeyPopupStoredPasskey {
  credentialId: string;
  publicKeyX: string;
  publicKeyY: string;
  rpId: string;
  label?: string;
  createdAt: string;
  lastUsedAt: string;
}

export interface PasskeyPopupStoredSigningResult extends PasskeyPopupSigningResult {
  passkey: PasskeyPopupStoredPasskey;
  accounts?: PasskeyPopupAccount[];
}

export interface PasskeyPopupRegistrationResult {
  credentialId: string;
  publicKeyX: string;
  publicKeyY: string;
  rpId: string;
}

export type PasskeyPopupResponse =
  | {
      type: string;
      requestId: string;
      action: 'get';
      success: true;
      result: PasskeyPopupSigningResult;
    }
  | {
      type: string;
      requestId: string;
      action: 'create';
      success: true;
      result: PasskeyPopupRegistrationResult;
    }
  | {
      type: string;
      requestId: string;
      action: 'getStored';
      success: true;
      result: PasskeyPopupStoredSigningResult;
    }
  | {
      type: string;
      requestId: string;
      action: PasskeyPopupAction;
      success: false;
      error: { name?: string; message: string };
    };
