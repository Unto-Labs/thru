import { hexToBytes, isHexString } from "@thru/helpers";
import { Pubkey, PubkeyInput } from "../primitives";
import type { InstructionContext } from "./types";

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

/**
 * Creates an InstructionContext from the transaction's account layout.
 *
 * Account order in context: [feePayer, program, ...readWriteAccounts, ...readOnlyAccounts]
 *
 * @param feePayer - The fee payer public key
 * @param program - The program public key
 * @param sortedReadWrite - Read-write accounts in their final sorted order
 * @param sortedReadOnly - Read-only accounts in their final sorted order
 */
export function createInstructionContext(
    feePayer: Pubkey,
    program: Pubkey,
    sortedReadWrite: Uint8Array[],
    sortedReadOnly: Uint8Array[]
): InstructionContext {
    // Build full account list: [feePayer, program, ...readWrite, ...readOnly]
    const accounts: Pubkey[] = [
        feePayer,
        program,
        ...sortedReadWrite.map(bytes => Pubkey.from(bytes)),
        ...sortedReadOnly.map(bytes => Pubkey.from(bytes)),
    ];

    // Build index map for fast lookups
    const indexMap = new Map<string, number>();
    for (let i = 0; i < accounts.length; i++) {
        const key = toHex(accounts[i].toBytes());
        // First occurrence wins (handles any duplicates)
        if (!indexMap.has(key)) {
            indexMap.set(key, i);
        }
    }

    return {
        accounts,
        getAccountIndex: (pubkey: PubkeyInput): number => {
            const bytes = Pubkey.from(pubkey).toBytes();
            const key = toHex(bytes);
            const index = indexMap.get(key);
            if (index === undefined) {
                throw new Error(`Account ${key} not found in transaction accounts`);
            }
            return index;
        },
    };
}