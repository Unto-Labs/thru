import { beforeEach, describe, expect, it, vi } from "vitest";
import { runAccountStreamProcessor } from "./processor";

const replayMocks = vi.hoisted(() => ({
  events: [] as unknown[],
  createAccountsByOwnerReplay: vi.fn(),
}));

const checkpointMocks = vi.hoisted(() => ({
  getCheckpoint: vi.fn(),
  updateCheckpoint: vi.fn(),
}));

vi.mock("@thru/replay", () => ({
  AccountView: { FULL: "full" },
  createAccountsByOwnerReplay: replayMocks.createAccountsByOwnerReplay,
}));

vi.mock("../checkpoint", () => checkpointMocks);

describe("runAccountStreamProcessor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    replayMocks.events = [];
    replayMocks.createAccountsByOwnerReplay.mockImplementation((options) => ({
      [Symbol.asyncIterator]: async function* () {
        options.onBackfillComplete?.(25n);
        yield* replayMocks.events;
      },
    }));
    checkpointMocks.getCheckpoint.mockResolvedValue(null);
    checkpointMocks.updateCheckpoint.mockResolvedValue(undefined);
  });

  function sqlText(node: unknown): string {
    if (node === null || node === undefined) return "";
    if (typeof node === "string") return node;
    if (typeof node === "bigint" || typeof node === "number") return node.toString();
    if (Array.isArray(node)) return node.map(sqlText).join("");
    const record = node as { queryChunks?: unknown[]; value?: unknown[]; name?: string };
    if (record.queryChunks) return record.queryChunks.map(sqlText).join("");
    if (record.value) return record.value.join("");
    if (record.name) return record.name;
    return "";
  }

  function createStream(overrides: Record<string, unknown> = {}) {
    return {
      name: "test-accounts",
      description: "Test accounts",
      expectedSize: undefined,
      dataSizes: undefined,
      schema: {},
      table: {},
      getOwnerProgram: vi.fn(() => new Uint8Array([1])),
      parse: vi.fn(() => null),
      ...overrides,
    } as any;
  }

  it("does not checkpoint the backfill high-water mark without handling an account", async () => {
    await runAccountStreamProcessor(
      createStream(),
      {
        clientFactory: vi.fn(),
        db: {} as any,
        logLevel: "error",
      }
    );

    expect(checkpointMocks.updateCheckpoint).not.toHaveBeenCalled();
  });

  it("passes abort signals through to account replay", async () => {
    const controller = new AbortController();

    await runAccountStreamProcessor(
      createStream(),
      {
        clientFactory: vi.fn(),
        db: {} as any,
        logLevel: "error",
      },
      controller.signal
    );

    expect(replayMocks.createAccountsByOwnerReplay).toHaveBeenCalledWith(
      expect.objectContaining({
        signal: controller.signal,
      })
    );
  });

  it("resumes from a slot-zero checkpoint without checkpointing an empty replay", async () => {
    checkpointMocks.getCheckpoint.mockResolvedValue({ slot: 0n, eventId: null });
    const onStart = vi.fn();

    await runAccountStreamProcessor(createStream(), {
      clientFactory: vi.fn(), db: {} as any, logLevel: "error", observer: { onStart },
    });

    expect(replayMocks.createAccountsByOwnerReplay).toHaveBeenCalledWith(
      expect.objectContaining({ minUpdatedSlot: 0n })
    );
    expect(onStart).toHaveBeenCalledWith({ startSlot: 0n, checkpointSlot: 0n });
    expect(checkpointMocks.updateCheckpoint).not.toHaveBeenCalled();
  });

  it.each([false, true])("checkpoints a slot-zero account at block boundaries and exit (delete: %s)", async (isDelete) => {
    replayMocks.events = [
      {
        type: "account",
        account: {
          address: new Uint8Array(32).fill(1), addressHex: "01".repeat(32),
          data: new Uint8Array([1]), isDelete, slot: 0n,
        },
      },
      { type: "blockFinished", block: { slot: 10n } },
    ];
    const returning = vi.fn(async () => [{ address: "account-1" }]);
    const insert = vi.fn(() => ({ values: () => ({ onConflictDoUpdate: () => ({ returning }) }) }));
    const deleteRow = vi.fn(() => ({ where: vi.fn(async () => undefined) }));
    const onCheckpoint = vi.fn();

    await runAccountStreamProcessor(createStream({
      table: { address: { name: "address" }, slot: { name: "slot" } },
      parse: vi.fn(() => ({ address: "account-1", slot: 0n })),
    }), {
      clientFactory: vi.fn(), db: { insert, delete: deleteRow } as any,
      logLevel: "error", observer: { onCheckpoint },
    });

    expect(checkpointMocks.updateCheckpoint).toHaveBeenCalledTimes(2);
    expect(checkpointMocks.updateCheckpoint).toHaveBeenNthCalledWith(
      1, expect.anything(), "account:test-accounts", 0n, null
    );
    expect(checkpointMocks.updateCheckpoint).toHaveBeenNthCalledWith(
      2, expect.anything(), "account:test-accounts", 0n, null
    );
    expect(onCheckpoint).toHaveBeenCalledWith({ slot: 0n });
  });

  it("delegates idle recovery to one replay instance", async () => {
    let resumeReplay!: () => void;
    const replayResumed = new Promise<void>((resolve) => {
      resumeReplay = resolve;
    });
    replayMocks.createAccountsByOwnerReplay.mockImplementation(() => ({
      [Symbol.asyncIterator]: async function* () {
        await replayResumed;
        yield { type: "blockFinished", block: { slot: 10n } };
      },
    }));

    const processing = runAccountStreamProcessor(
      createStream(),
      {
        clientFactory: vi.fn(),
        db: {} as any,
        logLevel: "error",
      }
    );

    await vi.waitFor(() => {
      expect(replayMocks.createAccountsByOwnerReplay).toHaveBeenCalledTimes(1);
    });
    resumeReplay();
    await processing;

    expect(replayMocks.createAccountsByOwnerReplay).toHaveBeenCalledTimes(1);
    expect(checkpointMocks.updateCheckpoint).not.toHaveBeenCalled();
  });

  it("does not log that a checkpoint was saved when no accounts were handled", async () => {
    replayMocks.events = [{ type: "blockFinished", block: { slot: 10n } }];
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await runAccountStreamProcessor(
      createStream(),
      {
        clientFactory: vi.fn(),
        db: {} as any,
        logLevel: "debug",
      }
    );

    expect(checkpointMocks.updateCheckpoint).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      "[account-stream:test-accounts] Block finished: slot 10, no checkpoint yet (no accounts handled)"
    );
    logSpy.mockRestore();
  });

  it("persists the last upserted account slot at block boundaries, not the block slot", async () => {
    replayMocks.events = [
      {
        type: "account",
        account: {
          address: new Uint8Array([1]),
          addressHex: "01",
          data: new Uint8Array([1]),
          isDelete: false,
          slot: 5n,
        },
      },
      { type: "blockFinished", block: { slot: 10n } },
    ];
    const returning = vi.fn(async () => [{ address: "account-1" }]);
    const onConflictDoUpdate = vi.fn(() => ({ returning }));
    const values = vi.fn(() => ({ onConflictDoUpdate }));
    const insert = vi.fn(() => ({ values }));

    await runAccountStreamProcessor(
      createStream({
        table: { address: { name: "address" }, slot: { name: "slot" } },
        api: { idField: "address" },
        parse: vi.fn(() => ({ address: "account-1", slot: 5n })),
      }),
      {
        clientFactory: vi.fn(),
        db: { insert } as any,
        logLevel: "error",
      }
    );

    expect(checkpointMocks.updateCheckpoint).toHaveBeenCalledWith(
      expect.anything(),
      "account:test-accounts",
      5n,
      null
    );
    expect(checkpointMocks.updateCheckpoint).not.toHaveBeenCalledWith(
      expect.anything(),
      "account:test-accounts",
      10n,
      expect.anything()
    );
  });

  it.each([0n, 5n])("checkpoints handled backfill slot %s when the backfill drains, before any live block", async (slot) => {
    let releaseLive!: () => void;
    const live = new Promise<void>((resolve) => {
      releaseLive = resolve;
    });
    replayMocks.createAccountsByOwnerReplay.mockImplementation((options) => ({
      [Symbol.asyncIterator]: async function* () {
        yield {
          type: "account",
          account: {
            address: new Uint8Array([1]),
            addressHex: "01",
            data: new Uint8Array([1]),
            isDelete: false,
            slot,
          },
        };
        options.onBackfillComplete?.(25n);
        /* A quiet stream: no live update arrives for a long time. */
        await live;
      },
    }));
    const returning = vi.fn(async () => [{ address: "account-1" }]);
    const onConflictDoUpdate = vi.fn(() => ({ returning }));
    const values = vi.fn(() => ({ onConflictDoUpdate }));
    const insert = vi.fn(() => ({ values }));
    const onCheckpoint = vi.fn();

    const processing = runAccountStreamProcessor(
      createStream({
        table: { address: { name: "address" }, slot: { name: "slot" } },
        api: { idField: "address" },
        parse: vi.fn(() => ({ address: "account-1", slot })),
      }),
      {
        clientFactory: vi.fn(),
        db: { insert } as any,
        logLevel: "error",
        observer: { onCheckpoint },
      }
    );

    await vi.waitFor(() => {
      expect(onCheckpoint).toHaveBeenCalledWith({ slot });
    });
    expect(checkpointMocks.updateCheckpoint).toHaveBeenCalledTimes(1);
    expect(checkpointMocks.updateCheckpoint).toHaveBeenCalledWith(
      expect.anything(),
      "account:test-accounts",
      slot,
      null
    );

    releaseLive();
    await processing;
    expect(checkpointMocks.updateCheckpoint).not.toHaveBeenCalledWith(
      expect.anything(),
      "account:test-accounts",
      25n,
      expect.anything()
    );
  });

  it("does not checkpoint at block boundaries or on exit before the backfill drains", async () => {
    replayMocks.createAccountsByOwnerReplay.mockImplementation(() => ({
      [Symbol.asyncIterator]: async function* () {
        /* A live update interleaved with backfill: the backfill may not have
           reached accounts below slot 20 yet. */
        yield {
          type: "account",
          account: {
            address: new Uint8Array([1]),
            addressHex: "01",
            data: new Uint8Array([1]),
            isDelete: false,
            slot: 20n,
          },
        };
        yield { type: "blockFinished", block: { slot: 21n } };
      },
    }));
    const returning = vi.fn(async () => [{ address: "account-1" }]);
    const onConflictDoUpdate = vi.fn(() => ({ returning }));
    const values = vi.fn(() => ({ onConflictDoUpdate }));
    const insert = vi.fn(() => ({ values }));

    await runAccountStreamProcessor(
      createStream({
        table: { address: { name: "address" }, slot: { name: "slot" } },
        api: { idField: "address" },
        parse: vi.fn(() => ({ address: "account-1", slot: 20n })),
      }),
      {
        clientFactory: vi.fn(),
        db: { insert } as any,
        logLevel: "error",
      }
    );

    expect(insert).toHaveBeenCalled();
    expect(checkpointMocks.updateCheckpoint).not.toHaveBeenCalled();
  });

  it("keeps running when the backfill checkpoint write fails", async () => {
    checkpointMocks.updateCheckpoint
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockResolvedValue(undefined);
    replayMocks.createAccountsByOwnerReplay.mockImplementation((options) => ({
      [Symbol.asyncIterator]: async function* () {
        yield {
          type: "account",
          account: {
            address: new Uint8Array([1]),
            addressHex: "01",
            data: new Uint8Array([1]),
            isDelete: false,
            slot: 5n,
          },
        };
        options.onBackfillComplete?.(5n);
        yield { type: "blockFinished", block: { slot: 6n } };
      },
    }));
    const returning = vi.fn(async () => [{ address: "account-1" }]);
    const onConflictDoUpdate = vi.fn(() => ({ returning }));
    const values = vi.fn(() => ({ onConflictDoUpdate }));
    const insert = vi.fn(() => ({ values }));

    await expect(
      runAccountStreamProcessor(
        createStream({
          table: { address: { name: "address" }, slot: { name: "slot" } },
          api: { idField: "address" },
          parse: vi.fn(() => ({ address: "account-1", slot: 5n })),
        }),
        {
          clientFactory: vi.fn(),
          db: { insert } as any,
          logLevel: "error",
        }
      )
    ).resolves.toMatchObject({ accountsUpdated: 1 });
    /* The block boundary retries the write that failed. */
    expect(checkpointMocks.updateCheckpoint).toHaveBeenCalledTimes(3);
  });

  it("orders same-slot upserts by sequence", async () => {
    replayMocks.events = [{
      type: "account",
      account: {
        address: new Uint8Array([1]),
        addressHex: "01",
        data: new Uint8Array([1]),
        isDelete: false,
        slot: 5n,
        seq: 2n,
      },
    }];
    const returning = vi.fn(async () => [{ address: "account-1" }]);
    const onConflictDoUpdate = vi.fn(() => ({ returning }));
    const values = vi.fn(() => ({ onConflictDoUpdate }));
    const insert = vi.fn(() => ({ values }));

    await runAccountStreamProcessor(
      createStream({
        table: {
          address: { name: "address" },
          slot: { name: "slot" },
          seq: { name: "seq" },
        },
        api: { idField: "address" },
        parse: vi.fn(() => ({ address: "account-1", slot: 5n, seq: 2n })),
      }),
      {
        clientFactory: vi.fn(),
        db: { insert } as any,
        logLevel: "error",
      }
    );

    const conflict = (onConflictDoUpdate.mock.calls as unknown[][])[0]?.[0] as { where: unknown };
    expect(sqlText(conflict.where)).toContain("slot");
    expect(sqlText(conflict.where)).toContain("seq");
  });

  it("does not advance the checkpoint for parser-null accounts", async () => {
    replayMocks.events = [
      {
        type: "account",
        account: {
          address: new Uint8Array([1]),
          addressHex: "01",
          data: new Uint8Array([1]),
          isDelete: false,
          slot: 5n,
        },
      },
      { type: "blockFinished", block: { slot: 10n } },
    ];

    await runAccountStreamProcessor(
      createStream(),
      {
        clientFactory: vi.fn(),
        db: {} as any,
        logLevel: "error",
      }
    );

    expect(checkpointMocks.updateCheckpoint).not.toHaveBeenCalled();
  });

  it("does not advance the checkpoint when a slot-guarded upsert affects no rows", async () => {
    replayMocks.events = [
      {
        type: "account",
        account: {
          address: new Uint8Array([1]),
          addressHex: "01",
          data: new Uint8Array([1]),
          isDelete: false,
          slot: 5n,
        },
      },
      { type: "blockFinished", block: { slot: 10n } },
    ];
    const returning = vi.fn(async () => []);
    const onConflictDoUpdate = vi.fn(() => ({ returning }));
    const values = vi.fn(() => ({ onConflictDoUpdate }));
    const insert = vi.fn(() => ({ values }));

    const stats = await runAccountStreamProcessor(
      createStream({
        parse: vi.fn(() => ({ address: "account-1", slot: 5n })),
      }),
      {
        clientFactory: vi.fn(),
        db: { insert } as any,
        logLevel: "error",
      }
    );

    expect(returning).toHaveBeenCalled();
    expect(stats.accountsUpdated).toBe(0);
    expect(checkpointMocks.updateCheckpoint).not.toHaveBeenCalled();
  });
});
