import type { AppMetadata } from '@thru/chain-interfaces';

export const DB_NAME = 'thru-wallet';
export const DB_VERSION = 3;

export enum StoreName {
  CONNECTED_APPS = 'connectedApps',
  ACCOUNTS = 'accounts',
  PASSKEY_PROFILES = 'passkeyProfiles',
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
 * Initialize database schema.
 */
export function initializeSchema(db: IDBDatabase): void {
  if (!db.objectStoreNames.contains(StoreName.CONNECTED_APPS)) {
    const connectedApps = db.createObjectStore(StoreName.CONNECTED_APPS, { keyPath: 'key' });
    connectedApps.createIndex('by-account', 'accountId', { unique: false });
    connectedApps.createIndex('by-updated', 'updatedAt', { unique: false });
  }

  if (!db.objectStoreNames.contains(StoreName.ACCOUNTS)) {
    const accounts = db.createObjectStore(StoreName.ACCOUNTS, { keyPath: 'index' });
    accounts.createIndex('by-created', 'createdAt', { unique: false });
  }

  if (!db.objectStoreNames.contains(StoreName.PASSKEY_PROFILES)) {
    db.createObjectStore(StoreName.PASSKEY_PROFILES, { keyPath: 'id' });
  }
}
