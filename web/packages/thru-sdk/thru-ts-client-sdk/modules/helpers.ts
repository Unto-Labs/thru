import { create } from "@bufbuild/protobuf";
import { sha256 } from "@noble/hashes/sha2";
import { BytesLike, Pubkey as PubkeyType, encodeAddress, ensureBytes, hexToBytes, isHexString } from "@thru/helpers";

import { Pubkey, Signature, TaPubkey, TsSignature } from "../proto/thru/common/v1/primitives_pb";
import { BlockHash, BlockHashSchema } from "../proto/thru/core/v1/types_pb";
import {
    TsSignatureInput,
    pubkeyBytesFromInput,
    signatureBytesFromInput,
    toPubkeyProto,
    toSignatureProto,
    toTaPubkeyProto,
    toTsSignatureProto,
} from "../utils/primitives";

export type BlockSelector = { slot: number | bigint } | { blockHash: BytesLike };

export function toSignature(value: BytesLike): Signature {
    return toSignatureProto(value);
}

export function toSignatureBytes(value: BytesLike): Uint8Array {
    return signatureBytesFromInput(value);
}

export function toTsSignature(value: TsSignatureInput | BytesLike, field = "tsSignature"): TsSignature {
    if (typeof value === "string" && value.startsWith("ts")) {
        return toTsSignatureProto(value as TsSignatureInput, field);
    }
    return toTsSignatureProto(signatureBytesFromInput(value as BytesLike, field), field);
}

export function toPubkey(value: PubkeyType, field: string): Pubkey {
    return toPubkeyProto(value, field);
}

export function toPubkeyBytes(value: PubkeyType, field: string): Uint8Array {
    return pubkeyBytesFromInput(value, field);
}

export function toTaPubkey(value: PubkeyType | string, field = "taPubkey"): TaPubkey {
    if (typeof value === "string" && value.startsWith("ta")) {
        return toTaPubkeyProto(value, field);
    }
    return toTaPubkeyProto(pubkeyBytesFromInput(value as PubkeyType, field), field);
}

export function toBlockHash(value: BytesLike): BlockHash {
    return create(BlockHashSchema, { value: ensureBytes(value, "blockHash") });
}

export interface DeriveProgramAddressOptions {
    programAddress: PubkeyType;
    seed: BytesLike;
    ephemeral?: boolean;
}

export interface DeriveProgramAddressResult {
    bytes: Uint8Array;
    address: string;
}

export function deriveProgramAddress(options: DeriveProgramAddressOptions): DeriveProgramAddressResult {
    const programAddress = normalizeProgramAddress(options.programAddress);
    const seed = normalizeSeed(options.seed);
    const ephemeral = options.ephemeral === true;

    const derivationInput = new Uint8Array(programAddress.length + 1 + seed.length);
    derivationInput.set(programAddress, 0);
    derivationInput[programAddress.length] = ephemeral ? 1 : 0;
    derivationInput.set(seed, programAddress.length + 1);

    const hash = sha256(derivationInput);
    const derivedBytes = new Uint8Array(hash.slice(0, 32));

    return {
        bytes: derivedBytes,
        address: encodeAddress(derivedBytes),
    };
}

function normalizeProgramAddress(value: PubkeyType): Uint8Array {
    return pubkeyBytesFromInput(value, "Program address");
}

function normalizeSeed(value: BytesLike | string): Uint8Array {
    if (value instanceof Uint8Array) {
        if (value.length === 0) {
            throw new Error("Seed cannot be empty");
        }
        if (value.length > 32) {
            throw new Error("Seed cannot exceed 32 bytes");
        }
        const seed = new Uint8Array(32);
        seed.set(value);
        return seed;
    }
    if (typeof value === "string") {
        if (value.length === 0) {
            throw new Error("Seed cannot be empty");
        }
        if (isHexString(value)) {
            const bytes = hexToBytes(value);
            if (bytes.length !== 32) {
                throw new Error(`Hex seed must decode to 32 bytes, got ${bytes.length}`);
            }
            return bytes;
        }
        const encoder = new TextEncoder();
        const utf8 = encoder.encode(value);
        if (utf8.length > 32) {
            throw new Error(`UTF-8 seed too long: ${utf8.length} bytes (max 32)`);
        }
        const seed = new Uint8Array(32);
        seed.set(utf8);
        return seed;
    }
    throw new Error("Seed must be provided as Uint8Array or string");
}
