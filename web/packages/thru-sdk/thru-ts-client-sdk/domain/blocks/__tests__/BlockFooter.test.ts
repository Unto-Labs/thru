import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { BlockFooterSchema, ExecutionStatus } from "../../../proto/thru/core/v1/block_pb";
import { Block } from "../Block";
import { BlockFooter } from "../BlockFooter";
import { BlockHeader } from "../BlockHeader";

function makeHeader(): BlockHeader {
    return new BlockHeader({ slot: 1n, version: 1, startSlot: 1n });
}

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

    it("serializes to wire with block", () => {
        const footer = new BlockFooter({
            signature: new Uint8Array(64).fill(0x33),
            status: ExecutionStatus.FAILED,
            consumedComputeUnits: 0n,
            consumedStateUnits: 0,
            attestorPayment: 111n,
        });
        const block = new Block({ header: makeHeader(), footer });
        const wire = block.toWire();

        const parsed = Block.fromWire(wire);
        expect(parsed.footer?.signature?.length).toBe(64);
    });
});
