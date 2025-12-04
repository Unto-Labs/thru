import { hexToBytes, isHexString } from "@thru/helpers";
import { Pubkey, PubkeyInput } from "../primitives";

const ACCOUNT_LIMIT = 1024;

export function normalizeAccountList(accounts: PubkeyInput[]): Uint8Array[] {
    if (accounts.length === 0) {
        return [];
    }

    if (accounts.length > ACCOUNT_LIMIT) {
        throw new Error(`Too many accounts provided: ${accounts.length} (max ${ACCOUNT_LIMIT})`);
    }

    const deduped = dedupeAccountList(accounts);
    return deduped;
}

function dedupeAccountList(accounts: PubkeyInput[]): Uint8Array[] {
    const pubkeys = accounts.map(Pubkey.from).map((pubkey) => pubkey.toBytes());
    const seen = new Map<string, Uint8Array>();
    for (const pubkey of pubkeys) {
        if (pubkey.length !== 32) {
            throw new Error("Account addresses must contain 32 bytes");
        }

        const key = toHex(pubkey);
        if (!seen.has(key)) {
            seen.set(key, pubkey);
        }
    }

    return Array.from(seen.values()).sort(compareAccounts);
}

function compareAccounts(a: Uint8Array, b: Uint8Array): number {
    for (let i = 0; i < 32; i++) {
        if (a[i] !== b[i]) {
            return a[i] - b[i];
        }
    }
    return 0;
}

function toHex(bytes: Uint8Array): string {
    let result = "";
    for (let i = 0; i < bytes.length; i++) {
        const hex = bytes[i].toString(16).padStart(2, "0");
        result += hex;
    }
    return result;
}

export function parseInstructionData(value?: Uint8Array | string): Uint8Array | undefined {
    if (value === undefined) {
        return undefined;
    }
    if (value instanceof Uint8Array) {
        return new Uint8Array(value);
    }
    if (typeof value === "string") {
        if (value.length === 0) {
            return new Uint8Array();
        }
        if (isHexString(value)) {
            return hexToBytes(value);
        }
    }
    throw new Error("Instruction data must be provided as hex string or Uint8Array");
}