import { create } from "@bufbuild/protobuf";
import { sha256 } from "@noble/hashes/sha256";
import { BlockHash, BlockHashSchema, Pubkey, PubkeySchema, Signature, SignatureSchema } from "../proto/thru/core/v1/types_pb";
import { decodeBase64, ensureBytes, hexToBytes, isHexString, maskForBits } from "../utils/utils";

const BASE64_URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const BASE64_URL_MAP = new Int16Array(256).fill(-1);
for (let i = 0; i < BASE64_URL_ALPHABET.length; i++) {
    BASE64_URL_MAP[BASE64_URL_ALPHABET.charCodeAt(i)] = i;
}

export type BytesLike = string | Uint8Array;
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

export function toPubkey(value: BytesLike, field: string): Pubkey {
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

export function encodeSignature(bytes: Uint8Array): string {
    if (bytes.length !== 64) {
        throw new Error("Expected 64-byte signature");
    }
    let checksum = 0;
    let accumulator = 0;
    let bitsCollected = 0;
    const output: string[] = ["t", "s"];

    for (let i = 0; i < 63; i++) {
        const byte = bytes[i];
        checksum += byte;
        accumulator = ((accumulator << 8) | byte) >>> 0;
        bitsCollected += 8;
        while (bitsCollected >= 6) {
            const index = (accumulator >> (bitsCollected - 6)) & 0x3f;
            output.push(BASE64_URL_ALPHABET[index]);
            bitsCollected -= 6;
            accumulator &= maskForBits(bitsCollected);
        }
    }

    const lastByte = bytes[63];
    checksum += lastByte;
    accumulator = ((accumulator << 8) | lastByte) >>> 0;
    bitsCollected += 8;
    accumulator = ((accumulator << 16) | (checksum & 0xffff)) >>> 0;
    bitsCollected += 16;

    while (bitsCollected >= 6) {
        const index = (accumulator >> (bitsCollected - 6)) & 0x3f;
        output.push(BASE64_URL_ALPHABET[index]);
        bitsCollected -= 6;
        accumulator &= maskForBits(bitsCollected);
    }

    return output.join("");
}

export function decodeSignature(value: string): Uint8Array {
    if (value.length !== 90) {
        throw new Error("Invalid signature length");
    }
    if (!value.startsWith("ts")) {
        throw new Error('Signature must start with "ts"');
    }

    const output = new Uint8Array(64);
    let checksum = 0;
    let inIdx = 2;
    let remaining = 84;
    let outIdx = 0;

    while (remaining > 0) {
        const a = BASE64_URL_MAP[value.charCodeAt(inIdx)];
        const b = BASE64_URL_MAP[value.charCodeAt(inIdx + 1)];
        const c = BASE64_URL_MAP[value.charCodeAt(inIdx + 2)];
        const d = BASE64_URL_MAP[value.charCodeAt(inIdx + 3)];
        if (a < 0 || b < 0 || c < 0 || d < 0) {
            throw new Error("Invalid signature encoding");
        }
        const triple = (a << 18) | (b << 12) | (c << 6) | d;
        const byte1 = (triple >> 16) & 0xff;
        const byte2 = (triple >> 8) & 0xff;
        const byte3 = triple & 0xff;
        checksum += byte1;
        checksum += byte2;
        checksum += byte3;
        output[outIdx++] = byte1;
        output[outIdx++] = byte2;
        output[outIdx++] = byte3;
        inIdx += 4;
        remaining -= 4;
    }

    const a = BASE64_URL_MAP[value.charCodeAt(inIdx)];
    const b = BASE64_URL_MAP[value.charCodeAt(inIdx + 1)];
    const c = BASE64_URL_MAP[value.charCodeAt(inIdx + 2)];
    const d = BASE64_URL_MAP[value.charCodeAt(inIdx + 3)];
    if (a < 0 || b < 0 || c < 0 || d < 0) {
        throw new Error("Invalid signature encoding");
    }
    const triple = (a << 18) | (b << 12) | (c << 6) | d;
    const finalByte = (triple >> 16) & 0xff;
    checksum += finalByte;
    output[outIdx] = finalByte;

    const incomingChecksum = triple & 0xffff;
    checksum &= 0xffff;
    if (checksum !== incomingChecksum) {
        throw new Error("Signature checksum mismatch");
    }

    return output;
}

export function encodeAddress(bytes: Uint8Array): string {
    if (bytes.length !== 32) {
        throw new Error("Expected 32-byte address");
    }
    let checksum = 0;
    let accumulator = 0;
    let bitsCollected = 0;
    const output: string[] = ["t", "a"];

    for (let i = 0; i < 30; i++) {
        const byte = bytes[i];
        checksum += byte;
        accumulator = ((accumulator << 8) | byte) >>> 0;
        bitsCollected += 8;
        while (bitsCollected >= 6) {
            const index = (accumulator >> (bitsCollected - 6)) & 0x3f;
            output.push(BASE64_URL_ALPHABET[index]);
            bitsCollected -= 6;
            accumulator &= maskForBits(bitsCollected);
        }
    }

    const secondLast = bytes[30];
    checksum += secondLast;
    accumulator = ((accumulator << 8) | secondLast) >>> 0;
    bitsCollected += 8;

    const last = bytes[31];
    checksum += last;
    accumulator = ((accumulator << 8) | last) >>> 0;
    bitsCollected += 8;

    accumulator = ((accumulator << 8) | (checksum & 0xff)) >>> 0;
    bitsCollected += 8;

    while (bitsCollected >= 6) {
        const index = (accumulator >> (bitsCollected - 6)) & 0x3f;
        output.push(BASE64_URL_ALPHABET[index]);
        bitsCollected -= 6;
        accumulator &= maskForBits(bitsCollected);
    }

    return output.join("");
}

export function decodeAddress(value: string): Uint8Array {
    if (value.length !== 46) {
        throw new Error("Invalid address length");
    }
    if (!value.startsWith("ta")) {
        throw new Error('Address must start with "ta"');
    }

    const output = new Uint8Array(32);
    let checksum = 0;
    let inIdx = 2;
    let remaining = 40;
    let outIdx = 0;

    while (remaining >= 4) {
        const a = BASE64_URL_MAP[value.charCodeAt(inIdx)];
        const b = BASE64_URL_MAP[value.charCodeAt(inIdx + 1)];
        const c = BASE64_URL_MAP[value.charCodeAt(inIdx + 2)];
        const d = BASE64_URL_MAP[value.charCodeAt(inIdx + 3)];
        if (a < 0 || b < 0 || c < 0 || d < 0) {
            throw new Error("Invalid address encoding");
        }
        const triple = (a << 18) | (b << 12) | (c << 6) | d;
        const byte1 = (triple >> 16) & 0xff;
        const byte2 = (triple >> 8) & 0xff;
        const byte3 = triple & 0xff;
        checksum += byte1;
        checksum += byte2;
        checksum += byte3;
        output[outIdx++] = byte1;
        output[outIdx++] = byte2;
        output[outIdx++] = byte3;
        inIdx += 4;
        remaining -= 4;
    }

    const a = BASE64_URL_MAP[value.charCodeAt(inIdx)];
    const b = BASE64_URL_MAP[value.charCodeAt(inIdx + 1)];
    const c = BASE64_URL_MAP[value.charCodeAt(inIdx + 2)];
    const d = BASE64_URL_MAP[value.charCodeAt(inIdx + 3)];
    if (a < 0 || b < 0 || c < 0 || d < 0) {
        throw new Error("Invalid address encoding");
    }

    const triple = (a << 18) | (b << 12) | (c << 6) | d;
    const byte1 = (triple >> 16) & 0xff;
    const byte2 = (triple >> 8) & 0xff;
    const incomingChecksum = triple & 0xff;

    checksum += byte1;
    checksum += byte2;
    output[outIdx++] = byte1;
    output[outIdx++] = byte2;

    checksum &= 0xff;
    if (checksum !== incomingChecksum) {
        throw new Error("Address checksum mismatch");
    }

    return output;
}

export interface DeriveProgramAddressOptions {
    programAddress: BytesLike;
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

function normalizeProgramAddress(value: BytesLike): Uint8Array {
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
