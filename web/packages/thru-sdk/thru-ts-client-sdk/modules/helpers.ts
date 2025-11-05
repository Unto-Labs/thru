import { create } from "@bufbuild/protobuf";
import { sha256 } from "@noble/hashes/sha2";
import { BytesLike, Pubkey as PubkeyType, decodeAddress, decodeBase64, decodeSignature, encodeAddress, ensureBytes, hexToBytes, isHexString } from "@thru/helpers";

import { BlockHash, BlockHashSchema, Pubkey, PubkeySchema, Signature, SignatureSchema } from "../proto/thru/core/v1/types_pb";

export type BlockSelector = { slot: number | bigint } | { blockHash: BytesLike };

export function toSignature(value: BytesLike): Signature {
    let bytes: Uint8Array;
    if (value instanceof Uint8Array) {
        if (value.length !== 64) {
            throw new Error("signature must contain 64 bytes");
        }
        bytes = value;
    } else if (typeof value === "string") {
        bytes = value.startsWith("ts") ? decodeSignature(value) : decodeBase64(value);
    } else {
        throw new Error("signature is required");
    }
    if (bytes.length !== 64) {
        throw new Error("signature must contain 64 bytes");
    }
    return create(SignatureSchema, { value: bytes });
}

export function toPubkey(value: PubkeyType, field: string): Pubkey {
    let bytes: Uint8Array;
    if (value instanceof Uint8Array) {
        bytes = value;
    } else if (typeof value === "string") {
        bytes = value.startsWith("ta") ? decodeAddress(value) : decodeBase64(value);
    } else {
        throw new Error(`${field} is required`);
    }
    if (bytes.length !== 32) {
        throw new Error(`${field} must contain 32 bytes`);
    }
    return create(PubkeySchema, { value: bytes });
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
    if (value instanceof Uint8Array) {
        if (value.length !== 32) {
            throw new Error("Program address must contain 32 bytes");
        }
        return new Uint8Array(value);
    }
    if (typeof value === "string") {
        if (value.startsWith("ta") && value.length === 46) {
            return decodeAddress(value);
        }
        if (isHexString(value)) {
            const bytes = hexToBytes(value);
            if (bytes.length !== 32) {
                throw new Error("Program address hex string must decode to 32 bytes");
            }
            return bytes;
        }
    }
    throw new Error("Program address must be a 32-byte value, ta-address, or 64-character hex string");
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
