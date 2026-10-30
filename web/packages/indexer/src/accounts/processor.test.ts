import type { SQL } from "drizzle-orm";
import { bigint, PgDialect, pgTable, text } from "drizzle-orm/pg-core";
import { encodeAddress } from "@thru/sdk/helpers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runAccountStreamProcessor } from "./processor";

const accountsTable = pgTable("test_accounts", {
  address: text("address").primaryKey(),
  slot: bigint("slot", { mode: "bigint" }).notNull(),
});

const sequencedAccountsTable = pgTable("test_sequenced_accounts", {
  address: text("address").primaryKey(),
  slot: bigint("slot", { mode: "bigint" }).notNull(),
  seq: bigint("seq", { mode: "bigint" }).notNull(),
});

const dialect = new PgDialect();

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
        options.onBackfillComplete?.(25n, 25n);
        yield* replayMocks.events;
      },
    }));
    checkpointMocks.getCheckpoint.mockResolvedValue(null);
    checkpointMocks.updateCheckpoint.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createStream(overrides: Record<string, unknown> = {}) {
    return {
      name: "test-accounts",
      description: "Test accounts",
      expectedSize: undefined,
      dataSizes: undefined,
      schema: {},
      table: accountsTable,
      getOwnerProgram: vi.fn(() => new Uint8Array([1])),
      parse: vi.fn(() => null),
      ...overrides,
    } as any;
  }

  function accountEvent(slot: bigint, overrides: Record<string, unknown> = {}) {
    const address = new Uint8Array(32).fill(1);
    return {
      type: "account",
      account: { address, addressHex: "01".repeat(32), data: new Uint8Array([1]), isDelete: false, slot, seq: 0n, ...overrides },
    };
  }

  /* An in-memory table that commits like Postgres: an INSERT's rows become
     visible when it commits, and a DELETE removes only committed rows. */
  function createDb(commitInsert: () => Promise<void> = async () => {}) {
    const rows = new Map<unknown, Record<string, unknown>>();
    const writes: string[] = [];
    const inserts: Array<Array<Record<string, unknown>>> = [];
    const db = {
      insert: () => ({
        values: (values: Record<string, unknown> | Array<Record<string, unknown>>) => ({
          onConflictDoUpdate: () => ({
            returning: async () => {
              const batch = Array.isArray(values) ? values : [values];
              inserts.push(batch);
              writes.push("insert");
              await commitInsert();
              for (const row of batch) rows.set(row.address, row);
              writes.push("insert committed");
              return batch;
            },
          }),
        }),
      }),
      delete: () => ({
        where: async (condition: SQL) => {
          writes.push("delete");
          rows.delete(dialect.sqlToQuery(condition).params[0]);
        },
      }),
    };
    checkpointMocks.updateCheckpoint.mockImplementation(async (_db: unknown, _name: string, slot: bigint) => {
      writes.push(`checkpoint ${slot}`);
    });
    return { db: db as any, rows, writes, inserts };
  }

  /* A drained replay whose live events the test pushes one at a time; it
     ends on end() or when the processor aborts it. */
  function liveReplay() {
    const queue: unknown[] = [];
    let wake = () => {};
    let ended = false;
    replayMocks.createAccountsByOwnerReplay.mockImplementation((options) => ({
      [Symbol.asyncIterator]: async function* () {
        options.onBackfillComplete?.(0n, 0n);
        for (;;) {
          while (queue.length > 0) yield queue.shift();
          if (ended || options.signal?.aborted) return;
          await new Promise<void>((resolve) => {
            wake = resolve;
            options.signal?.addEventListener("abort", () => resolve(), { once: true });
          });
        }
      },
    }));
    return {
      push: (...events: unknown[]) => {
        queue.push(...events);
        wake();
      },
      end: () => {
        ended = true;
        wake();
      },
    };
  }

  const addressOf = (byte: number) => new Uint8Array(32).fill(byte);
  const liveAccount = (byte: number, slot: bigint, overrides: Record<string, unknown> = {}) =>
    accountEvent(slot, { address: addressOf(byte), addressHex: byte.toString(16).padStart(2, "0").repeat(32), ...overrides });
  const row = (byte: number, slot: bigint) => ({ address: encodeAddress(addressOf(byte)), slot });

  const parseAccount = (account: { address: Uint8Array; slot: bigint }) => ({
    address: encodeAddress(account.address),
    slot: account.slot,
  });

  it("observes consumed empty blocks without inventing a persisted checkpoint", async () => {
    replayMocks.events = [{ type: "blockFinished", block: { slot: 100n } }, { type: "blockFinished", block: { slot: 101n } }];
    const onProgress = vi.fn();
    await runAccountStreamProcessor(createStream(), { clientFactory: vi.fn(), db: {} as any, logLevel: "error", observer: { onProgress } });
    expect(onProgress.mock.calls).toEqual([[{ slot: 100n }], [{ slot: 101n }]]);
    expect(checkpointMocks.updateCheckpoint).not.toHaveBeenCalled();
  });

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
    let replaySignal: AbortSignal | undefined;
    replayMocks.createAccountsByOwnerReplay.mockImplementation((options) => ({
      [Symbol.asyncIterator]: async function* () {
        replaySignal = options.signal;
        while (!options.signal?.aborted) await new Promise((resolve) => setTimeout(resolve, 5));
      },
    }));

    const processing = runAccountStreamProcessor(
      createStream(),
      {
        clientFactory: vi.fn(),
        db: {} as any,
        logLevel: "error",
      },
      controller.signal
    );

    await vi.waitFor(() => expect(replaySignal?.aborted).toBe(false));
    controller.abort();
    await processing;
    expect(replaySignal?.aborted).toBe(true);
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
      table: accountsTable,
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

  it("reports a deleted row after success and checkpoints only after the block checkpoint is persisted", async () => {
    replayMocks.events = [
      { type: "account", account: {
        address: new Uint8Array(32).fill(1), addressHex: "01".repeat(32),
        data: new Uint8Array(), isDelete: true, slot: 5n,
      } },
      { type: "blockFinished", block: { slot: 10n } },
    ];
    let finishDelete!: () => void;
    const deletion = new Promise<void>((resolve) => { finishDelete = resolve; });
    let finishCheckpoint!: () => void;
    const checkpoint = new Promise<void>((resolve) => { finishCheckpoint = resolve; });
    const where = vi.fn(() => deletion);
    checkpointMocks.updateCheckpoint.mockImplementationOnce(() => checkpoint);
    const onBatchCommitted = vi.fn();
    const onCheckpoint = vi.fn();
    const db = { delete: vi.fn(() => ({ where })) };

    const processing = runAccountStreamProcessor(createStream({
      table: accountsTable,
    }), {
      clientFactory: vi.fn(), db: db as any, logLevel: "error",
      observer: { onBatchCommitted, onCheckpoint },
    });

    await vi.waitFor(() => expect(where).toHaveBeenCalledTimes(1));
    expect(onBatchCommitted).not.toHaveBeenCalled();
    expect(onCheckpoint).not.toHaveBeenCalled();
    expect(checkpointMocks.updateCheckpoint).not.toHaveBeenCalled();
    finishDelete();

    await vi.waitFor(() => expect(checkpointMocks.updateCheckpoint).toHaveBeenCalledTimes(1));
    expect(onBatchCommitted).toHaveBeenCalledExactlyOnceWith({ slot: 5n, count: 1 });
    expect(checkpointMocks.updateCheckpoint).toHaveBeenCalledWith(db, "account:test-accounts", 5n, null);
    expect(onCheckpoint).not.toHaveBeenCalled();
    finishCheckpoint();
    await processing;

    expect(onBatchCommitted).toHaveBeenCalledTimes(1);
    expect(onCheckpoint.mock.calls).toEqual([[{ slot: 5n }], [{ slot: 5n }]]);
  });

  it("does not report a committed deletion or checkpoint when deleting the row fails", async () => {
    replayMocks.events = [{ type: "account", account: {
      address: new Uint8Array(32).fill(1), addressHex: "01".repeat(32),
      data: new Uint8Array(), isDelete: true, slot: 5n,
    } }];
    const failure = new Error("row deletion failed");
    const where = vi.fn().mockRejectedValue(failure);
    const onBatchCommitted = vi.fn();
    const onCheckpoint = vi.fn();
    const onError = vi.fn();

    await expect(runAccountStreamProcessor(createStream({
      table: accountsTable,
    }), {
      clientFactory: vi.fn(), db: { delete: () => ({ where }) } as any,
      logLevel: "error", observer: { onBatchCommitted, onCheckpoint, onError },
    })).rejects.toBe(failure);
    expect(onBatchCommitted).not.toHaveBeenCalled();
    expect(onCheckpoint).not.toHaveBeenCalled();
    expect(checkpointMocks.updateCheckpoint).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith("commit", failure);
  });

  it("does not report a persisted checkpoint when checkpointing a successfully deleted row fails", async () => {
    replayMocks.events = [
      { type: "account", account: {
        address: new Uint8Array(32).fill(1), addressHex: "01".repeat(32),
        data: new Uint8Array(), isDelete: true, slot: 5n,
      } },
      { type: "blockFinished", block: { slot: 10n } },
    ];
    const failure = new Error("checkpoint write failed");
    checkpointMocks.updateCheckpoint.mockRejectedValueOnce(failure);
    const onBatchCommitted = vi.fn();
    const onCheckpoint = vi.fn();

    await expect(runAccountStreamProcessor(createStream({
      table: accountsTable,
    }), {
      clientFactory: vi.fn(), db: { delete: () => ({ where: async () => undefined }) } as any,
      logLevel: "error", observer: { onBatchCommitted, onCheckpoint },
    })).rejects.toBe(failure);
    expect(onBatchCommitted).toHaveBeenCalledExactlyOnceWith({ slot: 5n, count: 1 });
    expect(onCheckpoint).not.toHaveBeenCalled();
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
    /* Postgres RETURNING "slot" hands back the written row's slot. */
    const returning = vi.fn(async () => [{ address: "account-1", slot: 5n }]);
    const onConflictDoUpdate = vi.fn(() => ({ returning }));
    const values = vi.fn(() => ({ onConflictDoUpdate }));
    const insert = vi.fn(() => ({ values }));

    await runAccountStreamProcessor(
      createStream({
        table: accountsTable,
        api: { idField: "address" },
        parse: vi.fn(() => ({ address: "account-1", slot: 5n })),
      }),
      {
        clientFactory: vi.fn(),
        db: { insert } as any,
        logLevel: "error",
      }
    );

    expect(values.mock.calls).toEqual([[[{ address: "account-1", slot: 5n }]]]);
    expect(checkpointMocks.updateCheckpoint.mock.calls).toEqual([
      [expect.anything(), "account:test-accounts", 5n, null],
      [expect.anything(), "account:test-accounts", 5n, null],
    ]);
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
        options.onBackfillComplete?.(25n, 25n);
        await live;
      },
    }));
    const returning = vi.fn(async () => [{ address: "account-1", slot }]);
    const onConflictDoUpdate = vi.fn(() => ({ returning }));
    const values = vi.fn(() => ({ onConflictDoUpdate }));
    const insert = vi.fn(() => ({ values }));
    const onCheckpoint = vi.fn();

    const processing = runAccountStreamProcessor(
      createStream({
        table: accountsTable,
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

    await expect(runAccountStreamProcessor(
      createStream({
        table: accountsTable,
        api: { idField: "address" },
        parse: vi.fn(() => ({ address: "account-1", slot: 20n })),
      }),
      {
        clientFactory: vi.fn(),
        db: { insert } as any,
        logLevel: "error",
      }
    )).resolves.toMatchObject({ accountsProcessed: 1 });

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
        options.onBackfillComplete?.(5n, 5n);
        yield { type: "blockFinished", block: { slot: 6n } };
      },
    }));
    const returning = vi.fn(async () => [{ address: "account-1", slot: 5n }]);
    const onConflictDoUpdate = vi.fn(() => ({ returning }));
    const values = vi.fn(() => ({ onConflictDoUpdate }));
    const insert = vi.fn(() => ({ values }));

    await expect(
      runAccountStreamProcessor(
        createStream({
          table: accountsTable,
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
    expect(checkpointMocks.updateCheckpoint).toHaveBeenCalledTimes(3);
  });

  it("orders same-slot upserts by sequence, in backfill batches and live rows", async () => {
    replayMocks.createAccountsByOwnerReplay.mockImplementation((options) => ({
      [Symbol.asyncIterator]: async function* () {
        yield accountEvent(5n, { seq: 2n });
        options.onBackfillComplete?.(5n, 5n);
        yield accountEvent(6n, { seq: 3n });
      },
    }));
    const returning = vi.fn(async () => [{ address: "account-1", slot: 5n }]);
    const onConflictDoUpdate = vi.fn((_conflict: { set: Record<string, SQL>; where: SQL }) => ({ returning }));
    const values = vi.fn((_rows: unknown) => ({ onConflictDoUpdate }));
    const insert = vi.fn(() => ({ values }));

    await runAccountStreamProcessor(
      createStream({
        table: sequencedAccountsTable,
        api: { idField: "address" },
        parse: vi.fn((account) => ({ address: "account-1", slot: account.slot, seq: account.seq })),
      }),
      {
        clientFactory: vi.fn(),
        db: { insert } as any,
        logLevel: "error",
      }
    );

    expect(values.mock.calls).toEqual([
      [[{ address: "account-1", slot: 5n, seq: 2n }]],
      [[{ address: "account-1", slot: 6n, seq: 3n }]],
    ]);
    const versionGuard = {
      sql: '("test_sequenced_accounts"."slot" < excluded."slot" or ("test_sequenced_accounts"."slot" = excluded."slot" and "test_sequenced_accounts"."seq" <= excluded."seq"))',
      params: [],
    };
    const conflicts = onConflictDoUpdate.mock.calls.map(([conflict]) => ({
      set: Object.fromEntries(Object.entries(conflict.set).map(([key, value]) => [key, dialect.sqlToQuery(value).sql])),
      where: dialect.sqlToQuery(conflict.where),
    }));
    const setFromProposed = { address: 'excluded."address"', slot: 'excluded."slot"', seq: 'excluded."seq"' };
    expect(conflicts).toEqual([
      { set: setFromProposed, where: versionGuard },
      { set: setFromProposed, where: versionGuard },
    ]);
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

  it("never checkpoints past the slot the live stream delivered", async () => {
    replayMocks.createAccountsByOwnerReplay.mockImplementation((options) => ({
      [Symbol.asyncIterator]: async function* () {
        yield accountEvent(9_000n);
        options.onBackfillComplete?.(9_000n, 5_000n);
        yield { type: "blockFinished", block: { slot: 8_000n } };
        yield { type: "blockFinished", block: { slot: 9_100n } };
      },
    }));
    const { db } = createDb();

    await runAccountStreamProcessor(createStream({ parse: vi.fn(parseAccount) }), {
      clientFactory: vi.fn(), db, logLevel: "error",
    });

    expect(checkpointMocks.updateCheckpoint.mock.calls.map(([, , slot]) => slot)).toEqual([5_000n, 8_000n, 9_000n, 9_000n]);
  });

  it("checkpoints after the backfill on a quiet chain whose stream delivered nothing", async () => {
    const controller = new AbortController();
    replayMocks.createAccountsByOwnerReplay.mockImplementation((options) => ({
      [Symbol.asyncIterator]: async function* () {
        yield accountEvent(9_000n);
        options.onBackfillComplete?.(9_000n, 0n);
        while (!options.signal?.aborted) await new Promise((resolve) => setTimeout(resolve, 5));
      },
    }));
    const { db } = createDb();
    const onCheckpoint = vi.fn();

    const processing = runAccountStreamProcessor(createStream({ parse: vi.fn(parseAccount) }), {
      clientFactory: vi.fn(), db, logLevel: "error", observer: { onCheckpoint },
    }, controller.signal);

    await vi.waitFor(() => expect(onCheckpoint).toHaveBeenCalledWith({ slot: 0n }));
    expect(checkpointMocks.updateCheckpoint).toHaveBeenCalledExactlyOnceWith(db, "account:test-accounts", 0n, null);
    controller.abort();
    await processing;
  });

  it("rejects with the final backfill flush's error, even when no live event wakes the loop", async () => {
    let replaySignal: AbortSignal | undefined;
    replayMocks.createAccountsByOwnerReplay.mockImplementation((options) => ({
      [Symbol.asyncIterator]: async function* () {
        replaySignal = options.signal;
        yield accountEvent(5n);
        options.onBackfillComplete?.(5n, 5n);
        while (!options.signal?.aborted) await new Promise((resolve) => setTimeout(resolve, 5));
      },
    }));
    const failure = new Error("connection reset");
    const { db, rows } = createDb(async () => {
      throw failure;
    });
    const onError = vi.fn();

    await expect(runAccountStreamProcessor(createStream({ parse: vi.fn(parseAccount) }), {
      clientFactory: vi.fn(), db, logLevel: "error", observer: { onError },
    })).rejects.toBe(failure);
    expect(replaySignal?.aborted).toBe(true);
    expect(onError).toHaveBeenCalledWith("commit", failure);
    expect(checkpointMocks.updateCheckpoint).not.toHaveBeenCalled();
    expect(rows.size).toBe(0);
  });

  it("holds a live delete until the final backfill flush commits, so the flush cannot bring the row back", async () => {
    replayMocks.createAccountsByOwnerReplay.mockImplementation((options) => ({
      [Symbol.asyncIterator]: async function* () {
        yield accountEvent(5n);
        options.onBackfillComplete?.(5n, 5n);
        yield accountEvent(6n, { isDelete: true });
      },
    }));
    let commitFlush!: () => void;
    const flushCommitted = new Promise<void>((resolve) => {
      commitFlush = resolve;
    });
    const { db, rows, writes } = createDb(() => flushCommitted);

    const processing = runAccountStreamProcessor(createStream({ parse: vi.fn(parseAccount) }), {
      clientFactory: vi.fn(), db, logLevel: "error",
    });
    await vi.waitFor(() => expect(writes).toEqual(["insert"]));
    /* Room for a delete that does not wait to run before the flush commits. */
    await new Promise((resolve) => setTimeout(resolve, 20));
    commitFlush();
    await processing;

    expect(writes).toEqual(["insert", "insert committed", "checkpoint 5", "delete", "checkpoint 5"]);
    expect([...rows.keys()]).toEqual([]);
  });

  it("writes a block's live rows in one insert, then checkpoints the block", async () => {
    replayMocks.events = [
      liveAccount(1, 7n),
      liveAccount(2, 7n),
      liveAccount(3, 7n),
      { type: "blockFinished", block: { slot: 7n } },
    ];
    const { db, writes, inserts } = createDb();

    const stats = await runAccountStreamProcessor(createStream({ parse: vi.fn(parseAccount) }), {
      clientFactory: vi.fn(), db, logLevel: "error",
    });

    expect(inserts).toEqual([[row(1, 7n), row(2, 7n), row(3, 7n)]]);
    expect(writes).toEqual(["insert", "insert committed", "checkpoint 7", "checkpoint 7"]);
    expect(stats).toEqual({ accountsProcessed: 3, accountsUpdated: 3, accountsDeleted: 0 });
  });

  it("does not checkpoint a block until its rows are written, and checkpoints each block after its own insert", async () => {
    replayMocks.events = [
      liveAccount(1, 7n),
      { type: "blockFinished", block: { slot: 7n } },
      liveAccount(2, 8n),
      { type: "blockFinished", block: { slot: 8n } },
    ];
    let commitFirst!: () => void;
    const firstCommitted = new Promise<void>((resolve) => {
      commitFirst = resolve;
    });
    const { db, writes, inserts } = createDb(() => firstCommitted);

    const processing = runAccountStreamProcessor(createStream({ parse: vi.fn(parseAccount) }), {
      clientFactory: vi.fn(), db, logLevel: "error",
    });
    await vi.waitFor(() => expect(writes).toEqual(["insert"]));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(writes).toEqual(["insert"]);
    commitFirst();
    await processing;

    expect(inserts).toEqual([[row(1, 7n)], [row(2, 8n)]]);
    expect(writes).toEqual([
      "insert", "insert committed", "checkpoint 7",
      "insert", "insert committed", "checkpoint 8",
      "checkpoint 8",
    ]);
  });

  it("writes a live row after 250 ms of quiet with no block marker, and not before", async () => {
    vi.useFakeTimers();
    const live = liveReplay();
    live.push(liveAccount(1, 7n));
    const { db, writes, inserts } = createDb();

    const processing = runAccountStreamProcessor(createStream({ parse: vi.fn(parseAccount) }), {
      clientFactory: vi.fn(), db, logLevel: "error",
    });
    await vi.advanceTimersByTimeAsync(249);
    expect(writes).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(inserts).toEqual([[row(1, 7n)]]);
    expect(writes).toEqual(["insert", "insert committed"]);

    live.push({ type: "blockFinished", block: { slot: 7n } });
    live.end();
    await processing;
    expect(inserts).toEqual([[row(1, 7n)]]);
    expect(writes).toEqual(["insert", "insert committed", "checkpoint 7", "checkpoint 7"]);
  });

  it("drops a row buffered earlier in the block when the account is deleted, so the block insert cannot bring it back", async () => {
    replayMocks.events = [
      liveAccount(1, 7n),
      liveAccount(2, 7n),
      liveAccount(1, 7n, { isDelete: true }),
      { type: "blockFinished", block: { slot: 7n } },
    ];
    const { db, rows, writes, inserts } = createDb();
    rows.set(encodeAddress(addressOf(1)), row(1, 6n));

    const stats = await runAccountStreamProcessor(createStream({ parse: vi.fn(parseAccount) }), {
      clientFactory: vi.fn(), db, logLevel: "error",
    });

    expect(writes).toEqual(["delete", "insert", "insert committed", "checkpoint 7", "checkpoint 7"]);
    expect(inserts).toEqual([[row(2, 7n)]]);
    expect([...rows.values()]).toEqual([row(2, 7n)]);
    expect(stats).toEqual({ accountsProcessed: 3, accountsUpdated: 1, accountsDeleted: 1 });
  });

  it("writes rows still buffered when the replay ends before a block marker", async () => {
    replayMocks.events = [liveAccount(1, 7n), liveAccount(2, 8n)];
    const { db, writes, inserts } = createDb();

    await runAccountStreamProcessor(createStream({ parse: vi.fn(parseAccount) }), {
      clientFactory: vi.fn(), db, logLevel: "error",
    });

    expect(inserts).toEqual([[row(1, 7n), row(2, 8n)]]);
    expect(writes).toEqual(["insert", "insert committed", "checkpoint 8"]);
  });

  it("writes rows still buffered when the caller aborts before the idle flush", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const live = liveReplay();
    live.push(liveAccount(1, 7n));
    const { db, writes, inserts } = createDb();

    const processing = runAccountStreamProcessor(createStream({ parse: vi.fn(parseAccount) }), {
      clientFactory: vi.fn(), db, logLevel: "error",
    }, controller.signal);
    await vi.advanceTimersByTimeAsync(100);
    expect(writes).toEqual([]);
    controller.abort();
    const stats = await processing;

    expect(inserts).toEqual([[row(1, 7n)]]);
    expect(writes).toEqual(["insert", "insert committed", "checkpoint 0"]);
    expect(stats).toEqual({ accountsProcessed: 1, accountsUpdated: 1, accountsDeleted: 0 });
  });

  it("does not handle the next event while an idle flush is still writing", async () => {
    vi.useFakeTimers();
    const live = liveReplay();
    live.push(liveAccount(1, 7n));
    let commitIdleFlush!: () => void;
    const idleFlushCommitted = new Promise<void>((resolve) => {
      commitIdleFlush = resolve;
    });
    const { db, writes, inserts } = createDb(() => idleFlushCommitted);
    const onRecord = vi.fn();

    const processing = runAccountStreamProcessor(createStream({ parse: vi.fn(parseAccount) }), {
      clientFactory: vi.fn(), db, logLevel: "error", observer: { onRecord },
    });
    await vi.advanceTimersByTimeAsync(250);
    expect(writes).toEqual(["insert"]);
    live.push(liveAccount(2, 8n), { type: "blockFinished", block: { slot: 8n } });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(onRecord.mock.calls).toEqual([[{ slot: 7n, id: "01".repeat(32) }]]);
    expect(writes).toEqual(["insert"]);

    commitIdleFlush();
    await vi.advanceTimersByTimeAsync(0);
    live.end();
    await processing;
    expect(onRecord.mock.calls).toEqual([[{ slot: 7n, id: "01".repeat(32) }], [{ slot: 8n, id: "02".repeat(32) }]]);
    expect(inserts).toEqual([[row(1, 7n)], [row(2, 8n)]]);
    expect(writes).toEqual(["insert", "insert committed", "insert", "insert committed", "checkpoint 8", "checkpoint 8"]);
  });
});
