import type { ConsensusStatus } from "@thru/proto";
import { ExecutionStatus, type Block as CoreBlock } from "@thru/proto";
import { nanosecondsToTimestamp, timestampToNanoseconds } from "../../utils/utils";
import {
    BLOCK_FOOTER_SIZE,
    BLOCK_HEADER_SIZE,
    BLOCK_HEADER_SIZE_LEGACY,
    BLOCK_VERSION_V1,
    PUBKEY_SIZE,
    SIGNATURE_SIZE,
    TXN_HEADER_BODY_SIZE,
    TXN_VERSION_V1,
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
        // Try parsing with current header size first, then fall back to legacy
        const result = Block.tryParseWireWithHeaderSize(data, BLOCK_HEADER_SIZE);
        if (result) {
            return result;
        }

        // Try legacy header size (160 bytes, before weight_slot was added)
        const legacyResult = Block.tryParseWireWithHeaderSize(data, BLOCK_HEADER_SIZE_LEGACY);
        if (legacyResult) {
            return legacyResult;
        }

        // If both fail, throw with the current expected size
        throw new Error(`Block data too short: ${data.length} bytes (expected at least ${BLOCK_HEADER_SIZE})`);
    }

    private static tryParseWireWithHeaderSize(data: Uint8Array, headerSize: number): Block | null {
        if (data.length < headerSize) {
            return null;
        }

        const headerBytes = data.slice(0, headerSize);
        let header: BlockHeader;
        let blockTimeNs: bigint;

        try {
            const parsed = this.parseHeaderWithSize(headerBytes, headerSize);
            header = parsed.header;
            blockTimeNs = parsed.blockTimeNs;
        } catch {
            return null;
        }

        if (header.version !== BLOCK_VERSION_V1) {
            return null;
        }

        let finalHeader = header;
        let footer: BlockFooter | undefined;
        let footerInfo: { blockHash: Uint8Array; attestorPayment: bigint } | undefined;
        let body: Uint8Array | undefined;

        if (data.length >= headerSize + BLOCK_FOOTER_SIZE) {
            const footerOffset = data.length - BLOCK_FOOTER_SIZE;
            const footerBytes = data.slice(footerOffset);

            try {
                const parsedFooter = this.parseFooter(footerBytes);
                footer = parsedFooter.footer;
                footerInfo = { blockHash: parsedFooter.blockHash, attestorPayment: parsedFooter.attestorPayment };
                finalHeader = header.withBlockHash(parsedFooter.blockHash);
            } catch {
                return null;
            }

            body = footerOffset > headerSize ? data.slice(headerSize, footerOffset) : undefined;
        } else {
            body = data.length > headerSize ? data.slice(headerSize) : undefined;
        }

        // Validate that the extracted body looks like valid transactions
        if (body && body.length > 0 && !Block.looksLikeValidTransactionBody(body)) {
            return null;
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
        if (!raw || raw.length === 0) {
            return undefined;
        }

        // Try current header size first (168 bytes with weight_slot)
        const bodyWithCurrentHeader = Block.extractWithHeaderSize(raw, hasFooter, BLOCK_HEADER_SIZE);
        if (bodyWithCurrentHeader && bodyWithCurrentHeader.length > 0 && Block.looksLikeValidTransactionBody(bodyWithCurrentHeader)) {
            return bodyWithCurrentHeader;
        }

        // Try legacy header size (160 bytes without weight_slot, for blocks before Dec 2025)
        const bodyWithLegacyHeader = Block.extractWithHeaderSize(raw, hasFooter, BLOCK_HEADER_SIZE_LEGACY);
        if (bodyWithLegacyHeader && bodyWithLegacyHeader.length > 0 && Block.looksLikeValidTransactionBody(bodyWithLegacyHeader)) {
            return bodyWithLegacyHeader;
        }

        // If stripping header/footer doesn't produce any body, return undefined
        return undefined;
    }

    private static extractWithHeaderSize(
        raw: Uint8Array,
        hasFooter: boolean,
        headerSize: number,
    ): Uint8Array | undefined {
        if (raw.length <= headerSize) {
            return undefined;
        }

        const footerSize = hasFooter && raw.length >= headerSize + BLOCK_FOOTER_SIZE ? BLOCK_FOOTER_SIZE : 0;
        const start = headerSize;
        const end = Math.max(start, raw.length - footerSize);

        if (end <= start) {
            return undefined;
        }

        return raw.slice(start, end);
    }

    /**
     * Checks if the data looks like a valid transaction body.
     * Uses heuristics to detect if we've correctly offset into the block data.
     * Wire format: header (112 bytes) + body + signature (64 bytes at end)
     * This is a lenient heuristic for format detection - version/flag validation
     * happens in Transaction.parseWire.
     */
    private static looksLikeValidTransactionBody(data: Uint8Array): boolean {
        const MIN_TXN_SIZE = TXN_HEADER_BODY_SIZE + SIGNATURE_SIZE; // 176 bytes minimum

        if (data.length < MIN_TXN_SIZE) {
            return false;
        }

        // Read account counts (little-endian uint16) at offsets 2-5
        const readwriteCount = data[2] | (data[3] << 8);
        const readonlyCount = data[4] | (data[5] << 8);

        const totalAccounts = readwriteCount + readonlyCount;
        if (totalAccounts > 1024) {
            return false;
        }

        // Read instruction data size at offsets 6-7
        const instrDataSize = data[6] | (data[7] << 8);

        // Calculate expected minimum transaction size (header + accounts + instr + signature)
        const expectedMinSize = TXN_HEADER_BODY_SIZE + totalAccounts * PUBKEY_SIZE + instrDataSize + SIGNATURE_SIZE;

        if (data.length < expectedMinSize) {
            return false;
        }

        return true;
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

        bytes.fill(0, offset, offset + 5); // padding (5 bytes)
        offset += 5;

        view.setUint16(offset, this.header.chainId ?? 0, true);
        offset += 2;

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

        bytes.fill(0, offset, offset + 4); // reserved
        offset += 4;

        view.setBigUint64(offset, this.header.weightSlot ?? 0n, true);
        offset += 8;

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

        offset += 5; // padding (5 bytes)

        const chainId = view.getUint16(offset, true);
        offset += 2;

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

        const weightSlot = view.getBigUint64(offset, true);
        offset += 8;

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
            weightSlot,
            chainId,
        });

        return { header, blockTimeNs };
    }

    /**
     * Parses a block header with a specific expected size.
     * Handles both current (168 bytes with weight_slot) and legacy (160 bytes without weight_slot) formats.
     */
    private static parseHeaderWithSize(
        bytes: Uint8Array,
        expectedSize: number,
    ): { header: BlockHeader; blockTimeNs: bigint } {
        if (bytes.length !== expectedSize) {
            throw new Error(`Invalid block header size: ${bytes.length}, expected ${expectedSize}`);
        }

        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        let offset = 0;

        const signature = bytes.slice(offset, offset + SIGNATURE_SIZE);
        offset += SIGNATURE_SIZE;

        const version = view.getUint8(offset);
        offset += 1;

        offset += 5; // padding

        const chainId = view.getUint16(offset, true);
        offset += 2;

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

        // Layout differs between current and legacy formats:
        //   Current (168 bytes): ... reserved(4) | weightSlot(8) | blockTimeNs(8)
        //   Legacy  (160 bytes): ... reserved(4) | blockTimeNs(8)
        let weightSlot: bigint | undefined;
        let blockTimeNs: bigint;
        if (expectedSize === BLOCK_HEADER_SIZE) {
            weightSlot = view.getBigUint64(offset, true);
            offset += 8;
            blockTimeNs = view.getBigUint64(offset, true);
        } else {
            blockTimeNs = view.getBigUint64(offset, true);
        }

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
            weightSlot,
            chainId,
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
            // Stop parsing if remaining bytes are too short for a transaction
            // Wire format: header (112 bytes) + body + signature (64 bytes)
            // Minimum transaction size: 112 header + 64 signature = 176 bytes
            if (slice.length < 176) {
                // Remaining bytes are likely padding or the block signature
                break;
            }
            try {
                const { transaction, size } = Transaction.parseWire(slice);
                transactions.push(transaction);
                offset += size;
            } catch {
                // Stop parsing on error - remaining bytes may be padding
                break;
            }
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
