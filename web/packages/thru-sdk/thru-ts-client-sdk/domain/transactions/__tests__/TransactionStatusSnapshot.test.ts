import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { TransactionStatusSnapshot } from "../TransactionStatusSnapshot";
import { TransactionExecutionResultSchema } from "@thru/proto";
import { TransactionStatusSchema } from "@thru/proto";
import { ConsensusStatus } from "@thru/proto";

describe("TransactionStatusSnapshot", () => {
    it("constructs from proto with execution result", () => {
        const proto = create(TransactionStatusSchema, {
            signature: { value: new Uint8Array(64).fill(0x11) },
            consensusStatus: ConsensusStatus.FINALIZED,
            executionResult: create(TransactionExecutionResultSchema, {
                consumedComputeUnits: 10,
                consumedMemoryUnits: 20,
                consumedStateUnits: 30,
            }),
        });

        const snapshot = TransactionStatusSnapshot.fromProto(proto);

        expect(snapshot.signature.length).toBe(64);
        expect(snapshot.statusCode).toBe(ConsensusStatus.FINALIZED);
        expect(snapshot.status).toBe("FINALIZED");
        expect(snapshot.executionResult?.consumedComputeUnits).toBe(10);
    });

    it("throws when signature is missing", () => {
        const proto = create(TransactionStatusSchema, {});
        expect(() => TransactionStatusSnapshot.fromProto(proto)).toThrow("TransactionStatus proto missing signature");
    });
});

