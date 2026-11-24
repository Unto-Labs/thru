/**
 * Promise-based Thru signer on a Trezor: the contract of `ThruLedgerSigner`
 * (`getAddress`, `signTransactionBody`, `signMessage`, `signEoaAuth`, with its
 * option and result types) on top of the Thru app's requests.
 *
 * ```ts
 * const signer = await ThruTrezorSigner.connect({
 *   transport, credentialStore, image,
 *   hostName: 'My wallet', appName: 'thru',
 *   ui: { pairingCode: () => askForTheSixDigits() },
 *   transactionSigningScheme: thru.ctx.transactionSigningScheme,
 * });
 * const { publicKey } = await signer.getAddress("m/44'/8478'/0'/0'", { display: true });
 * const { signedTransaction } = await signer.signTransactionBody(path, body);
 * ```
 *
 * What it does around the device, as the Ledger signer does:
 *
 * - `transactionSigningScheme` is required, and anything but RFC 8032 is
 *   refused before the device is used.
 * - The caller's inputs (path, body, message, keys, hint) are copied before
 *   the first asynchronous step: what is sent is what the arguments held at
 *   the call.
 * - What the host can know is refused before the device is asked to sign: a
 *   path outside the policy, a message of the wrong length or not text, a
 *   zero chain id, a hint that is not 129 bytes, a transaction whose fee
 *   payer is not the device's key, an authorization for another account.
 * - The device's public key is read first (without a screen) and compared with
 *   the one expected, and its address with the key's.
 * - Every signature is verified, with its signing domain, before a result is
 *   returned.
 * - Every call takes an `AbortSignal`. A signing request is never repeated
 *   after an abort or a timeout, or after an answer that cannot be used: the
 *   error says `outcomeUnknown` (a refusal of the device or the app is the
 *   one failure that does not: the device released no signature). A signature
 *   that fails verification is marked and leaves the connection open: the
 *   answer was whole, and the stream is in step.
 *
 * Prompts reach the person through the callbacks given at connect
 * ({@link TrezorUi}: type the pairing code, confirm on the device, enter the
 * passphrase on the device).
 */
import {
  computeBodyHashDisplay,
  encodeTokenHint,
  thruAddress,
  type TokenHint,
} from '@thru/ledger/protocol';
import {
  attachTransactionSignature,
  buildTransactionSigningMessage,
  eoa,
  SignatureDomain,
  verifyMessage,
  verifyWithDomain,
  type TransactionSigningScheme,
} from '@thru/sdk';

import {
  checkEoaChainId,
  checkMessage,
  eoaKindCode,
  EoaAuthKind,
  PUBLIC_KEY_LEN,
  ThruApp,
  TOKEN_HINT_LEN,
  type AppCallOptions,
  type EoaAuthKindInput,
} from './app';
import { TrezorClient, type ConnectOptions } from './client';
import {
  assertTrezorSigningScheme,
  TrezorAbortedError,
  TrezorClosedError,
  TrezorInvalidRequestError,
  TrezorInvalidSignatureError,
  TrezorKeyMismatchError,
  TrezorAppError,
} from './errors';
import { copyAppImage, type AppImage } from './extapp';
import { copyBytes, equalBytes } from './bytes';
import { parseTrezorPath, type TrezorPath, type TrezorPathInput } from './protocol/path';
import type { Transport } from './transport';

/** What the signer needs of the app: the requests of {@link ThruApp}. */
export type TrezorAppApi = Pick<ThruApp, 'getPublicKey' | 'signTransaction' | 'signMessage' | 'signEoaAuth'>;

export type ThruTrezorSignerConfig = {
  /** The Thru app on a connected device. */
  app: TrezorAppApi;
  /**
   * The target network's outer-transaction signing scheme: pass
   * `thru.ctx.transactionSigningScheme` from your Thru client. Required:
   * signing is refused, before the device is contacted, unless this is
   * RFC 8032. There is no default, so a signer can never assume RFC 8032 on a
   * legacy network. `getAddress` does not sign and works regardless.
   */
  transactionSigningScheme: TransactionSigningScheme;
  /** Closes the connection; called by {@link ThruTrezorSigner.close}. */
  close?: () => Promise<void>;
  /**
   * Whether the session was opened for a passphrase wallet whose passphrase
   * the person types on the device (the `passphraseOnDevice` option of the
   * connection). Default false. A key mismatch then says that another
   * passphrase may have been typed. {@link ThruTrezorSigner.connect} sets it.
   */
  passphraseOnDevice?: boolean;
};

/** What {@link ThruTrezorSigner.connect} needs: the connection and the app. */
export type ConnectTrezorOptions = ConnectOptions & {
  transport: Transport;
  /** The app image, as the bytes of its three files (the host embeds none). */
  image: AppImage;
  transactionSigningScheme: TransactionSigningScheme;
  /**
   * Called once when the connection is paired and the session is open, before
   * the app image is offered to the device: loading the app can take several
   * seconds, and an application can say so meanwhile ("Loading the Thru app on
   * your Trezor..."). It gets no argument and its result is ignored: a promise
   * it returns is not awaited, and its rejection is handled. A callback that
   * throws is caught and ignored: the connection goes on.
   */
  onAppLoading?: () => void;
};

export type OperationOptions = AppCallOptions;

export type TrezorSignTransactionBodyOptions = OperationOptions & {
  /**
   * For a token transfer: the mint and the recipient owner (and the account
   * seeds, if not the default), or the 129 bytes the app takes. The device
   * checks it against the transaction and then shows the account owners and
   * the mint instead of the token accounts.
   */
  tokenHint?: TokenHint | Uint8Array;
  /** The key the device must have; by default the transaction's fee payer. */
  expectedPublicKey?: Uint8Array;
};

export type TrezorSignMessageOptions = OperationOptions & {
  /** The key the device must have. */
  expectedPublicKey?: Uint8Array;
};

export type TrezorAddress = {
  readonly publicKey: Uint8Array;
  /** The `ta...` address. */
  readonly address: string;
  readonly path: TrezorPath;
};

export type TrezorSignTransactionBodyResult = {
  /** Raw 64-byte Ed25519 signature over `M = DST_TXN || SHA-256(body)`. */
  readonly signature: Uint8Array;
  /** `body || signature`, verified strictly by `attachTransactionSignature`. */
  readonly signedTransaction: Uint8Array;
  /** The device key for the path (= the body's fee payer). */
  readonly publicKey: Uint8Array;
  /** The "Transaction hash" the device shows (lowercase hex SHA-256 of the body). */
  readonly bodyHash: string;
};

export type TrezorSignatureOutput = {
  /** Raw 64-byte Ed25519 signature, verified in its signing domain. */
  readonly signature: Uint8Array;
  readonly publicKey: Uint8Array;
};

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw new TrezorAbortedError();
}

/** A copy of `key` in memory of its own (a `Buffer`'s `slice` would share it with the caller). */
function copyKey(name: string, key: Uint8Array | undefined): Uint8Array | undefined {
  if (key === undefined) return undefined;
  if (!(key instanceof Uint8Array) || key.length !== PUBLIC_KEY_LEN) {
    throw new TrezorInvalidRequestError(`${name} must be ${PUBLIC_KEY_LEN} bytes`);
  }
  return copyBytes(key);
}

/** The hint's 129 bytes: a copy of the bytes, or the Ledger's encoding of the hint. */
function hintBytes(hint: TokenHint | Uint8Array | undefined): Uint8Array | undefined {
  if (hint === undefined) return undefined;
  if (hint instanceof Uint8Array) return copyBytes(hint);
  try {
    return encodeTokenHint(hint);
  } catch (cause) {
    throw new TrezorInvalidRequestError(cause instanceof Error ? cause.message : String(cause), {
      reason: 'token_hint_length',
      cause,
    });
  }
}

export class ThruTrezorSigner {
  readonly #app: TrezorAppApi;
  readonly #scheme: TransactionSigningScheme;
  readonly #close: (() => Promise<void>) | undefined;
  readonly #passphrase: boolean;
  #closed = false;

  constructor(config: ThruTrezorSignerConfig) {
    this.#app = config.app;
    this.#scheme = config.transactionSigningScheme;
    this.#close = config.close;
    this.#passphrase = config.passphraseOnDevice === true;
  }

  /**
   * Whether the session is a passphrase wallet's (the passphrase typed on the
   * device). A key mismatch of such a session says that another passphrase
   * may have been typed.
   */
  get passphraseOnDevice(): boolean {
    return this.#passphrase;
  }

  /**
   * Connects over `options.transport` (pairing if the device does not know
   * this host; the credential goes to the store), loads the app image and
   * returns the signer. Closing the signer closes the connection.
   * `options.onAppLoading` is called once the connection is paired, before
   * the image is offered to the device.
   */
  static async connect(options: ConnectTrezorOptions): Promise<ThruTrezorSigner> {
    const { transport, image, transactionSigningScheme, onAppLoading, ...connectOptions } = options;
    // The image and the signal are read now: the pairing that comes first can
    // take as long as the person needs.
    const snapshot = copyAppImage(image);
    const signal = options.signal;
    const client = await TrezorClient.connect(transport, connectOptions);
    try {
      announceAppLoading(onAppLoading);
      const { app } = await ThruApp.load(client, snapshot, { signal });
      return new ThruTrezorSigner({
        app,
        transactionSigningScheme,
        passphraseOnDevice: connectOptions.passphraseOnDevice === true,
        close: () => client.close(),
      });
    } catch (error) {
      await client.close();
      throw error;
    }
  }

  /** Closes the connection. Calls after it fail with `closed`. */
  async close(): Promise<void> {
    this.#closed = true;
    await this.#close?.();
  }

  /** Refuses before the device is contacted (also when no scheme was given). */
  #assertSigningScheme(): void {
    assertTrezorSigningScheme(this.#scheme);
  }

  /** The mismatch of the device's key with the one expected, with the passphrase hint when the session is a passphrase wallet's. */
  #mismatch(expected: Uint8Array, got: Uint8Array): TrezorKeyMismatchError {
    return new TrezorKeyMismatchError(thruAddress(expected), thruAddress(got), { passphraseWallet: this.#passphrase });
  }

  #assertOpen(signal: AbortSignal | undefined): void {
    if (this.#closed) throw new TrezorClosedError();
    throwIfAborted(signal);
  }

  /**
   * The key of `path` as the device has it, read without a screen: its
   * address must be the key's, and the key the one expected, if one is.
   */
  async #deviceKey(path: TrezorPath, expected: Uint8Array | undefined, signal: AbortSignal | undefined): Promise<Uint8Array> {
    const reported = await this.#app.getPublicKey(path, { signal });
    // The app is the caller's to supply: what it returns is copied before it is kept across a later wait.
    const publicKey = copyBytes(reported.publicKey);
    this.#checkAddress(publicKey, reported.address);
    if (expected !== undefined && !equalBytes(publicKey, expected)) throw this.#mismatch(expected, publicKey);
    return publicKey;
  }

  /** The address the device returned must be the address of the key it returned. */
  #checkAddress(publicKey: Uint8Array, deviceAddress: string): void {
    const computed = thruAddress(publicKey);
    if (computed !== deviceAddress) {
      throw new TrezorAppError(`the device returned address ${deviceAddress} for a key whose address is ${computed}`);
    }
  }

  /**
   * The public key and the address at `path`. With `display: true` the device
   * shows the address and path and waits for the person to confirm. With
   * `expectedPublicKey` a different key is a {@link TrezorKeyMismatchError}.
   */
  async getAddress(
    path: TrezorPathInput,
    options: OperationOptions & { display?: boolean; expectedPublicKey?: Uint8Array } = {},
  ): Promise<TrezorAddress> {
    const parsed = parseTrezorPath(path);
    const expected = copyKey('the expected public key', options.expectedPublicKey);
    const { signal } = options;
    this.#assertOpen(signal);
    const reported = await this.#app.getPublicKey(parsed, {
      signal,
      showOnDevice: options.display === true,
    });
    const publicKey = copyBytes(reported.publicKey);
    const address = reported.address;
    this.#checkAddress(publicKey, address);
    if (expected !== undefined && !equalBytes(publicKey, expected)) throw this.#mismatch(expected, publicKey);
    return { publicKey, address, path: parsed };
  }

  /**
   * Has the device sign `body` (the wire bytes without the signature) after
   * the person reviewed it there. The device key must be the body's fee payer
   * (checked before the device is asked to sign); the signature is verified
   * strictly against it, and `signedTransaction` is ready to submit.
   */
  async signTransactionBody(
    path: TrezorPathInput,
    body: Uint8Array,
    options: TrezorSignTransactionBodyOptions = {},
  ): Promise<TrezorSignTransactionBodyResult> {
    this.#assertSigningScheme();
    const parsed = parseTrezorPath(path);
    const hint = hintBytes(options.tokenHint);
    if (hint !== undefined && hint.length !== TOKEN_HINT_LEN) {
      throw new TrezorInvalidRequestError(`a token hint is ${TOKEN_HINT_LEN} bytes`, { reason: 'token_hint_length' });
    }
    const expected = copyKey('the expected public key', options.expectedPublicKey);
    const { signal } = options;
    let message: ReturnType<typeof buildTransactionSigningMessage>;
    try {
      // One frozen snapshot: the bytes that are checked, sent and attached to.
      message = buildTransactionSigningMessage(new Uint8Array(body));
    } catch (cause) {
      throw new TrezorInvalidRequestError(cause instanceof Error ? cause.message : String(cause), { cause });
    }
    const snapshot = message.body;
    const feePayer = message.expectedPublicKey;
    this.#assertOpen(signal);

    const publicKey = await this.#deviceKey(parsed, expected, signal);
    if (!equalBytes(publicKey, feePayer)) throw this.#mismatch(feePayer, publicKey);
    const signature = copyBytes(await this.#app.signTransaction(parsed, snapshot, { signal, tokenHint: hint }));
    let signedTransaction: Uint8Array;
    try {
      signedTransaction = await attachTransactionSignature(message, signature);
    } catch (cause) {
      // The device signed (the app returned a signature): what it returned is not to be used, and it is not known what it signed.
      throw new TrezorInvalidSignatureError({ cause, outcomeUnknown: true });
    }
    return { signature, signedTransaction, publicKey, bodyHash: computeBodyHashDisplay(snapshot) };
  }

  /**
   * Has the device sign the text `message` (`tn_msg_sign_v1__` domain) after
   * the person reviewed it there. The message must be 1 to 512 bytes of text
   * (`TREZOR_TEXT_RULE`), else nothing is sent.
   */
  async signMessage(
    path: TrezorPathInput,
    message: Uint8Array,
    options: TrezorSignMessageOptions = {},
  ): Promise<TrezorSignatureOutput> {
    this.#assertSigningScheme();
    const parsed = parseTrezorPath(path);
    const snapshot = new Uint8Array(message);
    const expected = copyKey('the expected public key', options.expectedPublicKey);
    const { signal } = options;
    checkMessage(snapshot);
    this.#assertOpen(signal);

    const publicKey = await this.#deviceKey(parsed, expected, signal);
    const signature = copyBytes(await this.#app.signMessage(parsed, snapshot, { signal }));
    if (!(await verifyMessage(signature, snapshot, publicKey))) {
      throw new TrezorInvalidSignatureError({ outcomeUnknown: true });
    }
    return { signature, publicKey };
  }

  /**
   * Has the device sign an EOA create or delete authorization after the person
   * reviewed it there. `account` must be the device's key for `path` and
   * `chainId` must not be zero, else the device is not asked to sign.
   */
  async signEoaAuth(
    path: TrezorPathInput,
    kind: EoaAuthKindInput,
    chainId: number,
    feePayer: Uint8Array,
    account: Uint8Array,
    options: OperationOptions = {},
  ): Promise<TrezorSignatureOutput> {
    this.#assertSigningScheme();
    const parsed = parseTrezorPath(path);
    const code = eoaKindCode(kind);
    checkEoaChainId(chainId);
    const payer = copyKey('the fee payer of an EOA authorization', feePayer) as Uint8Array;
    const accountKey = copyKey('the account of an EOA authorization', account) as Uint8Array;
    const { signal } = options;
    this.#assertOpen(signal);

    const publicKey = await this.#deviceKey(parsed, undefined, signal);
    if (!equalBytes(accountKey, publicKey)) {
      throw new TrezorInvalidRequestError(
        `the account of an EOA authorization must be this Trezor key (${thruAddress(publicKey)}), not ${thruAddress(accountKey)}`,
      );
    }
    const signature = copyBytes(await this.#app.signEoaAuth(parsed, code, chainId, payer, accountKey, { signal }));
    const create = code === EoaAuthKind.create;
    const signed = (create ? eoa.buildEOACreateMessage : eoa.buildEOADeleteMessage)(chainId, payer, accountKey);
    const domain = create ? SignatureDomain.EOA_CREATE : SignatureDomain.EOA_DELETE;
    if (!(await verifyWithDomain(signature, signed.subarray(16), accountKey, domain))) {
      throw new TrezorInvalidSignatureError({ outcomeUnknown: true });
    }
    return { signature, publicKey };
  }
}

/**
 * Tells the application that the app is being loaded. A callback that throws
 * is ignored: it is the application's status line, and it must not break the
 * connection it reports on.
 */
function announceAppLoading(callback: (() => void) | undefined): void {
  if (callback === undefined) return;
  try {
    const result: unknown = callback();
    // A callback that returns a promise is not awaited; its rejection must not become an unhandled one.
    if (typeof result === 'object' && result !== null && typeof (result as { then?: unknown }).then === 'function') {
      Promise.resolve(result).catch(() => undefined);
    }
  } catch {
    // Ignored on purpose.
  }
}

/** Connects and returns the signer: {@link ThruTrezorSigner.connect}. */
export function connectTrezor(options: ConnectTrezorOptions): Promise<ThruTrezorSigner> {
  return ThruTrezorSigner.connect(options);
}
