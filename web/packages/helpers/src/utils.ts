import { decodeBase64 } from "./encoding";

export type BytesLike = Uint8Array | string;

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