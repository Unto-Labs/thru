/**
 * Adapters from the Ledger signer into the Thru SDK external-signer flow
 * (`build → body → device → verify-and-attach → send`) and the EOA-creation
 * flow (`SIGN_EOA_AUTH` + a fee-paid `CREATE_ACCOUNT` transaction).
 *
 * The device needs the transaction **body**, not `M`: it parses the envelope,
 * hashes the body itself and signs `"tn_txn_sign_v1__" ‖ SHA-256(body)`. The
 * SDK computes `M` only to cross-check the returned signature.
 */
import {
  attachTransactionSignature,
  buildTransactionSigningMessage,
  eoa,
  signWithDomain,
  SignatureDomain,
  Pubkey,
  type TransactionSigningScheme,
  type BuildTransactionOptions,
  type TransactionHeaderConfig,
} from '@thru/sdk';
import { StateProofType } from '@thru/sdk/proto';

import { assertLedgerSigningScheme, CancelledError, KeyMismatchError, ThruLedgerError } from './errors';
import { bytesEqual } from './protocol/bytes';
import { describeTransaction, type TransactionReview } from './protocol/display';
import { type LedgerPathInput, parseLedgerPath } from './protocol/path';
import { type StreamOperationOptions, type ThruLedgerSigner } from './ThruLedgerSigner';

/** Resource budget fields of a transaction header. */
export interface TransactionResources {
  readonly computeUnits: number;
  readonly memoryUnits: number;
  readonly stateUnits: number;
}

/**
 * Budget for EOA program transfers and deletes. Matches the Rust
 * `build_transfer` / `build_delete_account` builders
 * (`rpc/thru-base/src/txn_tools.rs`) and the web wallet.
 */
export const EOA_TRANSFER_RESOURCES: TransactionResources = Object.freeze({
  computeUnits: 10_000,
  memoryUnits: 10_000,
  stateUnits: 0,
});

/**
 * Budget for EOA creation: the transfer budget plus one state unit for the
 * new account. Matches the Rust `build_create_with_fee_payer_proof` builder
 * and the web wallet. The SDK defaults every unit to 0, which the runtime
 * rejects for these calls.
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
export interface LedgerThruClient {
  /** The network's signing scheme; Ledger signing is refused unless it is RFC-8032 (D11). */
  readonly ctx: { readonly transactionSigningScheme: TransactionSigningScheme };
  readonly transactions: {
    build(options: BuildTransactionOptions): Promise<{ toWireForSigning(): Uint8Array }>;
    send(transaction: Uint8Array): Promise<string>;
  };
  readonly chain: { getChainId(): Promise<number> };
  readonly proofs: {
    generate(options: { address?: Uint8Array; proofType: StateProofType }): Promise<{ readonly proof: Uint8Array }>;
  };
}

/**
 * Anything that can turn a transaction body into a signed wire transaction
 * for one fee payer: a Ledger account, a local key, or a custody signer.
 */
export interface TransactionBodySigner {
  readonly publicKey: Uint8Array;
  /** `options.signal` cancels the signing; a signer that cannot cancel may ignore it. */
  signTransactionBody(body: Uint8Array, options?: { signal?: AbortSignal }): Promise<Uint8Array>;
}

/* Device steps watch the signal themselves; the host-side steps between
   them (review, fee payer signing, submit) check it here. */
function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw new CancelledError();
}

function eitherSignal(a: AbortSignal | undefined, b: AbortSignal | undefined): AbortSignal | undefined {
  if (a === undefined || a === b) return b;
  if (b === undefined) return a;
  return AbortSignal.any([a, b]);
}

/** D11: refuse unless the client says the network is RFC-8032 (no default). */
function assertRfc8032(thru: LedgerThruClient): void {
  assertLedgerSigningScheme((thru as Partial<LedgerThruClient>).ctx?.transactionSigningScheme);
}

/** A {@link TransactionBodySigner} backed by a Ledger account. */
export function ledgerBodySigner(
  ledger: ThruLedgerSigner,
  path: LedgerPathInput,
  publicKey: Uint8Array,
  options: StreamOperationOptions = {},
): TransactionBodySigner {
  const parsed = parseLedgerPath(path);
  const key = new Uint8Array(publicKey);
  return {
    publicKey: key,
    async signTransactionBody(body: Uint8Array, call: { signal?: AbortSignal } = {}): Promise<Uint8Array> {
      const out = await ledger.signTransactionBody(parsed, body, {
        ...options,
        signal: eitherSignal(options.signal, call.signal),
      });
      if (!bytesEqual(out.publicKey, key)) {
        throw new KeyMismatchError(`the Ledger key for ${parsed.path} is not the expected fee payer`);
      }
      return out.signedTransaction;
    },
  };
}

/**
 * A {@link TransactionBodySigner} backed by a local Ed25519 key, for example
 * the wallet's existing fee payer when onboarding a new Ledger EOA.
 */
export function privateKeyBodySigner(privateKey: Uint8Array, publicKey: Uint8Array): TransactionBodySigner {
  const secret = new Uint8Array(privateKey);
  const key = new Uint8Array(publicKey);
  return {
    publicKey: key,
    async signTransactionBody(body: Uint8Array): Promise<Uint8Array> {
      const message = buildTransactionSigningMessage(body);
      const signature = await signWithDomain(message.body, secret, key, SignatureDomain.TXN);
      return attachTransactionSignature(message, signature);
    },
  };
}

export interface LedgerTransactionResult {
  /** `body ‖ signature`, strictly verified. */
  readonly signedTransaction: Uint8Array;
  readonly signature: Uint8Array;
  /** The envelope the device shows, for a pre-device preview (§11.3). */
  readonly review: TransactionReview;
}

export interface BuildWithLedgerOptions extends StreamOperationOptions {
  /**
   * Called with the review (including the transaction hash the device will
   * show) after the body is built and before it is streamed. Its result is awaited:
   * nothing is sent to the device until it resolves, so a wallet can show
   * the preview and wait for the user. Throwing (or rejecting) aborts the
   * operation; a non-`ThruLedgerError` becomes {@link CancelledError}.
   */
  onReview?: (review: TransactionReview) => unknown;
}

/** Run `onReview` and wait for it; a failure aborts before the device is used. */
async function gateOnReview(
  onReview: BuildWithLedgerOptions['onReview'],
  review: TransactionReview,
): Promise<void> {
  if (onReview === undefined) return;
  try {
    await onReview(review);
  } catch (e) {
    throw e instanceof ThruLedgerError ? e : new CancelledError({ cause: e });
  }
}

/**
 * Build a transaction with the Ledger account as fee payer, sign it on the
 * device and return the verified wire transaction (not submitted).
 */
export async function buildAndSignWithLedger(
  thru: LedgerThruClient,
  ledger: ThruLedgerSigner,
  path: LedgerPathInput,
  publicKey: Uint8Array,
  build: Omit<BuildTransactionOptions, 'feePayer'>,
  options: BuildWithLedgerOptions = {},
): Promise<LedgerTransactionResult> {
  assertRfc8032(thru);
  /* EOA program calls get the canonical transfer budget unless overridden;
     other programs use exactly the caller's header (their budget is
     program-specific). */
  const header = mergeHeader(isEoaProgram(build.program) ? EOA_TRANSFER_RESOURCES : undefined, build.header);
  const tx = await thru.transactions.build({ ...build, header, feePayer: { publicKey } });
  const body = new Uint8Array(tx.toWireForSigning());
  const review = describeTransaction(body, publicKey);
  await gateOnReview(options.onReview, review);
  const out = await ledger.signTransactionBody(path, body, options);
  if (!bytesEqual(out.publicKey, publicKey)) {
    throw new KeyMismatchError('the Ledger key for the path is not the transaction fee payer');
  }
  return { signedTransaction: out.signedTransaction, signature: out.signature, review };
}

/** {@link buildAndSignWithLedger}, then `thru.transactions.send`. Resolves to the transaction signature string. */
export async function sendWithLedger(
  thru: LedgerThruClient,
  ledger: ThruLedgerSigner,
  path: LedgerPathInput,
  publicKey: Uint8Array,
  build: Omit<BuildTransactionOptions, 'feePayer'>,
  options: BuildWithLedgerOptions = {},
): Promise<string> {
  const { signedTransaction } = await buildAndSignWithLedger(thru, ledger, path, publicKey, build, options);
  return thru.transactions.send(signedTransaction);
}

export interface CreateLedgerEoaArgs {
  thru: LedgerThruClient;
  ledger: ThruLedgerSigner;
  /** Path of the new Ledger account. */
  path: LedgerPathInput;
  /**
   * Pays the creation fee and signs the outer transaction. A new Ledger EOA
   * cannot pay for its own creation; use the user's existing fee payer, a
   * faucet key on test networks, or another (existing) Ledger account.
   */
  feePayer: TransactionBodySigner;
  /** The new account's pubkey, if already read from the device. */
  publicKey?: Uint8Array;
  /** Defaults to `thru.chain.getChainId()`. */
  chainId?: number;
  /**
   * Header overrides for the creation transaction (fee, expiry, nonce, unit
   * budget, ...). Unset fields default to {@link EOA_CREATE_RESOURCES} and
   * then to the SDK defaults. `chainId` here is ignored; use `chainId` above.
   */
  header?: TransactionHeaderConfig;
  options?: BuildWithLedgerOptions;
}

export interface CreateLedgerEoaResult {
  /** Transaction signature string from `thru.transactions.send`. */
  readonly transactionSignature: string;
  readonly publicKey: Uint8Array;
  /** The EOA creation authorization signed on the device. */
  readonly authorization: Uint8Array;
  readonly signedTransaction: Uint8Array;
}

/**
 * Create the on-chain EOA for a Ledger account (docs: "Creating An
 * Externally-Keyed EOA"):
 *
 * 1. the Ledger authorizes its own creation with SIGN_EOA_AUTH (clear-signed);
 * 2. prove the account does not exist (CREATING state proof). The runtime
 *    accepts a proof for 128 slots, so it is fetched after the device review;
 *    the authorization does not cover it;
 * 3. build `CREATE_ACCOUNT` on the EOA program, fee paid by `feePayer`;
 * 4. `feePayer` signs the outer transaction; verify, attach and submit.
 *
 * `options.signal` cancels every step up to the submit, including the fee
 * payer's signing.
 */
export async function createLedgerEoa(args: CreateLedgerEoaArgs): Promise<CreateLedgerEoaResult> {
  const { thru, ledger, feePayer } = args;
  assertRfc8032(thru);
  const path = parseLedgerPath(args.path);
  const publicKey = args.publicKey ?? (await ledger.getAddress(path)).publicKey;
  const chainId = args.chainId ?? (await thru.chain.getChainId());

  const signal = args.options?.signal;
  const { signature: authorization } = await ledger.signEoaAuth(
    path,
    'create',
    chainId,
    feePayer.publicKey,
    publicKey,
    args.options,
  );
  const proof = await thru.proofs.generate({ address: publicKey, proofType: StateProofType.CREATING });

  /* Accounts are [feePayer, program, ...readWrite]: the new EOA is index 2. */
  const NEW_EOA_ACCOUNT_INDEX = 2;
  const tx = await thru.transactions.build({
    feePayer: { publicKey: feePayer.publicKey },
    header: { ...mergeHeader(EOA_CREATE_RESOURCES, args.header), chainId },
    program: eoa.EOA_PROGRAM_ADDRESS,
    accounts: { readWrite: [publicKey] },
    instructionData: eoa.buildCreateEOAInstruction(NEW_EOA_ACCOUNT_INDEX, authorization, proof.proof),
  });
  const body = new Uint8Array(tx.toWireForSigning());
  const expected = buildTransactionSigningMessage(body);
  throwIfCancelled(signal);
  await gateOnReview(args.options?.onReview, describeTransaction(body, feePayer.publicKey));
  throwIfCancelled(signal);
  const signerWire = await feePayer.signTransactionBody(body, { signal });
  if (signerWire.length !== body.length + 64 || !bytesEqual(signerWire.subarray(0, body.length), expected.body)) {
    throw new Error('fee payer signer returned a different transaction body');
  }
  const signedTransaction = await attachTransactionSignature(expected, signerWire.subarray(body.length));
  throwIfCancelled(signal);
  const transactionSignature = await thru.transactions.send(signedTransaction);
  return { transactionSignature, publicKey, authorization, signedTransaction };
}
