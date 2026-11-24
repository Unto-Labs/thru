/**
 * The Thru app on the device: its public keys and its signatures. Every
 * message of the app travels inside `ExtAppMessage` (host to app) and
 * `ExtAppResponse` (app to host); see `trezor/app-thru/protob/thru.proto` and
 * `rpc/thru-trezor/src/app.rs`.
 *
 * Every request of the app: `GetPublicKey`, `SignTx` (with the optional token
 * hint, and the body sent in order and in full), `SignMessage` and
 * `SignEoaAuth`. What the host can know is checked before anything is sent,
 * with the Rust host's error codes: the path against the policy, the token
 * hint's length, the length and the text rule of a message, the chain id and
 * the length of the keys of an authorization. That the account of an
 * authorization is the device's key is checked by the signer, which knows the
 * key.
 */
import { copyBytes } from './bytes';
import { isRefusal, markSigningOutcome, type TrezorClient } from './client';
import {
  TrezorAbortedError,
  TrezorAppError,
  TrezorClosedError,
  TrezorInvalidRequestError,
  intoAppRefusal,
} from './errors';
import { loadApp, type AppImage, type LoadResult } from './extapp';
import { exclusive } from './operations';
import {
  EoaAuthSignature,
  ExtAppMessage,
  ExtAppResponse,
  GetPublicKey,
  MessageSignature,
  PublicKey,
  SignEoaAuth,
  SignMessage,
  SignTx,
  TxDataAck,
  TxDataRequest,
  TxSignature,
  type MessageCodec,
} from './messages';
import { parseTrezorPath, type TrezorPathInput } from './protocol/path';
import { isTrezorTextMessage, type TrezorEoaAuthKind } from './protocol/preview';

/** The most the app asks for in one piece (`CHUNK_MAX` in the app). */
export const CHUNK_MAX = 2048;
export const SIGNATURE_LEN = 64;
/** Length of a token hint. */
export const TOKEN_HINT_LEN = 129;
export const PUBLIC_KEY_LEN = 32;
/** The longest message the app signs (its inbox holds no more). */
export const MESSAGE_MAX = 512;
/** The app's number for an authorization kind. */
export const EoaAuthKind = { create: 0, delete: 1 } as const;
/** An authorization kind, by name or by the app's number. */
export type EoaAuthKindInput = TrezorEoaAuthKind;

/** What the app's requests need from a connection: the call interface of {@link TrezorClient}. */
export type AppConnection = Pick<TrezorClient, 'call' | 'loadedApp' | 'close'>;

export type AppCallOptions = { signal?: AbortSignal };

export type PublicKeyResult = { publicKey: Uint8Array; address: string };

export type SignTransactionOptions = AppCallOptions & {
  /** The 129-byte token hint the device checks against the transaction; passed on as it is. */
  tokenHint?: Uint8Array;
};

function checkKey(name: string, key: Uint8Array): Uint8Array {
  if (!(key instanceof Uint8Array) || key.length !== PUBLIC_KEY_LEN) {
    throw new TrezorInvalidRequestError(`${name} must be ${PUBLIC_KEY_LEN} bytes`);
  }
  return copyBytes(key);
}

/** The number of an authorization kind; anything else is refused. */
export function eoaKindCode(kind: EoaAuthKindInput): 0 | 1 {
  if (kind === 'create' || kind === EoaAuthKind.create) return EoaAuthKind.create;
  if (kind === 'delete' || kind === EoaAuthKind.delete) return EoaAuthKind.delete;
  throw new TrezorInvalidRequestError(`unknown EOA authorization kind ${String(kind)}`);
}

/** The chain id of an authorization: a u16 that is not zero (the app refuses zero). */
export function checkEoaChainId(chainId: number): void {
  if (!Number.isInteger(chainId) || chainId < 0 || chainId > 0xffff) {
    throw new TrezorInvalidRequestError(`the chain id of an EOA authorization must be a u16, got ${chainId}`);
  }
  if (chainId === 0) throw new TrezorInvalidRequestError('the chain id of an EOA authorization is not zero');
}

/**
 * A message the app would not take, or that would not fit its inbox, is not
 * sent: 1 to {@link MESSAGE_MAX} bytes of text by the app's rule (the one of
 * `TREZOR_TEXT_RULE`). A message that is not text is refused with the reason
 * the app gives, `message_not_text`.
 */
export function checkMessage(message: Uint8Array): void {
  if (!(message instanceof Uint8Array) || message.length === 0 || message.length > MESSAGE_MAX) {
    throw new TrezorInvalidRequestError(
      `the Trezor signs messages of 1 to ${MESSAGE_MAX} bytes, this one has ${message instanceof Uint8Array ? message.length : 'no bytes'}`,
    );
  }
  if (!isTrezorTextMessage(message)) {
    throw new TrezorInvalidRequestError('the Trezor signs a message only if it can show it as text', {
      reason: 'message_not_text',
    });
  }
}

/** The Thru app loaded on a connected device. */
export class ThruApp {
  private constructor(
    private readonly client: AppConnection,
    private readonly instanceId: number,
  ) {}

  /**
   * Loads the app image (see {@link loadApp}) and addresses the app. `uploaded`
   * is false when the device already held the app.
   */
  static async load(
    client: TrezorClient,
    image: AppImage,
    options: AppCallOptions = {},
  ): Promise<{ app: ThruApp } & LoadResult> {
    // Only the signal goes on: the model check of the loader is not something a caller of the app can turn off.
    const result = await loadApp(client, image, { signal: options.signal });
    return { app: new ThruApp(client, result.instanceId), ...result };
  }

  /** Addresses an app that is loaded already as `instanceId`. */
  static attach(client: AppConnection, instanceId: number): ThruApp {
    return new ThruApp(client, instanceId);
  }

  /**
   * A request that asks the app to sign was answered, and what followed
   * failed. Unless the device or the app refused (it then released no
   * signature), the outcome is unknown, and the connection is closed: the app may be waiting for something this host
   * will not send.
   */
  private async signedFailure(error: unknown): Promise<void> {
    markSigningOutcome(error);
    if (!isRefusal(error)) await this.client.close().catch(() => undefined);
  }

  /** Runs `use` on the answer to a signing request: a failure to use it is an unknown outcome and ends the connection. */
  private async signedBy<T>(use: () => T): Promise<T> {
    try {
      return use();
    } catch (error) {
      await this.signedFailure(error);
      throw error;
    }
  }

  /** Sends one app message and returns the app's answer: its message id and payload. */
  private async callRaw(id: number, data: Uint8Array, signal?: AbortSignal): Promise<{ id: number; data: Uint8Array }> {
    if (this.client.loadedApp !== this.instanceId) throw new TrezorClosedError();
    try {
      const response = await this.client.call(
        ExtAppMessage,
        { instance_id: this.instanceId, message_id: id, data },
        ExtAppResponse,
        { signal },
      );
      return { id: response.message_id, data: response.data };
    } catch (error) {
      // A `Failure` here is the app's (or Core's) answer to this request.
      throw intoAppRefusal(error);
    }
  }

  private send<Q extends object>(codec: MessageCodec<Q>, request: Q, signal?: AbortSignal) {
    return this.callRaw(codec.id as number, codec.encode(request), signal);
  }

  /** The public key and the address at `path`. With `showOnDevice` the device shows the address and waits for the person. */
  async getPublicKey(
    path: TrezorPathInput,
    options: AppCallOptions & { showOnDevice?: boolean } = {},
  ): Promise<PublicKeyResult> {
    const { components } = parseTrezorPath(path);
    const request = { address_n: [...components], show_display: options.showOnDevice === true };
    const { signal } = options;
    const answer = await exclusive(this.client, signal, () => this.send(GetPublicKey, request, signal));
    // An answer that is not the app's public key leaves the app in a state the host cannot vouch for: the connection is closed.
    try {
      const result = decodeApp(PublicKey, answer);
      if (result.public_key.length !== PUBLIC_KEY_LEN) {
        throw new TrezorAppError(`public key has ${result.public_key.length} bytes, not ${PUBLIC_KEY_LEN}`);
      }
      return { publicKey: result.public_key, address: result.address };
    } catch (error) {
      await this.client.close().catch(() => undefined);
      throw error;
    }
  }

  /**
   * Has the app sign the transaction `body` (the wire transaction without its
   * trailing signature) with the key at `path`. The person reviews the
   * transaction on the device first. The body and the hint are copied before
   * the first asynchronous step: what is sent is what the arguments held at
   * the call. A signing request is never repeated automatically: an error that
   * says `outcomeUnknown` means the device may have signed and the host holds
   * no signature. The whole request,
   * `SignTx` and every piece after it, is one operation on the connection: a
   * request made meanwhile waits for it.
   */
  async signTransaction(
    path: TrezorPathInput,
    body: Uint8Array,
    options: SignTransactionOptions = {},
  ): Promise<Uint8Array> {
    const { components } = parseTrezorPath(path);
    const hint = options.tokenHint === undefined ? undefined : copyBytes(options.tokenHint);
    if (hint !== undefined && hint.length !== TOKEN_HINT_LEN) {
      throw new TrezorInvalidRequestError(`a token hint is ${TOKEN_HINT_LEN} bytes`, {
        reason: 'token_hint_length',
      });
    }
    const snapshot = copyBytes(body);
    const address = [...components];
    const { signal } = options;
    return exclusive(this.client, signal, async () => {
      // The abort of this call between two pieces: the one failure after the first answer that is a known outcome.
      let hostAbort: unknown;
      const first = await this.send(SignTx, { address_n: address, body_size: snapshot.length, token_hint: hint }, signal);
      try {
        return await streamBody(snapshot, first, async (data) => {
          // An abort between two pieces leaves the device waiting for the rest of
          // a body: the connection is closed, which drops that request. The device
          // cannot have signed (it did not get the whole body).
          if (signal?.aborted === true) {
            await this.client.close().catch(() => undefined);
            hostAbort = new TrezorAbortedError();
            throw hostAbort;
          }
          return this.send(TxDataAck, { data }, signal);
        });
      } catch (error) {
        // `SignTx` was answered, so the request reached the device: any other failure leaves the outcome unknown.
        if (error !== hostAbort) await this.signedFailure(error);
        throw error;
      }
    });
  }

  /**
   * Has the app sign the text `message` (`tn_msg_sign_v1__` domain) with the
   * key at `path`. The person reviews it on the device first. The message is
   * checked first ({@link checkMessage}) and copied.
   */
  async signMessage(path: TrezorPathInput, message: Uint8Array, options: AppCallOptions = {}): Promise<Uint8Array> {
    const { components } = parseTrezorPath(path);
    checkMessage(message);
    const request = { address_n: [...components], message: copyBytes(message) };
    const { signal } = options;
    const answer = await exclusive(this.client, signal, () => this.send(SignMessage, request, signal));
    return this.signedBy(() => signatureOf(MessageSignature, answer));
  }

  /**
   * Has the app sign an EOA authorization of `kind` for `account` with the key
   * at `path`. The person reviews it on the device first. The app refuses a
   * zero chain id, and an `account` that is not the key at `path`; the first
   * is checked here, the second by the signer.
   */
  async signEoaAuth(
    path: TrezorPathInput,
    kind: EoaAuthKindInput,
    chainId: number,
    feePayer: Uint8Array,
    account: Uint8Array,
    options: AppCallOptions = {},
  ): Promise<Uint8Array> {
    const { components } = parseTrezorPath(path);
    const kindCode = eoaKindCode(kind);
    checkEoaChainId(chainId);
    const request = {
      address_n: [...components],
      kind: kindCode,
      chain_id: chainId,
      fee_payer: checkKey('the fee payer of an EOA authorization', feePayer),
      account: checkKey('the account of an EOA authorization', account),
    };
    const { signal } = options;
    const answer = await exclusive(this.client, signal, () => this.send(SignEoaAuth, request, signal));
    return this.signedBy(() => signatureOf(EoaAuthSignature, answer));
  }
}

/** A 64-byte signature out of the app's answer, which must be message `codec`. */
function signatureOf(
  codec: MessageCodec<{ signature: Uint8Array }>,
  answer: { id: number; data: Uint8Array },
): Uint8Array {
  const result = decodeApp(codec, answer);
  if (result.signature.length !== SIGNATURE_LEN) {
    throw new TrezorAppError(`signature has ${result.signature.length} bytes, not ${SIGNATURE_LEN}`);
  }
  return result.signature;
}

/** Decodes the app's answer, which must be message `codec`. */
function decodeApp<A extends object>(codec: MessageCodec<A>, answer: { id: number; data: Uint8Array }): A {
  if (answer.id !== codec.id) {
    throw new TrezorAppError(`answered message ${answer.id}, expected ${codec.name} (${codec.id})`);
  }
  try {
    return codec.decode(answer.data);
  } catch (cause) {
    throw new TrezorAppError(`${codec.name} could not be decoded`, { cause });
  }
}

/**
 * Answers the app's requests for pieces of `body` until it signs.
 *
 * `first` is the app's answer to `SignTx`; `sendAck` sends one `TxDataAck`
 * and returns the app's next answer. Pieces are asked for in order, without
 * gaps, each at most {@link CHUNK_MAX}, and the signature must come only after
 * the whole body was asked for.
 */
export async function streamBody(
  body: Uint8Array,
  first: { id: number; data: Uint8Array },
  sendAck: (data: Uint8Array) => Promise<{ id: number; data: Uint8Array }>,
): Promise<Uint8Array> {
  // The pieces are cut from a copy: the body may be a `Buffer` the caller
  // goes on to change while a piece is on its way.
  const snapshot = copyBytes(body);
  const bodySize = snapshot.length;
  let nextOffset = 0;
  let answer = first;
  for (;;) {
    if (answer.id === TxSignature.id) {
      // A signature before the device asked for the whole body means it signed
      // (or claims to have signed) something it did not see in full.
      if (nextOffset !== bodySize) {
        throw new TrezorAppError(`the device signed after asking for ${nextOffset} of ${bodySize} bytes`);
      }
      const signature = decodeApp(TxSignature, answer);
      if (signature.signature.length !== SIGNATURE_LEN) {
        throw new TrezorAppError(`signature has ${signature.signature.length} bytes, not ${SIGNATURE_LEN}`);
      }
      return signature.signature;
    }
    const request = decodeApp(TxDataRequest, answer);
    if (request.offset !== nextOffset) {
      throw new TrezorAppError(`asked for offset ${request.offset} when ${nextOffset} is next`);
    }
    if (request.length === 0 || request.length > CHUNK_MAX) {
      throw new TrezorAppError(`asked for a piece of ${request.length} bytes`);
    }
    const end = request.offset + request.length;
    if (end > bodySize) {
      throw new TrezorAppError(`asked for bytes ${request.offset}..+${request.length} of a body of ${bodySize}`);
    }
    nextOffset = end;
    answer = await sendAck(snapshot.slice(request.offset, end));
  }
}
