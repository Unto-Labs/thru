/**
 * Device tasks: the per-operation APDU sequences, run inside one DMK device
 * action so DMK's intent queue keeps the session pinger/refresher (`B0 01`,
 * `E0 01`) from interleaving. Interleaving any other APDU clears the device
 * session (§10.2, invariant I4).
 *
 * Each task performs the host obligations of §11: confirm the open app is
 * "Thru" (`B0 01`), check `apdu_protocol_version`, pre-validate inputs so
 * errors are clear and early, and verify every signature strictly before
 * returning it.
 */
import {
  type DmkResult,
  DmkResultFactory,
  GetAppAndVersionCommand,
  type InternalApi,
  isSuccessCommandResult,
  type Command,
} from '@ledgerhq/device-management-kit';
import { sha256 } from '@noble/hashes/sha2.js';
import {
  attachTransactionSignature,
  buildTransactionSigningMessage,
  eoa,
  SignatureDomain,
  type TransactionSigningScheme,
  verifyMessage,
  verifyWithDomain,
} from '@thru/sdk';

import {
  assertLedgerSigningScheme,
  BlindSigningDisabledError,
  EoaAccountMismatchError,
  FeePayerMismatchError,
  InvalidSignatureError,
  KeyMismatchError,
  MalformedTransactionError,
  ProtocolError,
  type ThruLedgerError,
  UnsupportedAppVersionError,
  WrongAppError,
} from '../errors';
import {
  type AppConfig,
  type EoaAuthKindInput,
  normalizeEoaAuthKind,
  signMessageApdus,
  signTxnApdus,
} from '../protocol/apdu';
import { bytesEqual, concatBytes } from '../protocol/bytes';
import { APDU_PROTOCOL_VERSION, EoaAuthKind, Ins, THRU_APP_NAME, TXN_HDR_SZ } from '../protocol/constants';
import { messageDisplayMode } from '../protocol/display';
import { type LedgerPathInput, parseLedgerPath } from '../protocol/path';
import { StatusWord } from '../protocol/status-words';
import { type TokenHint, verifyTokenHint } from '../protocol/token-hint';
import { decodeClearTransfer } from '../protocol/transfer';
import { parseTransactionBody } from '../protocol/txn-parser';
import {
  GetAppConfigCommand,
  GetPubkeyCommand,
  SignChunkCommand,
  SignEoaAuthCommand,
} from './commands';
import { toThruLedgerError } from './to-error';

/** Progress of a streamed SIGN_TXN or SIGN_MESSAGE. */
export interface SignProgress {
  readonly operation: 'signTransaction' | 'signMessage';
  /** `txn` for SIGN_TXN; `pass1`/`pass2` for the two message passes. */
  readonly phase: 'txn' | 'pass1' | 'pass2';
  /** Data chunks acknowledged so far, over all phases. */
  readonly chunksSent: number;
  readonly chunksTotal: number;
  readonly bytesSent: number;
  readonly bytesTotal: number;
}

export type ProgressCallback = (progress: SignProgress) => void;

/** Fields every signing task needs for the D11 check. */
export interface SigningSchemeArgs {
  /**
   * The target network's outer-transaction signing scheme
   * (`thru.ctx.transactionSigningScheme`). Anything other than RFC-8032,
   * including a missing value, is refused before any APDU (D11, §11.1).
   */
  transactionSigningScheme: TransactionSigningScheme;
}

async function send<T>(api: InternalApi, command: Command<T, void, string>, ins?: number): Promise<T> {
  const result = await api.sendCommand(command);
  if (isSuccessCommandResult(result)) return result.data;
  throw toThruLedgerError(result.error, { ins });
}

/** Run `body`, turning a thrown error into a typed DMK error result. */
async function runTask<T>(body: () => Promise<T>): Promise<DmkResult<T, ThruLedgerError>> {
  try {
    return DmkResultFactory({ data: await body() });
  } catch (e) {
    return DmkResultFactory({ error: toThruLedgerError(e) });
  }
}

/** §5.2 / §11.1: require the open app to be "Thru" before any Thru INS. */
export async function ensureThruApp(api: InternalApi): Promise<void> {
  const result = await api.sendCommand(new GetAppAndVersionCommand());
  if (!isSuccessCommandResult(result)) throw toThruLedgerError(result.error);
  const name = result.data.name;
  if (name !== THRU_APP_NAME) {
    throw new WrongAppError(name === 'BOLOS' ? 'not_open' : 'other_app', { openApp: name });
  }
}

/** §6.3: read the config and refuse an unknown `apdu_protocol_version`. */
export async function readAppConfig(api: InternalApi): Promise<AppConfig> {
  const config = await send(api, new GetAppConfigCommand(), Ins.GET_APP_CONFIG);
  if (config.apduProtocolVersion !== APDU_PROTOCOL_VERSION) {
    throw new UnsupportedAppVersionError(config.apduProtocolVersion, APDU_PROTOCOL_VERSION);
  }
  return config;
}

async function silentPubkey(api: InternalApi, path: LedgerPathInput): Promise<Uint8Array> {
  return send(api, new GetPubkeyCommand({ path, display: false }), Ins.GET_PUBKEY);
}

/* ------------------------------------------------------------- tasks */

export interface GetAddressTaskArgs {
  path: LedgerPathInput;
  display: boolean;
}

export function getAddressTask(api: InternalApi, args: GetAddressTaskArgs): Promise<DmkResult<Uint8Array, ThruLedgerError>> {
  return runTask(async () => {
    const path = parseLedgerPath(args.path);
    await ensureThruApp(api);
    /* §6.3/§11.1: refuse an app whose APDU protocol we do not implement
       before deriving (and possibly registering) an address from it. */
    await readAppConfig(api);
    return send(api, new GetPubkeyCommand({ path, display: args.display }), Ins.GET_PUBKEY);
  });
}

export function getAppConfigTask(api: InternalApi): Promise<DmkResult<AppConfig, ThruLedgerError>> {
  return runTask(async () => {
    await ensureThruApp(api);
    return readAppConfig(api);
  });
}

export interface SignTransactionTaskArgs extends SigningSchemeArgs {
  path: LedgerPathInput;
  /** Wire bytes without the trailing signature. */
  body: Uint8Array;
  /**
   * Mint and owners for a token transfer (§7.2.1). Checked against the body
   * before the device is contacted; the device then shows the owners and
   * the mint instead of the token accounts.
   */
  tokenHint?: TokenHint;
  onProgress?: ProgressCallback;
}

export interface SignTransactionOutput {
  /** Raw 64-byte Ed25519 signature over `M = DST_TXN ‖ SHA-256(body)`. */
  readonly signature: Uint8Array;
  /** `body ‖ signature`, verified strictly by `attachTransactionSignature`. */
  readonly signedTransaction: Uint8Array;
  /** The device pubkey for the path (= the body's fee payer). */
  readonly publicKey: Uint8Array;
}

export function signTransactionTask(
  api: InternalApi,
  args: SignTransactionTaskArgs,
): Promise<DmkResult<SignTransactionOutput, ThruLedgerError>> {
  return runTask(async () => {
    assertLedgerSigningScheme(args.transactionSigningScheme);
    const path = parseLedgerPath(args.path);
    if (args.body.length < TXN_HDR_SZ) {
      throw new MalformedTransactionError('invalid_format', `body is shorter than the ${TXN_HDR_SZ}-byte header`);
    }
    /* One frozen snapshot: the bytes we pre-check, stream and attach to. */
    const signingMessage = buildTransactionSigningMessage(args.body);
    const body = signingMessage.body;
    const apdus = signTxnApdus(path, body, undefined, args.tokenHint);
    /* §7.2.1: the device's hint rule, before contacting the device. */
    if (args.tokenHint !== undefined) verifyTokenHint(body, args.tokenHint);

    await ensureThruApp(api);
    const config = await readAppConfig(api);
    const publicKey = await silentPubkey(api, path);

    /* §11.1.3: same verdict as the device, before streaming ~130 APDUs. */
    const verdict = parseTransactionBody(body, publicKey);
    if (!verdict.ok) {
      if (verdict.sw === StatusWord.FEE_PAYER_MISMATCH) {
        throw new FeePayerMismatchError(
          `fee payer (body offset 48) is not the Ledger key for ${path.path}`,
        );
      }
      throw new MalformedTransactionError(verdict.reason, verdict.detail);
    }
    /* §7.6/§7.7: only a transaction the device cannot clear-sign needs the
       setting. The flag is advisory; the device re-checks it at the end. */
    if (!config.blindSigningEnabled && decodeClearTransfer(body) === null) {
      throw new BlindSigningDisabledError();
    }

    const dataChunks = apdus.length - 1;
    let signature: Uint8Array | null = null;
    let bytesSent = 0;
    for (let i = 0; i < apdus.length; i++) {
      const isLast = i === apdus.length - 1;
      const out = await send(api, new SignChunkCommand(apdus[i], isLast), Ins.SIGN_TXN);
      if (i > 0) {
        bytesSent += apdus[i].data.length;
        args.onProgress?.({
          operation: 'signTransaction',
          phase: 'txn',
          chunksSent: i,
          chunksTotal: dataChunks,
          bytesSent,
          bytesTotal: body.length,
        });
      }
      if (isLast) signature = out;
    }
    if (signature === null) throw new ProtocolError('invalid_response', 'no signature after the last chunk');

    /* §11.2: verify strictly against the body's fee payer, then attach. */
    let signedTransaction: Uint8Array;
    try {
      signedTransaction = await attachTransactionSignature(signingMessage, signature);
    } catch (e) {
      if (!bytesEqual(signingMessage.expectedPublicKey, publicKey)) {
        throw new KeyMismatchError('the device key is not the transaction fee payer');
      }
      throw new InvalidSignatureError(e instanceof Error ? e.message : String(e));
    }
    return { signature, signedTransaction, publicKey };
  });
}

export interface SignMessageTaskArgs extends SigningSchemeArgs {
  path: LedgerPathInput;
  message: Uint8Array;
  /**
   * The 32-byte key the caller expects for `path`. When set, the task fails
   * with `KeyMismatchError` before any SIGN_MESSAGE APDU if the device key
   * differs.
   */
  expectedPublicKey?: Uint8Array;
  onProgress?: ProgressCallback;
}

export interface SignatureOutput {
  /** Raw 64-byte Ed25519 signature, strictly verified. */
  readonly signature: Uint8Array;
  readonly publicKey: Uint8Array;
}

export function signMessageTask(
  api: InternalApi,
  args: SignMessageTaskArgs,
): Promise<DmkResult<SignatureOutput, ThruLedgerError>> {
  return runTask(async () => {
    assertLedgerSigningScheme(args.transactionSigningScheme);
    const path = parseLedgerPath(args.path);
    const plan = signMessageApdus(path, args.message);
    const message = concatBytes(...plan.pass1.map((a) => a.data));

    await ensureThruApp(api);
    const config = await readAppConfig(api);
    if (messageDisplayMode(message) === 'hash' && !config.blindSigningEnabled) {
      throw new BlindSigningDisabledError();
    }
    const publicKey = await silentPubkey(api, path);
    if (args.expectedPublicKey !== undefined && !bytesEqual(args.expectedPublicKey, publicKey)) {
      throw new KeyMismatchError('the device key is not the expected message signer');
    }

    const chunksTotal = plan.pass1.length + plan.pass2.length;
    let chunksSent = 0;
    let bytesSent = 0;
    const report = (phase: 'pass1' | 'pass2', n: number): void => {
      chunksSent += 1;
      bytesSent += n;
      args.onProgress?.({
        operation: 'signMessage',
        phase,
        chunksSent,
        chunksTotal,
        bytesSent,
        bytesTotal: 2 * message.length,
      });
    };

    await send(api, new SignChunkCommand(plan.header, false), Ins.SIGN_MESSAGE);
    /* Pass 1. The review happens inside the response to the last chunk. */
    const pass1Hash = sha256.create();
    for (const a of plan.pass1) {
      pass1Hash.update(a.data);
      await send(api, new SignChunkCommand(a, false), Ins.SIGN_MESSAGE);
      report('pass1', a.data.length);
    }
    const d1 = pass1Hash.digest();

    /* Pass 2: byte-identical to pass 1, asserted before the last chunk (§11.4). */
    const pass2Hash = sha256.create();
    let signature: Uint8Array | null = null;
    for (let i = 0; i < plan.pass2.length; i++) {
      const a = plan.pass2[i];
      const isLast = i === plan.pass2.length - 1;
      pass2Hash.update(a.data);
      if (isLast && !bytesEqual(pass2Hash.digest(), d1)) {
        throw new ProtocolError('msg_pass_mismatch', 'host pass 2 differs from pass 1');
      }
      const out = await send(api, new SignChunkCommand(a, isLast), Ins.SIGN_MESSAGE);
      report('pass2', a.data.length);
      if (isLast) signature = out;
    }
    if (signature === null) throw new ProtocolError('invalid_response', 'no signature after pass 2');

    if (!(await verifyMessage(signature, message, publicKey))) {
      throw new InvalidSignatureError('message signature does not verify for the device key');
    }
    return { signature, publicKey };
  });
}

export interface SignEoaAuthTaskArgs extends SigningSchemeArgs {
  path: LedgerPathInput;
  kind: EoaAuthKindInput;
  chainId: number;
  feePayer: Uint8Array;
  account: Uint8Array;
}

export function signEoaAuthTask(
  api: InternalApi,
  args: SignEoaAuthTaskArgs,
): Promise<DmkResult<SignatureOutput, ThruLedgerError>> {
  return runTask(async () => {
    assertLedgerSigningScheme(args.transactionSigningScheme);
    const path = parseLedgerPath(args.path);
    const kind = normalizeEoaAuthKind(args.kind);
    const command = new SignEoaAuthCommand({ ...args, path, kind });
    const feePayer = new Uint8Array(args.feePayer);
    const account = new Uint8Array(args.account);

    await ensureThruApp(api);
    await readAppConfig(api);
    const publicKey = await silentPubkey(api, path);
    if (!bytesEqual(account, publicKey)) throw new EoaAccountMismatchError();

    const signature = await send(api, command, Ins.SIGN_EOA_AUTH);

    const build = kind === EoaAuthKind.CREATE ? eoa.buildEOACreateMessage : eoa.buildEOADeleteMessage;
    const domain = kind === EoaAuthKind.CREATE ? SignatureDomain.EOA_CREATE : SignatureDomain.EOA_DELETE;
    const m = build(args.chainId, feePayer, account);
    if (!(await verifyWithDomain(signature, m.subarray(16), account, domain))) {
      throw new InvalidSignatureError('EOA authorization does not verify for the account key');
    }
    return { signature, publicKey };
  });
}
