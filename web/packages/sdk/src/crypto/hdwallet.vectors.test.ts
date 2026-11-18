import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { hmac } from '@noble/hashes/hmac.js';
import { pbkdf2 } from '@noble/hashes/pbkdf2.js';
import { sha512 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import * as ed from '@noble/ed25519';
import HDKey from 'micro-key-producer/slip10.js';
import { ThruHDWallet } from './hdwallet';
import { MnemonicGenerator } from './mnemonic';
import { encodeAddress } from '../helpers/address';
import {
  HD_VECTORS_PATH,
  buildHdVectors,
  serializeHdVectors,
  type HdVectorsFile,
} from '../../scripts/gen-hd-vectors';

/**
 * Conformance tests for contrib/test/vectors/signing/hd_vectors.json.
 *
 * 1. An independent reference implementation (BIP39 via raw PBKDF2, SLIP-0010
 *    via raw HMAC-SHA512, @noble/ed25519 for the pubkey, Buffer base64url for
 *    the address) is checked against the published SLIP-0010 and BIP39 vectors
 *    and then against every entry in the corpus. This guards against the
 *    corpus being merely self-consistent with the SDK.
 * 2. The SDK (MnemonicGenerator, ThruHDWallet, encodeAddress) must reproduce
 *    every entry, so SDK drift fails CI.
 * 3. Regenerating the corpus must produce byte-identical JSON.
 */

const fileText = readFileSync(HD_VECTORS_PATH, 'utf8');
const vectors = JSON.parse(fileText) as HdVectorsFile;

const HARDENED = 0x8000_0000;

/* ---------------- independent reference implementation ---------------- */

function refBip39Seed(mnemonic: string, passphrase: string): Uint8Array {
  return pbkdf2(sha512, utf8ToBytes(mnemonic.normalize('NFKD')), utf8ToBytes(`mnemonic${passphrase}`.normalize('NFKD')), {
    c: 2048,
    dkLen: 64,
  });
}

function refSlip10Ed25519(seed: Uint8Array, components: readonly number[]) {
  let I = hmac(sha512, utf8ToBytes('ed25519 seed'), seed);
  let key = I.slice(0, 32);
  let chainCode = I.slice(32);
  for (const index of components) {
    if (index < HARDENED || index > 0xffff_ffff) {
      throw new Error('SLIP-0010 Ed25519 supports hardened derivation only');
    }
    const data = new Uint8Array(1 + 32 + 4);
    data[0] = 0x00;
    data.set(key, 1);
    new DataView(data.buffer).setUint32(33, index, false);
    I = hmac(sha512, chainCode, data);
    key = I.slice(0, 32);
    chainCode = I.slice(32);
  }
  return { key, chainCode };
}

function refParsePath(path: string): number[] {
  if (path === 'm') return [];
  return path
    .replace(/^m\//, '')
    .split('/')
    .map((p) => (p.endsWith("'") ? (Number(p.slice(0, -1)) + HARDENED) >>> 0 : Number(p)));
}

function refAddress(pubkey: Uint8Array): string {
  const buf = new Uint8Array(33);
  buf.set(pubkey);
  buf[32] = pubkey.reduce((acc, b) => (acc + b) & 0xff, 0);
  return 'ta' + Buffer.from(buf).toString('base64url');
}

function refPathApdu(components: readonly number[]): string {
  const out = Buffer.alloc(1 + 4 * components.length);
  out[0] = components.length;
  components.forEach((c, i) => out.writeUInt32BE(c >>> 0, 1 + 4 * i));
  return out.toString('hex');
}

/**
 * Reference device path policy (ledger-integration-plan §3.2): depth 3 or 4,
 * every component hardened, prefix 44'/{coin_type}'.
 */
function refDeviceAcceptsPath(components: readonly number[], coinType: number): boolean {
  if (components.length !== 3 && components.length !== 4) return false;
  if (!components.every((c) => c >= HARDENED && c <= 0xffff_ffff)) return false;
  if (components[0] !== (44 + HARDENED) >>> 0) return false;
  if (components[1] !== (coinType + HARDENED) >>> 0) return false;
  // app-thru-apdu.md §4.2 rule 5: at depth 4 the change component is exactly 0'.
  if (components.length === 4 && components[3] !== HARDENED) return false;
  return true;
}

const seedCache = new Map<string, Uint8Array>();
function refSeedCached(mnemonic: string, passphrase: string): Uint8Array {
  const k = `${mnemonic}\u0000${passphrase}`;
  let s = seedCache.get(k);
  if (!s) {
    s = refBip39Seed(mnemonic, passphrase);
    seedCache.set(k, s);
  }
  return s;
}

/* ---------------- tests ---------------- */

describe('HD vectors: independent reference implementation', () => {
  // SLIP-0010 "Test vector 1 for ed25519" (satoshilabs/slips slip-0010.md).
  const SLIP10_SEED = '000102030405060708090a0b0c0d0e0f';
  const SLIP10_CHAINS: Array<[string, string, string, string]> = [
    ['m', '90046a93de5380a72b5e45010748567d5ea02bbf6522f979e05c0d8d8ca9fffb', '2b4be7f19ee27bbf30c667b642d5f4aa69fd169872f8fc3059c08ebae2eb19e7', 'a4b2856bfec510abab89753fac1ac0e1112364e7d250545963f135f2a33188ed'],
    ["m/0'", '8b59aa11380b624e81507a27fedda59fea6d0b779a778918a2fd3590e16e9c69', '68e0fe46dfb67e368c75379acec591dad19df3cde26e63b93a8e704f1dade7a3', '8c8a13df77a28f3445213a0f432fde644acaa215fc72dcdf300d5efaa85d350c'],
    ["m/0'/1'", 'a320425f77d1b5c2505a6b1b27382b37368ee640e3557c315416801243552f14', 'b1d0bad404bf35da785a64ca1ac54b2617211d2777696fbffaf208f746ae84f2', '1932a5270f335bed617d5b935c80aedb1a35bd9fc1e31acafd5372c30f5c1187'],
    ["m/0'/1'/2'", '2e69929e00b5ab250f49c3fb1c12f252de4fed2c1db88387094a0f8c4c9ccd6c', '92a5b23c0b8a99e37d07df3fb9966917f5d06e02ddbd909c7e184371463e9fc9', 'ae98736566d30ed0e9d2f4486a64bc95740d89c7db33f52121f8ea8f76ff0fc1'],
    ["m/0'/1'/2'/2'", '8f6d87f93d750e0efccda017d662a1b31a266e4a6f5993b15f5c1f07f74dd5cc', '30d1dc7e5fc04c31219ab25a27ae00b50f6fd66622f6e9c913253d6511d1e662', '8abae2d66361c879b900d204ad2cc4984fa2aa344dd7ddc46007329ac76c429c'],
    ["m/0'/1'/2'/2'/1000000000'", '68789923a0cac2cd5a29172a475fe9e0fb14cd6adb5ad98a3fa70333e7afa230', '8f94d394a8e8fd6b1bc2f3f49f5c47e385281d5c17e65324b0f62483e37e8793', '3c24da049451555d51a7014a37337aa4e12d41e485abccfa46b47dfb2af54b7a'],
  ];

  it.each(SLIP10_CHAINS)('matches SLIP-0010 ed25519 vector 1 at %s', async (path, chainCode, priv, pub) => {
    const { key, chainCode: cc } = refSlip10Ed25519(hexToBytes(SLIP10_SEED), refParsePath(path));
    expect(bytesToHex(cc)).toBe(chainCode);
    expect(bytesToHex(key)).toBe(priv);
    expect(bytesToHex(await ed.getPublicKeyAsync(key))).toBe(pub);
  });

  // Published BIP39 seeds with passphrase "TREZOR" (trezor/python-mnemonic vectors.json).
  const BIP39_TREZOR: Record<string, string> = {
    'bip39-abandon-about':
      'c55257c360c07c72029aebc1b53c05ed0362ada38ead3e3e9efa3708e53495531f09a6987599d18264c1e1c92f2cf141630c7a3c4ab7c81b2f001698e7463b04',
    'bip39-abandon-art':
      'bda85446c68413707090a52022edd26a1c9462295029f2e60cd7c4f2bbd3097170af7a4d73245cafa9c3cca8d561a7c3de6f5d4a10be8ed2a5e608d68f92fcc8',
    'bip39-letter-bless':
      'c0c519bd0e91a2ed54357d9d1ebef6f5af218a153624cf4f2da911a0ed8f7a09e2ef61af0aca007096df430022f7a2b6fb91661a9589097069720d015e4e982f',
  };

  it.each(Object.entries(BIP39_TREZOR))('matches the published BIP39 seed for %s', (name, seedHex) => {
    const m = vectors.mnemonics.find((x) => x.name === name);
    expect(m).toBeDefined();
    expect(bytesToHex(refBip39Seed(m!.mnemonic, 'TREZOR'))).toBe(seedHex);
  });

  it('pins the SDK vector (abandon...about, m/44\'/8478\'/0\'/0\')', () => {
    const v = vectors.derivations.find((d) => d.path === "m/44'/8478'/0'/0'" && d.passphrase === '' && d.mnemonic.endsWith(' about'));
    expect(v?.pubkey_hex).toBe('1d65dd4d10f4f8a392d9e17c4d8cdea7c68e2a3eadc35997bbb6738e39cc0e6e');
  });
});

describe('HD vectors: corpus shape', () => {
  it('covers every mnemonic x passphrase x depth x account combination', () => {
    expect(vectors.schema).toBe('thru.hd_vectors.v1');
    expect(vectors.mnemonics.length).toBeGreaterThanOrEqual(3);
    expect(vectors.mnemonics.some((m) => m.name === 'speculos-default')).toBe(true);
    expect(vectors.mnemonics.some((m) => m.mnemonic.split(' ').length === 24)).toBe(true);
    for (const m of vectors.mnemonics) {
      for (const passphrase of ['', 'TREZOR']) {
        for (const depth of [3, 4]) {
          for (const account of [0, 1, 2, 2 ** 31 - 1]) {
            const hits = vectors.derivations.filter(
              (d) => d.mnemonic === m.mnemonic && d.passphrase === passphrase && d.depth === depth && d.account === account
            );
            expect(hits, `${m.name}/${passphrase}/${depth}/${account}`).toHaveLength(1);
          }
        }
      }
    }
    expect(new Set(vectors.derivations.map((d) => d.name)).size).toBe(vectors.derivations.length);
    expect(new Set(vectors.path_policy.map((d) => d.name)).size).toBe(vectors.path_policy.length);
  });

  it('is generated for the SDK coin type', () => {
    expect(vectors.coin_type).toBe(ThruHDWallet.THRU_COIN_TYPE);
    expect(vectors.derivations.every((d) => d.coin_type === vectors.coin_type)).toBe(true);
  });
});

describe('HD vectors: every derivation matches the reference implementation', () => {
  it.each(vectors.derivations.map((d) => [d.name, d] as const))('%s', async (_name, d) => {
    const seed = refSeedCached(d.mnemonic, d.passphrase);
    expect(bytesToHex(seed)).toBe(d.seed_hex);

    const components = refParsePath(d.path);
    expect(components.length).toBe(d.depth);
    expect(refDeviceAcceptsPath(components, vectors.coin_type)).toBe(true);
    expect(refPathApdu(components)).toBe(d.path_apdu_hex);
    expect(components[2]).toBe((d.account + HARDENED) >>> 0);
    if (d.depth === 4) expect(components[3]).toBe((d.change! + HARDENED) >>> 0);
    else expect(d.change).toBeNull();

    const { key, chainCode } = refSlip10Ed25519(seed, components);
    expect(bytesToHex(chainCode)).toBe(d.chain_code_hex);
    expect(bytesToHex(key)).toBe(d.private_seed_hex);

    const pub = await ed.getPublicKeyAsync(key);
    expect(bytesToHex(pub)).toBe(d.pubkey_hex);

    expect(d.address).toHaveLength(46);
    expect(refAddress(pub)).toBe(d.address);
  });
});

describe('HD vectors: SDK conformance', () => {
  it.each(vectors.derivations.map((d) => [d.name, d] as const))('%s', async (_name, d) => {
    const seed = MnemonicGenerator.toSeed(d.mnemonic, d.passphrase);
    expect(bytesToHex(seed)).toBe(d.seed_hex);

    const pub = hexToBytes(d.pubkey_hex);
    expect(encodeAddress(pub)).toBe(d.address);

    if (d.depth === 4) {
      // Public SDK API (depth 4 only).
      const account = await ThruHDWallet.getAccount(seed, d.account, d.change!);
      expect(account.path).toBe(d.path);
      expect(bytesToHex(account.privateKey)).toBe(d.private_seed_hex);
      expect(bytesToHex(account.publicKey)).toBe(d.pubkey_hex);
      expect(bytesToHex(account.secretKey)).toBe(d.private_seed_hex + d.pubkey_hex);
      expect(account.address).toBe(d.address);
    } else {
      // The SLIP-10 library ThruHDWallet wraps.
      const node = HDKey.fromMasterSeed(seed).derive(d.path);
      expect(bytesToHex(node.privateKey)).toBe(d.private_seed_hex);
      expect(bytesToHex(node.publicKeyRaw)).toBe(d.pubkey_hex);
    }

    // Public explicit-path API (depth 3 and 4).
    expect(ThruHDWallet.getAccountPath(d.account, d.depth)).toBe(d.path);
    expect(ThruHDWallet.isLedgerCompatiblePath(d.path)).toBe(true);
    expect(ThruHDWallet.parsePath(d.path)).toEqual(refParsePath(d.path));
    const atPath = await ThruHDWallet.getAccountAtPath(seed, d.path);
    expect(atPath.path).toBe(d.path);
    expect(bytesToHex(atPath.privateKey)).toBe(d.private_seed_hex);
    expect(bytesToHex(atPath.publicKey)).toBe(d.pubkey_hex);
    expect(bytesToHex(atPath.secretKey)).toBe(d.private_seed_hex + d.pubkey_hex);
    expect(atPath.address).toBe(d.address);
  });
});

describe('HD vectors: SDK path policy', () => {
  it.each(vectors.path_policy.map((p) => [p.name, p] as const))('isLedgerCompatiblePath rejects %s', async (_name, p) => {
    expect(ThruHDWallet.isLedgerCompatiblePath(p.path)).toBe(false);
    expect(ThruHDWallet.isLedgerCompatiblePath(p.components)).toBe(false);
    // The SDK reports the same reason the corpus records.
    expect(ThruHDWallet.ledgerPathError(p.path)).toBe(p.reason);
    expect(ThruHDWallet.ledgerPathError(p.components)).toBe(p.reason);
    expect(() => ThruHDWallet.assertLedgerCompatiblePath(p.path)).toThrow(p.reason);
    await expect(ThruHDWallet.getAccountAtPath(new Uint8Array(64), p.path)).rejects.toThrow(/not Ledger-compatible/);
  });

  it('accepts every derivation path, as a string and as raw components', () => {
    for (const d of vectors.derivations) {
      expect(ThruHDWallet.isLedgerCompatiblePath(d.path)).toBe(true);
      expect(ThruHDWallet.isLedgerCompatiblePath(refParsePath(d.path))).toBe(true);
    }
  });
});

describe('HD vectors: device path policy', () => {
  it.each(vectors.path_policy.map((p) => [p.name, p] as const))('rejects %s', (_name, p) => {
    expect(p.expect).toBe('reject');
    const components = refParsePath(p.path);
    expect(components).toEqual(p.components);
    expect(p.depth).toBe(components.length);
    expect(refPathApdu(components)).toBe(p.path_apdu_hex);
    expect(refDeviceAcceptsPath(components, vectors.coin_type)).toBe(false);
  });

  it('covers depth, hardening, purpose, coin-type and change violations', () => {
    const names = vectors.path_policy.map((p) => p.name);
    for (const n of ['depth-2', 'depth-5', 'non-hardened-account', 'non-hardened-change', 'wrong-purpose-43', 'wrong-coin-type-501', 'change-1-hardened']) {
      expect(names).toContain(n);
    }
  });
});

describe('HD vectors: drift check', () => {
  it('regenerating the corpus reproduces hd_vectors.json byte-for-byte', async () => {
    const regenerated = serializeHdVectors(await buildHdVectors(vectors.coin_type));
    expect(regenerated === fileText, 'hd_vectors.json is stale; run `pnpm --filter @thru/sdk gen:hd-vectors`').toBe(true);
  });
});
