import { openDB, IDBPDatabase } from 'idb';
import {
  DB_NAME,
  DB_VERSION,
  StoreName,
  initializeSchema,
  type ConnectedAppData,
} from './schema';
import type { ConnectedApp, AppMetadata } from '@thru/chain-interfaces';

const STORE_NAME = StoreName.CONNECTED_APPS;

function createKey(accountId: number, appId: string): string {
  return `${accountId}:${appId}`;
}

function toDomain(record: ConnectedAppData): ConnectedApp {
  return {
    accountId: record.accountId,
    appId: record.appId,
    origin: record.origin,
    metadata: record.metadata,
    connectedAt: record.connectedAt,
    updatedAt: record.updatedAt,
  };
}

export interface ConnectedAppUpsert {
  accountId: number;
  appId: string;
  origin: string;
  metadata: AppMetadata;
}

/**
 * Storage helper for connected dApps per account
 */
export class ConnectedAppsStorage {
  private static dbPromise: Promise<IDBPDatabase> | null = null;

  private static async getDB(): Promise<IDBPDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = openDB(DB_NAME, DB_VERSION, {
        upgrade(db) {
          initializeSchema(db as any);
        },
      });
    }
    return this.dbPromise;
  }

  static async upsert(app: ConnectedAppUpsert): Promise<ConnectedApp> {
    const db = await this.getDB();
    const key = createKey(app.accountId, app.appId);
    const existing = (await db.get(STORE_NAME, key)) as ConnectedAppData | undefined;
    const now = Date.now();

    const record: ConnectedAppData = {
      key,
      accountId: app.accountId,
      appId: app.appId,
      origin: app.origin,
      metadata: app.metadata,
      connectedAt: existing?.connectedAt ?? now,
      updatedAt: now,
    };

    await db.put(STORE_NAME, record);
    return toDomain(record);
  }

  static async listByAccount(accountId: number): Promise<ConnectedApp[]> {
    const db = await this.getDB();
    const records = (await db.getAllFromIndex(STORE_NAME, 'by-account', IDBKeyRange.only(accountId))) as ConnectedAppData[];
    return records
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(toDomain);
  }

  static async remove(accountId: number, appId: string): Promise<void> {
    const db = await this.getDB();
    await db.delete(STORE_NAME, createKey(accountId, appId));
  }

  static async clear(): Promise<void> {
    const db = await this.getDB();
    await db.clear(STORE_NAME);
  }

  static async get(accountId: number, appId: string): Promise<ConnectedApp | null> {
    const db = await this.getDB();
    const record = (await db.get(STORE_NAME, createKey(accountId, appId))) as ConnectedAppData | undefined;
    return record ? toDomain(record) : null;
  }
}
