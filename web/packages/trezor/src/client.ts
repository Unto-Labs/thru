/**
 * A connected Trezor: pairing, one session, and request/answer calls that
 * answer button requests and turn failures into typed errors. Ported from
 * `rpc/thru-trezor/src/client.rs`.
 *
 * Calls are serialized (one request is in flight on the channel at a time),
 * take an `AbortSignal`, and are never repeated automatically: an error raised
 * after a request was written to the device says `outcomeUnknown`, because the
 * device may have acted on it (plan B11). For a request that asks the device to
 * sign this covers every failure, an answer that cannot be used included,
 * except a refusal: after a refusal the device released no signature.
 */
import { copyBytes } from './bytes';
import { abortable, systemClock, type Clock } from './clock';
import {
  checkRecord,
  isOwnStoreError,
  MAX_CREDENTIAL_LEN,
  type CredentialRecord,
  type CredentialStore,
} from './credentials';
import {
  errorFromFailure,
  FailureCode,
  intoSessionRefusal,
  TrezorAbortedError,
  TrezorClosedError,
  TrezorCredentialsError,
  TrezorError,
  TrezorFailureError,
  TrezorPairingError,
  TrezorTimeoutError,
  TrezorUnexpectedError,
} from './errors';
import {
  ButtonAck,
  ButtonRequest,
  ExtAppMessage,
  Failure,
  SignEoaAuth,
  SignMessage,
  SignTx,
  Success,
  ThpCodeEntryChallenge,
  ThpCodeEntryCommitment,
  ThpCodeEntryCpaceHostTag,
  ThpCodeEntryCpaceTrezor,
  ThpCodeEntrySecret,
  ThpCreateNewSession,
  ThpCredentialRequest,
  ThpCredentialResponse,
  ThpEndRequest,
  ThpEndResponse,
  ThpPairingRequest,
  ThpPairingRequestApproved,
  ThpSelectMethod,
  TxDataAck,
  type MessageCodec,
} from './messages';
import { CHALLENGE_LEN, cpaceExchange, isPairingCode, verifyCodeEntry } from './pairing';
import { randomBytes } from './thp/node-shims';
import { Link, type DeviceProperties } from './thp/link';
import type { Transport } from './transport';

/** How long a call waits for the device. A person may be reading its screen. */
export const CALL_TIMEOUT_MS = 5 * 60 * 1000;
/**
 * How many button requests one call answers. A signing review is a handful of
 * screens; without a cap a device (or something posing as one) could keep a
 * call open for ever by asking again before each timeout.
 */
export const MAX_BUTTON_REQUESTS = 64;

/** Messages of the pairing phase travel on session 0; the session this package creates is 1. */
const PAIRING_SESSION = 0;
const SESSION_ID = 1;

const PAIRING_METHOD_SKIP = 1;
const PAIRING_METHOD_CODE_ENTRY = 2;
/** `ButtonRequestType.PassphraseEntry`: the person is typing the passphrase on the device. */
const BUTTON_REQUEST_PASSPHRASE_ENTRY = 19;

const MSG_FAILURE = Failure.id as number;
const MSG_BUTTON_REQUEST = ButtonRequest.id as number;

/** What the connection needs from the person at the screen. */
export type TrezorUi = {
  /** The six digits the device shows during code-entry pairing. */
  pairingCode(): string | Promise<string>;
  /** The device waits for the person to confirm on its screen. */
  confirmOnDevice?(): void;
  /**
   * The person types the passphrase on the device. Defaults to
   * {@link TrezorUi.confirmOnDevice}.
   */
  enterPassphraseOnDevice?(): void;
};

export type ConnectOptions = {
  /** What the device shows when it asks the person to allow the connection. */
  hostName: string;
  appName: string;
  credentialStore: CredentialStore;
  ui: TrezorUi;
  /**
   * Opens the session of a passphrase (hidden) wallet whose passphrase the
   * person types on the device; the computer never sees it. Off by default:
   * the session is then the standard wallet, opened with the empty passphrase.
   */
  passphraseOnDevice?: boolean;
  /**
   * Pairs without a code if the device offers that. Honoured only on a
   * transport that says it is the emulator's; on any other it changes nothing.
   */
  allowSkipPairing?: boolean;
  clock?: Clock;
  signal?: AbortSignal;
};

export type CallOptions = { signal?: AbortSignal };

/**
 * Whether the handshake leaves this host paired, so that pairing is not run.
 *
 * The device's pairing state is only a claim. It is believed when a
 * credential stored on this computer matched in the handshake. A device that
 * claims a pairing when nothing matched is not believed, and is an error: a
 * genuine device answers "unpaired" to a host key it never issued a credential
 * for.
 */
export function alreadyPaired(deviceClaimsPaired: boolean, credentialMatched: boolean): boolean {
  if (!deviceClaimsPaired) return false;
  if (credentialMatched) return true;
  throw new TrezorPairingError(
    'unrecorded_pairing',
    'the device claims a pairing this computer has no record of (no stored credential matched); refusing to go on. Pair this device from this computer again, or remove the device\'s entry for it if the claim is unexpected',
  );
}

/** Pairing without a code is used only when the caller asked for it and the transport is the emulator's. */
export function skipPairingAllowed(optionSet: boolean, transportIsEmulator: boolean): boolean {
  return optionSet && transportIsEmulator;
}

export class TrezorClient {
  private session = PAIRING_SESSION;
  private instance?: number;
  /** Settles when every call started so far is over; it never rejects. */
  private tail: Promise<void> = Promise.resolve();

  private constructor(
    private readonly link: Link,
    private readonly ui: TrezorUi,
  ) {}

  /**
   * Opens a channel on `transport`, pairs if the device does not know this
   * host, and creates a session: the standard wallet, or, with
   * `passphraseOnDevice`, the wallet of a passphrase typed on the device.
   *
   * Pairing by code entry stores the credential the device issues in the
   * credential store; the next connection finds it there and does not pair
   * again.
   */
  static async connect(transport: Transport, connectOptions: ConnectOptions): Promise<TrezorClient> {
    // Everything the call is given is read here, once: the credential load, the
    // handshake and the pairing wait for the device and for the person, and the
    // caller may change its options object meanwhile.
    const options: ConnectOptions = {
      hostName: connectOptions.hostName,
      appName: connectOptions.appName,
      credentialStore: connectOptions.credentialStore,
      ui: connectOptions.ui,
      passphraseOnDevice: connectOptions.passphraseOnDevice,
      allowSkipPairing: connectOptions.allowSkipPairing,
      clock: connectOptions.clock,
      signal: connectOptions.signal,
    };
    const emulator = transport.isEmulator === true;
    const clock = options.clock ?? systemClock;
    let known: CredentialRecord[];
    try {
      known = await options.credentialStore.load();
    } catch (error) {
      await transport.close().catch(() => undefined);
      throw wrapStoreError(error, 'the credentials could not be read');
    }
    const link = await Link.open(transport, { clock, knownCredentials: known, signal: options.signal });
    const client = new TrezorClient(link, options.ui);
    try {
      await client.pair(options, emulator);
      client.session = SESSION_ID;
      const request: ThpCreateNewSession = options.passphraseOnDevice
        ? { on_device: true }
        : { passphrase: '' };
      try {
        await client.callOn(SESSION_ID, ThpCreateNewSession, request, Success, { signal: options.signal });
      } catch (error) {
        throw intoSessionRefusal(error);
      }
    } catch (error) {
      await client.close();
      throw error;
    }
    return client;
  }

  /** What the device said about itself before the handshake. */
  get properties(): DeviceProperties {
    return this.link.properties;
  }

  /** The link, for diagnostics and tests. */
  get channel(): Link {
    return this.link;
  }

  get isClosed(): boolean {
    return this.link.isClosed;
  }

  /** The instance id of the app loaded on this connection, if one was. */
  get loadedApp(): number | undefined {
    return this.instance;
  }

  /** Records that the app is loaded as `instanceId`; closing the client forgets it. */
  setLoadedApp(instanceId: number): void {
    this.instance = instanceId;
  }

  /** Closes the connection: cancels the read, releases the device, forgets channel, session and loaded app. */
  async close(): Promise<void> {
    this.instance = undefined;
    this.session = PAIRING_SESSION;
    await this.link.close();
  }

  // ---- pairing ----

  private async pair(options: ConnectOptions, transportIsEmulator: boolean): Promise<void> {
    const signal = options.signal;
    if (alreadyPaired(this.link.pairingState !== 'unpaired', this.link.credentialMatched)) {
      await this.callOn(PAIRING_SESSION, ThpEndRequest, {}, ThpEndResponse, { signal });
      return;
    }
    await this.callOn(
      PAIRING_SESSION,
      ThpPairingRequest,
      { host_name: options.hostName, app_name: options.appName },
      ThpPairingRequestApproved,
      { signal },
    );
    const methods = this.link.properties.pairingMethods;
    if (
      skipPairingAllowed(options.allowSkipPairing === true, transportIsEmulator) &&
      methods.includes(PAIRING_METHOD_SKIP)
    ) {
      await this.callOn(
        PAIRING_SESSION,
        ThpSelectMethod,
        { selected_pairing_method: PAIRING_METHOD_SKIP },
        ThpEndResponse,
        { signal },
      );
      return;
    }
    if (methods.includes(PAIRING_METHOD_CODE_ENTRY)) {
      await this.pairByCodeEntry(options);
      return;
    }
    throw new TrezorPairingError('no_method', 'the device offers no pairing method this host can do');
  }

  /**
   * Pairing by the code the device shows, as trezorlib's `CodeEntry`, then the
   * credential request, then the end of pairing.
   *
   * The device commits to a secret; the host sends a random challenge; the
   * device derives the six digits from the handshake hash, its secret and the
   * challenge, shows them, and runs CPace with them as the password. The host
   * types the digits, runs CPace, and proves it knows them with a tag; only
   * then does the device reveal its secret, and the host checks that the
   * digits it was given are the ones the secret yields.
   */
  private async pairByCodeEntry(options: ConnectOptions): Promise<void> {
    const signal = options.signal;
    const commitment = await this.callOn(
      PAIRING_SESSION,
      ThpSelectMethod,
      { selected_pairing_method: PAIRING_METHOD_CODE_ENTRY },
      ThpCodeEntryCommitment,
      { signal },
    );
    const challenge = Uint8Array.from(randomBytes(CHALLENGE_LEN));
    const trezorKey = await this.callOn(
      PAIRING_SESSION,
      ThpCodeEntryChallenge,
      { challenge },
      ThpCodeEntryCpaceTrezor,
      { signal },
    );
    if (trezorKey.cpace_trezor_public_key.length !== 32) {
      throw new TrezorPairingError('malformed_key', 'the device sent a malformed CPace key');
    }

    // The person may take a long time: an abort ends the wait, not only the calls.
    const code = await abortable(Promise.resolve(this.ui.pairingCode()), signal, () => new TrezorAbortedError());
    if (!isPairingCode(code)) {
      throw new TrezorPairingError('invalid_code', 'the pairing code is 6 digits');
    }
    const handshakeHash = this.link.handshakeHash;
    const exchange = cpaceExchange(code, handshakeHash, trezorKey.cpace_trezor_public_key);
    let secret: ThpCodeEntrySecret;
    try {
      secret = await this.callOn(
        PAIRING_SESSION,
        ThpCodeEntryCpaceHostTag,
        { cpace_host_public_key: exchange.hostPublicKey, tag: exchange.tag },
        ThpCodeEntrySecret,
        { signal },
      );
    } catch (error) {
      throw wrongCode(error);
    }
    verifyCodeEntry({ handshakeHash, commitment: commitment.commitment, challenge }, code, secret.secret);

    await this.requestCredential(options);
    await this.callOn(PAIRING_SESSION, ThpEndRequest, {}, ThpEndResponse, { signal });
  }

  /** Asks the device for a credential for this channel's host key and keeps it in the store. */
  private async requestCredential(options: ConnectOptions): Promise<void> {
    const privateKey = this.link.hostStaticPrivateKey;
    const response = await this.callOn(
      PAIRING_SESSION,
      ThpCredentialRequest,
      { host_static_public_key: this.link.hostStaticPublicKey, autoconnect: false },
      ThpCredentialResponse,
      { signal: options.signal },
    );
    if (response.trezor_static_public_key.length !== 32) {
      throw new TrezorPairingError('malformed_key', 'the device sent a malformed static key');
    }
    if (response.credential.length === 0 || response.credential.length > MAX_CREDENTIAL_LEN) {
      throw new TrezorPairingError(
        'credential_size',
        `the credential has ${response.credential.length} bytes, this host can keep 1 to ${MAX_CREDENTIAL_LEN}`,
      );
    }
    // The store gets bytes of its own: `privateKey` is wiped below, and a store that keeps the arrays it is given must not see that.
    const record: CredentialRecord = {
      trezorStaticPubkey: copyBytes(response.trezor_static_public_key),
      hostStaticPrivkey: copyBytes(privateKey),
      credential: copyBytes(response.credential),
    };
    try {
      checkRecord(record);
      await options.credentialStore.store(record);
    } catch (error) {
      throw wrapStoreError(error, 'the credential could not be stored');
    } finally {
      privateKey.fill(0);
    }
  }

  // ---- calls ----

  /**
   * Sends `request` on the current session and returns the answer, which must
   * be an `answer`. Button requests are acknowledged on the way (the person
   * confirms on the device), a `Failure` becomes an error.
   */
  call<Q extends object, A extends object>(
    requestCodec: MessageCodec<Q>,
    request: Q,
    answerCodec: MessageCodec<A>,
    options: CallOptions = {},
  ): Promise<A> {
    return this.callOn(this.session, requestCodec, request, answerCodec, options);
  }

  /**
   * As {@link call}, with the answer's id and payload left undecoded. The
   * payload is copied at the call: the request waits behind the ones before
   * it, and what the caller holds may change by then.
   */
  callAny(id: number, payload: Uint8Array, options: CallOptions = {}): Promise<{ id: number; payload: Uint8Array }> {
    const session = this.session;
    const bytes = copyBytes(payload);
    const signing = asksToSign(id, bytes);
    // The signal is taken once: the call may wait, and the object it came in may change meanwhile.
    const signal = options.signal;
    return this.serial(signal, () => this.exchange(session, id, bytes, signal, signing, (answer) => answer));
  }

  private callOn<Q extends object, A extends object>(
    session: number,
    requestCodec: MessageCodec<Q>,
    request: Q,
    answerCodec: MessageCodec<A>,
    options: CallOptions,
  ): Promise<A> {
    // Everything the call needs from the two codecs is read here, once: the
    // request waits behind the calls before it, and a codec is the caller's.
    const signal = options.signal;
    let requestId: number;
    let payload: Uint8Array;
    let requestName: string;
    let answerId: number;
    let answerName: string;
    let decode: (bytes: Uint8Array) => A;
    try {
      requestId = requestCodec.id as number;
      requestName = requestCodec.name;
      answerId = answerCodec.id as number;
      answerName = answerCodec.name;
      const decoder = answerCodec.decode;
      decode = (bytes) => decoder.call(answerCodec, bytes);
      // What the codec returns is copied: it may keep the array and change it later.
      payload = copyBytes(requestCodec.encode(request));
    } catch (error) {
      return Promise.reject(error);
    }
    const signing = asksToSign(requestId, payload);
    return this.serial(signal, () =>
      this.exchange(session, requestId, payload, signal, signing, (answer) => {
        if (answer.id !== answerId) {
          throw new TrezorUnexpectedError(
            `answer to ${requestName} is message ${answer.id}, expected ${answerName} (${answerId})`,
          );
        }
        try {
          return decode(answer.payload);
        } catch (cause) {
          throw new TrezorUnexpectedError(`${answerName} could not be decoded`, { cause });
        }
      }),
    );
  }

  /**
   * One request at a time on the channel: a call waits for the ones before it.
   * A `signal` that fires during the wait ends the call at once, with nothing
   * sent; the calls behind it still wait for the ones before it, in order.
   */
  private serial<T>(signal: AbortSignal | undefined, run: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    return (async (): Promise<T> => {
      try {
        await abortable(previous, signal, () => new TrezorAbortedError());
        if (this.link.isClosed) throw new TrezorClosedError();
        if (signal?.aborted === true) throw new TrezorAbortedError();
        return await run();
      } finally {
        // The next call starts when this one is over and the one before it is too (a call cut off while it waited never ran).
        void previous.then(release);
      }
    })();
  }

  /**
   * One request and its answer. `use` turns the answer into what the caller
   * wants (checks its id, decodes it); it runs inside the error boundary, so
   * an answer that cannot be used ends the call as any failure does.
   */
  private async exchange<T>(
    session: number,
    id: number,
    payload: Uint8Array,
    signal: AbortSignal | undefined,
    signing: boolean,
    use: (answer: { id: number; payload: Uint8Array }) => T,
  ): Promise<T> {
    // A `Failure` is the device's clean answer and leaves the connection as it
    // was. Any other error leaves a request in flight, a button request
    // unanswered, the link broken or an answer that cannot be used: the
    // connection is closed, and the error says the outcome is unknown when the
    // device may have acted.
    let answered = false;
    let unusable = false;
    // Whether the device took the first message of the request (acknowledged it).
    let taken = false;
    const writesBefore = this.link.writesStarted;
    try {
      await this.link.send(session, id, payload, signal);
      taken = true;
      let buttonRequests = 0;
      for (;;) {
        const message = await this.link.receive(CALL_TIMEOUT_MS, 'an answer from the device', signal);
        if (message.session !== session) {
          throw new TrezorUnexpectedError(
            `message ${message.messageType} for session ${message.session}, expected session ${session}`,
          );
        }
        if (message.messageType === MSG_BUTTON_REQUEST) {
          buttonRequests++;
          if (buttonRequests > MAX_BUTTON_REQUESTS) {
            throw new TrezorUnexpectedError(
              `the device asked for more than ${MAX_BUTTON_REQUESTS} confirmations in one request; giving up`,
            );
          }
          this.notifyUi(message.payload);
          await this.link.send(session, ButtonAck.id as number, ButtonAck.encode({}), signal);
        } else if (message.messageType === MSG_FAILURE) {
          let failure: Failure;
          // The device answered; an answer that cannot be read is not a sign that it acted on the request.
          unusable = true;
          try {
            failure = Failure.decode(message.payload);
          } catch (cause) {
            throw new TrezorUnexpectedError('Failure could not be decoded', { cause });
          }
          answered = true;
          throw errorFromFailure(failure.code, failure.message);
        } else {
          unusable = true;
          const result = use({ id: message.messageType, payload: message.payload });
          unusable = false;
          return result;
        }
      }
    } catch (error) {
      if (!answered) {
        // Nothing of the request reached the device if no packet of it was written (a payload too large for a frame, a closed link).
        if (error instanceof TrezorError && this.link.writesStarted > writesBefore) {
          if (taken && isBusyTimeout(error)) {
            // The device took the request and then refused a later message of the exchange (the answer to a review screen): it is not a refusal of the request.
            error.outcomeUnknown = true;
          } else if (signing) markSigningOutcome(error);
          else if (!unusable) markOutcome(error);
        }
        await this.close();
      }
      throw error;
    }
  }

  /**
   * Tells the person what the device waits for. The callbacks only report: a
   * callback that throws, or returns a promise (or another thenable) that
   * rejects, does not end the exchange, as the device may be waiting for the
   * answer to this very screen. No callback whose result the client needs
   * (the pairing code) runs here.
   */
  private notifyUi(buttonRequest: Uint8Array): void {
    let code: number | undefined;
    try {
      code = ButtonRequest.decode(buttonRequest).code;
    } catch {
      code = undefined;
    }
    const ui = this.ui;
    try {
      const callback = code === BUTTON_REQUEST_PASSPHRASE_ENTRY ? (ui.enterPassphraseOnDevice ?? ui.confirmOnDevice) : ui.confirmOnDevice;
      ignoreOutcome(callback?.call(ui));
    } catch {
      // The application's status line failed; the exchange goes on.
    }
  }
}

/**
 * Drops what a notification callback returned. A promise or another thenable
 * is not awaited, and its rejection (or a `then` that throws) must not become
 * an unhandled one.
 */
function ignoreOutcome(result: unknown): void {
  if (typeof result !== 'object' || result === null) return;
  try {
    if (typeof (result as { then?: unknown }).then === 'function') Promise.resolve(result).catch(() => undefined);
  } catch {
    // A getter or a `then` that throws is the application's.
  }
}

/**
 * An error after the first packet of the request was written: something of it
 * may have reached the device, so the device may have acted on it, unless it
 * never took it. This is conservative: a request cut off after some packets
 * is marked although the device cannot have taken an incomplete message.
 */
function markOutcome(error: TrezorError): void {
  if (isBusyTimeout(error)) return;
  if (
    error.code === 'timeout' ||
    error.code === 'aborted' ||
    error.code === 'transport' ||
    error.code === 'closed' ||
    error.code === 'protocol' ||
    error.code === 'unexpected'
  ) {
    error.outcomeUnknown = true;
  }
}

/** A time-out of the back-off after the device answered `busy`: it refused the message every time. */
function isBusyTimeout(error: unknown): boolean {
  return error instanceof TrezorTimeoutError && error.kind === 'busy';
}

/**
 * Marks the error of a request that asks the device to sign, after the first
 * packet of the request was written. `outcomeUnknown: true` means that
 * something of the request was handed to the transport and the call ended
 * without a refusal and without a usable answer: the person may have approved
 * and the device may have signed, and the host holds no signature. An error
 * that is a refusal ({@link isRefusal}) is left as it is: the device released
 * no signature. That is not the same as the device having computed none (the
 * app signs before its closing screen, and an interruption there also ends as
 * a `Failure`), but no signature exists outside the device, so the outcome is
 * known.
 */
export function markSigningOutcome(error: unknown): void {
  if (!(error instanceof TrezorError) || isRefusal(error)) return;
  error.outcomeUnknown = true;
}

/**
 * Whether `error` is a refusal: Core's `Failure` (which is also how the app's
 * refusals and the person's refusal on the device arrive), a locked device, or
 * a device that stayed busy for the first message of the request. In each the
 * device released no signature. A busy time-out already marked as unknown (a
 * later message of the exchange was refused after the device took the request)
 * is not a refusal.
 */
export function isRefusal(error: unknown): boolean {
  if (!(error instanceof TrezorError)) return false;
  if (isBusyTimeout(error)) return !error.outcomeUnknown;
  return error.code === 'failure' || error.code === 'app_refused' || error.code === 'cancelled' || error.code === 'device_locked';
}

/**
 * Whether the request `payload` of Core message `id` asks the Thru app to sign:
 * an `ExtAppMessage` that carries `SignTx`, `TxDataAck` (the pieces of the
 * body), `SignMessage` or `SignEoaAuth`.
 */
function asksToSign(id: number, payload: Uint8Array): boolean {
  if (id !== (ExtAppMessage.id as number)) return false;
  try {
    const appId = ExtAppMessage.decode(payload).message_id;
    return appId === SignTx.id || appId === TxDataAck.id || appId === SignMessage.id || appId === SignEoaAuth.id;
  } catch {
    return false;
  }
}

/**
 * What the device answers to a wrong code is `Failure(DataError, "Unexpected
 * Code Entry Tag")`: the CPace tag of a host that typed other digits does not
 * match.
 */
function wrongCode(error: unknown): unknown {
  if (
    error instanceof TrezorFailureError &&
    error.failureCode === FailureCode.DataError &&
    error.failureMessage.includes('Code Entry Tag')
  ) {
    return new TrezorPairingError(
      'wrong_code',
      'the code is wrong: it is not the one the Trezor shows (pair again and type the digits of the new screen)',
    );
  }
  return error;
}

/**
 * What a failure of the credential store becomes. Only an error that carries
 * the mark of this package's own stores keeps its text: the credential file's
 * and IndexedDB's, whose words name a path or a database and never a record,
 * and the size check of a record (those are already a credentials error and
 * pass as they are). Anything else comes from a store the application wrote,
 * whatever its class: it may hold a record in its message or its cause (a
 * parser error quotes the text it choked on, and an application may wrap one
 * in an error class of this package), so only the operation and the error's
 * class name, when that is one of a fixed list, are kept.
 */
function wrapStoreError(error: unknown, what: string): TrezorError {
  if (isOwnStoreError(error)) {
    if (error instanceof TrezorError) return error;
    return new TrezorCredentialsError(`${what}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  const name = plainClassName(error);
  return new TrezorCredentialsError(`${what} (the credential store ${name === undefined ? 'failed' : `threw ${name}`})`);
}

/**
 * The names of error classes a store's error may keep in a diagnostic. An
 * identifier is not a redaction rule (a 64-character key is one), so a name
 * not on this list is dropped. The list is the classes of the language and
 * `DOMException`, with `SecurityError`, the name the built-in stores' tests
 * give a failing IndexedDB.
 */
const KEPT_ERROR_NAMES: ReadonlySet<string> = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'SyntaxError',
  'ReferenceError',
  'EvalError',
  'URIError',
  'AggregateError',
  'DOMException',
  'SecurityError',
]);

/** The `name` of a thrown object when it is one of {@link KEPT_ERROR_NAMES}; nothing otherwise. */
function plainClassName(error: unknown): string | undefined {
  try {
    if (typeof error !== 'object' || error === null) return undefined;
    const name = (error as { name?: unknown }).name;
    return typeof name === 'string' && KEPT_ERROR_NAMES.has(name) ? name : undefined;
  } catch {
    return undefined;
  }
}
