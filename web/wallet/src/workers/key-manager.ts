/**
 * KeyManager - Secure in-memory key storage within Web Worker
 * Handles seed storage, derivation, and automatic zeroization
 */

import { EncryptedData, EncryptionService, ThruHDWallet } from '@thru/crypto';
import { signWithDomain, SignatureDomain } from '@thru/thru-sdk';

function decodeBase64String(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function encodeBase64Bytes(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export class KeyManager {
  private seed: Uint8Array | null = null;
  private lockTimer: number | null = null;
  private readonly LOCK_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
  private readonly onAutoLock?: () => void;

  constructor(onAutoLock?: () => void) {
    this.onAutoLock = onAutoLock;
  }

  /**
   * Unlock the wallet by decrypting the seed with password
   */
  async unlock(encrypted: EncryptedData, password: string): Promise<void> {
    try {
      // Decrypt seed
      const decryptedSeed = await EncryptionService.decrypt(encrypted, password);

      // Store seed in memory
      this.seed = decryptedSeed;

      // Start auto-lock timer
      this.resetLockTimer();
    } catch (error) {
      throw new Error('Invalid password or corrupted data');
    }
  }

  /**
   * Lock the wallet and zero out seed from memory
   */
  lock(): void {
    // Zero out seed in memory
    if (this.seed) {
      this.seed.fill(0);
      this.seed = null;
    }

    // Clear lock timer
    if (this.lockTimer !== null) {
      clearTimeout(this.lockTimer);
      this.lockTimer = null;
    }
  }

  /**
   * Check if wallet is currently unlocked
   */
  isUnlocked(): boolean {
    return this.seed !== null;
  }

  /**
   * Derive account keypair for a specific index
   */
  async deriveAccount(accountIndex: number): Promise<{ publicKey: string; path: string }> {
    if (!this.seed) {
      throw new Error('Wallet is locked');
    }

    // Reset lock timer on activity
    this.resetLockTimer();

    const account = await ThruHDWallet.getAccount(this.seed, accountIndex);

    return {
      publicKey: account.address,
      path: account.path,
    };
  }

  /**
   * Get public key for a specific account
   */
  async getPublicKey(accountIndex: number): Promise<string> {
    if (!this.seed) {
      throw new Error('Wallet is locked');
    }

    // Reset lock timer on activity
    this.resetLockTimer();

    const account = await ThruHDWallet.getAccount(this.seed, accountIndex);
    return account.address;
  }

  /**
   * Sign a message with a specific account's private key
   */
  async signMessage(accountIndex: number, message: Uint8Array): Promise<Uint8Array> {
    if (!this.seed) {
      throw new Error('Wallet is locked');
    }

    // Reset lock timer on activity
    this.resetLockTimer();

    // Derive keypair for signing
    const account = await ThruHDWallet.getAccount(this.seed, accountIndex);

    // Use domain-separated signing with transaction domain
    const publicKey = new Uint8Array(32); // Dummy, not used in simple approach
    return signWithDomain(message, account.privateKey, publicKey, SignatureDomain.TXN);
  }

  /**
   * Sign a serialized transaction payload (base64 string) using Thru wire format.
   * Expects the incoming payload to be the transaction bytes without the 64-byte signature prefix.
   * Returns the signed transaction serialized back to base64 (signature + payload).
   */
  async signSerializedTransaction(
    accountIndex: number,
    serializedTransaction: string
  ): Promise<string> {
    if (!this.seed) {
      throw new Error('Wallet is locked');
    }

    if (!serializedTransaction) {
      throw new Error('Missing serialized transaction payload');
    }

    // Reset lock timer on activity
    this.resetLockTimer();

    const account = await ThruHDWallet.getAccount(this.seed, accountIndex);
    const payloadBytes = decodeBase64String(serializedTransaction);
    
    // Use domain-separated signing with transaction domain
    // Public key parameter is not needed for the simple approach, but kept for API compatibility
    const publicKey = new Uint8Array(32); // Dummy, not used in simple approach
    const signature = await signWithDomain(
      payloadBytes,
      account.privateKey,
      publicKey,
      SignatureDomain.TXN,
    );

    const result = new Uint8Array(signature.length + payloadBytes.length);
    result.set(signature, 0);
    result.set(payloadBytes, signature.length);

    return encodeBase64Bytes(result);
  }

  /**
   * Reset the auto-lock timer
   */
  private resetLockTimer(): void {
    // Clear existing timer
    if (this.lockTimer !== null) {
      clearTimeout(this.lockTimer);
    }

    // Set new timer
    this.lockTimer = self.setTimeout(() => {
      console.log('[KeyManager] Auto-locking wallet after inactivity');
      this.lock();
      if (this.onAutoLock) {
        try {
          this.onAutoLock();
        } catch (error) {
          console.error('[KeyManager] Failed to notify auto-lock:', error);
        }
      }
    }, this.LOCK_TIMEOUT_MS) as unknown as number;
  }
}
