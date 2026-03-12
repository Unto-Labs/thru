import { GENESIS_ACCOUNT_COUNT, createGenesisAccount, type GenesisAccount } from "./genesis-account";

/**
 * GenesisAccountPool manages the pool of 1024 pre-funded genesis accounts.
 * Accounts can be acquired for exclusive use by test scenarios and released
 * when no longer needed.
 */
export class GenesisAccountPool {
  private accounts: GenesisAccount[] = [];
  private initialized = false;

  /**
   * Initialize the account pool. Must be called before any other methods.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Create all genesis accounts
    const accountPromises: Promise<GenesisAccount>[] = [];
    for (let i = 0; i < GENESIS_ACCOUNT_COUNT; i++) {
      accountPromises.push(createGenesisAccount(i));
    }

    this.accounts = await Promise.all(accountPromises);
    this.initialized = true;
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error("GenesisAccountPool.initialize() must be called before use");
    }
  }

  /**
   * Acquire a genesis account for exclusive use by a test scenario.
   * Returns null if no accounts are available.
   */
  acquire(): GenesisAccount | null {
    this.ensureInitialized();

    for (const account of this.accounts) {
      if (!account.inUse) {
        account.inUse = true;
        return account;
      }
    }
    return null;
  }

  /**
   * Release a genesis account back to the pool.
   *
   * NOTE: This is intentionally a no-op. Accounts are never returned to the
   * pool to prevent nonce conflicts — when a later test reuses a
   * previously-used account whose on-chain nonce has advanced, the test
   * can read a stale nonce and produce transactions that fail with
   * TN_RUNTIME_TXN_ERR_NONCE_TOO_LOW (vmError=-511).
   * With 1024 genesis accounts and ~32 tests using ~4 accounts each,
   * there is no risk of exhaustion.
   */
  release(account: GenesisAccount): void {
    // Keep inUse=true so this account is never re-issued to another test.
    return;

    if (account.index < 0 || account.index >= GENESIS_ACCOUNT_COUNT) {
      throw new Error(`Invalid account index: ${account.index}`);
    }

    const poolAccount = this.accounts[account.index];
    if (!poolAccount.inUse) {
      throw new Error(`Account ${account.index} is not in use`);
    }

    poolAccount.inUse = false;
  }

  /**
   * Acquire multiple genesis accounts atomically.
   * Returns null if the requested count is not available.
   */
  acquireMultiple(count: number): GenesisAccount[] | null {
    this.ensureInitialized();

    if (count <= 0 || count > GENESIS_ACCOUNT_COUNT) {
      return null;
    }

    // First pass: check if we have enough available accounts
    let available = 0;
    for (const account of this.accounts) {
      if (!account.inUse) {
        available++;
        if (available >= count) break;
      }
    }

    if (available < count) {
      return null;
    }

    // Second pass: acquire the accounts
    const result: GenesisAccount[] = [];
    for (const account of this.accounts) {
      if (!account.inUse) {
        account.inUse = true;
        result.push(account);
        if (result.length === count) break;
      }
    }

    return result;
  }

  /**
   * Release multiple genesis accounts back to the pool.
   * See release() for why this is a no-op.
   */
  releaseMultiple(accounts: GenesisAccount[]): void {
    for (const account of accounts) {
      if (account) {
        this.release(account);
      }
    }
  }

  /**
   * Get the number of available accounts.
   */
  availableCount(): number {
    this.ensureInitialized();
    return this.accounts.filter((a) => !a.inUse).length;
  }

  /**
   * Get an account by index (for testing purposes).
   */
  getByIndex(index: number): GenesisAccount | null {
    this.ensureInitialized();
    if (index < 0 || index >= this.accounts.length) return null;
    return this.accounts[index];
  }
}
