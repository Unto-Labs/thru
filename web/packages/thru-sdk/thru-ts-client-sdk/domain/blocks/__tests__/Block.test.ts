import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { BlockFooterSchema, BlockHeaderSchema, BlockSchema, ExecutionStatus } from "@thru/proto";
import { nanosecondsToTimestamp } from "../../../utils/utils";
import { BLOCK_HEADER_SIZE, SIGNATURE_SIZE } from "../../../wire-format";
import { Transaction } from "../../transactions/Transaction";
import { Block } from "../Block";
import { BlockFooter } from "../BlockFooter";
import { BlockHeader } from "../BlockHeader";

function createUint8Array(length: number, value: number): Uint8Array {
    const bytes = new Uint8Array(length);
    bytes.fill(value & 0xff);
    return bytes;
}

function createTestTransaction(): Transaction {
    return new Transaction({
        feePayer: createUint8Array(32, 0x01),
        program: createUint8Array(32, 0x02),
        header: {
            fee: 10n,
            nonce: 1n,
            startSlot: 42n,
            expiryAfter: 5,
            computeUnits: 100,
            stateUnits: 10,
            memoryUnits: 8,
        },
        instructionData: new Uint8Array([1, 2, 3, 4]),
    });
}

describe("Block", () => {
    it("should round-trip wire serialization", () => {
        const transaction = createTestTransaction();
        const header = new BlockHeader({
            slot: 42n,
            version: 1,
            startSlot: 42n,
            expiryAfter: 5,
            maxBlockSize: 1024,
            maxComputeUnits: 1_000_000n,
            maxStateUnits: 100,
            bondAmountLockUp: 1n,
            producer: createUint8Array(32, 0x11),
            expiryTimestamp: nanosecondsToTimestamp(100n * 1_000_000_000n),
            headerSignature: createUint8Array(64, 0x22),
        });
        const footer = new BlockFooter({
            signature: createUint8Array(64, 0x33),
            status: ExecutionStatus.UNSPECIFIED,
            consumedComputeUnits: 123n,
            consumedStateUnits: 0,
            attestorPayment: 123n,
        });

        const block = new Block({
            header,
            footer,
            body: transaction.toWire(),
        });
        block.blockTimeNs = 777n;

        const wire = block.toWire();
        const parsed = Block.fromWire(wire);

        expect(parsed.header.version).toBe(1);
        expect(parsed.header.startSlot).toBe(42n);
        expect(parsed.header.blockHash?.length).toBe(32);
        expect(parsed.blockTimeNs).toBe(777n);
        expect(parsed.attestorPayment).toBe(123n);
        expect(parsed.getTransactions()).toHaveLength(1);
        expect(parsed.getTransactions()[0].fee).toBe(10n);
    });

    it("should parse transactions from the block body", () => {
        const tx1 = createTestTransaction();
        const tx2 = createTestTransaction();
        const header = new BlockHeader({
            slot: 77n,
            version: 1,
            startSlot: 77n,
            expiryAfter: 2,
            maxBlockSize: 2048,
            maxComputeUnits: 2_000_000n,
            maxStateUnits: 200,
            bondAmountLockUp: 2n,
            producer: createUint8Array(32, 0x44),
            expiryTimestamp: nanosecondsToTimestamp(200n * 1_000_000_000n),
            headerSignature: createUint8Array(64, 0x55),
        });
        const footer = new BlockFooter({
            signature: createUint8Array(64, 0x66),
            status: ExecutionStatus.UNSPECIFIED,
            consumedComputeUnits: 0n,
            consumedStateUnits: 0,
            attestorPayment: 0n,
        });

        const body = new Uint8Array(tx1.toWire().length + tx2.toWire().length);
        body.set(tx1.toWire(), 0);
        body.set(tx2.toWire(), tx1.toWire().length);

        const parsed = Block.fromWire(new Block({ header, footer, body }).toWire());

        const transactions = parsed.getTransactions();
        expect(transactions).toHaveLength(2);
        expect(transactions[0].instructionData).toEqual(tx1.instructionData);
        expect(transactions[1].instructionData).toEqual(tx2.instructionData);
    });

    it("should reject legacy transaction version 0 in block body", () => {
        const transaction = createTestTransaction();
        const header = new BlockHeader({
            slot: 99n,
            version: 1,
            startSlot: 99n,
            expiryAfter: 1,
            maxBlockSize: 1024,
            maxComputeUnits: 1_000_000n,
            maxStateUnits: 100,
            bondAmountLockUp: 1n,
            producer: createUint8Array(32, 0x77),
            expiryTimestamp: nanosecondsToTimestamp(50n * 1_000_000_000n),
            headerSignature: createUint8Array(64, 0x88),
        });
        const footer = new BlockFooter({
            signature: createUint8Array(64, 0x99),
            status: ExecutionStatus.UNSPECIFIED,
            consumedComputeUnits: 0n,
            consumedStateUnits: 0,
            attestorPayment: 0n,
        });

        const block = new Block({
            header,
            footer,
            body: transaction.toWire(),
        });

        const wire = block.toWire();
        wire[BLOCK_HEADER_SIZE + SIGNATURE_SIZE] = 0; // Force legacy version

        expect(wire[BLOCK_HEADER_SIZE + SIGNATURE_SIZE]).toBe(0);
        const parsed = Block.fromWire(wire);
        expect(parsed.getTransactions()[0].version).toBe(0);
        expect(() => Transaction.parseWire(wire.subarray(BLOCK_HEADER_SIZE), { strict: true })).toThrow(
            "Unsupported transaction version: 0",
        );
        expect(() => Transaction.fromWire(wire.subarray(BLOCK_HEADER_SIZE))).toThrow(
            "Unsupported transaction version: 0",
        );
    });

    it("should reject unknown transaction versions", () => {
        const transaction = createTestTransaction();
        const header = new BlockHeader({
            slot: 123n,
            version: 1,
            startSlot: 123n,
            expiryAfter: 1,
            maxBlockSize: 1024,
            maxComputeUnits: 1_000_000n,
            maxStateUnits: 100,
            bondAmountLockUp: 1n,
            producer: createUint8Array(32, 0xaa),
            expiryTimestamp: nanosecondsToTimestamp(75n * 1_000_000_000n),
            headerSignature: createUint8Array(64, 0xbb),
        });
        const footer = new BlockFooter({
            signature: createUint8Array(64, 0xcc),
            status: ExecutionStatus.UNSPECIFIED,
            consumedComputeUnits: 0n,
            consumedStateUnits: 0,
            attestorPayment: 0n,
        });

        const block = new Block({
            header,
            footer,
            body: transaction.toWire(),
        });

        const wire = block.toWire();
        wire[BLOCK_HEADER_SIZE + SIGNATURE_SIZE] = 56; // Forge unknown version

        expect(wire[BLOCK_HEADER_SIZE + SIGNATURE_SIZE]).toBe(56);
        const parsed = Block.fromWire(wire);
        expect(parsed.getTransactions()[0].version).toBe(56);
        expect(() => Transaction.parseWire(wire.subarray(BLOCK_HEADER_SIZE), { strict: true })).toThrow(
            "Unsupported transaction version: 56",
        );
        expect(() => Transaction.fromWire(wire.subarray(BLOCK_HEADER_SIZE))).toThrow(
            "Unsupported transaction version: 56",
        );
    });

    it("should reconstruct transaction body when created from proto", () => {
        const transaction = createTestTransaction();
        const headerProto = create(BlockHeaderSchema, {
            slot: 250n,
            version: 1,
            startSlot: 250n,
            expiryAfter: 10,
            maxBlockSize: 1024,
            maxComputeUnits: 1_000_000n,
            maxStateUnits: 100,
            bondAmountLockUp: 1n,
            producer: { value: createUint8Array(32, 0x55) },
            expiryTimestamp: nanosecondsToTimestamp(500n * 1_000_000_000n),
            headerSignature: { value: createUint8Array(64, 0xaa) },
        });
        const footerProto = create(BlockFooterSchema, {
            signature: { value: createUint8Array(64, 0xbb) },
            status: 0,
            consumedComputeUnits: 0n,
            consumedStateUnits: 0,
            attestorPayment: 0n,
        });

        const original = new Block({
            header: BlockHeader.fromProto(headerProto),
            footer: BlockFooter.fromProto(footerProto),
            body: transaction.toWire(),
        });
        const rawBlock = original.toWire();

        const proto = create(BlockSchema, {
            header: headerProto,
            footer: footerProto,
            body: rawBlock,
        });

        const parsed = Block.fromProto(proto);

        expect(parsed.body).toEqual(transaction.toWire());
        const parsedTransactions = parsed.getTransactions();
        expect(parsedTransactions).toHaveLength(1);
        expect(parsedTransactions[0].fee).toBe(transaction.fee);
    });
});
