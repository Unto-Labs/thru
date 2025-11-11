import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { BlockHeader } from "../BlockHeader";
import { BlockHeaderSchema } from "../../../proto/thru/core/v1/block_pb";
import { nanosecondsToTimestamp, timestampToNanoseconds } from "../../../utils/utils";
import { Block } from "../Block";

function createBytes(length: number, value: number): Uint8Array {
    const out = new Uint8Array(length);
    out.fill(value & 0xff);
    return out;
}

describe("BlockHeader", () => {
    it("hydrates from proto", () => {
        const proto = create(BlockHeaderSchema, {
            slot: 5n,
            version: 2,
            startSlot: 4n,
            expiryAfter: 3,
            maxBlockSize: 4096,
            maxComputeUnits: 1_000_000n,
            maxStateUnits: 100,
            price: 8n,
            producer: { value: createBytes(32, 0x44) },
            headerSignature: { value: createBytes(64, 0x55) },
            expiryTimestamp: { seconds: 123n, nanos: 4 },
        });

        const header = BlockHeader.fromProto(proto);

        expect(header.slot).toBe(5n);
        expect(header.version).toBe(2);
        expect(header.startSlot).toBe(4n);
        expect(header.price).toBe(8n);
        expect(header.producer?.length).toBe(32);
        expect(timestampToNanoseconds(header.expiryTimestamp)).toBe(123n * 1_000_000_000n + 4n);
    });

    it("round-trips through Block serialization", () => {
        const header = new BlockHeader({
            slot: 12n,
            version: 1,
            startSlot: 12n,
            expiryAfter: 2,
            maxBlockSize: 2048,
            maxComputeUnits: 2_000_000n,
            maxStateUnits: 200,
            price: 3n,
            producer: createBytes(32, 0x11),
            headerSignature: createBytes(64, 0x22),
            expiryTimestamp: nanosecondsToTimestamp(200n * 1_000_000_000n),
        });

        const block = new Block({ header });
        const wire = block.toWire();
        const parsed = Block.fromWire(wire);

        expect(parsed.header.slot).toBe(12n);
        expect(parsed.header.maxBlockSize).toBe(2048);
        expect(parsed.header.producer?.[0]).toBe(0x11);
    });

    it("fills missing buffers with zeros", () => {
        const header = new BlockHeader({ slot: 1n, version: 1, startSlot: 1n });
        const block = new Block({ header });
        const wire = block.toWire();
        expect(wire.slice(0, 64)).toEqual(new Uint8Array(64));
    });
});
