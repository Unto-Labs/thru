import { create } from "@bufbuild/protobuf";
import {
  type Event,
  EventSchema,
  ListEventsResponseSchema,
  PageResponseSchema,
  type ListEventsRequest,
  type StreamEventsRequest,
  type StreamEventsResponse,
  StreamEventsResponseSchema,
} from "@thru/sdk/proto";
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
              eventId: "sig:42:7:3:1",
              slot: 42n,
              blockOffset: 7,
              callIdx: 3,
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
      resumeAfter: { slot: 42n, eventId: "sig:42:7:3:0" },
      resubscribeOnEnd: false,
    });

    const eventIds: string[] = [];
    for await (const event of replay) eventIds.push(event.eventId);

    expect(eventIds).toEqual(["sig:42:7:3:1"]);
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
          "sig:42:7:3:0",
          "sig:42:7:3:1",
          "sig:42:8:0:0",
          "sig:43:0:0:0"
        );
      },
    };

    const replay = createEventReplay({
      client,
      startSlot: 42n,
      resumeAfter: { slot: 42n, eventId: "sig:42:7:3:0" },
      resubscribeOnEnd: false,
    });

    const eventIds: string[] = [];
    for await (const event of replay) eventIds.push(event.eventId);

    expect(eventIds).toEqual(["sig:42:7:3:1", "sig:42:8:0:0", "sig:43:0:0:0"]);
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
      resumeAfter: { slot: 42n, eventId: "malformed-event-id" },
      resubscribeOnEnd: false,
    });

    for await (const _event of replay) {
      throw new Error("expected replay to be empty");
    }

    expect(listFilters[0]).toBe("event.slot >= uint(42)");
    expect(streamFilters[0]).toBe("event.slot >= uint(42)");
  });

  test("fails before emitting checkpoints when backfill pages regress", async () => {
    const client = new DescendingEventSource([
      makeEvent(4n, "D"),
      makeEvent(3n, "C"),
      makeEvent(2n, "B"),
      makeEvent(1n, "A"),
    ]);

    const replay = createEventReplay({
      client,
      startSlot: 0n,
      safetyMargin: 1n,
      pageSize: 2,
      resubscribeOnEnd: false,
    });

    await expect(collectEventIds(replay)).rejects.toThrow(
      "backfill source returned a page that is not ordered by ascending slot"
    );
  });

  test("fails before emitting checkpoints when backfill pages are cross-page regressive", async () => {
    const client = new DescendingEventSource([
      makeEvent(4n, "D"),
      makeEvent(5n, "E"),
      makeEvent(2n, "B"),
      makeEvent(3n, "C"),
    ]);

    const replay = createEventReplay({
      client,
      startSlot: 0n,
      safetyMargin: 1n,
      pageSize: 2,
      resubscribeOnEnd: false,
    });

    await expect(collectEventIds(replay)).rejects.toThrow(
      "backfill source returned pages out of ascending slot order"
    );
  });
});

function emptyStream(): AsyncIterable<never> {
  return {
    [Symbol.asyncIterator]: async function* () {},
  };
}

class DescendingEventSource implements EventSource {
  constructor(private readonly events: Event[]) {}

  async listEvents(request: Partial<ListEventsRequest>) {
    const startIdx = request.page?.pageToken ? Number(request.page.pageToken) : 0;
    const pageSize = request.page?.pageSize ?? this.events.length;
    const slice = this.events.slice(startIdx, startIdx + pageSize);
    const nextIndex = startIdx + slice.length;
    const nextPageToken = nextIndex < this.events.length ? String(nextIndex) : undefined;

    return create(ListEventsResponseSchema, {
      events: slice,
      page: create(PageResponseSchema, { nextPageToken }),
    });
  }

  streamEvents(_request: Partial<StreamEventsRequest>) {
    return emptyStream();
  }
}

function makeEvent(slot: bigint, id: string): Event {
  return create(EventSchema, { slot, eventId: id });
}

async function collectEventIds(events: AsyncIterable<Event>): Promise<string[]> {
  const eventIds: string[] = [];
  for await (const event of events) eventIds.push(event.eventId);
  return eventIds;
}

const checkpointBoundaryFilter =
  "event.slot > uint(42) || " +
  "(event.slot == uint(42) && " +
  "(event.block_offset > uint(7) || " +
  "(event.block_offset == uint(7) && event.call_idx >= uint(3))))";

function streamEvents(...eventIds: string[]): AsyncIterable<StreamEventsResponse> {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const eventId of eventIds) {
        const match = /^sig:(\d+):(\d+):(\d+):(\d+)$/.exec(eventId);
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
