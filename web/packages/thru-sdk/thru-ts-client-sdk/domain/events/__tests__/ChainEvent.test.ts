import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { EventSchema } from "../../../proto/thru/services/v1/query_service_pb";
import { StreamEventsResponseSchema } from "../../../proto/thru/services/v1/streaming_service_pb";
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
        expect(event.timestampNs).toBeUndefined();
    });

    it("creates from stream response and copies buffers", () => {
        const payload = new Uint8Array([9, 8, 7]);
        const proto = create(StreamEventsResponseSchema, {
            eventId: "tsSignatureExample:100:3:0:taProgramAddress",
            signature: { value: new Uint8Array(64).fill(0xaa) },
            program: { value: new Uint8Array(32).fill(0xbb) },
            payload,
            slot: 100n,
            callIdx: 3,
            timestamp: { seconds: 2n, nanos: 50 },
        });

        const event = ChainEvent.fromStream(proto);

        expect(event.id).toBe("tsSignatureExample:100:3:0");
        expect(event.transactionSignature?.length).toBe(64);
        expect(event.program?.length).toBe(32);
        expect(event.payload).toEqual(payload);
        expect(event.timestampNs).toBe(2n * 1_000_000_000n + 50n);

        payload[0] = 0;
        expect(event.payload?.[0]).toBe(9);
    });
});
