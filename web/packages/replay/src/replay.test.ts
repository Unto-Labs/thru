import { create } from "@bufbuild/protobuf";
import { describe, expect, test, vi } from "vitest";
import {
  type Transaction,
  TransactionSchema,
  SignatureSchema,
} from "@thru/sdk/proto";
import { createBlockReplay } from "./replay/block-replay";
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

function createMockLogger(): ReplayLogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
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
