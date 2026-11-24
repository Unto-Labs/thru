/**
 * Adapters from the Trezor signer into the Thru SDK external-signer flow
 * (`build -> body -> device -> verify-and-attach -> send`) and the EOA-creation
 * flow (`SignEoaAuth` + a fee-paid `CREATE_ACCOUNT` transaction); the shape of
 * `adapter.ts` of `@thru/ledger`.
 *
 * The device needs the transaction **body**, not `M`: it parses the envelope,
 * hashes the body itself and signs `"tn_txn_sign_v1__" || SHA-256(body)`. The
 * SDK computes `M` only to cross-check the returned signature.
 *
 * Before the device is used, the preview of its review (`transactionReview`)
 * says what it will show, or that the app will refuse the transaction; a
 * refusal ends the call there ({@link TrezorInvalidRequestError} with the
 * reason `unsupported_transaction`), so a builder change cannot send the
 * device something it will refuse.
 */
import { bytesEqual, thruAddress, type TokenHint } from '@thru/ledger/protocol';
import {
  attachTransactionSignature,
  buildTransactionSigningMessage,
  eoa,
  Pubkey,
  signWithDomain,
  SignatureDomain,
  type BuildTransactionOptions,
  type TransactionHeaderConfig,
  type TransactionSigningScheme,
} from '@thru/sdk';
import { StateProofType } from '@thru/sdk/proto';

import {
  assertTrezorSigningScheme,
  TrezorAbortedError,
  TrezorError,
  TrezorInvalidRequestError,
  TrezorKeyMismatchError,
} from './errors';
import { copyBytes } from './bytes';
import { parseTrezorPath, type TrezorPathInput } from './protocol/path';
import { transactionReview, type TrezorReview } from './protocol/preview';
import { snapshotBuild, snapshotTokenHint } from './snapshot';
import type { OperationOptions, ThruTrezorSigner } from './ThruTrezorSigner';

/** Resource budget fields of a transaction header. */
export type TransactionResources = {
  readonly computeUnits: number;
  readonly memoryUnits: number;
  readonly stateUnits: number;
};

/**
 * Budget for EOA program transfers and deletes. Matches the Rust
 * `build_transfer` / `build_delete_account` builders
 * (`rpc/thru-base/src/txn_tools.rs`) and `@thru/ledger`.
 */
export const EOA_TRANSFER_RESOURCES: TransactionResources = Object.freeze({
  computeUnits: 10_000,
  memoryUnits: 10_000,
  stateUnits: 0,
});

/**
 * Budget for EOA creation: the transfer budget plus one state unit for the new
 * account. The SDK defaults every unit to 0, which the runtime rejects for
 * these calls.
 */
export const EOA_CREATE_RESOURCES: TransactionResources = Object.freeze({
  computeUnits: 10_000,
  memoryUnits: 10_000,
  stateUnits: 1,
});

function isEoaProgram(program: BuildTransactionOptions['program']): boolean {
  try {
    return bytesEqual(Pubkey.from(program).toBytes(), eoa.EOA_PROGRAM_ADDRESS);
  } catch {
    return false;
  }
}

/**
 * Header for an adapter-built transaction: `defaults` first, then every field
 * the caller set (`undefined` fields do not erase a default).
 */
export function mergeHeader(
  defaults: Partial<TransactionHeaderConfig> | undefined,
  overrides: TransactionHeaderConfig | undefined,
): TransactionHeaderConfig {
  const out: TransactionHeaderConfig = { ...defaults };
  for (const [k, v] of Object.entries(overrides ?? {})) {
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

/** The subset of the `@thru/sdk` client (`createThruClient`) the adapters use. */
export type TrezorThruClient = {
  /** The network's signing scheme; Trezor signing is refused unless it is RFC 8032. */
  readonly ctx: { readonly transactionSigningScheme: TransactionSigningScheme };
  readonly transactions: {
    build(options: BuildTransactionOptions): Promise<{ toWireForSigning(): Uint8Array }>;
    send(transaction: Uint8Array): Promise<string>;
  };
  readonly chain: { getChainId(): Promise<number> };
  readonly proofs: {
    generate(options: { address?: Uint8Array; proofType: StateProofType }): Promise<{ readonly proof: Uint8Array }>;
  };
};

/**
 * Anything that can turn a transaction body into a signed wire transaction for
 * one fee payer: a Trezor account, a local key, or a custody signer (the shape
 * of `@thru/ledger`'s `TransactionBodySigner`).
 */
export type TransactionBodySigner = {
  readonly publicKey: Uint8Array;
  /** `options.signal` cancels the signing; a signer that cannot cancel may ignore it. */
  signTransactionBody(body: Uint8Array, options?: { signal?: AbortSignal }): Promise<Uint8Array>;
};

/* Device steps watch the signal themselves; the host-side steps between them
   (review, fee payer signing, submit) check it here. */
function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw new TrezorAbortedError();
}

function eitherSignal(a: AbortSignal | undefined, b: AbortSignal | undefined): AbortSignal | undefined {
  if (a === undefined || a === b) return b;
  if (b === undefined) return a;
  return AbortSignal.any([a, b]);
}

/** Refuses unless the client says the network is RFC 8032 (no default). */
function assertRfc8032(thru: TrezorThruClient): void {
  assertTrezorSigningScheme((thru as Partial<TrezorThruClient>).ctx?.transactionSigningScheme);
}

/**
 * A {@link TransactionBodySigner} backed by a Trezor account. It is made for
 * `publicKey`: the key the device has at `path` is compared with it from the
 * device's answer to the public-key request, before anything is signed, so a
 * path that resolves to another account never gets a signature. `path`,
 * `publicKey` and `options` are read here, once.
 */
export function trezorBodySigner(
  trezor: ThruTrezorSigner,
  path: TrezorPathInput,
  publicKey: Uint8Array,
  options: OperationOptions & { tokenHint?: TokenHint | Uint8Array } = {},
): TransactionBodySigner {
  const parsed = parseTrezorPath(path);
  const key = copyBytes(publicKey);
  const signal = options.signal;
  const tokenHint = snapshotTokenHint(options.tokenHint);
  return {
    publicKey: copyBytes(key),
    async signTransactionBody(body: Uint8Array, call: { signal?: AbortSignal } = {}): Promise<Uint8Array> {
      const out = await trezor.signTransactionBody(parsed, body, {
        signal: eitherSignal(signal, call.signal),
        tokenHint,
        expectedPublicKey: key,
      });
      if (!bytesEqual(out.publicKey, key)) {
        // The device has signed: a signature by another key exists.
        throw new TrezorKeyMismatchError(thruAddress(key), thruAddress(out.publicKey), { passphraseWallet: trezor.passphraseOnDevice, outcomeUnknown: true });
      }
      return out.signedTransaction;
    },
  };
}

/**
 * A {@link TransactionBodySigner} backed by a local Ed25519 key, for example
 * the wallet's existing fee payer when onboarding a new Trezor EOA.
 */
export function privateKeyBodySigner(privateKey: Uint8Array, publicKey: Uint8Array): TransactionBodySigner {
  const secret = new Uint8Array(privateKey);
  const key = new Uint8Array(publicKey);
  return {
    // A copy on every read: what a caller does to it must not reach the key this signer signs for.
    get publicKey(): Uint8Array {
      return copyBytes(key);
    },
    async signTransactionBody(body: Uint8Array): Promise<Uint8Array> {
      const message = buildTransactionSigningMessage(body);
      const signature = await signWithDomain(message.body, secret, key, SignatureDomain.TXN);
      return attachTransactionSignature(message, signature);
    },
  };
}

export type TrezorTransactionResult = {
  /** `body || signature`, strictly verified. */
  readonly signedTransaction: Uint8Array;
  readonly signature: Uint8Array;
  /** What the device showed (known before it was used): never `null` in a result. */
  readonly review: TrezorReview;
};

export type BuildWithTrezorOptions = OperationOptions & {
  /** The token hint to send with the transaction (a token transfer). */
  tokenHint?: TokenHint | Uint8Array;
  /**
   * Called with the review the device will show, after the body is built and
   * before it is sent. Its result is awaited: nothing is sent to the device
   * until it resolves, so a wallet can show the review and wait for the
   * person. Throwing (or rejecting) ends the call; anything that is not a
   * {@link TrezorError} becomes {@link TrezorAbortedError}.
   */
  onReview?: (review: TrezorReview) => unknown;
};

/** Runs `onReview` and waits for it; a failure ends the call before the device is used. */
async function gateOnReview(onReview: BuildWithTrezorOptions['onReview'], review: TrezorReview): Promise<void> {
  if (onReview === undefined) return;
  try {
    await onReview(review);
  } catch (e) {
    throw e instanceof TrezorError ? e : new TrezorAbortedError({ cause: e });
  }
}

/** The review of `body`, or the refusal the app would answer, before the device is used. */
function reviewBeforeDevice(
  body: Uint8Array,
  publicKey: Uint8Array,
  path: TrezorPathInput,
  tokenHint: TokenHint | Uint8Array | undefined,
): TrezorReview {
  const review = transactionReview(body, publicKey, path, tokenHint);
  if (review === null) {
    throw new TrezorInvalidRequestError(
      'the Thru app on the Trezor will refuse this transaction: it is not one of the layouts it signs, its fee payer is not this key, or the token hint does not prove its token accounts',
      { reason: 'unsupported_transaction' },
    );
  }
  return review;
}

/**
 * Build a transaction with the Trezor account as fee payer, sign it on the
 * device and return the verified wire transaction (not submitted).
 */
export async function buildAndSignWithTrezor(
  thru: TrezorThruClient,
  trezor: ThruTrezorSigner,
  path: TrezorPathInput,
  publicKey: Uint8Array,
  build: Omit<BuildTransactionOptions, 'feePayer'>,
  options: BuildWithTrezorOptions = {},
): Promise<TrezorTransactionResult> {
  assertRfc8032(thru);
  // Everything the call is given is read here, once: the preview, the request
  // and the check of the key use these copies, whatever the caller changes
  // while the transaction is built or the review is shown.
  const parsedPath = parseTrezorPath(path);
  const key = copyBytes(publicKey);
  const input = snapshotBuild(build);
  const signal = options.signal;
  const tokenHint = snapshotTokenHint(options.tokenHint);
  const onReview = options.onReview;
  /* EOA program calls get the canonical transfer budget unless overridden;
     other programs use exactly the caller's header (their budget is
     program-specific). */
  const header = mergeHeader(isEoaProgram(input.program) ? EOA_TRANSFER_RESOURCES : undefined, input.header);
  const tx = await thru.transactions.build({ ...input, header, feePayer: { publicKey: copyBytes(key) } });
  const body = new Uint8Array(tx.toWireForSigning());
  const review = reviewBeforeDevice(body, key, parsedPath, tokenHint);
  await gateOnReview(onReview, review);
  const out = await trezor.signTransactionBody(parsedPath, body, { signal, tokenHint, expectedPublicKey: key });
  if (!bytesEqual(out.publicKey, key)) {
    // The device has signed: a signature by another key exists.
    throw new TrezorKeyMismatchError(thruAddress(key), thruAddress(out.publicKey), { passphraseWallet: trezor.passphraseOnDevice, outcomeUnknown: true });
  }
  return { signedTransaction: out.signedTransaction, signature: out.signature, review };
}

/** {@link buildAndSignWithTrezor}, then `thru.transactions.send`. Resolves to the transaction signature string. */
export async function sendWithTrezor(
  thru: TrezorThruClient,
  trezor: ThruTrezorSigner,
  path: TrezorPathInput,
  publicKey: Uint8Array,
  build: Omit<BuildTransactionOptions, 'feePayer'>,
  options: BuildWithTrezorOptions = {},
): Promise<string> {
  const signal = options.signal;
  const { signedTransaction } = await buildAndSignWithTrezor(thru, trezor, path, publicKey, build, options);
  throwIfCancelled(signal);
  return thru.transactions.send(signedTransaction);
}

export type CreateTrezorEoaArgs = {
  thru: TrezorThruClient;
  trezor: ThruTrezorSigner;
  /** Path of the new Trezor account. */
  path: TrezorPathInput;
  /**
   * Pays the creation fee and signs the outer transaction. A new Trezor EOA
   * cannot pay for its own creation; use a local fee payer, such as a faucet
   * key on test networks. Trezor accounts cannot sign the outer EOA-program
   * creation transaction.
   */
  feePayer: TransactionBodySigner;
  /** The new account's pubkey, if already read from the device. */
  publicKey?: Uint8Array;
  /** Defaults to `thru.chain.getChainId()`. */
  chainId?: number;
  /**
   * Header overrides for the creation transaction (fee, expiry, nonce, unit
   * budget, ...). Unset fields default to {@link EOA_CREATE_RESOURCES} and then
   * to the SDK defaults. `chainId` here is ignored; use `chainId` above.
   */
  header?: TransactionHeaderConfig;
  options?: OperationOptions;
};

export type CreateTrezorEoaResult = {
  /** Transaction signature string from `thru.transactions.send`. */
  readonly transactionSignature: string;
  readonly publicKey: Uint8Array;
  /** The EOA creation authorization signed on the device. */
  readonly authorization: Uint8Array;
  readonly signedTransaction: Uint8Array;
};

/**
 * Create the on-chain EOA for a Trezor account (docs: "Creating An
 * Externally-Keyed EOA"):
 *
 * 1. the Trezor authorizes its own creation with `SignEoaAuth` (reviewed on the
 *    device);
 * 2. prove the account does not exist (CREATING state proof). The runtime
 *    accepts a proof for 128 slots, so it is fetched after the device review;
 *    the authorization does not cover it;
 * 3. build `CREATE_ACCOUNT` on the EOA program, fee paid by `feePayer`;
 * 4. `feePayer` signs the outer transaction; verify, attach and submit.
 *
 * `options.signal` cancels every step up to the submit, including the fee
 * payer's signing.
 */
export async function createTrezorEoa(args: CreateTrezorEoaArgs): Promise<CreateTrezorEoaResult> {
  const { thru, trezor, feePayer } = args;
  assertRfc8032(thru);
  // The arguments are read here, once: the device review and the proof request
  // that follow take as long as they take.
  const path = parseTrezorPath(args.path);
  const payerKey = copyBytes(feePayer.publicKey);
  const given = args.publicKey === undefined ? undefined : copyBytes(args.publicKey);
  const headerOverrides = args.header === undefined ? undefined : { ...args.header };
  const signal = args.options?.signal;
  const callOptions = { signal };
  const givenChainId = args.chainId;
  const publicKey = given ?? (await trezor.getAddress(path, callOptions)).publicKey;
  const chainId = givenChainId ?? (await thru.chain.getChainId());

  const { signature: authorization } = await trezor.signEoaAuth(path, 'create', chainId, payerKey, publicKey, callOptions);
  const proof = await thru.proofs.generate({ address: copyBytes(publicKey), proofType: StateProofType.CREATING });

  /* Accounts are [feePayer, program, ...readWrite]: the new EOA is index 2. */
  const NEW_EOA_ACCOUNT_INDEX = 2;
  const tx = await thru.transactions.build({
    feePayer: { publicKey: copyBytes(payerKey) },
    header: { ...mergeHeader(EOA_CREATE_RESOURCES, headerOverrides), chainId },
    program: eoa.EOA_PROGRAM_ADDRESS,
    accounts: { readWrite: [copyBytes(publicKey)] },
    instructionData: eoa.buildCreateEOAInstruction(NEW_EOA_ACCOUNT_INDEX, authorization, proof.proof),
  });
  const body = new Uint8Array(tx.toWireForSigning());
  const expected = buildTransactionSigningMessage(body);
  throwIfCancelled(signal);
  const signerWire = copyBytes(await feePayer.signTransactionBody(body, { signal }));
  if (signerWire.length !== body.length + 64 || !bytesEqual(signerWire.subarray(0, body.length), expected.body)) {
    throw new TrezorInvalidRequestError('the fee payer signer returned a different transaction body');
  }
  const signedTransaction = await attachTransactionSignature(expected, signerWire.subarray(body.length));
  throwIfCancelled(signal);
  const transactionSignature = await thru.transactions.send(signedTransaction);
  return { transactionSignature, publicKey, authorization, signedTransaction };
}
