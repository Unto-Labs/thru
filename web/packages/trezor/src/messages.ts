/**
 * Protobuf encodings of the messages the host sends and parses: Trezor's THP
 * and app-loading messages (`common/protob/messages-thp.proto`,
 * `messages-common.proto`, `messages-extapp.proto` of trezor-firmware) and the
 * messages of the Thru app (`trezor/app-thru/protob/thru.proto`).
 *
 * The codec is a small table-driven one on the wire primitives of
 * `@bufbuild/protobuf`: the messages are proto2 with explicit presence, and
 * the workspace's generated-code route would need a protoc step for about
 * forty hand-picked messages. Encoding is canonical like the Rust host's
 * (`prost`): fields in field-number order, repeated scalars unpacked, an
 * absent optional field is not written and a present empty one is. Decoding
 * accepts packed and unpacked repeated scalars and skips unknown fields.
 *
 * The encodings are pinned by `contrib/test/vectors/trezor/host_vectors.json`.
 */
import { BinaryReader, BinaryWriter, WireType } from '@bufbuild/protobuf/wire';

import { copyBytes } from './bytes';

type ScalarType = 'bytes' | 'string' | 'uint32' | 'int32' | 'bool' | 'sint64';
type Presence = 'required' | 'optional' | 'repeated';

/** One field of a message, as the codec sees it. */
export type FieldDescriptor = {
  readonly tag: number;
  readonly presence: Presence;
} & (
  | { readonly type: ScalarType }
  | { readonly type: 'message'; readonly message: MessageCodec<never> }
);

export type MessageCodec<T> = {
  readonly name: string;
  /** Message type on the wire (layer `wire`) or in the app's envelope (layer `app`), when it has one. */
  readonly id?: number;
  /** Where `id` is used; absent for messages that travel only inside another one. */
  readonly layer?: 'wire' | 'app';
  readonly fields: { readonly [K in keyof T]-?: FieldDescriptor };
  encode(value: T): Uint8Array;
  decode(bytes: Uint8Array): T;
};

const scalar = (presence: Presence) => (type: ScalarType, tag: number): FieldDescriptor => ({
  tag,
  presence,
  type,
});
const req = scalar('required');
const opt = scalar('optional');
const rep = scalar('repeated');
const msg = <M>(
  message: MessageCodec<M>,
  tag: number,
  presence: Presence = 'required',
): FieldDescriptor => ({ tag, presence, type: 'message', message: message as MessageCodec<never> });

function checkUint32(name: string, value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new RangeError(`${name}: ${value} is not a uint32`);
  }
  return value;
}

function checkInt32(name: string, value: number): number {
  if (!Number.isInteger(value) || value < -0x80000000 || value > 0x7fffffff) {
    throw new RangeError(`${name}: ${value} is not an int32`);
  }
  return value;
}

function writeScalar(
  w: BinaryWriter,
  field: string,
  d: FieldDescriptor & { type: ScalarType },
  value: unknown,
): void {
  switch (d.type) {
    case 'bytes':
      w.tag(d.tag, WireType.LengthDelimited).bytes(value as Uint8Array);
      break;
    case 'string':
      w.tag(d.tag, WireType.LengthDelimited).string(value as string);
      break;
    case 'uint32':
      w.tag(d.tag, WireType.Varint).uint32(checkUint32(field, value as number));
      break;
    case 'int32':
      w.tag(d.tag, WireType.Varint).int32(checkInt32(field, value as number));
      break;
    case 'bool':
      w.tag(d.tag, WireType.Varint).bool(value as boolean);
      break;
    case 'sint64':
      w.tag(d.tag, WireType.Varint).sint64(value as bigint);
      break;
  }
}

function readScalar(r: BinaryReader, type: ScalarType): unknown {
  switch (type) {
    case 'bytes':
      return copyBytes(r.bytes());
    case 'string':
      return r.string();
    case 'uint32':
      return r.uint32();
    case 'int32':
      return r.int32();
    case 'bool':
      return r.bool();
    case 'sint64':
      return BigInt(r.sint64());
  }
}

const isVarint = (type: ScalarType): boolean => type !== 'bytes' && type !== 'string';

function define<T extends object>(
  name: string,
  fields: { [K in keyof T]-?: FieldDescriptor },
  id?: number,
  layer: 'wire' | 'app' = 'wire',
): MessageCodec<T> {
  const entries = (Object.entries(fields) as [string, FieldDescriptor][]).sort(
    (a, b) => a[1].tag - b[1].tag,
  );
  const byTag = new Map(entries.map(([field, d]) => [d.tag, [field, d] as const]));

  const encode = (value: T): Uint8Array => {
    const w = new BinaryWriter();
    for (const [field, d] of entries) {
      const v = (value as Record<string, unknown>)[field];
      const values = d.presence === 'repeated' ? ((v ?? []) as unknown[]) : v === undefined ? [] : [v];
      if (d.presence === 'required' && v === undefined) {
        throw new Error(`${name}.${field} is required`);
      }
      for (const item of values) {
        if (d.type === 'message') {
          w.tag(d.tag, WireType.LengthDelimited).bytes(d.message.encode(item as never));
        } else {
          writeScalar(w, `${name}.${field}`, d, item);
        }
      }
    }
    return w.finish();
  };

  const decode = (bytes: Uint8Array): T => {
    const r = new BinaryReader(bytes);
    const out: Record<string, unknown> = {};
    while (r.pos < r.len) {
      const [tag, wireType] = r.tag();
      const entry = byTag.get(tag);
      if (!entry) {
        r.skip(wireType);
        continue;
      }
      const [field, d] = entry;
      const where = `${name}.${field}`;
      let value: unknown;
      if (d.type === 'message') {
        if (wireType !== WireType.LengthDelimited) throw new Error(`${where}: wrong wire type`);
        value = d.message.decode(r.bytes());
      } else if (d.presence === 'repeated' && isVarint(d.type) && wireType === WireType.LengthDelimited) {
        // Packed form of a repeated scalar.
        const packed = new BinaryReader(r.bytes());
        const list = (out[field] as unknown[] | undefined) ?? [];
        while (packed.pos < packed.len) list.push(readScalar(packed, d.type));
        out[field] = list;
        continue;
      } else {
        const expected = isVarint(d.type) ? WireType.Varint : WireType.LengthDelimited;
        if (wireType !== expected) throw new Error(`${where}: wrong wire type`);
        value = readScalar(r, d.type);
      }
      if (d.presence === 'repeated') {
        const list = (out[field] as unknown[] | undefined) ?? [];
        list.push(value);
        out[field] = list;
      } else {
        out[field] = value;
      }
    }
    for (const [field, d] of entries) {
      if (d.presence === 'required' && out[field] === undefined) {
        throw new Error(`${name}.${field} is missing`);
      }
    }
    return out as T;
  };

  return {
    name,
    id,
    layer: id === undefined ? undefined : layer,
    fields: fields as MessageCodec<T>['fields'],
    encode,
    decode,
  };
}

// ---- Trezor messages (`wire`: the id is the THP message type) ----

export type Success = { message?: string };
export const Success = define<Success>('Success', { message: opt('string', 1) }, 2);

export type Failure = { code?: number; message?: string };
export const Failure = define<Failure>(
  'Failure',
  { code: opt('int32', 1), message: opt('string', 2) },
  3,
);

export type ButtonRequest = { code?: number; pages?: number; name?: string };
export const ButtonRequest = define<ButtonRequest>(
  'ButtonRequest',
  { code: opt('int32', 1), pages: opt('uint32', 2), name: opt('string', 4) },
  26,
);

export type ButtonAck = Record<string, never>;
export const ButtonAck = define<ButtonAck>('ButtonAck', {}, 27);

export type Version = { major: number; minor: number; patch?: number; build?: number };
export const Version = define<Version>('Version', {
  major: req('uint32', 1),
  minor: req('uint32', 2),
  patch: opt('uint32', 3),
  build: opt('uint32', 4),
});

export type ThpDeviceProperties = {
  internal_model: string;
  model_variant?: number;
  protocol_version_major: number;
  protocol_version_minor: number;
  pairing_methods?: number[];
};
export const ThpDeviceProperties = define<ThpDeviceProperties>('ThpDeviceProperties', {
  internal_model: req('string', 1),
  model_variant: opt('uint32', 2),
  protocol_version_major: req('uint32', 3),
  protocol_version_minor: req('uint32', 4),
  pairing_methods: rep('int32', 5),
});

export type ThpHandshakeCompletionReqNoisePayload = { host_pairing_credential?: Uint8Array };
export const ThpHandshakeCompletionReqNoisePayload =
  define<ThpHandshakeCompletionReqNoisePayload>('ThpHandshakeCompletionReqNoisePayload', {
    host_pairing_credential: opt('bytes', 1),
  });

export type ThpCreateNewSession = {
  passphrase?: string;
  on_device?: boolean;
  derive_cardano?: boolean;
};
export const ThpCreateNewSession = define<ThpCreateNewSession>(
  'ThpCreateNewSession',
  {
    passphrase: opt('string', 1),
    on_device: opt('bool', 2),
    derive_cardano: opt('bool', 3),
  },
  1000,
);

export type ThpPairingRequest = { host_name: string; app_name: string };
export const ThpPairingRequest = define<ThpPairingRequest>(
  'ThpPairingRequest',
  { host_name: req('string', 1), app_name: req('string', 2) },
  1008,
);

export type ThpPairingRequestApproved = Record<string, never>;
export const ThpPairingRequestApproved = define<ThpPairingRequestApproved>(
  'ThpPairingRequestApproved',
  {},
  1009,
);

export type ThpSelectMethod = { selected_pairing_method: number };
export const ThpSelectMethod = define<ThpSelectMethod>(
  'ThpSelectMethod',
  { selected_pairing_method: req('int32', 1) },
  1010,
);

export type ThpCredentialRequest = {
  host_static_public_key: Uint8Array;
  autoconnect?: boolean;
  credential?: Uint8Array;
};
export const ThpCredentialRequest = define<ThpCredentialRequest>(
  'ThpCredentialRequest',
  {
    host_static_public_key: req('bytes', 1),
    autoconnect: opt('bool', 2),
    credential: opt('bytes', 3),
  },
  1016,
);

export type ThpCredentialResponse = {
  trezor_static_public_key: Uint8Array;
  credential: Uint8Array;
};
export const ThpCredentialResponse = define<ThpCredentialResponse>(
  'ThpCredentialResponse',
  { trezor_static_public_key: req('bytes', 1), credential: req('bytes', 2) },
  1017,
);

export type ThpEndRequest = Record<string, never>;
export const ThpEndRequest = define<ThpEndRequest>('ThpEndRequest', {}, 1018);

export type ThpEndResponse = Record<string, never>;
export const ThpEndResponse = define<ThpEndResponse>('ThpEndResponse', {}, 1019);

export type ThpCodeEntryCommitment = { commitment: Uint8Array };
export const ThpCodeEntryCommitment = define<ThpCodeEntryCommitment>(
  'ThpCodeEntryCommitment',
  { commitment: req('bytes', 1) },
  1024,
);

export type ThpCodeEntryChallenge = { challenge: Uint8Array };
export const ThpCodeEntryChallenge = define<ThpCodeEntryChallenge>(
  'ThpCodeEntryChallenge',
  { challenge: req('bytes', 1) },
  1025,
);

export type ThpCodeEntryCpaceTrezor = { cpace_trezor_public_key: Uint8Array };
export const ThpCodeEntryCpaceTrezor = define<ThpCodeEntryCpaceTrezor>(
  'ThpCodeEntryCpaceTrezor',
  { cpace_trezor_public_key: req('bytes', 1) },
  1026,
);

export type ThpCodeEntryCpaceHostTag = { cpace_host_public_key: Uint8Array; tag: Uint8Array };
export const ThpCodeEntryCpaceHostTag = define<ThpCodeEntryCpaceHostTag>(
  'ThpCodeEntryCpaceHostTag',
  { cpace_host_public_key: req('bytes', 1), tag: req('bytes', 2) },
  1027,
);

export type ThpCodeEntrySecret = { secret: Uint8Array };
export const ThpCodeEntrySecret = define<ThpCodeEntrySecret>(
  'ThpCodeEntrySecret',
  { secret: req('bytes', 1) },
  1028,
);

export type ExtAppLoad = { id: string; version: Version; fingerprint?: Uint8Array };
export const ExtAppLoad = define<ExtAppLoad>(
  'ExtAppLoad',
  { id: req('string', 1), version: msg(Version, 2), fingerprint: opt('bytes', 3) },
  9200,
);

export type ExtAppLoaded = { instance_id: number; version: Version };
export const ExtAppLoaded = define<ExtAppLoaded>(
  'ExtAppLoaded',
  { instance_id: req('uint32', 1), version: msg(Version, 2) },
  9201,
);

export type ExtAppHeaderRequest = Record<string, never>;
export const ExtAppHeaderRequest = define<ExtAppHeaderRequest>('ExtAppHeaderRequest', {}, 9202);

export type ExtAppHeaderAck = {
  header: Uint8Array;
  proof: Uint8Array;
  root_packet_timestamp: bigint;
};
export const ExtAppHeaderAck = define<ExtAppHeaderAck>(
  'ExtAppHeaderAck',
  {
    header: req('bytes', 1),
    proof: req('bytes', 2),
    root_packet_timestamp: req('sint64', 3),
  },
  9203,
);

export type ExtAppRootPacketRequest = { app_ring: number };
export const ExtAppRootPacketRequest = define<ExtAppRootPacketRequest>(
  'ExtAppRootPacketRequest',
  { app_ring: req('uint32', 1) },
  9204,
);

export type ExtAppRootPacketAck = { root_packet: Uint8Array };
export const ExtAppRootPacketAck = define<ExtAppRootPacketAck>(
  'ExtAppRootPacketAck',
  { root_packet: req('bytes', 1) },
  9205,
);

export type ExtAppDataChunkRequest = { index: number };
export const ExtAppDataChunkRequest = define<ExtAppDataChunkRequest>(
  'ExtAppDataChunkRequest',
  { index: req('uint32', 1) },
  9206,
);

export type ExtAppDataChunkAck = { data: Uint8Array; hash: Uint8Array };
export const ExtAppDataChunkAck = define<ExtAppDataChunkAck>(
  'ExtAppDataChunkAck',
  { data: req('bytes', 1), hash: req('bytes', 2) },
  9207,
);

export type ExtAppMessage = { instance_id: number; message_id: number; data: Uint8Array };
export const ExtAppMessage = define<ExtAppMessage>(
  'ExtAppMessage',
  { instance_id: req('uint32', 1), message_id: req('uint32', 2), data: req('bytes', 3) },
  9208,
);

export type ExtAppResponse = { message_id: number; data: Uint8Array };
export const ExtAppResponse = define<ExtAppResponse>(
  'ExtAppResponse',
  { message_id: req('uint32', 1), data: req('bytes', 2) },
  9209,
);

// ---- Messages of the Thru app (`app`: the id is the envelope's `message_id`) ----

export type GetPublicKey = { address_n?: number[]; show_display?: boolean };
export const GetPublicKey = define<GetPublicKey>(
  'GetPublicKey',
  { address_n: rep('uint32', 1), show_display: opt('bool', 2) },
  0,
  'app',
);

export type PublicKey = { public_key: Uint8Array; address: string };
export const PublicKey = define<PublicKey>(
  'PublicKey',
  { public_key: req('bytes', 1), address: req('string', 2) },
  1,
  'app',
);

export type SignTx = { address_n?: number[]; body_size: number; token_hint?: Uint8Array };
export const SignTx = define<SignTx>(
  'SignTx',
  { address_n: rep('uint32', 1), body_size: req('uint32', 2), token_hint: opt('bytes', 3) },
  2,
  'app',
);

export type TxDataRequest = { offset: number; length: number };
export const TxDataRequest = define<TxDataRequest>(
  'TxDataRequest',
  { offset: req('uint32', 1), length: req('uint32', 2) },
  3,
  'app',
);

export type TxDataAck = { data: Uint8Array };
export const TxDataAck = define<TxDataAck>('TxDataAck', { data: req('bytes', 1) }, 4, 'app');

export type TxSignature = { signature: Uint8Array };
export const TxSignature = define<TxSignature>('TxSignature', { signature: req('bytes', 1) }, 5, 'app');

export type SignMessage = { address_n?: number[]; message: Uint8Array };
export const SignMessage = define<SignMessage>(
  'SignMessage',
  { address_n: rep('uint32', 1), message: req('bytes', 2) },
  6,
  'app',
);

export type MessageSignature = { signature: Uint8Array };
export const MessageSignature = define<MessageSignature>(
  'MessageSignature',
  { signature: req('bytes', 1) },
  7,
  'app',
);

export type SignEoaAuth = {
  address_n?: number[];
  kind: number;
  chain_id: number;
  fee_payer: Uint8Array;
  account: Uint8Array;
};
export const SignEoaAuth = define<SignEoaAuth>(
  'SignEoaAuth',
  {
    address_n: rep('uint32', 1),
    kind: req('uint32', 2),
    chain_id: req('uint32', 3),
    fee_payer: req('bytes', 4),
    account: req('bytes', 5),
  },
  8,
  'app',
);

export type EoaAuthSignature = { signature: Uint8Array };
export const EoaAuthSignature = define<EoaAuthSignature>(
  'EoaAuthSignature',
  { signature: req('bytes', 1) },
  9,
  'app',
);

/** Every codec of this file by message name. */
export const messageCodecs = {
  Success,
  Failure,
  ButtonRequest,
  ButtonAck,
  Version,
  ThpDeviceProperties,
  ThpHandshakeCompletionReqNoisePayload,
  ThpCreateNewSession,
  ThpPairingRequest,
  ThpPairingRequestApproved,
  ThpSelectMethod,
  ThpCredentialRequest,
  ThpCredentialResponse,
  ThpEndRequest,
  ThpEndResponse,
  ThpCodeEntryCommitment,
  ThpCodeEntryChallenge,
  ThpCodeEntryCpaceTrezor,
  ThpCodeEntryCpaceHostTag,
  ThpCodeEntrySecret,
  ExtAppLoad,
  ExtAppLoaded,
  ExtAppHeaderRequest,
  ExtAppHeaderAck,
  ExtAppRootPacketRequest,
  ExtAppRootPacketAck,
  ExtAppDataChunkRequest,
  ExtAppDataChunkAck,
  ExtAppMessage,
  ExtAppResponse,
  GetPublicKey,
  PublicKey,
  SignTx,
  TxDataRequest,
  TxDataAck,
  TxSignature,
  SignMessage,
  MessageSignature,
  SignEoaAuth,
  EoaAuthSignature,
} as const;
