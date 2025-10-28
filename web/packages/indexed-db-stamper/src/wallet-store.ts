import { openDB, IDBPDatabase } from 'idb';
import { DB_NAME, DB_VERSION, StoreName, WalletData, initializeSchema } from './schema';
import { EncryptedData, EncryptionService } from '@thru/crypto';

/**
 * IndexedDB storage for wallet data
 */
export class WalletStorage {
  private static dbPromise: Promise<IDBPDatabase> | null = null;

  /**
   * Get or create database connection
   */
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

  /**
   * Save encrypted seed to storage
   * @param encryptedSeed - Encrypted seed data
   * @param walletId - Optional wallet ID (defaults to 'default')
   */
  static async saveEncryptedSeed(
    encryptedSeed: EncryptedData,
    walletId: string = 'default'
  ): Promise<void> {
    const db = await this.getDB();

    // Serialize encrypted data
    const serialized = EncryptionService.serialize(encryptedSeed);

    const now = Date.now();
    const walletData: WalletData = {
      id: walletId,
      encryptedSeed: serialized,
      createdAt: now,
      updatedAt: now,
    };

    await db.put(StoreName.WALLET, walletData);
  }

  /**
   * Get encrypted seed from storage
   * @param walletId - Wallet ID (defaults to 'default')
   * @returns Encrypted seed data or null if not found
   */
  static async getEncryptedSeed(walletId: string = 'default'): Promise<EncryptedData | null> {
    const db = await this.getDB();
    const walletData = await db.get(StoreName.WALLET, walletId);

    if (!walletData) {
      return null;
    }

    // Deserialize encrypted data
    return EncryptionService.deserialize(walletData.encryptedSeed);
  }

  /**
   * Check if wallet exists
   * @param walletId - Wallet ID (defaults to 'default')
   */
  static async walletExists(walletId: string = 'default'): Promise<boolean> {
    const db = await this.getDB();
    const walletData = await db.get(StoreName.WALLET, walletId);
    return walletData !== undefined;
  }

  /**
   * Delete wallet from storage
   * @param walletId - Wallet ID (defaults to 'default')
   */
  static async deleteWallet(walletId: string = 'default'): Promise<void> {
    const db = await this.getDB();
    await db.delete(StoreName.WALLET, walletId);
  }

  /**
   * Clear all wallet data (use with caution!)
   */
  static async clearAll(): Promise<void> {
    const db = await this.getDB();
    await db.clear(StoreName.WALLET);
    await db.clear(StoreName.SETTINGS);
  }

  /**
   * Get storage quota information
   */
  static async getStorageInfo(): Promise<{
    usage: number;
    quota: number;
    available: number;
  } | null> {
    if (!navigator.storage || !navigator.storage.estimate) {
      return null;
    }

    const estimate = await navigator.storage.estimate();
    const usage = estimate.usage || 0;
    const quota = estimate.quota || 0;

    return {
      usage,
      quota,
      available: quota - usage,
    };
  }

  /**
   * Request persistent storage (prevents data from being cleared)
   */
  static async requestPersistentStorage(): Promise<boolean> {
    if (!navigator.storage || !navigator.storage.persist) {
      return false;
    }

    return await navigator.storage.persist();
  }

  /**
   * Check if storage is persistent
   */
  static async isPersistent(): Promise<boolean> {
    if (!navigator.storage || !navigator.storage.persisted) {
      return false;
    }

    return await navigator.storage.persisted();
  }
}
