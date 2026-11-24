/**
 * What the Thru app on a Trezor Safe 7 shows for a request, computed on the
 * host before the request is sent (plan B8). The functions here are plain: no
 * device, no I/O. Given what is about to be signed they return the whole review
 * the app will draw, step by step, or `null` when the app will refuse the
 * request without showing anything. This is the TypeScript counterpart of
 * `rpc/cli/crates/thru-core/src/trezor_preview.rs`, with the same JSON shape
 * (`trezor_preview` of the CLI); a review is a plain JSON value:
 *
 * ```text
 * Review = { kind: 'transfer' | 'create_account' | 'token_transfer'
 *                  | 'wallet_transfer' | 'message' | 'eoa_auth',
 *            steps: Step[] }      // in the order the app shows them; never empty
 * Step   = { name, title, items: Item[], menus: Menu[] }
 * Item   = Field | { type: 'note' | 'warning', text }
 * Field  = { type: 'field', label, value, unit: string | null }
 * Menu   = { name, fields: Field[] }
 * ```
 *
 * The app is `no_std` and cannot be linked in, so the two are tied by tests,
 * not by shared code: every case of the app's fixture
 * (`trezor/app-thru/tests/fixtures/sign_tx.json`) must give the review the
 * fixture says, and {@link TEXTS} is compared, in both directions, with the
 * app's `translations/en.json`.
 *
 * The transaction is parsed by `@thru/ledger/protocol` (the parser the Ledger
 * app is held to); the shape rules applied on top of it are the Trezor app's
 * (`trezor/app-thru/src/action.rs`): exact account layouts and no flags.
 */
import {
  computeMessageHashDisplay,
  decodeClearTransfer,
  FEE_WARN_THRESHOLD,
  formatAmount,
  networkLabel,
  STATE_PROOF_TYPE_CREATION,
  TOKEN_HINT_KIND,
  TOKEN_HINT_SZ,
  THRU_DECIMALS,
  thruAddress,
  verifyTokenHint,
  parseTransactionBody,
  messageDisplayMode,
  bytesEqual,
  toHex,
  type CheckedToken,
  type ClearTransfer,
  type TokenHint,
  type TokenIdentity,
  type TxnHeader,
} from '@thru/ledger/protocol';

import { parseTrezorPath, type TrezorPath, type TrezorPathInput } from './path';

/**
 * Every fixed text of a review, with the key the app's `translations/en.json`
 * gives it.
 */
export const TEXTS: Readonly<Record<string, string>> = Object.freeze({
  thru__account: 'Account',
  thru__account_name: 'Thru',
  thru__address_type: 'Address type',
  thru__amount: 'Amount',
  thru__amount_base_units: 'Amount (base units)',
  thru__authority_index: 'Authority index',
  thru__bytes: 'bytes',
  thru__create_account: 'Create account',
  thru__details: 'Details',
  thru__eoa_create_note: 'The fee payer can create this account.',
  thru__eoa_create_title: 'Authorize account creation',
  thru__eoa_delete_note:
    'The fee payer can delete this account, or clear its data, while its balance and nonce are zero.',
  thru__eoa_delete_title: 'Authorize account deletion',
  thru__eoa_reuse_note: 'This authorization does not expire and can be used again.',
  thru__fee: 'Fee',
  thru__fee_payer: 'Fee payer',
  thru__from: 'From',
  thru__high_fee: 'The fee is above 0.1 THRU.',
  thru__high_fee_title: 'High fee',
  thru__length: 'Length',
  thru__message_hash: 'Message hash',
  thru__network: 'Network',
  thru__nonce: 'Nonce',
  thru__path: 'Derivation path',
  thru__recipient: 'Recipient',
  thru__send: 'Send',
  thru__send_from_wallet: 'Send from wallet',
  thru__send_token: 'Send token',
  thru__sign_message: 'Sign message',
  thru__signer: 'Signer',
  thru__summary: 'Summary',
  thru__ticker: 'Ticker',
  thru__token_account_owners: 'Token account owners',
  thru__token_accounts: 'Token accounts',
  thru__token_mint: 'Token mint',
  thru__token_unknown: 'The transaction does not identify the token.',
  thru__tx_hash: 'Transaction hash',
  thru__valid_slots: 'Valid slots',
});

const T = (key: string): string => {
  const text = TEXTS[key];
  if (text === undefined) throw new Error(`no text ${key}`);
  return text;
};

const ACCOUNT = T('thru__account');
const ACCOUNT_NAME = T('thru__account_name');
const ADDRESS_TYPE = T('thru__address_type');
const AMOUNT = T('thru__amount');
const AMOUNT_BASE_UNITS = T('thru__amount_base_units');
const AUTHORITY_INDEX = T('thru__authority_index');
const BYTES = T('thru__bytes');
const CREATE_ACCOUNT = T('thru__create_account');
const DETAILS = T('thru__details');
const EOA_CREATE_NOTE = T('thru__eoa_create_note');
const EOA_CREATE_TITLE = T('thru__eoa_create_title');
const EOA_DELETE_NOTE = T('thru__eoa_delete_note');
const EOA_DELETE_TITLE = T('thru__eoa_delete_title');
const EOA_REUSE_NOTE = T('thru__eoa_reuse_note');
const FEE = T('thru__fee');
const FEE_PAYER = T('thru__fee_payer');
const FROM = T('thru__from');
const HIGH_FEE = T('thru__high_fee');
const HIGH_FEE_TITLE = T('thru__high_fee_title');
const LENGTH = T('thru__length');
const MESSAGE_HASH = T('thru__message_hash');
const NETWORK = T('thru__network');
const NONCE = T('thru__nonce');
const PATH = T('thru__path');
const RECIPIENT = T('thru__recipient');
const SEND = T('thru__send');
const SEND_FROM_WALLET = T('thru__send_from_wallet');
const SEND_TOKEN = T('thru__send_token');
const SIGN_MESSAGE = T('thru__sign_message');
const SIGNER = T('thru__signer');
const SUMMARY = T('thru__summary');
const TICKER = T('thru__ticker');
const TOKEN_ACCOUNT_OWNERS = T('thru__token_account_owners');
const TOKEN_ACCOUNTS = T('thru__token_accounts');
const TOKEN_MINT = T('thru__token_mint');
const TOKEN_UNKNOWN = T('thru__token_unknown');
const TX_HASH = T('thru__tx_hash');
const VALID_SLOTS = T('thru__valid_slots');

/** Unit of an amount of THRU (the app's `TICKER`; not a translation). */
const THRU_UNIT = 'THRU';
/** The length of a public key. */
const PUBLIC_KEY_LEN = 32;
/** The `flags` bit of a fee payer proof (`TN_TXN_FLAG_HAS_FEE_PAYER_PROOF`). */
const FLAG_HAS_FEE_PAYER_PROOF = 1;

/** The no-op program (`NOOP_PROGRAM_BYTES`, `taNOOP7zyQMAKczxK6lbJcGzHDsfe5A_QNZY-uObL99Rx8`). */
const NOOP_PROGRAM = new Uint8Array([
  0x34, 0xe3, 0x8f, 0xef, 0x3c, 0x90, 0x30, 0x02, 0x9c, 0xcf, 0x12, 0xba, 0x95, 0xb2, 0x5c, 0x1b, 0x31, 0xc3, 0xb1,
  0xf7, 0xb9, 0x03, 0xf4, 0x0d, 0x65, 0x8f, 0xae, 0x39, 0xb2, 0xfd, 0xf5, 0x1c,
]);

/** A fact of a review: a label and its value, with the unit an amount is drawn with. */
export type PreviewField = { type: 'field'; label: string; value: string; unit: string | null };
/** A sentence without a label. */
export type PreviewNote = { type: 'note'; text: string };
/** A sentence without a label, drawn as a warning. */
export type PreviewWarning = { type: 'warning'; text: string };
export type PreviewItem = PreviewField | PreviewNote | PreviewWarning;
/** An entry of a step's menu and the fields on its screen. */
export type PreviewMenu = { name: string; fields: PreviewField[] };
/** One step of a review: a screen (or a paged list) the person passes. */
export type PreviewStep = { name: string; title: string; items: PreviewItem[]; menus: PreviewMenu[] };
export type TrezorReviewKind =
  | 'transfer'
  | 'create_account'
  | 'token_transfer'
  | 'wallet_transfer'
  | 'message'
  | 'eoa_auth';
/** The whole review of one request. */
export type TrezorReview = { kind: TrezorReviewKind; steps: PreviewStep[] };

const textField = (label: string, value: string): PreviewField => ({ type: 'field', label, value, unit: null });
const thruField = (label: string, value: string): PreviewField => ({ type: 'field', label, value, unit: THRU_UNIT });

const thru = (baseUnits: bigint): string => formatAmount(baseUnits, THRU_DECIMALS);

/** The menu "Account": the wallet's name for the account (the four-component path only) and the path. */
function accountMenu(path: TrezorPath): PreviewMenu {
  const fields: PreviewField[] = [];
  if (path.depth === 4) fields.push(textField(ACCOUNT, `${ACCOUNT_NAME} #${path.account + 1}`));
  fields.push(textField(PATH, path.path));
  return { name: ACCOUNT, fields };
}

const detailsMenu = (fields: PreviewField[]): PreviewMenu => ({ name: DETAILS, fields });

// ----- transactions -----

/** What a signable transaction does (the app's `Action`, with the wallet transfer of decision W1). */
type Action =
  | { kind: 'transfer'; recipient: Uint8Array; amount: bigint }
  | { kind: 'create_account' }
  | {
      kind: 'token';
      source: Uint8Array;
      recipient: Uint8Array;
      amount: bigint;
      checked: CheckedToken | null;
      identity: TokenIdentity | null;
    }
  | { kind: 'wallet'; source: Uint8Array; recipient: Uint8Array; amount: bigint; authorityIndex: number };

/** The token hint as the app takes it: 129 bytes, kind 1; `undefined` for bytes the app refuses. */
function hintOfBytes(bytes: Uint8Array): TokenHint | undefined {
  if (bytes.length !== TOKEN_HINT_SZ || bytes[0] !== TOKEN_HINT_KIND) return undefined;
  const part = (i: number): Uint8Array => new Uint8Array(bytes.subarray(1 + 32 * i, 33 + 32 * i));
  return { mint: part(0), recipientOwner: part(1), recipientSeed: part(2), sourceSeed: part(3) };
}

/**
 * The review of the transaction `body` (the bytes the device is sent), signed
 * by `signer` at `path`, with the token hint sent along if any (a
 * {@link TokenHint}, or its 129 bytes); `null` when the app refuses the
 * request without a screen: a body that does not parse, a fee payer that is
 * not `signer`, a hint that does not prove the transaction's token accounts
 * (or is not 129 bytes of kind 1), or a shape the app does not sign (anything
 * but the layouts the Thru builders make).
 */
export function transactionReview(
  body: Uint8Array,
  signer: Uint8Array,
  path: TrezorPathInput,
  hint?: TokenHint | Uint8Array,
): TrezorReview | null {
  const parsedPath = parseTrezorPath(path);
  const parsed = parseTransactionBody(body);
  if (!parsed.ok) return null;
  const header = parsed.header;
  if (!bytesEqual(header.feePayer, signer)) return null;

  // The hint is proven first; a hint that does not verify is refused whatever the shape is.
  let identity: TokenIdentity | null = null;
  if (hint !== undefined) {
    const tokenHint = hint instanceof Uint8Array ? hintOfBytes(hint) : hint;
    if (tokenHint === undefined) return null;
    try {
      identity = verifyTokenHint(body, tokenHint);
    } catch {
      return null;
    }
  }
  const action = classify(body, header, parsed.proofType, identity);
  if (action === null) return null;
  return reviewOf(action, header, parsedPath, toHex(parsed.bodyHash));
}

/** The shape rules of the app (`action.rs`, decisions T1 and W1). */
function classify(
  body: Uint8Array,
  header: TxnHeader,
  proofType: number | null,
  identity: TokenIdentity | null,
): Action | null {
  const transfer = decodeClearTransfer(body);
  if (transfer !== null) {
    // No fee payer proof and no permission to compress accounts.
    if (header.flags !== 0) return null;
    switch (transfer.kind) {
      case 'native':
        return nativeTransfer(header, transfer);
      case 'token':
        return tokenTransfer(header, transfer, identity);
      case 'wallet':
        return walletTransfer(header, transfer);
    }
  }
  return isAccountCreation(header, proofType) ? { kind: 'create_account' } : null;
}

/** The transfer `thru transfer` builds: the EOA program's transfer from the fee payer to the single read-write account. */
function nativeTransfer(header: TxnHeader, t: ClearTransfer): Action | null {
  if (
    header.rwCnt !== 1 ||
    header.roCnt !== 0 ||
    !bytesEqual(t.source, header.feePayer) ||
    t.authorityIndex !== null ||
    t.checked !== null ||
    bytesEqual(t.recipient, header.feePayer)
  ) {
    return null;
  }
  return { kind: 'transfer', recipient: t.recipient, amount: t.amount };
}

/**
 * The transfers `thru token transfer` builds: two read-write token accounts,
 * and for `TransferChecked` the mint as the only read-only account; source and
 * recipient differ.
 */
function tokenTransfer(header: TxnHeader, t: ClearTransfer, identity: TokenIdentity | null): Action | null {
  const readOnly = t.checked !== null ? 1 : 0;
  if (header.rwCnt !== 2 || header.roCnt !== readOnly || bytesEqual(t.source, t.recipient) || t.authorityIndex !== null) {
    return null;
  }
  return { kind: 'token', source: t.source, recipient: t.recipient, amount: t.amount, checked: t.checked, identity };
}

/**
 * Decision W1: no read-only account, and the read-write accounts are exactly
 * the ones named: the wallet account and the recipient (two, different), or the
 * wallet account alone when the recipient is the fee payer.
 */
function walletTransfer(header: TxnHeader, t: ClearTransfer): Action | null {
  if (t.authorityIndex === null) return null;
  const namedOk = bytesEqual(t.recipient, header.feePayer)
    ? header.rwCnt === 1
    : header.rwCnt === 2 && !bytesEqual(t.source, t.recipient);
  if (header.roCnt !== 0 || bytesEqual(t.source, header.feePayer) || t.checked !== null || !namedOk) return null;
  return { kind: 'wallet', source: t.source, recipient: t.recipient, amount: t.amount, authorityIndex: t.authorityIndex };
}

/**
 * The transaction `thru account create` builds: the no-op program, no
 * accounts, no instruction data, no fee, nonce 0, and a CREATION proof for the
 * fee payer.
 */
function isAccountCreation(header: TxnHeader, proofType: number | null): boolean {
  return (
    header.flags === FLAG_HAS_FEE_PAYER_PROOF &&
    proofType === STATE_PROOF_TYPE_CREATION &&
    bytesEqual(header.program, NOOP_PROGRAM) &&
    header.rwCnt === 0 &&
    header.roCnt === 0 &&
    header.instrSz === 0 &&
    header.fee === 0n &&
    header.nonce === 0n
  );
}

/** The saturating end of a transaction's validity and its text, `"<start> to <last>"` or `"none"`. */
function validSlots(header: TxnHeader): string {
  const sum = header.startSlot + BigInt(header.expiryAfter);
  const expiry = sum > 0xffffffffffffffffn ? 0xffffffffffffffffn : sum;
  return expiry > header.startSlot ? `${header.startSlot} to ${expiry - 1n}` : 'none';
}

function reviewOf(action: Action, header: TxnHeader, path: TrezorPath, hash: string): TrezorReview {
  const network = (): PreviewField => textField(NETWORK, networkLabel(header.chainId));
  const fee = (): PreviewField => thruField(FEE, thru(header.fee));
  const highFee = header.fee > FEE_WARN_THRESHOLD;
  const signer = thruAddress(header.feePayer);
  const validSlotsField = textField(VALID_SLOTS, validSlots(header));
  const hashField = textField(TX_HASH, hash);

  // The steps every transfer has: parties, the warning of a high fee, sums.
  const transfer = (
    kind: 'transfer' | 'token_transfer' | 'wallet_transfer',
    title: string,
    parties: PreviewItem[],
    sums: PreviewItem[],
  ): TrezorReview => {
    const steps: PreviewStep[] = [{ name: kind, title, items: parties, menus: [accountMenu(path)] }];
    if (highFee) {
      steps.push({
        name: `${kind}/high_fee`,
        title: HIGH_FEE_TITLE,
        items: [{ type: 'warning', text: HIGH_FEE }],
        menus: [],
      });
    }
    steps.push({
      name: `${kind}/summary`,
      title: SUMMARY,
      items: sums,
      menus: [detailsMenu([textField(NONCE, header.nonce.toString()), validSlotsField, hashField])],
    });
    return { kind, steps };
  };

  switch (action.kind) {
    case 'transfer':
      return transfer(
        'transfer',
        SEND,
        [textField(FROM, signer), textField(RECIPIENT, thruAddress(action.recipient)), network()],
        [thruField(AMOUNT, thru(action.amount)), fee()],
      );
    case 'create_account':
      return {
        kind: 'create_account',
        steps: [
          {
            name: 'create_account',
            title: CREATE_ACCOUNT,
            items: [textField(ACCOUNT, signer), network(), fee()],
            // The nonce of an account creation is fixed to 0, so it is not listed.
            menus: [accountMenu(path), detailsMenu([validSlotsField, hashField])],
          },
        ],
      };
    case 'token': {
      // With a proven hint the parties are the owners of the token accounts and
      // the hint names the mint; else the token accounts themselves, and the
      // mint only if the instruction names it.
      const { identity, checked } = action;
      const from = identity !== null ? identity.sourceOwner : action.source;
      const to = identity !== null ? identity.recipientOwner : action.recipient;
      const mint = identity !== null ? identity.mint : checked !== null ? checked.mint : null;
      const parties: PreviewItem[] = [];
      if (identity === null) parties.push(textField(FEE_PAYER, signer));
      parties.push(textField(FROM, thruAddress(from)));
      parties.push(textField(RECIPIENT, thruAddress(to)));
      if (mint !== null) parties.push(textField(TOKEN_MINT, thruAddress(mint)));
      parties.push(textField(ADDRESS_TYPE, identity !== null ? TOKEN_ACCOUNT_OWNERS : TOKEN_ACCOUNTS));
      // A plain transfer names no mint; only a proven hint supplies one.
      if (mint === null) parties.push({ type: 'warning', text: TOKEN_UNKNOWN });
      parties.push(network());

      const sums: PreviewItem[] = [];
      if (checked !== null) {
        sums.push(textField(AMOUNT, formatAmount(action.amount, checked.decimals)));
        if (checked.ticker !== '') sums.push(textField(TICKER, checked.ticker));
      } else {
        sums.push(textField(AMOUNT_BASE_UNITS, action.amount.toString()));
      }
      sums.push(fee());
      return transfer('token_transfer', SEND_TOKEN, parties, sums);
    }
    case 'wallet':
      return transfer(
        'wallet_transfer',
        SEND_FROM_WALLET,
        [
          textField(FEE_PAYER, signer),
          textField(FROM, thruAddress(action.source)),
          textField(RECIPIENT, thruAddress(action.recipient)),
          textField(AUTHORITY_INDEX, action.authorityIndex.toString()),
          network(),
        ],
        [thruField(AMOUNT, thru(action.amount)), fee()],
      );
  }
}

// ----- messages -----

/** Whether the app signs `message`: 1 to 512 bytes of text by the rule of `TREZOR_TEXT_RULE`. */
export function isTrezorTextMessage(message: Uint8Array): boolean {
  return messageDisplayMode(message) === 'text';
}

/**
 * The review of a text message signed by `signer` at `path`; `null` when the
 * app refuses the message (anything but 1 to 512 bytes of the text rule, see
 * `TREZOR_TEXT_RULE`) or `signer` is not a 32-byte key.
 *
 * One field per line, named `Message` for a one-line message, else `Line k`,
 * with ` (empty)` for an empty line; the menu "Details" gives the hash and the
 * length of the exact bytes.
 */
export function messageReview(message: Uint8Array, signer: Uint8Array, path: TrezorPathInput): TrezorReview | null {
  const parsedPath = parseTrezorPath(path);
  if (!isTrezorTextMessage(message) || !(signer instanceof Uint8Array) || signer.length !== PUBLIC_KEY_LEN) return null;
  // Printable ASCII and line feeds only, so this is lossless.
  let text = '';
  for (const byte of message) text += String.fromCharCode(byte);
  const lines = text.split('\n');
  const items: PreviewItem[] = [textField(SIGNER, thruAddress(signer))];
  lines.forEach((line, index) => {
    let tag = lines.length === 1 ? 'Message' : `Line ${index + 1}`;
    if (line === '') tag += ' (empty)';
    items.push(textField(tag, line));
  });
  return {
    kind: 'message',
    steps: [
      {
        name: 'message',
        title: SIGN_MESSAGE,
        items,
        menus: [
          accountMenu(parsedPath),
          detailsMenu([
            textField(MESSAGE_HASH, computeMessageHashDisplay(message)),
            textField(LENGTH, `${message.length} ${BYTES}`),
          ]),
        ],
      },
    ],
  };
}

// ----- EOA authorizations -----

/** The kind of an EOA authorization, as the app numbers it (0 create, 1 delete) or by name. */
export type TrezorEoaAuthKind = 'create' | 'delete' | 0 | 1;

/** The chain id of an authorization is the app's `u16` and the app refuses zero. */
const EOA_CHAIN_ID_MAX = 0xffff;

/**
 * The review of an EOA authorization of `kind` for `account` (which must be
 * `signer`, the key at `path`) naming `feePayer`, on chain `chainId`; `null`
 * when the app refuses it: a chain id that is not an integer from 1 to 65535,
 * a kind that is not create or delete, a key that is not 32 bytes, or an
 * account that is not the key at the path.
 */
export function eoaAuthReview(
  kind: TrezorEoaAuthKind,
  chainId: number,
  feePayer: Uint8Array,
  account: Uint8Array,
  signer: Uint8Array,
  path: TrezorPathInput,
): TrezorReview | null {
  const parsedPath = parseTrezorPath(path);
  if (!Number.isInteger(chainId) || chainId < 1 || chainId > EOA_CHAIN_ID_MAX) return null;
  const create = kind === 'create' || kind === 0;
  if (!create && kind !== 'delete' && kind !== 1) return null;
  for (const key of [feePayer, account, signer]) {
    if (!(key instanceof Uint8Array) || key.length !== PUBLIC_KEY_LEN) return null;
  }
  if (!bytesEqual(account, signer)) return null;
  return {
    kind: 'eoa_auth',
    steps: [
      {
        name: 'eoa_auth',
        title: create ? EOA_CREATE_TITLE : EOA_DELETE_TITLE,
        items: [
          { type: 'note', text: create ? EOA_CREATE_NOTE : EOA_DELETE_NOTE },
          { type: 'note', text: EOA_REUSE_NOTE },
          textField(ACCOUNT, thruAddress(account)),
          textField(FEE_PAYER, thruAddress(feePayer)),
          textField(NETWORK, networkLabel(chainId)),
        ],
        menus: [accountMenu(parsedPath)],
      },
    ],
  };
}
