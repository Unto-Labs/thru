import type { PasskeySigningResult, PasskeyMetadata } from '@thru/programs/wallet';

export type { PasskeySigningResult, PasskeyMetadata } from '@thru/programs/wallet';

export interface PasskeyMobileConfig {
  rpId?: string;
  rpName?: string;
}

export interface PasskeyRegistrationResult {
  credentialId: string;
  publicKeyX: Uint8Array;
  publicKeyY: Uint8Array;
  rpId: string;
}

export interface DiscoverablePasskeyResult {
  credentialId: string;
  rpId: string;
}

export interface StoredPasskeySigningResult extends PasskeySigningResult {
  passkey: PasskeyMetadata;
}
