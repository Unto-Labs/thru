import type { Thru } from "@thru/thru-sdk/client";

const DEFAULT_POLL_ATTEMPTS = 8;
const DEFAULT_POLL_DELAY_MS = 1_000;



interface CounterAccountDetails {
    value: string;
    rawHex: string;
}

function delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function toLittleEndianHex(value: number | bigint, byteLength: number): string {
    let v = typeof value === "bigint" ? value : BigInt(value);
    const bytes = new Uint8Array(byteLength);
    for (let i = 0; i < byteLength; i++) {
        bytes[i] = Number(v & 0xffn);
        v >>= 8n;
    }
    return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}

const u32ToHexLE = (value: number | bigint) => toLittleEndianHex(value, 4);
const u16ToHexLE = (value: number | bigint) => toLittleEndianHex(value, 2);

export function seedToHex32Padded(seed: string): string {
    const bytes = new TextEncoder().encode(seed);
    const padded = new Uint8Array(32);
    padded.set(bytes.slice(0, 32));
    return Array.from(padded, b => b.toString(16).padStart(2, "0")).join("");
}

export function accountDataToHex(data: Uint8Array): string {
    return Array.from(data, b => b.toString(16).padStart(2, "0")).join("");
}

export function accountDataToDetails(data: Uint8Array): CounterAccountDetails {
    const rawHex = accountDataToHex(data);
    if (data.byteLength >= 8) {
        const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
        const counter = view.getBigUint64(0, true);
        return { value: counter.toString(), rawHex };
    }
    if (data.byteLength >= 4) {
        const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
        const counter = view.getUint32(0, true);
        return { value: counter.toString(), rawHex };
    }
    const fallback = data.length > 0 ? String(data[0]) : "0";
    return { value: fallback, rawHex };
}

export async function getCreateCounterInstruction(sdk: Thru, seed: string, derivedAddress: string): Promise<string> {
    const instructionTag = u32ToHexLE(0);
    const accountIndex = u16ToHexLE(2);
    const blockHeight = await sdk.blocks.getBlockHeight();
    const proofResponse = await sdk.proofs.generate({
        proofType: 1,
        address: derivedAddress,
        targetSlot: blockHeight.finalized,
    });

    const proofBytes = proofResponse.proof?.proof;
    if (!proofBytes || proofBytes.length === 0) {
        throw new Error("No state proof returned for counter creation");
    }

    const stateProofSizeHex = u32ToHexLE(proofBytes.length);
    const seedHex = seedToHex32Padded(seed);
    const proofHex = Array.from(proofBytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

    return instructionTag + accountIndex + seedHex + stateProofSizeHex + proofHex;
}

export async function getIncrementCounterInstruction(): Promise<string> {
    const instructionTag = u32ToHexLE(1);
    const accountIndex = u16ToHexLE(2);
    return instructionTag + accountIndex;
}

export async function pollForCounterData(sdk: Thru, address: string, attempts = DEFAULT_POLL_ATTEMPTS): Promise<CounterAccountDetails | null> {
    let lastError: unknown;
    for (let i = 0; i < attempts; i++) {
        try {
            const account = await sdk.accounts.get(address);
            const data = account.data?.data;
            if (data && data.length > 0) {
                return accountDataToDetails(data);
            }
            lastError = undefined;
        } catch (error) {
            lastError = error;
        }
        if (i < attempts - 1) {
            await delay(DEFAULT_POLL_DELAY_MS);
        }
    }
    if (lastError) {
        throw lastError instanceof Error ? lastError : new Error("Unable to load counter account data");
    }
    return null;
}