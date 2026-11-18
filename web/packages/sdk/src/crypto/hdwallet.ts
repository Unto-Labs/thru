import HDKey from 'micro-key-producer/slip10.js';
import { encodeAddress } from '@thru/sdk/helpers';

/** Thru coin type; SLIP-44 registration is pending (satoshilabs/slips#2077). */
const THRU_COIN_TYPE = 8478;
const HARDENED_OFFSET = 0x80000000;
const MAX_INDEX = 0x7fffffff;

/** Key material and address for one derived Thru account. */
export interface ThruHDAccount {
  address: string;
  publicKey: Uint8Array;
  privateKey: Uint8Array;
  secretKey: Uint8Array;
  path: string;
}

/** Depths of the Thru derivation paths a Ledger device accepts. */
export type ThruPathDepth = 3 | 4;

/**
 * HD wallet helpers for Thru. Seeds come from BIP-39 and keys are derived
 * with SLIP-0010 Ed25519 along `m/44'/8478'/{account}'/{change}'`.
 * Every level is hardened. Explicit Ledger paths additionally require change
 * to be zero at depth 4.
 *
 * Shared vectors live in `web/packages/sdk/test/vectors/thru-hd-derivation.json`.
 */
export class ThruHDWallet {
  static readonly THRU_COIN_TYPE = THRU_COIN_TYPE;
  static readonly THRU_PURPOSE = 44;
  static readonly THRU_DERIVATION_PATH = `m/44'/${THRU_COIN_TYPE}'`;
  static readonly HARDENED_OFFSET = HARDENED_OFFSET;
  static readonly MAX_ACCOUNT_INDEX = MAX_INDEX;

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

  private static deriveAccount(seed: Uint8Array, path: string): ThruHDAccount {
    const { publicKey, privateKey, secretKey } = ThruHDWallet.deriveKeyPair(seed, path);
    return {
      address: encodeAddress(publicKey),
      publicKey,
      privateKey,
      secretKey,
      path,
    };
  }

  /**
   * Derive `m/44'/8478'/{accountIndex}'/{change}'`.
   * Ledger devices accept only change 0.
   */
  static async getAccount(
    seed: Uint8Array,
    accountIndex: number = 0,
    change: number = 0
  ): Promise<ThruHDAccount> {
    return ThruHDWallet.deriveAccount(seed, ThruHDWallet.getDerivationPath(accountIndex, change));
  }

  /**
   * Derive the account at an explicit path. The path must satisfy
   * {@link isLedgerCompatiblePath}: depth 3 (`m/44'/8478'/{a}'`) or depth 4
   * (`m/44'/8478'/{a}'/0'`), all components hardened.
   *
   * @throws if the seed is not 64 bytes or the path is not Ledger-compatible.
   */
  static async getAccountAtPath(seed: Uint8Array, path: string): Promise<ThruHDAccount> {
    ThruHDWallet.assertLedgerCompatiblePath(path);
    return ThruHDWallet.deriveAccount(seed, path);
  }

  /**
   * The Ledger-compatible path string for `accountIndex`:
   * `m/44'/8478'/{a}'/0'` for depth 4 (default) or `m/44'/8478'/{a}'` for depth 3.
   *
   * @throws if `accountIndex` is not an integer in `[0, 2^31 - 1]` or `depth`
   *   is not 3 or 4.
   */
  static getAccountPath(accountIndex: number, depth: ThruPathDepth = 4): string {
    ThruHDWallet.ensureIndex('Account index', accountIndex);
    if (depth === 4) {
      return `${ThruHDWallet.THRU_DERIVATION_PATH}/${accountIndex}'/0'`;
    }
    if (depth === 3) {
      return `${ThruHDWallet.THRU_DERIVATION_PATH}/${accountIndex}'`;
    }
    throw new Error(`Depth must be 3 or 4; got ${String(depth)}`);
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

  /**
   * Syntax-only check: `m` followed by one or more hardened decimal components.
   * It does not check depth, purpose, coin type, change or index range, so a
   * path that passes may still be rejected by a Ledger device. Use
   * {@link isLedgerCompatiblePath} to check the device policy.
   */
  static isValidPath(path: string): boolean {
    const pathRegex = /^m(\/\d+')+$/;
    return pathRegex.test(path);
  }

  /**
   * Parse a path string such as `m/44'/8478'/0'/0'` into raw u32 components
   * (hardened components have {@link HARDENED_OFFSET} set). The grammar is
   * strict: `m`, then `/`-separated decimal indices without leading zeros, each
   * below 2^31 and optionally followed by `'`.
   *
   * @throws on any syntax error or out-of-range index.
   */
  static parsePath(path: string): number[] {
    if (typeof path !== 'string' || !/^m(\/(0|[1-9]\d*)'?)*$/.test(path)) {
      throw new Error(`Invalid derivation path syntax: ${JSON.stringify(path)}`);
    }
    if (path === 'm') return [];
    return path
      .slice(2)
      .split('/')
      .map((part) => {
        const hardened = part.endsWith("'");
        const digits = hardened ? part.slice(0, -1) : part;
        if (digits.length > 10 || Number(digits) > MAX_INDEX) {
          throw new Error(`Derivation path index out of range (max ${MAX_INDEX}): ${part}`);
        }
        const index = Number(digits);
        return hardened ? (index + HARDENED_OFFSET) >>> 0 : index;
      });
  }

  /**
   * Why `path` violates the Ledger path policy, or `null` if it complies.
   * Accepts a path string or raw u32 components (as sent to the device).
   */
  static ledgerPathError(path: string | readonly number[]): string | null {
    let components: readonly number[];
    if (typeof path === 'string') {
      try {
        components = ThruHDWallet.parsePath(path);
      } catch (err) {
        return (err as Error).message;
      }
    } else {
      components = path;
      if (!components.every((c) => Number.isInteger(c) && c >= 0 && c <= 0xffff_ffff)) {
        return 'every component must be a u32';
      }
    }

    if (components.length !== 3 && components.length !== 4) {
      return 'depth must be 3 or 4';
    }
    if (!components.every((c) => c >= HARDENED_OFFSET)) {
      return 'every component must be hardened';
    }
    if (components[0] !== (ThruHDWallet.THRU_PURPOSE + HARDENED_OFFSET) >>> 0) {
      return `purpose must be ${ThruHDWallet.THRU_PURPOSE}'`;
    }
    if (components[1] !== (ThruHDWallet.THRU_COIN_TYPE + HARDENED_OFFSET) >>> 0) {
      return `coin type must be ${ThruHDWallet.THRU_COIN_TYPE}'`;
    }
    if (components.length === 4 && components[3] !== HARDENED_OFFSET) {
      return "change must be 0'";
    }
    return null;
  }

  /**
   * Strict check against the Ledger device path policy
   * (`specs/ledger/app-thru-apdu.md` §4.2):
   *
   * 1. depth is 3 or 4;
   * 2. purpose is `44'`;
   * 3. coin type is `8478'` ({@link THRU_COIN_TYPE});
   * 4. every component is hardened (account index `0..2^31 - 1`);
   * 5. at depth 4, change is exactly `0'`.
   *
   * Accepts a path string (strict syntax, see {@link parsePath}) or raw u32
   * components. Unlike {@link isValidPath} this is a semantic check.
   */
  static isLedgerCompatiblePath(path: string | readonly number[]): boolean {
    return ThruHDWallet.ledgerPathError(path) === null;
  }

  /** Throws with the reason if `path` is not {@link isLedgerCompatiblePath}. */
  static assertLedgerCompatiblePath(path: string | readonly number[]): void {
    const error = ThruHDWallet.ledgerPathError(path);
    if (error !== null) {
      const shown = typeof path === 'string' ? path : `[${path.join(', ')}]`;
      throw new Error(`Path ${shown} is not Ledger-compatible: ${error}`);
    }
  }
}
