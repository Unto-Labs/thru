/**
 * The JSON form of message values used by the vector file
 * (`contrib/test/vectors/trezor/README.md`, "fields rules"): bytes are
 * lowercase hex, 64-bit integers are decimal strings, a nested message is an
 * object, an absent field has no key and a present empty one has its key.
 */
import { fromHex, toHex } from './bytes';
import { messageCodecs, type FieldDescriptor } from './messages';

export type JsonValue = string | number | boolean | JsonValue[] | { [key: string]: JsonValue };
export type JsonFields = { [field: string]: JsonValue };

/** A codec without its value type, for code that works from the field table. */
export type LooseCodec = {
  readonly name: string;
  readonly id?: number;
  readonly layer?: 'wire' | 'app';
  readonly fields: Readonly<Record<string, FieldDescriptor>>;
  encode(value: never): Uint8Array;
  decode(bytes: Uint8Array): unknown;
};

/** The codec of a message by its name, or `undefined`. */
export function codecByName(name: string): LooseCodec | undefined {
  return (messageCodecs as Record<string, LooseCodec>)[name];
}

function valueToJson(d: FieldDescriptor, value: unknown): JsonValue {
  switch (d.type) {
    case 'bytes':
      return toHex(value as Uint8Array);
    case 'sint64':
      return (value as bigint).toString();
    case 'message':
      return fieldsToJson(d.message as unknown as LooseCodec, value);
    default:
      return value as string | number | boolean;
  }
}

function valueFromJson(d: FieldDescriptor, json: JsonValue): unknown {
  switch (d.type) {
    case 'bytes':
      return fromHex(json as string);
    case 'sint64':
      return BigInt(json as string);
    case 'message':
      return fieldsFromJson(d.message as unknown as LooseCodec, json as JsonFields);
    default:
      return json;
  }
}

export function fieldsToJson(codec: LooseCodec, value: unknown): JsonFields {
  const out: JsonFields = {};
  for (const [name, d] of Object.entries(codec.fields)) {
    const v = (value as Record<string, unknown>)[name];
    if (v === undefined) continue;
    out[name] =
      d.presence === 'repeated'
        ? (v as unknown[]).map((item) => valueToJson(d, item))
        : valueToJson(d, v);
  }
  return out;
}

export function fieldsFromJson(codec: LooseCodec, json: JsonFields): unknown {
  const out: Record<string, unknown> = {};
  for (const [name, d] of Object.entries(codec.fields)) {
    const j = json[name];
    if (j === undefined) continue;
    out[name] =
      d.presence === 'repeated'
        ? (j as JsonValue[]).map((item) => valueFromJson(d, item))
        : valueFromJson(d, j);
  }
  return out;
}
