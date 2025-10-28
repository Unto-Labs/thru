import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { StoredAccount } from './types';

/**
 * IndexedDB schema for account storage
 */
interface AccountDB extends DBSchema {
  accounts: {
    key: number; // account index
    value: StoredAccount;
    indexes: {
      'by-created': Date;
    };
  };
}

const DB_NAME = 'thru-wallet-accounts';
const DB_VERSION = 1;
const STORE_NAME = 'accounts';

/**
 * Account storage management using IndexedDB
 * Stores metadata for each derived account (but NOT private keys)
 */
export class AccountStorage {
  private static dbPromise: Promise<IDBPDatabase<AccountDB>> | null = null;

  /**
   * Initialize or get existing database connection
   */
  private static async getDB(): Promise<IDBPDatabase<AccountDB>> {
    if (!this.dbPromise) {
      this.dbPromise = openDB<AccountDB>(DB_NAME, DB_VERSION, {
        upgrade(db) {
          // Create accounts object store
          const store = db.createObjectStore(STORE_NAME, {
            keyPath: 'index',
          });

          // Create index for sorting by creation date
          store.createIndex('by-created', 'createdAt');
        },
      });
    }
    return this.dbPromise;
  }

  /**
   * Save a new account to storage
   * @param account - Account metadata to save
   */
  static async saveAccount(account: StoredAccount): Promise<void> {
    const db = await this.getDB();
    await db.put(STORE_NAME, account);
  }

  /**
   * Get all accounts, sorted by index (ascending)
   * @returns Array of stored accounts
   */
  static async getAccounts(): Promise<StoredAccount[]> {
    const db = await this.getDB();
    const accounts = await db.getAll(STORE_NAME);

    // Sort by index (0, 1, 2, ...)
    return accounts.sort((a, b) => a.index - b.index);
  }

  /**
   * Get a specific account by index
   * @param index - Account index
   * @returns Account or null if not found
   */
  static async getAccount(index: number): Promise<StoredAccount | null> {
    const db = await this.getDB();
    const account = await db.get(STORE_NAME, index);
    return account || null;
  }

  /**
   * Update an account's label
   * @param index - Account index
   * @param label - New label
   */
  static async updateAccountLabel(index: number, label: string): Promise<void> {
    const db = await this.getDB();
    const account = await db.get(STORE_NAME, index);

    if (!account) {
      throw new Error(`Account ${index} not found`);
    }

    account.label = label;
    await db.put(STORE_NAME, account);
  }

  /**
   * Get the next available account index
   * @returns Next index (0 if no accounts exist)
   */
  static async getNextAccountIndex(): Promise<number> {
    const accounts = await this.getAccounts();

    if (accounts.length === 0) {
      return 0;
    }

    // Return highest index + 1
    const maxIndex = Math.max(...accounts.map(a => a.index));
    return maxIndex + 1;
  }

  /**
   * Check if any accounts exist
   * @returns true if at least one account exists
   */
  static async hasAccounts(): Promise<boolean> {
    const db = await this.getDB();
    const count = await db.count(STORE_NAME);
    return count > 0;
  }

  /**
   * Get total number of accounts
   * @returns Account count
   */
  static async getAccountCount(): Promise<number> {
    const db = await this.getDB();
    return await db.count(STORE_NAME);
  }

  /**
   * Clear all accounts (use with caution!)
   * Used primarily for testing or wallet reset
   */
  static async clearAccounts(): Promise<void> {
    const db = await this.getDB();
    await db.clear(STORE_NAME);
  }
}
