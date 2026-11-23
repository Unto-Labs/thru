/**
 * Typed errors for the Thru Ledger signer (`specs/ledger/app-thru-apdu.md`
 * §5.3, §11.5; plan §4.1).
 *
 * Every error extends {@link ThruLedgerError}, which carries a stable `code`,
 * the device status word when one was involved, and an actionable `hint` for
 * end users. Each class also has a `_tag`, so instances satisfy DMK's
 * `DmkError` contract and can flow through DMK device actions unchanged.
 */
import { Ins } from './protocol/constants';
import {
  formatStatusWord,
  StatusWord,
  statusWordName,
} from './protocol/status-words';

export type ThruLedgerErrorCode =
  | 'UserRejected'
  | 'BlindSigningDisabled'
  | 'WrongApp'
  | 'Locked'
  | 'PathRejected'
  | 'FeePayerMismatch'
  | 'MalformedTransaction'
  | 'EoaAccountMismatch'
  | 'InvalidRequest'
  | 'Protocol'
  | 'Unsupported'
  | 'UnsupportedAppVersion'
  | 'UnsupportedSigningScheme'
  | 'KeyMismatch'
  | 'InvalidSignature'
  | 'DeviceInternal'
  | 'DeviceBusy'
  | 'Transport'
  | 'Cancelled'
  | 'UnknownStatusWord';

export interface ThruLedgerErrorOptions {
  statusWord?: number;
  cause?: unknown;
}

export class ThruLedgerError extends Error {
  /** DMK `DmkError` discriminator. Equal to the class name. */
  readonly _tag: string;
  readonly code: ThruLedgerErrorCode;
  /** The device status word, when the error came from the device. */
  readonly statusWord?: number;
  /** A short, user-facing instruction for recovering from the error. */
  readonly hint: string;
  /** DMK `DmkError.originalError`. */
  readonly originalError?: unknown;

  constructor(
    code: ThruLedgerErrorCode,
    message: string,
    hint: string,
    options: ThruLedgerErrorOptions = {},
  ) {
    super(message);
    this.name = new.target.name;
    this._tag = new.target.name;
    this.code = code;
    this.hint = hint;
    if (options.statusWord !== undefined) this.statusWord = options.statusWord;
    if (options.cause !== undefined) {
      this.originalError = options.cause;
      /* ES2022 `Error.cause`, set by hand because the build targets ES2020. */
      Object.defineProperty(this, 'cause', { value: options.cause, enumerable: false, writable: true });
    }
  }
}

export class UserRejectedError extends ThruLedgerError {
  constructor(options: ThruLedgerErrorOptions = {}) {
    super(
      'UserRejected',
      'The request was rejected on the Ledger device.',
      'Approve the request on your Ledger to continue.',
      options,
    );
  }
}

export class BlindSigningDisabledError extends ThruLedgerError {
  constructor(options: ThruLedgerErrorOptions = {}) {
    super(
      'BlindSigningDisabled',
      'Blind signing is disabled in the Thru app on the Ledger device.',
      'On your Ledger, open the Thru app, go to Settings and enable "Blind signing", then retry.',
      options,
    );
  }
}

export type WrongAppReason = 'not_open' | 'not_installed' | 'other_app' | 'cla_not_supported';

export class WrongAppError extends ThruLedgerError {
  readonly reason: WrongAppReason;
  /** Name of the app that is open, when known. */
  readonly openApp?: string;

  constructor(reason: WrongAppReason, options: ThruLedgerErrorOptions & { openApp?: string } = {}) {
    const detail =
      reason === 'not_installed'
        ? 'The Thru app is not installed on the Ledger device.'
        : options.openApp !== undefined
          ? `The Thru app is not open on the Ledger device (open app: "${options.openApp}").`
          : 'The Thru app is not open on the Ledger device.';
    super(
      'WrongApp',
      detail,
      reason === 'not_installed'
        ? 'Install the Thru app on your Ledger (developer side-load build), then open it.'
        : 'Open the Thru app on your Ledger, then retry.',
      options,
    );
    this.reason = reason;
    if (options.openApp !== undefined) this.openApp = options.openApp;
  }
}

export class LockedError extends ThruLedgerError {
  constructor(options: ThruLedgerErrorOptions = {}) {
    super(
      'Locked',
      'The Ledger device is locked.',
      'Unlock your Ledger with your PIN, open the Thru app, then retry.',
      options,
    );
  }
}

export class PathRejectedError extends ThruLedgerError {
  readonly path?: string;

  constructor(detail: string, options: ThruLedgerErrorOptions & { path?: string } = {}) {
    super(
      'PathRejected',
      `Derivation path rejected: ${detail}`,
      "Use a Thru Ledger path of the form m/44'/8478'/<account>'/0' (or m/44'/8478'/<account>').",
      options,
    );
    if (options.path !== undefined) this.path = options.path;
  }
}

export class FeePayerMismatchError extends ThruLedgerError {
  constructor(detail?: string, options: ThruLedgerErrorOptions = {}) {
    super(
      'FeePayerMismatch',
      detail ?? 'The transaction fee payer is not the Ledger key for this derivation path.',
      'Rebuild the transaction with the Ledger address as fee payer, or select the matching Ledger account.',
      options,
    );
  }
}

/**
 * Reason classes for rejected transaction bodies. The first nine mirror the
 * node's error classes (§13.3); the last three are device-only strictness.
 * `fee_payer_mismatch` is raised as {@link FeePayerMismatchError}, never as
 * {@link MalformedTransactionError}.
 */
export type TxnRejectReason =
  | 'invalid_format'
  | 'invalid_version'
  | 'invalid_flags'
  | 'chain_id_zero'
  | 'invalid_fee_payer_state_proof_type'
  | 'account_count_limit_exceeded'
  | 'duplicate_account'
  | 'unsorted_readwrite_accounts'
  | 'unsorted_readonly_accounts'
  | 'pad_nonzero'
  | 'rw_cache_exceeded'
  | 'fee_payer_mismatch';

export class MalformedTransactionError extends ThruLedgerError {
  readonly reason: TxnRejectReason;

  constructor(reason: TxnRejectReason, detail?: string, options: ThruLedgerErrorOptions = {}) {
    super(
      'MalformedTransaction',
      `Transaction rejected (${reason})${detail === undefined ? '' : `: ${detail}`}`,
      'The transaction is malformed or uses a layout the Ledger refuses. Rebuild it with the Thru SDK.',
      options,
    );
    this.reason = reason;
  }
}

/** Spec §5.3 name for {@link MalformedTransactionError}. */
export const InvalidTransactionError = MalformedTransactionError;

export class EoaAccountMismatchError extends ThruLedgerError {
  constructor(options: ThruLedgerErrorOptions = {}) {
    super(
      'EoaAccountMismatch',
      'The EOA authorization names an account that is not the Ledger key for this derivation path.',
      'Authorize only the Ledger account derived from the selected path.',
      options,
    );
  }
}

export type InvalidRequestReason =
  | 'msg_invalid_length'
  | 'eoa_invalid_kind'
  | 'chain_id_zero'
  | 'token_hint'
  | 'invalid_argument';

export class InvalidRequestError extends ThruLedgerError {
  readonly reason: InvalidRequestReason;

  constructor(reason: InvalidRequestReason, detail: string, options: ThruLedgerErrorOptions = {}) {
    super('InvalidRequest', `Invalid request (${reason}): ${detail}`, 'Fix the request and retry.', options);
    this.reason = reason;
  }
}

export type ProtocolErrorReason =
  | 'chunk_out_of_order'
  | 'length_mismatch'
  | 'msg_pass_mismatch'
  | 'wrong_data_length'
  | 'wrong_p1p2'
  | 'sdk_bad_len'
  | 'invalid_response';

/** A host/device protocol desynchronization. Always a bug on one side. */
export class ProtocolError extends ThruLedgerError {
  readonly reason: ProtocolErrorReason;

  constructor(reason: ProtocolErrorReason, detail: string, options: ThruLedgerErrorOptions = {}) {
    super(
      'Protocol',
      `Ledger protocol error (${reason}): ${detail}`,
      'Retry the operation from the start. If it persists, update the Thru app and this library.',
      options,
    );
    this.reason = reason;
  }
}

export class UnsupportedError extends ThruLedgerError {
  constructor(detail: string, options: ThruLedgerErrorOptions = {}) {
    super(
      'Unsupported',
      `Not supported by the Thru app on the device: ${detail}`,
      'Update the Thru app on your Ledger.',
      options,
    );
  }
}

export class UnsupportedAppVersionError extends ThruLedgerError {
  readonly apduProtocolVersion: number;

  constructor(apduProtocolVersion: number, supported: number) {
    super(
      'UnsupportedAppVersion',
      `The Thru app speaks APDU protocol version ${apduProtocolVersion}; this host supports version ${supported}.`,
      'Update the Thru app on your Ledger and this library to compatible versions.',
    );
    this.apduProtocolVersion = apduProtocolVersion;
  }
}

/**
 * Plan decision D11: Ledger signing works only on RFC-8032 networks. Also
 * raised when the signer was never told the network's scheme
 * (`scheme === undefined`): the host must not guess.
 */
export class UnsupportedSigningSchemeError extends ThruLedgerError {
  /** The scheme that was refused, or `undefined` if none was configured. */
  readonly scheme: string | undefined;

  constructor(scheme: string | undefined) {
    super(
      'UnsupportedSigningScheme',
      scheme === undefined
        ? 'Ledger signing requires an RFC-8032 network, and the signer was not told the network signing scheme. Pass transactionSigningScheme (thru.ctx.transactionSigningScheme).'
        : `Ledger signing requires an RFC-8032 network; this network is configured for the "${scheme}" signing scheme.`,
      'Ledger signing is not supported on networks that use the legacy signing scheme.',
    );
    this.scheme = scheme;
  }
}

/**
 * D11 (spec §11.1 step 1): refuse unless the network is known to use the
 * RFC-8032 scheme. Call before contacting the device.
 */
export function assertLedgerSigningScheme(scheme: string | undefined): void {
  /* 'rfc8032' is `TransactionSigningScheme.Rfc8032` in @thru/sdk; the literal
     keeps this module free of the SDK runtime. */
  if (scheme !== 'rfc8032') throw new UnsupportedSigningSchemeError(scheme);
}

/** The device key for the path is not the key the signature had to verify under. */
export class KeyMismatchError extends ThruLedgerError {
  constructor(detail: string) {
    super(
      'KeyMismatch',
      `Ledger key mismatch: ${detail}`,
      'Check that the selected Ledger account matches the account you are signing for.',
    );
  }
}

/** The device returned a signature that does not verify strictly. Never use it. */
export class InvalidSignatureError extends ThruLedgerError {
  constructor(detail: string) {
    super(
      'InvalidSignature',
      `The Ledger signature failed strict verification: ${detail}`,
      'Retry. If it persists, the device app or the transport is faulty.',
    );
  }
}

export class DeviceInternalError extends ThruLedgerError {
  constructor(options: ThruLedgerErrorOptions = {}) {
    super(
      'DeviceInternal',
      'The Thru app reported an internal error.',
      'Retry. If it persists, restart the Thru app on your Ledger.',
      options,
    );
  }
}

/**
 * `0x6901` for longer than the retry budget: the device kept showing a screen
 * (normally the status page after a review, about 3 s) and the Ledger SDK did
 * not pass commands to the app.
 */
export class DeviceBusyError extends ThruLedgerError {
  constructor(options: ThruLedgerErrorOptions = {}) {
    super(
      'DeviceBusy',
      'The Ledger is busy showing the result of the previous request.',
      'Wait until the Thru app shows its home screen, then retry.',
      { ...options, statusWord: StatusWord.SDK_CMD_NOT_ACCEPTED },
    );
  }
}

export class TransportError extends ThruLedgerError {
  constructor(detail: string, options: ThruLedgerErrorOptions = {}) {
    super(
      'Transport',
      `Ledger transport error: ${detail}`,
      'Reconnect your Ledger, unlock it, open the Thru app and retry from the start.',
      options,
    );
  }
}

export class CancelledError extends ThruLedgerError {
  constructor(options: ThruLedgerErrorOptions = {}) {
    super('Cancelled', 'The Ledger operation was cancelled.', 'Start the operation again when ready.', options);
  }
}

export class UnknownStatusWordError extends ThruLedgerError {
  constructor(sw: number, options: ThruLedgerErrorOptions = {}) {
    super(
      'UnknownStatusWord',
      `Unexpected Ledger status word 0x${formatStatusWord(sw)}.`,
      'Make sure the Thru app is open, then retry.',
      { ...options, statusWord: sw },
    );
  }
}

/** Context that refines status-word mapping. */
export interface StatusWordContext {
  /** INS of the command that produced the status word. */
  ins?: number;
}

/**
 * Map a non-`0x9000` status word to a typed error (§5.3, §5.2).
 *
 * Mapping decisions beyond the letter of §5.3 (documented in the README):
 * `0x6700`/`0x6A86` are {@link ProtocolError}s (host bugs); `0x6D00` is
 * {@link UnsupportedError}; `0x6E00` is {@link WrongAppError} (this host only
 * sends CLA `0xE0`, so a CLA rejection means another app is answering);
 * `0x6840`/`0x6851` and SIGN_EOA_AUTH `0x6804` are {@link InvalidRequestError}s;
 * `0x6A80`-`0x6A8F` other than `0x6A86` are {@link UnknownStatusWordError}s.
 */
export function statusWordToError(sw: number, context: StatusWordContext = {}): ThruLedgerError {
  const opts: ThruLedgerErrorOptions = { statusWord: sw };
  switch (sw) {
    case StatusWord.USER_DENIED:
      return new UserRejectedError(opts);
    case StatusWord.BLIND_SIGNING_DISABLED:
      return new BlindSigningDisabledError(opts);
    case StatusWord.FEE_PAYER_MISMATCH:
      return new FeePayerMismatchError(undefined, opts);
    case StatusWord.PATH_REJECTED:
      return new PathRejectedError('the device refused the derivation path', opts);
    case StatusWord.EOA_ACCOUNT_MISMATCH:
      return new EoaAccountMismatchError(opts);

    case StatusWord.TXN_INVALID_FORMAT:
      return new MalformedTransactionError('invalid_format', undefined, opts);
    case StatusWord.TXN_INVALID_VERSION:
      return new MalformedTransactionError('invalid_version', undefined, opts);
    case StatusWord.TXN_INVALID_FLAGS:
      return new MalformedTransactionError('invalid_flags', undefined, opts);
    case StatusWord.CHAIN_ID_ZERO:
      return context.ins === Ins.SIGN_EOA_AUTH
        ? new InvalidRequestError('chain_id_zero', 'chain_id must not be 0', opts)
        : new MalformedTransactionError('chain_id_zero', undefined, opts);
    case StatusWord.TXN_INVALID_PROOF_TYPE:
      return new MalformedTransactionError('invalid_fee_payer_state_proof_type', undefined, opts);
    case StatusWord.TXN_ACCOUNT_LIMIT:
      return new MalformedTransactionError('account_count_limit_exceeded', undefined, opts);
    case StatusWord.TXN_DUPLICATE_ACCOUNT:
      return new MalformedTransactionError('duplicate_account', undefined, opts);
    case StatusWord.TXN_UNSORTED_RW:
      return new MalformedTransactionError('unsorted_readwrite_accounts', undefined, opts);
    case StatusWord.TXN_UNSORTED_RO:
      return new MalformedTransactionError('unsorted_readonly_accounts', undefined, opts);
    case StatusWord.TXN_PAD_NONZERO:
      return new MalformedTransactionError('pad_nonzero', undefined, opts);
    case StatusWord.TXN_RW_CACHE_EXCEEDED:
      return new MalformedTransactionError(
        'rw_cache_exceeded',
        'more than 32 read-write accounts together with read-only accounts',
        opts,
      );

    case StatusWord.CHUNK_OUT_OF_ORDER:
      return new ProtocolError('chunk_out_of_order', 'the device saw an unexpected chunk index', opts);
    case StatusWord.LENGTH_MISMATCH:
      return new ProtocolError('length_mismatch', 'streamed message length disagrees with msg_len', opts);
    case StatusWord.MSG_PASS_MISMATCH:
      return new ProtocolError('msg_pass_mismatch', 'message pass 2 differed from pass 1', opts);
    case StatusWord.WRONG_DATA_LENGTH:
      return new ProtocolError('wrong_data_length', 'the device rejected the APDU data length', opts);
    case StatusWord.WRONG_P1P2:
      return new ProtocolError('wrong_p1p2', 'the device rejected P1/P2', opts);

    case StatusWord.MSG_INVALID_LENGTH:
      return new InvalidRequestError('msg_invalid_length', 'message length must be 1..32768 bytes', opts);
    case StatusWord.TOKEN_HINT_MISMATCH:
      return new InvalidRequestError(
        'token_hint',
        "the token hint does not match the transaction's token accounts",
        opts,
      );
    case StatusWord.TXN_HINT_INVALID:
      return new UnsupportedError('the token hint kind', opts);
    case StatusWord.EOA_INVALID_KIND:
      return new InvalidRequestError('eoa_invalid_kind', 'EOA authorization kind must be create or delete', opts);

    case StatusWord.INS_NOT_SUPPORTED:
      return new UnsupportedError('instruction not supported (app too old, or not the Thru app)', opts);
    case StatusWord.CLA_NOT_SUPPORTED:
      return new WrongAppError('cla_not_supported', opts);
    case StatusWord.INTERNAL_ERROR:
      return new DeviceInternalError(opts);
    case StatusWord.SDK_CMD_NOT_ACCEPTED:
      return new DeviceBusyError(opts);
    case StatusWord.SDK_BAD_LEN:
      return new ProtocolError('sdk_bad_len', 'the Ledger SDK rejected the APDU length', opts);

    case StatusWord.OS_DEVICE_LOCKED:
      return new LockedError(opts);
    case StatusWord.OS_APP_NOT_OPEN_6E01:
    case StatusWord.OS_APP_NOT_OPEN_6511:
    case StatusWord.OS_APP_NOT_OPEN_6D02:
      return new WrongAppError('not_open', opts);

    default:
      return new UnknownStatusWordError(sw);
  }
}

/** Human-readable name of a status word, for logs. */
export { statusWordName };
