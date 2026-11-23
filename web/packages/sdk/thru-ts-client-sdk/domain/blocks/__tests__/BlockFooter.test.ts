import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { BlockFooterSchema, ExecutionStatus } from "@thru/sdk/proto";
import { BlockFooter } from "../BlockFooter";

describe("BlockFooter", () => {
    it("hydrates from proto", () => {
        const proto = create(BlockFooterSchema, {
            signature: { value: new Uint8Array(64).fill(0x22) },
            status: ExecutionStatus.EXECUTED,
            consumedComputeUnits: 100n,
            consumedStateUnits: 10,
            attestorPayment: 55n,
        });

        const footer = BlockFooter.fromProto(proto);

        expect(footer.signature?.length).toBe(64);
        expect(footer.status).toBe(ExecutionStatus.EXECUTED);
        expect(footer.consumedComputeUnits).toBe(100n);
        expect(footer.consumedStateUnits).toBe(10);
        expect(footer.attestorPayment).toBe(55n);
    });
});
