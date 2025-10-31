import { BASE64_URL_ALPHABET, BASE64_URL_MAP } from "./constants";
import { maskForBits } from "./utils";

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