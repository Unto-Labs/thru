import type { AppMetadata } from '@thru/chain-interfaces';

/**
 * IndexedDB schema for wallet storage
 */

export const DB_NAME = 'thru-wallet';
export const DB_VERSION = 2;

/**
 * Object store names
 */
export enum StoreName {
  WALLET = 'wallet',
  SETTINGS = 'settings',
  CONNECTED_APPS = 'connectedApps',
}

/**
 * Wallet data stored in IndexedDB
 */
export interface WalletData {
  id: string;
  encryptedSeed: string; // Serialized EncryptedData
  createdAt: number; // Timestamp
  updatedAt: number; // Timestamp
}

/**
 * Settings data
 */
export interface SettingsData {
  key: string;
  value: any;
}

export interface ConnectedAppData {
  key: string; // `${accountId}:${appId}`
  accountId: number;
  appId: string;
  origin: string;
  metadata: AppMetadata;
  connectedAt: number;
  updatedAt: number;
}

/**
 * Initialize database schema
 */
export function initializeSchema(db: IDBDatabase): void {
  // Wallet store
  if (!db.objectStoreNames.contains(StoreName.WALLET)) {
    const walletStore = db.createObjectStore(StoreName.WALLET, { keyPath: 'id' });
    walletStore.createIndex('createdAt', 'createdAt', { unique: false });
  }

  // Settings store
  if (!db.objectStoreNames.contains(StoreName.SETTINGS)) {
    db.createObjectStore(StoreName.SETTINGS, { keyPath: 'key' });
  }

  // Connected apps store
  if (!db.objectStoreNames.contains(StoreName.CONNECTED_APPS)) {
    const store = db.createObjectStore(StoreName.CONNECTED_APPS, { keyPath: 'key' });
    store.createIndex('by-account', 'accountId', { unique: false });
    store.createIndex('by-updated', 'updatedAt', { unique: false });
  }
}
