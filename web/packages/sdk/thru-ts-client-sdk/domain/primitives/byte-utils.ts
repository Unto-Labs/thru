export function copyBytes(source: Uint8Array): Uint8Array {
    const bytes = new Uint8Array(source.length);
    bytes.set(source);
    return bytes;
}

export function ensureExactLength(bytes: Uint8Array, expected: number): Uint8Array {
    if (bytes.length !== expected) {
        throw new Error(`Must contain ${expected} bytes`);
    }
    return copyBytes(bytes);
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) {
        return false;
    }
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) {
            return false;
        }
    }
    return true;
}

export function bytesToHex(bytes: Uint8Array): string {
    const hex: string[] = new Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) {
        hex[i] = bytes[i].toString(16).padStart(2, "0");
    }
    return hex.join("");
}

export function bytesToBase64(bytes: Uint8Array): string {
    const globalBuffer = typeof globalThis !== "undefined" ? (globalThis as any)?.Buffer : undefined;
    if (globalBuffer) {
        return globalBuffer.from(bytes).toString("base64");
    }
    if (typeof btoa === "function") {
        let binary = "";
        for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }
    throw new Error("Base64 encoding is not supported in this environment");
}

