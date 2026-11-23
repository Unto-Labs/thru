/**
 * Host-side previews that match the device screens byte for byte
 * (`specs/ledger/app-thru-apdu.md` §7.7, §8.6, §9.4, Appendix B). A wallet
 * shows these before the device prompt so the user can compare (§11.3).
 */
import { sha256 } from '@noble/hashes/sha2.js';
import { encodeAddress } from '@thru/sdk/helpers';

import { FeePayerMismatchError, MalformedTransactionError } from '../errors';
import { bytesEqual, fromHex, toHex } from './bytes';
import {
  EoaAuthKind,
  FEE_WARN_THRESHOLD,
  MSG_DISPLAY_MAX,
  PUBKEY_SZ,
  THRU_DECIMALS,
  TOKEN_DECIMALS_MAX,
} from './constants';
import { StatusWord } from './status-words';
import { type TokenHint, type TokenIdentity, verifyTokenHint } from './token-hint';
import { type CheckedToken, type ClearTransfer, decodeClearTransfer } from './transfer';
import { parseTransactionBody, type TxnHeader } from './txn-parser';
import { normalizeEoaAuthKind, type EoaAuthKindInput } from './apdu';

/** B.4: 64 lowercase hex characters, no prefix. */
export function hashDisplay(digest: Uint8Array): string {
  return toHex(digest);
}

/**
 * The "Transaction hash" the device shows for SIGN_TXN: lowercase hex
 * SHA-256 of the body (the wire bytes without the trailing signature).
 */
export function computeBodyHashDisplay(body: Uint8Array): string {
  return hashDisplay(sha256(body));
}

/** The "Message hash" the device shows in hash mode: SHA-256 of the raw message (no DST). */
export function computeMessageHashDisplay(message: Uint8Array): string {
  return hashDisplay(sha256(message));
}

const U64_MAX = (1n << 64n) - 1n;

/**
 * A u64 base-unit amount in whole units with `decimals` (0 to
 * {@link TOKEN_DECIMALS_MAX}) fractional digits, trailing zeros removed and
 * no unit: `1500000000, 9` → `"1.5"`.
 */
export function formatAmount(baseUnits: bigint, decimals: number): string {
  if (baseUnits < 0n || baseUnits > U64_MAX) throw new RangeError('amount must be a u64');
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > TOKEN_DECIMALS_MAX) {
    throw new RangeError(`decimals must be 0 to ${TOKEN_DECIMALS_MAX}`);
  }
  const unit = 10n ** BigInt(decimals);
  const whole = baseUnits / unit;
  const frac = baseUnits % unit;
  if (frac === 0n) return whole.toString();
  return `${whole}.${frac.toString().padStart(decimals, '0').replace(/0+$/, '')}`;
}

/** B.2: base units to a THRU string, for example `1000` → `"0.000001 THRU"`. */
export function formatThruAmount(baseUnits: bigint): string {
  return `${formatAmount(baseUnits, THRU_DECIMALS)} THRU`;
}

/**
 * B.7: the amount of a checked token transfer in whole units (`"0.25"`). The
 * ticker is never appended: the device shows it in its own `Ticker` field,
 * because a mint's creator chooses it and could make it read as part of the
 * number (`000USD`).
 */
export function formatTokenAmount(baseUnits: bigint, token: Pick<CheckedToken, 'decimals'>): string {
  return formatAmount(baseUnits, token.decimals);
}

/** B.3: network label for a chain id. */
export function networkLabel(chainId: number): string {
  if (chainId === 1) return 'alphanet';
  if (chainId === 2) return 'betanet';
  return `chain id ${chainId}`;
}

/** B.5: known-program labels, matched by exact 32-byte equality. */
export const KNOWN_PROGRAMS: ReadonlyArray<{ readonly label: string; readonly address: string; readonly bytes: Uint8Array }> =
  Object.freeze(
    (
      [
        ['EOA', 'taEOApimkowJve0JG2gZqRXJj84GwzB9QmkNAJUFoxykj2', '10e0298a6928c09bded091b6819a915c98fce06c3307d42690d009505a31ca48'],
        ['Token', 'taTOKEN7TE2HRGzqz7EjLibc6ieCwuXys5Bhb2-Sq8ZZ_1', '4ce28437b4c4d87446ceacfb1232e26dcea2782c2e5f2b390616f6f92abc659f'],
        ['Multicall', 'taMULTIsEUjoNbAJ13_s5LGWnqJg3-HjHZqeM_vukdrOm9', '3142d322c1148e835b009d77fece4b1969ea260dfe1e31d9a9e33fbee91dace9'],
        ['Wallet', 'taPASSIvjIgz2kZ1CIIhvbT00XV9Ve5kZ2I9uDLanzIgbA', '3c049222f8c8833da4675088221bdb4f4d1757d55ee6467623db832da9f32206'],
        ['Compression', 'taCOMPyXTPshiN6_to2P0L05lyH0GIx7DEHfROiMVzPiUO', '08e30fc974cfb2188debfb68d8fd0bd399721f4188c7b0c41df44e88c5733e25'],
      ] as const
    ).map(([label, address, hex]) => Object.freeze({ label, address, bytes: fromHex(hex) })),
  );

export function knownProgramLabel(program: Uint8Array): string | null {
  for (const p of KNOWN_PROGRAMS) {
    if (bytesEqual(p.bytes, program)) return p.label;
  }
  return null;
}

/** B.1: the `ta…` address of a 32-byte public key. */
export function thruAddress(pubkey: Uint8Array): string {
  if (pubkey.length !== PUBKEY_SZ) throw new Error('pubkey must be 32 bytes');
  return encodeAddress(pubkey);
}

export interface ReviewField {
  readonly label: string;
  readonly value: string;
}

export interface TransactionReview {
  /**
   * The fields in device order (§7.7): the transfer fields when the device
   * recognizes a transfer, then the envelope fields. When `highFee` is set
   * the envelope includes the device's `High fee` field right after `Fee`.
   */
  readonly fields: readonly ReviewField[];
  /** The transfer the device reviews in clear, or `null` for a blind-signed transaction. */
  readonly transfer: ClearTransfer | null;
  /** Mint and owners shown for a token transfer with a verified `tokenHint`. */
  readonly tokenIdentity: TokenIdentity | null;
  /**
   * `transfer === null`: the device shows Ledger's blind-signing review and
   * needs the app's blind-signing setting.
   */
  readonly requiresBlindSigning: boolean;
  /** `fee > FEE_WARN_THRESHOLD`: the device shows a "High fee" field after `Fee`. */
  readonly highFee: boolean;
  /** Same as the `Transaction hash` field. */
  readonly transactionHash: string;
  readonly header: TxnHeader;
  readonly bodyLength: number;
}

/** Label of the device's high-fee field (§7.7 row 4). */
export const HIGH_FEE_LABEL = 'High fee';

/** The device's high-fee text, `"Fee is above <FEE_WARN_THRESHOLD as THRU>"`. */
export function highFeeWarning(): string {
  return `Fee is above ${formatThruAmount(FEE_WARN_THRESHOLD)}`;
}

function saturatingAddU64(a: bigint, b: bigint): bigint {
  const sum = a + b;
  return sum > U64_MAX ? U64_MAX : sum;
}

export interface DescribeTransactionOptions {
  /** The token hint that will be sent with the transaction (§7.2.1). */
  readonly tokenHint?: TokenHint;
}

const TRANSFER_ACTIONS = {
  native: 'Native transfer',
  token: 'Token transfer',
  wallet: 'Wallet transfer',
} as const;

/** The device's transfer fields (app-thru review.rs), shown before the envelope. */
function transferFields(transfer: ClearTransfer, token: TokenIdentity | null): ReviewField[] {
  const isToken = transfer.kind === 'token';
  const fields: ReviewField[] = [
    { label: 'Action', value: TRANSFER_ACTIONS[transfer.kind] },
    { label: 'Source', value: thruAddress(token?.sourceOwner ?? transfer.source) },
    { label: 'Recipient', value: thruAddress(token?.recipientOwner ?? transfer.recipient) },
  ];
  if (transfer.checked !== null) {
    /* The transaction names the mint and binds the decimals and ticker. */
    fields.push({ label: 'Amount', value: formatTokenAmount(transfer.amount, transfer.checked) });
    if (transfer.checked.ticker !== '') fields.push({ label: 'Ticker', value: transfer.checked.ticker });
    fields.push({ label: 'Token mint', value: thruAddress(transfer.checked.mint) });
    fields.push({ label: 'Address type', value: token !== null ? 'Token account owners' : 'Token accounts' });
    return fields;
  }
  fields.push(
    isToken
      ? { label: 'Amount (base units)', value: transfer.amount.toString() }
      : { label: 'Amount', value: formatThruAmount(transfer.amount) },
  );
  if (isToken && token !== null) {
    fields.push({ label: 'Token mint', value: thruAddress(token.mint) });
    fields.push({ label: 'Address type', value: 'Token account owners' });
  } else if (isToken) {
    fields.push({ label: 'Address type', value: 'Token accounts' });
    fields.push({ label: 'Token identity', value: 'Not provided by transaction' });
  }
  if (transfer.authorityIndex !== null) {
    fields.push({ label: 'Authority index', value: transfer.authorityIndex.toString() });
  }
  return fields;
}

/**
 * Build the SIGN_TXN review exactly as the device will show it (§7.7).
 * Throws the error the device would return if it would reject the body.
 * Pass `signerPubkey` to also enforce the fee-payer rule (`0x6810`), and the
 * `tokenHint` you will send to get the device's hinted token review (an
 * `InvalidRequestError('token_hint')` if the device would refuse it).
 */
export function describeTransaction(
  body: Uint8Array,
  signerPubkey?: Uint8Array,
  options: DescribeTransactionOptions = {},
): TransactionReview {
  const result = parseTransactionBody(body, signerPubkey);
  if (!result.ok) {
    if (result.sw === StatusWord.FEE_PAYER_MISMATCH) {
      throw new FeePayerMismatchError(undefined, { statusWord: result.sw });
    }
    throw new MalformedTransactionError(result.reason, result.detail, { statusWord: result.sw });
  }
  const transfer = decodeClearTransfer(body);
  const tokenIdentity = options.tokenHint === undefined ? null : verifyTokenHint(body, options.tokenHint);
  const h = result.header;
  const label = knownProgramLabel(h.program);
  const programAddress = thruAddress(h.program);
  const transactionHash = hashDisplay(result.bodyHash);
  const highFee = h.fee > FEE_WARN_THRESHOLD;
  const expirySlot = saturatingAddU64(h.startSlot, BigInt(h.expiryAfter));
  const fields: ReviewField[] = [
    ...(transfer === null ? [] : transferFields(transfer, tokenIdentity)),
    { label: 'Network', value: networkLabel(h.chainId) },
    { label: 'Fee payer', value: thruAddress(h.feePayer) },
    { label: 'Program', value: label === null ? programAddress : `${label} / ${programAddress}` },
    { label: 'Fee', value: formatThruAmount(h.fee) },
    /* The device inserts this field after Fee (app-thru review.rs). */
    ...(highFee ? [{ label: HIGH_FEE_LABEL, value: highFeeWarning() }] : []),
    { label: 'Nonce', value: h.nonce.toString() },
    {
      label: 'Valid slots',
      value: expirySlot > h.startSlot ? `${h.startSlot} to ${expirySlot - 1n}` : 'none',
    },
    { label: 'Accounts', value: `${h.rwCnt} read-write, ${h.roCnt} read-only` },
    { label: 'Instruction data', value: `${h.instrSz} bytes` },
    { label: 'Transaction hash', value: transactionHash },
  ];
  return Object.freeze({
    fields: Object.freeze(fields),
    transfer,
    tokenIdentity,
    requiresBlindSigning: transfer === null,
    highFee,
    transactionHash,
    header: h,
    bodyLength: result.bodyLength,
  });
}

/** §8.5 printable set: `0x20..0x7E` plus LF. */
export function isDisplayablePrintable(message: Uint8Array): boolean {
  for (const b of message) {
    if (!((b >= 0x20 && b <= 0x7e) || b === 0x0a)) return false;
  }
  return true;
}

export type MessageDisplayMode = 'text' | 'hash';

/** §8.7, mirrored from thru-ledger-parser::is_text_message. */
export function messageDisplayMode(message: Uint8Array): MessageDisplayMode {
  if (message.length === 0 || message.length > MSG_DISPLAY_MAX) return 'hash';
  let lines = 1;
  let previous = 0;
  let run = 0;
  for (const byte of message) {
    if (byte === 0x0a) {
      if (previous === 0x20 || ++lines > 16) return 'hash';
      previous = 0;
      run = 0;
      continue;
    }
    if (byte < 0x20 || byte > 0x7e) return 'hash';
    if (byte === 0x20) {
      if (previous < 0x21 || previous > 0x7e) return 'hash';
      run++;
    } else {
      run = previous === 0x20 ? run + 1 : 1;
      if (run > 9) return 'hash';
    }
    previous = byte;
  }
  return previous === 0x20 ? 'hash' : 'text';
}

export interface MessageReview {
  readonly mode: MessageDisplayMode;
  readonly fields: readonly ReviewField[];
  /** True when the device requires the blind-signing setting (hash mode). */
  readonly requiresBlindSigning: boolean;
  readonly messageHash: string;
}

/** Build the SIGN_MESSAGE review (§8.6). */
export function describeMessage(message: Uint8Array, signerPubkey: Uint8Array): MessageReview {
  const mode = messageDisplayMode(message);
  const messageHash = computeMessageHashDisplay(message);
  const fields: ReviewField[] = [
    { label: 'Sign message', value: '' },
    { label: 'Signer', value: thruAddress(signerPubkey) },
  ];
  if (mode === 'text') {
    const lines = String.fromCharCode(...message).split('\n');
    for (const [index, line] of lines.entries()) {
      fields.push({
        label: lines.length === 1 ? 'Message' : `Line ${index + 1}${line === '' ? ' (empty)' : ''}`,
        value: line,
      });
    }
  } else {
    fields.push({ label: 'Message hash', value: messageHash });
    fields.push({ label: 'Length', value: `${message.length} bytes` });
  }
  return Object.freeze({ mode, fields: Object.freeze(fields), requiresBlindSigning: mode === 'hash', messageHash });
}

/** Build the SIGN_EOA_AUTH review (§9.4). */
export function describeEoaAuth(
  kind: EoaAuthKindInput,
  chainId: number,
  feePayer: Uint8Array,
  account: Uint8Array,
): readonly ReviewField[] {
  const k = normalizeEoaAuthKind(kind);
  return Object.freeze([
    {
      label: 'title',
      value: k === EoaAuthKind.CREATE ? 'Authorize account creation' : 'Authorize account deletion',
    },
    { label: 'Network', value: networkLabel(chainId) },
    { label: 'Account', value: thruAddress(account) },
    { label: 'Fee payer', value: thruAddress(feePayer) },
  ]);
}
