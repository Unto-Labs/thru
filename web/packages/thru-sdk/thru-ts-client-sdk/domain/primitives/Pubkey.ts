import { create } from "@bufbuild/protobuf";
import {
    decodeAddress,
    encodeAddress,
    hexToBytes,
    isHexString,
} from "@thru/helpers";

import {
    Pubkey as ProtoPubkey,
    PubkeySchema,
    TaPubkey,
    TaPubkeySchema,
} from "@thru/proto";
import {
    bytesEqual,
    bytesToHex,
    copyBytes,
    ensureExactLength,
} from "./byte-utils";
import { PUBKEY_LENGTH, TA_ADDRESS_LENGTH } from "./constants";

export type PubkeyInput = Uint8Array | string | Pubkey;

export class Pubkey {
  private readonly bytes: Uint8Array;

  private constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  static from(value: PubkeyInput): Pubkey {
    if (value instanceof Pubkey) {
      return value;
    }
    if (value instanceof Uint8Array) {
      return new Pubkey(ensureExactLength(value, PUBKEY_LENGTH));
    }
    if (typeof value === "string") {
      return new Pubkey(Pubkey.bytesFromString(value));
    }
    throw new Error(
      `Must be provided as Uint8Array, hex string, or ta-address`
    );
  }



  static isThruFmt(value: string): boolean {
    return value.startsWith("ta") && value.length === TA_ADDRESS_LENGTH;
  }

  toBytes(): Uint8Array {
    return copyBytes(this.bytes);
  }

  toBytesUnsafe(): Uint8Array {
    return this.bytes;
  }

  toThruFmt(): string {
    return encodeAddress(this.bytes);
  }

  toHex(): string {
    return bytesToHex(this.bytes);
  }

  equals(other: PubkeyInput): boolean {
    const candidate = Pubkey.from(other);
    return bytesEqual(this.bytes, candidate.bytes);
  }

  toProtoPubkey(): ProtoPubkey {
    return create(PubkeySchema, { value: this.toBytes() });
  }

  toProtoTaPubkey(): TaPubkey {
    return create(TaPubkeySchema, { value: this.toThruFmt() });
  }

  static fromProtoPubkey(proto?: ProtoPubkey): Pubkey {
    if (!proto?.value) {
      throw new Error(`Proto is missing value`);
    }
    return new Pubkey(ensureExactLength(proto.value, PUBKEY_LENGTH));
  }

  static fromProtoTaPubkey(proto?: TaPubkey): Pubkey {
    if (!proto?.value) {
      throw new Error(`Proto is missing value`);
    }
    return new Pubkey(ensureExactLength(decodeAddress(proto.value), PUBKEY_LENGTH));
  }

  private static bytesFromString(value: string): Uint8Array {
    if (Pubkey.isThruFmt(value)) {
        return ensureExactLength(decodeAddress(value), PUBKEY_LENGTH);
      }
    if (isHexString(value)) {
      return ensureExactLength(hexToBytes(value), PUBKEY_LENGTH);
    }
    throw new Error(`Must be provided as hex string or ta-address`);
  }
}
