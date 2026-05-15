import { create } from "@bufbuild/protobuf";
import {
  EventSchema,
  ListEventsResponseSchema,
  PageResponseSchema,
  type ListEventsRequest,
  type StreamEventsRequest,
  type StreamEventsResponse,
  StreamEventsResponseSchema,
} from "@thru/proto";
import { describe, expect, test } from "vitest";
import type { EventSource } from "../chain-client";
import { createEventReplay } from "./event-replay";

describe("event replay", () => {
  test("uses checkpoint event ids to resume after the committed event", async () => {
    const listFilters: string[] = [];
    const streamFilters: string[] = [];
    const client: EventSource = {
      async listEvents(request: Partial<ListEventsRequest>) {
        listFilters.push(request.filter?.expression ?? "");
        return create(ListEventsResponseSchema, {
          events: [
            create(EventSchema, {
              eventId: "ts42_7_4",
              slot: 42n,
              blockOffset: 7,
              callIdx: 4,
            }),
          ],
          page: create(PageResponseSchema, {}),
        });
      },
      streamEvents(request: Partial<StreamEventsRequest>) {
        streamFilters.push(request.filter?.expression ?? "");
        return emptyStream();
      },
    };

    const replay = createEventReplay({
      client,
      startSlot: 42n,
      resumeAfter: { slot: 42n, eventId: "ts42_7_3" },
      resubscribeOnEnd: false,
    });

    const eventIds: string[] = [];
    for await (const event of replay) eventIds.push(event.eventId);

    expect(eventIds).toEqual(["ts42_7_4"]);
    expect(listFilters[0]).toBe(checkpointBoundaryFilter);
    expect(streamFilters[0]).toBe("event.slot >= uint(42)");
  });

  test("filters checkpoint-slot live events before the committed event", async () => {
    const streamFilters: string[] = [];
    const client: EventSource = {
      async listEvents() {
        return create(ListEventsResponseSchema, {
          page: create(PageResponseSchema, {}),
        });
      },
      streamEvents(request: Partial<StreamEventsRequest>) {
        streamFilters.push(request.filter?.expression ?? "");
        return streamEvents(
          "ts42_7_2",
          "ts42_7_3",
          "ts42_7_4",
          "ts42_8_0",
          "ts43_0_0"
        );
      },
    };

    const replay = createEventReplay({
      client,
      startSlot: 42n,
      resumeAfter: { slot: 42n, eventId: "ts42_7_3" },
      resubscribeOnEnd: false,
    });

    const eventIds: string[] = [];
    for await (const event of replay) eventIds.push(event.eventId);

    expect(eventIds).toEqual(["ts42_7_4", "ts42_8_0", "ts43_0_0"]);
    expect(streamFilters[0]).toBe("event.slot >= uint(42)");
  });

  test("falls back to slot-only resume when the checkpoint event id is not parseable", async () => {
    const listFilters: string[] = [];
    const streamFilters: string[] = [];
    const client: EventSource = {
      async listEvents(request: Partial<ListEventsRequest>) {
        listFilters.push(request.filter?.expression ?? "");
        return create(ListEventsResponseSchema, {
          page: create(PageResponseSchema, {}),
        });
      },
      streamEvents(request: Partial<StreamEventsRequest>) {
        streamFilters.push(request.filter?.expression ?? "");
        return emptyStream();
      },
    };

    const replay = createEventReplay({
      client,
      startSlot: 42n,
      resumeAfter: { slot: 42n, eventId: "legacy-event-id" },
      resubscribeOnEnd: false,
    });

    for await (const _event of replay) {
      throw new Error("expected replay to be empty");
    }

    expect(listFilters[0]).toBe("event.slot >= uint(42)");
    expect(streamFilters[0]).toBe("event.slot >= uint(42)");
  });
});

function emptyStream(): AsyncIterable<never> {
  return {
    [Symbol.asyncIterator]: async function* () {},
  };
}

const checkpointBoundaryFilter =
  "event.slot > uint(42) || " +
  "(event.slot == uint(42) && " +
  "(event.block_offset > uint(7) || " +
  "(event.block_offset == uint(7) && event.call_idx > uint(3))))";

function streamEvents(...eventIds: string[]): AsyncIterable<StreamEventsResponse> {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const eventId of eventIds) {
        const match = /^ts(\d+)_(\d+)_(\d+)$/.exec(eventId);
        if (!match) throw new Error(`invalid test event id: ${eventId}`);
        const [, slot, , callIdx] = match;
        yield create(StreamEventsResponseSchema, {
          eventId,
          slot: BigInt(slot),
          callIdx: Number(callIdx),
        });
      }
    },
  };
}
