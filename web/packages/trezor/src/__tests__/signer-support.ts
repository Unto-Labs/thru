/**
 * Test support for the signer checks: the shared signing vectors and the
 * app's files as data, and a fake Thru app that answers the app's protocol
 * (`GetPublicKey`, `SignTx` with its data requests, `SignMessage`,
 * `SignEoaAuth`) with a real Ed25519 key. The fake is the connection the
 * signer sits on: it has the call interface of the client (`call`,
 * `loadedApp`, `close`), so everything above the link is the production code.
 * Like the other checks it uses no Node API.
 */
import { thruAddress } from '@thru/ledger/protocol';
import { signatureDomainDST, signWithDomain, SignatureDomain } from '@thru/sdk';

import type { Api } from './vector-checks';
import type { MessageCodec } from '../index';

// ---- data: the app's files and the shared vectors ----

export type FixtureCase = {
  name: string;
  outcome: string;
  path: string;
  body_hex: string;
  token_hint_hex?: string;
  signature_hex?: string;
  review?: Record<string, string | boolean | null>;
};

export type HdDerivation = {
  name: string;
  mnemonic: string;
  passphrase: string;
  path: string;
  depth: number;
  account: number;
  path_apdu_hex: string;
  private_seed_hex: string;
  pubkey_hex: string;
  address: string;
};

export type PathPolicyCase = {
  name: string;
  path: string;
  depth: number;
  components: number[];
  expect: string;
  reason: string;
};

export type MessageVector = {
  name: string;
  category: string;
  display: string | null;
  message_len: number;
  message_hex: string;
  message_sha256_hex: string;
  signer_path: string;
  signer_seed_hex: string;
  signer_pubkey_hex: string;
  signing_message_hex?: string | null;
  signature_hex?: string | null;
};

export type EoaVector = {
  name: string;
  category: string;
  reject_reason: string | null;
  kind: 'create' | 'delete';
  chain_id: number;
  fee_payer_hex: string;
  account_hex: string;
  signer_path: string;
  signer_seed_hex: string;
  signer_pubkey_hex: string;
  auth_message_hex: string;
  signature_hex?: string | null;
};

/** The app's files and the shared vectors, read by the runner (Node's `fs`, or the page's `fetch`). */
export type SigningData = {
  fixture: { mnemonic: string; cases: FixtureCase[] };
  en: { translations: Record<string, string> };
  hd: { derivations: HdDerivation[]; path_policy: PathPolicyCase[] };
  messages: MessageVector[];
  eoa: EoaVector[];
};

export type { Api };

// ---- the fake app ----

export type FakeKey = { seed: Uint8Array; publicKey: Uint8Array };

/** What the fake does wrong, to see that the signer notices. */
export type Tamper = {
  /** Flip a bit of the signature. */
  flipSignature?: boolean;
  /** Sign in this domain instead of the request's. */
  signInDomain?: SignatureDomain;
  /** Return a signature of this many bytes. */
  signatureLength?: number;
  /** Answer `GetPublicKey` with another address than the key's. */
  wrongAddress?: boolean;
  /** Answer `GetPublicKey` with this key (and its address) instead of the device's. */
  reportKey?: Uint8Array;
};

export type FakeCall = {
  /** The app's message id (0 `GetPublicKey`, 2 `SignTx`, 4 `TxDataAck`, 6 `SignMessage`, 8 `SignEoaAuth`). */
  id: number;
  /** The decoded request. */
  request: Record<string, unknown>;
};

const hexOf = (api: Api, bytes: Uint8Array): string => api.toHex(bytes);

/** The message of an EOA authorization, as the app builds it: 16-byte tag, u16 chain id, fee payer, account. */
export function eoaAuthMessage(kind: 'create' | 'delete', chainId: number, feePayer: Uint8Array, account: Uint8Array): Uint8Array {
  const tag = signatureDomainDST(kind === 'create' ? SignatureDomain.EOA_CREATE : SignatureDomain.EOA_DELETE);
  const out = new Uint8Array(16 + 2 + 32 + 32);
  out.set(tag, 0);
  new DataView(out.buffer).setUint16(16, chainId, true);
  out.set(feePayer, 18);
  out.set(account, 50);
  return out;
}

export class FakeApp {
  /** The id the app is loaded as. */
  loadedApp: number | undefined = 7;
  closed = false;
  closeCalls = 0;
  readonly calls: FakeCall[] = [];
  tamper: Tamper = {};
  /** The text of a `Failure(DataError)` the app answers instead of signing; reading a key is never refused. */
  refuse: string | undefined;
  /** What the app signed last, as the full message (`tag || context`) for transactions the hash of it. */
  lastMessage: Uint8Array | undefined;
  /** Awaited before the answer to a request of this message id; an abort ends the wait. */
  hold = new Map<number, Promise<void>>();
  /** Runs when a request of this id arrives, before anything else. */
  onRequest: ((call: FakeCall) => void) | undefined;
  private pending: { path: number[]; size: number; got: Uint8Array[]; received: number; hint: Uint8Array | undefined } | undefined;

  constructor(
    private readonly api: Api,
    /** The key at every path (or the key of the path when a function). */
    private readonly key: FakeKey | ((path: number[]) => FakeKey),
  ) {}

  private keyAt(path: number[]): FakeKey {
    return typeof this.key === 'function' ? this.key(path) : this.key;
  }

  /** Requests of one message id, in order. */
  of(id: number): FakeCall[] {
    return this.calls.filter((c) => c.id === id);
  }

  async close(): Promise<void> {
    this.closeCalls++;
    this.closed = true;
    this.loadedApp = undefined;
  }

  /** The client's `call` for the app envelope: `ExtAppMessage` in, `ExtAppResponse` out. */
  async call<Q extends object, A extends object>(
    requestCodec: MessageCodec<Q>,
    request: Q,
    answerCodec: MessageCodec<A>,
    options: { signal?: AbortSignal } = {},
  ): Promise<A> {
    const api = this.api;
    if (this.closed) throw new api.TrezorClosedError();
    if (requestCodec.id !== api.ExtAppMessage.id || answerCodec.id !== api.ExtAppResponse.id) {
      throw new Error(`the fake app answers only the app envelope, not ${requestCodec.name}`);
    }
    if (options.signal?.aborted) throw new api.TrezorAbortedError();
    const { instance_id: instance, message_id: id, data } = request as unknown as {
      instance_id: number;
      message_id: number;
      data: Uint8Array;
    };
    if (instance !== this.loadedApp) throw new api.TrezorClosedError();
    const answer = await this.handle(id, data, options.signal);
    return { message_id: answer.id, data: answer.data } as unknown as A;
  }

  private failure(reason: string): Error {
    return this.api.errorFromFailure(3, reason);
  }

  private async handle(id: number, data: Uint8Array, signal: AbortSignal | undefined): Promise<{ id: number; data: Uint8Array }> {
    const api = this.api;
    const decoded = this.decode(id, data);
    const call: FakeCall = { id, request: decoded };
    this.calls.push(call);
    this.onRequest?.(call);
    const hold = this.hold.get(id);
    if (hold) {
      this.hold.delete(id);
      await Promise.race([
        hold,
        new Promise<never>((_, reject) => {
          const abort = (): void => {
            // As the client does: an abort while a request is in flight ends the connection, and the device may have acted.
            this.closed = true;
            const error = new api.TrezorAbortedError();
            error.outcomeUnknown = true;
            reject(error);
          };
          if (signal?.aborted) abort();
          else signal?.addEventListener('abort', abort, { once: true });
        }),
      ]);
    }
    switch (id) {
      case api.GetPublicKey.id:
        return this.getPublicKey(decoded as unknown as { address_n: number[] });
      case api.SignTx.id:
        return this.signTx(decoded as unknown as { address_n: number[]; body_size: number; token_hint?: Uint8Array });
      case api.TxDataAck.id:
        return this.txDataAck(decoded as unknown as { data: Uint8Array });
      case api.SignMessage.id:
        return this.signMessage(decoded as unknown as { address_n: number[]; message: Uint8Array });
      case api.SignEoaAuth.id:
        return this.signEoaAuth(
          decoded as unknown as { address_n: number[]; kind: number; chain_id: number; fee_payer: Uint8Array; account: Uint8Array },
        );
      default:
        throw this.failure('unexpected_message');
    }
  }

  private decode(id: number, data: Uint8Array): Record<string, unknown> {
    const api = this.api;
    const codec = (
      {
        [api.GetPublicKey.id as number]: api.GetPublicKey,
        [api.SignTx.id as number]: api.SignTx,
        [api.TxDataAck.id as number]: api.TxDataAck,
        [api.SignMessage.id as number]: api.SignMessage,
        [api.SignEoaAuth.id as number]: api.SignEoaAuth,
      } as Record<number, MessageCodec<object>>
    )[id];
    if (!codec) throw this.failure('unexpected_message');
    return codec.decode(data) as Record<string, unknown>;
  }

  private checkPath(path: number[]): void {
    if (!this.api.isTrezorPathComponents(path)) throw this.failure('path_rejected');
  }

  private getPublicKey(request: { address_n: number[] }): { id: number; data: Uint8Array } {
    const api = this.api;
    this.checkPath(request.address_n);
    const reported = this.tamper.reportKey ?? this.keyAt(request.address_n).publicKey;
    const address = this.tamper.wrongAddress ? thruAddress(new Uint8Array(32).fill(9)) : thruAddress(reported);
    return { id: api.PublicKey.id as number, data: api.PublicKey.encode({ public_key: reported, address }) };
  }

  private signTx(request: { address_n: number[]; body_size: number; token_hint?: Uint8Array }): { id: number; data: Uint8Array } {
    this.checkPath(request.address_n);
    if (request.token_hint !== undefined) {
      if (request.token_hint.length !== 129) throw this.failure('token_hint_length');
      if (request.token_hint[0] !== 1) throw this.failure('token_hint_kind');
    }
    if (request.body_size < 112 || request.body_size > 32704) throw this.failure('body_size_out_of_range');
    this.pending = {
      path: request.address_n,
      size: request.body_size,
      got: [],
      received: 0,
      hint: request.token_hint,
    };
    return this.requestMore();
  }

  private requestMore(): { id: number; data: Uint8Array } {
    const api = this.api;
    const p = this.pending as NonNullable<typeof this.pending>;
    const length = Math.min(2048, p.size - p.received);
    return { id: api.TxDataRequest.id as number, data: api.TxDataRequest.encode({ offset: p.received, length }) };
  }

  private async txDataAck(request: { data: Uint8Array }): Promise<{ id: number; data: Uint8Array }> {
    const api = this.api;
    const p = this.pending;
    if (!p) throw this.failure('unexpected_message');
    if (request.data.length !== Math.min(2048, p.size - p.received)) throw this.failure('chunk_size_mismatch');
    p.got.push(request.data);
    p.received += request.data.length;
    if (p.received < p.size) return this.requestMore();
    this.pending = undefined;
    if (this.refuse !== undefined) throw this.failure(this.refuse);
    const body = new Uint8Array(p.size);
    let at = 0;
    for (const piece of p.got) {
      body.set(piece, at);
      at += piece.length;
    }
    const key = this.keyAt(p.path);
    this.lastMessage = body;
    const signature = await this.sign(body, key, SignatureDomain.TXN);
    return { id: api.TxSignature.id as number, data: api.TxSignature.encode({ signature }) };
  }

  private async signMessage(request: { address_n: number[]; message: Uint8Array }): Promise<{ id: number; data: Uint8Array }> {
    const api = this.api;
    this.checkPath(request.address_n);
    if (this.refuse !== undefined) throw this.failure(this.refuse);
    if (!api.isTrezorTextMessage(request.message)) throw this.failure('message_not_text');
    this.lastMessage = request.message;
    const signature = await this.sign(request.message, this.keyAt(request.address_n), SignatureDomain.MSG);
    return { id: api.MessageSignature.id as number, data: api.MessageSignature.encode({ signature }) };
  }

  private async signEoaAuth(request: {
    address_n: number[];
    kind: number;
    chain_id: number;
    fee_payer: Uint8Array;
    account: Uint8Array;
  }): Promise<{ id: number; data: Uint8Array }> {
    const api = this.api;
    this.checkPath(request.address_n);
    if (this.refuse !== undefined) throw this.failure(this.refuse);
    if (request.kind !== 0 && request.kind !== 1) throw this.failure('eoa_invalid_kind');
    if (request.chain_id < 1 || request.chain_id > 0xffff) throw this.failure('bad_chain_id');
    if (request.fee_payer.length !== 32 || request.account.length !== 32) throw this.failure('eoa_invalid_length');
    const key = this.keyAt(request.address_n);
    if (hexOf(api, request.account) !== hexOf(api, key.publicKey)) throw this.failure('account_mismatch');
    const kind = request.kind === 0 ? 'create' : 'delete';
    const message = eoaAuthMessage(kind, request.chain_id, request.fee_payer, request.account);
    this.lastMessage = message;
    const domain = kind === 'create' ? SignatureDomain.EOA_CREATE : SignatureDomain.EOA_DELETE;
    // The tag is the domain's: the context is what follows it.
    const signature = await this.sign(message.subarray(16), key, domain);
    return { id: api.EoaAuthSignature.id as number, data: api.EoaAuthSignature.encode({ signature }) };
  }

  private async sign(context: Uint8Array, key: FakeKey, domain: SignatureDomain): Promise<Uint8Array> {
    let signature = await signWithDomain(context, key.seed, key.publicKey, this.tamper.signInDomain ?? domain);
    if (this.tamper.flipSignature) {
      signature = signature.slice();
      signature[10] ^= 1;
    }
    if (this.tamper.signatureLength !== undefined) signature = signature.slice(0, this.tamper.signatureLength);
    return signature;
  }
}
