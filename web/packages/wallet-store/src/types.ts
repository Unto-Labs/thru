import type { AddressType } from '@thru/chain-interfaces';

/**
 * Stored account representation in IndexedDB
 */
export interface StoredAccount {
  index: number;              // BIP44 account index (0, 1, 2, ...)
  label: string;              // User-defined name (e.g., "Trading", "NFTs")
  publicKey: string;          // Encoded address string (currently base58 SOL; will migrate to Thru)
  path: string;               // Full derivation path (m/44'/<coin>'/index'/0')
  createdAt: Date;            // Timestamp of account creation
  addressType?: AddressType;  // Chain identifier (e.g., 'thru')
  publicKeyRawBase64?: string; // Optional raw 32-byte public key as base64 (for Thru migration)
}

/**
 * A single passkey profile record stored in IndexedDB.
 */
export interface PasskeyProfileRecord {
  id: string;
  label: string;
  passkey: PasskeyMetadataRecord | null;
  createdAt: string;
  lastUsedAt: string | null;
}

/**
 * Passkey metadata stored alongside a profile.
 */
export interface PasskeyMetadataRecord {
  credentialId: string;
  publicKeyX: string;
  publicKeyY: string;
  rpId: string;
  label?: string;
  createdAt: string;
  lastUsedAt: string;
}

/**
 * Settings singleton stored in the passkeyProfiles store with id='settings'.
 */
export interface PasskeyStoreSettings {
  id: 'settings';
  selectedIndex: number;
  version: number;
}
