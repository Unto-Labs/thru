import { getPublicKeyAsync } from '@noble/ed25519';
import { derivePath } from 'ed25519-hd-key';
import { encodeAddress } from '@thru/helpers';

/**
 * HD Wallet helpers for Thru (BIP44 coin type 9999).
 * Returns raw key material along with encoded addresses.
 */
export class ThruHDWallet {
  static readonly THRU_COIN_TYPE = 9999;
  static readonly THRU_DERIVATION_PATH = `m/44'/${ThruHDWallet.THRU_COIN_TYPE}'`;

  private static ensureSeed(seed: Uint8Array): void {
    if (seed.length !== 64) {
      throw new Error('Seed must be 64 bytes');
    }
  }

  private static async deriveKeyPair(seed: Uint8Array, path: string) {
    ThruHDWallet.ensureSeed(seed);
    const derived = derivePath(path, Buffer.from(seed).toString('hex'));
    const privateKey = new Uint8Array(derived.key);
    const publicKey = new Uint8Array(await getPublicKeyAsync(privateKey));
    const secretKey = new Uint8Array(privateKey.length + publicKey.length);
    secretKey.set(privateKey, 0);
    secretKey.set(publicKey, privateKey.length);

    return {
      publicKey,
      privateKey,
      secretKey,
    };
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
    if (accountIndex < 0) {
      throw new Error('Account index must be non-negative');
    }

    const path = `${ThruHDWallet.THRU_DERIVATION_PATH}/${accountIndex}'/${change}'`;
    const { publicKey, privateKey, secretKey } = await ThruHDWallet.deriveKeyPair(seed, path);

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
