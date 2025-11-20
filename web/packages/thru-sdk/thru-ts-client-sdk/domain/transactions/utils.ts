import { BytesLike, Pubkey, hexToBytes, isHexString } from "@thru/helpers";
import type { Pubkey as ProtoPubkey } from "../../proto/thru/common/v1/primitives_pb";
import { protoPubkeyToBytes, pubkeyBytesFromInput } from "../../utils/primitives";
import type { AccountAddress, ProgramIdentifier } from "./types";

const ACCOUNT_LIMIT = 1024;
const ACCOUNT_ADDRESS_LENGTH = 32;

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
    return pubkeyBytesFromInput(identifier, "program");
}

export function parseAccountIdentifier(value: Pubkey, field: string): AccountAddress {
    return pubkeyBytesFromInput(value, field);
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

export function protoPubkeyToAccountAddress(pubkey?: ProtoPubkey): AccountAddress {
    return protoPubkeyToBytes(pubkey);
}
