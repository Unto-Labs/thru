import { create } from "@bufbuild/protobuf";
import { describe, expect, test, vi } from "vitest";
import {
  type Transaction,
  TransactionSchema,
  SignatureSchema,
  BlockSchema,
  BlockHeaderSchema,
  ListBlocksResponseSchema,
  PageResponseSchema,
  StreamBlocksResponseSchema,
} from "@thru/sdk/proto";
import { AsyncQueue } from "./async-queue";
import { createBlockReplay } from "./replay/block-replay";
import { createEventReplay } from "./replay/event-replay";
import { createTransactionReplay } from "./replay/transaction-replay";
import { ReplayStream } from "./replay-stream";
import { DEFAULT_RETRY_CONFIG } from "./retry";
import { SimulatedChain } from "./testing/simulated-chain";
import { SimulatedTransactionSource } from "./testing/simulated-transaction-source";
import type { ReplayLogger, Slot } from "./types";

const slotRange = (start: number, end: number): Slot[] => {
  const slots: Slot[] = [];
  for (let slot = start; slot < end; slot += 1) slots.push(BigInt(slot));
  return slots;
};

const extractSlots = (values: Slot[]): number[] => values.map((slot) => Number(slot));

describe("block replay", () => {
  test("backfills and switches to streaming without gaps", async () => {
    const chain = new SimulatedChain({
      historySlots: slotRange(100, 150),
      liveSlots: slotRange(150, 165),
      pageDelayMs: 2,
      streamDelayMs: 0,
    });
    const logger = createMockLogger();

    const replay = createBlockReplay({
      client: chain,
      startSlot: 100n,
      safetyMargin: 4n,
      pageSize: 7,
      resubscribeOnEnd: false,
      logger,
    });

    const received: Slot[] = [];
    for await (const block of replay) received.push(block.header?.slot ?? 0n);

    expect(extractSlots(received)).toEqual(
      Array.from({ length: 65 }, (_, idx) => 100 + idx),
    );
    const metrics = replay.getMetrics();
    expect(metrics.emittedBackfill).toBe(50);
    expect(metrics.emittedLive).toBe(15);
    expect(metrics.discardedDuplicates).toBe(0);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  test("drops overlapping live slots during switch", async () => {
    /* liveYieldsSynchronously guarantees the LivePump buffer is fully populated
       before backfill's first paginated listBlocks call resolves. Without it,
       streamDelayMs:0 was a setTimeout(0) macrotask that could interleave with
       backfill's setTimeout pages, making the discardedDuplicates count flaky
       under CI event-loop pressure. */
    const chain = new SimulatedChain({
      historySlots: slotRange(200, 240),
      liveSlots: slotRange(230, 255),
      pageDelayMs: 3,
      liveYieldsSynchronously: true,
    });

    const replay = createBlockReplay({
      client: chain,
      startSlot: 200n,
      safetyMargin: 5n,
      pageSize: 8,
      resubscribeOnEnd: false,
    });

    const received: Slot[] = [];
    for await (const block of replay) received.push(block.header?.slot ?? 0n);

    expect(extractSlots(received)).toEqual(
      Array.from({ length: 55 }, (_, idx) => 200 + idx),
    );
    const metrics = replay.getMetrics();
    expect(metrics.discardedDuplicates).toBe(10);
    expect(metrics.emittedLive).toBe(25 - 10);
  });

  test("recovers from live stream failure", async () => {
    const chain = new SimulatedChain({
      historySlots: slotRange(0, 20),
      liveSlots: slotRange(20, 40),
      pageDelayMs: 0,
      streamDelayMs: 2,
      streamErrorAfter: 5,
    });
    const logger = createMockLogger();

    const replay = createBlockReplay({
      client: chain,
      startSlot: 0n,
      safetyMargin: 3n,
      pageSize: 5,
      logger,
    });

    const received: Slot[] = [];
    for await (const block of replay) {
      received.push(block.header?.slot ?? 0n);
      if (received.length === 40) break;
    }

    expect(extractSlots(received)).toEqual(
      Array.from({ length: 40 }, (_, idx) => idx),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      "Replay stream reconnect started",
      expect.objectContaining({
        event: "replay.stream.reconnect.started",
        attempt: 1,
      })
    );
    expect(logger.info).toHaveBeenCalledWith(
      "Replay stream reconnect cleanup started",
      expect.objectContaining({ event: "replay.stream.reconnect.cleanup_started" })
    );
    expect(logger.info).toHaveBeenCalledWith(
      "Replay stream reconnect cleanup completed",
      expect.objectContaining({ event: "replay.stream.reconnect.cleanup_completed" })
    );
    expect(logger.info).toHaveBeenCalledWith(
      "Replay stream waiting for first event",
      expect.objectContaining({ event: "replay.stream.waiting_first_event" })
    );
    expect(logger.info).toHaveBeenCalledWith(
      "Replay stream reconnect completed",
      expect.objectContaining({ event: "replay.stream.reconnect.completed" })
    );
  });

  test("reconnect keeps an item published while it catches up", async () => {
    /* Like StreamEvents, a subscription sees only items published after it
       opens; like ListEvents, the catch-up read can't see the newest item yet.
       Item 4 is published during the reconnect's catch-up read. */
    const published: number[] = [];
    const subscriptions: AsyncQueue<number>[] = [];
    const open = new Set<AsyncQueue<number>>();
    const publish = (item: number) => {
      published.push(item);
      for (const queue of open) queue.push(item);
    };
    const subscribeLive = () => {
      const queue = new AsyncQueue<number>();
      subscriptions.push(queue);
      open.add(queue);
      return {
        [Symbol.asyncIterator]: () => ({
          next: () => queue.next(),
          return: async () => {
            open.delete(queue);
            queue.close();
            return { done: true as const, value: undefined };
          },
        }),
      };
    };

    const replay = new ReplayStream<number>({
      startSlot: 1n,
      safetyMargin: 0n,
      fetchBackfill: async () => {
        [1, 2, 3].forEach(publish);
        return { items: [], done: true };
      },
      subscribeLive,
      extractSlot: (value) => BigInt(value),
      onReconnect: () => ({
        subscribeLive,
        fetchBackfill: async ({ startSlot }) => {
          publish(4);
          setTimeout(() => [5, 6].forEach(publish), 10);
          return { items: published.slice(0, -1).filter((item) => item >= startSlot), done: true };
        },
      }),
    });

    const received: number[] = [];
    for await (const item of replay) {
      received.push(item);
      if (item === 3) subscriptions[0]!.fail(new Error("stream cut"));
      if (item === 6) break;
    }

    expect(received).toEqual([1, 2, 3, 4, 5, 6]);
  });

  test("reconnect keeps an item published before the server accepts the subscription", async () => {
    /* The server sends nothing when it accepts a subscription. This one is
       accepted 50 ms after it opens, and item 4 is published at 10 ms, so only
       a catch-up read taken after that can return it. */
    const published: number[] = [];
    const subscriptions: AsyncQueue<number>[] = [];
    const accepted = new Set<AsyncQueue<number>>();
    const publish = (item: number) => {
      published.push(item);
      for (const queue of accepted) queue.push(item);
    };
    const subscribeLive = () => {
      const queue = new AsyncQueue<number>();
      subscriptions.push(queue);
      if (subscriptions.length === 1) accepted.add(queue);
      else {
        setTimeout(() => publish(4), 10);
        setTimeout(() => accepted.add(queue), 50);
        setTimeout(() => [5, 6].forEach(publish), DEFAULT_RETRY_CONFIG.initialDelayMs + 100);
      }
      return {
        [Symbol.asyncIterator]: () => ({
          next: () => queue.next(),
          return: async () => {
            accepted.delete(queue);
            queue.close();
            return { done: true as const, value: undefined };
          },
        }),
      };
    };
    const fetchBackfill = async ({ startSlot }: { startSlot: Slot }) => (
      { items: published.filter((item) => item >= startSlot), done: true }
    );

    const replay = new ReplayStream<number>({
      startSlot: 1n,
      safetyMargin: 0n,
      fetchBackfill: async () => {
        [1, 2, 3].forEach(publish);
        return { items: [], done: true };
      },
      subscribeLive,
      extractSlot: (value) => BigInt(value),
      onReconnect: () => ({ subscribeLive, fetchBackfill }),
    });

    const received: number[] = [];
    for await (const item of replay) {
      received.push(item);
      if (item === 3) subscriptions[0]!.fail(new Error("stream cut"));
      if (item === 6) break;
    }

    expect(received).toEqual([1, 2, 3, 4, 5, 6]);
  });

  test("resumes streaming when retries grow the backoff past the live buffer", async () => {
    /* 10 items/s against a 15-item buffer, and the stream is cut twice in a
       row, so the second reconnect waits a 2 s backoff. Only 1 s of live items
       may be buffered per reconnect, whatever the backoff. */
    vi.useFakeTimers();
    const controller = new AbortController();
    const logger = createMockLogger();
    const published: number[] = [];
    const open = new Set<AsyncQueue<number>>();
    const subscriptions: AsyncQueue<number>[] = [];
    let next = 1;
    const publisher = setInterval(() => {
      published.push(next);
      for (const queue of open) queue.push(next);
      next += 1;
    }, 100);
    const subscribeLive = () => {
      const queue = new AsyncQueue<number>();
      subscriptions.push(queue);
      if (subscriptions.length === 2) queue.fail(new Error("stream cut again"));
      else open.add(queue);
      return {
        [Symbol.asyncIterator]: () => ({
          next: () => queue.next(),
          return: async () => {
            open.delete(queue);
            queue.close();
            return { done: true as const, value: undefined };
          },
        }),
      };
    };
    const fetchBackfill = async ({ startSlot }: { startSlot: Slot }) => (
      { items: published.filter((item) => item >= startSlot), done: true }
    );

    try {
      const replay = new ReplayStream<number>({
        startSlot: 1n,
        safetyMargin: 0n,
        maxBufferedItems: 15,
        fetchBackfill,
        subscribeLive,
        extractSlot: (value) => BigInt(value),
        logger,
        signal: controller.signal,
        onReconnect: () => ({ subscribeLive, fetchBackfill }),
      });
      const received: number[] = [];
      const consumed = (async () => {
        for await (const item of replay) {
          received.push(item);
          if (item === 3) {
            open.delete(subscriptions[0]!);
            subscriptions[0]!.fail(new Error("stream cut"));
          }
        }
      })();
      for (let elapsed = 0; elapsed < 20_000; elapsed += 100) await vi.advanceTimersByTimeAsync(100);
      controller.abort();
      await vi.advanceTimersByTimeAsync(1000);
      await consumed;

      expect(received.length).toBeGreaterThan(150);
      expect(received).toEqual(Array.from({ length: received.length }, (_, idx) => idx + 1));
      expect(vi.mocked(logger.warn).mock.calls.filter(([message]) => message === "Replay stream reconnect started")).toHaveLength(2);
    } finally {
      clearInterval(publisher);
      vi.useRealTimers();
    }
  });

  test.each([
    /* Item 5 arrives right after the subscription opens, so the live buffer
       shows the first read stopped short. */
    { stream: "busy", live: [[5, 10], [6, DEFAULT_RETRY_CONFIG.initialDelayMs + 1500]], reads: 2 },
    /* Nothing arrives live until after the catch-up, so the empty live buffer
       says nothing about whether history caught up. */
    { stream: "quiet", live: [[5, DEFAULT_RETRY_CONFIG.initialDelayMs + 2500]], reads: 5 },
  ])("reconnect reads history again on a $stream stream when the first read lags", async ({ live, reads }) => {
    /* Item 4 is published during the backoff, before the new subscription
       opens, and the first catch-up read can't see it yet. */
    const published: number[] = [];
    const subscriptions: AsyncQueue<number>[] = [];
    const open = new Set<AsyncQueue<number>>();
    const publish = (item: number) => {
      published.push(item);
      for (const queue of open) queue.push(item);
    };
    const subscribeLive = () => {
      const queue = new AsyncQueue<number>();
      subscriptions.push(queue);
      open.add(queue);
      if (subscriptions.length === 2) {
        for (const [item, delayMs] of live) setTimeout(() => publish(item), delayMs);
      }
      return {
        [Symbol.asyncIterator]: () => ({
          next: () => queue.next(),
          return: async () => {
            open.delete(queue);
            queue.close();
            return { done: true as const, value: undefined };
          },
        }),
      };
    };
    let reconnectReads = 0;
    const fetchBackfill = async ({ startSlot }: { startSlot: Slot }) => {
      reconnectReads += 1;
      const visible = reconnectReads === 1 ? published.filter((item) => item <= 3) : published;
      return { items: visible.filter((item) => item >= startSlot), done: true };
    };

    const replay = new ReplayStream<number>({
      startSlot: 1n,
      safetyMargin: 0n,
      fetchBackfill: async () => {
        [1, 2, 3].forEach(publish);
        return { items: [], done: true };
      },
      subscribeLive,
      extractSlot: (value) => BigInt(value),
      onReconnect: () => ({ subscribeLive, fetchBackfill }),
    });

    const last = live[live.length - 1]![0]!;
    const received: number[] = [];
    for await (const item of replay) {
      received.push(item);
      if (item === 3) {
        open.delete(subscriptions[0]!);
        subscriptions[0]!.fail(new Error("stream cut"));
        publish(4);
      }
      if (item === last) break;
    }

    expect(received).toEqual(Array.from({ length: last }, (_, index) => index + 1));
    expect(reconnectReads).toBe(reads);
  }, 10_000);

  test("block replay catches up after a reconnect", async () => {
    /* StreamBlocks only sends blocks produced after it opens; block 4 is
       produced while the stream is down. */
    const block = (slot: number) => create(BlockSchema, { header: create(BlockHeaderSchema, { slot: BigInt(slot) }) });
    const produced: number[] = [];
    const streams: AsyncQueue<number>[] = [];
    const open = new Set<AsyncQueue<number>>();
    const produce = (slot: number) => {
      produced.push(slot);
      for (const queue of open) queue.push(slot);
    };
    const client = {
      listBlocks: async () => create(ListBlocksResponseSchema, {
        blocks: produced.map(block),
        page: create(PageResponseSchema, {}),
      }),
      streamBlocks: (_request: unknown, options?: { signal?: AbortSignal }) => {
        const queue = new AsyncQueue<number>();
        streams.push(queue);
        open.add(queue);
        options?.signal?.addEventListener("abort", () => queue.close(), { once: true });
        if (streams.length === 2) setTimeout(() => produce(5), 10);
        return {
          [Symbol.asyncIterator]: () => ({
            next: async () => {
              const next = await queue.next();
              return next.done ? next : { done: false, value: create(StreamBlocksResponseSchema, { block: block(next.value) }) };
            },
            return: async () => {
              open.delete(queue);
              queue.close();
              return { done: true as const, value: undefined };
            },
          }),
        };
      },
    };
    [1, 2, 3].forEach(produce);

    const controller = new AbortController();
    const replay = createBlockReplay({ client, startSlot: 1n, safetyMargin: 0n, signal: controller.signal });

    const received: number[] = [];
    for await (const item of replay) {
      const slot = Number(item.header?.slot);
      received.push(slot);
      if (slot === 3) {
        open.delete(streams[0]!);
        streams[0]!.fail(new Error("stream cut"));
        produce(4);
      }
      if (slot === 5) {
        controller.abort();
        break;
      }
    }

    expect(received).toEqual([1, 2, 3, 4, 5]);
  });

  test("reconnect keeps a second item in slot zero", async () => {
    type Item = { slot: bigint; id: string };
    const subscriptions: AsyncQueue<Item>[] = [];
    const subscribeLive = () => {
      const queue = new AsyncQueue<Item>();
      subscriptions.push(queue);
      if (subscriptions.length === 2) setTimeout(() => queue.push({ slot: 0n, id: "b" }), 10);
      return {
        [Symbol.asyncIterator]: () => ({
          next: () => queue.next(),
          return: async () => {
            queue.close();
            return { done: true as const, value: undefined };
          },
        }),
      };
    };

    const replay = new ReplayStream<Item>({
      startSlot: 0n,
      safetyMargin: 0n,
      fetchBackfill: async () => ({ items: [{ slot: 0n, id: "a" }], done: true }),
      subscribeLive,
      extractSlot: (item) => item.slot,
      extractKey: (item) => item.id,
      onReconnect: () => ({ subscribeLive }),
    });

    const received: string[] = [];
    for await (const item of replay) {
      received.push(item.id);
      if (item.id === "a") subscriptions[0]!.fail(new Error("stream cut"));
      if (item.id === "b") break;
    }

    expect(received).toEqual(["a", "b"]);
  });

  test("aborts promptly while generic replay cleanup is closing a stuck live stream", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const logger = createMockLogger();
    const stuck = createRejectingLiveStream();

    try {
      const replay = new ReplayStream<number>({
        startSlot: 0n,
        safetyMargin: 0n,
        fetchBackfill: async () => ({ items: [], done: true }),
        subscribeLive: () => stuck.iterable,
        extractSlot: (value) => BigInt(value),
        logger,
        signal: controller.signal,
      });

      const next = replay[Symbol.asyncIterator]().next();
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(DEFAULT_RETRY_CONFIG.initialDelayMs);
      await vi.waitFor(() => expect(stuck.return).toHaveBeenCalledTimes(1));

      controller.abort();

      await expect(next).resolves.toEqual({ done: true, value: undefined });
      expect(logger.info).toHaveBeenCalledWith(
        "Replay stream reconnect cleanup completed",
        expect.objectContaining({
          event: "replay.stream.reconnect.cleanup_completed",
          result: "aborted",
        })
      );
      expect(logger.warn).not.toHaveBeenCalledWith(
        "Replay stream reconnect cleanup stuck",
        expect.anything()
      );
    } finally {
      vi.useRealTimers();
    }
  });

  test("abort ends a live stream that is waiting for its next item", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const idle = createIdleLiveStream();

    try {
      const replay = new ReplayStream<number>({
        startSlot: 0n,
        safetyMargin: 0n,
        fetchBackfill: async () => ({ items: [], done: true }),
        subscribeLive: () => idle.iterable,
        extractSlot: (value) => BigInt(value),
        signal: controller.signal,
      });

      let result: IteratorResult<number> | undefined;
      void replay[Symbol.asyncIterator]().next().then((value) => { result = value; });
      await vi.advanceTimersByTimeAsync(0);
      expect(result).toBeUndefined();

      controller.abort();
      await vi.advanceTimersByTimeAsync(1000);

      expect(result).toEqual({ done: true, value: undefined });
      expect(idle.return).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("transaction replay", () => {
  test("keeps all transactions per slot and resumes after live failure", async () => {
    const history = [
      makeTransaction(300n, "H1"),
      makeTransaction(300n, "H2"),
      makeTransaction(301n, "H3"),
    ];
    const live = [
      makeTransaction(300n, "H1"),
      makeTransaction(300n, "H2"),
      makeTransaction(301n, "H3"),
      makeTransaction(301n, "L1"),
      makeTransaction(302n, "L2"),
      makeTransaction(302n, "L3"),
      makeTransaction(303n, "L4"),
      makeTransaction(304n, "L5"),
    ];

    const source = new SimulatedTransactionSource({
      history,
      live,
      pageDelayMs: 0,
      streamDelayMs: 2,
      streamErrorAfter: 4,
    });

    const replay = createTransactionReplay({
      client: source,
      startSlot: 300n,
      safetyMargin: 1n,
      pageSize: 2,
      resubscribeOnEnd: false,
    });

    const received: string[] = [];
    const expectedLabels = ["H1", "H2", "H3", "L1", "L2", "L3", "L4", "L5"];
    for await (const tx of replay) {
      received.push(signatureHex(tx));
      if (received.length === expectedLabels.length) break;
    }

    expect(received).toEqual(expectedLabels.map((label) => asciiHex(label)));
    expect(source.streamStartSlots[0]).toBe(300n);
    expect(source.streamStartSlots[source.streamStartSlots.length - 1]).toBe(301n);

    const metrics = replay.getMetrics();
    expect(metrics.emittedBackfill).toBeGreaterThan(0);
    expect(metrics.emittedBackfill + metrics.emittedLive).toBe(expectedLabels.length);
  });
});

function makeTransaction(slot: Slot, label: string): Transaction {
  return create(TransactionSchema, {
    slot,
    signature: create(SignatureSchema, { value: new Uint8Array(asciiBytes(label)) }),
  });
}

function asciiBytes(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let idx = 0; idx < text.length; idx += 1) bytes[idx] = text.charCodeAt(idx) & 0xff;
  return bytes;
}

function signatureHex(tx: Transaction): string {
  const value = tx.signature?.value ?? new Uint8Array();
  return bytesToHex(value);
}

function asciiHex(text: string): string {
  return bytesToHex(asciiBytes(text));
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

describe("live call cancellation", () => {
  test.each([
    ["block", createBlockReplay],
    ["transaction", createTransactionReplay],
    ["event", createEventReplay],
  ] as const)("abort cancels the live call of a caller-owned client (%s replay)", async (_kind, createReplay) => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const quiet = createQuietStreamingClient();

    try {
      const replay = createReplay({ client: quiet.client, startSlot: 0n, signal: controller.signal } as never);
      let result: IteratorResult<unknown> | undefined;
      void replay[Symbol.asyncIterator]().next().then((value) => { result = value; });
      await vi.advanceTimersByTimeAsync(0);
      expect(quiet.cancelled()).toBe(false);

      controller.abort();
      await vi.advanceTimersByTimeAsync(1000);

      expect(result).toEqual({ done: true, value: undefined });
      expect(quiet.cancelled()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

/* Connect's server-stream iterables have no return(), so only the call's
   signal can end a read that is waiting on the network. */
function createQuietStreamingClient() {
  let cancelled = false;
  const stream = (_request: unknown, options?: { signal?: AbortSignal }) => (async function* () {
    try {
      await new Promise((_resolve, reject) => {
        options?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    } finally {
      cancelled = true;
    }
  })();

  return {
    cancelled: () => cancelled,
    client: {
      listBlocks: async () => ({ blocks: [] }),
      listTransactions: async () => ({ transactions: [] }),
      listEvents: async () => ({ events: [] }),
      streamBlocks: stream,
      streamTransactions: stream,
      streamEvents: stream,
    },
  };
}

function createMockLogger(): ReplayLogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function createIdleLiveStream(): {
  iterable: AsyncIterable<number>;
  return: ReturnType<typeof vi.fn>;
} {
  const returnFn = vi.fn<() => Promise<IteratorResult<number>>>(async () => ({ done: true, value: undefined }));

  return {
    return: returnFn,
    iterable: {
      [Symbol.asyncIterator]() {
        return {
          next: () => new Promise<IteratorResult<number>>(() => {}),
          return: returnFn,
        };
      },
    },
  };
}

function createRejectingLiveStream(): {
  iterable: AsyncIterable<number>;
  next: ReturnType<typeof vi.fn>;
  return: ReturnType<typeof vi.fn>;
} {
  const next = vi.fn<() => Promise<IteratorResult<number>>>(() =>
    Promise.reject(new Error("synthetic live failure"))
  );
  const returnFn = vi.fn<() => Promise<IteratorResult<number>>>(() => new Promise(() => {}));

  return {
    next,
    return: returnFn,
    iterable: {
      [Symbol.asyncIterator]() {
        return {
          next,
          return: returnFn,
        };
      },
    },
  };
}
