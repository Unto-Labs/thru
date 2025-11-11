import { create } from "@bufbuild/protobuf";
import { signAsync } from "@noble/ed25519";
import {
    TransactionEventSchema,
    TransactionExecutionResultSchema,
    TransactionVmError,
    type Transaction as CoreTransaction,
    type TransactionExecutionResult as CoreTransactionExecutionResult
} from "../../proto/thru/core/v1/transaction_pb";
import { PubkeySchema } from "../../proto/thru/core/v1/types_pb";
import {
    ACCOUNT_META_FOOTPRINT,
    HASH_SIZE,
    PUBKEY_SIZE,
    SIGNATURE_SIZE,
    STATE_PROOF_HEADER_SIZE,
    STATE_PROOF_TYPE_CREATION,
    STATE_PROOF_TYPE_EXISTING,
    STATE_PROOF_TYPE_UPDATING,
    TXN_FLAG_HAS_FEE_PAYER_PROOF,
    TXN_FLAG_MAY_COMPRESS_ACCOUNT,
    TXN_HEADER_SIZE,
    TXN_MAX_ACCOUNTS,
    TXN_VERSION_V1,
} from "../../wire-format";
import type { AccountAddress, Bytes64, OptionalProofs, TransactionAccountsInput, TransactionHeaderInput } from "./types";
import { protoPubkeyToAccountAddress } from "./utils";

const DEFAULT_FLAGS = 0;
const SIGNATURE_PREFIX_SIZE = SIGNATURE_SIZE;
const MAX_INSTRUCTION_DATA_LENGTH = 0xffff;
const BYTE_POPCOUNT = new Uint8Array(256).map((_value, index) => {
    let v = index;
    let count = 0;
    while (v !== 0) {
        count += v & 1;
        v >>= 1;
    }
    return count;
});

export interface TransactionExecutionEvent {
    eventId: string;
    callIdx: number;
    programIdx: number;
    program?: AccountAddress;
    payload: Uint8Array;
}

export interface TransactionExecutionResultData {
    consumedComputeUnits: number;
    consumedMemoryUnits: number;
    consumedStateUnits: number;
    userErrorCode: bigint;
    vmError: TransactionVmError;
    executionResult: bigint;
    pagesUsed: number;
    eventsCount: number;
    eventsSize: number;
    readwriteAccounts: AccountAddress[];
    readonlyAccounts: AccountAddress[];
    events?: TransactionExecutionEvent[];
}

export class Transaction {
    readonly version: number;
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

    readonly instructionData?: Uint8Array;
    readonly feePayerStateProof?: Uint8Array;
    readonly feePayerAccountMetaRaw?: Uint8Array;

    executionResult?: TransactionExecutionResultData;
    slot?: bigint;
    blockOffset?: number;

    private signature?: Bytes64;

    constructor(params: {
        version?: number;
        feePayer: AccountAddress;
        program: AccountAddress;
        header: TransactionHeaderInput;
        accounts?: TransactionAccountsInput;
        instructionData?: Uint8Array;
        proofs?: OptionalProofs;
    }) {
        this.version = params.version ?? TXN_VERSION_V1;
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

        this.instructionData = params.instructionData ? new Uint8Array(params.instructionData) : undefined;
        if (this.instructionData && this.instructionData.length > MAX_INSTRUCTION_DATA_LENGTH) {
            throw new Error(`Instruction data exceeds maximum length (${MAX_INSTRUCTION_DATA_LENGTH} bytes)`);
        }

        this.feePayerStateProof = params.proofs?.feePayerStateProof
            ? new Uint8Array(params.proofs.feePayerStateProof)
            : undefined;
        this.feePayerAccountMetaRaw = params.proofs?.feePayerAccountMetaRaw
            ? new Uint8Array(params.proofs.feePayerAccountMetaRaw)
            : undefined;
    }

    static fromWire(data: Uint8Array): Transaction {
        const { transaction, size } = Transaction.parseWire(data, { strict: true });
        if (size !== data.length) {
            throw new Error(
                `Transaction body has trailing bytes: expected ${size} bytes but found ${data.length}`,
            );
        }
        return transaction;
    }

    static parseWire(
        data: Uint8Array,
        options: { strict?: boolean } = {},
    ): { transaction: Transaction; size: number } {
        if (data.length < TXN_HEADER_SIZE) {
            throw new Error(`Transaction data too short: ${data.length} bytes (expected at least ${TXN_HEADER_SIZE})`);
        }

        const strict = options.strict ?? false;
        const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
        let offset = 0;

        const signatureBytes = data.slice(offset, offset + SIGNATURE_SIZE);
        const hasSignature = hasNonZeroBytes(signatureBytes);
        offset += SIGNATURE_SIZE;

        const version = view.getUint8(offset);
        offset += 1;
        if (strict && version !== TXN_VERSION_V1) {
            throw new Error(`Unsupported transaction version: ${version}`);
        }

        const flags = view.getUint8(offset);
        offset += 1;
        const invalidFlags = flags & ~(TXN_FLAG_HAS_FEE_PAYER_PROOF | TXN_FLAG_MAY_COMPRESS_ACCOUNT);
        if (strict && invalidFlags !== 0) {
            throw new Error(`Unsupported transaction flags: 0x${invalidFlags.toString(16).padStart(2, "0")}`);
        }

        const readwriteAccountsCount = view.getUint16(offset, true);
        offset += 2;
        const readonlyAccountsCount = view.getUint16(offset, true);
        offset += 2;
        const instructionDataSize = view.getUint16(offset, true);
        offset += 2;
        const requestedComputeUnits = view.getUint32(offset, true);
        offset += 4;
        const requestedStateUnits = view.getUint16(offset, true);
        offset += 2;
        const requestedMemoryUnits = view.getUint16(offset, true);
        offset += 2;
        const fee = view.getBigUint64(offset, true);
        offset += 8;
        const nonce = view.getBigUint64(offset, true);
        offset += 8;
        const startSlot = view.getBigUint64(offset, true);
        offset += 8;
        const expiryAfter = view.getUint32(offset, true);
        offset += 4;
        offset += 4; // padding

        Transaction.ensureAvailable(data.length, offset, PUBKEY_SIZE, "fee payer account");
        const feePayer = data.slice(offset, offset + PUBKEY_SIZE);
        offset += PUBKEY_SIZE;

        Transaction.ensureAvailable(data.length, offset, PUBKEY_SIZE, "program account");
        const program = data.slice(offset, offset + PUBKEY_SIZE);
        offset += PUBKEY_SIZE;

        if (offset !== TXN_HEADER_SIZE) {
            throw new Error(`Transaction header parsing mismatch (expected offset ${TXN_HEADER_SIZE}, got ${offset})`);
        }

        const totalAccountCount = Number(readwriteAccountsCount + readonlyAccountsCount);
        if (strict && totalAccountCount > TXN_MAX_ACCOUNTS) {
            throw new Error(
                `Transaction references ${totalAccountCount} accounts (maximum allowed ${TXN_MAX_ACCOUNTS})`,
            );
        }

        const readWriteAccounts: AccountAddress[] = [];
        for (let i = 0; i < readwriteAccountsCount; i++) {
            Transaction.ensureAvailable(data.length, offset, PUBKEY_SIZE, "read-write accounts");
            readWriteAccounts.push(data.slice(offset, offset + PUBKEY_SIZE));
            offset += PUBKEY_SIZE;
        }

        const readOnlyAccounts: AccountAddress[] = [];
        for (let i = 0; i < readonlyAccountsCount; i++) {
            Transaction.ensureAvailable(data.length, offset, PUBKEY_SIZE, "read-only accounts");
            readOnlyAccounts.push(data.slice(offset, offset + PUBKEY_SIZE));
            offset += PUBKEY_SIZE;
        }

        let instructionData: Uint8Array | undefined;
        if (instructionDataSize > 0) {
            Transaction.ensureAvailable(data.length, offset, instructionDataSize, "instruction data");
            instructionData = data.slice(offset, offset + instructionDataSize);
            offset += instructionDataSize;
        }

        let feePayerStateProof: Uint8Array | undefined;
        let feePayerAccountMetaRaw: Uint8Array | undefined;

        if ((flags & TXN_FLAG_HAS_FEE_PAYER_PROOF) !== 0) {
            const { proofBytes, footprint, proofType } = Transaction.parseStateProof(data.subarray(offset));
            feePayerStateProof = proofBytes;
            offset += footprint;

            if (proofType === STATE_PROOF_TYPE_EXISTING) {
                Transaction.ensureAvailable(data.length, offset, ACCOUNT_META_FOOTPRINT, "fee payer account metadata");
                feePayerAccountMetaRaw = data.slice(offset, offset + ACCOUNT_META_FOOTPRINT);
                offset += ACCOUNT_META_FOOTPRINT;
            }
        }

        const transaction = new Transaction({
            version,
            feePayer,
            program,
            header: {
                fee,
                nonce,
                startSlot,
                expiryAfter,
                computeUnits: requestedComputeUnits,
                stateUnits: requestedStateUnits,
                memoryUnits: requestedMemoryUnits,
                flags,
            },
            accounts: {
                readWriteAccounts,
                readOnlyAccounts,
            },
            instructionData,
            proofs:
                feePayerStateProof || feePayerAccountMetaRaw
                    ? {
                          feePayerStateProof,
                          feePayerAccountMetaRaw,
                      }
                    : undefined,
        });

        if (hasSignature) {
            transaction.setSignature(signatureBytes);
        }

        return { transaction, size: offset };
    }

    static fromProto(proto: CoreTransaction): Transaction {
        if (!proto.header) {
            throw new Error("Transaction proto missing header");
        }

        const header = proto.header;
        const body = proto.body ? new Uint8Array(proto.body) : undefined;

        let transaction: Transaction | undefined;

        if (body && body.length > 0) {
            try {
                const { transaction: parsed } = this.parseWire(body, { strict: false });
                transaction = parsed;
            } catch (err) {
                transaction = undefined;
            }
        }

        if (!transaction) {
            let parsed:
                | {
                      readWriteAccounts: AccountAddress[];
                      readOnlyAccounts: AccountAddress[];
                      instructionData?: Uint8Array;
                      feePayerStateProof?: Uint8Array;
                      feePayerAccountMetaRaw?: Uint8Array;
                  }
                | undefined;

            if (body && body.length > 0) {
                try {
                    parsed = this.parseBodySections(
                        body,
                        header.readwriteAccountsCount ?? 0,
                        header.readonlyAccountsCount ?? 0,
                        header.instructionDataSize ?? 0,
                        header.flags ?? DEFAULT_FLAGS,
                    );
                } catch (sectionErr) {
                    if (body.length >= TXN_HEADER_SIZE) {
                        parsed = this.parseBodySections(
                            body.slice(TXN_HEADER_SIZE),
                            header.readwriteAccountsCount ?? 0,
                            header.readonlyAccountsCount ?? 0,
                            header.instructionDataSize ?? 0,
                            header.flags ?? DEFAULT_FLAGS,
                        );
                    } else {
                        throw sectionErr;
                    }
                }
            }

            if (!parsed) {
                parsed = {
                    readWriteAccounts: [] as AccountAddress[],
                    readOnlyAccounts: [] as AccountAddress[],
                    instructionData: undefined,
                    feePayerStateProof: undefined,
                    feePayerAccountMetaRaw: undefined,
                };
            }

            transaction = new Transaction({
                version: header.version ?? TXN_VERSION_V1,
                feePayer: protoPubkeyToAccountAddress(header.feePayerPubkey),
                program: protoPubkeyToAccountAddress(header.programPubkey),
                header: {
                    fee: header.fee ?? 0n,
                    nonce: header.nonce ?? 0n,
                    startSlot: header.startSlot ?? 0n,
                    expiryAfter: header.expiryAfter ?? 0,
                    computeUnits: header.requestedComputeUnits ?? 0,
                    stateUnits: header.requestedStateUnits ?? 0,
                    memoryUnits: header.requestedMemoryUnits ?? 0,
                    flags: header.flags ?? DEFAULT_FLAGS,
                },
                accounts: {
                    readWriteAccounts: parsed.readWriteAccounts,
                    readOnlyAccounts: parsed.readOnlyAccounts,
                },
                instructionData: parsed.instructionData,
                proofs:
                    parsed.feePayerStateProof || parsed.feePayerAccountMetaRaw
                        ? {
                              feePayerStateProof: parsed.feePayerStateProof,
                              feePayerAccountMetaRaw: parsed.feePayerAccountMetaRaw,
                          }
                        : undefined,
            });
        }

        const signatureBytes = proto.signature?.value ?? header.feePayerSignature?.value ?? undefined;
        if (signatureBytes && signatureBytes.length === SIGNATURE_SIZE && hasNonZeroBytes(signatureBytes)) {
            transaction.setSignature(signatureBytes);
        }

        if (proto.executionResult) {
            transaction.executionResult = Transaction.executionResultFromProto(proto.executionResult);
        }

        if (proto.slot !== undefined) {
            transaction.slot = proto.slot;
        }
        if (proto.blockOffset !== undefined) {
            transaction.blockOffset = proto.blockOffset;
        }

        return transaction;
    }

    getSignature(): Uint8Array | undefined {
        return this.signature ? new Uint8Array(this.signature) : undefined;
    }

    setSignature(signature: Bytes64): void {
        if (signature.length !== SIGNATURE_SIZE) {
            throw new Error(`Signature must contain ${SIGNATURE_SIZE} bytes`);
        }
        this.signature = new Uint8Array(signature);
    }

    async sign(privateKey: Uint8Array): Promise<Bytes64> {
        if (privateKey.length !== 32) {
            throw new Error("Fee payer private key must contain 32 bytes");
        }
        const payload = this.toWireForSigning();
        const signature = await signAsync(payload, privateKey);
        if (signature.length !== SIGNATURE_SIZE) {
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
        return this.buildWirePayload(new Uint8Array(header));
    }

    private createHeader(signature: Uint8Array | undefined): ArrayBufferLike {
        const buffer = new ArrayBuffer(TXN_HEADER_SIZE);
        const headerBytes = new Uint8Array(buffer);
        const view = new DataView(buffer);

        if (signature) {
            if (signature.length !== SIGNATURE_SIZE) {
                throw new Error(`Signature must contain ${SIGNATURE_SIZE} bytes`);
            }
            headerBytes.set(signature, 0);
        } else {
            headerBytes.fill(0, 0, SIGNATURE_SIZE);
        }

        let offset = SIGNATURE_PREFIX_SIZE;
        view.setUint8(offset, this.version & 0xff);
        offset += 1;

        view.setUint8(offset, this.flags & 0xff);
        offset += 1;

        view.setUint16(offset, this.readWriteAccounts.length, true);
        offset += 2;

        view.setUint16(offset, this.readOnlyAccounts.length, true);
        offset += 2;

        const instructionDataLength = this.instructionData?.length ?? 0;
        if (instructionDataLength > MAX_INSTRUCTION_DATA_LENGTH) {
            throw new Error(`Instruction data exceeds maximum length (${MAX_INSTRUCTION_DATA_LENGTH} bytes)`);
        }
        view.setUint16(offset, instructionDataLength, true);
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

        offset += 4; // padding

        headerBytes.set(this.feePayer, offset);
        offset += PUBKEY_SIZE;

        headerBytes.set(this.program, offset);

        return buffer;
    }

    private buildWirePayload(headerPrefix: Uint8Array): Uint8Array {
        const dynamicLength =
            this.readWriteAccounts.length * PUBKEY_SIZE +
            this.readOnlyAccounts.length * PUBKEY_SIZE +
            (this.instructionData?.length ?? 0) +
            (this.feePayerStateProof?.length ?? 0) +
            (this.feePayerAccountMetaRaw?.length ?? 0);

        const result = new Uint8Array(headerPrefix.length + dynamicLength);
        result.set(headerPrefix, 0);

        let offset = headerPrefix.length;
        offset = appendAccountList(result, offset, this.readWriteAccounts);
        offset = appendAccountList(result, offset, this.readOnlyAccounts);
        if (this.instructionData) {
            result.set(this.instructionData, offset);
            offset += this.instructionData.length;
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

    private static parseBodySections(
        body: Uint8Array,
        readwriteCount: number,
        readonlyCount: number,
        instructionDataSize: number,
        flags: number,
    ): {
        readWriteAccounts: AccountAddress[];
        readOnlyAccounts: AccountAddress[];
        instructionData?: Uint8Array;
        feePayerStateProof?: Uint8Array;
        feePayerAccountMetaRaw?: Uint8Array;
    } {
        let offset = 0;

        const readWriteAccounts: AccountAddress[] = [];
        for (let i = 0; i < readwriteCount; i++) {
            this.ensureAvailable(body.length, offset, PUBKEY_SIZE, "read-write accounts");
            readWriteAccounts.push(body.slice(offset, offset + PUBKEY_SIZE));
            offset += PUBKEY_SIZE;
        }

        const readOnlyAccounts: AccountAddress[] = [];
        for (let i = 0; i < readonlyCount; i++) {
            this.ensureAvailable(body.length, offset, PUBKEY_SIZE, "read-only accounts");
            readOnlyAccounts.push(body.slice(offset, offset + PUBKEY_SIZE));
            offset += PUBKEY_SIZE;
        }

        let instructionData: Uint8Array | undefined;
        if (instructionDataSize > 0) {
            this.ensureAvailable(body.length, offset, instructionDataSize, "instruction data");
            instructionData = body.slice(offset, offset + instructionDataSize);
            offset += instructionDataSize;
        }

        let feePayerStateProof: Uint8Array | undefined;
        let feePayerAccountMetaRaw: Uint8Array | undefined;

        if ((flags & TXN_FLAG_HAS_FEE_PAYER_PROOF) !== 0) {
            const { proofBytes, footprint, proofType } = this.parseStateProof(body.subarray(offset));
            feePayerStateProof = proofBytes;
            offset += footprint;

            if (proofType === STATE_PROOF_TYPE_EXISTING) {
                this.ensureAvailable(body.length, offset, ACCOUNT_META_FOOTPRINT, "fee payer account metadata");
                feePayerAccountMetaRaw = body.slice(offset, offset + ACCOUNT_META_FOOTPRINT);
                offset += ACCOUNT_META_FOOTPRINT;
            }
        }

        if (offset !== body.length) {
            throw new Error(
                `Transaction body has trailing bytes: expected ${offset} bytes but found ${body.length}`,
            );
        }

        return {
            readWriteAccounts,
            readOnlyAccounts,
            instructionData,
            feePayerStateProof,
            feePayerAccountMetaRaw,
        };
    }

    private static ensureAvailable(totalLength: number, offset: number, required: number, context: string): void {
        if (offset + required > totalLength) {
            throw new Error(`Transaction data truncated while parsing ${context}`);
        }
    }

    private static parseStateProof(data: Uint8Array): { proofBytes: Uint8Array; footprint: number; proofType: number } {
        if (data.length < STATE_PROOF_HEADER_SIZE) {
            throw new Error("Transaction data truncated while parsing state proof header");
        }

        const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
        const typeSlot = view.getBigUint64(0, true);
        const proofType = Number((typeSlot >> 62n) & 0x3n);
        if (
            proofType !== STATE_PROOF_TYPE_EXISTING &&
            proofType !== STATE_PROOF_TYPE_UPDATING &&
            proofType !== STATE_PROOF_TYPE_CREATION
        ) {
            throw new Error(`Transaction state proof has unknown type: ${proofType}`);
        }

        const pathBitset = data.subarray(8, 40);
        const siblingCount = countSetBits(pathBitset);
        const bodyCount = proofType + siblingCount;
        const totalSize = STATE_PROOF_HEADER_SIZE + bodyCount * HASH_SIZE;

        if (proofType === STATE_PROOF_TYPE_CREATION && bodyCount < 2) {
            throw new Error("Transaction state proof creation entry is truncated");
        }
        if (proofType === STATE_PROOF_TYPE_UPDATING && bodyCount < 1) {
            throw new Error("Transaction state proof updating entry is truncated");
        }
        if (data.length < totalSize) {
            throw new Error("Transaction data truncated while parsing state proof body");
        }

        return {
            proofBytes: data.slice(0, totalSize),
            footprint: totalSize,
            proofType,
        };
    }


    static executionResultFromProto(
        proto: CoreTransactionExecutionResult,
    ): TransactionExecutionResultData {
        return {
            consumedComputeUnits: proto.consumedComputeUnits ?? 0,
            consumedMemoryUnits: proto.consumedMemoryUnits ?? 0,
            consumedStateUnits: proto.consumedStateUnits ?? 0,
            userErrorCode: proto.userErrorCode ?? 0n,
            vmError: proto.vmError ?? TransactionVmError.TRANSACTION_VM_EXECUTE_SUCCESS,
            executionResult: proto.executionResult ?? 0n,
            pagesUsed: proto.pagesUsed ?? 0,
            eventsCount: proto.eventsCount ?? 0,
            eventsSize: proto.eventsSize ?? 0,
            readwriteAccounts: proto.readwriteAccounts.map((account) => protoPubkeyToAccountAddress(account)),
            readonlyAccounts: proto.readonlyAccounts.map((account) => protoPubkeyToAccountAddress(account)),
            events: proto.events.length
                ? proto.events.map((event) => ({
                      eventId: event.eventId,
                      callIdx: event.callIdx,
                      programIdx: event.programIdx,
                      program: event.program ? protoPubkeyToAccountAddress(event.program) : undefined,
                      payload: new Uint8Array(event.payload ?? new Uint8Array(0)),
                  }))
                : undefined,
        };
    }

    private static convertExecutionResultToProto(
        result: TransactionExecutionResultData,
    ): CoreTransactionExecutionResult {
        return create(TransactionExecutionResultSchema, {
            consumedComputeUnits: result.consumedComputeUnits,
            consumedMemoryUnits: result.consumedMemoryUnits,
            consumedStateUnits: result.consumedStateUnits,
            userErrorCode: result.userErrorCode,
            vmError: result.vmError,
            executionResult: result.executionResult,
            pagesUsed: result.pagesUsed,
            eventsCount: result.eventsCount,
            eventsSize: result.eventsSize,
            readwriteAccounts: result.readwriteAccounts.map((account) =>
                create(PubkeySchema, { value: new Uint8Array(account) }),
            ),
            readonlyAccounts: result.readonlyAccounts.map((account) =>
                create(PubkeySchema, { value: new Uint8Array(account) }),
            ),
            events:
                result.events?.map((event) =>
                    create(TransactionEventSchema, {
                        eventId: event.eventId,
                        callIdx: event.callIdx,
                        programIdx: event.programIdx,
                        program: event.program
                            ? create(PubkeySchema, { value: new Uint8Array(event.program) })
                            : undefined,
                        payload: new Uint8Array(event.payload),
                    }),
                ) ?? [],
        });
    }
}

function appendAccountList(target: Uint8Array, start: number, accounts: AccountAddress[]): number {
    let offset = start;
    for (const account of accounts) {
        target.set(account, offset);
        offset += PUBKEY_SIZE;
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
    if (source.length !== PUBKEY_SIZE) {
        throw new Error("Public keys must contain 32 bytes");
    }
    return new Uint8Array(source);
}

function countSetBits(bytes: Uint8Array): number {
    let total = 0;
    for (let i = 0; i < bytes.length; i++) {
        total += BYTE_POPCOUNT[bytes[i]];
    }
    return total;
}

function hasNonZeroBytes(value: Uint8Array): boolean {
    for (let i = 0; i < value.length; i++) {
        if (value[i] !== 0) {
            return true;
        }
    }
    return false;
}
