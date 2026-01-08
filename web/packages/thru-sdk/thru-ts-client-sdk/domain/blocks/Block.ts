import type { ConsensusStatus } from "@thru/proto";
import { ExecutionStatus, type Block as CoreBlock } from "@thru/proto";
import { nanosecondsToTimestamp, timestampToNanoseconds } from "../../utils/utils";
import {
    BLOCK_FOOTER_SIZE,
    BLOCK_HEADER_SIZE,
    BLOCK_VERSION_V1,
    PUBKEY_SIZE,
    SIGNATURE_SIZE,
} from "../../wire-format";
import { Transaction } from "../transactions";
import { BlockFooter } from "./BlockFooter";
import { BlockHeader } from "./BlockHeader";

const BLOCK_HASH_SIZE = 32;
const RESERVED_FOOTER_PADDING = 0n;
const SIGNATURE_PREFIX_SIZE = SIGNATURE_SIZE;

export class Block {
    readonly header: BlockHeader;
    readonly footer?: BlockFooter;
    readonly body?: Uint8Array;
    readonly consensusStatus?: ConsensusStatus;

    blockTimeNs?: bigint;
    attestorPayment?: bigint;

    constructor(params: {
        header: BlockHeader;
        footer?: BlockFooter;
        body?: Uint8Array;
        consensusStatus?: ConsensusStatus;
    }) {
        this.header = params.header;
        this.footer = params.footer;
        this.body = params.body ? new Uint8Array(params.body) : undefined;
        this.consensusStatus = params.consensusStatus;
    }

    static fromProto(proto: CoreBlock): Block {
        if (!proto.header) {
            throw new Error("Block proto missing header");
        }

        const rawBody = proto.body ? new Uint8Array(proto.body) : undefined;
        const transactionBody = Block.extractTransactionBody(rawBody, !!proto.footer);

        const block = new Block({
            header: BlockHeader.fromProto(proto.header),
            footer: proto.footer ? BlockFooter.fromProto(proto.footer) : undefined,
            body: transactionBody,
            consensusStatus: proto.consensusStatus,
        });

        // blockTimeNs is not part of the proto Block message, so it remains undefined
        // It will only be set when parsing from wire format
        block.attestorPayment = block.footer?.attestorPayment ?? 0n;

        return block;
    }

    static fromWire(data: Uint8Array): Block {
        if (data.length < BLOCK_HEADER_SIZE) {
            throw new Error(`Block data too short: ${data.length} bytes (expected at least ${BLOCK_HEADER_SIZE})`);
        }

        const headerBytes = data.slice(0, BLOCK_HEADER_SIZE);
        const { header, blockTimeNs } = this.parseHeader(headerBytes);

        if (header.version !== BLOCK_VERSION_V1) {
            throw new Error(`Unsupported block version: ${header.version}`);
        }

        let finalHeader = header;
        let footer: BlockFooter | undefined;
        let footerInfo: { blockHash: Uint8Array; attestorPayment: bigint } | undefined;
        let body: Uint8Array | undefined;

        if (data.length >= BLOCK_HEADER_SIZE + BLOCK_FOOTER_SIZE) {
            const footerOffset = data.length - BLOCK_FOOTER_SIZE;
            const footerBytes = data.slice(footerOffset);
            const parsedFooter = this.parseFooter(footerBytes);
            footer = parsedFooter.footer;
            footerInfo = { blockHash: parsedFooter.blockHash, attestorPayment: parsedFooter.attestorPayment };

            finalHeader = header.withBlockHash(parsedFooter.blockHash);

            body = footerOffset > BLOCK_HEADER_SIZE ? data.slice(BLOCK_HEADER_SIZE, footerOffset) : undefined;
        } else {
            body = data.length > BLOCK_HEADER_SIZE ? data.slice(BLOCK_HEADER_SIZE) : undefined;
        }

        const block = new Block({ header: finalHeader, footer, body });
        block.blockTimeNs = blockTimeNs;
        block.attestorPayment = footerInfo?.attestorPayment ?? 0n;

        return block;
    }

    toWire(): Uint8Array {
        const headerBytes = this.serializeHeader();
        const bodyBytes = this.body ?? new Uint8Array(0);
        const footerBytes = this.footer ? this.serializeFooter() : undefined;

        const totalLength = headerBytes.length + bodyBytes.length + (footerBytes?.length ?? 0);
        const result = new Uint8Array(totalLength);

        result.set(headerBytes, 0);
        result.set(bodyBytes, headerBytes.length);

        if (footerBytes) {
            result.set(footerBytes, headerBytes.length + bodyBytes.length);
        }

        return result;
    }

    getTransactions(): Transaction[] {
        if (!this.body || this.body.length === 0) {
            return [];
        }

        return Block.parseTransactionsFromBody(this.body);
    }

    private static extractTransactionBody(raw: Uint8Array | undefined, hasFooter: boolean): Uint8Array | undefined {
        if (!raw || raw.length <= BLOCK_HEADER_SIZE) {
            return raw && raw.length > BLOCK_HEADER_SIZE ? raw.slice(BLOCK_HEADER_SIZE) : undefined;
        }

        const footerSize = hasFooter && raw.length >= BLOCK_HEADER_SIZE + BLOCK_FOOTER_SIZE ? BLOCK_FOOTER_SIZE : 0;
        const start = BLOCK_HEADER_SIZE;
        const end = Math.max(start, raw.length - footerSize);

        if (end <= start) {
            return undefined;
        }

        return raw.slice(start, end);
    }

    private serializeHeader(): Uint8Array {
        const buffer = new ArrayBuffer(BLOCK_HEADER_SIZE);
        const bytes = new Uint8Array(buffer);
        const view = new DataView(buffer);

        const signature = normalizeBytes(this.header.headerSignature, SIGNATURE_SIZE);
        bytes.set(signature, 0);

        let offset = SIGNATURE_PREFIX_SIZE;
        const version = this.header.version ?? BLOCK_VERSION_V1;
        view.setUint8(offset, version & 0xff);
        offset += 1;

        bytes.fill(0, offset, offset + 7);
        offset += 7;

        const producer = normalizeBytes(this.header.producer, PUBKEY_SIZE);
        bytes.set(producer, offset);
        offset += PUBKEY_SIZE;

        const bondAmountLockUp = this.header.bondAmountLockUp ?? 0n;
        view.setBigUint64(offset, bondAmountLockUp, true);
        offset += 8;

        const expiryTimestampNs = timestampToNanoseconds(this.header.expiryTimestamp);
        view.setBigUint64(offset, expiryTimestampNs, true);
        offset += 8;

        const startSlot = this.header.startSlot ?? 0n;
        view.setBigUint64(offset, startSlot, true);
        offset += 8;

        view.setUint32(offset, this.header.expiryAfter ?? 0, true);
        offset += 4;

        view.setUint32(offset, this.header.maxBlockSize ?? 0, true);
        offset += 4;

        view.setBigUint64(offset, this.header.maxComputeUnits ?? 0n, true);
        offset += 8;

        view.setUint32(offset, this.header.maxStateUnits ?? 0, true);
        offset += 4;

        bytes.fill(0, offset, offset + 4);
        offset += 4;

        // If blockTimeNs is not available, write 0 instead of defaulting to expiryTimestamp
        // This preserves the distinction between "not available" and "equals expiryTimestamp"
        const blockTimeNs = this.blockTimeNs ?? 0n;
        view.setBigUint64(offset, blockTimeNs, true);

        return bytes;
    }

    private serializeFooter(): Uint8Array {
        const buffer = new ArrayBuffer(BLOCK_FOOTER_SIZE);
        const bytes = new Uint8Array(buffer);
        const view = new DataView(buffer);

        const attestorPayment =
            this.footer?.attestorPayment ??
            this.attestorPayment ??
            RESERVED_FOOTER_PADDING;
        view.setBigUint64(0, attestorPayment, true);

        const blockHash = normalizeBytes(this.header.blockHash, BLOCK_HASH_SIZE);
        bytes.set(blockHash, 8);

        const signature = normalizeBytes(this.footer?.signature, SIGNATURE_SIZE);
        bytes.set(signature, 8 + BLOCK_HASH_SIZE);

        return bytes;
    }

    private static parseHeader(bytes: Uint8Array): { header: BlockHeader; blockTimeNs: bigint } {
        if (bytes.length !== BLOCK_HEADER_SIZE) {
            throw new Error(`Invalid block header size: ${bytes.length}`);
        }

        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        let offset = 0;

        const signature = bytes.slice(offset, offset + SIGNATURE_SIZE);
        offset += SIGNATURE_SIZE;

        const version = view.getUint8(offset);
        offset += 1;

        offset += 7; // padding

        const producer = bytes.slice(offset, offset + PUBKEY_SIZE);
        offset += PUBKEY_SIZE;

        const bondAmountLockUp = view.getBigUint64(offset, true);
        offset += 8;

        const expiryTimestampNs = view.getBigUint64(offset, true);
        offset += 8;

        const startSlot = view.getBigUint64(offset, true);
        offset += 8;

        const expiryAfter = view.getUint32(offset, true);
        offset += 4;

        const maxBlockSize = view.getUint32(offset, true);
        offset += 4;

        const maxComputeUnits = view.getBigUint64(offset, true);
        offset += 8;

        const maxStateUnits = view.getUint32(offset, true);
        offset += 4;

        offset += 4; // reserved

        const blockTimeNs = view.getBigUint64(offset, true);

        const header = new BlockHeader({
            slot: startSlot,
            version,
            headerSignature: signature,
            producer,
            expiryTimestamp: nanosecondsToTimestamp(expiryTimestampNs),
            startSlot,
            expiryAfter,
            maxBlockSize,
            maxComputeUnits,
            maxStateUnits,
            bondAmountLockUp,
        });

        return { header, blockTimeNs };
    }

    private static parseFooter(bytes: Uint8Array): {
        footer: BlockFooter;
        blockHash: Uint8Array;
        attestorPayment: bigint;
    } {
        if (bytes.length !== BLOCK_FOOTER_SIZE) {
            throw new Error(`Invalid block footer size: ${bytes.length}`);
        }

        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        let offset = 0;

        const attestorPayment = view.getBigUint64(offset, true);
        offset += 8;

        const blockHash = bytes.slice(offset, offset + BLOCK_HASH_SIZE);
        offset += BLOCK_HASH_SIZE;

        const signature = bytes.slice(offset, offset + SIGNATURE_SIZE);

        const footer = new BlockFooter({
            signature,
            status: ExecutionStatus.UNSPECIFIED,
            consumedComputeUnits: 0n,
            consumedStateUnits: 0,
            attestorPayment,
        });

        return { footer, blockHash, attestorPayment };
    }

    private static parseTransactionsFromBody(body: Uint8Array): Transaction[] {
        const transactions: Transaction[] = [];
        let offset = 0;

        while (offset < body.length) {
            const slice = body.subarray(offset);
            const { transaction, size } = Transaction.parseWire(slice);
            transactions.push(transaction);
            offset += size;
        }

        return transactions;
    }
}

function normalizeBytes(bytes: Uint8Array | undefined, size: number): Uint8Array {
    if (!bytes || bytes.length !== size) {
        return new Uint8Array(size);
    }
    return bytes;
}
