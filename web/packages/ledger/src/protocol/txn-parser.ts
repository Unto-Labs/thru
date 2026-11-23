/**
 * Streaming transaction-envelope parser: a host-side port of the device's
 * `thru-ledger-parser` state machine (`specs/ledger/app-thru-apdu.md` §7.5).
 *
 * It consumes the body in arbitrary chunks, hashes every byte exactly once,
 * and reports the first violation in stream order with the device's status
 * word and reason class. Hosts use it to fail fast before streaming (§11.1)
 * and to build the preview (§11.3); the test suite's mock device uses it as
 * its parser. The result is independent of the chunking (§3.4).
 */
import { sha256 } from '@noble/hashes/sha2.js';

import { type TxnRejectReason } from '../errors';
import { bytesEqual, compareBytes } from './bytes';
import {
  ACCOUNT_META_SZ,
  PUBKEY_SZ,
  RW_CACHE_MAX,
  STATE_PROOF_HDR_SZ,
  STATE_PROOF_TYPE_CREATION,
  STATE_PROOF_TYPE_EXISTING,
  TXN_BODY_MAX,
  TXN_FLAG_HAS_FEE_PAYER_PROOF,
  TXN_HDR_SZ,
  TXN_MAX_ACCOUNTS,
} from './constants';
import { StatusWord } from './status-words';

/** Decoded 112-byte header (§7.5.1). */
export interface TxnHeader {
  readonly version: number;
  readonly flags: number;
  readonly rwCnt: number;
  readonly roCnt: number;
  readonly instrSz: number;
  readonly computeUnits: number;
  readonly stateUnits: number;
  readonly memoryUnits: number;
  readonly fee: bigint;
  readonly nonce: bigint;
  readonly startSlot: bigint;
  readonly expiryAfter: number;
  readonly chainId: number;
  readonly pad: number;
  readonly feePayer: Uint8Array;
  readonly program: Uint8Array;
}

export interface TxnParseFailure {
  /** Status word the device returns for this violation. */
  readonly sw: number;
  readonly reason: TxnRejectReason;
  readonly detail: string;
  /** Body offset of the byte that completed the failing field. */
  readonly offset: number;
}

export interface TxnParseSuccess {
  readonly header: TxnHeader;
  /** Fee-payer state-proof type, when flags bit0 is set. */
  readonly proofType: number | null;
  /** Total body length, equal to the length computed from the header. */
  readonly bodyLength: number;
  /** SHA-256 of the body: the value the device displays and signs over. */
  readonly bodyHash: Uint8Array;
}

export type TxnParseResult =
  | ({ readonly ok: true } & TxnParseSuccess)
  | ({ readonly ok: false } & TxnParseFailure);

const enum State {
  Header,
  RwAccounts,
  RoAccounts,
  InstrData,
  ProofHdr,
  ProofBody,
  Meta,
  Done,
  Failed,
}

function popcount(bytes: Uint8Array): number {
  let n = 0;
  for (let b of bytes) {
    while (b !== 0) {
      n += b & 1;
      b >>>= 1;
    }
  }
  return n;
}

function decodeHeader(h: Uint8Array): TxnHeader {
  const v = new DataView(h.buffer, h.byteOffset, h.byteLength);
  return {
    version: v.getUint8(0),
    flags: v.getUint8(1),
    rwCnt: v.getUint16(2, true),
    roCnt: v.getUint16(4, true),
    instrSz: v.getUint16(6, true),
    computeUnits: v.getUint32(8, true),
    stateUnits: v.getUint16(12, true),
    memoryUnits: v.getUint16(14, true),
    fee: v.getBigUint64(16, true),
    nonce: v.getBigUint64(24, true),
    startSlot: v.getBigUint64(32, true),
    expiryAfter: v.getUint32(40, true),
    chainId: v.getUint16(44, true),
    pad: v.getUint16(46, true),
    feePayer: h.slice(48, 80),
    program: h.slice(80, 112),
  };
}

export interface TxnStreamParserOptions {
  /**
   * The pubkey the device derives from the path. When given, rule H5
   * (`fee_payer == derived pubkey`, `0x6810`) is enforced. Omit it to parse a
   * body for preview without a key.
   */
  derivedPubkey?: Uint8Array;
}

export class TxnStreamParser {
  readonly #derivedPubkey: Uint8Array | undefined;
  readonly #hash = sha256.create();
  #state: State = State.Header;
  #offset = 0;
  /** Bytes remaining in the current state. */
  #remaining = TXN_HDR_SZ;
  /** Assembly buffer for header / keys / proof header. */
  #buf = new Uint8Array(TXN_HDR_SZ);
  #bufLen = 0;
  #header: TxnHeader | null = null;
  #fixedLen = 0;
  #index = 0;
  #prev: Uint8Array | null = null;
  #rwCache: Uint8Array[] = [];
  #rwCursor = 0;
  #proofType: number | null = null;
  #failure: TxnParseFailure | null = null;

  constructor(options: TxnStreamParserOptions = {}) {
    if (options.derivedPubkey !== undefined && options.derivedPubkey.length !== PUBKEY_SZ) {
      throw new Error('derivedPubkey must be 32 bytes');
    }
    this.#derivedPubkey = options.derivedPubkey;
  }

  /** True once the body is complete (every header-computed byte consumed). */
  get done(): boolean {
    return this.#state === State.Done;
  }

  get failure(): TxnParseFailure | null {
    return this.#failure;
  }

  get header(): TxnHeader | null {
    return this.#header;
  }

  /** Bytes consumed so far. */
  get offset(): number {
    return this.#offset;
  }

  /**
   * Feed the next body bytes. Returns the first violation (the parser is then
   * dead and every later call returns the same failure), or `null`.
   */
  feed(bytes: Uint8Array): TxnParseFailure | null {
    if (this.#failure !== null) return this.#failure;
    let i = 0;
    while (i < bytes.length) {
      if (this.#state === State.Done) {
        return this.#fail('invalid_format', StatusWord.TXN_INVALID_FORMAT, 'trailing bytes after the body');
      }
      const take = Math.min(this.#remaining, bytes.length - i);
      const piece = bytes.subarray(i, i + take);
      const opaque =
        this.#state === State.InstrData || this.#state === State.ProofBody || this.#state === State.Meta;
      if (opaque) {
        this.#hash.update(piece);
        this.#offset += take;
        this.#remaining -= take;
        i += take;
        if (this.#remaining === 0) this.#advanceAfterOpaque();
        continue;
      }
      /* Structured states are consumed one byte at a time so checks fire at
         the exact byte the device evaluates them (H1 at byte 0, H2 at byte 1). */
      const byte = bytes[i];
      this.#hash.update(bytes.subarray(i, i + 1));
      this.#buf[this.#bufLen++] = byte;
      this.#offset += 1;
      this.#remaining -= 1;
      i += 1;
      const failure = this.#onStructuredByte();
      if (failure !== null) return failure;
    }
    return null;
  }

  /**
   * Finish the stream. Fails with `0x6801` if the body is truncated.
   * Must be called at most once.
   */
  finish(): TxnParseResult {
    if (this.#failure !== null) return { ok: false, ...this.#failure };
    if (this.#state !== State.Done || this.#header === null) {
      const failure = this.#fail('invalid_format', StatusWord.TXN_INVALID_FORMAT, 'body truncated');
      return { ok: false, ...failure };
    }
    return {
      ok: true,
      header: this.#header,
      proofType: this.#proofType,
      bodyLength: this.#offset,
      bodyHash: this.#hash.digest(),
    };
  }

  #fail(reason: TxnRejectReason, sw: number, detail: string): TxnParseFailure {
    this.#failure = { sw, reason, detail, offset: Math.max(0, this.#offset - 1) };
    this.#state = State.Failed;
    return this.#failure;
  }

  #onStructuredByte(): TxnParseFailure | null {
    switch (this.#state) {
      case State.Header:
        return this.#onHeaderByte();
      case State.RwAccounts:
      case State.RoAccounts:
        if (this.#bufLen < PUBKEY_SZ) return null;
        return this.#state === State.RwAccounts ? this.#onRwKey() : this.#onRoKey();
      case State.ProofHdr:
        if (this.#bufLen < STATE_PROOF_HDR_SZ) return null;
        return this.#onProofHeader();
      default:
        return null;
    }
  }

  #onHeaderByte(): TxnParseFailure | null {
    if (this.#bufLen === 1 && this.#buf[0] !== 1) {
      return this.#fail('invalid_version', StatusWord.TXN_INVALID_VERSION, `version ${this.#buf[0]} != 1`);
    }
    if (this.#bufLen === 2 && (this.#buf[1] & 0xfc) !== 0) {
      return this.#fail('invalid_flags', StatusWord.TXN_INVALID_FLAGS, `unknown flag bits 0x${this.#buf[1].toString(16)}`);
    }
    if (this.#bufLen < TXN_HDR_SZ) return null;

    const h = decodeHeader(this.#buf);
    this.#header = h;
    if (h.chainId === 0) {
      return this.#fail('chain_id_zero', StatusWord.CHAIN_ID_ZERO, 'chain_id is 0');
    }
    if (h.pad !== 0) {
      return this.#fail('pad_nonzero', StatusWord.TXN_PAD_NONZERO, `pad is ${h.pad}`);
    }
    if (this.#derivedPubkey !== undefined && !bytesEqual(h.feePayer, this.#derivedPubkey)) {
      return this.#fail('fee_payer_mismatch', StatusWord.FEE_PAYER_MISMATCH, 'fee payer is not the derived key');
    }
    if (bytesEqual(h.feePayer, h.program)) {
      return this.#fail('duplicate_account', StatusWord.TXN_DUPLICATE_ACCOUNT, 'fee payer equals program');
    }
    const proofHdr = (h.flags & TXN_FLAG_HAS_FEE_PAYER_PROOF) !== 0 ? STATE_PROOF_HDR_SZ : 0;
    this.#fixedLen = TXN_HDR_SZ + PUBKEY_SZ * (h.rwCnt + h.roCnt) + h.instrSz + proofHdr;
    if (this.#fixedLen > TXN_BODY_MAX) {
      return this.#fail('invalid_format', StatusWord.TXN_INVALID_FORMAT, `computed size ${this.#fixedLen} > ${TXN_BODY_MAX}`);
    }
    if (2 + h.rwCnt + h.roCnt > TXN_MAX_ACCOUNTS) {
      return this.#fail('account_count_limit_exceeded', StatusWord.TXN_ACCOUNT_LIMIT, 'too many accounts');
    }
    if (h.rwCnt > RW_CACHE_MAX && h.roCnt > 0) {
      return this.#fail('rw_cache_exceeded', StatusWord.TXN_RW_CACHE_EXCEEDED, `rw_cnt ${h.rwCnt} > ${RW_CACHE_MAX} with ro_cnt > 0`);
    }
    this.#enter(State.RwAccounts);
    return null;
  }

  #checkKeyAgainstEnvelope(k: Uint8Array): boolean {
    const h = this.#header as TxnHeader;
    return bytesEqual(k, h.feePayer) || bytesEqual(k, h.program);
  }

  #onRwKey(): TxnParseFailure | null {
    const k = this.#buf.slice(0, PUBKEY_SZ);
    this.#bufLen = 0;
    if (this.#prev !== null) {
      const cmp = compareBytes(this.#prev, k);
      if (cmp === 0) return this.#fail('duplicate_account', StatusWord.TXN_DUPLICATE_ACCOUNT, `rw[${this.#index}] repeats rw[${this.#index - 1}]`);
      if (cmp > 0) return this.#fail('unsorted_readwrite_accounts', StatusWord.TXN_UNSORTED_RW, `rw[${this.#index}] not ascending`);
    }
    if (this.#checkKeyAgainstEnvelope(k)) {
      return this.#fail('duplicate_account', StatusWord.TXN_DUPLICATE_ACCOUNT, `rw[${this.#index}] equals fee payer or program`);
    }
    if ((this.#header as TxnHeader).roCnt > 0) this.#rwCache.push(k);
    this.#prev = k;
    this.#index += 1;
    this.#remaining = this.#index < (this.#header as TxnHeader).rwCnt ? PUBKEY_SZ : 0;
    if (this.#remaining === 0) this.#enter(this.#nextState(State.RwAccounts, this.#header as TxnHeader));
    return null;
  }

  #onRoKey(): TxnParseFailure | null {
    const k = this.#buf.slice(0, PUBKEY_SZ);
    this.#bufLen = 0;
    if (this.#prev !== null) {
      const cmp = compareBytes(this.#prev, k);
      if (cmp === 0) return this.#fail('duplicate_account', StatusWord.TXN_DUPLICATE_ACCOUNT, `ro[${this.#index}] repeats ro[${this.#index - 1}]`);
      if (cmp > 0) return this.#fail('unsorted_readonly_accounts', StatusWord.TXN_UNSORTED_RO, `ro[${this.#index}] not ascending`);
    }
    if (this.#checkKeyAgainstEnvelope(k)) {
      return this.#fail('duplicate_account', StatusWord.TXN_DUPLICATE_ACCOUNT, `ro[${this.#index}] equals fee payer or program`);
    }
    while (this.#rwCursor < this.#rwCache.length && compareBytes(this.#rwCache[this.#rwCursor], k) < 0) {
      this.#rwCursor += 1;
    }
    if (this.#rwCursor < this.#rwCache.length && bytesEqual(this.#rwCache[this.#rwCursor], k)) {
      return this.#fail('duplicate_account', StatusWord.TXN_DUPLICATE_ACCOUNT, `ro[${this.#index}] also listed read-write`);
    }
    this.#prev = k;
    this.#index += 1;
    this.#remaining = this.#index < (this.#header as TxnHeader).roCnt ? PUBKEY_SZ : 0;
    if (this.#remaining === 0) this.#enter(this.#nextState(State.RoAccounts, this.#header as TxnHeader));
    return null;
  }

  #onProofHeader(): TxnParseFailure | null {
    const p = this.#buf.subarray(0, STATE_PROOF_HDR_SZ);
    const type = p[7] >> 6;
    if (type !== STATE_PROOF_TYPE_EXISTING && type !== STATE_PROOF_TYPE_CREATION) {
      return this.#fail('invalid_fee_payer_state_proof_type', StatusWord.TXN_INVALID_PROOF_TYPE, `proof type ${type}`);
    }
    const proofBodyLen = (type + popcount(p.subarray(8, 40))) * 32;
    const metaLen = type === STATE_PROOF_TYPE_EXISTING ? ACCOUNT_META_SZ : 0;
    if (this.#fixedLen + proofBodyLen + metaLen > TXN_BODY_MAX) {
      return this.#fail('invalid_format', StatusWord.TXN_INVALID_FORMAT, 'proof makes the body exceed the MTU');
    }
    this.#proofType = type;
    this.#bufLen = 0;
    this.#enter(State.ProofBody, proofBodyLen);
    return null;
  }

  #advanceAfterOpaque(): void {
    this.#enter(this.#nextState(this.#state, this.#header as TxnHeader));
  }

  /** Enter `state`, skipping zero-length states (§7.5.8). */
  #enter(state: State, proofBodyLen = 0): void {
    const h = this.#header as TxnHeader;
    this.#bufLen = 0;
    let s = state;
    for (;;) {
      if (s === State.Done) {
        this.#state = State.Done;
        this.#remaining = 0;
        return;
      }
      const len = this.#lengthOf(s, h, proofBodyLen);
      if (len > 0) {
        this.#state = s;
        this.#remaining = len;
        if (s === State.RwAccounts || s === State.RoAccounts) {
          this.#buf = new Uint8Array(PUBKEY_SZ);
          this.#index = 0;
          this.#prev = null;
        } else if (s === State.ProofHdr) {
          this.#buf = new Uint8Array(STATE_PROOF_HDR_SZ);
        }
        return;
      }
      s = this.#nextState(s, h);
    }
  }

  #lengthOf(s: State, h: TxnHeader, proofBodyLen: number): number {
    switch (s) {
      case State.RwAccounts:
        return h.rwCnt === 0 ? 0 : PUBKEY_SZ;
      case State.RoAccounts:
        return h.roCnt === 0 ? 0 : PUBKEY_SZ;
      case State.InstrData:
        return h.instrSz;
      case State.ProofHdr:
        return STATE_PROOF_HDR_SZ;
      case State.ProofBody:
        return proofBodyLen;
      case State.Meta:
        return this.#proofType === STATE_PROOF_TYPE_EXISTING ? ACCOUNT_META_SZ : 0;
      default:
        return 0;
    }
  }

  #nextState(s: State, h: TxnHeader): State {
    switch (s) {
      case State.RwAccounts:
        return State.RoAccounts;
      case State.RoAccounts:
        return State.InstrData;
      case State.InstrData:
        return (h.flags & TXN_FLAG_HAS_FEE_PAYER_PROOF) !== 0 ? State.ProofHdr : State.Done;
      case State.ProofHdr:
        return State.ProofBody;
      case State.ProofBody:
        return State.Meta;
      default:
        return State.Done;
    }
  }
}

/**
 * One-shot parse of a complete body. `derivedPubkey`, when given, enforces
 * the device's fee-payer rule (H5).
 */
export function parseTransactionBody(body: Uint8Array, derivedPubkey?: Uint8Array): TxnParseResult {
  const parser = new TxnStreamParser({ derivedPubkey });
  const failure = parser.feed(body);
  if (failure !== null) return { ok: false, ...failure };
  return parser.finish();
}
