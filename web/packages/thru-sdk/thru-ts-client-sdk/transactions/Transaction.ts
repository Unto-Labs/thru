import { signAsync } from "@noble/ed25519";
import type { AccountAddress, Bytes64, OptionalProofs, TransactionAccountsInput, TransactionHeaderInput } from "./types";

const DEFAULT_FLAGS = 0;
const TRANSACTION_VERSION = 1;
const SIGNATURE_LENGTH = 64;
const PUBKEY_LENGTH = 32;
const HEADER_SIZE = 176;
const SIGNATURE_PREFIX_SIZE = 64;

export class Transaction {
    readonly feePayer: AccountAddress;
    readonly program: AccountAddress;

    readonly fee: bigint;
    readonly nonce: bigint;
    readonly startSlot: bigint;
    readonly expiryAfter: number;

    readonly requestedComputeUnits: number;
    readonly requestedStateUnits: number;
    readonly requestedMemoryUnits: number;
    readonly flags: number;

    readonly readWriteAccounts: AccountAddress[];
    readonly readOnlyAccounts: AccountAddress[];

    readonly instructions?: Uint8Array;
    readonly feePayerStateProof?: Uint8Array;
    readonly feePayerAccountMetaRaw?: Uint8Array;

    private signature?: Bytes64;

    constructor(params: {
        feePayer: AccountAddress;
        program: AccountAddress;
        header: TransactionHeaderInput;
        accounts?: TransactionAccountsInput;
        instructions?: Uint8Array;
        proofs?: OptionalProofs;
    }) {
        this.feePayer = copyKey(params.feePayer);
        this.program = copyKey(params.program);

        this.fee = params.header.fee;
        this.nonce = params.header.nonce;
        this.startSlot = params.header.startSlot;
        this.expiryAfter = params.header.expiryAfter ?? 0;

        this.requestedComputeUnits = params.header.computeUnits ?? 0;
        this.requestedStateUnits = params.header.stateUnits ?? 0;
        this.requestedMemoryUnits = params.header.memoryUnits ?? 0;
        this.flags = params.header.flags ?? DEFAULT_FLAGS;

        this.readWriteAccounts = params.accounts?.readWriteAccounts
            ? params.accounts.readWriteAccounts.map(copyKey)
            : [];
        this.readOnlyAccounts = params.accounts?.readOnlyAccounts
            ? params.accounts.readOnlyAccounts.map(copyKey)
            : [];

        this.instructions = params.instructions ? new Uint8Array(params.instructions) : undefined;
        this.feePayerStateProof = params.proofs?.feePayerStateProof
            ? new Uint8Array(params.proofs.feePayerStateProof)
            : undefined;
        this.feePayerAccountMetaRaw = params.proofs?.feePayerAccountMetaRaw
            ? new Uint8Array(params.proofs.feePayerAccountMetaRaw)
            : undefined;
    }

    getSignature(): Bytes64 | undefined {
        return this.signature ? new Uint8Array(this.signature) : undefined;
    }

    setSignature(signature: Bytes64): void {
        if (signature.length !== SIGNATURE_LENGTH) {
            throw new Error(`Signature must contain ${SIGNATURE_LENGTH} bytes`);
        }
        this.signature = new Uint8Array(signature);
    }

    async sign(privateKey: Uint8Array): Promise<Bytes64> {
        if (privateKey.length !== 32) {
            throw new Error("Fee payer private key must contain 32 bytes");
        }
        const payload = this.toWireForSigning();
        const signature = await signAsync(payload, privateKey);
        if (signature.length !== SIGNATURE_LENGTH) {
            throw new Error("ed25519 signing produced an invalid signature");
        }
        this.signature = signature;
        return new Uint8Array(signature);
    }

    toWireForSigning(): Uint8Array {
        const header = this.createHeader(undefined);
        const view = new Uint8Array(header);
        return this.buildWirePayload(view.subarray(SIGNATURE_PREFIX_SIZE));
    }

    toWire(): Uint8Array {
        const header = this.createHeader(this.signature);
        const payload = this.buildWirePayload(new Uint8Array(header));
        return payload;
    }

    private createHeader(signature: Uint8Array | undefined): ArrayBufferLike {
        const buffer = new ArrayBuffer(HEADER_SIZE);
        const headerBytes = new Uint8Array(buffer);
        const view = new DataView(buffer);

        // Fee payer signature (64 bytes)
        if (signature) {
            if (signature.length !== SIGNATURE_LENGTH) {
                throw new Error(`Signature must contain ${SIGNATURE_LENGTH} bytes`);
            }
            headerBytes.set(signature, 0);
        } else {
            headerBytes.fill(0, 0, SIGNATURE_LENGTH);
        }

        let offset = SIGNATURE_PREFIX_SIZE;
        view.setUint8(offset, TRANSACTION_VERSION);
        offset += 1;

        view.setUint8(offset, this.flags & 0xff);
        offset += 1;

        view.setUint16(offset, this.readWriteAccounts.length, true);
        offset += 2;

        view.setUint16(offset, this.readOnlyAccounts.length, true);
        offset += 2;

        const instructionLength = this.instructions?.length ?? 0;
        if (instructionLength > 0xffff) {
            throw new Error("Instruction data exceeds maximum length (65535 bytes)");
        }
        view.setUint16(offset, instructionLength, true);
        offset += 2;

        view.setUint32(offset, ensureUint32(this.requestedComputeUnits), true);
        offset += 4;

        view.setUint16(offset, ensureUint16(this.requestedStateUnits), true);
        offset += 2;

        view.setUint16(offset, ensureUint16(this.requestedMemoryUnits), true);
        offset += 2;

        view.setBigUint64(offset, ensureBigUint64(this.fee), true);
        offset += 8;

        view.setBigUint64(offset, ensureBigUint64(this.nonce), true);
        offset += 8;

        view.setBigUint64(offset, ensureBigUint64(this.startSlot), true);
        offset += 8;

        view.setUint32(offset, ensureUint32(this.expiryAfter), true);
        offset += 4;

        // padding_0 (4 bytes) zeroed by default
        offset += 4;

        headerBytes.set(this.feePayer, offset);
        offset += PUBKEY_LENGTH;

        headerBytes.set(this.program, offset);

        return buffer;
    }

    private buildWirePayload(headerWithoutSignature: Uint8Array): Uint8Array {
        const dynamicLength =
            this.readWriteAccounts.length * PUBKEY_LENGTH +
            this.readOnlyAccounts.length * PUBKEY_LENGTH +
            (this.instructions?.length ?? 0) +
            (this.feePayerStateProof?.length ?? 0) +
            (this.feePayerAccountMetaRaw?.length ?? 0);

        const result = new Uint8Array(headerWithoutSignature.length + dynamicLength);
        result.set(headerWithoutSignature, 0);

        let offset = headerWithoutSignature.length;
        offset = appendAccountList(result, offset, this.readWriteAccounts);
        offset = appendAccountList(result, offset, this.readOnlyAccounts);
        if (this.instructions) {
            result.set(this.instructions, offset);
            offset += this.instructions.length;
        }
        if (this.feePayerStateProof) {
            result.set(this.feePayerStateProof, offset);
            offset += this.feePayerStateProof.length;
        }
        if (this.feePayerAccountMetaRaw) {
            result.set(this.feePayerAccountMetaRaw, offset);
            offset += this.feePayerAccountMetaRaw.length;
        }

        return result;
    }
}

function appendAccountList(target: Uint8Array, start: number, accounts: AccountAddress[]): number {
    let offset = start;
    for (const account of accounts) {
        target.set(account, offset);
        offset += PUBKEY_LENGTH;
    }
    return offset;
}

function ensureUint16(value: number): number {
    if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
        throw new Error("Value must fit within uint16 range");
    }
    return value;
}

function ensureUint32(value: number): number {
    if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
        throw new Error("Value must fit within uint32 range");
    }
    return value;
}

function ensureBigUint64(value: bigint): bigint {
    if (value < 0n || value > 0xffff_ffff_ffff_ffffn) {
        throw new Error("Value must fit within uint64 range");
    }
    return value;
}

function copyKey(source: AccountAddress): AccountAddress {
    if (source.length !== PUBKEY_LENGTH) {
        throw new Error("Public keys must contain 32 bytes");
    }
    return new Uint8Array(source);
}
