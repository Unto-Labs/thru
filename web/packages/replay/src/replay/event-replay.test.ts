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
import { describe, expect, test, vi } from "vitest";
import type { EventSource } from "../chain-client";
import { createEventReplay } from "./event-replay";

describe("event replay", () => {
  test.each([NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid payload limit %s before creating a client', maxEventBytes => {
    expect(() => createEventReplay({ startSlot: 0n, maxEventBytes, clientFactory: () => { throw new Error('must not start'); } })).toThrow('byte bound');
  });

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

  test("live events carry the query metadata, with block time as their timestamp", async () => {
    const feePayer = { value: new Uint8Array(32).fill(3) };
    const blockTimestamp = { seconds: 1_700_000_000n, nanos: 5 };
    const client: EventSource = {
      async listEvents() {
        return create(ListEventsResponseSchema, { page: create(PageResponseSchema, {}) });
      },
      streamEvents() {
        return {
          [Symbol.asyncIterator]: async function* () {
            yield create(StreamEventsResponseSchema, {
              eventId: "sig:42:7:3:0",
              slot: 42n,
              callIdx: 3,
              programIdx: 1,
              blockOffset: 7,
              feePayer,
              timestamp: { seconds: 1_800_000_000n, nanos: 0 },
              blockTimestamp,
            });
            /* A node without block_timestamp: no publish-time substitute. */
            yield create(StreamEventsResponseSchema, {
              eventId: "sig:43:0:0:0",
              slot: 43n,
              timestamp: { seconds: 1_800_000_000n, nanos: 0 },
            });
          },
        };
      },
    };

    const replay = createEventReplay({ client, startSlot: 42n, resubscribeOnEnd: false });
    const events: Event[] = [];
    for await (const event of replay) events.push(event);

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      eventId: "sig:42:7:3:0",
      programIdx: 1,
      blockOffset: 7,
      feePayer: { value: feePayer.value },
      timestamp: { seconds: blockTimestamp.seconds, nanos: blockTimestamp.nanos },
    });
    expect(events[1]!.timestamp).toBeUndefined();
    expect(events[1]!.programIdx).toBeUndefined();
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

describe("parallel history backfill", () => {
  test("emits every event once, in slot order, through the live switch when ranges finish out of order", async () => {
    const events = eventsAtSlots(slotsEvery(97n, 100_000n), 2);
    const lastHistory = events[events.length - 1]!;
    const chain = new FakeChain(events, [100_000n]);
    chain.delayMs = (client) => client % 3;
    chain.live = () => liveStream(lastHistory.slot!, 100_001n);

    const ids = await collectEventIds(
      createEventReplay({ clientFactory: chain.clientFactory, startSlot: 0n, resubscribeOnEnd: false, historyConnections: 16 })
    );

    expect(chain.answeredInSlotOrder()).toBe(false);
    expect(ids).toEqual([...events.map((event) => event.eventId), "sig:100001:0:0:0"]);
    expect(chain.clients.map((client) => client.closed)).toEqual(Array(17).fill(true));
  });

  test("reads the slots near head sequentially, so events the node indexes late are still emitted", async () => {
    const chain = new FakeChain(eventsAtSlots([5_000n, 89_999n, 90_000n, 99_995n, 99_999n]), [100_000n]);
    chain.visibleThrough = 99_990n;
    // The node indexes its newest slots only after the range readers finish.
    chain.onClose = () => {
      chain.visibleThrough = undefined;
    };

    const ids = await collectEventIds(
      createEventReplay({ clientFactory: chain.clientFactory, startSlot: 0n, resubscribeOnEnd: false, historyConnections: 16 })
    );

    expect(ids).toEqual([
      "sig:5000:0:0:0",
      "sig:89999:0:0:0",
      "sig:90000:0:0:0",
      "sig:99995:0:0:0",
      "sig:99999:0:0:0",
    ]);
  });

  test("honors resumeAfter in every range", async () => {
    const chain = new FakeChain(
      [
        makeIndexedEvent(100n, 0),
        makeIndexedEvent(200n, 0),
        makeIndexedEvent(200n, 2),
        makeIndexedEvent(300n, 0),
        makeIndexedEvent(50_000n, 0),
        makeIndexedEvent(95_000n, 0),
      ],
      [100_000n],
    );

    const ids = await collectEventIds(
      createEventReplay({
        clientFactory: chain.clientFactory,
        startSlot: 0n,
        resumeAfter: { slot: 200n, eventId: "sig:200:0:1:0" },
        resubscribeOnEnd: false,
      })
    );

    expect(ids).toEqual(["sig:200:0:2:0", "sig:300:0:0:0", "sig:50000:0:0:0", "sig:95000:0:0:0"]);
  });

  test("abort stops the range readers and closes every pool connection", async () => {
    const chain = new FakeChain(eventsAtSlots([50_000n]), [100_000n]);
    chain.hold = () => new Promise<void>(() => {});
    const controller = new AbortController();

    const done = collectEventIds(
      createEventReplay({
        historyConnections: 16,
        clientFactory: chain.clientFactory,
        startSlot: 0n,
        resubscribeOnEnd: false,
        signal: controller.signal,
      })
    );
    await vi.waitFor(() => expect(chain.calls).toHaveLength(16));
    controller.abort();

    expect(await done).toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(chain.calls).toHaveLength(16);
    expect(chain.clients.map((client) => client.closed)).toEqual(Array(17).fill(true));
  });

  test("a range that keeps failing ends the replay with its error and closes the pool", async () => {
    vi.useFakeTimers();
    try {
      const chain = new FakeChain(eventsAtSlots([50_000n]), [100_000n]);
      // Client 1 reads the first range and never answers; client 2 reads the second and fails.
      chain.hold = (client) =>
        client === 1 ? new Promise<void>(() => {}) : client === 2 ? Promise.reject(new Error("range unavailable")) : undefined;

      const outcome = collectEventIds(
        createEventReplay({
          clientFactory: chain.clientFactory,
          startSlot: 0n,
          resubscribeOnEnd: false,
          historyConnections: 4,
        })
      ).then(
        () => "completed",
        (err: Error) => err.message,
      );
      await vi.advanceTimersByTimeAsync(30_000);

      expect(await outcome).toBe("range unavailable");
      const callsAtFailure = chain.calls.length;
      await vi.advanceTimersByTimeAsync(30_000);
      expect(chain.calls).toHaveLength(callsAtFailure);
      expect(chain.clients.map((client) => client.closed)).toEqual([true, true, true, true, true]);
    } finally {
      vi.useRealTimers();
    }
  });

  test("a reconnect reads its gap sequentially on one new connection", async () => {
    vi.useFakeTimers();
    try {
      // By the time the stream drops, head is 210,000 slots past the last event.
      const chain = new FakeChain(eventsAtSlots([190_001n]), [190_010n, 400_000n]);
      chain.live = (subscription) => ({
        [Symbol.asyncIterator]: async function* () {
          if (subscription === 0) {
            yield* liveStream(190_002n);
            throw new Error("stream reset");
          }
          yield* liveStream(190_003n);
        },
      });

      const ids: string[] = [];
      const done = (async () => {
        for await (const event of createEventReplay({ clientFactory: chain.clientFactory, startSlot: 190_000n, historyConnections: 16 })) {
          ids.push(event.eventId);
          if (ids.length === 3) break;
        }
      })();
      await vi.advanceTimersByTimeAsync(5_000);
      await done;

      expect(ids).toEqual(["sig:190001:0:0:0", "sig:190002:0:0:0", "sig:190003:0:0:0"]);
      expect(chain.clients).toHaveLength(2);
      expect(chain.heightCalls).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  test("starts no range while maxBufferedItems history events wait for hand-off", async () => {
    const events = eventsAtSlots(slotsEvery(44n, 3_520n), 10);
    const chain = new FakeChain(events, [100_000n]);
    let releaseFirstRange: () => void = () => {};
    const firstRange = new Promise<void>((resolve) => {
      releaseFirstRange = resolve;
    });
    chain.hold = (client) => (client === 1 ? firstRange : undefined);

    const done = collectEventIds(
      createEventReplay({
        clientFactory: chain.clientFactory,
        startSlot: 0n,
        resubscribeOnEnd: false,
        historyConnections: 4,
        maxBufferedItems: 50,
      })
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    const startsOverBound = chain.calls.filter((call) => call.firstPage && call.client > 0 && call.returnedBefore >= 50);
    releaseFirstRange();

    expect(startsOverBound).toEqual([]);
    expect(await done).toEqual(events.map((event) => event.eventId));
  });

  test("ranges behind the one being handed off stop paging while maxBufferedItems events wait", async () => {
    // Sixteen ranges (88 slots each below head - 10,000) of three full 1,000-event pages.
    const events = eventsAtSlots(Array.from({ length: 16 }, (_, range) => BigInt(range) * 88n), 3_000);
    const chain = new FakeChain(events, [100_000n]);

    const ids: string[] = [];
    let peakUnemitted = 0;
    for await (const event of createEventReplay({
      clientFactory: chain.clientFactory,
      startSlot: 0n,
      resubscribeOnEnd: false,
      historyConnections: 8,
      maxBufferedItems: 1_500,
    })) {
      peakUnemitted = Math.max(peakUnemitted, chain.returned - ids.length);
      ids.push(event.eventId);
    }

    expect(ids).toEqual(events.map((event) => event.eventId));
    // maxBufferedItems, one in-flight page per connection, the page being emitted,
    // and the next page, which ReplayStream holds to check page order.
    expect(peakUnemitted).toBeLessThanOrEqual(1_500 + 8 * 1_000 + 2 * 1_000);
  });
});

describe("parallel history range sizing", () => {
  // Ranges read concurrently must not compound growth: a short empty start leaves ranges small.
  test.each([
    [20n, 0],
    [40_000n, 8],
  ])("after %s empty slots, oversizes at most %s ranges, then reads about a page per range", async (from, oversized) => {
    // 50 events per slot: a fixed 1/1024 range (88 slots) would hold five pages.
    const events = eventsAtSlots(slotsEvery(1n, 880n).map((slot) => slot + from), 50);
    const chain = new FakeChain(events, [100_000n]);

    const ids = await collectEventIds(
      createEventReplay({ clientFactory: chain.clientFactory, startSlot: 0n, resubscribeOnEnd: false, historyConnections: 8, maxBufferedItems: 8_000 })
    );

    const pages = new Map<bigint, number>();
    for (const call of chain.calls) if (call.low !== undefined && call.low >= from && call.low < from + 880n) pages.set(call.low, (pages.get(call.low) ?? 0) + 1);
    const perRange = [...pages].sort(([a], [b]) => (a < b ? -1 : 1)).map(([, n]) => n);
    expect(ids).toEqual(events.map((event) => event.eventId));
    expect(perRange.filter((n) => n > 2).length).toBeLessThanOrEqual(oversized);
    expect(perRange.slice(oversized).every((n) => n <= 2)).toBe(true);
    expect(perRange.slice(oversized).length).toBeGreaterThan(5);
  });

  test("emits every event once, in order, while density shifts between dense, sparse and empty stretches", async () => {
    let seed = 7;
    const random = () => (seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648) / 2_147_483_648;
    const slots: bigint[] = [];
    for (let slot = 0n; slot < 90_000n; slot += 1n) {
      const stretch = Number(slot / 3_000n) % 3;
      if (stretch === 0 ? slot % 3_000n < 300n : stretch === 1 && random() < 0.01) slots.push(slot);
    }
    const events = slots.flatMap((slot) => eventsAtSlots([slot], 1 + Math.floor(random() * 40)));
    const chain = new FakeChain(events, [100_000n]);
    chain.delayMs = () => Math.floor(random() * 3);

    const ids = await collectEventIds(
      createEventReplay({ clientFactory: chain.clientFactory, startSlot: 0n, resubscribeOnEnd: false, historyConnections: 8, maxBufferedItems: 4_000 })
    );

    expect(chain.answeredInSlotOrder()).toBe(false);
    expect(ids).toEqual(events.map((event) => event.eventId));
  });

  test("reads the tail from head - 10,000 once the ranges are handed back", async () => {
    const events = eventsAtSlots(slotsEvery(50n, 100_000n), 30);
    const chain = new FakeChain(events, [100_000n]);

    const ids = await collectEventIds(
      createEventReplay({ clientFactory: chain.clientFactory, startSlot: 0n, resubscribeOnEnd: false, historyConnections: 8, maxBufferedItems: 4_000 })
    );

    const tailLows = chain.calls.filter((call) => call.high === undefined).map((call) => call.low);
    expect(ids).toEqual(events.map((event) => event.eventId));
    expect(tailLows[0]).toBe(90_000n);
    expect(chain.calls.filter((call) => call.high !== undefined && call.low! >= 90_000n)).toEqual([]);
  });

  test("keeps ranges of 1/1024 of sparse history", async () => {
    const events = eventsAtSlots(slotsEvery(5_000n, 90_000n));
    const chain = new FakeChain(events, [100_000n]);

    const ids = await collectEventIds(
      createEventReplay({ clientFactory: chain.clientFactory, startSlot: 0n, resubscribeOnEnd: false, historyConnections: 8 })
    );

    const lows = chain.calls.flatMap((call) => (call.firstPage && call.low !== undefined && call.low < 90_000n ? [call.low] : []));
    lows.sort((a, b) => (a < b ? -1 : 1));
    expect(ids).toEqual(events.map((event) => event.eventId));
    expect(lows.at(-1)! - lows.at(-2)!).toBe(88n);
    expect(lows.length).toBeLessThan(1_100);
  });
});

describe("parallel history backpressure", () => {
  test("a stalled consumer stops every range, including the one being handed off", async () => {
    // Three ranges of ten 1,000-event pages each.
    const events = eventsAtSlots([0n, 88n, 176n], 10_000);
    const chain = new FakeChain(events, [100_000n]);
    const iterator = createEventReplay({
      clientFactory: chain.clientFactory,
      startSlot: 0n,
      resubscribeOnEnd: false,
      historyConnections: 8,
      maxBufferedItems: 1_500,
    })[Symbol.asyncIterator]();

    const first = await iterator.next();
    await new Promise((resolve) => setTimeout(resolve, 200));
    const returnedWhileStalled = chain.returned;
    const ids = [first.value!.eventId];
    for (let result = await iterator.next(); !result.done; result = await iterator.next()) ids.push(result.value.eventId);

    // maxBufferedItems, one in-flight page per connection, and one unread page per range.
    expect(returnedWhileStalled).toBeLessThanOrEqual(1_500 + 3 * 1_000 + 3 * 1_000);
    expect(ids).toEqual(events.map((event) => event.eventId));
  });
});

describe("parallel history height", () => {
  test("reads history sequentially when the height lookup fails", async () => {
    const events = eventsAtSlots(Array.from({ length: 6 }, (_, i) => BigInt(i) * 50_000n), 3);
    const chain = new FakeChain(events, [400_000n]);
    chain.heightError = new Error("GetHeight unavailable");

    const ids = await collectEventIds(
      createEventReplay({ clientFactory: chain.clientFactory, startSlot: 0n, resubscribeOnEnd: false, historyConnections: 16 })
    );

    expect(ids).toEqual(events.map((event) => event.eventId));
    expect(chain.clients).toHaveLength(1);
  });
});

describe("parallel history stop", () => {
  test("an abort while later ranges are paused ends the replay without spinning", async () => {
    const events = eventsAtSlots(Array.from({ length: 16 }, (_, range) => BigInt(range) * 88n), 3_000);
    const chain = new FakeChain(events, [100_000n]);
    const controller = new AbortController();
    let seen = 0;

    for await (const _event of createEventReplay({
      clientFactory: chain.clientFactory,
      startSlot: 0n,
      resubscribeOnEnd: false,
      historyConnections: 8,
      maxBufferedItems: 1_500,
      signal: controller.signal,
    })) {
      if (++seen === 100) controller.abort();
    }
    const callsAtEnd = chain.calls.length;
    /* A paused range spinning on microtasks would starve this timer. */
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(seen).toBeLessThan(events.length);
    expect(chain.calls.length).toBe(callsAtEnd);
    expect(chain.clients.map((client) => client.closed)).toEqual(chain.clients.map(() => true));
  });
});

/* A ListEvents node: evaluates the replay's slot, block_offset and call_idx
   filters, orders by slot, caps pages at 1,000, and pages by position. */
class FakeChain {
  readonly clients: Array<{ closed: boolean }> = [];
  readonly calls: Array<{ client: number; low?: bigint; high?: bigint; firstPage: boolean; returnedBefore: number }> = [];
  heightCalls = 0;
  heightError?: Error;
  visibleThrough?: bigint;
  delayMs: (client: number) => number = () => 0;
  hold: (client: number) => Promise<void> | undefined = () => undefined;
  onClose: () => void = () => {};
  live: (subscription: number) => AsyncIterable<StreamEventsResponse> = () => emptyStream();
  /* Events every ListEvents answer has carried so far. */
  returned = 0;
  private readonly answeredLows: bigint[] = [];
  private subscriptions = 0;

  constructor(
    private readonly events: Event[],
    private readonly heights: bigint[],
  ) {}

  answeredInSlotOrder(): boolean {
    return this.answeredLows.every((low, idx) => idx === 0 || low >= this.answeredLows[idx - 1]!);
  }

  readonly clientFactory = (): EventSource => {
    const chain = this;
    const client = this.clients.length;
    const state = { closed: false };
    const pending = new Set<() => void>();
    this.clients.push(state);
    return {
      async getHeight() {
        if (chain.heightError) throw chain.heightError;
        const finalized = chain.heights[Math.min(chain.heightCalls, chain.heights.length - 1)]!;
        chain.heightCalls += 1;
        return { finalized };
      },
      close() {
        state.closed = true;
        for (const cancel of pending) cancel();
        chain.onClose();
      },
      streamEvents() {
        return chain.live(chain.subscriptions++);
      },
      async listEvents(request: Partial<ListEventsRequest>, options?: { signal?: AbortSignal }) {
        const expression = request.filter?.expression ?? "";
        const lowMatch = /event\.slot >= uint\((\d+)\)/.exec(expression);
        const low = lowMatch ? BigInt(lowMatch[1]!) : undefined;
        const highMatch = /event\.slot < uint\((\d+)\)/.exec(expression);
        const high = highMatch ? BigInt(highMatch[1]!) : undefined;
        chain.calls.push({ client, low, high, firstPage: !request.page?.pageToken, returnedBefore: chain.returned });
        await new Promise<void>((resolve, reject) => {
          const cancel = () => reject(new DOMException("This operation was aborted", "AbortError"));
          if (state.closed || options?.signal?.aborted) return cancel();
          options?.signal?.addEventListener("abort", cancel, { once: true });
          pending.add(cancel);
          const delay = chain.delayMs(client);
          const ready = chain.hold(client) ?? (delay ? new Promise((done) => setTimeout(done, delay)) : Promise.resolve());
          ready.then(() => resolve(), reject);
        });
        if (low !== undefined) chain.answeredLows.push(low);
        return chain.page(expression, request.page?.pageSize, request.page?.pageToken);
      },
    } as EventSource;
  };

  private page(expression: string, pageSize = 1000, pageToken?: string) {
    const matches = compileFilter(expression);
    const limit = Math.min(pageSize || 1000, 1000);
    const page: Event[] = [];
    let last = pageToken ? Number(pageToken) : -1;
    for (let idx = last + 1; idx < this.events.length; idx += 1) {
      const event = this.events[idx]!;
      if (this.visibleThrough !== undefined && event.slot! > this.visibleThrough) break;
      if (!matches(event)) continue;
      if (page.length === limit) return this.response(page, String(last));
      page.push(event);
      last = idx;
    }
    return this.response(page, "");
  }

  private response(events: Event[], nextPageToken: string) {
    this.returned += events.length;
    return create(ListEventsResponseSchema, { events, page: create(PageResponseSchema, { nextPageToken }) });
  }
}

function compileFilter(expression: string): (event: Event) => boolean {
  const js = expression
    .replace(/uint\((\d+)\)/g, "$1n")
    .replace(/event\.slot/g, "e.slot")
    .replace(/event\.block_offset/g, "BigInt(e.blockOffset)")
    .replace(/event\.call_idx/g, "BigInt(e.callIdx)");
  return new Function("e", `return ${js || "true"};`) as (event: Event) => boolean;
}

function slotsEvery(step: bigint, end: bigint): bigint[] {
  const slots: bigint[] = [];
  for (let slot = 0n; slot < end; slot += step) slots.push(slot);
  return slots;
}

function eventsAtSlots(slots: bigint[], perSlot = 1): Event[] {
  return slots.flatMap((slot) => Array.from({ length: perSlot }, (_, call) => makeIndexedEvent(slot, call)));
}

function makeIndexedEvent(slot: bigint, callIdx: number): Event {
  return create(EventSchema, { eventId: `sig:${slot}:0:${callIdx}:0`, slot, blockOffset: 0, callIdx });
}

function liveStream(...slots: bigint[]): AsyncIterable<StreamEventsResponse> {
  return streamEvents(...slots.map((slot) => `sig:${slot}:0:0:0`));
}

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
