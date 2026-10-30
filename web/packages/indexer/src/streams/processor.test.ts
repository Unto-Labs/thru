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

  function overlappingBatches() {
    let release: () => void = () => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    replayMocks.createEventReplay.mockImplementation(() => ({
      [Symbol.asyncIterator]: async function* () {
        yield { eventId: "event-10", slot: 10n };
        // Far enough apart that the slot change flushes event-10 on its own.
        await new Promise((resolve) => setTimeout(resolve, 300));
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
      expect(filterBatch).toHaveBeenCalledTimes(1);
      expect(checkpointedSlots()).toEqual([]);

      gates.get(10n)!.resolve();
      await vi.advanceTimersByTimeAsync(0);
      expect(filterBatch).toHaveBeenCalledTimes(2);
      gates.get(20n)!.resolve();
      release();
      await promise;

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

      expect(filterBatch).toHaveBeenCalledTimes(1);
      expect(checkpointedSlots()).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("commits a batch cut while an older commit runs before a newer timer-flushed batch", async () => {
    vi.useFakeTimers();
    try {
      let release: () => void = () => {};
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      replayMocks.createEventReplay.mockImplementation(() => ({
        [Symbol.asyncIterator]: async function* () {
          yield { eventId: "event-10", slot: 10n };
          await new Promise((resolve) => setTimeout(resolve, 300));
          yield { eventId: "event-20", slot: 20n };
          await new Promise((resolve) => setTimeout(resolve, 300));
          yield { eventId: "event-30", slot: 30n };
          await released;
        },
      }));
      let finishSlot10: () => void = () => {};
      const filterBatch = vi.fn((events: Array<{ slot: bigint }>) =>
        events[0]!.slot === 10n
          ? new Promise<never[]>((resolve) => {
              finishSlot10 = () => resolve([]);
            })
          : Promise.resolve([])
      );
      const promise = runEventStreamProcessor(createStream({ filterBatch }), {
        clientFactory: vi.fn(),
        db: { transaction: vi.fn() } as any,
        defaultStartSlot: 0n,
        logLevel: "error",
      });

      // Slot 20's batch is cut while slot 10 commits; slot 30 then goes stale and the timer flushes it.
      await vi.advanceTimersByTimeAsync(7000);
      finishSlot10();
      await vi.advanceTimersByTimeAsync(0);
      release();
      await promise;

      expect(checkpointedSlots()).toEqual([10n, 20n, 30n]);
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

  function recordingDb() {
    const inserted: number[] = [];
    const insert = vi.fn(() => ({
      values: vi.fn((rows: unknown[]) => {
        inserted.push(rows.length);
        return { onConflictDoNothing: () => ({ returning: async () => rows }) };
      }),
    }));
    return { inserted, db: { transaction: vi.fn(async (callback) => callback({ insert })) } as any };
  }

  it("batches back-to-back events across slots", async () => {
    vi.useFakeTimers();
    try {
      replayMocks.events = Array.from({ length: 2500 }, (_, i) => ({
        eventId: `event-${i + 1}`,
        slot: BigInt(i + 1),
      }));
      const { inserted, db } = recordingDb();

      await runEventStreamProcessor(createStream(), {
        clientFactory: vi.fn(),
        db,
        defaultStartSlot: 0n,
        logLevel: "error",
      });

      expect(inserted).toEqual([1000, 1000, 500]);
      expect(checkpointMocks.updateCheckpoint.mock.calls.map((call) => [call[2], call[3]])).toEqual([
        [1000n, "event-1000"],
        [2000n, "event-2000"],
        [2500n, "event-2500"],
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("still commits one slot per batch when events arrive a second apart", async () => {
    vi.useFakeTimers();
    try {
      replayMocks.createEventReplay.mockImplementation(() => ({
        [Symbol.asyncIterator]: async function* () {
          for (const slot of [1n, 2n, 3n]) {
            yield { eventId: `event-${slot}`, slot };
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        },
      }));
      const { inserted, db } = recordingDb();

      const promise = runEventStreamProcessor(createStream(), {
        clientFactory: vi.fn(),
        db,
        defaultStartSlot: 0n,
        logLevel: "error",
      });
      await vi.advanceTimersByTimeAsync(3000);
      await promise;

      expect(inserted).toEqual([1, 1, 1]);
      expect(checkpointedSlots()).toEqual([1n, 2n, 3n]);
    } finally {
      vi.useRealTimers();
    }
  });


  it("reports actual inserted rows and closes the DB phase before post-commit hooks", async () => {
    replayMocks.events = [{ eventId: "event-1", slot: 7n }, { eventId: "event-2", slot: 7n }];
    const onPhase = vi.fn();
    const onBatchCommitted = vi.fn();
    const onCommit = vi.fn(async () => { expect(onPhase).toHaveBeenLastCalledWith({ phase: null }); });
    const insert = () => ({ values: () => ({ onConflictDoNothing: () => ({ returning: async () => [{ id: "event-2" }] }) }) });
    await runEventStreamProcessor(createStream({ onCommit }), { clientFactory: vi.fn(), db: { transaction: async (callback: any) => callback({ insert }) } as any, defaultStartSlot: 0n, logLevel: "error", observer: { onPhase, onBatchCommitted } });
    expect(onBatchCommitted).toHaveBeenCalledWith({ slot: 7n, count: 2, insertedCount: 1 });
    expect(onCommit).toHaveBeenCalledTimes(1);
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


it('does not report committed progress when the database transaction rejects', async () => {
  checkpointMocks.getCheckpoint.mockResolvedValue(null);
  replayMocks.createEventReplay.mockImplementation(() => ({ [Symbol.asyncIterator]: async function* () { yield* replayMocks.events; } }));
  replayMocks.events = [{ eventId: 'event-1', slot: 7n }];
  const onBatchCommitted = vi.fn();
  const onCheckpoint = vi.fn();
  await expect(runEventStreamProcessor({ name: 'events', schema: {}, table: {}, getFilter: () => ({}), parse: (event: any) => ({ id: event.eventId, slot: event.slot }) } as any, {
    clientFactory: vi.fn(), db: { transaction: vi.fn(async () => { throw new Error('db unavailable'); }) } as any,
    defaultStartSlot: 0n, logLevel: 'error', observer: { onBatchCommitted, onCheckpoint },
  })).rejects.toThrow('db unavailable');
  expect(onBatchCommitted).not.toHaveBeenCalled();
  expect(onCheckpoint).not.toHaveBeenCalled();
});
