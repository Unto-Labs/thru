import { strict as assert } from "node:assert";
import test from "node:test";

import { Transaction } from "../Transaction";

const HEADER_WITHOUT_SIGNATURE_SIZE = 176 - 64;
const PUBKEY_LEN = 32;

function makeKey(value: number): Uint8Array {
    return new Uint8Array(Array.from({ length: PUBKEY_LEN }, () => value & 0xff));
}

test("Transaction serializes header and payload correctly", () => {
    const feePayer = makeKey(1);
    const program = makeKey(2);
    const rwAccounts = [makeKey(3), makeKey(4)];
    const instructions = new Uint8Array([0xaa, 0xbb, 0xcc]);

    const tx = new Transaction({
        feePayer,
        program,
        header: {
            fee: 10n,
            nonce: 20n,
            startSlot: 30n,
            expiryAfter: 40,
            computeUnits: 50,
            stateUnits: 60,
            memoryUnits: 70,
            flags: 1,
        },
        accounts: {
            readWriteAccounts: rwAccounts,
            readOnlyAccounts: [],
        },
        instructions,
    });

    const unsignedWire = tx.toWire();
    const expectedLength = 176 + rwAccounts.length * PUBKEY_LEN + instructions.length;
    assert.equal(unsignedWire.length, expectedLength);
    assert(unsignedWire.subarray(0, 64).every((byte) => byte === 0), "signature prefix should be zero before signing");

    const forSigning = tx.toWireForSigning();
    const expectedSigningLength = HEADER_WITHOUT_SIGNATURE_SIZE + rwAccounts.length * PUBKEY_LEN + instructions.length;
    assert.equal(forSigning.length, expectedSigningLength);

    const headerView = new DataView(forSigning.buffer, forSigning.byteOffset, HEADER_WITHOUT_SIGNATURE_SIZE);
    assert.equal(headerView.getUint8(0), 1); // version
    assert.equal(headerView.getUint8(1), 1); // flags
    assert.equal(headerView.getUint16(2, true), rwAccounts.length);
    assert.equal(headerView.getUint16(4, true), 0); // readonly count
    assert.equal(headerView.getUint16(6, true), instructions.length);
    assert.equal(headerView.getUint32(8, true), 50);
    assert.equal(headerView.getUint16(12, true), 60);
    assert.equal(headerView.getUint16(14, true), 70);
    assert.equal(Number(headerView.getBigUint64(16, true)), 10);
    assert.equal(Number(headerView.getBigUint64(24, true)), 20);
    assert.equal(Number(headerView.getBigUint64(32, true)), 30);
    assert.equal(headerView.getUint32(40, true), 40);

    const rwStart = HEADER_WITHOUT_SIGNATURE_SIZE;
    assert.deepEqual(forSigning.subarray(rwStart, rwStart + PUBKEY_LEN), rwAccounts[0]);
    assert.deepEqual(forSigning.subarray(rwStart + PUBKEY_LEN, rwStart + PUBKEY_LEN * 2), rwAccounts[1]);

    const instructionStart = rwStart + rwAccounts.length * PUBKEY_LEN;
    assert.deepEqual(forSigning.subarray(instructionStart), instructions);
});

test("Transaction signing populates signature in wire output", async () => {
    const feePayer = makeKey(9);
    const program = makeKey(10);
    const privateKey = new Uint8Array(Array.from({ length: 32 }, (_, idx) => idx + 1));

    const tx = new Transaction({
        feePayer,
        program,
        header: {
            fee: 1n,
            nonce: 2n,
            startSlot: 3n,
        },
    });

    const signature = await tx.sign(privateKey);
    assert.equal(signature.length, 64);

    const storedSignature = tx.getSignature();
    assert(storedSignature);
    assert.deepEqual(signature, storedSignature);

    const wire = tx.toWire();
    assert.deepEqual(wire.subarray(0, 64), signature);
    assert.deepEqual(wire.subarray(64, 64 + 32), feePayer);
});
