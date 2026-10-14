import { beforeEach, describe, expect, it, vi } from "vitest";
import { runEventStreamProcessor } from "./processor";

const replayMocks = vi.hoisted(() => ({
  events: [] as Array<{ eventId: string; slot: bigint }>,
  createEventReplay: vi.fn(),
}));

const checkpointMocks = vi.hoisted(() => ({
  getCheckpoint: vi.fn(),
  updateCheckpoint: vi.fn(),
}));

vi.mock("@thru/replay", () => ({
  createConsoleLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
  createEventReplay: replayMocks.createEventReplay,
}));

vi.mock("../checkpoint", () => checkpointMocks);

describe("runEventStreamProcessor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    replayMocks.events = [];
    replayMocks.createEventReplay.mockImplementation(() => ({
      [Symbol.asyncIterator]: async function* () {
        yield* replayMocks.events;
      },
    }));
    checkpointMocks.getCheckpoint.mockResolvedValue(null);
    checkpointMocks.updateCheckpoint.mockResolvedValue(undefined);
  });

  function createStream(overrides: Record<string, unknown> = {}) {
    return {
      name: "test-events",
      description: "Test events",
      schema: {},
      table: {},
      getFilter: vi.fn(() => ({})),
      parse: vi.fn((event: { eventId: string; slot: bigint }) => ({
        id: event.eventId,
        slot: event.slot,
      })),
      ...overrides,
    } as any;
  }

  it("resumes from the checkpoint slot so same-slot events are not skipped", async () => {
    checkpointMocks.getCheckpoint.mockResolvedValue({
      slot: 42n,
      eventId: "event-1",
    });

    await runEventStreamProcessor(
      createStream(),
      {
        clientFactory: vi.fn(),
        db: { transaction: vi.fn() } as any,
        defaultStartSlot: 0n,
        logLevel: "error",
      }
    );

    expect(replayMocks.createEventReplay).toHaveBeenCalledWith(
      expect.objectContaining({
        startSlot: 42n,
        resumeAfter: { slot: 42n, eventId: "event-1" },
      })
    );
  });

  it("passes abort signals through to event replay", async () => {
    const controller = new AbortController();

    await runEventStreamProcessor(
      createStream(),
      {
        clientFactory: vi.fn(),
        db: { transaction: vi.fn() } as any,
        defaultStartSlot: 0n,
        logLevel: "error",
      },
      controller.signal
    );

    expect(replayMocks.createEventReplay).toHaveBeenCalledWith(
      expect.objectContaining({
        signal: controller.signal,
      })
    );
  });

  it("falls back to replaying the checkpoint slot when no checkpoint event id exists", async () => {
    checkpointMocks.getCheckpoint.mockResolvedValue({
      slot: 42n,
      eventId: null,
    });

    await runEventStreamProcessor(
      createStream(),
      {
        clientFactory: vi.fn(),
        db: { transaction: vi.fn() } as any,
        defaultStartSlot: 0n,
        logLevel: "error",
      }
    );

    expect(replayMocks.createEventReplay).toHaveBeenCalledWith(
      expect.objectContaining({
        startSlot: 42n,
        resumeAfter: undefined,
      })
    );
  });

  it("does not checkpoint when replay fails before yielding events", async () => {
    replayMocks.createEventReplay.mockImplementation(() => ({
      [Symbol.asyncIterator]: async function* () {
        throw new Error("backfill source returned pages out of ascending slot order");
      },
    }));

    await expect(
      runEventStreamProcessor(
        createStream(),
        {
          clientFactory: vi.fn(),
          db: { transaction: vi.fn() } as any,
          defaultStartSlot: 0n,
          logLevel: "error",
        }
      )
    ).rejects.toThrow("backfill source returned pages out of ascending slot order");

    expect(checkpointMocks.updateCheckpoint).not.toHaveBeenCalled();
  });

  it("checkpoints filtered batches without trying to insert an empty values list", async () => {
    replayMocks.events = [
      { eventId: "event-1", slot: 7n },
      { eventId: "event-2", slot: 7n },
    ];
    const transaction = vi.fn();
    const filterBatch = vi.fn(async () => []);

    const stats = await runEventStreamProcessor(
      createStream({ filterBatch }),
      {
        clientFactory: vi.fn(),
        db: { transaction } as any,
        defaultStartSlot: 0n,
        logLevel: "error",
      }
    );

    expect(transaction).not.toHaveBeenCalled();
    expect(checkpointMocks.updateCheckpoint).toHaveBeenCalledWith(
      expect.anything(),
      "test-events",
      7n,
      "event-2"
    );
    expect(stats.lastSlot).toBe(7n);
  });

  it("only calls onCommit with rows that were actually inserted", async () => {
    replayMocks.events = [{ eventId: "duplicate-event", slot: 7n }];
    const returning = vi.fn(async () => []);
    const onConflictDoNothing = vi.fn(() => ({ returning }));
    const values = vi.fn(() => ({ onConflictDoNothing }));
    const insert = vi.fn(() => ({ values }));
    const transaction = vi.fn(async (callback) => callback({ insert }));
    const onCommit = vi.fn();

    await runEventStreamProcessor(
      createStream({ onCommit }),
      {
        clientFactory: vi.fn(),
        db: { transaction } as any,
        defaultStartSlot: 0n,
        logLevel: "error",
      }
    );

    expect(returning).toHaveBeenCalled();
    expect(checkpointMocks.updateCheckpoint).toHaveBeenCalledWith(
      expect.anything(),
      "test-events",
      7n,
      "duplicate-event"
    );
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("rejects when a timeout flush commit fails", async () => {
    vi.useFakeTimers();
    let resolveParsed: () => void = () => {};
    const parsed = new Promise<void>((resolve) => {
      resolveParsed = resolve;
    });
    replayMocks.createEventReplay.mockImplementation(() => ({
      [Symbol.asyncIterator]: async function* () {
        yield { eventId: "event-1", slot: 7n };
        await new Promise(() => {});
      },
    }));
    const transaction = vi.fn(async () => {
      throw new Error("database unavailable");
    });
    const stream = createStream({
      parse: vi.fn((event: { eventId: string; slot: bigint }) => {
        resolveParsed();
        return {
          id: event.eventId,
          slot: event.slot,
        };
      }),
    });

    try {
      const promise = runEventStreamProcessor(
        stream,
        {
          clientFactory: vi.fn(),
          db: { transaction } as any,
          defaultStartSlot: 0n,
          logLevel: "error",
        }
      );
      const rejection = expect(promise).rejects.toThrow("database unavailable");

      await parsed;
      await vi.advanceTimersByTimeAsync(6000);

      await rejection;
      expect(transaction).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  /* Replay yields slot 10 then slot 20, then waits for `release`. Taking the
     slot-20 event returns the slot-10 batch for commit, and its filterBatch
     blocks until the test resolves it; meanwhile the slot-20 batch sits in
     the batcher until the timer flush picks it up. */
  function overlappingBatches() {
    let release: () => void = () => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    replayMocks.createEventReplay.mockImplementation(() => ({
      [Symbol.asyncIterator]: async function* () {
        yield { eventId: "event-10", slot: 10n };
        yield { eventId: "event-20", slot: 20n };
        await released;
      },
    }));
    const gates = new Map<bigint, { resolve: () => void; reject: (err: Error) => void }>();
    const filterBatch = vi.fn(
      (events: Array<{ slot: bigint }>) =>
        new Promise<never[]>((resolve, reject) => {
          gates.set(events[0]!.slot, { resolve: () => resolve([]), reject });
        })
    );
    return { release, gates, filterBatch };
  }

  function checkpointedSlots(): bigint[] {
    return checkpointMocks.updateCheckpoint.mock.calls.map((call) => call[2] as bigint);
  }

  it("commits a timer-flushed batch only after the older batch in filterBatch finishes", async () => {
    vi.useFakeTimers();
    try {
      const { release, gates, filterBatch } = overlappingBatches();
      const promise = runEventStreamProcessor(createStream({ filterBatch }), {
        clientFactory: vi.fn(),
        db: { transaction: vi.fn() } as any,
        defaultStartSlot: 0n,
        logLevel: "error",
      });

      await vi.advanceTimersByTimeAsync(6000);
      /* The timer flushed slot 20, but it waits behind slot 10. */
      expect(filterBatch).toHaveBeenCalledTimes(1);
      expect(checkpointedSlots()).toEqual([]);

      gates.get(10n)!.resolve();
      await vi.advanceTimersByTimeAsync(0);
      expect(filterBatch).toHaveBeenCalledTimes(2);
      gates.get(20n)!.resolve();
      release();
      await promise;

      /* Never backwards: 10 then 20. */
      expect(checkpointedSlots()).toEqual([10n, 20n]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("never commits a newer batch after an older one fails", async () => {
    vi.useFakeTimers();
    try {
      const { gates, filterBatch } = overlappingBatches();
      const promise = runEventStreamProcessor(createStream({ filterBatch }), {
        clientFactory: vi.fn(),
        db: { transaction: vi.fn() } as any,
        defaultStartSlot: 0n,
        logLevel: "error",
      });
      const rejection = expect(promise).rejects.toThrow("recovery failed");

      await vi.advanceTimersByTimeAsync(6000);
      gates.get(10n)!.reject(new Error("recovery failed"));
      await vi.advanceTimersByTimeAsync(2000);
      await rejection;

      /* A durable slot-20 checkpoint would make the restart skip slot 10. */
      expect(filterBatch).toHaveBeenCalledTimes(1);
      expect(checkpointedSlots()).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports a timer-flushed commit that fails after the replay loop ends", async () => {
    vi.useFakeTimers();
    try {
      let release: () => void = () => {};
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      replayMocks.createEventReplay.mockImplementation(() => ({
        [Symbol.asyncIterator]: async function* () {
          yield { eventId: "event-7", slot: 7n };
          await released;
        },
      }));
      let failCommit: (err: Error) => void = () => {};
      const filterBatch = vi.fn(
        () =>
          new Promise<never>((_, reject) => {
            failCommit = reject;
          })
      );
      const promise = runEventStreamProcessor(createStream({ filterBatch }), {
        clientFactory: vi.fn(),
        db: { transaction: vi.fn() } as any,
        defaultStartSlot: 0n,
        logLevel: "error",
      });
      const rejection = expect(promise).rejects.toThrow("database unavailable");

      /* The timer takes the slot-7 batch; the replay loop then ends with
         nothing left to flush while that commit is still in flight. */
      await vi.advanceTimersByTimeAsync(6000);
      expect(filterBatch).toHaveBeenCalledTimes(1);
      release();
      await vi.advanceTimersByTimeAsync(0);
      failCommit(new Error("database unavailable"));

      await rejection;
      expect(checkpointMocks.updateCheckpoint).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports each batch phase to the status observer", async () => {
    replayMocks.events = [{ eventId: "event-1", slot: 7n }];
    const returning = vi.fn(async () => [{ id: "event-1", slot: 7n }]);
    const onConflictDoNothing = vi.fn(() => ({ returning }));
    const values = vi.fn(() => ({ onConflictDoNothing }));
    const insert = vi.fn(() => ({ values }));
    const transaction = vi.fn(async (callback) => callback({ insert }));
    const onPhase = vi.fn();

    await runEventStreamProcessor(
      createStream({ filterBatch: vi.fn(async (events) => events) }),
      {
        clientFactory: vi.fn(),
        db: { transaction } as any,
        defaultStartSlot: 0n,
        logLevel: "error",
        observer: { onPhase },
      }
    );

    expect(onPhase.mock.calls.map((call) => call[0])).toEqual([
      { phase: "filterBatch", slot: 7n },
      { phase: "commit", slot: 7n },
      { phase: null },
    ]);
  });

  it("checkpoints the last post-filter event for partially filtered batches", async () => {
    replayMocks.events = [
      { eventId: "event-1", slot: 7n },
      { eventId: "event-2", slot: 7n },
      { eventId: "event-3", slot: 7n },
    ];
    const returning = vi.fn(async () => [
      { id: "event-1", slot: 7n },
      { id: "event-2", slot: 7n },
    ]);
    const onConflictDoNothing = vi.fn(() => ({ returning }));
    const values = vi.fn(() => ({ onConflictDoNothing }));
    const insert = vi.fn(() => ({ values }));
    const transaction = vi.fn(async (callback) => callback({ insert }));
    const filterBatch = vi.fn(async (events) => events.slice(0, 2));

    await runEventStreamProcessor(
      createStream({ filterBatch }),
      {
        clientFactory: vi.fn(),
        db: { transaction } as any,
        defaultStartSlot: 0n,
        logLevel: "error",
      }
    );

    expect(checkpointMocks.updateCheckpoint).toHaveBeenCalledWith(
      expect.anything(),
      "test-events",
      7n,
      "event-2"
    );
  });
});
