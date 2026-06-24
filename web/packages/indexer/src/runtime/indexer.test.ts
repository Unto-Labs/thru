import { describe, expect, it, vi, beforeEach } from "vitest";

const processorState = vi.hoisted(() => ({
  eventProcessorCalls: 0,
  eventProcessorMode: "hang" as "throw-once" | "hang" | "always-throw",
  latestObserver: null as any,
}));

vi.mock("../streams/processor", () => ({
  runEventStreamProcessor: vi.fn(async (_stream, options, signal: AbortSignal) => {
    processorState.eventProcessorCalls++;
    processorState.latestObserver = options.observer;
    options.observer?.onStart?.({ startSlot: 0n, checkpointSlot: null });

    if (
      processorState.eventProcessorMode === "always-throw" ||
      (processorState.eventProcessorMode === "throw-once" && processorState.eventProcessorCalls === 1)
    ) {
      const error = Object.assign(new Error("synthetic stream failure"), { code: 13 });
      options.observer?.onError?.("live", error);
      throw error;
    }

    await new Promise<void>((resolve) => {
      if (signal.aborted) {
        resolve();
        return;
      }
      signal.addEventListener("abort", () => resolve(), { once: true });
    });

    return {
      eventsProcessed: 0,
      batchesCommitted: 0,
      lastSlot: null,
    };
  }),
}));

vi.mock("../accounts/processor", () => ({
  runAccountStreamProcessor: vi.fn(async (_stream, options, signal: AbortSignal) => {
    options.observer?.onStart?.({ checkpointSlot: null });
    await new Promise<void>((resolve) => {
      if (signal.aborted) {
        resolve();
        return;
      }
      signal.addEventListener("abort", () => resolve(), { once: true });
    });
    return {
      accountsProcessed: 0,
      accountsUpdated: 0,
      accountsDeleted: 0,
    };
  }),
}));

const { Indexer } = await import("./indexer");

function createDb() {
  return {
    execute: vi.fn(async () => []),
  };
}

function createEventStream(name = "events") {
  return {
    name,
    description: "test events",
    schema: {},
    table: {} as any,
    c: {} as any,
    getFilter: () => ({} as any),
    parse: () => null,
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > 1000) {
      throw new Error("condition timed out");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("Indexer supervisor", () => {
  beforeEach(() => {
    processorState.eventProcessorCalls = 0;
    processorState.eventProcessorMode = "hang";
    processorState.latestObserver = null;
  });

  it("reports configured streams before start", () => {
    const indexer = new Indexer({
      db: createDb() as any,
      clientFactory: (() => ({})) as any,
      eventStreams: [createEventStream()],
    });

    const status = indexer.getStatus();
    expect(status.running).toBe(false);
    expect(status.healthy).toBe(false);
    expect(status.streams).toHaveLength(1);
    expect(status.streams[0]).toMatchObject({
      name: "events",
      kind: "event",
      state: "idle",
      checkpointSlot: null,
    });
  });

  it("restarts a failed stream and preserves phase-specific error metadata", async () => {
    processorState.eventProcessorMode = "throw-once";
    const logger = createMockLogger();
    const indexer = new Indexer({
      db: createDb() as any,
      clientFactory: (() => ({})) as any,
      eventStreams: [createEventStream("pack-purchases")],
      endpointLabel: "test-endpoint",
      logger,
      supervisorInitialBackoffMs: 1,
      supervisorMaxBackoffMs: 1,
    });

    const startPromise = indexer.start();
    await waitFor(() => processorState.eventProcessorCalls >= 2);

    const status = indexer.getStatus();
    expect(status.healthy).toBe(true);
    expect(status.streams[0]).toMatchObject({
      name: "pack-purchases",
      state: "running",
      restartCount: 1,
    });
    expect(status.streams[0].lastError).toMatchObject({
      phase: "live",
      message: "synthetic stream failure",
      code: 13,
      endpointLabel: "test-endpoint",
    });
    expect(logger.warn).toHaveBeenCalledWith(
      "Indexer stream supervisor restarting",
      expect.objectContaining({
        event: "indexer.stream.supervisor_restart",
        stream: "pack-purchases",
        kind: "event",
      })
    );
    expect(logger.info).toHaveBeenCalledWith(
      "Indexer stream state changed",
      expect.objectContaining({
        event: "indexer.stream.state_changed",
        stream: "pack-purchases",
        next_state: "running",
      })
    );

    indexer.stop();
    await expect(startPromise).resolves.toMatchObject({
      eventStreams: [{ name: "pack-purchases", status: "fulfilled" }],
    });
  });

  it("marks health unhealthy while a stream is retrying", async () => {
    processorState.eventProcessorMode = "always-throw";
    const indexer = new Indexer({
      db: createDb() as any,
      clientFactory: (() => ({})) as any,
      eventStreams: [createEventStream("pack-purchases")],
      supervisorInitialBackoffMs: 100,
      supervisorMaxBackoffMs: 100,
    });

    const startPromise = indexer.start();
    await waitFor(() => indexer.getStatus().streams[0].state === "retrying");

    const status = indexer.getStatus();
    expect(status.healthy).toBe(false);
    expect(status.streams[0].restartCount).toBeGreaterThan(0);

    indexer.stop();
    await startPromise;
  });

  it("marks health unhealthy when a running stream is stale", async () => {
    const logger = createMockLogger();
    const indexer = new Indexer({
      db: createDb() as any,
      clientFactory: (() => ({})) as any,
      eventStreams: [createEventStream("pack-purchases")],
      logger,
      streamStaleMs: 1,
    });

    const startPromise = indexer.start();
    await waitFor(() => indexer.getStatus().streams[0].state === "running");
    await waitFor(() => indexer.getStatus().streams[0].stale);

    const status = indexer.getStatus();
    expect(status.healthy).toBe(false);
    expect(status.streams[0]).toMatchObject({
      state: "running",
      stale: true,
    });
    expect(
      logger.warn.mock.calls.filter((call) => call[1]?.event === "indexer.stream.unhealthy")
    ).toHaveLength(1);

    indexer.getStatus();
    indexer.getStatus();
    expect(
      logger.warn.mock.calls.filter((call) => call[1]?.event === "indexer.stream.unhealthy")
    ).toHaveLength(1);

    processorState.latestObserver?.onRecord?.({ slot: 2n, id: "event-2" });
    const recovered = indexer.getStatus();
    expect(recovered.healthy).toBe(true);
    expect(logger.info).toHaveBeenCalledWith(
      "Indexer stream recovered",
      expect.objectContaining({
        event: "indexer.stream.recovered",
        stream: "pack-purchases",
      })
    );

    indexer.stop();
    await startPromise;
  });

  it("removes abort listeners when supervisor delay completes normally", async () => {
    vi.useFakeTimers();
    const indexer = new Indexer({
      db: createDb() as any,
      clientFactory: (() => ({})) as any,
      eventStreams: [createEventStream("pack-purchases")],
    });
    const controller = new AbortController();
    const removeEventListener = vi.spyOn(controller.signal, "removeEventListener");

    try {
      const delay = (indexer as any).delay(100, controller.signal);
      await vi.advanceTimersByTimeAsync(100);
      await delay;

      expect(removeEventListener).toHaveBeenCalledWith("abort", expect.any(Function));
    } finally {
      vi.useRealTimers();
      removeEventListener.mockRestore();
    }
  });
});

function createMockLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}
