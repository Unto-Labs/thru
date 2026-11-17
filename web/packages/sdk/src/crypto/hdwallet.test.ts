import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { mnemonicToSeed } from '@scure/bip39';
import { ThruHDWallet } from './hdwallet';

/**
 * Test vectors for ThruHDWallet using SLIP-0010 Ed25519 derivation.
 *
 * The vectors live in test/vectors/thru-hd-derivation.json so the CLI and
 * hardware-wallet integrations can check against the same file. They were
 * computed with an independent SLIP-0010 implementation, not with the
 * library under test.
 *
 * IMPORTANT: If these tests fail after a library update, existing wallets
 * will derive different addresses and users will lose access to funds.
 */

interface Vector {
  account: number;
  change: number;
  path: string;
  privateKey: string;
  publicKey: string;
  address: string;
}

const VECTOR_FILE = JSON.parse(
  readFileSync(new URL('../../test/vectors/thru-hd-derivation.json', import.meta.url), 'utf8')
) as { mnemonic: string; passphrase: string; seed: string; vectors: Vector[] };

const VECTORS = VECTOR_FILE.vectors;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

describe('ThruHDWallet', () => {
  let seed: Uint8Array;

  beforeAll(async () => {
    seed = await mnemonicToSeed(VECTOR_FILE.mnemonic, VECTOR_FILE.passphrase);
  });

  it('derives the BIP-39 seed recorded in the vector file', () => {
    expect(bytesToHex(seed)).toBe(VECTOR_FILE.seed);
  });

  describe('constants', () => {
    it('uses the SLIP-44 coin type registered for Thru', () => {
      expect(ThruHDWallet.THRU_COIN_TYPE).toBe(8478);
      expect(ThruHDWallet.THRU_DERIVATION_PATH).toBe("m/44'/8478'");
    });

    it('has vectors', () => {
      expect(VECTORS.length).toBeGreaterThan(0);
    });
  });

  describe('SLIP-0010 Ed25519 derivation', () => {
    it('should reject seeds that are not 64 bytes', async () => {
      const shortSeed = new Uint8Array(32);
      await expect(ThruHDWallet.getAccount(shortSeed, 0)).rejects.toThrow(
        'Seed must be 64 bytes'
      );
    });

    it('defaults to coin type 8478', async () => {
      const account = await ThruHDWallet.getAccount(seed);
      expect(account.path).toBe("m/44'/8478'/0'/0'");
      expect(account.address).toBe(VECTORS[0].address);
    });

    VECTORS.forEach(({ account: accountIndex, change, path, privateKey, publicKey, address }) => {
      describe(path, () => {
        it('builds the expected path', () => {
          expect(ThruHDWallet.getDerivationPath(accountIndex, change)).toBe(path);
        });

        it('derives the expected keys and address', async () => {
          const account = await ThruHDWallet.getAccount(seed, accountIndex, change);
          expect(account.path).toBe(path);
          expect(bytesToHex(account.privateKey)).toBe(privateKey);
          expect(bytesToHex(account.publicKey)).toBe(publicKey);
          expect(account.address).toBe(address);
        });

        it('should produce 64-byte secret key (private + public)', async () => {
          const account = await ThruHDWallet.getAccount(seed, accountIndex, change);
          expect(account.secretKey.length).toBe(64);
          expect(bytesToHex(account.secretKey.slice(0, 32))).toBe(privateKey);
          expect(bytesToHex(account.secretKey.slice(32))).toBe(publicKey);
        });
      });
    });
  });

  describe('input validation', () => {
    it('rejects negative or fractional indices', async () => {
      await expect(ThruHDWallet.getAccount(seed, -1)).rejects.toThrow(
        'Account index must be non-negative'
      );
      await expect(ThruHDWallet.getAccount(seed, 1.5)).rejects.toThrow(
        'Account index must be non-negative'
      );
      await expect(ThruHDWallet.getAccount(seed, 0, -1)).rejects.toThrow(
        'Change index must be non-negative'
      );
    });

    it('rejects indices that would collide with the hardened bit', async () => {
      await expect(ThruHDWallet.getAccount(seed, 2 ** 31)).rejects.toThrow(
        'Account index must be below 2^31'
      );
      expect(ThruHDWallet.getDerivationPath(2 ** 31 - 1)).toBe(
        `m/44'/8478'/${2 ** 31 - 1}'/0'`
      );
    });
  });

  describe('deriveAccounts', () => {
    it('derives consecutive accounts under coin type 8478', async () => {
      const accounts = await ThruHDWallet.deriveAccounts(seed, 3);
      expect(accounts.length).toBe(3);

      accounts.forEach((account, i) => {
        expect(account.index).toBe(i);
        expect(account.path).toBe(`m/44'/8478'/${i}'/0'`);
        expect(account.publicKey.length).toBe(32);
      });

      VECTORS.filter((v) => v.change === 0).forEach(({ account, publicKey, address }) => {
        expect(bytesToHex(accounts[account].publicKey)).toBe(publicKey);
        expect(accounts[account].address).toBe(address);
      });
    });
  });

  describe('isValidPath', () => {
    it('should validate correct paths', () => {
      expect(ThruHDWallet.isValidPath("m/44'/8478'/0'/0'")).toBe(true);
      expect(ThruHDWallet.isValidPath("m/44'/0'")).toBe(true);
      expect(ThruHDWallet.isValidPath("m/0'")).toBe(true);
    });

    it('should reject invalid paths', () => {
      expect(ThruHDWallet.isValidPath('m/44/8478/0/0')).toBe(false); // non-hardened
      expect(ThruHDWallet.isValidPath('44/8478/0/0')).toBe(false); // no m prefix
      expect(ThruHDWallet.isValidPath('')).toBe(false);
      expect(ThruHDWallet.isValidPath('invalid')).toBe(false);
    });
  });
});
