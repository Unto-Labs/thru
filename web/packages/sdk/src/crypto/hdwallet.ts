import HDKey from 'micro-key-producer/slip10.js';
import { encodeAddress } from '@thru/sdk/helpers';

/** SLIP-44 coin type registered for Thru (satoshilabs/slips#2077). */
const THRU_COIN_TYPE = 8478;

/** First index that needs the hardened bit, so the largest valid index is 2^31 - 1. */
const HARDENED_OFFSET = 0x80000000;

/**
 * HD wallet helpers for Thru.
 *
 * Seeds come from BIP-39. Keys are derived with SLIP-0010 for Ed25519
 * (via micro-key-producer) along `m/44'/8478'/{account}'/{change}'`.
 * Every level is hardened because SLIP-0010 Ed25519 has no public
 * derivation. Returns raw key material along with encoded addresses.
 *
 * Shared vectors that every implementation must match live in
 * `web/packages/sdk/test/vectors/thru-hd-derivation.json`.
 */
export class ThruHDWallet {
  static readonly THRU_COIN_TYPE = THRU_COIN_TYPE;
  static readonly THRU_DERIVATION_PATH = `m/44'/${THRU_COIN_TYPE}'`;

  private static ensureSeed(seed: Uint8Array): void {
    if (seed.length !== 64) {
      throw new Error('Seed must be 64 bytes');
    }
  }

  private static ensureIndex(name: string, value: number): void {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`${name} must be non-negative`);
    }
    if (value >= HARDENED_OFFSET) {
      throw new Error(`${name} must be below 2^31`);
    }
  }

  private static deriveKeyPair(seed: Uint8Array, path: string) {
    ThruHDWallet.ensureSeed(seed);
    const hdkey = HDKey.fromMasterSeed(seed);
    const derived = hdkey.derive(path);

    if (!derived.privateKey || !derived.publicKey) {
      throw new Error('Failed to derive key pair');
    }

    const privateKey = derived.privateKey;
    const publicKey = derived.publicKeyRaw;
    const secretKey = new Uint8Array(privateKey.length + publicKey.length);
    secretKey.set(privateKey, 0);
    secretKey.set(publicKey, privateKey.length);

    return {
      publicKey,
      privateKey,
      secretKey,
    };
  }

  /**
   * Returns the full path `m/44'/8478'/{accountIndex}'/{change}'`.
   * Throws on an index outside [0, 2^31).
   */
  static getDerivationPath(accountIndex: number = 0, change: number = 0): string {
    ThruHDWallet.ensureIndex('Account index', accountIndex);
    ThruHDWallet.ensureIndex('Change index', change);
    return `${ThruHDWallet.THRU_DERIVATION_PATH}/${accountIndex}'/${change}'`;
  }

  static async getAccount(
    seed: Uint8Array,
    accountIndex: number = 0,
    change: number = 0
  ): Promise<{
    address: string;
    publicKey: Uint8Array;
    privateKey: Uint8Array;
    secretKey: Uint8Array;
    path: string;
  }> {
    const path = ThruHDWallet.getDerivationPath(accountIndex, change);
    const { publicKey, privateKey, secretKey } = ThruHDWallet.deriveKeyPair(seed, path);

    return {
      address: encodeAddress(publicKey),
      publicKey,
      privateKey,
      secretKey,
      path,
    };
  }

  static async deriveAccounts(
    seed: Uint8Array,
    count: number
  ): Promise<Array<{
    index: number;
    address: string;
    path: string;
    publicKey: Uint8Array;
  }>> {
    const accounts = [];
    for (let i = 0; i < count; i++) {
      const account = await ThruHDWallet.getAccount(seed, i);
      accounts.push({
        index: i,
        address: account.address,
        path: account.path,
        publicKey: account.publicKey,
      });
    }
    return accounts;
  }

  static isValidPath(path: string): boolean {
    const pathRegex = /^m(\/\d+')+$/;
    return pathRegex.test(path);
  }
}
