import scrypt from 'scrypt-js';
import { getWebCrypto } from '@thru/helpers';

export interface EncryptedData {
  ciphertext: Uint8Array;
  salt: Uint8Array;
  iv: Uint8Array;
  kdfParams: {
    N: number; // CPU/memory cost parameter
    r: number; // Block size
    p: number; // Parallelization parameter
  };
}

/**
 * Encryption service using scrypt KDF and AES-GCM
 */
export class EncryptionService {
  // Default scrypt parameters (can be adjusted for performance/security trade-off)
  private static readonly DEFAULT_N = 8192; // 2^15
  private static readonly DEFAULT_R = 8;
  private static readonly DEFAULT_P = 1;
  private static readonly KEY_LENGTH = 32; // 256 bits for AES-256
  private static readonly SALT_LENGTH = 32;
  private static readonly IV_LENGTH = 12; // Recommended for AES-GCM

  /**
   * Encrypt data using password-based encryption
   * @param data - Data to encrypt
   * @param password - User password
   * @returns Encrypted data with parameters
   */
  static async encrypt(data: Uint8Array, password: string): Promise<EncryptedData> {
    // Generate random salt and IV
    const crypto = getWebCrypto();
    const salt = crypto.getRandomValues(new Uint8Array(this.SALT_LENGTH));
    const iv = crypto.getRandomValues(new Uint8Array(this.IV_LENGTH));

    // Derive key from password using scrypt
    const passwordBytes = new TextEncoder().encode(password);
    const derivedKey = await scrypt.scrypt(
      passwordBytes,
      salt,
      this.DEFAULT_N,
      this.DEFAULT_R,
      this.DEFAULT_P,
      this.KEY_LENGTH
    );

    // Import key for WebCrypto API
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      new Uint8Array(derivedKey),
      { name: 'AES-GCM' },
      false,
      ['encrypt']
    );

    // Encrypt data using AES-GCM
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      cryptoKey,
      data as unknown as ArrayBuffer
    );

    // Zero out sensitive data
    derivedKey.fill(0);
    passwordBytes.fill(0);

    return {
      ciphertext: new Uint8Array(ciphertext),
      salt,
      iv,
      kdfParams: {
        N: this.DEFAULT_N,
        r: this.DEFAULT_R,
        p: this.DEFAULT_P,
      },
    };
  }

  /**
   * Decrypt encrypted data using password
   * @param encrypted - Encrypted data with parameters
   * @param password - User password
   * @returns Decrypted data
   */
  static async decrypt(encrypted: EncryptedData, password: string): Promise<Uint8Array> {
    // Derive key from password using stored parameters
    const passwordBytes = new TextEncoder().encode(password);
    const derivedKey = await scrypt.scrypt(
      passwordBytes,
      encrypted.salt,
      encrypted.kdfParams.N,
      encrypted.kdfParams.r,
      encrypted.kdfParams.p,
      this.KEY_LENGTH
    );

    // Import key for WebCrypto API
    const crypto = getWebCrypto();
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      new Uint8Array(derivedKey),
      { name: 'AES-GCM' },
      false,
      ['decrypt']
    );

    try {
      // Decrypt data using AES-GCM
      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: encrypted.iv as unknown as ArrayBuffer },
        cryptoKey,
        encrypted.ciphertext as unknown as ArrayBuffer
      );

      // Zero out sensitive data
      derivedKey.fill(0);
      passwordBytes.fill(0);

      return new Uint8Array(decrypted);
    } catch (error) {
      // Zero out sensitive data even on error
      derivedKey.fill(0);
      passwordBytes.fill(0);
      throw new Error('Decryption failed - incorrect password or corrupted data');
    }
  }

  /**
   * Serialize encrypted data to a storable format
   * @param encrypted - Encrypted data
   * @returns Base64-encoded JSON string
   */
  static serialize(encrypted: EncryptedData): string {
    return JSON.stringify({
      ciphertext: Buffer.from(encrypted.ciphertext).toString('base64'),
      salt: Buffer.from(encrypted.salt).toString('base64'),
      iv: Buffer.from(encrypted.iv).toString('base64'),
      kdfParams: encrypted.kdfParams,
    });
  }

  /**
   * Deserialize encrypted data from storage
   * @param serialized - Serialized encrypted data
   * @returns Encrypted data object
   */
  static deserialize(serialized: string): EncryptedData {
    const parsed = JSON.parse(serialized);
    return {
      ciphertext: new Uint8Array(Buffer.from(parsed.ciphertext, 'base64')),
      salt: new Uint8Array(Buffer.from(parsed.salt, 'base64')),
      iv: new Uint8Array(Buffer.from(parsed.iv, 'base64')),
      kdfParams: parsed.kdfParams,
    };
  }
}

/**
 * Utility functions for secure memory management
 */
export class SecureMemory {
  /**
   * Zero out a Uint8Array to remove sensitive data from memory
   * @param array - Array to zero out
   */
  static zeroize(array: Uint8Array): void {
    array.fill(0);
  }

  /**
   * Compare two Uint8Arrays in constant time to prevent timing attacks
   * @param a - First array
   * @param b - Second array
   * @returns true if arrays are equal
   */
  static constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) {
      return false;
    }

    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a[i] ^ b[i];
    }

    return result === 0;
  }
}
