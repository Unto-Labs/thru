import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { TransactionSchema } from "../../../proto/thru/core/v1/transaction_pb";
import { PubkeySchema } from "../../../proto/thru/core/v1/types_pb";
import { TXN_HEADER_SIZE } from "../../../wire-format";
import { Transaction } from "../Transaction";

function buildTestTransaction(): Transaction {
    return new Transaction({
        feePayer: new Uint8Array(Array.from({ length: 32 }, (_, i) => i + 1)),
        program: new Uint8Array(Array.from({ length: 32 }, (_, i) => 200 - i)),
        header: {
            fee: 123n,
            nonce: 456n,
            startSlot: 789n,
            expiryAfter: 32,
            computeUnits: 200_000,
            stateUnits: 512,
            memoryUnits: 1024,
            flags: 0,
        },
        accounts: {
            readWriteAccounts: [new Uint8Array(32).fill(0x11), new Uint8Array(32).fill(0x22)],
            readOnlyAccounts: [new Uint8Array(32).fill(0x33)],
        },
        instructionData: new Uint8Array([1, 2, 3, 4, 5]),
    });
}

function buildHeaderProto(tx: Transaction) {
    return {
        version: tx.version,
        flags: tx.flags,
        readwriteAccountsCount: tx.readWriteAccounts.length,
        readonlyAccountsCount: tx.readOnlyAccounts.length,
        instructionDataSize: tx.instructionData?.length ?? 0,
        requestedComputeUnits: tx.requestedComputeUnits,
        requestedStateUnits: tx.requestedStateUnits,
        requestedMemoryUnits: tx.requestedMemoryUnits,
        expiryAfter: tx.expiryAfter,
        fee: tx.fee,
        nonce: tx.nonce,
        startSlot: tx.startSlot,
        feePayerPubkey: create(PubkeySchema, { value: new Uint8Array(tx.feePayer) }),
        programPubkey: create(PubkeySchema, { value: new Uint8Array(tx.program) }),
    };
}

describe("Transaction.fromProto", () => {
    it("parses a proto containing a complete wire payload", () => {
        const transaction = buildTestTransaction();
        const wire = transaction.toWire();

        const proto = create(TransactionSchema, {
            header: buildHeaderProto(transaction),
            body: wire,
        });

        const parsed = Transaction.fromProto(proto);

        expect(parsed.fee).toBe(transaction.fee);
        expect(parsed.nonce).toBe(transaction.nonce);
        expect(parsed.startSlot).toBe(transaction.startSlot);
        expect(parsed.readWriteAccounts).toEqual(transaction.readWriteAccounts);
        expect(parsed.readOnlyAccounts).toEqual(transaction.readOnlyAccounts);
        expect(parsed.instructionData).toEqual(transaction.instructionData);
    });

    it("parses a proto containing only dynamic sections", () => {
        const transaction = buildTestTransaction();
        const wire = transaction.toWire();
        const bodyWithoutHeader = wire.slice(TXN_HEADER_SIZE);

        const proto = create(TransactionSchema, {
            header: buildHeaderProto(transaction),
            body: bodyWithoutHeader,
        });

        const parsed = Transaction.fromProto(proto);

        expect(parsed.fee).toBe(transaction.fee);
        expect(parsed.nonce).toBe(transaction.nonce);
        expect(parsed.startSlot).toBe(transaction.startSlot);
        expect(parsed.readWriteAccounts).toEqual(transaction.readWriteAccounts);
        expect(parsed.readOnlyAccounts).toEqual(transaction.readOnlyAccounts);
        expect(parsed.instructionData).toEqual(transaction.instructionData);
    });
});


