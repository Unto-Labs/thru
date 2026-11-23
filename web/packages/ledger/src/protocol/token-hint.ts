/**
 * SIGN_TXN token hint (`specs/ledger/app-thru-apdu.md` §7.2.1).
 *
 * A token Transfer names only two token accounts, and a TransferChecked the
 * two token accounts and the mint. The hint tells the device which mint they
 * hold and who owns the recipient account. The device derives both accounts
 * from it and, only if they equal the signed accounts (and, for a
 * TransferChecked, the hint's mint is the signed mint), shows the account
 * owners and the mint instead of the token accounts; otherwise it returns
 * `0x6814`. The hint is not signed.
 *
 * {@link verifyTokenHint} applies the device's rule on the host, so a wrong
 * hint fails before the device is contacted. The device stays authoritative.
 */
import { sha256 } from '@noble/hashes/sha2.js';

import { InvalidRequestError, MalformedTransactionError } from '../errors';
import { bytesEqual, concatBytes } from './bytes';
import { PUBKEY_SZ } from './constants';
import { decodeClearTransfer, TOKEN_PROGRAM } from './transfer';
import { parseTransactionBody } from './txn-parser';

/** Hint kind byte for token-account identities. */
export const TOKEN_HINT_KIND = 0x01;

/** Encoded hint size: kind, mint, recipient owner, recipient seed, source seed. */
export const TOKEN_HINT_SZ = 1 + 4 * PUBKEY_SZ;

/** User seed of wallet-created token accounts: 32 zero bytes. */
export const DEFAULT_TOKEN_ACCOUNT_SEED: Uint8Array = new Uint8Array(PUBKEY_SZ);

export interface TokenHint {
  /** Mint of both token accounts. */
  readonly mint: Uint8Array;
  /** Owner of the recipient token account. */
  readonly recipientOwner: Uint8Array;
  /** User seed of the recipient token account. Default: 32 zero bytes. */
  readonly recipientSeed?: Uint8Array;
  /** User seed of the fee payer's source token account. Default: 32 zero bytes. */
  readonly sourceSeed?: Uint8Array;
}

/** What the device shows for a token transfer with a verified hint. */
export interface TokenIdentity {
  readonly mint: Uint8Array;
  /** Owner of the source token account: always the fee payer. */
  readonly sourceOwner: Uint8Array;
  readonly recipientOwner: Uint8Array;
  /** Raw token base units. */
  readonly amount: bigint;
}

function key32(name: string, value: Uint8Array | undefined): Uint8Array {
  if (!(value instanceof Uint8Array) || value.length !== PUBKEY_SZ) {
    throw new InvalidRequestError('invalid_argument', `${name} must be 32 bytes`);
  }
  return value;
}

/** `kind ‖ mint ‖ recipient_owner ‖ recipient_seed ‖ source_seed` (129 bytes). */
export function encodeTokenHint(hint: TokenHint): Uint8Array {
  return concatBytes(
    new Uint8Array([TOKEN_HINT_KIND]),
    key32('token hint mint', hint.mint),
    key32('token hint recipientOwner', hint.recipientOwner),
    key32('token hint recipientSeed', hint.recipientSeed ?? DEFAULT_TOKEN_ACCOUNT_SEED),
    key32('token hint sourceSeed', hint.sourceSeed ?? DEFAULT_TOKEN_ACCOUNT_SEED),
  );
}

/**
 * Address of `owner`'s token account for `mint` created with `seed`:
 * `SHA-256(TOKEN_PROGRAM ‖ 0x00 ‖ SHA-256(owner ‖ mint ‖ seed))`.
 */
export function tokenAccountAddress(
  owner: Uint8Array,
  mint: Uint8Array,
  seed: Uint8Array = DEFAULT_TOKEN_ACCOUNT_SEED,
): Uint8Array {
  const accountSeed = sha256(concatBytes(key32('owner', owner), key32('mint', mint), key32('seed', seed)));
  /* 0x00: a persistent (not ephemeral) program-defined account. */
  return sha256(concatBytes(TOKEN_PROGRAM, new Uint8Array([0]), accountSeed));
}

/**
 * Check `hint` against `body` with the device's rule (§7.2.1): the body must
 * be a token transfer the device recognizes, its source must be the fee
 * payer's token account and its recipient `recipientOwner`'s, both for
 * `mint`, and a TransferChecked must name `mint`. Returns what the device
 * will show; throws `InvalidRequestError('token_hint')` otherwise.
 */
export function verifyTokenHint(body: Uint8Array, hint: TokenHint): TokenIdentity {
  encodeTokenHint(hint);
  const parsed = parseTransactionBody(body);
  if (!parsed.ok) {
    throw new MalformedTransactionError(parsed.reason, parsed.detail, { statusWord: parsed.sw });
  }
  const transfer = decodeClearTransfer(body);
  if (transfer === null || transfer.kind !== 'token') {
    throw new InvalidRequestError('token_hint', 'the transaction is not a token transfer the device recognizes');
  }
  if (transfer.checked !== null && !bytesEqual(transfer.checked.mint, hint.mint)) {
    throw new InvalidRequestError('token_hint', 'the TransferChecked names another mint than the hint');
  }
  const feePayer = parsed.header.feePayer;
  if (!bytesEqual(transfer.source, tokenAccountAddress(feePayer, hint.mint, hint.sourceSeed))) {
    throw new InvalidRequestError(
      'token_hint',
      "the source is not the fee payer's token account for this mint and source seed",
    );
  }
  if (!bytesEqual(transfer.recipient, tokenAccountAddress(hint.recipientOwner, hint.mint, hint.recipientSeed))) {
    throw new InvalidRequestError(
      'token_hint',
      "the recipient is not the recipient owner's token account for this mint and recipient seed",
    );
  }
  return {
    mint: new Uint8Array(hint.mint),
    sourceOwner: new Uint8Array(feePayer),
    recipientOwner: new Uint8Array(hint.recipientOwner),
    amount: transfer.amount,
  };
}
