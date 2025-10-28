import type { BytesLike } from "../modules/helpers";
import { decodeAddress } from "../modules/helpers";
import { hexToBytes, isHexString } from "../utils/utils";
import type { AccountAddress, ProgramIdentifier } from "./types";

const ACCOUNT_LIMIT = 1024;

export function normalizeAccountList(accounts: AccountAddress[]): AccountAddress[] {
    if (accounts.length === 0) {
        return [];
    }

    if (accounts.length > ACCOUNT_LIMIT) {
        throw new Error(`Too many accounts provided: ${accounts.length} (max ${ACCOUNT_LIMIT})`);
    }

    const deduped = dedupeAccountList(accounts);
    return deduped;
}

function dedupeAccountList(accounts: AccountAddress[]): AccountAddress[] {
    const seen = new Map<string, AccountAddress>();
    for (const account of accounts) {
        if (account.length !== 32) {
            throw new Error("Account addresses must contain 32 bytes");
        }

        const key = toHex(account);
        if (!seen.has(key)) {
            seen.set(key, new Uint8Array(account));
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

export function resolveProgramIdentifier(identifier: ProgramIdentifier): AccountAddress {
    if (identifier instanceof Uint8Array) {
        if (identifier.length !== 32) {
            throw new Error("Program public key must contain 32 bytes");
        }
        return copyAccount(identifier);
    }

    if (typeof identifier === "string") {
        const parsed = parseProgramString(identifier);
        if (parsed) {
            return parsed;
        }
    }

    throw new Error("Unsupported program identifier format");
}

function parseProgramString(value: string): AccountAddress | undefined {
    if (value.startsWith("ta") && value.length === 46) {
        return copyAccount(decodeAddress(value));
    }
    if (isHexString(value)) {
        const bytes = hexToBytes(value);
        if (bytes.length !== 32) {
            throw new Error("Hex-encoded program key must contain 32 bytes");
        }
        return bytes;
    }
    return undefined;
}

function copyAccount(value: AccountAddress): AccountAddress {
    if (value.length !== 32) {
        throw new Error("Program public key must contain 32 bytes");
    }
    return new Uint8Array(value);
}

export function parseAccountIdentifier(value: BytesLike, field: string): AccountAddress {
    if (value instanceof Uint8Array) {
        if (value.length !== 32) {
            throw new Error(`${field} must contain 32 bytes`);
        }
        return new Uint8Array(value);
    }

    if (typeof value === "string") {
        if (value.startsWith("ta") && value.length === 46) {
            return copyAccount(decodeAddress(value));
        }
        if (isHexString(value)) {
            const bytes = hexToBytes(value);
            if (bytes.length !== 32) {
                throw new Error(`${field} hex string must decode to 32 bytes`);
            }
            return bytes;
        }
    }

    throw new Error(`${field} must be a 32-byte value, ta-address, or 64-character hex string`);
}

export function parseInstructionData(value?: BytesLike): Uint8Array | undefined {
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
