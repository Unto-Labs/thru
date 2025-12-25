import { describe, it, expect } from 'vitest';
import { mnemonicToSeed } from 'bip39';
import { ThruHDWallet } from './hdwallet';

/**
 * Test vectors for ThruHDWallet using SLIP-0010 Ed25519 derivation.
 *
 * These vectors use the standard BIP39 test mnemonic and ensure that
 * key derivation remains consistent across library changes.
 *
 * IMPORTANT: If these tests fail after a library update, existing wallets
 * will derive different addresses and users will lose access to funds.
 */

// Standard BIP39 test mnemonic (12 words)
const TEST_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

// Pre-computed test vectors using micro-key-producer v0.8.2
// Path format: m/44'/9999'/accountIndex'/0'
const TEST_VECTORS = [
  {
    accountIndex: 0,
    path: "m/44'/9999'/0'/0'",
    privateKey: 'f320787900b2be9214778b4219212b681d2d77f45e7045575680be4a6fe076e6',
    publicKey: 'a20a6cddb7cf52fbe4403024e1ce8463ac0d70870bac6f492f5d16ba405fde12',
  },
  {
    accountIndex: 1,
    path: "m/44'/9999'/1'/0'",
    privateKey: '092413cbbdffd063d2f5eca4d8aa881b6d25a7703af1d47dd14be87180675db1',
    publicKey: '8b8f363e252268cbd1255f10c02a39c62594849f19fe72ed52e966ee0f3fdf5c',
  },
  {
    accountIndex: 2,
    path: "m/44'/9999'/2'/0'",
    privateKey: 'dfffc0d7734b32429b30530972410a743f636ca6831b02d25ef794c3ee0eb09e',
    publicKey: '7cc170536e078b25dd4d621d2cd347c9cdd225edfaf2eab51fe3883b843db144',
  },
];

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

describe('ThruHDWallet', () => {
  describe('SLIP-0010 Ed25519 derivation', () => {
    let seed: Uint8Array;

    beforeAll(async () => {
      seed = await mnemonicToSeed(TEST_MNEMONIC);
    });

    it('should use correct coin type for Thru', () => {
      expect(ThruHDWallet.THRU_COIN_TYPE).toBe(9999);
    });

    it('should use correct derivation path prefix', () => {
      expect(ThruHDWallet.THRU_DERIVATION_PATH).toBe("m/44'/9999'");
    });

    it('should reject seeds that are not 64 bytes', async () => {
      const shortSeed = new Uint8Array(32);
      await expect(ThruHDWallet.getAccount(shortSeed, 0)).rejects.toThrow(
        'Seed must be 64 bytes'
      );
    });

    it('should reject negative account indices', async () => {
      await expect(ThruHDWallet.getAccount(seed, -1)).rejects.toThrow(
        'Account index must be non-negative'
      );
    });

    TEST_VECTORS.forEach(({ accountIndex, path, privateKey, publicKey }) => {
      describe(`Account ${accountIndex}`, () => {
        it(`should derive correct path: ${path}`, async () => {
          const account = await ThruHDWallet.getAccount(seed, accountIndex);
          expect(account.path).toBe(path);
        });

        it('should derive correct private key (32 bytes)', async () => {
          const account = await ThruHDWallet.getAccount(seed, accountIndex);
          expect(account.privateKey.length).toBe(32);
          expect(bytesToHex(account.privateKey)).toBe(privateKey);
        });

        it('should derive correct public key (32 bytes)', async () => {
          const account = await ThruHDWallet.getAccount(seed, accountIndex);
          expect(account.publicKey.length).toBe(32);
          expect(bytesToHex(account.publicKey)).toBe(publicKey);
        });

        it('should produce 64-byte secret key (private + public)', async () => {
          const account = await ThruHDWallet.getAccount(seed, accountIndex);
          expect(account.secretKey.length).toBe(64);
          // First 32 bytes should be private key
          expect(bytesToHex(account.secretKey.slice(0, 32))).toBe(privateKey);
          // Last 32 bytes should be public key
          expect(bytesToHex(account.secretKey.slice(32))).toBe(publicKey);
        });

        it('should return a valid Thru address', async () => {
          const account = await ThruHDWallet.getAccount(seed, accountIndex);
          expect(account.address).toBeTruthy();
          expect(typeof account.address).toBe('string');
        });
      });
    });
  });

  describe('deriveAccounts', () => {
    let seed: Uint8Array;

    beforeAll(async () => {
      seed = await mnemonicToSeed(TEST_MNEMONIC);
    });

    it('should derive multiple accounts', async () => {
      const accounts = await ThruHDWallet.deriveAccounts(seed, 3);
      expect(accounts.length).toBe(3);

      accounts.forEach((account, i) => {
        expect(account.index).toBe(i);
        expect(account.path).toBe(`m/44'/9999'/${i}'/0'`);
        expect(account.publicKey.length).toBe(32);
        expect(account.address).toBeTruthy();
      });
    });

    it('should derive accounts with matching test vectors', async () => {
      const accounts = await ThruHDWallet.deriveAccounts(seed, 3);

      TEST_VECTORS.forEach(({ accountIndex, publicKey }) => {
        expect(bytesToHex(accounts[accountIndex].publicKey)).toBe(publicKey);
      });
    });
  });

  describe('isValidPath', () => {
    it('should validate correct paths', () => {
      expect(ThruHDWallet.isValidPath("m/44'/9999'/0'/0'")).toBe(true);
      expect(ThruHDWallet.isValidPath("m/44'/0'")).toBe(true);
      expect(ThruHDWallet.isValidPath("m/0'")).toBe(true);
    });

    it('should reject invalid paths', () => {
      expect(ThruHDWallet.isValidPath('m/44/9999/0/0')).toBe(false); // non-hardened
      expect(ThruHDWallet.isValidPath('44/9999/0/0')).toBe(false); // no m prefix
      expect(ThruHDWallet.isValidPath('')).toBe(false);
      expect(ThruHDWallet.isValidPath('invalid')).toBe(false);
    });
  });
});
