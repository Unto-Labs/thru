/**
 * Typed errors of the Trezor host. Every error extends {@link TrezorError},
 * which carries a stable `code`; the cases are those of the Rust host
 * (`rpc/thru-trezor/src/error.rs`), plus `aborted`, `closed` and
 * `unsupported_signing_scheme`, which a Rust call cannot have.
 * {@link trezorErrorCode} gives the code the CLI reports for an error
 * (`trezor_error_code` of `rpc/cli/crates/thru-core/src/signing.rs`), and
 * {@link trezorRefusalSentence} the sentence it tells the person for a refusal
 * of the app.
 *
 * `outcomeUnknown` describes one device request. For a request that asks the
 * device to sign, `false` means that nothing of the request was handed to the
 * transport, or that the device answered with a refusal (Core's `Failure`,
 * which is also how the app's refusals and the person's refusal on the device
 * arrive): in both the device released no signature. It does not say that the
 * device computed none (the app signs before its closing screen, and an
 * interruption there also ends as a `Failure`; the signature then never
 * leaves the device). `true` means that something of the request was handed to
 * the transport and the call ended without a refusal and without a usable
 * answer: the person may have approved, the device may have signed, and the
 * host holds no signature. A request is never repeated automatically after
 * such an error (plan B11). The raw channel (`client.channel`, the link's
 * `send` and `receive`) does not classify requests or answers; its one flag is
 * on a `send` whose acknowledgement never came. See the README.
 */

export type TrezorErrorCode =
  | 'transport'
  | 'timeout'
  | 'device_locked'
  | 'protocol'
  | 'unexpected'
  | 'cancelled'
  | 'failure'
  | 'app_refused'
  | 'invalid_request'
  | 'pairing'
  | 'credentials'
  | 'app_image'
  | 'app'
  | 'passphrase_on_device_only'
  | 'key_mismatch'
  | 'unsupported_signing_scheme'
  | 'aborted'
  | 'closed';

export type TrezorErrorOptions = { cause?: unknown; outcomeUnknown?: boolean };

export class TrezorError extends Error {
  readonly code: TrezorErrorCode;
  /**
   * True when something of a request was handed to the transport and the call
   * ended without a refusal and without a usable answer: the device may have
   * acted on it (for a signing request, may have signed) and the host holds no
   * result. False does not mean the device did nothing: after a refusal it
   * released no signature, which is all it says.
   */
  outcomeUnknown: boolean;

  constructor(code: TrezorErrorCode, message: string, options: TrezorErrorOptions = {}) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.outcomeUnknown = options.outcomeUnknown ?? false;
    if (options.cause !== undefined) {
      // ES2022 `Error.cause`, set by hand because the build targets ES2020.
      Object.defineProperty(this, 'cause', { value: options.cause, enumerable: false, writable: true });
    }
  }
}

/**
 * What went wrong on the packet transport. `not_found` and `ambiguous` are
 * the Rust host's cases; the rest are what a browser's USB stack can tell
 * apart: the person closed the picker without choosing (`no_device_chosen`),
 * another program holds the device (`busy`), the system refused access
 * (`access_denied`), the device was unplugged (`disconnected`), the browser
 * has no WebUSB (`unsupported`), or any other failed transfer (`io`).
 */
export type TrezorTransportKind =
  | 'not_found'
  | 'ambiguous'
  | 'io'
  | 'no_device_chosen'
  | 'busy'
  | 'access_denied'
  | 'disconnected'
  | 'unsupported';

/** Every {@link TrezorTransportKind}, for code that reads a kind off an error it does not own. */
export const TRANSPORT_KINDS: readonly TrezorTransportKind[] = [
  'not_found',
  'ambiguous',
  'io',
  'no_device_chosen',
  'busy',
  'access_denied',
  'disconnected',
  'unsupported',
];

/** The kind a transport's own error names, when it names one this host knows. */
export function transportKindOf(error: unknown): TrezorTransportKind | undefined {
  const kind = (error as { kind?: unknown } | null | undefined)?.kind;
  return TRANSPORT_KINDS.find((k) => k === kind);
}

/** The packet transport (USB, UDP) failed. */
export class TrezorTransportError extends TrezorError {
  readonly kind: TrezorTransportKind;

  constructor(message: string, options: TrezorErrorOptions & { kind?: TrezorTransportKind } = {}) {
    super('transport', `Trezor connection: ${message}`, options);
    this.kind = options.kind ?? 'io';
  }
}

/** What a {@link TrezorTimeoutError} waited for. */
export type TrezorTimeoutKind = 'allocation' | 'handshake' | 'ack' | 'answer' | 'busy';

/**
 * The device did not answer in time. The text says what was awaited. `kind`
 * `busy` means the device refused the message every time (it never took it).
 * The client treats it so only for the first message of a request; for a later
 * message of the exchange the device had taken the request, and it marks the
 * error. For every other kind the device may have acted on what was sent.
 */
export class TrezorTimeoutError extends TrezorError {
  readonly kind: TrezorTimeoutKind;

  constructor(waitedFor: string, kind: TrezorTimeoutKind, options?: TrezorErrorOptions) {
    super('timeout', `timed out waiting for the Trezor: ${waitedFor}`, options);
    this.kind = kind;
  }
}

export class TrezorDeviceLockedError extends TrezorError {
  constructor(options?: TrezorErrorOptions) {
    super('device_locked', 'the Trezor is locked: unlock it and try again', options);
  }
}

/** A protocol violation, a cryptographic failure, or a transport error the device reported. */
export class TrezorProtocolError extends TrezorError {
  constructor(message: string, options?: TrezorErrorOptions) {
    super('protocol', `Trezor Host Protocol error: ${message}`, options);
  }
}

/** The device sent a message that could not be decoded, or one the exchange does not allow. */
export class TrezorUnexpectedError extends TrezorError {
  constructor(message: string, options?: TrezorErrorOptions) {
    super('unexpected', `unexpected answer from the Trezor: ${message}`, options);
  }
}

/** The user refused on the device. */
export class TrezorCancelledError extends TrezorError {
  constructor(options?: TrezorErrorOptions) {
    super('cancelled', 'cancelled on the Trezor', options);
  }
}

/** The text with which the device refuses to load an app, whatever the cause. */
export const FAILED_TO_LOAD_APP = 'Failed to load app';

/**
 * What a person can do about a failure whose text is known; empty for any
 * other. The device gives the same text for every refusal of the root packet
 * or of the image, so the sentence names the rollback rule as one cause: a
 * device keeps, across restarts, the timestamp of the newest root packet it
 * accepted and refuses an older one until it is wiped.
 */
export function failureHint(failureMessage: string): string {
  return failureMessage === FAILED_TO_LOAD_APP
    ? '; one cause: a device that has loaded a newer build of the app refuses an older one until it is wiped, so load the newest build; otherwise check that the image, its proof and the root packet are from the same build'
    : '';
}

/** The device answered `Failure`. */
export class TrezorFailureError extends TrezorError {
  readonly failureCode: number;
  readonly failureMessage: string;

  constructor(failureCode: number, failureMessage: string, options?: TrezorErrorOptions) {
    super('failure', `the Trezor reported failure ${failureCode}: ${failureMessage}${failureHint(failureMessage)}`, options);
    this.failureCode = failureCode;
    this.failureMessage = failureMessage;
  }
}

/**
 * The Thru app refused the request: a `DataError` failure whose text is one
 * lower-case token such as `message_not_text`. The token is `reason`.
 */
export class TrezorAppRefusedError extends TrezorError {
  readonly reason: string;

  constructor(reason: string, options?: TrezorErrorOptions) {
    super('app_refused', `the Thru app on the Trezor refused the request: ${reason}`, options);
    this.reason = reason;
  }
}

/**
 * The request was refused on the host, before anything was sent to the
 * device. `reason`, when set, is the token of the app's refusal the host
 * foresaw (`message_not_text`): the app would have answered the same.
 */
export class TrezorInvalidRequestError extends TrezorError {
  readonly reason: string | undefined;

  constructor(message: string, options: TrezorErrorOptions & { reason?: string } = {}) {
    super('invalid_request', `invalid request: ${message}`, options);
    this.reason = options.reason;
  }
}

/** Why a derivation path was refused. */
export type TrezorPathReason =
  | 'depth'
  | 'not_hardened'
  | 'purpose'
  | 'coin_type'
  | 'change'
  | 'syntax'
  | 'not_trezor_uri';

/** A derivation path the Thru app would refuse (the Ledger app's policy), refused on the host. */
export class TrezorPathError extends TrezorInvalidRequestError {
  readonly pathReason: TrezorPathReason;

  constructor(pathReason: TrezorPathReason, message: string) {
    super(message);
    this.pathReason = pathReason;
  }
}

/** Pairing did not complete. `reason` is a stable token for the cases the driver tells apart. */
export class TrezorPairingError extends TrezorError {
  readonly reason: TrezorPairingReason;

  constructor(reason: TrezorPairingReason, message: string, options?: TrezorErrorOptions) {
    super('pairing', `pairing with the Trezor failed: ${message}`, options);
    this.reason = reason;
  }
}

export type TrezorPairingReason =
  | 'low_order_point'
  | 'input_too_long'
  | 'invalid_code'
  | 'wrong_code'
  | 'commitment_mismatch'
  | 'code_mismatch'
  | 'unrecorded_pairing'
  | 'credential_size'
  | 'malformed_key'
  | 'no_method'
  | 'other';

/** The stored pairing credentials could not be read or written. */
export class TrezorCredentialsError extends TrezorError {
  constructor(message: string, options?: TrezorErrorOptions) {
    super('credentials', `Trezor pairing storage: ${message}`, options);
  }
}

/** The app image, its proof or its root packet is missing or malformed. */
export class TrezorAppImageError extends TrezorError {
  constructor(message: string, options?: TrezorErrorOptions) {
    super('app_image', `Thru app image: ${message}`, options);
  }
}

/** The Thru app answered something its protocol does not allow. */
export class TrezorAppError extends TrezorError {
  constructor(message: string, options?: TrezorErrorOptions) {
    super('app', `the Thru app on the Trezor misbehaved: ${message}`, options);
  }
}

/** The device returned a signature that does not verify under its key. Never use it. */
export class TrezorInvalidSignatureError extends TrezorAppError {
  constructor(options?: TrezorErrorOptions) {
    super('the signature the device returned does not verify', options);
  }
}

/**
 * The device's key is not the one that was expected (another device, seed or
 * passphrase), or is not the fee payer of the transaction.
 */
export class TrezorKeyMismatchError extends TrezorError {
  /** The `ta...` address that was expected. */
  readonly expected: string;
  /** The `ta...` address the device has. */
  readonly got: string;

  /**
   * `passphraseWallet` says that the key belongs to a passphrase wallet (the
   * session was opened for a passphrase typed on the device): the text then
   * adds that another passphrase may have been typed, as the CLI does.
   */
  constructor(expected: string, got: string, options: TrezorErrorOptions & { passphraseWallet?: boolean } = {}) {
    super(
      'key_mismatch',
      `the Trezor's key is ${got}, expected ${expected}${options.passphraseWallet === true ? KEY_MISMATCH_PASSPHRASE_HINT : ''}`,
      options,
    );
    this.expected = expected;
    this.got = got;
  }
}

/** What a key mismatch of a passphrase wallet adds (the CLI's `trezor_key_error`). */
const KEY_MISMATCH_PASSPHRASE_HINT =
  '; this key belongs to a passphrase wallet, so another passphrase may have been typed on the Trezor';

/** The network does not use RFC 8032 signatures, the only scheme the Trezor app signs with. */
export class TrezorUnsupportedSigningSchemeError extends TrezorError {
  /** The scheme that was refused, or `undefined` if none was given. */
  readonly scheme: string | undefined;

  constructor(scheme: string | undefined) {
    super(
      'unsupported_signing_scheme',
      scheme === undefined
        ? 'Trezor signing requires an RFC-8032 network, and the signer was not told the network signing scheme. Pass transactionSigningScheme (thru.ctx.transactionSigningScheme).'
        : `Trezor signing requires an RFC-8032 network; this network is configured for the "${scheme}" signing scheme.`,
    );
    this.scheme = scheme;
  }
}

/**
 * Refuses, before the device is used, unless the network is known to use the
 * RFC 8032 scheme (`'rfc8032'` is `TransactionSigningScheme.Rfc8032` of
 * `@thru/sdk`; the literal keeps this module free of the SDK).
 */
export function assertTrezorSigningScheme(scheme: string | undefined): void {
  if (scheme !== 'rfc8032') throw new TrezorUnsupportedSigningSchemeError(scheme);
}

/** The device takes the passphrase on the device only and refused a session that carried one. */
export class TrezorPassphraseOnDeviceOnlyError extends TrezorError {
  constructor(options?: TrezorErrorOptions) {
    super(
      'passphrase_on_device_only',
      'the Trezor is set to take the passphrase on the device only, and refused a passphrase sent by the computer (also an empty one)',
      options,
    );
  }
}

/** The caller's `AbortSignal` fired. */
export class TrezorAbortedError extends TrezorError {
  constructor(options?: TrezorErrorOptions) {
    super('aborted', 'the request was aborted', options);
  }
}

/** The connection was closed (by the caller, by an abort, or by a fatal error). */
export class TrezorClosedError extends TrezorError {
  constructor(options?: TrezorErrorOptions) {
    super('closed', 'the Trezor connection is closed', options);
  }
}

/** `Failure.code` values of Trezor's `messages-common.proto` the host names. */
export const FailureCode = {
  UnexpectedMessage: 1,
  DataError: 3,
  ActionCancelled: 4,
  PinCancelled: 6,
  ProcessError: 9,
  NotInitialized: 11,
  FirmwareError: 99,
} as const;

/** One or more of `a-z`, `0-9` and `_`, as the app's refusal reasons are. */
function isReasonToken(text: string): boolean {
  return /^[a-z0-9_]+$/.test(text);
}

/** The error for a `Failure` message; the user's refusal becomes `TrezorCancelledError`. */
export function errorFromFailure(code: number | undefined, message: string | undefined): TrezorError {
  const c = code ?? 0;
  if (c === FailureCode.ActionCancelled || c === FailureCode.PinCancelled) {
    return new TrezorCancelledError();
  }
  return new TrezorFailureError(c, message ?? '');
}

/**
 * Turns a `DataError` failure whose text is one lower-case token (the form of
 * the Thru app's refusals) into {@link TrezorAppRefusedError}. Any other error
 * is returned as it is.
 */
export function intoAppRefusal(error: unknown): unknown {
  if (
    error instanceof TrezorFailureError &&
    error.failureCode === FailureCode.DataError &&
    isReasonToken(error.failureMessage)
  ) {
    return new TrezorAppRefusedError(error.failureMessage);
  }
  return error;
}

const PASSPHRASE_ALWAYS_ON_DEVICE = 'PASSPHRASE_ALWAYS_ON_DEVICE';

/**
 * Turns the failure of a session request into
 * {@link TrezorPassphraseOnDeviceOnlyError} when it is the refusal of a device
 * set to "passphrase always on device": a `DataError` whose text names that
 * setting. Anything else is returned as it is.
 */
export function intoSessionRefusal(error: unknown): unknown {
  if (
    error instanceof TrezorFailureError &&
    error.failureCode === FailureCode.DataError &&
    error.failureMessage.includes(PASSPHRASE_ALWAYS_ON_DEVICE)
  ) {
    return new TrezorPassphraseOnDeviceOnlyError();
  }
  return error;
}

/** What a message must be for a Trezor to sign it (the rule of `messageDisplayMode` of `@thru/ledger/protocol`, which the app applies too). */
export const TREZOR_TEXT_RULE =
  '1 to 512 bytes of printable ASCII and line breaks, at most 16 lines, no space at the start or end of a line, no two spaces in a row, and no long run of one-character words separated by single spaces';

/** The code the CLI reports for a Trezor error (`trezor_error_code`); the two it has no case for are `aborted` and `closed`. */
export type TrezorCliCode =
  | 'user_rejected'
  | 'not_found'
  | 'ambiguous_device'
  | 'transport'
  | 'timeout'
  | 'locked'
  | 'protocol_error'
  | 'device_error'
  | 'app_refused'
  | 'invalid_request'
  | 'passphrase_on_device_only'
  | 'pairing_failed'
  | 'credentials'
  | 'app_image'
  | 'key_mismatch'
  | 'unsupported_signing_scheme'
  | 'aborted'
  | 'closed';

/** The CLI's stable machine-readable class of `error`. */
export function trezorErrorCode(error: TrezorError): TrezorCliCode {
  switch (error.code) {
    case 'cancelled':
      return 'user_rejected';
    case 'transport':
      if (error instanceof TrezorTransportError) {
        if (error.kind === 'not_found' || error.kind === 'no_device_chosen') return 'not_found';
        if (error.kind === 'ambiguous') return 'ambiguous_device';
      }
      return 'transport';
    case 'timeout':
      return 'timeout';
    case 'device_locked':
      return 'locked';
    case 'protocol':
    case 'unexpected':
    case 'app':
      return 'protocol_error';
    case 'failure':
      return 'device_error';
    case 'pairing':
      return 'pairing_failed';
    case 'app_refused':
    case 'invalid_request':
    case 'passphrase_on_device_only':
    case 'credentials':
    case 'app_image':
    case 'key_mismatch':
    case 'unsupported_signing_scheme':
    case 'aborted':
    case 'closed':
      return error.code;
  }
}

/**
 * What the Thru app's refusal `reason` means for the person at the keyboard
 * (`trezor_refusal_sentence` of the CLI). A reason this host does not know is
 * passed on as the app gave it.
 */
export function trezorRefusalSentence(reason: string): string {
  switch (reason) {
    case 'message_not_text':
      return `the Trezor signs a message only if it can show it as text: ${TREZOR_TEXT_RULE}; sign other messages with a local or a Ledger key`;
    case 'token_hint_length':
      return 'the Thru app on the Trezor refused the token hint: it is not 129 bytes long (this is a fault of the host; report it)';
    case 'token_hint_kind':
      return 'the Thru app on the Trezor refused the token hint: it is not a token transfer hint (this is a fault of the host; report it)';
    case 'token_hint_mismatch':
      return 'the Thru app on the Trezor refused the token hint: the mint and the owners in it do not derive the token accounts of this transaction, or the transaction is not a token transfer';
    case 'unsupported_transaction':
      return 'the Thru app on the Trezor does not sign this transaction: it signs only native transfers, token transfers in the layout the Thru tools build, wallet-program transfers whose accounts are exactly the wallet account and the recipient, and the creation of the signing account';
    case 'fee_payer_mismatch':
      return "the transaction's fee payer is not the key of this Trezor; the Trezor signs only transactions that this key pays for";
    default:
      return `the Thru app on the Trezor refused the request: ${reason}`;
  }
}
