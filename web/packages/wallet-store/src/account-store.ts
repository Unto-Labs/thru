import { getUnifiedDB } from './db';
import { StoreName } from './schema';
import { StoredAccount } from './types';

const STORE_NAME = StoreName.ACCOUNTS;

/**
 * Account storage management using the unified IndexedDB.
 * Stores metadata for each derived account (but NOT private keys).
 */
export class AccountStorage {
  /**
   * Save a new account to storage
   */
  static async saveAccount(account: StoredAccount): Promise<void> {
    const db = await getUnifiedDB();
    await db.put(STORE_NAME, account);
  }

  /**
   * Get all accounts, sorted by index (ascending)
   */
  static async getAccounts(): Promise<StoredAccount[]> {
    const db = await getUnifiedDB();
    const accounts = await db.getAll(STORE_NAME) as StoredAccount[];
    return accounts.sort((a, b) => a.index - b.index);
  }

  /**
   * Get a specific account by index
   */
  static async getAccount(index: number): Promise<StoredAccount | null> {
    const db = await getUnifiedDB();
    const account = await db.get(STORE_NAME, index) as StoredAccount | undefined;
    return account || null;
  }

  /**
   * Update an account's label
   */
  static async updateAccountLabel(index: number, label: string): Promise<void> {
    const db = await getUnifiedDB();
    const account = await db.get(STORE_NAME, index) as StoredAccount | undefined;

    if (!account) {
      throw new Error(`Account ${index} not found`);
    }

    account.label = label;
    await db.put(STORE_NAME, account);
  }

  /**
   * Get the next available account index
   */
  static async getNextAccountIndex(): Promise<number> {
    const accounts = await this.getAccounts();

    if (accounts.length === 0) {
      return 0;
    }

    const maxIndex = Math.max(...accounts.map(a => a.index));
    return maxIndex + 1;
  }

  /**
   * Check if any accounts exist
   */
  static async hasAccounts(): Promise<boolean> {
    const db = await getUnifiedDB();
    const count = await db.count(STORE_NAME);
    return count > 0;
  }

  /**
   * Get total number of accounts
   */
  static async getAccountCount(): Promise<number> {
    const db = await getUnifiedDB();
    return await db.count(STORE_NAME);
  }

  /**
   * Clear all accounts (use with caution!)
   */
  static async clearAccounts(): Promise<void> {
    const db = await getUnifiedDB();
    await db.clear(STORE_NAME);
  }
}
