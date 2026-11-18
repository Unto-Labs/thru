/**
 * Generator for the Thru HD-derivation conformance vectors.
 *
 * Writes contrib/test/vectors/signing/hd_vectors.json. Every Thru client and
 * the Ledger device app must reproduce these vectors exactly:
 *
 *   BIP39 mnemonic (+ passphrase) -> 64-byte seed
 *   -> SLIP-0010 Ed25519 derivation along m/44'/{coin}'/{account}'[/{change}']
 *   -> 32-byte private seed -> Ed25519 public key -> "ta..." address
 *
 * The coin type defaults to ThruHDWallet.THRU_COIN_TYPE (SLIP-44 8478).
 * `--coin-type N` regenerates the whole corpus for another value.
 *
 * Usage (from web/packages/sdk):
 *   pnpm gen:hd-vectors                 # regenerate the JSON in place
 *   pnpm check:hd-vectors               # regenerate in memory, fail on drift (CI)
 *   pnpm gen:hd-vectors --coin-type N   # generate for another coin type
 *   pnpm gen:hd-vectors --out FILE      # write somewhere else
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import HDKey from 'micro-key-producer/slip10.js';
import { encodeAddress } from '../src/helpers/address';
import { ThruHDWallet } from '../src/crypto/hdwallet';
import { MnemonicGenerator } from '../src/crypto/mnemonic';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

/** Repository-relative location of the vectors file. */
export const HD_VECTORS_REL_PATH = 'contrib/test/vectors/signing/hd_vectors.json';

/** Absolute location of the vectors file (scripts/ -> sdk -> packages -> web -> repo root). */
export const HD_VECTORS_PATH = resolve(SCRIPT_DIR, '../../../..', HD_VECTORS_REL_PATH);

export const HARDENED_OFFSET = 0x8000_0000;
export const MAX_HARDENED_INDEX = HARDENED_OFFSET - 1; // 2^31 - 1

export type HdMnemonicSpec = {
  name: string;
  mnemonic: string;
  source: string;
};

export const HD_MNEMONICS: readonly HdMnemonicSpec[] = [
  {
    name: 'bip39-abandon-about',
    mnemonic:
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
    source: 'Standard BIP39 test mnemonic (trezor/python-mnemonic vectors.json, 12 words)',
  },
  {
    name: 'speculos-default',
    mnemonic:
      'glory promote mansion idle axis finger extra february uncover one trip resource lawn turtle enact ' +
      'monster seven myth punch hobby comfort wild raise skin',
    source:
      'Ledger Speculos DEFAULT_SEED (LedgerHQ/speculos speculos/main.py, commit d88678b7); ' +
      'Speculos converts it with standard BIP39 and an empty passphrase',
  },
  {
    name: 'bip39-abandon-art',
    mnemonic:
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon ' +
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art',
    source: 'BIP39 test vector, all-zero 256-bit entropy (trezor/python-mnemonic vectors.json, 24 words)',
  },
  {
    name: 'bip39-letter-bless',
    mnemonic:
      'letter advice cage absurd amount doctor acoustic avoid letter advice cage absurd amount doctor ' +
      'acoustic avoid letter advice cage absurd amount doctor acoustic bless',
    source: 'BIP39 test vector, entropy 0x80808080... (trezor/python-mnemonic vectors.json, 24 words)',
  },
];

/** "TREZOR" is the passphrase used by the published BIP39 vectors, so seeds are externally checkable. */
export const HD_PASSPHRASES: readonly string[] = ['', 'TREZOR'];

export const HD_ACCOUNTS: readonly number[] = [0, 1, 2, MAX_HARDENED_INDEX];

export type HdDerivationVector = {
  name: string;
  mnemonic: string;
  passphrase: string;
  seed_hex: string;
  coin_type: number;
  path: string;
  depth: 3 | 4;
  account: number;
  change: number | null;
  /** Device path encoding: u8 depth, then depth x u32 big-endian (hardened bit set). */
  path_apdu_hex: string;
  chain_code_hex: string;
  private_seed_hex: string;
  pubkey_hex: string;
  address: string;
};

export type HdPathPolicyVector = {
  name: string;
  path: string;
  depth: number;
  components: number[];
  path_apdu_hex: string;
  expect: 'reject';
  reason: string;
};

export type HdVectorsFile = {
  schema: 'thru.hd_vectors.v1';
  generator: string;
  regenerate: string;
  check: string;
  coin_type: number;
  coin_type_note: string;
  spec: Record<string, string>;
  mnemonics: HdMnemonicSpec[];
  derivations: HdDerivationVector[];
  path_policy: HdPathPolicyVector[];
};

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Parse "m/44'/8478'/0'" into raw u32 components (hardened bit applied). */
export function parsePath(path: string): number[] {
  if (path === 'm') return [];
  if (!path.startsWith('m/')) throw new Error(`Path must start with "m/": ${path}`);
  return path
    .slice(2)
    .split('/')
    .map((part) => {
      const hardened = part.endsWith("'");
      const digits = hardened ? part.slice(0, -1) : part;
      if (!/^\d+$/.test(digits)) throw new Error(`Bad path component "${part}" in ${path}`);
      const index = Number(digits);
      if (index > MAX_HARDENED_INDEX) throw new Error(`Path component out of range in ${path}`);
      return hardened ? index + HARDENED_OFFSET : index;
    });
}

/** Encode raw u32 components as the device APDU path: u8 depth || depth x u32 BE. */
export function encodePathApdu(components: readonly number[]): string {
  const out = new Uint8Array(1 + 4 * components.length);
  const view = new DataView(out.buffer);
  out[0] = components.length;
  components.forEach((c, i) => view.setUint32(1 + 4 * i, c >>> 0, false));
  return toHex(out);
}

function derive(seed: Uint8Array, path: string) {
  const node = HDKey.fromMasterSeed(seed).derive(path);
  if (!node.privateKey || !node.publicKeyRaw) throw new Error(`Derivation failed for ${path}`);
  return { privateKey: node.privateKey, publicKey: node.publicKeyRaw, chainCode: node.chainCode };
}

async function buildDerivations(coinType: number): Promise<HdDerivationVector[]> {
  const out: HdDerivationVector[] = [];
  for (const m of HD_MNEMONICS) {
    for (const passphrase of HD_PASSPHRASES) {
      const seed = MnemonicGenerator.toSeed(m.mnemonic, passphrase);
      const seedHex = toHex(seed);
      for (const depth of [4, 3] as const) {
        for (const account of HD_ACCOUNTS) {
          const change = depth === 4 ? 0 : null;
          const path =
            depth === 4 ? `m/44'/${coinType}'/${account}'/${change}'` : `m/44'/${coinType}'/${account}'`;
          const { privateKey, publicKey, chainCode } = derive(seed, path);
          const address = encodeAddress(publicKey);

          // When generating for the SDK's own coin type, the public SDK API must
          // agree with the raw derivation at both depths.
          if (coinType === ThruHDWallet.THRU_COIN_TYPE) {
            const sdk =
              depth === 4
                ? await ThruHDWallet.getAccount(seed, account, 0)
                : await ThruHDWallet.getAccountAtPath(seed, ThruHDWallet.getAccountPath(account, 3));
            if (
              sdk.path !== path ||
              toHex(sdk.publicKey) !== toHex(publicKey) ||
              toHex(sdk.privateKey) !== toHex(privateKey) ||
              sdk.address !== address
            ) {
              throw new Error(`ThruHDWallet disagrees with raw SLIP-10 derivation at ${path}`);
            }
          }

          out.push({
            name: `${m.name}/${passphrase === '' ? 'no-passphrase' : 'passphrase-' + passphrase}/depth${depth}/account-${account}`,
            mnemonic: m.mnemonic,
            passphrase,
            seed_hex: seedHex,
            coin_type: coinType,
            path,
            depth,
            account,
            change,
            path_apdu_hex: encodePathApdu(parsePath(path)),
            chain_code_hex: toHex(chainCode),
            private_seed_hex: toHex(privateKey),
            pubkey_hex: toHex(publicKey),
            address,
          });
        }
      }
    }
  }
  return out;
}

function buildPathPolicy(coinType: number): HdPathPolicyVector[] {
  const wrongCoins = [501, 60].filter((c) => c !== coinType);
  const cases: Array<{ name: string; path: string; reason: string }> = [
    { name: 'depth-0', path: 'm', reason: 'depth must be 3 or 4' },
    { name: 'depth-1', path: "m/44'", reason: 'depth must be 3 or 4' },
    { name: 'depth-2', path: `m/44'/${coinType}'`, reason: 'depth must be 3 or 4' },
    { name: 'depth-5', path: `m/44'/${coinType}'/0'/0'/0'`, reason: 'depth must be 3 or 4' },
    { name: 'non-hardened-purpose', path: `m/44/${coinType}'/0'/0'`, reason: 'every component must be hardened' },
    { name: 'non-hardened-coin-type', path: `m/44'/${coinType}/0'/0'`, reason: 'every component must be hardened' },
    { name: 'non-hardened-account', path: `m/44'/${coinType}'/0/0'`, reason: 'every component must be hardened' },
    { name: 'non-hardened-change', path: `m/44'/${coinType}'/0'/0`, reason: 'every component must be hardened' },
    { name: 'non-hardened-account-depth3', path: `m/44'/${coinType}'/0`, reason: 'every component must be hardened' },
    { name: 'all-non-hardened', path: `m/44/${coinType}/0/0`, reason: 'every component must be hardened' },
    { name: 'wrong-purpose-43', path: `m/43'/${coinType}'/0'/0'`, reason: "purpose must be 44'" },
    { name: 'wrong-purpose-84', path: `m/84'/${coinType}'/0'/0'`, reason: "purpose must be 44'" },
    { name: 'wrong-purpose-0-depth3', path: `m/0'/${coinType}'/0'`, reason: "purpose must be 44'" },
    ...wrongCoins.flatMap((c) => [
      { name: `wrong-coin-type-${c}`, path: `m/44'/${c}'/0'/0'`, reason: `coin type must be ${coinType}'` },
      { name: `wrong-coin-type-${c}-depth3`, path: `m/44'/${c}'/0'`, reason: `coin type must be ${coinType}'` },
    ]),
    { name: 'coin-type-off-by-one', path: `m/44'/${coinType + 1}'/0'/0'`, reason: `coin type must be ${coinType}'` },
    { name: 'change-1-hardened', path: `m/44'/${coinType}'/0'/1'`, reason: "change must be 0'" },
    { name: 'change-max-hardened', path: `m/44'/${coinType}'/0'/2147483647'`, reason: "change must be 0'" },
  ];

  return cases.map(({ name, path, reason }) => {
    const components = parsePath(path);
    return {
      name,
      path,
      depth: components.length,
      components,
      path_apdu_hex: encodePathApdu(components),
      expect: 'reject' as const,
      reason,
    };
  });
}

export async function buildHdVectors(coinType: number = ThruHDWallet.THRU_COIN_TYPE): Promise<HdVectorsFile> {
  if (!Number.isInteger(coinType) || coinType < 0 || coinType > MAX_HARDENED_INDEX) {
    throw new Error(`Invalid coin type: ${coinType}`);
  }
  return {
    schema: 'thru.hd_vectors.v1',
    generator: 'web/packages/sdk/scripts/gen-hd-vectors.ts',
    regenerate: 'cd web && pnpm --filter @thru/sdk gen:hd-vectors',
    check: 'cd web && pnpm --filter @thru/sdk check:hd-vectors',
    coin_type: coinType,
    coin_type_note: 'Thru uses coin type 8478; SLIP-44 registration is pending.',
    spec: {
      seed: 'BIP39: PBKDF2-HMAC-SHA512(NFKD(mnemonic), "mnemonic" || NFKD(passphrase), 2048 iterations) -> 64 bytes',
      derivation:
        'SLIP-0010 Ed25519: I = HMAC-SHA512("ed25519 seed", seed); child I = HMAC-SHA512(c_par, 0x00 || k_par || ser32(i)); hardened only',
      path: "m/44'/{coin_type}'/{account}'/{change=0}' (depth 4) or m/44'/{coin_type}'/{account}' (depth 3); all hardened",
      path_apdu: 'u8 depth || depth x u32 big-endian, hardened bit 0x80000000 set',
      private_seed_hex: 'the 32-byte SLIP-0010 key k (the Ed25519 private seed, not the expanded key)',
      pubkey_hex: 'Ed25519 public key of private_seed_hex (RFC 8032)',
      address: '"ta" || base64url_nopad(pubkey[32] || (sum of pubkey bytes) mod 256), 46 chars',
      device_path_policy:
        "accept only depth 3 or 4, every component hardened, prefix 44'/{coin_type}', change exactly 0' at depth 4; path_policy lists inputs that must be rejected",
    },
    mnemonics: HD_MNEMONICS.map((m) => ({ ...m })),
    derivations: await buildDerivations(coinType),
    path_policy: buildPathPolicy(coinType),
  };
}

export function serializeHdVectors(file: HdVectorsFile): string {
  return JSON.stringify(file, null, 2) + '\n';
}

function parseArgs(argv: string[]): { check: boolean; coinType?: number; out: string } {
  let check = false;
  let coinType: number | undefined;
  let out = HD_VECTORS_PATH;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--check') check = true;
    else if (arg === '--coin-type') coinType = Number(argv[++i]);
    else if (arg === '--out') out = resolve(process.cwd(), argv[++i] ?? '');
    else if (arg === '--') continue;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return { check, coinType, out };
}

async function main(): Promise<void> {
  const { check, coinType, out } = parseArgs(process.argv.slice(2));
  const file = await buildHdVectors(coinType);
  const text = serializeHdVectors(file);

  if (check) {
    let existing: string;
    try {
      existing = readFileSync(out, 'utf8');
    } catch {
      console.error(`hd vectors missing: ${out}`);
      process.exit(1);
    }
    if (existing !== text) {
      const a = existing.split('\n');
      const b = text.split('\n');
      const line = a.findIndex((l, i) => l !== b[i]);
      console.error(`hd vectors are stale: ${out}`);
      console.error(`first difference at line ${line + 1}:`);
      console.error(`  file:      ${a[line] ?? '<eof>'}`);
      console.error(`  generated: ${b[line] ?? '<eof>'}`);
      console.error('regenerate with: cd web && pnpm --filter @thru/sdk gen:hd-vectors');
      process.exit(1);
    }
    console.log(
      `hd vectors up to date: ${file.derivations.length} derivations, ${file.path_policy.length} path-policy cases`
    );
    return;
  }

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, text);
  console.log(
    `wrote ${out}: ${file.derivations.length} derivations, ${file.path_policy.length} path-policy cases (coin type ${file.coin_type})`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
