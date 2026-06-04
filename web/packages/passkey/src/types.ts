import type { PasskeySigningResult, PasskeyMetadata } from '@thru/programs/passkey-manager';

// Re-export platform-agnostic types for backward compatibility
export type {
  PasskeyRegistrationResult,
  PasskeySigningResult,
  PasskeyDiscoverableSigningResult,
  PasskeyMetadata,
} from '@thru/programs/passkey-manager';

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
 * Options for stored passkey signing in embedded contexts.
 */
export interface PasskeyStoredSigningOptions {
  allowPopupFallback?: boolean;
  /** Prefer an RP-scoped discoverable credential prompt over a stored
   * credential-id lookup. Native WebViews can show misleading
   * app-level "no passkey" UI when allowCredentials is stale, while a
   * discoverable prompt correctly lets the wallet/RP choose the passkey. */
  preferDiscoverable?: boolean;
}

/**
 * Options for passkey registration in embedded contexts.
 */
export interface PasskeyRegistrationOptions {
  allowPopupFallback?: boolean;
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
  rpId: string;
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
  authenticatorAttachment?: 'platform' | 'cross-platform' | null;
}

export interface PasskeyPopupStoredPasskey {
  credentialId: string;
  publicKeyX: string;
  publicKeyY: string;
  rpId: string;
  label?: string;
  deviceName?: string;
  devicePlatform?: string;
  browserName?: string;
  authenticatorAttachment?: 'platform' | 'cross-platform' | null;
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
  authenticatorAttachment?: 'platform' | 'cross-platform' | null;
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
