/**
 * Byte-exact request encoders, chunk planners and response decoders for every
 * Thru app INS (`specs/ledger/app-thru-apdu.md` §3, §6-§9). Pure: no DMK and
 * no I/O. The DMK commands in `src/dmk/commands` are thin wrappers over these.
 */
import { InvalidRequestError, ProtocolError } from '../errors';
import { concatBytes, copyBytes, u32be } from './bytes';
import {
  APDU_MAX_DATA,
  CHUNK_INDEX_MAX,
  CHUNK_SIZE_MIN,
  EoaAuthKind,
  Ins,
  MSG_MAX,
  P1_DISPLAY,
  P1_SILENT,
  P2_LAST,
  P2_MORE,
  PUBKEY_SZ,
  SIGNATURE_SZ,
  THRU_CLA,
  TXN_BODY_MAX,
} from './constants';
import { encodeLedgerPath, type LedgerPathInput } from './path';
import { encodeTokenHint, type TokenHint } from './token-hint';

/** One command APDU (short form, `Lc <= 255`). */
export interface ApduCommand {
  readonly cla: number;
  readonly ins: number;
  readonly p1: number;
  readonly p2: number;
  readonly data: Uint8Array;
}

function isByte(v: number): boolean {
  return Number.isInteger(v) && v >= 0 && v <= 0xff;
}

function apdu(ins: number, p1: number, p2: number, data: Uint8Array = new Uint8Array(0)): ApduCommand {
  /* P1/P2 are one byte on the wire. Serializers truncate mod 256, so a P1 of
     256 would silently become chunk 0 (a new device session, §3.4/§10.2). */
  if (!isByte(p1) || !isByte(p2)) {
    throw new Error(`APDU P1/P2 must be 0..255, got P1=${p1} P2=${p2}`);
  }
  if (data.length > APDU_MAX_DATA) {
    throw new Error(`APDU data ${data.length} bytes exceeds ${APDU_MAX_DATA}`);
  }
  return Object.freeze({ cla: THRU_CLA, ins, p1, p2, data });
}

/** Serialize `CLA INS P1 P2 Lc data` (§3.1). `Lc` is always present. */
export function serializeApdu(cmd: ApduCommand): Uint8Array {
  if (!isByte(cmd.cla) || !isByte(cmd.ins) || !isByte(cmd.p1) || !isByte(cmd.p2) || cmd.data.length > APDU_MAX_DATA) {
    throw new Error('APDU header bytes must be 0..255 and data at most 255 bytes');
  }
  const out = new Uint8Array(5 + cmd.data.length);
  out[0] = cmd.cla;
  out[1] = cmd.ins;
  out[2] = cmd.p1;
  out[3] = cmd.p2;
  out[4] = cmd.data.length;
  out.set(cmd.data, 5);
  return out;
}

/** Split `bytes` into consecutive chunks of at most `size` bytes (none empty). */
export function chunkBytes(bytes: Uint8Array, size: number = APDU_MAX_DATA): Uint8Array[] {
  if (!Number.isInteger(size) || size < 1 || size > APDU_MAX_DATA) {
    throw new Error(`chunk size must be 1..${APDU_MAX_DATA}`);
  }
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.length; offset += size) {
    chunks.push(bytes.subarray(offset, Math.min(offset + size, bytes.length)));
  }
  return chunks;
}

/**
 * Chunk a SIGN_TXN body or SIGN_MESSAGE pass for the planners: the chunk size
 * must be {@link CHUNK_SIZE_MIN}..255 and the stream must fit in P1 = 1..255
 * (§3.4: P1 never wraps).
 */
function planChunks(bytes: Uint8Array, chunkSize: number): Uint8Array[] {
  if (!Number.isInteger(chunkSize) || chunkSize < CHUNK_SIZE_MIN || chunkSize > APDU_MAX_DATA) {
    throw new InvalidRequestError(
      'invalid_argument',
      `chunk size must be ${CHUNK_SIZE_MIN}..${APDU_MAX_DATA}, got ${chunkSize}`,
    );
  }
  const chunks = chunkBytes(bytes, chunkSize);
  if (chunks.length > CHUNK_INDEX_MAX) {
    throw new InvalidRequestError(
      'invalid_argument',
      `${bytes.length} bytes at ${chunkSize} per chunk need ${chunks.length} chunks; P1 allows at most ${CHUNK_INDEX_MAX}`,
    );
  }
  return chunks;
}

/* ---------------------------------------------------------------- simple */

export function getVersionApdu(): ApduCommand {
  return apdu(Ins.GET_VERSION, 0, 0);
}

export function getAppNameApdu(): ApduCommand {
  return apdu(Ins.GET_APP_NAME, 0, 0);
}

export function getAppConfigApdu(): ApduCommand {
  return apdu(Ins.GET_APP_CONFIG, 0, 0);
}

export function getPubkeyApdu(path: LedgerPathInput, display: boolean): ApduCommand {
  return apdu(Ins.GET_PUBKEY, display ? P1_DISPLAY : P1_SILENT, 0, encodeLedgerPath(path));
}

/* -------------------------------------------------------------- SIGN_TXN */

/**
 * Plan the SIGN_TXN exchange (§7.2): chunk 0 carries the path, followed by
 * the encoded `tokenHint` when one is given (§7.2.1) (`P1 = 0`,
 * `P2 = 0x80`); chunks `1..N` carry the body, `P2 = 0x80` on all but the
 * last. The body is copied, so later mutation of the caller's buffer cannot
 * change what is streamed. `chunkSize` must be {@link CHUNK_SIZE_MIN}..255
 * and the body must fit in 255 data chunks (P1 never wraps, §3.4); otherwise
 * this throws `InvalidRequestError`. The hint is only encoded here; check it
 * against the body with `verifyTokenHint`.
 */
export function signTxnApdus(
  path: LedgerPathInput,
  body: Uint8Array,
  chunkSize: number = APDU_MAX_DATA,
  tokenHint?: TokenHint,
): ApduCommand[] {
  if (body.length === 0 || body.length > TXN_BODY_MAX) {
    throw new InvalidRequestError(
      'invalid_argument',
      `transaction body must be 1..${TXN_BODY_MAX} bytes, got ${body.length}`,
    );
  }
  const snapshot = copyBytes(body);
  const chunks = planChunks(snapshot, chunkSize);
  const chunk0 =
    tokenHint === undefined
      ? encodeLedgerPath(path)
      : concatBytes(encodeLedgerPath(path), encodeTokenHint(tokenHint));
  return [
    apdu(Ins.SIGN_TXN, 0, P2_MORE, chunk0),
    ...chunks.map((chunk, i) => apdu(Ins.SIGN_TXN, i + 1, i === chunks.length - 1 ? P2_LAST : P2_MORE, chunk)),
  ];
}

/* ---------------------------------------------------------- SIGN_MESSAGE */

export interface SignMessagePlan {
  /** Chunk 0: `path ‖ msg_len` (u32 big-endian), `P1 = 0`, `P2 = 0x80`. */
  readonly header: ApduCommand;
  /** Pass 1, `P1 = 1..K`. The device review happens inside the last one. */
  readonly pass1: readonly ApduCommand[];
  /** Pass 2, the same bytes again, `P1` restarted at 1. */
  readonly pass2: readonly ApduCommand[];
}

/**
 * Plan the two-pass SIGN_MESSAGE exchange (§8.2). Both passes are built from
 * one immutable snapshot of `message` with identical chunking. The
 * `chunkSize` rules of {@link signTxnApdus} apply to each pass.
 */
export function signMessageApdus(
  path: LedgerPathInput,
  message: Uint8Array,
  chunkSize: number = APDU_MAX_DATA,
): SignMessagePlan {
  if (message.length === 0 || message.length > MSG_MAX) {
    throw new InvalidRequestError(
      'msg_invalid_length',
      `message must be 1..${MSG_MAX} bytes, got ${message.length}`,
    );
  }
  const snapshot = copyBytes(message);
  const chunks = planChunks(snapshot, chunkSize);
  const pass = (): ApduCommand[] => {
    return chunks.map((chunk, i) =>
      apdu(Ins.SIGN_MESSAGE, i + 1, i === chunks.length - 1 ? P2_LAST : P2_MORE, chunk),
    );
  };
  return Object.freeze({
    header: apdu(Ins.SIGN_MESSAGE, 0, P2_MORE, concatBytes(encodeLedgerPath(path), u32be(snapshot.length))),
    pass1: Object.freeze(pass()),
    pass2: Object.freeze(pass()),
  });
}

/* --------------------------------------------------------- SIGN_EOA_AUTH */

function checkPubkey(name: string, key: Uint8Array): void {
  if (!(key instanceof Uint8Array) || key.length !== PUBKEY_SZ) {
    throw new InvalidRequestError('invalid_argument', `${name} must be a 32-byte public key`);
  }
}

/** Accepts `"create" | "delete"` or the numeric kind byte. */
export type EoaAuthKindInput = EoaAuthKind | 'create' | 'delete';

export function normalizeEoaAuthKind(kind: EoaAuthKindInput): EoaAuthKind {
  if (kind === 'create' || kind === EoaAuthKind.CREATE) return EoaAuthKind.CREATE;
  if (kind === 'delete' || kind === EoaAuthKind.DELETE) return EoaAuthKind.DELETE;
  throw new InvalidRequestError('eoa_invalid_kind', `unknown EOA authorization kind ${String(kind)}`);
}

export function checkChainId(chainId: number): void {
  if (!Number.isInteger(chainId) || chainId < 0 || chainId > 0xffff) {
    throw new InvalidRequestError('invalid_argument', `chain_id must be a u16, got ${chainId}`);
  }
  if (chainId === 0) {
    throw new InvalidRequestError('chain_id_zero', 'chain_id must not be 0');
  }
}

/**
 * SIGN_EOA_AUTH request (§9.1): `path ‖ kind ‖ chain_id (u16 LE) ‖ fee_payer ‖ account`.
 */
export function signEoaAuthApdu(
  path: LedgerPathInput,
  kind: EoaAuthKindInput,
  chainId: number,
  feePayer: Uint8Array,
  account: Uint8Array,
): ApduCommand {
  const k = normalizeEoaAuthKind(kind);
  checkChainId(chainId);
  checkPubkey('feePayer', feePayer);
  checkPubkey('account', account);
  const tail = new Uint8Array(1 + 2 + PUBKEY_SZ + PUBKEY_SZ);
  tail[0] = k;
  new DataView(tail.buffer).setUint16(1, chainId, true);
  tail.set(feePayer, 3);
  tail.set(account, 3 + PUBKEY_SZ);
  return apdu(Ins.SIGN_EOA_AUTH, 0, 0, concatBytes(encodeLedgerPath(path), tail));
}

/* ------------------------------------------------------------- decoders */

function expectLength(what: string, data: Uint8Array, length: number): void {
  if (data.length !== length) {
    throw new ProtocolError('invalid_response', `${what}: expected ${length} bytes, got ${data.length}`);
  }
}

export interface AppVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

export interface AppConfig {
  /** bit0 of `flags`: the blind-signing setting. Advisory only (§6.3). */
  readonly blindSigningEnabled: boolean;
  /** Raw flags byte. Bits 1..7 are reserved and ignored. */
  readonly flags: number;
  readonly version: AppVersion;
  readonly apduProtocolVersion: number;
}

export function decodeVersionResponse(data: Uint8Array): AppVersion {
  expectLength('GET_VERSION', data, 3);
  return { major: data[0], minor: data[1], patch: data[2] };
}

export function decodeAppNameResponse(data: Uint8Array): string {
  if (data.length === 0 || data.length > 32) {
    throw new ProtocolError('invalid_response', `GET_APP_NAME: unexpected length ${data.length}`);
  }
  let name = '';
  for (const b of data) {
    if (b < 0x20 || b > 0x7e) throw new ProtocolError('invalid_response', 'GET_APP_NAME: non-printable byte');
    name += String.fromCharCode(b);
  }
  return name;
}

export function decodeAppConfigResponse(data: Uint8Array): AppConfig {
  expectLength('GET_APP_CONFIG', data, 5);
  return {
    blindSigningEnabled: (data[0] & 0x01) !== 0,
    flags: data[0],
    version: { major: data[1], minor: data[2], patch: data[3] },
    apduProtocolVersion: data[4],
  };
}

export function decodePubkeyResponse(data: Uint8Array): Uint8Array {
  expectLength('GET_PUBKEY', data, PUBKEY_SZ);
  return copyBytes(data);
}

export function decodeSignatureResponse(data: Uint8Array): Uint8Array {
  expectLength('signature', data, SIGNATURE_SZ);
  return copyBytes(data);
}

/** Intermediate chunks (and the end of message pass 1) carry no data. */
export function decodeEmptyResponse(what: string, data: Uint8Array): void {
  expectLength(what, data, 0);
}
