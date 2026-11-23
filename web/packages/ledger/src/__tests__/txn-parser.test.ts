/** Streaming envelope parser (§7.5): every check, its status word, and chunking invariance. */
import { sha256 } from '@noble/hashes/sha2.js';
import { describe, expect, it } from 'vitest';

import { StatusWord, TxnStreamParser, parseTransactionBody, toHex } from '../protocol';
import { streamed } from './helpers/stream';
import { EOA_PROGRAM, PUBKEY0, PUBKEY1, buildBody, buildProof, key } from './helpers/fixtures';

function swOf(body: Uint8Array, pubkey: Uint8Array | null = PUBKEY0): number | 'ok' {
  const r = parseTransactionBody(body, pubkey ?? undefined);
  return r.ok ? 'ok' : r.sw;
}

describe('header checks H1-H9', () => {
  it('accepts the minimal body and hashes it', () => {
    const body = buildBody();
    const r = parseTransactionBody(body, PUBKEY0);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(toHex(r.bodyHash)).toBe(toHex(sha256(body)));
      expect(r.bodyLength).toBe(112);
      expect(r.header.chainId).toBe(1);
      expect(r.proofType).toBeNull();
    }
  });

  it('H1 version is checked at byte 0', () => {
    const p = new TxnStreamParser();
    expect(p.feed(new Uint8Array([2]))?.sw).toBe(StatusWord.TXN_INVALID_VERSION);
    expect(swOf(buildBody({ version: 0 }))).toBe(StatusWord.TXN_INVALID_VERSION);
  });

  it('H2 flags are checked at byte 1', () => {
    for (let bit = 2; bit < 8; bit++) {
      const p = new TxnStreamParser();
      expect(p.feed(new Uint8Array([1, 1 << bit]))?.sw).toBe(StatusWord.TXN_INVALID_FLAGS);
    }
    expect(swOf(buildBody({ flags: 0x02 }))).toBe('ok');
  });

  it('H3 chain_id != 0, then H4 pad, then H5 fee payer, then H6 fee payer != program', () => {
    expect(swOf(buildBody({ chainId: 0, pad: 1, feePayer: PUBKEY1 }))).toBe(StatusWord.CHAIN_ID_ZERO);
    expect(swOf(buildBody({ pad: 1, feePayer: PUBKEY1 }))).toBe(StatusWord.TXN_PAD_NONZERO);
    expect(swOf(buildBody({ feePayer: PUBKEY1, program: PUBKEY1 }))).toBe(StatusWord.FEE_PAYER_MISMATCH);
    expect(swOf(buildBody({ program: PUBKEY0 }))).toBe(StatusWord.TXN_DUPLICATE_ACCOUNT);
    /* Without a derived key (preview), H5 is skipped. */
    expect(swOf(buildBody({ feePayer: PUBKEY1 }), null)).toBe('ok');
  });

  it('H7 computed size above the MTU is 0x6801 (before H8)', () => {
    expect(swOf(buildBody({ instrSz: 32704 - 112 + 1 }))).toBe(StatusWord.TXN_INVALID_FORMAT);
    expect(swOf(buildBody({ rwCnt: 1000, roCnt: 100 }))).toBe(StatusWord.TXN_INVALID_FORMAT);
    expect(swOf(buildBody({ instrSz: 32704 - 112 - 40, flags: 1 }))).toBe(StatusWord.TXN_INVALID_FORMAT);
  });

  it('H9 rejects rw > 32 only together with ro > 0', () => {
    const rw = Array.from({ length: 33 }, (_, i) => key(0x20 + i));
    expect(swOf(buildBody({ rw }))).toBe('ok');
    expect(swOf(buildBody({ rw, ro: [key(0x90)] }))).toBe(StatusWord.TXN_RW_CACHE_EXCEEDED);
    expect(swOf(buildBody({ rw: rw.slice(0, 32), ro: [key(0x90)] }))).toBe('ok');
  });
});

describe('account checks R1-R3, O1-O4', () => {
  it('rw: duplicates, ordering, fee payer/program', () => {
    expect(swOf(buildBody({ rw: [key(1), key(1)] }))).toBe(StatusWord.TXN_DUPLICATE_ACCOUNT);
    expect(swOf(buildBody({ rw: [key(2), key(1)] }))).toBe(StatusWord.TXN_UNSORTED_RW);
    expect(swOf(buildBody({ rw: [PUBKEY0] }))).toBe(StatusWord.TXN_DUPLICATE_ACCOUNT);
    expect(swOf(buildBody({ rw: [EOA_PROGRAM] }))).toBe(StatusWord.TXN_DUPLICATE_ACCOUNT);
  });

  it('ro: duplicates, ordering, fee payer/program, rw overlap', () => {
    expect(swOf(buildBody({ ro: [key(1), key(1)] }))).toBe(StatusWord.TXN_DUPLICATE_ACCOUNT);
    expect(swOf(buildBody({ ro: [key(2), key(1)] }))).toBe(StatusWord.TXN_UNSORTED_RO);
    expect(swOf(buildBody({ ro: [EOA_PROGRAM] }))).toBe(StatusWord.TXN_DUPLICATE_ACCOUNT);
    expect(swOf(buildBody({ rw: [key(1), key(5), key(9)], ro: [key(2), key(5)] }))).toBe(
      StatusWord.TXN_DUPLICATE_ACCOUNT,
    );
    expect(swOf(buildBody({ rw: [key(1), key(5), key(9)], ro: [key(2), key(6), key(10)] }))).toBe('ok');
  });

  it('memcmp ordering compares unsigned bytes', () => {
    expect(swOf(buildBody({ rw: [key(0x7f), key(0x80)] }))).toBe('ok');
    expect(swOf(buildBody({ rw: [key(0x80), key(0x7f)] }))).toBe(StatusWord.TXN_UNSORTED_RW);
  });
});

describe('fee-payer proof P1-P2 and Done', () => {
  it('EXISTING proof needs the 64-byte meta', () => {
    const proof = buildProof(0, 3);
    expect(swOf(buildBody({ proof, meta: new Uint8Array(64) }))).toBe('ok');
    expect(swOf(buildBody({ proof }))).toBe(StatusWord.TXN_INVALID_FORMAT);
    const r = parseTransactionBody(buildBody({ proof, meta: new Uint8Array(64) }), PUBKEY0);
    expect(r.ok && r.proofType).toBe(0);
  });

  it('CREATION proof has no meta', () => {
    const proof = buildProof(2, 5);
    expect(swOf(buildBody({ proof }))).toBe('ok');
    expect(swOf(buildBody({ proof, meta: new Uint8Array(64) }))).toBe(StatusWord.TXN_INVALID_FORMAT);
  });

  it('UPDATING and type 3 are rejected at the proof header', () => {
    expect(swOf(buildBody({ proof: buildProof(1, 2) }))).toBe(StatusWord.TXN_INVALID_PROOF_TYPE);
    expect(swOf(buildBody({ proof: buildProof(3, 2) }))).toBe(StatusWord.TXN_INVALID_PROOF_TYPE);
  });

  it('proof sizes are derived from popcount and bounded by the MTU', () => {
    const instr = new Uint8Array(32704 - 112 - 40 - 256 * 32 + 1);
    expect(swOf(buildBody({ instr, proof: buildProof(0, 255), meta: new Uint8Array(64) }))).toBe(
      StatusWord.TXN_INVALID_FORMAT,
    );
  });

  it('trailing and truncated bodies are 0x6801', () => {
    const body = buildBody();
    expect(swOf(new Uint8Array([...body, 0]))).toBe(StatusWord.TXN_INVALID_FORMAT);
    expect(swOf(body.subarray(0, 111))).toBe(StatusWord.TXN_INVALID_FORMAT);
    expect(swOf(buildBody({ instrSz: 10 }))).toBe(StatusWord.TXN_INVALID_FORMAT);
  });

  it('a dead parser keeps returning its first failure', () => {
    const p = new TxnStreamParser({ derivedPubkey: PUBKEY0 });
    const f = p.feed(new Uint8Array([9]));
    expect(p.feed(new Uint8Array([1]))).toBe(f);
    expect(p.finish()).toMatchObject({ ok: false, sw: StatusWord.TXN_INVALID_VERSION });
  });
});

describe('chunking invariance (§3.4)', () => {
  const bodies = [
    buildBody(),
    buildBody({ rw: [key(1), key(3)], ro: [key(2)], instr: new Uint8Array(300).fill(7) }),
    buildBody({ rw: [key(1)], proof: buildProof(0, 4), meta: new Uint8Array(64).fill(3) }),
    buildBody({ rw: [key(2), key(1)] }),
    buildBody({ pad: 1 }),
    buildBody({ proof: buildProof(1, 1) }),
  ];

  it.each(bodies.map((b, i) => [i, b] as const))('body %i gives one verdict for every chunk size', (_i, body) => {
    const reference = parseTransactionBody(body, PUBKEY0);
    for (let size = 1; size <= 255; size++) {
      const r = streamed(body, size);
      expect(r.ok).toBe(reference.ok);
      if (r.ok && reference.ok) expect(toHex(r.bodyHash)).toBe(toHex(reference.bodyHash));
      if (!r.ok && !reference.ok) expect(r.sw).toBe(reference.sw);
    }
  });
});
