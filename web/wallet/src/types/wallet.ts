import { EncryptedData } from '@thru/crypto';

/**
 * Wallet configuration and state
 */
export interface Wallet {
  id: string;
  encryptedSeed: EncryptedData;
  accounts: Account[];
  createdAt: Date;
}

/**
 * Individual account derived from wallet seed
 */
export interface Account {
  index: number;
  publicKey: string;
  path: string; // BIP44 derivation path: m/44'/9999'/index'/0'
  label?: string;
  balance?: bigint;
}

/**
 * Account with keypair (sensitive data)
 */
export interface WalletCreationResult {
  mnemonic: string;
  seed: Uint8Array;
  account: Account;
}

export interface WalletUnlockResult {
  seed: Uint8Array;
  accounts: Account[];
}
