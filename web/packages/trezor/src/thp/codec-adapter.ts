/**
 * The protobuf hooks `@trezor/protocol`'s THP functions take
 * (`protobufEncoder` and `protobufDecoder`), on this package's codecs.
 *
 * Encoder: `(name, data)` with `data` in the JSON form of the vector file
 * (bytes as hex), as the library passes it for the Noise payload; answers
 * `{ messageType, message }`. Decoder: `(nameOrWireId, bytes)`; answers
 * `{ type, message }` with typed values.
 */
import { Buffer } from './node-shims';
import { messageCodecs } from '../messages';
import {
  codecByName,
  fieldsFromJson,
  type JsonFields,
  type LooseCodec,
} from '../messages-json';

const wireCodecsById = new Map<number, LooseCodec>();
for (const codec of Object.values(messageCodecs) as LooseCodec[]) {
  if (codec.layer === 'wire' && codec.id !== undefined) wireCodecsById.set(codec.id, codec);
}

function requireCodec(name: string): LooseCodec {
  const codec = codecByName(name);
  if (!codec) throw new Error(`unknown message ${name}`);
  return codec;
}

export function protobufEncoder(
  name: string,
  data: JsonFields,
): { messageType: number | undefined; message: Buffer } {
  const codec = requireCodec(name);
  const defined = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
  const bytes = codec.encode(fieldsFromJson(codec, defined) as never);
  return { messageType: codec.id, message: Buffer.from(bytes) };
}

export function protobufDecoder(
  nameOrWireId: string | number,
  bytes: Uint8Array,
): { type: string; message: unknown } {
  const codec =
    typeof nameOrWireId === 'number' ? wireCodecsById.get(nameOrWireId) : requireCodec(nameOrWireId);
  if (!codec) throw new Error(`unknown wire message type ${nameOrWireId}`);
  return { type: codec.name, message: codec.decode(bytes) };
}
