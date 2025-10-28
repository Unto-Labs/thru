
const BASE64_URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const BASE64_URL_MAP = new Int16Array(256).fill(-1);
for (let i = 0; i < BASE64_URL_ALPHABET.length; i++) {
    BASE64_URL_MAP[BASE64_URL_ALPHABET.charCodeAt(i)] = i;
}

export type BytesLike = string | Uint8Array;
export type BlockSelector = { slot: number | bigint } | { blockHash: BytesLike };

export function decodeBase64(value: string): Uint8Array {
    if (value.length === 0) {
        return new Uint8Array();
    }
    const atobFn = globalThis.atob;
    if (!atobFn) {
        throw new Error("Base64 decoding requires window.atob support");
    }
    const binary = atobFn(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

export function isSlotSelector(selector: BlockSelector): selector is { slot: number | bigint } {
    return "slot" in selector;
}

export function ensureBytes(value: BytesLike | undefined, field: string): Uint8Array {
    if (value instanceof Uint8Array) {
        if (value.length === 0) {
            throw new Error(`${field} cannot be empty`);
        }
        return value;
    }
    if (typeof value === "string") {
        if (value.length === 0) {
            throw new Error(`${field} cannot be empty`);
        }
        return decodeBase64(value);
    }
    throw new Error(`${field} is required`);
}

export function maskForBits(bits: number): number {
    return bits === 0 ? 0 : (1 << bits) - 1;
}

export function isHexString(value: string): boolean {
    const normalized = value.startsWith("0x") ? value.slice(2) : value;
    return normalized.length % 2 === 0 && normalized.length > 0 && /^[0-9a-fA-F]+$/.test(normalized);
}

export function hexToBytes(value: string): Uint8Array {
    const normalized = value.startsWith("0x") ? value.slice(2) : value;
    if (normalized.length % 2 !== 0) {
        throw new Error("Hex string must contain an even number of characters");
    }
    const bytes = new Uint8Array(normalized.length / 2);
    for (let i = 0; i < normalized.length; i += 2) {
        const byte = parseInt(normalized.slice(i, i + 2), 16);
        if (Number.isNaN(byte)) {
            throw new Error("Hex string contains invalid characters");
        }
        bytes[i / 2] = byte;
    }
    return bytes;
}
