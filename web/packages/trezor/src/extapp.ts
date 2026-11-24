/**
 * Loading an app image onto the device, as `trezorlib.extapp.load_tapp` does
 * and `rpc/thru-trezor/src/extapp.rs` ports.
 *
 * An image is three files (`trezorctl extapp load` reads the same):
 * `<name>.tapp` (header and payload chunks), `<name>.proof` beside it, and the
 * root packet in `root-packets/` two directories above the `.tapp`. The
 * package takes their bytes; it embeds no image (plan B7).
 */
import { sha256 } from '@noble/hashes/sha2.js';

import type { TrezorClient } from './client';
import { copyBytes, equalBytes, fromBase64, fromHex } from './bytes';
import { TrezorAppError, TrezorAppImageError, TrezorCancelledError, TrezorFailureError, TrezorUnexpectedError } from './errors';
import { exclusive } from './operations';
import {
  ExtAppDataChunkAck,
  ExtAppDataChunkRequest,
  ExtAppHeaderAck,
  ExtAppHeaderRequest,
  ExtAppLoad,
  ExtAppLoaded,
  ExtAppRootPacketAck,
  ExtAppRootPacketRequest,
  type MessageCodec,
  type Version,
} from './messages';

const HEADER_MAGIC = 'TRZA';
const ROOT_PACKET_MAGIC = 'TRRP';
/** The bytes of the header this package reads end at the chunk size. */
const HEADER_MIN_LEN = 162;

/** One payload chunk and the hash the device checks it against: the hash of the chain from the next chunk on. */
export type AppImageChunk = { hash: Uint8Array; data: Uint8Array };

/** An app image, ready to send. */
export type AppImage = {
  /** The app's id, for example `thru.thru.org`. */
  id: string;
  /** Major, minor, patch, build. */
  version: readonly [number, number, number, number];
  /** The privilege ring from the header. */
  appRing: number;
  /** The header, as the device wants it. */
  header: Uint8Array;
  /** The concatenated proof. */
  proof: Uint8Array;
  rootPacket: Uint8Array;
  /** The signing time of the root packet. */
  rootPacketTimestamp: bigint;
  chunks: readonly AppImageChunk[];
};

/** The bytes of the three files of an image. */
export type AppImageFiles = { tapp: Uint8Array; proof: Uint8Array; rootPacket: Uint8Array };

/**
 * The app versions this host speaks: `0.1.1 <= version < 0.2.0`. Patch 1 added
 * the optional token hint and the message signing messages; a version without
 * a patch number is patch 0.
 */
export const SUPPORTED_APP_RANGE = '0.1.1 up to (not including) 0.2.0';

export function appVersionSupported(major: number, minor: number, patch: number): boolean {
  if (major !== 0 || minor > 1) return false;
  return minor === 1 && patch >= 1;
}

function parseJson(what: string, bytes: Uint8Array): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object');
    return value as Record<string, unknown>;
  } catch (cause) {
    throw new TrezorAppImageError(`${what}: not valid: ${cause instanceof Error ? cause.message : String(cause)}`, {
      cause,
    });
  }
}

function base64Field(what: string, field: string, value: unknown): Uint8Array {
  if (typeof value !== 'string') throw new TrezorAppImageError(`${what}: ${field} is missing`);
  try {
    return fromBase64(value);
  } catch {
    throw new TrezorAppImageError(`${what}: ${field} is not base64`);
  }
}

function hexField(what: string, field: string, value: unknown): Uint8Array {
  if (typeof value !== 'string') throw new TrezorAppImageError(`${what}: ${field} is missing`);
  try {
    return fromHex(value);
  } catch {
    throw new TrezorAppImageError(`${what}: ${field} is not hex`);
  }
}

type HeaderInfo = {
  id: string;
  version: [number, number, number, number];
  appRing: number;
  chunkHash: Uint8Array;
  chunkSize: number;
};

/** Reads the fields of the header this package needs (layout of `trezorlib.extapp.AppHeader`, little endian). */
function parseHeader(header: Uint8Array): HeaderInfo {
  if (header.length < HEADER_MIN_LEN) throw new TrezorAppImageError('header is too short');
  if (new TextDecoder().decode(header.subarray(0, 4)) !== HEADER_MAGIC) {
    throw new TrezorAppImageError('header does not start with TRZA');
  }
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  const headerSize = view.getUint32(4, true);
  if (headerSize > header.length) {
    throw new TrezorAppImageError(`header says it is ${headerSize} bytes but has ${header.length}`);
  }
  const idField = header.subarray(8, 40);
  const idEnd = idField.indexOf(0);
  let id: string;
  try {
    id = new TextDecoder('utf-8', { fatal: true }).decode(idField.subarray(0, idEnd < 0 ? idField.length : idEnd));
  } catch {
    throw new TrezorAppImageError('app id is not UTF-8');
  }
  return {
    id,
    version: [header[108], header[109], header[110], header[111]],
    appRing: header[118],
    chunkHash: copyBytes(header.subarray(128, 160)),
    chunkSize: view.getUint16(160, true),
  };
}

/** The app's id, version and ring from the bytes of a `.tapp` file: enough to choose the root packet file. */
export function readAppHeader(tapp: Uint8Array): { id: string; version: readonly number[]; appRing: number } {
  const file = parseJson('.tapp file', tapp);
  const info = parseHeader(base64Field('.tapp file', 'header', file.header));
  return { id: info.id, version: info.version, appRing: info.appRing };
}

/** Ring 0 apps are signed by the ring 0 root packet, rings 1 and 2 by the other. */
export function rootPacketFileName(appRing: number): string {
  return appRing === 0 ? 'rootpacket_ring0.tmr' : 'rootpacket_ring12.tmr';
}

/** The timestamp of a root packet (`i64` at offset 8). */
function parseRootPacket(packet: Uint8Array): bigint {
  if (packet.length < 16 || new TextDecoder().decode(packet.subarray(0, 4)) !== ROOT_PACKET_MAGIC) {
    throw new TrezorAppImageError('root packet file: not a root packet');
  }
  return new DataView(packet.buffer, packet.byteOffset, packet.byteLength).getBigInt64(8, true);
}

function concatHash(chain: Uint8Array, data: Uint8Array): Uint8Array {
  const joined = new Uint8Array(chain.length + data.length);
  joined.set(chain, 0);
  joined.set(data, chain.length);
  return sha256(joined);
}

/**
 * Checks the hash chain as `AppImage.chunks()` of trezorlib does: from the last
 * chunk back, each chunk carries the hash of everything after it, and the
 * result for the first chunk is the header's chunk hash.
 */
function checkChunks(chunks: readonly AppImageChunk[], headerChunkHash: Uint8Array, chunkSize: number): void {
  if (chunkSize === 0) throw new TrezorAppImageError('header chunk size is 0');
  let chain: Uint8Array = new Uint8Array(32);
  for (let index = chunks.length - 1; index >= 0; index--) {
    const chunk = chunks[index];
    const last = index + 1 === chunks.length;
    if (chunk.data.length > chunkSize || (!last && chunk.data.length !== chunkSize)) {
      throw new TrezorAppImageError(`chunk ${index} has ${chunk.data.length} bytes`);
    }
    if (!equalBytes(chunk.hash, chain)) {
      throw new TrezorAppImageError(`hash of chunk ${index} does not follow from the chunks after it`);
    }
    chain = concatHash(chain, chunk.data);
  }
  if (!equalBytes(chain, headerChunkHash)) {
    throw new TrezorAppImageError("the chunks do not hash to the header's chunk hash");
  }
}

/**
 * Reads the image from the bytes of its three files, checks the chunks
 * against the header, and refuses an app version outside
 * {@link SUPPORTED_APP_RANGE}.
 */
export function parseAppImage(files: AppImageFiles): AppImage {
  const tapp = parseJson('.tapp file', files.tapp);
  const header = base64Field('.tapp file', 'header', tapp.header);
  let info: HeaderInfo;
  try {
    info = parseHeader(header);
  } catch (error) {
    throw new TrezorAppImageError(`.tapp file: ${(error as Error).message}`, { cause: error });
  }

  const proofFile = parseJson('.proof file', files.proof);
  if (!Array.isArray(proofFile.proof)) throw new TrezorAppImageError('.proof file: proof is missing');
  const proof = hexField('.proof file', 'proof', (proofFile.proof as unknown[]).join(''));

  const rootFile = parseJson('root packet file', files.rootPacket);
  const rootPacket = base64Field('root packet file', 'root_packet', rootFile.root_packet);
  const rootPacketTimestamp = parseRootPacket(rootPacket);

  if (!Array.isArray(tapp.chunks)) throw new TrezorAppImageError('.tapp file: chunks is missing');
  const chunks = (tapp.chunks as unknown[]).map((entry, index): AppImageChunk => {
    if (!Array.isArray(entry) || entry.length !== 2) throw new TrezorAppImageError(`.tapp file: chunk ${index} is malformed`);
    return {
      hash: hexField('.tapp file', `hash of chunk ${index}`, entry[0]),
      data: base64Field('.tapp file', `chunk ${index}`, entry[1]),
    };
  });
  try {
    checkChunks(chunks, info.chunkHash, info.chunkSize);
  } catch (error) {
    throw new TrezorAppImageError(`.tapp file: ${(error as Error).message}`, { cause: error });
  }

  const [major, minor, patch, build] = info.version;
  if (!appVersionSupported(major, minor, patch)) {
    throw new TrezorAppImageError(
      `.tapp file: app version ${major}.${minor}.${patch}.${build} is not supported, this host supports ${SUPPORTED_APP_RANGE}`,
    );
  }
  return {
    id: info.id,
    version: info.version,
    appRing: info.appRing,
    header,
    proof,
    rootPacket,
    rootPacketTimestamp,
    chunks,
  };
}

/**
 * The SHA-256 of the header, `header_size` bytes of it: what the device
 * records as the image's fingerprint (`app_arena_create_image` hashes the
 * header up to `header->header_size`, the bytes it was sent in
 * `ExtAppHeaderAck.header`) and what trezorlib's `AppHeader.fingerprint`
 * computes.
 */
export function appFingerprint(image: Pick<AppImage, 'header'>): Uint8Array {
  const header = image.header;
  let size = header.length;
  if (header.length >= 8) {
    const declared = new DataView(header.buffer, header.byteOffset, header.byteLength).getUint32(4, true);
    size = Math.min(declared, header.length);
  }
  return sha256(header.subarray(0, size));
}

/** Where the header names the model the image was built for: four ASCII characters padded with zeros. */
const HEADER_MODEL_START = 104;
const HEADER_MODEL_END = 108;

/**
 * The model the image was built for, as its header names it (`T3W1` for the
 * Safe 7, `T3T1` for the Safe 5): the ASCII text of bytes 104 to 108 up to the
 * first zero. A header that ends before it, or whose field is empty or not
 * ASCII, is refused: an image that does not say what it is for cannot be
 * checked against the device.
 */
export function appImageModel(image: Pick<AppImage, 'header'>): string {
  const header = image.header;
  if (header.length < HEADER_MODEL_END) throw new TrezorAppImageError('the image header is too short');
  const field = header.subarray(HEADER_MODEL_START, HEADER_MODEL_END);
  const zero = field.indexOf(0);
  const name = field.subarray(0, zero < 0 ? field.length : zero);
  if (name.length === 0 || name.some((byte) => byte >= 0x80)) {
    throw new TrezorAppImageError('the image header does not name the model the image was built for');
  }
  return new TextDecoder().decode(name);
}

/**
 * Refuses an image built for another model than the device's, naming both.
 * The device does not check it, and the app's texts are built per model.
 */
export function checkImageModel(imageModel: string, deviceModel: string): void {
  if (imageModel === deviceModel) return;
  throw new TrezorAppImageError(
    `the app image is built for the ${imageModel}, and this Trezor is a ${deviceModel}; use the image built for the ${deviceModel}`,
  );
}

/** A copy of the image in memory of its own: nothing the caller does to its arrays afterwards reaches it. */
export function copyAppImage(image: AppImage): AppImage {
  return {
    id: image.id,
    version: [...image.version] as unknown as AppImage['version'],
    appRing: image.appRing,
    header: copyBytes(image.header),
    proof: copyBytes(image.proof),
    rootPacket: copyBytes(image.rootPacket),
    rootPacketTimestamp: image.rootPacketTimestamp,
    chunks: image.chunks.map((chunk) => ({ hash: copyBytes(chunk.hash), data: copyBytes(chunk.data) })),
  };
}

/** Refuses an app version outside the supported range, naming both. */
export function checkLoadedVersion(version: Version): void {
  if (appVersionSupported(version.major, version.minor, version.patch ?? 0)) return;
  const part = (value: number | undefined): string => (value === undefined ? '?' : String(value));
  throw new TrezorAppError(
    `the device runs app version ${version.major}.${version.minor}.${part(version.patch)}.${part(version.build)}, this host supports ${SUPPORTED_APP_RANGE}; update the host or the app on the device`,
  );
}

export type LoadResult = {
  /** The instance id to address the app with. */
  instanceId: number;
  /** Whether the image was sent: false when the device already held an app of this id and version. */
  uploaded: boolean;
};

/**
 * Loads `image` and returns the instance id to address the app with.
 *
 * The request names the app id, the image's version as the minimum, and the
 * SHA-256 of the image's header ({@link appFingerprint}). The device answers
 * `ExtAppLoaded` at once if it already holds an image of that id with a
 * version at least the one asked for; otherwise it asks for the header, the
 * root packet if its own is out of date, and every chunk.
 *
 * What is guaranteed: the app that runs has this image's id (the device
 * matches it) and a version inside the range this host supports (checked on
 * the answer). Whether it is this very image depends on the firmware: one
 * built with Python assertions (the emulator) compares the fingerprint and
 * loads this image when the held one differs; other firmware keeps an image it
 * already holds with the same id and a version at least as high, even if its
 * contents differ (plan B13).
 *
 * Before anything is sent, the model the image was built for (its header,
 * {@link appImageModel}) must be the model the device reports; otherwise this
 * fails with {@link TrezorAppImageError} naming both. The device does not
 * check it, and the app's texts are built per model. The check looks at the
 * image the host supplies: an image the device holds already is not looked at
 * (see the fingerprint rule above).
 *
 * The image is copied first, and the whole conversation is one operation on
 * the connection ({@link exclusive}): a request of the app started meanwhile
 * waits until the app is loaded.
 */
export async function loadApp(
  client: TrezorClient,
  image: AppImage,
  options: { signal?: AbortSignal } = {},
): Promise<LoadResult> {
  const snapshot = copyAppImage(image);
  const signal = options.signal;
  checkImageModel(appImageModel(snapshot), client.properties.internalModel);
  return exclusive(client, signal, () => loadChecked(client, snapshot, signal));
}

/**
 * {@link loadSnapshot}, and the connection is closed when the load stops with
 * the device still waiting for its next loading message, so that the loader's
 * caller is not left with a connection in that state. That is a response that
 * fails validation (a chunk the image does not have, an answer of another
 * type, a payload that does not decode), and any failure between the device's
 * first loading request and its final answer that is not a refusal: an abort
 * at the gate between two exchanges, a time-out, a failed transfer. A refusal
 * (`Failure`) is the device's clean answer and leaves the connection open; so
 * does a failure before the first message was sent, and so does a complete
 * final answer that the loader then rejects (a version it does not support).
 */
async function loadChecked(client: TrezorClient, image: AppImage, signal: AbortSignal | undefined): Promise<LoadResult> {
  const progress = { midLoad: false };
  try {
    return await loadSnapshot(client, image, signal, progress);
  } catch (error) {
    const refusal = error instanceof TrezorFailureError || error instanceof TrezorCancelledError;
    if (error instanceof TrezorUnexpectedError || (progress.midLoad && !refusal)) await client.close().catch(() => undefined);
    throw error;
  }
}

/**
 * {@link loadApp} without the check of the model, for the recorded
 * conversations of the tests, whose image has no model in its header. No entry
 * of the package exports it (`index.ts` does not), so that the loader an
 * application gets always checks.
 */
export async function loadAppWithoutModelCheck(
  client: TrezorClient,
  image: AppImage,
  options: { signal?: AbortSignal } = {},
): Promise<LoadResult> {
  const snapshot = copyAppImage(image);
  const signal = options.signal;
  return exclusive(client, signal, () => loadChecked(client, snapshot, signal));
}

async function loadSnapshot(
  client: TrezorClient,
  image: AppImage,
  signal: AbortSignal | undefined,
  progress: { midLoad: boolean },
): Promise<LoadResult> {
  // Every answer of the device but the final one leaves it waiting for the next loading message.
  const ask = async <Q extends object>(codec: MessageCodec<Q>, request: Q): Promise<{ id: number; payload: Uint8Array }> => {
    const answer = await client.callAny(codec.id as number, codec.encode(request), { signal });
    progress.midLoad = answer.id !== (ExtAppLoaded.id as number);
    return answer;
  };
  const decode = <A extends object>(codec: MessageCodec<A>, payload: Uint8Array): A => {
    try {
      return codec.decode(payload);
    } catch (cause) {
      throw new TrezorUnexpectedError(`${codec.name} could not be decoded`, { cause });
    }
  };

  const [major, minor, patch, build] = image.version;
  let answer = await ask(ExtAppLoad, {
    id: image.id,
    version: { major, minor, patch, build },
    fingerprint: appFingerprint(image),
  });
  let uploaded = false;

  if (answer.id === ExtAppHeaderRequest.id) {
    // The message has no field: an empty payload is the whole of it; bytes that are not a message are not.
    decode(ExtAppHeaderRequest, answer.payload);
    uploaded = true;
    answer = await ask(ExtAppHeaderAck, {
      header: image.header,
      proof: image.proof,
      root_packet_timestamp: image.rootPacketTimestamp,
    });
    // The device asks for each chunk once, and for the root packet at most
    // once; allow slack for nothing else.
    let rootPacketSent = false;
    const budget = image.chunks.length * 2 + 4;
    for (let step = 0; step < budget; step++) {
      if (answer.id === ExtAppRootPacketRequest.id && !rootPacketSent) {
        // The ring the device asks about is required; the host has one root packet and does not use the number.
        decode(ExtAppRootPacketRequest, answer.payload);
        rootPacketSent = true;
        answer = await ask(ExtAppRootPacketAck, { root_packet: image.rootPacket });
      } else if (answer.id === ExtAppDataChunkRequest.id) {
        const request = decode(ExtAppDataChunkRequest, answer.payload);
        const chunk = image.chunks[request.index];
        if (!chunk) {
          throw new TrezorUnexpectedError(`the device asked for chunk ${request.index} of ${image.chunks.length}`);
        }
        answer = await ask(ExtAppDataChunkAck, { data: chunk.data, hash: chunk.hash });
      } else {
        break;
      }
    }
  }

  if (answer.id !== ExtAppLoaded.id) {
    throw new TrezorUnexpectedError(`message ${answer.id} while loading the app`);
  }
  // Both paths end here: the app was held or was just uploaded. The version
  // asked for is only a minimum for the device, so what it ran may be a newer
  // one this host does not know the protocol of.
  const loaded = decode(ExtAppLoaded, answer.payload);
  checkLoadedVersion(loaded.version);
  client.setLoadedApp(loaded.instance_id);
  return { instanceId: loaded.instance_id, uploaded };
}
