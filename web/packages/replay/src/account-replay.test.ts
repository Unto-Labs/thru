import { create } from "@bufbuild/protobuf";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  AccountDataSchema,
  AccountMetaSchema,
  AccountSchema,
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

describe("account-owner replay reconnect cleanup", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test("reconnects when stale iterator next and return never resolve", async () => {
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
      retryConfig: TEST_RETRY_CONFIG,
      reconnectCleanupTimeoutMs: 7,
      cleanupInterval: 1000,
    });
    const iterator = replay[Symbol.asyncIterator]();
    const nextEvent = iterator.next();

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(TEST_RETRY_CONFIG.connectionTimeoutMs + 11);
    await vi.advanceTimersByTimeAsync(TEST_RETRY_CONFIG.initialDelayMs);
    await vi.advanceTimersByTimeAsync(7);
    await vi.advanceTimersByTimeAsync(7);
    await vi.advanceTimersByTimeAsync(10);

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
        connectionTimeoutMs: TEST_RETRY_CONFIG.connectionTimeoutMs,
      })
    );
    expect(logger.warn).toHaveBeenCalledWith(
      "Replay stream reconnect cleanup stuck",
      expect.objectContaining({
        event: "replay.stream.reconnect.stuck",
        phase: "old iterator close",
        timeout_ms: 7,
      })
    );
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

  test("aborting during reconnect cleanup exits without creating runaway streams", async () => {
    const owner = bytes(9);
    const controller = new AbortController();
    const staleStream = createHangingStream();
    const client = createMockClient(staleStream.iterable);
    const clientFactory = vi.fn(() => client);
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
    await vi.advanceTimersByTimeAsync(TEST_RETRY_CONFIG.initialDelayMs);
    expect(staleStream.return).toHaveBeenCalledTimes(1);

    controller.abort();

    await expect(nextEvent).resolves.toEqual({ done: true, value: undefined });
    expect(clientFactory).toHaveBeenCalledTimes(1);
    expect(client.streamAccountUpdates).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5000);
    expect(clientFactory).toHaveBeenCalledTimes(1);
    expect(client.streamAccountUpdates).toHaveBeenCalledTimes(1);
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
): AccountSource & { streamAccountUpdates: ReturnType<typeof vi.fn> } {
  return {
    getAccount: vi.fn<() => Promise<Account>>(),
    listAccounts: vi.fn<() => Promise<ListAccountsResponse>>(() =>
      Promise.resolve(create(ListAccountsResponseSchema, { accounts: [] }))
    ),
    streamAccountUpdates: vi.fn(() => stream),
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
  return create(StreamAccountUpdatesResponseSchema, {
    message: {
      case: "snapshot",
      value: create(AccountSchema, {
        address: create(PubkeySchema, { value: address }),
        meta: create(AccountMetaSchema, {
          owner: create(PubkeySchema, { value: owner }),
          seq: 1n,
          lastUpdatedSlot: slot,
          dataSize: 1,
        }),
        data: create(AccountDataSchema, { data: new Uint8Array([7]) }),
        versionContext: create(VersionContextMetadataSchema, { slot }),
      }),
    },
  });
}

function bytes(value: number): Uint8Array {
  return new Uint8Array([value]);
}
