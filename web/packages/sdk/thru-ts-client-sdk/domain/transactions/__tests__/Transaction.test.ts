import { describe, expect, it } from "vitest";

import { Transaction } from "../Transaction";
import { buildCreationProof, buildExistingProof } from "./helpers";

function createTransaction(): Transaction {
    return new Transaction({
        feePayer: new Uint8Array(Array.from({ length: 32 }, (_, i) => i + 1)),
        program: new Uint8Array(Array.from({ length: 32 }, (_, i) => 200 - i)),
        header: {
            fee: 123n,
            nonce: 456n,
            startSlot: 789n,
            expiryAfter: 50,
            computeUnits: 150_000,
            stateUnits: 2_000,
            memoryUnits: 3_000,
            flags: 0,
        },
        accounts: {
            readWriteAccounts: [
                new Uint8Array(32).fill(0xaa),
                new Uint8Array(32).fill(0xbb),
            ],
            readOnlyAccounts: [new Uint8Array(32).fill(0xcc)],
        },
        instructionData: new Uint8Array([9, 8, 7, 6, 5, 4, 3, 2, 1]),
    });
}

describe("Transaction wire format", () => {
    it("round-trips toWire and fromWire preserving fields", () => {
        const original = createTransaction();
        const wire = original.toWire();

        const parsed = Transaction.fromWire(wire);

        expect(parsed.version).toBe(original.version);
        expect(parsed.fee).toBe(original.fee);
        expect(parsed.nonce).toBe(original.nonce);
        expect(parsed.startSlot).toBe(original.startSlot);
        expect(parsed.expiryAfter).toBe(original.expiryAfter);
        expect(parsed.requestedComputeUnits).toBe(original.requestedComputeUnits);
        expect(parsed.requestedStateUnits).toBe(original.requestedStateUnits);
        expect(parsed.requestedMemoryUnits).toBe(original.requestedMemoryUnits);
        expect(parsed.readWriteAccounts.map((account) => account.toBytes())).toEqual(
            original.readWriteAccounts.map((account) => account.toBytes()),
        );
        expect(parsed.readOnlyAccounts.map((account) => account.toBytes())).toEqual(
            original.readOnlyAccounts.map((account) => account.toBytes()),
        );
        expect(parsed.instructionData).toEqual(original.instructionData);
    });

    it("throws when transaction version is unsupported", () => {
        const wire = createTransaction().toWire();
        wire[0] = 0; // overwrite version byte

        expect(() => Transaction.fromWire(wire)).toThrow(/Unsupported transaction version/);
    });

    it("throws when unsupported flags are present", () => {
        const wire = createTransaction().toWire();
        wire[1] = 0xff; // invalid flags (bits beyond defined flags)

        expect(() => Transaction.fromWire(wire)).toThrow(/Unsupported transaction flags/);
    });

    it("rejects payloads with trailing bytes", () => {
        const wire = createTransaction().toWire();
        const withTrailing = new Uint8Array(wire.length + 1);
        withTrailing.set(wire, 0);
        withTrailing[wire.length] = 1;

        expect(() => Transaction.fromWire(withTrailing)).toThrow(/Transaction body has trailing bytes/);
    });

    it("returns consumed size from parseWire", () => {
        const wire = createTransaction().toWire();
        const { transaction, size } = Transaction.parseWire(wire);

        expect(size).toBe(wire.length);
        expect(transaction.fee).toBe(123n);
    });

    it("includes fee payer state proof when present", () => {
        const creationProof = buildCreationProof();

        const tx = new Transaction({
            feePayer: new Uint8Array(32).fill(0x55),
            program: new Uint8Array(32).fill(0x66),
            header: {
                fee: 1n,
                nonce: 2n,
                startSlot: 3n,
                flags: 1, // TXN_FLAG_HAS_FEE_PAYER_PROOF
            },
            proofs: {
                feePayerStateProof: creationProof,
            },
        });

        const wire = tx.toWire();
        const parsed = Transaction.fromWire(wire);

        expect(parsed.flags & 0x01).toBe(0x01);
        expect(parsed.feePayerStateProof).toEqual(creationProof);
        expect(parsed.feePayerAccountMetaRaw).toBeUndefined();
    });

    it("parses fee payer state proof with account meta", () => {
        const { proof, meta } = buildExistingProof(true);

        const tx = new Transaction({
            feePayer: new Uint8Array(32).fill(0x77),
            program: new Uint8Array(32).fill(0x88),
            header: {
                fee: 1n,
                nonce: 2n,
                startSlot: 3n,
                flags: 1,
            },
            proofs: {
                feePayerStateProof: proof,
                feePayerAccountMetaRaw: meta,
            },
        });

        const wire = tx.toWire();
        const parsed = Transaction.fromWire(wire);

        expect(parsed.feePayerStateProof).toEqual(proof);
        expect(parsed.feePayerAccountMetaRaw).toEqual(meta);
    });

    it("produces signing payload without signature bytes", () => {
        const tx = createTransaction();
        const signingBytes = tx.toWireForSigning();
        const wire = tx.toWire();

        // Signing payload is everything except the trailing 64-byte signature
        expect(signingBytes).toEqual(wire.slice(0, -64));
    });

    it("signs transaction with ed25519 key", async () => {
        const privateKey = new Uint8Array(32);
        privateKey.fill(0x42);

        const tx = createTransaction();
        await tx.sign(privateKey);

        const wire = tx.toWire();
        const parsed = Transaction.fromWire(wire);

        expect(parsed.getSignature()).toBeDefined();
    });
});


