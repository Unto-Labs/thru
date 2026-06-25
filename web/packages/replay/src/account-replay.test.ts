import { create } from "@bufbuild/protobuf";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  AccountDataSchema,
  AccountMetaSchema,
  AccountSchema,
  BlockFinishedSchema,
  ListAccountsResponseSchema,
  PubkeySchema,
  StreamAccountUpdatesResponseSchema,
  VersionContextMetadataSchema,
  type Account,
  type ListAccountsResponse,
  type StreamAccountUpdatesResponse,
} from "@thru/sdk/proto";
import { createAccountsByOwnerReplay } from "./account-replay";
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
