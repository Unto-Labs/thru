import { create } from "@bufbuild/protobuf";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  AccountDataSchema,
  AccountMetaSchema,
  AccountPageSchema,
  AccountSchema,
  AccountUpdateSchema,
  BlockFinishedSchema,
  ListAccountsResponseSchema,
  PubkeySchema,
  StreamAccountUpdatesResponseSchema,
  VersionContextMetadataSchema,
  type Account,
  type ListAccountsResponse,
  type StreamAccountUpdatesResponse,
} from "@thru/sdk/proto";
import { createAccountsByOwnerReplay, AccountSeqTracker } from "./account-replay";
import { PAGE_SIZE } from "./page-assembler";
import type { AccountSource } from "./chain-client";
import type { RetryConfig } from "./retry";
import type { ReplayLogger } from "./types";

const TEST_RETRY_CONFIG: RetryConfig = {
  initialDelayMs: 5,
  maxDelayMs: 5,
  connectionTimeoutMs: 20,
};

const SLOW_BACKOFF_RETRY_CONFIG: RetryConfig = {
  initialDelayMs: 1000,
  maxDelayMs: 1000,
  connectionTimeoutMs: 20,
};

describe("account-owner replay reconnect cleanup", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test("starts a fresh stream before stale cleanup and idle-timeout backoff", async () => {
    const owner = bytes(1);
    const staleStream = createHangingStream();
    const freshStream = createSnapshotThenClosableStream(makeSnapshot(bytes(2), owner, 42n));
    const client1 = createMockClient(staleStream.iterable);
    const client2 = createMockClient(freshStream.iterable);
    const clients = [client1, client2];
    const clientFactory = vi.fn(() => clients.shift() ?? client2);
    const logger = createMockLogger();

    const replay = createAccountsByOwnerReplay({
      clientFactory,
      owner,
      logger,
      retryConfig: SLOW_BACKOFF_RETRY_CONFIG,
      reconnectCleanupTimeoutMs: 7,
      cleanupInterval: 1000,
    });
    const iterator = replay[Symbol.asyncIterator]();
    const nextEvent = iterator.next();

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(SLOW_BACKOFF_RETRY_CONFIG.connectionTimeoutMs + 11);
    await vi.advanceTimersByTimeAsync(0);

    await expect(nextEvent).resolves.toMatchObject({
      done: false,
      value: {
        type: "account",
        account: {
          addressHex: "02",
          slot: 42n,
          source: "stream",
        },
      },
    });

    expect(clientFactory).toHaveBeenCalledTimes(2);
    expect(client1.streamAccountUpdates).toHaveBeenCalledTimes(1);
    expect(client2.streamAccountUpdates).toHaveBeenCalledTimes(1);
    expect(staleStream.return).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      "Replay stream idle timeout detected",
      expect.objectContaining({
        event: "replay.stream.idle_timeout",
        connectionTimeoutMs: SLOW_BACKOFF_RETRY_CONFIG.connectionTimeoutMs,
      })
    );
    expect(logger.warn).toHaveBeenCalledWith(
      "Replay stream reconnect started",
      expect.objectContaining({
        event: "replay.stream.reconnect.started",
        idle_timeout: true,
        backoffMs: 0,
      })
    );

    await vi.advanceTimersByTimeAsync(7);
    await vi.advanceTimersByTimeAsync(7);

    expect(logger.warn).toHaveBeenCalledWith(
      "Replay stream reconnect cleanup stuck",
      expect.objectContaining({
        event: "replay.stream.reconnect.stuck",
        phase: "old processor drain",
        timeout_ms: 7,
      })
    );
    expect(logger.info).toHaveBeenCalledWith(
      "Replay stream fresh client creation completed",
      expect.objectContaining({ event: "replay.stream.reconnect.client_completed" })
    );
    expect(logger.info).toHaveBeenCalledWith(
      "Replay stream waiting for first event",
      expect.objectContaining({ event: "replay.stream.waiting_first_event" })
    );
    expect(logger.info).toHaveBeenCalledWith(
      "Replay stream reconnect completed",
      expect.objectContaining({ event: "replay.stream.reconnect.completed" })
    );

    await iterator.return?.();
    await vi.advanceTimersByTimeAsync(7);
  });

  test("catch-up yields accounts updated while reconnecting", async () => {
    const owner = bytes(3);
    const firstAccount = makeAccount(bytes(4), owner, 100n, 1n);
    const catchUpAccount = makeAccount(bytes(5), owner, 101n, 2n);
    const staleStream = createSnapshotThenHangingStream(accountToSnapshot(firstAccount));
    const freshStream = createHangingStream();
    const client1 = createMockClient(staleStream.iterable);
    const client2 = createMockClient(freshStream.iterable);
    client2.listAccounts.mockResolvedValue(
      create(ListAccountsResponseSchema, { accounts: [catchUpAccount] })
    );
    client2.getAccount.mockResolvedValue(catchUpAccount);
    const clients = [client1, client2];
    const clientFactory = vi.fn(() => clients.shift() ?? client2);
    const logger = createMockLogger();

    const replay = createAccountsByOwnerReplay({
      clientFactory,
      owner,
      logger,
      retryConfig: SLOW_BACKOFF_RETRY_CONFIG,
      reconnectCleanupTimeoutMs: 1000,
      cleanupInterval: 1000,
    });
    const iterator = replay[Symbol.asyncIterator]();

    const firstEvent = iterator.next();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(10);
    await expect(firstEvent).resolves.toMatchObject({
      done: false,
      value: {
        type: "account",
        account: {
          addressHex: "04",
          slot: 100n,
          source: "stream",
        },
      },
    });

    const nextEvent = iterator.next();
    await vi.advanceTimersByTimeAsync(SLOW_BACKOFF_RETRY_CONFIG.connectionTimeoutMs + 11);
    await vi.advanceTimersByTimeAsync(0);

    await expect(nextEvent).resolves.toMatchObject({
      done: false,
      value: {
        type: "account",
        account: {
          addressHex: "05",
          slot: 101n,
          source: "backfill",
        },
      },
    });

    expect(clientFactory).toHaveBeenCalledTimes(2);
    expect(client2.streamAccountUpdates).toHaveBeenCalledTimes(1);
    expect(client2.listAccounts).toHaveBeenCalledWith(
      expect.objectContaining({
        filter: expect.objectContaining({
          params: expect.objectContaining({
            min_updated_slot: expect.objectContaining({
              kind: { case: "uintValue", value: 100n },
            }),
          }),
        }),
      })
    );
    expect(client2.getAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        versionContext: expect.objectContaining({
          version: { case: "slot", value: 101n },
        }),
      })
    );
    expect(logger.info).toHaveBeenCalledWith(
      "Replay stream reconnect catch-up completed",
      expect.objectContaining({
        event: "replay.stream.reconnect.catch_up_completed",
        from_slot: "100",
        accounts_queued: 1,
      })
    );

    const close = iterator.return?.();
    await vi.advanceTimersByTimeAsync(5000);
    await close;
  });

  test("catch-up getAccount failures still emit readable deferred accounts", async () => {
    const owner = bytes(33);
    const firstAccount = makeAccount(bytes(34), owner, 100n, 1n);
    const failedCatchUpAccount = makeAccount(bytes(35), owner, 101n, 2n);
    const readableCatchUpAccount = makeAccount(bytes(36), owner, 102n, 3n);
    const staleStream = createSnapshotThenHangingStream(accountToSnapshot(firstAccount));
    const freshStream = createHangingStream();
    const client1 = createMockClient(staleStream.iterable);
    const client2 = createMockClient(freshStream.iterable);
    client2.listAccounts.mockResolvedValue(
      create(ListAccountsResponseSchema, { accounts: [failedCatchUpAccount, readableCatchUpAccount] })
    );
    client2.getAccount.mockImplementation(async (request) => {
      if (request.address?.value[0] === 35) throw new Error("seq mismatch");
      return readableCatchUpAccount;
    });
    const clients = [client1, client2];
    const clientFactory = vi.fn(() => clients.shift() ?? client2);
    const logger = createMockLogger();

    const replay = createAccountsByOwnerReplay({
      clientFactory,
      owner,
      logger,
      retryConfig: SLOW_BACKOFF_RETRY_CONFIG,
      maxRetries: 2,
      reconnectCleanupTimeoutMs: 1000,
      healthLogIntervalMs: 50,
      cleanupInterval: 1000,
    });
    const iterator = replay[Symbol.asyncIterator]();

    const firstEvent = iterator.next();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(10);
    await expect(firstEvent).resolves.toMatchObject({
      done: false,
      value: {
        type: "account",
        account: {
          addressHex: "22",
          slot: 100n,
          source: "stream",
        },
      },
    });

    const readableCatchUpEvent = iterator.next();
    await vi.advanceTimersByTimeAsync(SLOW_BACKOFF_RETRY_CONFIG.connectionTimeoutMs + 11);
    await vi.advanceTimersByTimeAsync(100);

    await expect(readableCatchUpEvent).resolves.toMatchObject({
      done: false,
      value: {
        type: "account",
        account: {
          addressHex: "24",
          slot: 102n,
          source: "backfill",
        },
      },
    });

    expect(client2.getAccount).toHaveBeenCalledTimes(3);
    expect(logger.error).toHaveBeenCalledWith(
      "Replay account fetch failed",
      expect.objectContaining({
        event: "replay.account.fetch_failed",
        phase: "catch_up",
        address: "23",
        slot: "101",
        attempts: 2,
        error: expect.any(Error),
      })
    );
    expect(logger.warn).toHaveBeenCalledWith(
      "Replay stream reconnect catch-up failed",
      expect.objectContaining({
        event: "replay.stream.reconnect.catch_up_failed",
        error: expect.objectContaining({ name: "DeferredAccountFetchError" }),
      })
    );

    await vi.advanceTimersByTimeAsync(50);
    expect(logger.info).toHaveBeenCalledWith(
      "Replay health summary",
      expect.objectContaining({
        event: "replay.health",
        fetch_failures_total: 1,
      })
    );

    const close = iterator.return?.();
    await vi.advanceTimersByTimeAsync(5000);
    await close;
  });

  test("catch-up list failures retry through reconnect instead of ending replay", async () => {
    const owner = bytes(6);
    const firstAccount = makeAccount(bytes(7), owner, 100n, 1n);
    const catchUpAccount = makeAccount(bytes(8), owner, 101n, 2n);
    const liveAccountAfterGap = makeAccount(bytes(9), owner, 200n, 3n);
    const initialStream = createSnapshotThenHangingStream(accountToSnapshot(firstAccount));
    const failedCatchUpStream = createSequenceThenHangingStream([
      accountToSnapshot(liveAccountAfterGap),
      makeBlockFinished(200n),
    ]);
    const successfulCatchUpStream = createSequenceThenHangingStream([
      accountToSnapshot(liveAccountAfterGap),
      makeBlockFinished(200n),
    ]);
    const client1 = createMockClient(initialStream.iterable);
    const client2 = createMockClient(failedCatchUpStream.iterable);
    const client3 = createMockClient(successfulCatchUpStream.iterable);
    client2.listAccounts.mockRejectedValue(new Error("list boom"));
    client3.listAccounts.mockResolvedValue(
      create(ListAccountsResponseSchema, { accounts: [catchUpAccount] })
    );
    client3.getAccount.mockResolvedValue(catchUpAccount);
    const clients = [client1, client2, client3];
    const clientFactory = vi.fn(() => clients.shift() ?? client3);
    const logger = createMockLogger();

    const replay = createAccountsByOwnerReplay({
      clientFactory,
      owner,
      logger,
      retryConfig: SLOW_BACKOFF_RETRY_CONFIG,
      maxRetries: 2,
      reconnectCleanupTimeoutMs: 1000,
      cleanupInterval: 1000,
    });
    const iterator = replay[Symbol.asyncIterator]();

    const firstEvent = iterator.next();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(10);
    await expect(firstEvent).resolves.toMatchObject({
      done: false,
      value: {
        type: "account",
        account: {
          addressHex: "07",
          slot: 100n,
          source: "stream",
        },
      },
    });

    const recoveredCatchUpEvent = iterator.next();
    await vi.advanceTimersByTimeAsync(SLOW_BACKOFF_RETRY_CONFIG.connectionTimeoutMs + 11);
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(SLOW_BACKOFF_RETRY_CONFIG.initialDelayMs);
    await vi.advanceTimersByTimeAsync(0);

    await expect(recoveredCatchUpEvent).resolves.toMatchObject({
      done: false,
      value: {
        type: "account",
        account: {
          addressHex: "08",
          slot: 101n,
          source: "backfill",
        },
      },
    });

    const liveEventAfterGap = iterator.next();
    await expect(liveEventAfterGap).resolves.toMatchObject({
      done: false,
      value: {
        type: "account",
        account: {
          addressHex: "09",
          slot: 200n,
          source: "stream",
        },
      },
    });

    const blockFinishedAfterGap = iterator.next();
    await expect(blockFinishedAfterGap).resolves.toMatchObject({
      done: false,
      value: {
        type: "blockFinished",
        block: {
          slot: 200n,
        },
      },
    });

    expect(clientFactory).toHaveBeenCalledTimes(3);
    expect(client2.listAccounts).toHaveBeenCalledTimes(2);
    expect(client3.listAccounts).toHaveBeenCalledTimes(1);
    expect(client3.listAccounts).toHaveBeenCalledWith(
      expect.objectContaining({
        filter: expect.objectContaining({
          params: expect.objectContaining({
            min_updated_slot: expect.objectContaining({
              kind: { case: "uintValue", value: 100n },
            }),
          }),
        }),
      })
    );
    expect(logger.error).toHaveBeenCalledWith(
      "Replay stream reconnect catch-up list accounts failed",
      expect.objectContaining({
        event: "replay.stream.reconnect.catch_up_list_failed",
        attempts: 2,
      })
    );
    expect(logger.warn).toHaveBeenCalledWith(
      "Replay stream reconnect catch-up failed",
      expect.objectContaining({
        event: "replay.stream.reconnect.catch_up_failed",
      })
    );

    const close = iterator.return?.();
    await vi.advanceTimersByTimeAsync(5000);
    await close;
  });

  test("backfill getAccount failures reject after readable accounts are emitted", async () => {
    const owner = bytes(30);
    const failedAccount = makeAccount(bytes(31), owner, 50n, 1n);
    const readableAccount = makeAccount(bytes(32), owner, 51n, 1n);
    const client = createMockClient(createEndingStream().iterable);
    client.listAccounts.mockResolvedValue(
      create(ListAccountsResponseSchema, { accounts: [failedAccount, readableAccount] })
    );
    client.getAccount.mockImplementation(async (request) => {
      if (request.address?.value[0] === 31) throw new Error("seq mismatch");
      return readableAccount;
    });
    const logger = createMockLogger();

    const replay = createAccountsByOwnerReplay({
      client,
      owner,
      logger,
      maxRetries: 2,
      cleanupInterval: 1000,
    });
    const iterator = replay[Symbol.asyncIterator]();

    const readableEvent = iterator.next();
    await vi.advanceTimersByTimeAsync(100);

    await expect(readableEvent).resolves.toMatchObject({
      done: false,
      value: {
        type: "account",
        account: {
          addressHex: "20",
          slot: 51n,
          source: "backfill",
        },
      },
    });

    const deferredFailure = expect(iterator.next()).rejects.toThrow("Backfill failed to fetch 1 account");
    await vi.advanceTimersByTimeAsync(100);
    await deferredFailure;

    expect(client.getAccount).toHaveBeenCalledTimes(3);
    expect(client.getAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        address: expect.objectContaining({ value: bytes(32) }),
        versionContext: expect.objectContaining({
          version: { case: "slot", value: 51n },
        }),
      })
    );
    expect(logger.error).toHaveBeenCalledWith(
      "Replay account fetch failed",
      expect.objectContaining({
        event: "replay.account.fetch_failed",
        phase: "backfill",
        address: "1f",
        slot: "50",
        attempts: 2,
        error: expect.any(Error),
      })
    );

    await iterator.return?.();
  });

  test("stream-ended reconnect increments attempts until a stream message arrives", async () => {
    const owner = bytes(11);
    const liveStream = createSnapshotThenClosableStream(makeSnapshot(bytes(12), owner, 200n));
    const client1 = createMockClient(createEndingStream().iterable);
    const client2 = createMockClient(createEndingStream().iterable);
    const client3 = createMockClient(liveStream.iterable);
    const clients = [client1, client2, client3];
    const clientFactory = vi.fn(() => clients.shift() ?? client3);
    const logger = createMockLogger();

    const replay = createAccountsByOwnerReplay({
      clientFactory,
      owner,
      logger,
      retryConfig: TEST_RETRY_CONFIG,
      cleanupInterval: 1000,
    });
    const iterator = replay[Symbol.asyncIterator]();
    const nextEvent = iterator.next();

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(10);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(10);
    await vi.advanceTimersByTimeAsync(0);

    await expect(nextEvent).resolves.toMatchObject({
      done: false,
      value: {
        type: "account",
        account: {
          addressHex: "0c",
          slot: 200n,
          source: "stream",
        },
      },
    });

    expect(logger.warn).toHaveBeenCalledWith(
      "Replay stream reconnect started",
      expect.objectContaining({
        reason: "stream_ended",
        attempt: 1,
      })
    );
    expect(logger.warn).toHaveBeenCalledWith(
      "Replay stream reconnect started",
      expect.objectContaining({
        reason: "stream_ended",
        attempt: 2,
      })
    );

    await iterator.return?.();
  });

  test("aborting during reconnect cleanup exits without creating runaway streams", async () => {
    const owner = bytes(9);
    const controller = new AbortController();
    const staleStream = createHangingStream();
    const freshStream = createHangingStream();
    const client1 = createMockClient(staleStream.iterable);
    const client2 = createMockClient(freshStream.iterable);
    const clients = [client1, client2];
    const clientFactory = vi.fn(() => clients.shift() ?? client2);
    const logger = createMockLogger();

    const replay = createAccountsByOwnerReplay({
      clientFactory,
      owner,
      logger,
      signal: controller.signal,
      retryConfig: TEST_RETRY_CONFIG,
      reconnectCleanupTimeoutMs: 1000,
      cleanupInterval: 1000,
    });
    const iterator = replay[Symbol.asyncIterator]();
    const nextEvent = iterator.next();

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(TEST_RETRY_CONFIG.connectionTimeoutMs + 11);
    expect(staleStream.return).toHaveBeenCalledTimes(1);
    expect(clientFactory).toHaveBeenCalledTimes(2);

    controller.abort();

    await expect(nextEvent).resolves.toEqual({ done: true, value: undefined });
    expect(client1.streamAccountUpdates).toHaveBeenCalledTimes(1);
    expect(client2.streamAccountUpdates).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5000);
    expect(clientFactory).toHaveBeenCalledTimes(2);
    expect(client2.streamAccountUpdates).toHaveBeenCalledTimes(1);
  });
});

describe("account replay operational logging", () => {
  const OPERATIONAL_RETRY_CONFIG: RetryConfig = {
    initialDelayMs: 5,
    maxDelayMs: 5,
    connectionTimeoutMs: 60_000,
  };

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test("queue warnings fire at the threshold, on doubling, and after reset", async () => {
    const owner = bytes(30);
    const stream = createPushableStream();
    const client = createMockClient(stream.iterable);
    const logger = createMockLogger();
    const replay = createAccountsByOwnerReplay({
      client,
      owner,
      logger,
      queueWarningThreshold: 2,
      healthLogIntervalMs: 0,
      retryConfig: OPERATIONAL_RETRY_CONFIG,
    });
    const iterator = replay[Symbol.asyncIterator]();
    const firstEvent = iterator.next();

    await vi.advanceTimersByTimeAsync(0);
    for (let slot = 1n; slot <= 4n; slot++) {
      stream.push(makeBlockFinished(slot));
    }
    await vi.advanceTimersByTimeAsync(20);
    await expect(firstEvent).resolves.toMatchObject({ done: false });

    const queueWarnings = () =>
      vi.mocked(logger.warn).mock.calls.filter(([, meta]) =>
        meta?.event === "replay.queue.growing"
      );
    expect(queueWarnings()).toEqual([
      [
        "Replay queue is growing",
        {
          event: "replay.queue.growing",
          queue: "stream",
          queue_size: 2,
          warning_threshold: 2,
        },
      ],
      [
        "Replay queue is growing",
        {
          event: "replay.queue.growing",
          queue: "stream",
          queue_size: 4,
          warning_threshold: 2,
        },
      ],
    ]);

    await iterator.next();
    await iterator.next();
    stream.push(makeBlockFinished(5n));
    stream.push(makeBlockFinished(6n));
    await vi.advanceTimersByTimeAsync(0);

    expect(queueWarnings()).toHaveLength(3);
    expect(queueWarnings()[2]).toEqual([
      "Replay queue is growing",
      {
        event: "replay.queue.growing",
        queue: "stream",
        queue_size: 2,
        warning_threshold: 2,
      },
    ]);

    await iterator.return?.();
  });

  test("periodic health summary contains every operational field and stops on exit", async () => {
    const owner = bytes(31);
    const stream = createSnapshotThenClosableStream(makeSnapshot(bytes(32), owner, 42n));
    const client = createMockClient(stream.iterable);
    const logger = createMockLogger();
    const replay = createAccountsByOwnerReplay({
      client,
      owner,
      logger,
      healthLogIntervalMs: 50,
      retryConfig: OPERATIONAL_RETRY_CONFIG,
    });
    const iterator = replay[Symbol.asyncIterator]();
    const firstEvent = iterator.next();

    await vi.advanceTimersByTimeAsync(0);
    await expect(firstEvent).resolves.toMatchObject({
      done: false,
      value: { type: "account", account: { addressHex: "20" } },
    });
    await vi.advanceTimersByTimeAsync(50);

    const healthCalls = () =>
      vi.mocked(logger.info).mock.calls.filter(([, meta]) =>
        meta?.event === "replay.health"
      );
    expect(healthCalls()).toEqual([
      [
        "Replay health summary",
        {
          event: "replay.health",
          cache_bytes: 1,
          cache_max_bytes: 256 * 1024 * 1024,
          cache_usage_percent: 0,
          cached_accounts: 1,
          dirty_accounts: 0,
          stream_queue_size: 0,
          deferred_queue_size: 0,
          fetch_queue_size: 0,
          evictions_total: 0,
          dirty_evictions_total: 0,
          resync_failures_total: 0,
          fetch_failures_total: 0,
        },
      ],
    ]);

    const returnPromise = iterator.return?.();
    await vi.advanceTimersByTimeAsync(0);
    await returnPromise;
    const healthCountAfterReturn = healthCalls().length;
    await vi.advanceTimersByTimeAsync(500);
    expect(healthCalls()).toHaveLength(healthCountAfterReturn);
  });

  test("health logging can be disabled", async () => {
    const owner = bytes(33);
    const stream = createSnapshotThenClosableStream(makeSnapshot(bytes(34), owner, 43n));
    const client = createMockClient(stream.iterable);
    const logger = createMockLogger();
    const replay = createAccountsByOwnerReplay({
      client,
      owner,
      logger,
      healthLogIntervalMs: 0,
      retryConfig: OPERATIONAL_RETRY_CONFIG,
    });
    const iterator = replay[Symbol.asyncIterator]();
    const firstEvent = iterator.next();

    await vi.advanceTimersByTimeAsync(0);
    await expect(firstEvent).resolves.toMatchObject({ done: false });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(vi.mocked(logger.info).mock.calls).not.toEqual(
      expect.arrayContaining([
        expect.arrayContaining([
          expect.any(String),
          expect.objectContaining({ event: "replay.health" }),
        ]),
      ])
    );

    const returnPromise = iterator.return?.();
    await vi.advanceTimersByTimeAsync(0);
    await returnPromise;
  });

  test("abort stops the health timer immediately", async () => {
    const owner = bytes(35);
    const controller = new AbortController();
    const stream = createHangingStream();
    const client = createMockClient(stream.iterable);
    const logger = createMockLogger();
    const replay = createAccountsByOwnerReplay({
      client,
      owner,
      logger,
      signal: controller.signal,
      healthLogIntervalMs: 25,
      retryConfig: OPERATIONAL_RETRY_CONFIG,
    });
    const iterator = replay[Symbol.asyncIterator]();
    const nextEvent = iterator.next();

    await vi.advanceTimersByTimeAsync(25);
    const healthCallCount = () =>
      vi.mocked(logger.info).mock.calls.filter(([, meta]) =>
        meta?.event === "replay.health"
      ).length;
    expect(healthCallCount()).toBe(1);

    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    await expect(nextEvent).resolves.toEqual({ done: true, value: undefined });
    const healthCountAfterAbort = healthCallCount();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(healthCallCount()).toBe(healthCountAfterAbort);
  });

  test("terminal resync failures are structured and counted in health logs", async () => {
    const owner = bytes(36);
    const address = bytes(37);
    const controller = new AbortController();
    const stream = createPushableStream();
    const client = createMockClient(stream.iterable);
    const logger = createMockLogger();
    const fetchError = new Error("resync unavailable");
    client.getAccount.mockRejectedValue(fetchError);
    const replay = createAccountsByOwnerReplay({
      client,
      owner,
      logger,
      signal: controller.signal,
      maxRetries: 1,
      healthLogIntervalMs: 20,
      retryConfig: OPERATIONAL_RETRY_CONFIG,
    });
    const iterator = replay[Symbol.asyncIterator]();
    const nextEvent = iterator.next();

    await vi.advanceTimersByTimeAsync(0);
    stream.push(
      makeDeltaResponse(address, owner, 50n, 1n, 2 * PAGE_SIZE, 0, 7)
    );
    await vi.advanceTimersByTimeAsync(0);

    expect(logger.error).toHaveBeenCalledWith(
      "Replay account resync failed",
      {
        event: "replay.account.resync_failed",
        address: "25",
        attempts: 1,
        error: fetchError,
      }
    );
    const failureMetadata = vi.mocked(logger.error).mock.calls[0]?.[1];
    expect(failureMetadata).not.toHaveProperty("data");

    await vi.advanceTimersByTimeAsync(20);
    expect(logger.info).toHaveBeenCalledWith(
      "Replay health summary",
      expect.objectContaining({
        event: "replay.health",
        resync_failures_total: 1,
      })
    );

    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    await expect(nextEvent).resolves.toEqual({ done: true, value: undefined });
  });
});

describe("page-delta overlay (live tail)", () => {
  /* Real timers: the only internal delay is the generator's 10ms poll, and
     a long connectionTimeoutMs keeps the idle-reconnect path quiet. */
  const OVERLAY_RETRY_CONFIG: RetryConfig = {
    initialDelayMs: 5,
    maxDelayMs: 5,
    connectionTimeoutMs: 60_000,
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function pull(iterator: AsyncIterator<unknown>): Promise<IteratorResult<unknown>> {
    return iterator.next();
  }

  test("partial page deltas assemble against backfilled data and flush at block boundary", async () => {
    const owner = bytes(21);
    const address = bytes(22);
    const account = makeMultiPageAccount(address, owner, 100n, 1n, 3 * PAGE_SIZE, 1);
    const stream = createPushableStream();
    const client = createMockClient(stream.iterable);
    client.listAccounts.mockResolvedValue(
      create(ListAccountsResponseSchema, { accounts: [metaOnly(account)] })
    );
    client.getAccount.mockResolvedValue(account);

    const replay = createAccountsByOwnerReplay({ client, owner, retryConfig: OVERLAY_RETRY_CONFIG });
    const iterator = replay[Symbol.asyncIterator]();

    /* Backfill emits the seeded full account. */
    await expect(pull(iterator)).resolves.toMatchObject({
      done: false,
      value: { type: "account", account: { addressHex: "16", slot: 100n, seq: 1n } },
    });

    /* A transaction touches only page 1 of 3 — the case the old
       complete-page-set assembler could never emit. */
    stream.push(makeDeltaResponse(address, owner, 101n, 2n, 3 * PAGE_SIZE, 1, 2));
    stream.push(makeBlockFinished(101n));

    const flushedResult = await pull(iterator);
    expect(flushedResult.done).toBe(false);
    const flushed = (flushedResult as IteratorResult<{ type: string; account: { slot: bigint; seq: bigint; data: Uint8Array } }>)
      .value;
    expect(flushed.type).toBe("account");
    expect(flushed.account.slot).toBe(101n);
    expect(flushed.account.seq).toBe(2n);
    expect(flushed.account.data[0]).toBe(1); /* page 0: backfilled */
    expect(flushed.account.data[PAGE_SIZE]).toBe(2); /* page 1: overlaid */
    expect(flushed.account.data[2 * PAGE_SIZE]).toBe(1); /* page 2: backfilled */

    await expect(pull(iterator)).resolves.toMatchObject({
      done: false,
      value: { type: "blockFinished", block: { slot: 101n } },
    });

    /* No resync was needed — backfill seeded the cache. */
    expect(client.getAccount).toHaveBeenCalledTimes(1);

    await iterator.return?.();
  });

  test("delta for an account backfill never saw triggers a GetAccount resync", async () => {
    const owner = bytes(23);
    const address = bytes(24);
    const stream = createPushableStream();
    const client = createMockClient(stream.iterable);
    client.listAccounts.mockResolvedValue(create(ListAccountsResponseSchema, { accounts: [] }));
    const fetched = makeMultiPageAccount(address, owner, 102n, 3n, 2 * PAGE_SIZE, 5);
    client.getAccount.mockResolvedValue(fetched);

    const replay = createAccountsByOwnerReplay({ client, owner, retryConfig: OVERLAY_RETRY_CONFIG });
    const iterator = replay[Symbol.asyncIterator]();

    stream.push(makeDeltaResponse(address, owner, 102n, 3n, 2 * PAGE_SIZE, 0, 9));

    await expect(pull(iterator)).resolves.toMatchObject({
      done: false,
      value: { type: "account", account: { addressHex: "18", slot: 102n, seq: 3n, source: "stream" } },
    });
    expect(client.getAccount).toHaveBeenCalledTimes(1);

    /* The resync seeded the cache: the next delta overlays without refetch. */
    stream.push(makeDeltaResponse(address, owner, 103n, 4n, 2 * PAGE_SIZE, 1, 7));
    stream.push(makeBlockFinished(103n));

    const overlaid = await pull(iterator);
    expect(overlaid.done).toBe(false);
    const overlaidAccount = (overlaid as IteratorResult<{ account: { data: Uint8Array } }>).value.account;
    expect(overlaidAccount.data[0]).toBe(5); /* from resync fetch */
    expect(overlaidAccount.data[PAGE_SIZE]).toBe(7); /* from delta */
    expect(client.getAccount).toHaveBeenCalledTimes(1);

    await iterator.return?.();
  });

  test("heartbeat-only stream emits block markers and no account events", async () => {
    const owner = bytes(25);
    const stream = createPushableStream();
    const client = createMockClient(stream.iterable);
    client.listAccounts.mockResolvedValue(create(ListAccountsResponseSchema, { accounts: [] }));

    const replay = createAccountsByOwnerReplay({ client, owner, retryConfig: OVERLAY_RETRY_CONFIG });
    const iterator = replay[Symbol.asyncIterator]();

    stream.push(makeBlockFinished(50n));
    stream.push(makeBlockFinished(51n));

    await expect(pull(iterator)).resolves.toMatchObject({
      done: false,
      value: { type: "blockFinished", block: { slot: 50n } },
    });
    await expect(pull(iterator)).resolves.toMatchObject({
      done: false,
      value: { type: "blockFinished", block: { slot: 51n } },
    });
    expect(client.getAccount).not.toHaveBeenCalled();

    await iterator.return?.();
  });

  test("cross-slot recreate at seq 0 after a delete is accepted", async () => {
    /* Under UNTO-2630, seq only restarts at 0 when an account is
       recreated in a LATER slot; plain lexicographic (slot, seq)
       ordering already orders that correctly since the slot itself is
       greater. */
    const owner = bytes(26);
    const address = bytes(27);
    const stream = createPushableStream();
    const client = createMockClient(stream.iterable);
    client.listAccounts.mockResolvedValue(create(ListAccountsResponseSchema, { accounts: [] }));

    const replay = createAccountsByOwnerReplay({ client, owner, retryConfig: OVERLAY_RETRY_CONFIG });
    const iterator = replay[Symbol.asyncIterator]();

    stream.push(makeDeleteResponse(address, owner, 30n, 7n));
    await expect(pull(iterator)).resolves.toMatchObject({
      done: false,
      value: { type: "account", account: { slot: 30n, seq: 7n, isDelete: true } },
    });

    stream.push(makeDeltaResponse(address, owner, 31n, 0n, 1, 0, 9));
    await expect(pull(iterator)).resolves.toMatchObject({
      done: false,
      value: { type: "account", account: { slot: 31n, seq: 0n, isDelete: false } },
    });

    await iterator.return?.();
  });

  test("same-slot recreate at a lower seq after a delete is rejected (transitional pre-UNTO-2630 behavior)", async () => {
    /* Today's runtime can still restart seq in-block on a delete+recreate.
       Until UNTO-2630 lands, a same-slot recreate redelivered at that seam
       is suppressed by plain comparison -- this is the pre-UNTO-2632
       status quo, not a UNTO-2630 semantic: under UNTO-2630, seq is
       strictly monotonic within a slot, so this exact sequence (a lower
       seq following a delete in the same slot) is unrepresentable. */
    const owner = bytes(38);
    const address = bytes(39);
    const stream = createPushableStream();
    const client = createMockClient(stream.iterable);
    client.listAccounts.mockResolvedValue(create(ListAccountsResponseSchema, { accounts: [] }));

    const replay = createAccountsByOwnerReplay({ client, owner, retryConfig: OVERLAY_RETRY_CONFIG });
    const iterator = replay[Symbol.asyncIterator]();

    stream.push(makeDeleteResponse(address, owner, 30n, 7n));
    await expect(pull(iterator)).resolves.toMatchObject({
      done: false,
      value: { type: "account", account: { slot: 30n, seq: 7n, isDelete: true } },
    });

    stream.push(makeDeltaResponse(address, owner, 30n, 0n, 1, 0, 9));
    stream.push(makeBlockFinished(31n));

    await expect(pull(iterator)).resolves.toMatchObject({
      done: false,
      value: { type: "blockFinished", block: { slot: 31n } },
    });

    await iterator.return?.();
  });

  test("cross-slot stale update after a delete is still rejected", async () => {
    const owner = bytes(28);
    const address = bytes(29);
    const stream = createPushableStream();
    const client = createMockClient(stream.iterable);
    client.listAccounts.mockResolvedValue(create(ListAccountsResponseSchema, { accounts: [] }));

    const replay = createAccountsByOwnerReplay({ client, owner, retryConfig: OVERLAY_RETRY_CONFIG });
    const iterator = replay[Symbol.asyncIterator]();

    stream.push(makeDeleteResponse(address, owner, 30n, 7n));
    await expect(pull(iterator)).resolves.toMatchObject({
      done: false,
      value: { type: "account", account: { slot: 30n, seq: 7n, isDelete: true } },
    });

    /* An update from an older slot must never resurrect the deleted
       account, even though the delete is an incarnation boundary. */
    stream.push(makeDeltaResponse(address, owner, 29n, 99n, 1, 0, 5));
    stream.push(makeBlockFinished(31n));

    await expect(pull(iterator)).resolves.toMatchObject({
      done: false,
      value: { type: "blockFinished", block: { slot: 31n } },
    });

    await iterator.return?.();
  });

  test("duplicate of the delete's exact (slot, seq) is deduped", async () => {
    const owner = bytes(30);
    const address = bytes(31);
    const stream = createPushableStream();
    const client = createMockClient(stream.iterable);
    client.listAccounts.mockResolvedValue(create(ListAccountsResponseSchema, { accounts: [] }));

    const replay = createAccountsByOwnerReplay({ client, owner, retryConfig: OVERLAY_RETRY_CONFIG });
    const iterator = replay[Symbol.asyncIterator]();

    stream.push(makeDeleteResponse(address, owner, 30n, 7n));
    await expect(pull(iterator)).resolves.toMatchObject({
      done: false,
      value: { type: "account", account: { slot: 30n, seq: 7n, isDelete: true } },
    });

    /* A redelivered duplicate of the delete itself (e.g. during a
       reconnect) must not re-emit. */
    stream.push(makeDeleteResponse(address, owner, 30n, 7n));
    stream.push(makeBlockFinished(31n));

    await expect(pull(iterator)).resolves.toMatchObject({
      done: false,
      value: { type: "blockFinished", block: { slot: 31n } },
    });

    await iterator.return?.();
  });

  test("delete then cross-slot recreate then a redelivered duplicate of the old delete: recreated account survives", async () => {
    const owner = bytes(32);
    const address = bytes(33);
    const stream = createPushableStream();
    const client = createMockClient(stream.iterable);
    client.listAccounts.mockResolvedValue(create(ListAccountsResponseSchema, { accounts: [] }));

    const replay = createAccountsByOwnerReplay({ client, owner, retryConfig: OVERLAY_RETRY_CONFIG });
    const iterator = replay[Symbol.asyncIterator]();

    stream.push(makeDeleteResponse(address, owner, 30n, 7n));
    await expect(pull(iterator)).resolves.toMatchObject({
      done: false,
      value: { type: "account", account: { slot: 30n, seq: 7n, isDelete: true } },
    });

    stream.push(makeDeltaResponse(address, owner, 31n, 0n, 1, 0, 9));
    await expect(pull(iterator)).resolves.toMatchObject({
      done: false,
      value: { type: "account", account: { slot: 31n, seq: 0n, isDelete: false } },
    });

    /* A live-seam / replay redelivery of the ORIGINAL delete arrives after
       the account has already been recreated in a later slot. (30,7) is
       older than the current mark (31,0) under plain lexicographic
       comparison, so it is rejected and dropped silently -- no event, no
       tracker update -- with no need for any incarnation-boundary or
       tombstone special case. */
    stream.push(makeDeleteResponse(address, owner, 30n, 7n));
    stream.push(makeBlockFinished(31n));

    /* The next event is the block boundary, not a resurrected delete. */
    await expect(pull(iterator)).resolves.toMatchObject({
      done: false,
      value: { type: "blockFinished", block: { slot: 31n } },
    });

    await iterator.return?.();
  });
});

describe("AccountSeqTracker ordering (UNTO-2630 plain lexicographic (slot, seq))", () => {
  test("accepts a cross-slot recreate (seq 0) after a delete", () => {
    /* Under UNTO-2630, seq only restarts at 0 when an account is recreated
       in a LATER slot; plain (slot, seq) ordering accepts this because the
       slot itself is greater. */
    const tracker = new AccountSeqTracker();
    tracker.update("addr", 30n, 7n);

    expect(tracker.shouldApply("addr", 31n, 0n)).toBe(true);
    expect(tracker.update("addr", 31n, 0n)).toBe(true);
    expect(tracker.getVersion("addr")).toEqual({ slot: 31n, seq: 0n });
  });

  test("same-slot recreate at a lower seq after a delete is rejected (transitional pre-UNTO-2630 behavior)", () => {
    /* Today's runtime can still restart seq in-block on a delete+recreate.
       Until UNTO-2630 lands, a same-slot recreate redelivered at that seam
       is suppressed by plain comparison -- this is the pre-UNTO-2632
       status quo, not a UNTO-2630 semantic: under UNTO-2630, seq is
       strictly monotonic within a slot, so this exact sequence (a lower
       seq following a delete in the same slot) is unrepresentable. */
    const tracker = new AccountSeqTracker();
    tracker.update("addr", 30n, 7n);

    expect(tracker.shouldApply("addr", 30n, 0n)).toBe(false);
    expect(tracker.update("addr", 30n, 0n)).toBe(false);
    expect(tracker.getVersion("addr")).toEqual({ slot: 30n, seq: 7n });
  });

  test("rejects a stale cross-slot update after a delete", () => {
    const tracker = new AccountSeqTracker();
    tracker.update("addr", 30n, 7n);

    expect(tracker.shouldApply("addr", 29n, 99n)).toBe(false);
    expect(tracker.update("addr", 29n, 99n)).toBe(false);
    expect(tracker.getVersion("addr")).toEqual({ slot: 30n, seq: 7n });
  });

  test("dedupes an exact duplicate of the delete's own (slot, seq)", () => {
    const tracker = new AccountSeqTracker();
    tracker.update("addr", 30n, 7n);

    expect(tracker.shouldApply("addr", 30n, 7n)).toBe(false);
    expect(tracker.update("addr", 30n, 7n)).toBe(false);
  });

  test("a non-delete version still requires a strictly greater seq at the same slot", () => {
    const tracker = new AccountSeqTracker();
    tracker.update("addr", 30n, 4n);

    expect(tracker.shouldApply("addr", 30n, 4n)).toBe(false);
    expect(tracker.shouldApply("addr", 30n, 3n)).toBe(false);
    expect(tracker.shouldApply("addr", 30n, 5n)).toBe(true);
  });

  test("delete(30,7) -> update(31,1) -> redelivered delete(30,9) is rejected against the current mark; a duplicate of the original delete and a genuinely newer delete are handled the same way", () => {
    const tracker = new AccountSeqTracker();

    tracker.update("addr", 30n, 7n);
    expect(tracker.getVersion("addr")).toEqual({ slot: 30n, seq: 7n });

    expect(tracker.shouldApply("addr", 31n, 1n)).toBe(true);
    expect(tracker.update("addr", 31n, 1n)).toBe(true);
    expect(tracker.getVersion("addr")).toEqual({ slot: 31n, seq: 1n });

    /* A redelivered delete(30,9) is newer than the original delete's mark
       (30,7) but older than the current (31,1) mark -- rejected. */
    expect(tracker.shouldApply("addr", 30n, 9n)).toBe(false);
    expect(tracker.update("addr", 30n, 9n)).toBe(false);
    expect(tracker.getVersion("addr")).toEqual({ slot: 31n, seq: 1n });

    /* An exact duplicate of the original delete(30,7) is rejected the same
       way -- it is even older than (31,1). */
    expect(tracker.shouldApply("addr", 30n, 7n)).toBe(false);
    expect(tracker.update("addr", 30n, 7n)).toBe(false);
    expect(tracker.getVersion("addr")).toEqual({ slot: 31n, seq: 1n });

    /* A genuinely newer delete, newer than the (31,1) mark, still applies. */
    expect(tracker.shouldApply("addr", 31n, 2n)).toBe(true);
    expect(tracker.update("addr", 31n, 2n)).toBe(true);
    expect(tracker.getVersion("addr")).toEqual({ slot: 31n, seq: 2n });
  });
});

function createPushableStream(): {
  iterable: AsyncIterable<StreamAccountUpdatesResponse>;
  push: (response: StreamAccountUpdatesResponse) => void;
} {
  const pending: StreamAccountUpdatesResponse[] = [];
  let closed = false;
  let wake: (() => void) | null = null;
  const wakeUp = () => {
    wake?.();
    wake = null;
  };
  return {
    push(response) {
      pending.push(response);
      wakeUp();
    },
    iterable: {
      [Symbol.asyncIterator]() {
        return {
          async next(): Promise<IteratorResult<StreamAccountUpdatesResponse>> {
            while (pending.length === 0 && !closed) {
              await new Promise<void>((resolve) => {
                wake = resolve;
              });
            }
            if (pending.length === 0) {
              return { done: true, value: undefined };
            }
            return { done: false, value: pending.shift()! };
          },
          /* Must release any in-flight next() so the replay generator's
             final cleanup does not block on its 30s drain timeout. */
          return(): Promise<IteratorResult<StreamAccountUpdatesResponse>> {
            closed = true;
            wakeUp();
            return Promise.resolve({ done: true, value: undefined });
          },
        };
      },
    },
  };
}

function makeMultiPageAccount(
  address: Uint8Array,
  owner: Uint8Array,
  slot: bigint,
  seq: bigint,
  dataSize: number,
  fill: number
): Account {
  return create(AccountSchema, {
    address: create(PubkeySchema, { value: address }),
    meta: create(AccountMetaSchema, {
      owner: create(PubkeySchema, { value: owner }),
      seq,
      lastUpdatedSlot: slot,
      dataSize,
    }),
    data: create(AccountDataSchema, { data: new Uint8Array(dataSize).fill(fill) }),
    versionContext: create(VersionContextMetadataSchema, { slot }),
  });
}

function metaOnly(account: Account): Account {
  return create(AccountSchema, {
    address: account.address,
    meta: account.meta,
  });
}

function makeDeltaResponse(
  address: Uint8Array,
  owner: Uint8Array,
  slot: bigint,
  seq: bigint,
  dataSize: number,
  pageIdx: number,
  fill: number
): StreamAccountUpdatesResponse {
  return create(StreamAccountUpdatesResponseSchema, {
    message: {
      case: "update",
      value: create(AccountUpdateSchema, {
        slot,
        seq,
        address: create(PubkeySchema, { value: address }),
        meta: create(AccountMetaSchema, {
          owner: create(PubkeySchema, { value: owner }),
          seq,
          dataSize,
        }),
        page: create(AccountPageSchema, {
          pageIdx,
          pageSize: PAGE_SIZE,
          pageData: new Uint8Array(PAGE_SIZE).fill(fill),
        }),
      }),
    },
  });
}

/** A delete update: the (slot, seq) of the row that recorded the delete. */
function makeDeleteResponse(
  address: Uint8Array,
  owner: Uint8Array,
  slot: bigint,
  seq: bigint
): StreamAccountUpdatesResponse {
  return create(StreamAccountUpdatesResponseSchema, {
    message: {
      case: "update",
      value: create(AccountUpdateSchema, {
        slot,
        seq,
        address: create(PubkeySchema, { value: address }),
        delete: true,
        meta: create(AccountMetaSchema, {
          owner: create(PubkeySchema, { value: owner }),
          seq,
        }),
      }),
    },
  });
}

function createMockLogger(): ReplayLogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function createMockClient(
  stream: AsyncIterable<StreamAccountUpdatesResponse>
): AccountSource & {
  getAccount: ReturnType<typeof vi.fn>;
  listAccounts: ReturnType<typeof vi.fn>;
  streamAccountUpdates: ReturnType<typeof vi.fn>;
} {
  return {
    getAccount: vi.fn<() => Promise<Account>>(),
    listAccounts: vi.fn<() => Promise<ListAccountsResponse>>(() =>
      Promise.resolve(create(ListAccountsResponseSchema, { accounts: [] }))
    ),
    streamAccountUpdates: vi.fn(() => stream),
  };
}

function createSnapshotThenHangingStream(
  snapshot: StreamAccountUpdatesResponse
): {
  iterable: AsyncIterable<StreamAccountUpdatesResponse>;
  next: ReturnType<typeof vi.fn>;
  return: ReturnType<typeof vi.fn>;
} {
  let sent = false;
  const next = vi.fn<() => Promise<IteratorResult<StreamAccountUpdatesResponse>>>(() => {
    if (!sent) {
      sent = true;
      return Promise.resolve({ done: false, value: snapshot });
    }
    return new Promise(() => {});
  });
  const returnFn = vi.fn<() => Promise<IteratorResult<StreamAccountUpdatesResponse>>>(() => new Promise(() => {}));

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

function createHangingStream(): {
  iterable: AsyncIterable<StreamAccountUpdatesResponse>;
  next: ReturnType<typeof vi.fn>;
  return: ReturnType<typeof vi.fn>;
} {
  const next = vi.fn<() => Promise<IteratorResult<StreamAccountUpdatesResponse>>>(() => new Promise(() => {}));
  const returnFn = vi.fn<() => Promise<IteratorResult<StreamAccountUpdatesResponse>>>(() => new Promise(() => {}));

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

function createSequenceThenHangingStream(
  responses: StreamAccountUpdatesResponse[]
): {
  iterable: AsyncIterable<StreamAccountUpdatesResponse>;
  next: ReturnType<typeof vi.fn>;
  return: ReturnType<typeof vi.fn>;
} {
  const pending = [...responses];
  const next = vi.fn<() => Promise<IteratorResult<StreamAccountUpdatesResponse>>>(() => {
    const value = pending.shift();
    if (value) {
      return Promise.resolve({ done: false, value });
    }
    return new Promise(() => {});
  });
  const returnFn = vi.fn<() => Promise<IteratorResult<StreamAccountUpdatesResponse>>>(() => new Promise(() => {}));

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

function createEndingStream(): {
  iterable: AsyncIterable<StreamAccountUpdatesResponse>;
  next: ReturnType<typeof vi.fn>;
  return: ReturnType<typeof vi.fn>;
} {
  const next = vi.fn<() => Promise<IteratorResult<StreamAccountUpdatesResponse>>>(() =>
    Promise.resolve({ done: true, value: undefined })
  );
  const returnFn = vi.fn<() => Promise<IteratorResult<StreamAccountUpdatesResponse>>>(() =>
    Promise.resolve({ done: true, value: undefined })
  );

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

function createSnapshotThenClosableStream(
  snapshot: StreamAccountUpdatesResponse
): {
  iterable: AsyncIterable<StreamAccountUpdatesResponse>;
  next: ReturnType<typeof vi.fn>;
  return: ReturnType<typeof vi.fn>;
} {
  let sent = false;
  let closed = false;
  let resolvePending: ((value: IteratorResult<StreamAccountUpdatesResponse>) => void) | null = null;

  const next = vi.fn<() => Promise<IteratorResult<StreamAccountUpdatesResponse>>>(() => {
    if (closed) {
      return Promise.resolve({ done: true, value: undefined });
    }
    if (!sent) {
      sent = true;
      return Promise.resolve({ done: false, value: snapshot });
    }
    return new Promise((resolve) => {
      resolvePending = resolve;
    });
  });

  const returnFn = vi.fn<() => Promise<IteratorResult<StreamAccountUpdatesResponse>>>(() => {
    closed = true;
    resolvePending?.({ done: true, value: undefined });
    return Promise.resolve({ done: true, value: undefined });
  });

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

function makeSnapshot(
  address: Uint8Array,
  owner: Uint8Array,
  slot: bigint
): StreamAccountUpdatesResponse {
  return accountToSnapshot(makeAccount(address, owner, slot, 1n));
}

function makeAccount(
  address: Uint8Array,
  owner: Uint8Array,
  slot: bigint,
  seq: bigint
): Account {
  return create(AccountSchema, {
    address: create(PubkeySchema, { value: address }),
    meta: create(AccountMetaSchema, {
      owner: create(PubkeySchema, { value: owner }),
      seq,
      lastUpdatedSlot: slot,
      dataSize: 1,
    }),
    data: create(AccountDataSchema, { data: new Uint8Array([7]) }),
    versionContext: create(VersionContextMetadataSchema, { slot }),
  });
}

function accountToSnapshot(account: Account): StreamAccountUpdatesResponse {
  return create(StreamAccountUpdatesResponseSchema, {
    message: {
      case: "snapshot",
      value: account,
    },
  });
}

function makeBlockFinished(slot: bigint): StreamAccountUpdatesResponse {
  return create(StreamAccountUpdatesResponseSchema, {
    message: {
      case: "finished",
      value: create(BlockFinishedSchema, { slot }),
    },
  });
}

function bytes(value: number): Uint8Array {
  return new Uint8Array([value]);
}
