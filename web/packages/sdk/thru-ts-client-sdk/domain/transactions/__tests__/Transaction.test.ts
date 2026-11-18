import { describe, expect, it } from "vitest";
import { getPublicKeyAsync } from "@noble/ed25519";

import { Transaction } from "../Transaction";
import { SignatureDomain, verifyWithDomain } from "../domain-signing";
import * as legacySigning from "../domain-signing-legacy";
import { buildCreationProof, buildExistingProof } from "./helpers";

function createTransaction(feePayer?: Uint8Array): Transaction {
    return new Transaction({
        feePayer: feePayer ?? new Uint8Array(Array.from({ length: 32 }, (_, i) => i + 1)),
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

    describe("account count limit (2 + rw + ro <= 1024, matching C/Rust)", () => {
        /**
         * Wire (body ‖ zero signature) with the given rw/ro counts and
         * distinct, ascending account keys. Only the count rule is under test.
         */
        function wireWithAccountCounts(rwCount: number, roCount: number): Uint8Array {
            const header = new Transaction({
                feePayer: new Uint8Array(32).fill(0xfe),
                program: new Uint8Array(32).fill(0xff),
                header: { fee: 0n, nonce: 0n, startSlot: 0n },
            }).toWireForSigning();
            const total = rwCount + roCount;
            const wire = new Uint8Array(header.length + total * 32 + 64);
            wire.set(header, 0);
            const view = new DataView(wire.buffer);
            view.setUint16(2, rwCount, true);
            view.setUint16(4, roCount, true);
            for (let i = 0; i < total; i++) {
                view.setUint16(header.length + i * 32, i, false);
            }
            return wire;
        }

        it("accepts exactly 1024 accounts including fee payer and program", () => {
            expect(Transaction.fromWire(wireWithAccountCounts(1022, 0)).readWriteAccounts).toHaveLength(1022);
            const split = Transaction.fromWire(wireWithAccountCounts(500, 522));
            expect(split.readWriteAccounts).toHaveLength(500);
            expect(split.readOnlyAccounts).toHaveLength(522);
        });

        it.each([
            [1023, 0],
            [0, 1023],
            [600, 423],
            [1024, 0],
        ])("rejects rw=%i ro=%i (fee payer and program count toward the limit)", (rw, ro) => {
            expect(() => Transaction.fromWire(wireWithAccountCounts(rw, ro))).toThrow(
                /accounts including fee payer and program \(maximum allowed 1024\)/,
            );
        });

        it("does not apply the limit in non-strict parsing", () => {
            const wire = wireWithAccountCounts(1023, 0);
            expect(Transaction.parseWire(wire).size).toBe(wire.length);
        });
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

    it("sign remains RFC-8032-only", async () => {
        const privateKey = new Uint8Array(32);
        privateKey.fill(0x42);

        // The fee payer must be the public key derived from the signing key, or
        // Transaction.sign rejects the mismatch (the sig is verified against the
        // fee payer on chain).
        const feePayer = await getPublicKeyAsync(privateKey);
        const tx = createTransaction(feePayer);
        const signature = await tx.sign(privateKey);
        const payload = tx.toWireForSigning();

        const wire = tx.toWire();
        const parsed = Transaction.fromWire(wire);

        expect(parsed.getSignature()).toBeDefined();
        expect(
            await verifyWithDomain(
                signature.toBytes(),
                payload,
                feePayer,
                SignatureDomain.TXN,
            ),
        ).toBe(true);
        expect(
            await legacySigning.verifyWithDomain(
                signature.toBytes(),
                payload,
                feePayer,
                legacySigning.SignatureDomain.TXN,
            ),
        ).toBe(false);
    });

    it("legacySign produces only a legacy-valid transaction signature", async () => {
        const privateKey = new Uint8Array(32);
        privateKey.fill(0x42);
        const feePayer = await getPublicKeyAsync(privateKey);
        const tx = createTransaction(feePayer);
        const signature = await tx.legacySign(privateKey);
        const payload = tx.toWireForSigning();

        expect(
            await legacySigning.verifyWithDomain(
                signature.toBytes(),
                payload,
                feePayer,
                legacySigning.SignatureDomain.TXN,
            ),
        ).toBe(true);
        expect(
            await verifyWithDomain(
                signature.toBytes(),
                payload,
                feePayer,
                SignatureDomain.TXN,
            ),
        ).toBe(false);
    });
});
