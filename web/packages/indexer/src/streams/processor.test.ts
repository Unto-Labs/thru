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
