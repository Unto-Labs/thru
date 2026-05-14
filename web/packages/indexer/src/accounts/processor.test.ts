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

  it("persists the last handled account slot at block boundaries, not the block slot", async () => {
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
