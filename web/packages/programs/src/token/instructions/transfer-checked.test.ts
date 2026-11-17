import { describe, expect, it } from 'vitest';
import { TickerField, TokenInstruction } from '../abi/thru/program/token/types';
import type { AccountLookupContext, TransferCheckedArgs } from '../types';
import { createTransferCheckedInstruction } from './transfer-checked';

const source = new Uint8Array(32).fill(3);
const destination = new Uint8Array(32).fill(4);
const mint = new Uint8Array(32).fill(1);

/* Source and destination are read-write (2, 3); the mint is read-only (4). */
const context: AccountLookupContext = {
  getAccountIndex: (pubkey) => {
    if (pubkey === source) return 2;
    if (pubkey === destination) return 3;
    if (pubkey === mint) return 4;
    throw new Error('unexpected account lookup');
  },
};

const args: TransferCheckedArgs = {
  sourceAccountBytes: source,
  destinationAccountBytes: destination,
  mintAccountBytes: mint,
  amount: 1_000_000n,
  decimals: 6,
  ticker: 'USDC',
};

const build = (overrides: Partial<TransferCheckedArgs> = {}) =>
  createTransferCheckedInstruction({ ...args, ...overrides })(context);

describe('createTransferCheckedInstruction', () => {
  it('encodes the 25-byte wire layout', async () => {
    expect(await build()).toEqual(
      new Uint8Array([
        0x08, // tag
        0x02, 0x00, // source_account_index
        0x03, 0x00, // dest_account_index
        0x04, 0x00, // mint_account_index
        0x40, 0x42, 0x0f, 0x00, 0x00, 0x00, 0x00, 0x00, // amount
        0x06, // decimals
        0x04, // ticker length
        0x55, 0x53, 0x44, 0x43, 0x00, 0x00, 0x00, 0x00, // ticker bytes "USDC"
      ])
    );
  });

  it('round-trips through the generated instruction view', async () => {
    const encoded = await build({ amount: 0xffff_ffff_ffff_ffffn });

    expect(TokenInstruction.validate(encoded)).toMatchObject({ ok: true, consumed: 25 });
    const view = TokenInstruction.from_array(encoded);
    expect(view?.get_tag()).toBe(8);
    expect(view?.payloadVariant()?.name).toBe('transfer_checked');
    const checked = view?.payload().asTransferChecked();
    expect(checked?.get_source_account_index()).toBe(2);
    expect(checked?.get_dest_account_index()).toBe(3);
    expect(checked?.get_mint_account_index()).toBe(4);
    expect(checked?.get_amount()).toBe(0xffff_ffff_ffff_ffffn);
    expect(checked?.get_decimals()).toBe(6);
    expect(checked?.get_ticker().get_length()).toBe(4);
    expect(checked?.get_ticker().get_bytes()).toEqual([0x55, 0x53, 0x44, 0x43, 0, 0, 0, 0]);
  });

  it('encodes a string ticker as given, without trimming or upper-casing', async () => {
    const encoded = await build({ ticker: ' usdc' });

    expect(Array.from(encoded.subarray(16))).toEqual([5, 0x20, 0x75, 0x73, 0x64, 0x63, 0, 0, 0]);
  });

  it('accepts the stored ticker bytes', async () => {
    const stored = Uint8Array.of(0xde, 0xad, 0xbe, 0xef, 0x00, 0x01, 0x02, 0xff);
    const encoded = await build({ ticker: stored });

    expect(Array.from(encoded.subarray(16))).toEqual([8, ...stored]);
  });

  it('reproduces a stored ticker field whose length covers a trailing zero byte', async () => {
    /* "EVECOIN" stored with length 8: display text drops the last byte. */
    const storedField = Uint8Array.of(8, 0x45, 0x56, 0x45, 0x43, 0x4f, 0x49, 0x4e, 0x00);
    const field = TickerField.from_array(storedField);
    if (!field) throw new Error('ticker field did not parse');

    const ticker = Uint8Array.from(field.get_bytes()).subarray(0, field.get_length());
    const encoded = await build({ ticker });

    expect(encoded.subarray(16)).toEqual(storedField);
  });

  it('encodes an empty ticker', async () => {
    const encoded = await build({ ticker: '' });

    expect(Array.from(encoded.subarray(16))).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('counts UTF-8 bytes, not characters', async () => {
    const encoded = await build({ ticker: '€x' });

    expect(Array.from(encoded.subarray(16))).toEqual([4, 0xe2, 0x82, 0xac, 0x78, 0, 0, 0, 0]);
    expect(() => createTransferCheckedInstruction({ ...args, ticker: '€€€' })).toThrow(
      'Ticker must be 8 characters or less'
    );
  });

  it('rejects a ticker longer than 8 bytes', () => {
    expect(() => createTransferCheckedInstruction({ ...args, ticker: 'TOOLONG99' })).toThrow(
      'Ticker must be 8 characters or less'
    );
    expect(() => createTransferCheckedInstruction({ ...args, ticker: new Uint8Array(9) })).toThrow(
      'Ticker must be 8 characters or less'
    );
  });

  it('rejects decimals that do not fit one byte', () => {
    for (const decimals of [-1, 256, 1.5, Number.NaN]) {
      expect(() => createTransferCheckedInstruction({ ...args, decimals })).toThrow(
        'Decimals must be an integer between 0 and 255'
      );
    }
  });
});
