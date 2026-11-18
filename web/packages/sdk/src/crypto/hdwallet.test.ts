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
    it('uses the Thru coin type and derivation prefix', () => {
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

    it('is syntax-only: it accepts paths a Ledger device rejects', () => {
      for (const path of ["m/0'", "m/44'/60'/0'/0'", "m/44'/8478'/0'/1'", "m/44'/8478'/4294967295'/0'"]) {
        expect(ThruHDWallet.isValidPath(path)).toBe(true);
        expect(ThruHDWallet.isLedgerCompatiblePath(path)).toBe(false);
      }
    });
  });

  describe('account index and change bounds', () => {
    it('accepts nonzero change for ordinary SDK derivation', async () => {
      const account = await ThruHDWallet.getAccount(seed, 0, 1);
      expect(account.path).toBe("m/44'/8478'/0'/1'");
      expect(ThruHDWallet.isLedgerCompatiblePath(account.path)).toBe(false);
    });

    it('accepts the largest hardened account index, 2^31 - 1', async () => {
      expect(ThruHDWallet.MAX_ACCOUNT_INDEX).toBe(2 ** 31 - 1);
      const account = await ThruHDWallet.getAccount(seed, 2 ** 31 - 1);
      expect(account.path).toBe("m/44'/8478'/2147483647'/0'");
    });

    it.each([2 ** 31, 2 ** 32, Number.MAX_SAFE_INTEGER])('rejects account index %d with a clear error', async (index) => {
      await expect(ThruHDWallet.getAccount(seed, index)).rejects.toThrow('Account index must be below 2^31');
      expect(() => ThruHDWallet.getAccountPath(index)).toThrow('Account index must be below 2^31');
    });

    it.each([0.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects non-integer account index %d', async (index) => {
      await expect(ThruHDWallet.getAccount(seed, index)).rejects.toThrow(/Account index must be/);
    });

    it.each([-1, 2 ** 31])('rejects out-of-range change %d', async (change) => {
      await expect(ThruHDWallet.getAccount(seed, 0, change)).rejects.toThrow(/Change index must be/);
    });

    it('still accepts an explicit change of 0', async () => {
      const account = await ThruHDWallet.getAccount(seed, 1, 0);
      expect(bytesToHex(account.publicKey)).toBe(VECTORS.find((v) => v.account === 1 && v.change === 0)!.publicKey);
    });
  });

  describe('getAccountPath / getAccountAtPath', () => {
    it('builds depth-4 (default) and depth-3 paths', () => {
      expect(ThruHDWallet.getAccountPath(7)).toBe("m/44'/8478'/7'/0'");
      expect(ThruHDWallet.getAccountPath(7, 4)).toBe("m/44'/8478'/7'/0'");
      expect(ThruHDWallet.getAccountPath(7, 3)).toBe("m/44'/8478'/7'");
      expect(() => ThruHDWallet.getAccountPath(7, 5 as 4)).toThrow(/Depth must be 3 or 4/);
    });

    it('derives the same depth-4 account as getAccount', async () => {
      for (const { account: accountIndex, path, publicKey } of VECTORS.filter((v) => v.change === 0)) {
        const account = await ThruHDWallet.getAccountAtPath(seed, path);
        expect(account.path).toBe(path);
        expect(bytesToHex(account.publicKey)).toBe(publicKey);
        expect(account).toEqual(await ThruHDWallet.getAccount(seed, accountIndex));
      }
    });

    it('derives a depth-3 account distinct from the depth-4 one', async () => {
      const depth3 = await ThruHDWallet.getAccountAtPath(seed, ThruHDWallet.getAccountPath(0, 3));
      expect(depth3.path).toBe("m/44'/8478'/0'");
      expect(bytesToHex(depth3.publicKey)).not.toBe(VECTORS[0].publicKey);
    });

    it('rejects non-Ledger-compatible paths with the reason', async () => {
      await expect(ThruHDWallet.getAccountAtPath(seed, "m/44'/8478'/0'/1'")).rejects.toThrow(
        "Path m/44'/8478'/0'/1' is not Ledger-compatible: change must be 0'"
      );
      await expect(ThruHDWallet.getAccountAtPath(seed, "m/44'/8478'")).rejects.toThrow(/depth must be 3 or 4/);
    });
  });

  describe('isLedgerCompatiblePath', () => {
    it.each([
      "m/44'/8478'/0'/0'",
      "m/44'/8478'/2147483647'/0'",
      "m/44'/8478'/0'",
      "m/44'/8478'/2147483647'",
    ])('accepts %s', (path) => {
      expect(ThruHDWallet.isLedgerCompatiblePath(path)).toBe(true);
      expect(ThruHDWallet.ledgerPathError(path)).toBeNull();
      expect(() => ThruHDWallet.assertLedgerCompatiblePath(path)).not.toThrow();
    });

    it.each([
      ["m/44'/8478'/0'/1'", "change must be 0'"],
      ["m/44'/8478'/0'/2147483647'", "change must be 0'"],
      ["m/44'/8478'/2147483648'/0'", 'out of range'],
      ["m/44'/8478'/4294967295'", 'out of range'],
      ["m/44'/8478'/00'/0'", 'syntax'],
      ["m/44h/8478h/0h/0h", 'syntax'],
      ["m/44'/8478'/0'/0'/", 'syntax'],
      ["M/44'/8478'/0'/0'", 'syntax'],
      [" m/44'/8478'/0'/0'", 'syntax'],
      ["m/44'/9999'/0'/0'", "coin type must be 8478'"],
      ['', 'syntax'],
    ])('rejects %s (%s)', (path, reason) => {
      expect(ThruHDWallet.isLedgerCompatiblePath(path)).toBe(false);
      expect(ThruHDWallet.ledgerPathError(path)).toContain(reason);
    });

    it('checks raw u32 components as sent to the device', () => {
      const H = ThruHDWallet.HARDENED_OFFSET;
      expect(ThruHDWallet.isLedgerCompatiblePath([H + 44, H + 8478, 0xffff_ffff, H])).toBe(true);
      expect(ThruHDWallet.isLedgerCompatiblePath([H + 44, H + 8478, H, H + 1])).toBe(false);
      expect(ThruHDWallet.isLedgerCompatiblePath([H + 44, H + 8478, H, 2 ** 32])).toBe(false);
      expect(ThruHDWallet.isLedgerCompatiblePath([H + 44, H + 8478, -1])).toBe(false);
    });

    it('parsePath produces the raw components', () => {
      const H = ThruHDWallet.HARDENED_OFFSET;
      expect(ThruHDWallet.parsePath('m')).toEqual([]);
      expect(ThruHDWallet.parsePath("m/44'/8478'/2147483647'/0")).toEqual([H + 44, H + 8478, 0xffff_ffff, 0]);
    });
  });
});
