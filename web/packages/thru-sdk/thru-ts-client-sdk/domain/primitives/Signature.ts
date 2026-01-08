import { create } from "@bufbuild/protobuf";
import {
    decodeSignature,
    encodeSignature,
    hexToBytes,
    isHexString
} from "@thru/helpers";

import {
    Signature as ProtoSignature,
    SignatureSchema,
    TsSignature,
    TsSignatureSchema,
} from "@thru/proto";
import {
    bytesEqual,
    bytesToHex,
    copyBytes,
    ensureExactLength,
} from "./byte-utils";
import { SIGNATURE_LENGTH, TS_SIGNATURE_LENGTH } from "./constants";

export type SignatureInput = Uint8Array | string | Signature;

export class Signature {
  private readonly bytes: Uint8Array;

  private constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  static from(value: SignatureInput): Signature {
    if (value instanceof Signature) {
      return value;
    }
    if (value instanceof Uint8Array) {
      return new Signature(ensureExactLength(value, SIGNATURE_LENGTH));
    }
    if (typeof value === "string") {
      return new Signature(Signature.bytesFromString(value));
    }
    throw new Error(
      `Must be provided as Uint8Array, ts-encoded string, hex string, or base64 string`
    );
  }

  static fromProto(proto?: ProtoSignature): Signature {
    if (!proto?.value) {
      throw new Error(`Proto is missing value`);
    }
    return new Signature(ensureExactLength(proto.value, SIGNATURE_LENGTH));
  }



  static isThruFmt(value: string): boolean {
    return value.startsWith("ts") && value.length === TS_SIGNATURE_LENGTH;
  }

  toBytes(): Uint8Array {
    return copyBytes(this.bytes);
  }

  toBytesUnsafe(): Uint8Array {
    return this.bytes;
  }

  toThruFmt(): string {
    return encodeSignature(this.bytes);
  }

  toHex(): string {
    return bytesToHex(this.bytes);
  }

  equals(other: SignatureInput): boolean {
    const candidate = Signature.from(other);
    return bytesEqual(this.bytes, candidate.bytes);
  }

  toProtoSignature(): ProtoSignature {
    return create(SignatureSchema, { value: this.toBytes() });
  }
  toProtoTsSignature(): TsSignature {
    return create(TsSignatureSchema, { value: this.toThruFmt() });
  }

  static fromProtoTsSignature(proto?: TsSignature): Signature {
    if (!proto?.value) {
      throw new Error(`Proto is missing value`);
    }
    return new Signature(ensureExactLength(decodeSignature(proto.value), SIGNATURE_LENGTH));
  }

  static fromProtoSignature(proto?: ProtoSignature): Signature {
    if (!proto?.value) {
      throw new Error(`Proto is missing value`);
    }
    return new Signature(ensureExactLength(proto.value, SIGNATURE_LENGTH));
  }

  private static bytesFromString(value: string): Uint8Array {
    if (Signature.isThruFmt(value)) {
      return ensureExactLength(decodeSignature(value), SIGNATURE_LENGTH);
    }
    if (isHexString(value)) {
      return ensureExactLength(hexToBytes(value), SIGNATURE_LENGTH);
    }
    throw new Error(`Must be provided as ts-encoded string or hex string`);
  }
}
