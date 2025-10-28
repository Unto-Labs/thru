import { DerivedAccount } from '@/types/account';
import { AddressType } from '@thru/chain-interfaces';
import { EncryptionService, MnemonicGenerator, ThruHDWallet } from '@thru/crypto';
import { AccountStorage, WalletStorage } from '@thru/indexed-db-stamper';
import { createThruClient } from '@thru/thru-sdk/client';

export type NetworkType = 'default';

/**
 * WalletManager - Core business logic for wallet operations
 * Pure TypeScript class with no React dependencies
 */
export class WalletManager {
  /**
   * Check if a wallet exists in storage
   */
  static async checkWalletExists(): Promise<boolean> {
    return await WalletStorage.walletExists();
  }

  /**
   * Create a new wallet with optional mnemonic
   * If mnemonic is not provided, generates a new one
   */
  static async createWallet(
    password: string,
    mnemonic?: string
  ): Promise<{ mnemonic: string }> {
    // Generate or use provided mnemonic
    const phrase = mnemonic || this.generateMnemonic();

    // Validate mnemonic
    if (!this.validateMnemonic(phrase)) {
      throw new Error('Invalid mnemonic phrase');
    }

    // Convert to seed
    const seed = MnemonicGenerator.toSeed(phrase);

    // Encrypt seed
    const encrypted = await EncryptionService.encrypt(seed, password);

    // Save encrypted seed
    await WalletStorage.saveEncryptedSeed(encrypted);

    // Request persistent storage
    await WalletStorage.requestPersistentStorage();

    return { mnemonic: phrase };
  }

  /**
   * Unlock wallet with password and return decrypted seed
   */
  static async unlockWallet(password: string): Promise<Uint8Array> {
    const encrypted = await WalletStorage.getEncryptedSeed();
    if (!encrypted) {
      throw new Error('Wallet not found');
    }

    // Decrypt and return seed
    const seed = await EncryptionService.decrypt(encrypted, password);
    return seed;
  }

  /**
   * Get all accounts from storage
   */
  static async getAccounts(): Promise<DerivedAccount[]> {
    const storedAccounts = await AccountStorage.getAccounts();

    // Map to DerivedAccount format with placeholder keypair
    return storedAccounts.map((acc) => ({
      ...acc,
      addressType: acc.addressType ?? AddressType.THRU,
    }));
  }

  /**
   * Create a new account derived from seed
   */
  static async createAccount(
    seed: Uint8Array,
    label?: string
  ): Promise<DerivedAccount> {
    // Get next available index
    const nextIndex = await AccountStorage.getNextAccountIndex();

    // Derive new account
    const newAccount = await ThruHDWallet.getAccount(seed, nextIndex);

    // Default label if not provided
    const accountLabel = label || `Account ${nextIndex + 1}`;

    // Save to storage
    await AccountStorage.saveAccount({
      index: nextIndex,
      label: accountLabel,
      publicKey: newAccount.address,
      path: newAccount.path,
      createdAt: new Date(),
      addressType: AddressType.THRU,
    });

    return {
      index: nextIndex,
      label: accountLabel,
      publicKey: newAccount.address,
      path: newAccount.path,
      createdAt: new Date(),
    };
  }

  /**
   * Rename an account
   */
  static async renameAccount(index: number, label: string): Promise<void> {
    await AccountStorage.updateAccountLabel(index, label);
  }

  /**
   * Derive keypair for a specific account index
   */
  static deriveKeypair(_seed: Uint8Array, _accountIndex: number) {
    throw new Error('deriveKeypair is not supported for Thru accounts');
  }

  /**
   * Get balance for a single address
   */
  static async getBalance(
    publicKey: string,
    _network: NetworkType = 'default'
  ): Promise<bigint> {
    const client = createThruClient({});
    const account = await client.accounts.get(publicKey);
    const balance = account.meta?.balance ?? 0n;
    return balance;
  }

  /**
   * Get balances for multiple addresses
   */
  static async getBalances(
    publicKeys: string[],
    _network: NetworkType = 'default'
  ): Promise<Map<number, bigint>> {
    const balances = new Map<number, bigint>();

    for (let i = 0; i < publicKeys.length; i++) {
      try {
        const balance = await WalletManager.getBalance(publicKeys[i]);
        balances.set(i, balance);
      } catch (err) {
        console.error(`Failed to load balance for account ${i}:`, err);
        balances.set(i, 0n);
      }
    }

    return balances;
  }

  /**
   * Send SOL transfer using worker for signing
   * This method creates the unsigned transaction in main thread,
   * sends it to worker for signing, then broadcasts the signed transaction
   */
  static async sendTransfer(
    workerClient: any, // WorkerClient instance
    accountIndex: number,
    fromPublicKey: string,
    to: string,
    amount: bigint,
    network: NetworkType = 'default'
  ): Promise<string> {
    throw new Error('sendTransfer is not implemented for Thru yet');
  }

  /**
   * Generate a new 12-word mnemonic
   */
  static generateMnemonic(): string {
    return MnemonicGenerator.generate();
  }

  /**
   * Validate a mnemonic phrase
   */
  static validateMnemonic(phrase: string): boolean {
    return MnemonicGenerator.validate(phrase);
  }

  /**
   * Clear all wallet data (for reset/logout)
   */
  static async clearWallet(): Promise<void> {
    await WalletStorage.clearAll();
    await AccountStorage.clearAccounts();
  }
}
