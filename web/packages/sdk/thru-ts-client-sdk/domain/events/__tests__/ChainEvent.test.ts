import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { EventSchema } from "@thru/sdk/proto";
import { StreamEventsResponseSchema } from "@thru/sdk/proto";
import { ChainEvent } from "../ChainEvent";

describe("ChainEvent", () => {
    it("creates from query event", () => {
        const proto = create(EventSchema, {
            eventId: "ev-1",
            transactionSignature: { value: new Uint8Array(64).fill(0x11) },
            program: { value: new Uint8Array(32).fill(0x22) },
            payload: new Uint8Array([1, 2, 3]),
            slot: 42n,
            callIdx: 1,
            programIdx: 2,
            payloadSize: 3,
            feePayer: { value: new Uint8Array(32).fill(0x33) },
            blockOffset: 7,
            timestamp: { seconds: 5n, nanos: 9 },
        });

        const event = ChainEvent.fromQuery(proto);

        expect(event.id).toBe("ev-1");
        expect(event.transactionSignature).toBeDefined();
        expect(event.program).toBeDefined();
        expect(event.payload).toEqual(new Uint8Array([1, 2, 3]));
        expect(event.slot).toBe(42n);
        expect(event.callIndex).toBe(1);
        expect(event.programIndex).toBe(2);
        expect(event.payloadSize).toBe(3);
        expect(event.feePayer).toEqual(new Uint8Array(32).fill(0x33));
        expect(event.blockOffset).toBe(7);
        expect(event.blockTimestampNs).toBe(5n * 1_000_000_000n + 9n);
        expect(event.timestampNs).toBeUndefined();
    });

    it("creates from stream response and copies buffers", () => {
        const payload = new Uint8Array([9, 8, 7]);
        const proto = create(StreamEventsResponseSchema, {
            eventId: "tsSignatureExample:100:3:3:0",
            signature: { value: new Uint8Array(64).fill(0xaa) },
            program: { value: new Uint8Array(32).fill(0xbb) },
            payload,
            slot: 100n,
            callIdx: 3,
            timestamp: { seconds: 2n, nanos: 50 },
            programIdx: 4,
            feePayer: { value: new Uint8Array(32).fill(0xcc) },
            blockOffset: 3,
            blockTimestamp: { seconds: 1n, nanos: 7 },
        });

        const event = ChainEvent.fromStream(proto);

        expect(event.id).toBe("tsSignatureExample:100:3:3:0");
        expect(event.transactionSignature?.length).toBe(64);
        expect(event.program?.length).toBe(32);
        expect(event.payload).toEqual(payload);
        expect(event.timestampNs).toBe(2n * 1_000_000_000n + 50n);
        expect(event.blockTimestampNs).toBe(1n * 1_000_000_000n + 7n);
        expect(event.programIndex).toBe(4);
        expect(event.feePayer).toEqual(new Uint8Array(32).fill(0xcc));
        expect(event.blockOffset).toBe(3);

        const noBlock = ChainEvent.fromStream(create(StreamEventsResponseSchema, { eventId: "a:1:2:3" }));
        expect(noBlock.blockTimestampNs).toBeUndefined();

        payload[0] = 0;
        expect(event.payload?.[0]).toBe(9);
    });

    /* Slot 100, block offset 7, call 3; the ids below encode the same values. */
    const streamEvent = (eventId: string) =>
        ChainEvent.fromStream(create(StreamEventsResponseSchema, { eventId, slot: 100n, blockOffset: 7, callIdx: 3 }));

    it("keeps the stream event id as sent", () => {
        expect(streamEvent("tsSignatureExample:100:7:3:0").id).toBe("tsSignatureExample:100:7:3:0");
        expect(streamEvent("tsSignatureExample:100:7:3:1").id).toBe("tsSignatureExample:100:7:3:1");

        const fourPart = ChainEvent.fromStream(
            create(StreamEventsResponseSchema, { eventId: "tsSignatureExample:100:3:0", slot: 100n, callIdx: 3 }),
        );
        expect(fourPart.id).toBe("tsSignatureExample:100:3:0");
    });

    it("gives a streamed event the id of its query row", () => {
        const eventId = "tsSignatureExample:100:7:3:1";
        const streamed = streamEvent(eventId);
        const queried = ChainEvent.fromQuery(
            create(EventSchema, { eventId, slot: 100n, blockOffset: 7, callIdx: 3 }),
        );

        expect(streamed.id).toBe(queried.id);
    });
});
