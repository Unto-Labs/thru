import type { AppMetadata } from '@thru/chain-interfaces';

export const DB_NAME = 'thru-wallet';
export const DB_VERSION = 1;

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
  const connectedApps = db.createObjectStore(StoreName.CONNECTED_APPS, { keyPath: 'key' });
  connectedApps.createIndex('by-account', 'accountId', { unique: false });
  connectedApps.createIndex('by-updated', 'updatedAt', { unique: false });

  const accounts = db.createObjectStore(StoreName.ACCOUNTS, { keyPath: 'index' });
  accounts.createIndex('by-created', 'createdAt', { unique: false });

  db.createObjectStore(StoreName.PASSKEY_PROFILES, { keyPath: 'id' });
}
