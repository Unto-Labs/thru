/**
 * Canonical transfers the device reviews without blind signing
 * (`specs/ledger/app-thru-apdu.md` §7.7). A port of the device app's
 * `thru-ledger-parser/src/transfer.rs`: any other instruction shape is a
 * blind-signed transaction and needs the app's blind-signing setting.
 */
import { bytesEqual, fromHex } from './bytes';
import { PUBKEY_SZ, RO_CACHE_MAX, RW_CACHE_MAX, TICKER_MAX, TOKEN_DECIMALS_MAX, TXN_HDR_SZ } from './constants';

/** EOA program, `taEOApimkowJve0JG2gZqRXJj84GwzB9QmkNAJUFoxykj2`. */
export const EOA_PROGRAM: Uint8Array = fromHex('10e0298a6928c09bded091b6819a915c98fce06c3307d42690d009505a31ca48');

/** Token program, `taTOKEN7TE2HRGzqz7EjLibc6ieCwuXys5Bhb2-Sq8ZZ_1`. */
export const TOKEN_PROGRAM: Uint8Array = fromHex('4ce28437b4c4d87446ceacfb1232e26dcea2782c2e5f2b390616f6f92abc659f');

/** Wallet program, `taPASSIvjIgz2kZ1CIIhvbT00XV9Ve5kZ2I9uDLanzIgbA`. */
export const WALLET_PROGRAM: Uint8Array = fromHex('3c049222f8c8833da4675088221bdb4f4d1757d55ee6467623db832da9f32206');

export type ClearTransferKind = 'native' | 'token' | 'wallet';

/**
 * What a checked token transfer (TransferChecked) names: the mint, and the
 * decimals and ticker the token program checks against it (the transfer
 * reverts unless they match), so the device shows the amount in whole units.
 */
export interface CheckedToken {
  /** The mint, one of the first {@link RO_CACHE_MAX} read-only accounts. */
  readonly mint: Uint8Array;
  /** Decimals of the amount, at most {@link TOKEN_DECIMALS_MAX}. */
  readonly decimals: number;
  /** 0 to {@link TICKER_MAX} printable ASCII characters without space. */
  readonly ticker: string;
}

/** A transfer the device reviews in clear, with resolved account addresses. */
export interface ClearTransfer {
  /**
   * `native`: THRU from the fee payer. `token`: token base units between token
   * accounts (a Transfer, or a TransferChecked when `checked` is set).
   * `wallet`: THRU from a wallet.
   */
  readonly kind: ClearTransferKind;
  /** Debited account (a token account for `token`). */
  readonly source: Uint8Array;
  /** Credited account (a token account for `token`). */
  readonly recipient: Uint8Array;
  /** THRU base units, or raw token base units for `token`. */
  readonly amount: bigint;
  /** Wallet authority selected by Validate; `null` unless `kind` is `wallet`. */
  readonly authorityIndex: number | null;
  /** The token a TransferChecked moves; `null` for every other transfer. */
  readonly checked: CheckedToken | null;
}

const EOA_TRANSFER_SZ = 16;
const TOKEN_TRANSFER_SZ = 13;
/** Tag, source, recipient, mint, amount, decimals, ticker length, ticker. */
const TOKEN_TRANSFER_CHECKED_SZ = 25;

/** Printable ASCII without space: the ticker bytes the device shows. */
const isTickerByte = (b: number): boolean => b >= 0x21 && b <= 0x7e;
/** Validate tag, wallet, authority, zero signature and lengths, one 13-byte self-call to Transfer. */
const WALLET_TRANSFER_SZ = 95;

/**
 * The clear transfer in a structurally valid body (check it with
 * `parseTransactionBody` first), or `null` when the device would show the
 * blind-signing review:
 *
 * - EOA program, 16 bytes: `u32 1`, `u64 amount`, `u16 source = 0`, `u16 recipient`.
 * - Token program, 13 bytes: `u8 2`, `u16 source`, `u16 recipient`, `u64 amount`; both indices ≥ 2.
 * - Token program, 25 bytes (TransferChecked): `u8 8`, `u16 source`, `u16 recipient`, `u16 mint`,
 *   `u64 amount`, `u8 decimals`, `u8 ticker_len`, `ticker[8]`; source and recipient ≥ 2; the mint
 *   one of the first {@link RO_CACHE_MAX} read-only accounts; `decimals` ≤ {@link TOKEN_DECIMALS_MAX};
 *   `ticker_len` ≤ 8, the ticker printable ASCII without space (`0x21..0x7e`) and zero after
 *   `ticker_len`.
 * - Wallet program, 95 bytes: Validate (`u8 1`, `u16 wallet ≥ 2`, `u8 authority`, 68 zero bytes of
 *   signature and WebAuthn lengths) calling program index 1 with a 13-byte Transfer (`u8 2`,
 *   `u16 wallet`, `u16 recipient`, `u64 amount`) from the same wallet.
 *
 * Both accounts must be writable (the fee payer or a read-write account) and
 * resolve to the fee payer or one of the first {@link RW_CACHE_MAX}
 * read-write accounts. All integers are little-endian.
 */
export function decodeClearTransfer(body: Uint8Array): ClearTransfer | null {
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const rwCnt = view.getUint16(2, true);
  const roCnt = view.getUint16(4, true);
  const instrSz = view.getUint16(6, true);
  const program = body.subarray(80, 112);
  const at = TXN_HDR_SZ + PUBKEY_SZ * (rwCnt + roCnt);
  const u16 = (offset: number): number => view.getUint16(at + offset, true);
  const u64 = (offset: number): bigint => view.getBigUint64(at + offset, true);

  let kind: ClearTransferKind;
  let source: number;
  let recipient: number;
  let amount: bigint;
  let authorityIndex: number | null = null;
  let checked: CheckedToken | null = null;
  if (bytesEqual(program, EOA_PROGRAM) && instrSz === EOA_TRANSFER_SZ) {
    if (view.getUint32(at, true) !== 1 || u16(12) !== 0) return null;
    kind = 'native';
    source = 0;
    recipient = u16(14);
    amount = u64(4);
  } else if (bytesEqual(program, TOKEN_PROGRAM) && instrSz === TOKEN_TRANSFER_CHECKED_SZ && body[at] === 8) {
    kind = 'token';
    source = u16(1);
    recipient = u16(3);
    amount = u64(7);
    if (source < 2 || recipient < 2) return null;
    /* The device keeps only the first RO_CACHE_MAX read-only keys. */
    const slot = u16(5) - 2 - rwCnt;
    if (slot < 0 || slot >= roCnt || slot >= RO_CACHE_MAX) return null;
    const decimals = body[at + 15];
    const tickerLen = body[at + 16];
    if (decimals > TOKEN_DECIMALS_MAX || tickerLen > TICKER_MAX) return null;
    const tickerField = body.subarray(at + 17, at + 17 + TICKER_MAX);
    const shown = tickerField.subarray(0, tickerLen);
    if (!shown.every(isTickerByte) || tickerField.subarray(tickerLen).some((b) => b !== 0)) return null;
    const mintAt = TXN_HDR_SZ + PUBKEY_SZ * (rwCnt + slot);
    checked = {
      mint: body.slice(mintAt, mintAt + PUBKEY_SZ),
      decimals,
      ticker: String.fromCharCode(...shown),
    };
  } else if (bytesEqual(program, TOKEN_PROGRAM) && instrSz === TOKEN_TRANSFER_SZ && body[at] === 2) {
    kind = 'token';
    source = u16(1);
    recipient = u16(3);
    amount = u64(5);
    /* The fee payer and the program are not token accounts. */
    if (source < 2 || recipient < 2) return null;
  } else if (bytesEqual(program, WALLET_PROGRAM) && instrSz === WALLET_TRANSFER_SZ && body[at] === 1) {
    if (body.subarray(at + 4, at + 72).some((b) => b !== 0)) return null;
    if (u16(72) !== 1 || u64(74) !== BigInt(TOKEN_TRANSFER_SZ) || body[at + 82] !== 2) return null;
    kind = 'wallet';
    source = u16(1);
    if (source < 2 || u16(83) !== source) return null;
    recipient = u16(85);
    amount = u64(87);
    authorityIndex = body[at + 3];
  } else {
    return null;
  }

  const resolve = (index: number): Uint8Array | null => {
    if (index === 0) return body.slice(48, 80);
    const slot = index - 2;
    if (slot < 0 || slot >= rwCnt || slot >= RW_CACHE_MAX) return null;
    const offset = TXN_HDR_SZ + PUBKEY_SZ * slot;
    return body.slice(offset, offset + PUBKEY_SZ);
  };
  const sourceKey = resolve(source);
  const recipientKey = resolve(recipient);
  if (sourceKey === null || recipientKey === null) return null;
  return { kind, source: sourceKey, recipient: recipientKey, amount, authorityIndex, checked };
}
