/**
 * `decodeClearTransfer` edge cases, mirroring the device's
 * `thru-ledger-parser/src/transfer_tests.rs`. Cross-language parity with the
 * device is in `device-review.test.ts`.
 */
import { WALLET_PROGRAM_ADDRESS } from '@thru/sdk';
import { decodeAddress } from '@thru/sdk/helpers';
import { describe, expect, it } from 'vitest';
import { decodeAddress } from '@thru/sdk/helpers';
import { WALLET_PROGRAM_ADDRESS } from '@thru/sdk';

import {
  decodeClearTransfer,
  describeTransaction,
  EOA_PROGRAM,
  fromHex,
  RO_CACHE_MAX,
  thruAddress,
  TOKEN_PROGRAM,
  toHex,
} from '../protocol';
import { buildBody, key, PUBKEY0 } from './helpers/fixtures';

const RW = [key(0x30), key(0x31), key(0x32)];

function eoaInstr(recipient: number, opts: { tag?: number; from?: number; amount?: bigint } = {}): Uint8Array {
  const out = new Uint8Array(16);
  const v = new DataView(out.buffer);
  v.setUint32(0, opts.tag ?? 1, true);
  v.setBigUint64(4, opts.amount ?? 5n, true);
  v.setUint16(12, opts.from ?? 0, true);
  v.setUint16(14, recipient, true);
  return out;
}

function walletInstr(wallet: number, recipient: number, authority: number): Uint8Array {
  const out = new Uint8Array(95);
  const v = new DataView(out.buffer);
  out[0] = 1;
  v.setUint16(1, wallet, true);
  out[3] = authority;
  v.setUint16(72, 1, true);
  v.setBigUint64(74, 13n, true);
  out[82] = 2;
  v.setUint16(83, wallet, true);
  v.setUint16(85, recipient, true);
  v.setBigUint64(87, 7n, true);
  return out;
}

const eoa = (instr: Uint8Array, rw = RW, ro: Uint8Array[] = []): Uint8Array =>
  buildBody({ program: EOA_PROGRAM, rw, ro, instr });
const wallet = (instr: Uint8Array): Uint8Array => buildBody({ program: decodeAddress(WALLET_PROGRAM_ADDRESS), rw: RW, instr });

describe('decodeClearTransfer: native', () => {
  it('debits the fee payer and resolves the recipient', () => {
    const t = decodeClearTransfer(eoa(eoaInstr(3)))!;
    expect(t.kind).toBe('native');
    expect(toHex(t.source)).toBe(toHex(PUBKEY0));
    expect(toHex(t.recipient)).toBe(toHex(RW[1]));
    expect(t.amount).toBe(5n);
    expect(t.authorityIndex).toBeNull();
  });

  it('resolves index 0 to the fee payer', () => {
    expect(toHex(decodeClearTransfer(eoa(eoaInstr(0)))!.recipient)).toBe(toHex(PUBKEY0));
  });

  it.each([
    ['another discriminant', eoaInstr(3, { tag: 2 })],
    ['a source other than the fee payer', eoaInstr(3, { from: 2 })],
    ['the program as recipient', eoaInstr(1)],
    ['an index past the accounts', eoaInstr(5)],
  ])('stays blind for %s', (_name, instr) => {
    expect(decodeClearTransfer(eoa(instr))).toBeNull();
  });

  it('stays blind for a read-only recipient', () => {
    expect(decodeClearTransfer(eoa(eoaInstr(3), [RW[0]], [RW[1]]))).toBeNull();
  });

  it('resolves only the first 32 read-write accounts', () => {
    const rw = Array.from({ length: 33 }, (_, i) => key(0x40 + i));
    expect(decodeClearTransfer(eoa(eoaInstr(33), rw))).not.toBeNull();
    expect(decodeClearTransfer(eoa(eoaInstr(34), rw))).toBeNull();
  });
});

describe('decodeClearTransfer: wallet', () => {
  it('debits the wallet and reports the authority index', () => {
    const body = buildBody({ program: decodeAddress(WALLET_PROGRAM_ADDRESS), rw: RW, instr: walletInstr(2, 4, 9) });
    const t = decodeClearTransfer(body)!;
    expect(t.kind).toBe('wallet');
    expect(toHex(t.source)).toBe(toHex(RW[0]));
    expect(toHex(t.recipient)).toBe(toHex(RW[2]));
    expect(t.amount).toBe(7n);
    expect(t.authorityIndex).toBe(9);
  });

  it('does not clear-sign a transfer to the retired wallet program', () => {
    const program = fromHex('5802cb113ac63fd984c314d146e4ab92928de1ec1693c61ceb3b462814b49d99');
    const body = buildBody({ program, rw: RW, instr: walletInstr(2, 4, 9) });
    expect(decodeClearTransfer(body)).toBeNull();
    expect(describeTransaction(body, PUBKEY0).requiresBlindSigning).toBe(true);
  });

  const mutate = (offset: number, value: number): Uint8Array => {
    const instr = walletInstr(2, 4, 0);
    instr[offset] = value;
    return instr;
  };

  it.each([
    ['a non-zero signature byte', mutate(4, 1)],
    ['non-empty authenticator data', mutate(68, 1)],
    ['non-empty client data', mutate(70, 1)],
    ['a call to another program index', mutate(72, 2)],
    ['a child call of another size', mutate(74, 14)],
    ['a child instruction other than Transfer', mutate(82, 3)],
    ['a child transfer from another account', mutate(83, 3)],
    ['the fee payer as the wallet', walletInstr(0, 4, 0)],
  ])('stays blind for %s', (_name, instr) => {
    expect(decodeClearTransfer(wallet(instr))).toBeNull();
  });
});

/** TransferChecked from RW[0] to RW[1]; the mint index names `ro[mintSlot]`. */
function checkedInstr(
  opts: { decimals?: number; ticker?: number[]; tickerLen?: number; mintSlot?: number; source?: number; recipient?: number } = {},
): Uint8Array {
  const ticker = opts.ticker ?? [...'USDC'].map((c) => c.charCodeAt(0));
  const out = new Uint8Array(25);
  const v = new DataView(out.buffer);
  out[0] = 8;
  v.setUint16(1, opts.source ?? 2, true);
  v.setUint16(3, opts.recipient ?? 3, true);
  v.setUint16(5, 2 + RW.length + (opts.mintSlot ?? 0), true);
  v.setBigUint64(7, 250_000n, true);
  out[15] = opts.decimals ?? 6;
  out[16] = opts.tickerLen ?? ticker.length;
  out.set(ticker.slice(0, 8), 17);
  return out;
}

const ro = (n: number): Uint8Array[] => Array.from({ length: n }, (_, i) => key(0x60 + i));
const checked = (instr: Uint8Array, roKeys = ro(1)): Uint8Array =>
  buildBody({ program: TOKEN_PROGRAM, rw: RW, ro: roKeys, instr });
const chars = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));

describe('decodeClearTransfer: TransferChecked', () => {
  it('names the read-only mint and the decimals and ticker', () => {
    const t = decodeClearTransfer(checked(checkedInstr()))!;
    expect(t.kind).toBe('token');
    expect(toHex(t.source)).toBe(toHex(RW[0]));
    expect(toHex(t.recipient)).toBe(toHex(RW[1]));
    expect(t.amount).toBe(250_000n);
    expect(t.authorityIndex).toBeNull();
    expect(t.checked).toEqual({ mint: key(0x60), decimals: 6, ticker: 'USDC' });
  });

  it('resolves only the first RO_CACHE_MAX read-only accounts', () => {
    for (let roCnt = 1; roCnt <= RO_CACHE_MAX + 2; roCnt++) {
      for (let slot = 0; slot < roCnt; slot++) {
        const t = decodeClearTransfer(checked(checkedInstr({ mintSlot: slot }), ro(roCnt)));
        if (slot < RO_CACHE_MAX) expect(toHex(t!.checked!.mint), `${roCnt}/${slot}`).toBe(toHex(key(0x60 + slot)));
        else expect(t, `${roCnt}/${slot}`).toBeNull();
      }
    }
  });

  it.each([
    ['the fee payer as the mint', { mintSlot: -5 }],
    ['the program as the mint', { mintSlot: -4 }],
    ['a writable account as the mint', { mintSlot: -3 }],
    ['a mint past the accounts', { mintSlot: 1 }],
    ['20 decimals', { decimals: 20 }],
    ['ticker_len 9', { ticker: chars('ABCDEFGH'), tickerLen: 9 }],
    ['a space in the ticker', { ticker: chars('US C') }],
    ['DEL in the ticker', { ticker: [0x55, 0x53, 0x7f, 0x43] }],
    ['NUL in the ticker', { ticker: [0x55, 0x53, 0x00, 0x43] }],
    ['a byte above 0x7e', { ticker: [0x55, 0x53, 0x80, 0x43] }],
    ['a byte after the ticker', { ticker: chars('USDCX'), tickerLen: 4 }],
    ['the fee payer as the source', { source: 0 }],
    ['the read-only mint as the recipient', { recipient: 5 }],
  ])('stays blind for %s', (_name, opts) => {
    expect(decodeClearTransfer(checked(checkedInstr(opts)))).toBeNull();
  });

  it.each([
    ['an empty ticker', [], 0, ''],
    ['an 8-character ticker', chars('ABCDEFGH'), 19, 'ABCDEFGH'],
    ['the printable edges', [0x21, 0x7e], 0, '!~'],
  ])('shows %s', (_name, ticker, decimals, shown) => {
    expect(decodeClearTransfer(checked(checkedInstr({ ticker, decimals })))!.checked!.ticker).toBe(shown);
  });

  it('stays blind for 24 and 26 bytes', () => {
    const instr = checkedInstr();
    expect(decodeClearTransfer(checked(instr.subarray(0, 24)))).toBeNull();
    expect(decodeClearTransfer(checked(new Uint8Array([...instr, 0])))).toBeNull();
  });

  it('leaves the plain Transfer without a mint', () => {
    const instr = new Uint8Array(13);
    const v = new DataView(instr.buffer);
    instr[0] = 2;
    v.setUint16(1, 2, true);
    v.setUint16(3, 3, true);
    expect(decodeClearTransfer(checked(instr))!.checked).toBeNull();
  });

  it('shows the ticker in its own field after the amount, and none when empty', () => {
    const labels = (ticker: string): string[] =>
      describeTransaction(checked(checkedInstr({ ticker: chars(ticker) })), PUBKEY0).fields
        .slice(3, 6)
        .map((f) => `${f.label}=${f.value}`);
    const mint = `Token mint=${thruAddress(key(0x60))}`;
    expect(labels('000USD')).toEqual(['Amount=0.25', 'Ticker=000USD', mint]);
    expect(labels('')).toEqual(['Amount=0.25', mint, 'Address type=Token accounts']);
  });
});
