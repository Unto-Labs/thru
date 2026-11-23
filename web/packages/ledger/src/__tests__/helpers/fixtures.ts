/** Shared fixtures: corpus access, keys and a transaction-body builder. */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { fromHex } from '../../protocol/bytes';
import { TXN_FLAG_HAS_FEE_PAYER_PROOF } from '../../protocol/constants';

const here = dirname(fileURLToPath(import.meta.url));

/** `contrib/test/vectors/signing/` at the repo root. */
export const CORPUS_DIR = resolve(here, '../../../../../../contrib/test/vectors/signing');

export interface HdDerivation {
  name: string;
  mnemonic: string;
  passphrase: string;
  seed_hex: string;
  coin_type: number;
  path: string;
  depth: number;
  account: number;
  change?: number;
  path_apdu_hex: string;
  private_seed_hex: string;
  pubkey_hex: string;
  address: string;
}

export interface HdPathPolicy {
  name: string;
  path: string;
  depth: number;
  components: number[];
  path_apdu_hex: string;
  expect: 'reject';
  reason: string;
}

export interface HdVectors {
  schema: string;
  coin_type: number;
  derivations: HdDerivation[];
  path_policy: HdPathPolicy[];
}

export function loadHdVectors(): HdVectors {
  return JSON.parse(readFileSync(join(CORPUS_DIR, 'hd_vectors.json'), 'utf8')) as HdVectors;
}

const hd = loadHdVectors();

function derivation(name: string): HdDerivation {
  const d = hd.derivations.find((v) => v.name === name);
  if (d === undefined) throw new Error(`missing HD vector ${name}`);
  return d;
}

/** `abandon … about`, `m/44'/8478'/0'/0'`. */
export const KEY0 = derivation('bip39-abandon-about/no-passphrase/depth4/account-0');
/** `abandon … about`, `m/44'/8478'/1'/0'`. */
export const KEY1 = derivation('bip39-abandon-about/no-passphrase/depth4/account-1');

export const PUBKEY0 = fromHex(KEY0.pubkey_hex);
export const PUBKEY1 = fromHex(KEY1.pubkey_hex);
export const SECRET0 = fromHex(KEY0.private_seed_hex);
export const SECRET1 = fromHex(KEY1.private_seed_hex);

/** EOA program (B.5). */
export const EOA_PROGRAM = fromHex('10e0298a6928c09bded091b6819a915c98fce06c3307d42690d009505a31ca48');

/** A deterministic 32-byte key whose first byte orders it. */
export function key(first: number, fill = 0x11): Uint8Array {
  const k = new Uint8Array(32).fill(fill);
  k[0] = first;
  return k;
}

export interface BodyOptions {
  version?: number;
  flags?: number;
  rw?: Uint8Array[];
  ro?: Uint8Array[];
  instr?: Uint8Array;
  cu?: number;
  su?: number;
  mu?: number;
  fee?: bigint;
  nonce?: bigint;
  startSlot?: bigint;
  expiryAfter?: number;
  chainId?: number;
  pad?: number;
  feePayer?: Uint8Array;
  program?: Uint8Array;
  /** Appended after instruction data (proof header + body). */
  proof?: Uint8Array;
  /** Appended after the proof. */
  meta?: Uint8Array;
  /** Header-count overrides, to build inconsistent bodies. */
  rwCnt?: number;
  roCnt?: number;
  instrSz?: number;
}

/** Build a transaction body (wire bytes without the signature). Defaults are spec A.3. */
export function buildBody(o: BodyOptions = {}): Uint8Array {
  const rw = o.rw ?? [];
  const ro = o.ro ?? [];
  const instr = o.instr ?? new Uint8Array(0);
  const proof = o.proof ?? new Uint8Array(0);
  const meta = o.meta ?? new Uint8Array(0);
  const flags = o.flags ?? (proof.length > 0 ? TXN_FLAG_HAS_FEE_PAYER_PROOF : 0);
  const total = 112 + 32 * (rw.length + ro.length) + instr.length + proof.length + meta.length;
  const out = new Uint8Array(total);
  const v = new DataView(out.buffer);
  v.setUint8(0, o.version ?? 1);
  v.setUint8(1, flags);
  v.setUint16(2, o.rwCnt ?? rw.length, true);
  v.setUint16(4, o.roCnt ?? ro.length, true);
  v.setUint16(6, o.instrSz ?? instr.length, true);
  v.setUint32(8, o.cu ?? 10000, true);
  v.setUint16(12, o.su ?? 0, true);
  v.setUint16(14, o.mu ?? 0, true);
  v.setBigUint64(16, o.fee ?? 1000n, true);
  v.setBigUint64(24, o.nonce ?? 0n, true);
  v.setBigUint64(32, o.startSlot ?? 100n, true);
  v.setUint32(40, o.expiryAfter ?? 100, true);
  v.setUint16(44, o.chainId ?? 1, true);
  v.setUint16(46, o.pad ?? 0, true);
  out.set(o.feePayer ?? PUBKEY0, 48);
  out.set(o.program ?? EOA_PROGRAM, 80);
  let off = 112;
  for (const k of [...rw, ...ro]) {
    out.set(k, off);
    off += 32;
  }
  out.set(instr, off);
  off += instr.length;
  out.set(proof, off);
  off += proof.length;
  out.set(meta, off);
  return out;
}

/** A fee-payer state proof: 40-byte header (type, slot, bitset with `pop` bits) plus body. */
export function buildProof(type: number, pop: number, slot = 7n): Uint8Array {
  const hdr = new Uint8Array(40);
  const v = new DataView(hdr.buffer);
  v.setBigUint64(0, (BigInt(type) << 62n) | slot, true);
  for (let i = 0; i < pop; i++) hdr[8 + (i >> 3)] |= 1 << (i & 7);
  const body = new Uint8Array((type + pop) * 32).fill(0xab);
  const out = new Uint8Array(40 + body.length);
  out.set(hdr, 0);
  out.set(body, 40);
  return out;
}

/** Spec Appendix A.3 body, transcribed byte for byte. */
export const A3_BODY_HEX =
  '01000000000000001027000000000000' +
  'e8030000000000000000000000000000' +
  '64000000000000006400000001000000' +
  '1d65dd4d10f4f8a392d9e17c4d8cdea7' +
  'c68e2a3eadc35997bbb6738e39cc0e6e' +
  '10e0298a6928c09bded091b6819a915c' +
  '98fce06c3307d42690d009505a31ca48';
