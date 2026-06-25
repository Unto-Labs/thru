/**
 * Account Replay - streaming account state with backfill reconciliation.
 *
 * This module provides account state streaming with:
 * - Page assembly for large accounts (>4KB)
 * - Sequence number tracking for ordering
 * - Backfill reconciliation with live updates
 * - Block boundary detection via BlockFinished messages
 */

import { create } from "@bufbuild/protobuf";
import type { Account, AccountMeta, GetAccountRequest } from "@thru/sdk/proto";
import {
  AccountView,
  FilterSchema,
  FilterParamValueSchema,
  PageRequestSchema,
  PubkeySchema,
} from "@thru/sdk/proto";
import type {
  StreamAccountUpdatesRequest,
  StreamAccountUpdatesResponse,
  ListAccountsRequest,
  ListAccountsResponse,
  BlockFinished,
  Filter,
  FilterParamValue,
} from "@thru/sdk/proto";
import type { AccountSource } from "./chain-client";
import { PageAssembler, type AssembledAccount } from "./page-assembler";
import {
  abortableDelay,
  DEFAULT_RETRY_CONFIG,
  calculateBackoff,
  isAbortError,
  type RetryConfig,
} from "./retry";
import type { ReplayLogger } from "./types";
import { closeIfCloseable, resolveClient } from "./types";
import { NOOP_LOGGER } from "./logger";

const DEFAULT_RECONNECT_CLEANUP_TIMEOUT_MS = 30_000;
const REPLAY_IDLE_TIMEOUT_ERROR = "ReplayIdleTimeoutError";

function createIdleTimeoutError(timeoutMs: number): Error {
  const error = new Error(`Operation timed out after ${timeoutMs}ms`);
  error.name = REPLAY_IDLE_TIMEOUT_ERROR;
  return error;
}

function isIdleTimeoutError(error: Error): boolean {
  return error.name === REPLAY_IDLE_TIMEOUT_ERROR;
}

async function closeAsyncIterator<T>(iterator: AsyncIterator<T> | null): Promise<void> {
  if (!iterator || typeof iterator.return !== "function") {
    return;
  }

  try {
    await iterator.return();
  } catch {
    /* best-effort */
  }
}

async function waitForCleanup(
  promise: Promise<unknown>,
  timeoutMs: number,
  label: string,
  logger: ReplayLogger,
  signal?: AbortSignal
): Promise<"completed" | "timed-out" | "aborted"> {
  const startedAtMs = Date.now();
  logger.info("Replay stream reconnect cleanup started", {
    event: "replay.stream.reconnect.cleanup_started",
    phase: label,
    timeout_ms: timeoutMs,
  });
  if (signal?.aborted) {
    logger.debug("Replay stream reconnect cleanup aborted", {
      event: "replay.stream.reconnect.cleanup_completed",
      phase: label,
      timeout_ms: timeoutMs,
      result: "aborted",
      duration_ms: 0,
    });
    return "aborted";
  }

  let timer: ReturnType<typeof setTimeout> | null = null;
  let onAbort: (() => void) | null = null;

  const timeoutPromise = new Promise<"timed-out">((resolve) => {
    timer = setTimeout(() => resolve("timed-out"), timeoutMs);
    timer.unref?.();
  });

  const abortPromise = signal
    ? new Promise<"aborted">((resolve) => {
        onAbort = () => resolve("aborted");
        signal.addEventListener("abort", onAbort, { once: true });
      })
    : null;

  const completionPromise = promise.then<"completed", "completed">(
    () => "completed",
    () => "completed"
  );

  const result = await Promise.race(
    abortPromise
      ? [completionPromise, timeoutPromise, abortPromise]
      : [completionPromise, timeoutPromise]
  );

  if (timer) {
    clearTimeout(timer);
  }
  if (signal && onAbort) {
    signal.removeEventListener("abort", onAbort);
  }

  if (result === "timed-out") {
    logger.warn("Replay stream reconnect cleanup stuck", {
      event: "replay.stream.reconnect.stuck",
      phase: label,
      timeout_ms: timeoutMs,
      duration_ms: Date.now() - startedAtMs,
    });
  } else if (result === "aborted") {
    logger.debug("Replay stream reconnect cleanup aborted", {
      event: "replay.stream.reconnect.cleanup_completed",
      phase: label,
      timeout_ms: timeoutMs,
      result,
      duration_ms: Date.now() - startedAtMs,
    });
  } else {
    logger.info("Replay stream reconnect cleanup completed", {
      event: "replay.stream.reconnect.cleanup_completed",
      phase: label,
      timeout_ms: timeoutMs,
      result,
      duration_ms: Date.now() - startedAtMs,
    });
  }

  return result;
}

/**
 * Represents a complete account state ready for processing
 */
export interface AccountState {
  /** Account address as bytes */
  address: Uint8Array;
  /** Account address as hex string */
  addressHex: string;
  /** Slot at which this state was observed */
  slot: bigint;
  /** Sequence number for ordering updates */
  seq: bigint;
  /** Account metadata */
  meta: AccountMeta;
  /** Complete account data (assembled from pages) */
  data: Uint8Array;
  /** Whether this is a deletion */
  isDelete: boolean;
  /** Source: "backfill" for GetAccount during backfill, "stream" for live updates */
  source: "backfill" | "stream";
}

/**
 * Block finished event for detecting transaction boundaries
 */
export interface BlockFinishedEvent {
  slot: bigint;
}

/**
 * Union type for account replay events
 */
export type AccountReplayEvent =
  | { type: "account"; account: AccountState }
  | { type: "blockFinished"; block: BlockFinishedEvent };

/**
 * Options for account replay (single address)
 */
export interface AccountReplayOptions {
  /** Account source (typically ChainClient) */
  client: AccountSource;

  /** Account address to stream updates for */
  address: Uint8Array;

  /** Account view (default: FULL for complete data) */
  view?: AccountView;

  /** Optional filter expression */
  filter?: {
    expression: string;
    params?: { [key: string]: { kind: { case: string; value: unknown } } };
  };

  /** Page assembler options */
  pageAssemblerOptions?: {
    assemblyTimeout?: number;
    maxPendingPerAddress?: number;
  };

  /** Cleanup interval for page assembler (default: 10000ms) */
  cleanupInterval?: number;
}

/**
 * Options for replaying accounts by owner with backfill + streaming.
 * Uses ListAccounts (META_ONLY) + GetAccount for backfill, then StreamAccountUpdates for live updates.
 */
export interface AccountsByOwnerReplayOptions {
  /** Account source (typically ChainClient). Optional if clientFactory provided. */
  client?: AccountSource;

  /** Factory to create fresh clients on reconnection. Enables robust reconnection. */
  clientFactory?: () => AccountSource;

  /** Program owner address - streams all accounts owned by this program */
  owner: Uint8Array;

  /** Account view for GetAccount calls (default: FULL for complete data) */
  view?: AccountView;

  /** Optional data sizes to filter (e.g., [73, 115] for TokenAccount and MintAccount) */
  dataSizes?: number[];

  /** Minimum last_updated_slot for resumable backfill (resume from checkpoint) */
  minUpdatedSlot?: bigint;

  /** Page size for ListAccounts pagination (default: 100) */
  pageSize?: number;

  /** Max retries for GetAccount failures (default: 3) */
  maxRetries?: number;

  /** Page assembler options for streaming phase */
  pageAssemblerOptions?: {
    assemblyTimeout?: number;
    maxPendingPerAddress?: number;
  };

  /** Cleanup interval for page assembler (default: 10000ms) */
  cleanupInterval?: number;

  /** Maximum time to wait for stale reconnect cleanup before creating a fresh stream. */
  reconnectCleanupTimeoutMs?: number;

  /** Retry timings for live stream reconnects (default: DEFAULT_RETRY_CONFIG). */
  retryConfig?: RetryConfig;

  /** Called when backfill queue is drained. Returns the highest slot seen during backfill. */
  onBackfillComplete?: (highestSlot: bigint) => void;

  /** Logger for debug/info/warn/error messages (default: NOOP_LOGGER) */
  logger?: ReplayLogger;

  /** Optional signal to stop backfill/streaming without reconnecting. */
  signal?: AbortSignal;
}

/**
 * Convert address bytes to hex string
 */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Convert Account snapshot to AccountState (for streaming)
 */
function snapshotToState(account: Account): AccountState | null {
  if (!account.address?.value || !account.meta) {
    return null;
  }

  return {
    address: account.address.value,
    addressHex: bytesToHex(account.address.value),
    slot: account.versionContext?.slot ?? 0n,
    seq: BigInt(account.meta.seq.toString()),
    meta: account.meta,
    data: account.data?.data ?? new Uint8Array(0),
    isDelete: account.meta.flags?.isDeleted ?? false,
    source: "stream",
  };
}

/**
 * Convert AssembledAccount to AccountState (for streaming)
 */
function assembledToState(assembled: AssembledAccount): AccountState {
  return {
    address: assembled.address,
    addressHex: bytesToHex(assembled.address),
    slot: assembled.slot,
    seq: assembled.seq,
    meta: assembled.meta,
    data: assembled.data,
    isDelete: assembled.isDelete,
    source: "stream",
  };
}

/**
 * Convert Account from GetAccount to AccountState (for backfill)
 */
function getAccountToState(account: Account): AccountState | null {
  if (!account.address?.value || !account.meta) {
    return null;
  }

  return {
    address: account.address.value,
    addressHex: bytesToHex(account.address.value),
    slot: account.meta.lastUpdatedSlot ?? account.versionContext?.slot ?? 0n,
    seq: BigInt(account.meta.seq.toString()),
    meta: account.meta,
    data: account.data?.data ?? new Uint8Array(0),
    isDelete: account.meta.flags?.isDeleted ?? false,
    source: "backfill",
  };
}

/**
 * Build owner filter for ListAccounts (uses account.meta.owner, not snapshot/update prefixes)
 * Note: ListAccounts requires param name "owner_bytes" (not "owner")
 */
function buildListAccountsOwnerFilter(
  owner: Uint8Array,
  dataSizes?: number[],
  minUpdatedSlot?: bigint
): Filter {
  // ListAccounts filter uses account.meta.owner (no snapshot/update prefix)
  // Must use params.owner_bytes (required param name for ListAccounts)
  let expression = "account.meta.owner.value == params.owner_bytes";

  // Add data size filter if specified
  if (dataSizes && dataSizes.length > 0) {
    const sizeConditions = dataSizes
      .map((size) => `account.meta.data_size == uint(${size})`)
      .join(" || ");
    expression = `(${expression}) && (${sizeConditions})`;
  }

  // Add minUpdatedSlot filter for resumable backfill
  if (minUpdatedSlot !== undefined && minUpdatedSlot > 0n) {
    expression = `(${expression}) && account.meta.last_updated_slot >= params.min_updated_slot`;
  }

  const params: { [key: string]: FilterParamValue } = {
    owner_bytes: create(FilterParamValueSchema, { kind: { case: "bytesValue", value: new Uint8Array(owner) } }),
  };

  if (minUpdatedSlot !== undefined && minUpdatedSlot > 0n) {
    params["min_updated_slot"] = create(FilterParamValueSchema, { kind: { case: "uintValue", value: minUpdatedSlot } });
  }

  return create(FilterSchema, { expression, params });
}

/**
 * Create an async iterable that replays all accounts owned by a program.
 *
 * This performs hybrid backfill + streaming:
 * 1. Starts StreamAccountUpdates concurrently (yields immediately, marks addresses as "seen")
 * 2. ListAccounts with META_ONLY view to get addresses (cheap, no data)
 * 3. GetAccount for each address sequentially (skips if already seen from stream)
 *
 * Stream updates "win" - if an address is received from stream, GetAccount is skipped.
 * This provides resumable, complete account indexing with efficient use of resources.
 *
 * @param options - Replay options
 * @returns Async iterable of account replay events
 *
 * @example
 * ```typescript
 * const client = new ChainClient({ baseUrl: "https://grpc.thru.org" });
 *
 * for await (const event of createAccountsByOwnerReplay({
 *   client,
 *   owner: TOKEN_PROGRAM_ID,
 *   dataSizes: [73, 115], // TokenAccount, MintAccount
 *   minUpdatedSlot: checkpoint.lastProcessedSlot, // Resume from checkpoint
 *   onBackfillComplete: (slot) => console.log(`Backfill queue drained at slot ${slot}`),
 * })) {
 *   if (event.type === "account") {
 *     await processAccount(event.account);
 *   }
 * }
 * ```
 */
export async function* createAccountsByOwnerReplay(
  options: AccountsByOwnerReplayOptions
): AsyncGenerator<AccountReplayEvent, void, undefined> {
  const {
    owner,
    view = AccountView.FULL,
    dataSizes,
    minUpdatedSlot,
    pageSize = 100,
    maxRetries = 3,
    pageAssemblerOptions,
    cleanupInterval = 10000,
    reconnectCleanupTimeoutMs = DEFAULT_RECONNECT_CLEANUP_TIMEOUT_MS,
    retryConfig = DEFAULT_RETRY_CONFIG,
    onBackfillComplete,
    clientFactory,
    logger = NOOP_LOGGER,
    signal,
  } = options;
  const shouldStop = (err?: unknown): boolean => signal?.aborted === true || isAbortError(err);

  // Resolve initial client - either from options or from factory
  let client = resolveClient(options, "AccountsByOwnerReplayOptions");
  const ownsClient = Boolean(clientFactory);

  // Track addresses seen from stream (these win - skip GetAccount)
  const seenFromStream = new Set<string>();

  // Queue of addresses to fetch via GetAccount
  const fetchQueue: Uint8Array[] = [];

  // Highest slot seen (for checkpoint callback)
  let highestSlotSeen = minUpdatedSlot ?? 0n;
  const lastEmittedAccounts = new Map<string, { slot: bigint; seq: bigint }>();

  // Page assembler for streaming
  const assembler = new PageAssembler(pageAssemblerOptions);
  let cleanupTimer: ReturnType<typeof setInterval> | null = null;

  // Buffer for stream events
  const streamBuffer: AccountReplayEvent[] = [];
  const deferredStreamBuffer: AccountReplayEvent[] = [];
  let streamDone = false;
  let streamError: Error | null = null;
  let lastActivityTime = Date.now();
  let activeStreamIterator: AsyncIterator<StreamAccountUpdatesResponse> | null = null;
  let activeStreamProcessor: Promise<void> | null = null;
  let streamGeneration = 0;
  let retryAttempt = 0;
  let pendingCatchUpFromSlot: bigint | null = null;
  const pendingCleanupTasks = new Set<Promise<void>>();

  const shouldEmitAccountState = (account: AccountState): boolean => {
    const previous = lastEmittedAccounts.get(account.addressHex);
    if (
      previous &&
      (account.slot < previous.slot ||
        (account.slot === previous.slot && account.seq <= previous.seq))
    ) {
      return false;
    }

    lastEmittedAccounts.set(account.addressHex, {
      slot: account.slot,
      seq: account.seq,
    });
    if (account.slot > highestSlotSeen) {
      highestSlotSeen = account.slot;
    }
    return true;
  };

  const queueReplayEvent = (event: AccountReplayEvent): boolean => {
    if (event.type === "account") {
      if (!shouldEmitAccountState(event.account)) {
        return false;
      }
      seenFromStream.add(event.account.addressHex);
    }
    streamBuffer.push(event);
    return true;
  };

  const queueStreamEvent = (event: AccountReplayEvent): boolean => {
    if (pendingCatchUpFromSlot !== null) {
      deferredStreamBuffer.push(event);
      return true;
    }
    return queueReplayEvent(event);
  };

  const flushDeferredStreamEvents = (): void => {
    while (deferredStreamBuffer.length > 0) {
      const event = deferredStreamBuffer.shift()!;
      queueReplayEvent(event);
    }
  };

  const getReconnectFromSlot = (): bigint => {
    if (pendingCatchUpFromSlot === null) {
      return highestSlotSeen;
    }
    if (highestSlotSeen <= 0n) {
      return pendingCatchUpFromSlot;
    }
    return pendingCatchUpFromSlot < highestSlotSeen ? pendingCatchUpFromSlot : highestSlotSeen;
  };

  const markCatchUpPending = (fromSlot: bigint): bigint => {
    if (fromSlot <= 0n) {
      return fromSlot;
    }
    if (pendingCatchUpFromSlot === null || fromSlot < pendingCatchUpFromSlot) {
      pendingCatchUpFromSlot = fromSlot;
    }
    return pendingCatchUpFromSlot;
  };

  const markCatchUpCompleted = (fromSlot: bigint): void => {
    if (fromSlot <= 0n) {
      return;
    }
    if (pendingCatchUpFromSlot !== null && fromSlot <= pendingCatchUpFromSlot) {
      pendingCatchUpFromSlot = null;
    }
  };

  const retireActiveStream = (): {
    iterator: AsyncIterator<StreamAccountUpdatesResponse> | null;
    processor: Promise<void> | null;
  } => {
    const iterator = activeStreamIterator;
    const processor = activeStreamProcessor;
    activeStreamIterator = null;
    activeStreamProcessor = null;
    streamGeneration++;
    return { iterator, processor };
  };

  const cleanupRetiredStream = async (
    retired: {
      iterator: AsyncIterator<StreamAccountUpdatesResponse> | null;
      processor: Promise<void> | null;
    },
    iteratorLabel: string,
    processorLabel: string
  ): Promise<void> => {
    if (retired.iterator) {
      await waitForCleanup(
        closeAsyncIterator(retired.iterator),
        reconnectCleanupTimeoutMs,
        iteratorLabel,
        logger,
        signal
      );
    }
    if (shouldStop()) return;

    if (retired.processor) {
      await waitForCleanup(
        Promise.allSettled([retired.processor]),
        reconnectCleanupTimeoutMs,
        processorLabel,
        logger,
        signal
      );
    }
  };

  const cleanupRetiredStreamInBackground = (
    retired: {
      iterator: AsyncIterator<StreamAccountUpdatesResponse> | null;
      processor: Promise<void> | null;
    },
    iteratorLabel: string,
    processorLabel: string
  ): void => {
    const cleanupTask = cleanupRetiredStream(retired, iteratorLabel, processorLabel)
      .catch((err) => {
        logger.warn("Replay stream reconnect cleanup failed", {
          event: "replay.stream.reconnect.cleanup_failed",
          error: err,
        });
      });
    pendingCleanupTasks.add(cleanupTask);
    cleanupTask.finally(() => {
      pendingCleanupTasks.delete(cleanupTask);
    });
  };

  const createFreshClient = (): void => {
    if (!clientFactory) {
      return;
    }

    logger.info("Replay stream fresh client creation started", {
      event: "replay.stream.reconnect.client_started",
    });
    try {
      const previousClient = client;
      const newClient = clientFactory();
      /* Close the previous client after fresh client creation succeeds, so
         callers with closeable transports do not keep stale sessions alive. */
      closeIfCloseable(previousClient);
      client = newClient;
      logger.info("Replay stream fresh client creation completed", {
        event: "replay.stream.reconnect.client_completed",
      });
    } catch (err) {
      logger.error("Replay stream fresh client creation failed", {
        event: "replay.stream.reconnect.client_failed",
        error: err,
      });
      // Continue with existing client as fallback.
    }
  };

  const createStreamProcessor = (
    reason: "initial" | "reconnect" = "initial",
    minSlotOverride?: bigint
  ): void => {
    const minSlot = minSlotOverride ?? (highestSlotSeen > 0n ? highestSlotSeen : minUpdatedSlot);
    const generation = ++streamGeneration;
    const streamStartedAtMs = Date.now();
    let firstMessageSeen = false;
    if (reason === "reconnect") {
      logger.info("Replay stream waiting for first event", {
        event: "replay.stream.waiting_first_event",
        generation,
        min_slot: minSlot?.toString(),
        highest_slot_seen: highestSlotSeen.toString(),
      });
    }

    const newStreamFilter = buildOwnerFilterWithMinSlot(owner, dataSizes, minSlot);
    const newStream = client.streamAccountUpdates({ view, filter: newStreamFilter });
    const newStreamIterator = newStream[Symbol.asyncIterator]();

    streamDone = false;
    streamError = null;
    lastActivityTime = Date.now();
    activeStreamIterator = newStreamIterator;

    const newProcessor = (async () => {
      try {
        while (true) {
          const next = await newStreamIterator.next();
          if (generation !== streamGeneration) {
            return;
          }
          if (next.done) break;

          const response = next.value;
          retryAttempt = 0; // Reset on successful message
          lastActivityTime = Date.now();
          if (reason === "reconnect" && !firstMessageSeen) {
            firstMessageSeen = true;
            logger.info("Replay stream reconnect completed", {
              event: "replay.stream.reconnect.completed",
              generation,
              first_message: true,
              duration_ms: Date.now() - streamStartedAtMs,
            });
          }
          const event = processResponseMulti(response, assembler);
          if (event) {
            queueStreamEvent(event);
          }
        }
      } catch (err) {
        if (generation === streamGeneration) {
          streamError = err as Error;
        }
      } finally {
        if (generation === streamGeneration) {
          streamDone = true;
        }
      }
    })();

    activeStreamProcessor = newProcessor;
  };

  const queueCatchUpAccounts = async (
    fromSlot: bigint,
    reason: "stream_error" | "stream_ended"
  ): Promise<number> => {
    if (fromSlot <= 0n) {
      return 0;
    }

    const startedAtMs = Date.now();
    let accountsListed = 0;
    let accountsFetched = 0;
    let accountsQueued = 0;
    let accountsSkipped = 0;

    logger.info("Replay stream reconnect catch-up started", {
      event: "replay.stream.reconnect.catch_up_started",
      reason,
      from_slot: fromSlot.toString(),
    });

    const catchUpFilter = buildListAccountsOwnerFilter(owner, dataSizes, fromSlot);
    let pageToken: string | undefined;

    do {
      if (shouldStop()) return accountsQueued;

      const request: Partial<ListAccountsRequest> = {
        view: AccountView.META_ONLY,
        filter: catchUpFilter,
        page: create(PageRequestSchema, {
          pageSize,
          pageToken,
        }),
      };

      let response: ListAccountsResponse | null = null;
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          response = await client.listAccounts(request);
          break;
        } catch (err) {
          if (shouldStop(err)) return accountsQueued;
          if (attempt === maxRetries - 1) {
            logger.error("Replay stream reconnect catch-up list accounts failed", {
              event: "replay.stream.reconnect.catch_up_list_failed",
              reason,
              from_slot: fromSlot.toString(),
              page_token: pageToken,
              attempts: maxRetries,
              error: err,
            });
            throw err;
          }

          logger.warn("Replay stream reconnect catch-up list accounts retrying", {
            event: "replay.stream.reconnect.catch_up_list_retry",
            reason,
            from_slot: fromSlot.toString(),
            page_token: pageToken,
            attempt: attempt + 1,
            max_retries: maxRetries,
            error: err,
          });
          await abortableDelay(100 * (attempt + 1), signal);
        }
      }

      if (!response) {
        return accountsQueued;
      }

      for (const listedAccount of response.accounts) {
        if (shouldStop()) return accountsQueued;
        const address = listedAccount.address?.value;
        if (!address) {
          accountsSkipped++;
          continue;
        }

        accountsListed++;
        const addressHex = bytesToHex(address);
        let account: Account | null = null;
        for (let attempt = 0; attempt < maxRetries; attempt++) {
          try {
            account = await client.getAccount({
              address: create(PubkeySchema, { value: address }),
              view: AccountView.FULL,
            });
            break;
          } catch (err) {
            if (shouldStop(err)) return accountsQueued;
            if (attempt === maxRetries - 1) {
              logger.error(`[catch-up] failed to fetch account ${addressHex} after ${maxRetries} attempts`, { error: err });
            } else {
              await abortableDelay(100 * (attempt + 1), signal);
            }
          }
        }

        if (!account) {
          accountsSkipped++;
          continue;
        }

        accountsFetched++;
        const state = getAccountToState(account);
        if (!state || state.slot < fromSlot) {
          accountsSkipped++;
          continue;
        }

        if (queueReplayEvent({ type: "account", account: state })) {
          accountsQueued++;
        } else {
          accountsSkipped++;
        }
      }

      pageToken = response.page?.nextPageToken;
    } while (pageToken);

    logger.info("Replay stream reconnect catch-up completed", {
      event: "replay.stream.reconnect.catch_up_completed",
      reason,
      from_slot: fromSlot.toString(),
      duration_ms: Date.now() - startedAtMs,
      accounts_listed: accountsListed,
      accounts_fetched: accountsFetched,
      accounts_queued: accountsQueued,
      accounts_skipped: accountsSkipped,
    });

    return accountsQueued;
  };

  const queueCatchUpAccountsForReconnect = async (
    fromSlot: bigint,
    reason: "stream_error" | "stream_ended"
  ): Promise<void> => {
    const catchUpFromSlot = markCatchUpPending(fromSlot);
    try {
      await queueCatchUpAccounts(catchUpFromSlot, reason);
      if (shouldStop()) return;
      markCatchUpCompleted(catchUpFromSlot);
      flushDeferredStreamEvents();
    } catch (err) {
      if (shouldStop(err)) return;
      deferredStreamBuffer.length = 0;
      logger.warn("Replay stream reconnect catch-up failed", {
        event: "replay.stream.reconnect.catch_up_failed",
        reason,
        from_slot: catchUpFromSlot.toString(),
        error: err,
      });
      streamDone = true;
      streamError = err instanceof Error ? err : new Error(String(err));
    }
  };

  try {
    if (shouldStop()) return;

    // Set up periodic cleanup for page assembler
    cleanupTimer = setInterval(() => {
      assembler.cleanup();
    }, cleanupInterval);
    cleanupTimer.unref?.();

    // Start streaming FIRST (concurrent with backfill)
    createStreamProcessor();

    // Helper to yield buffered stream events
    const yieldStreamBuffer = function* (): Generator<AccountReplayEvent> {
      while (streamBuffer.length > 0) {
        const event = streamBuffer.shift()!;
        yield event;
      }
    };

    // ListAccounts with META_ONLY view to get addresses (no data)
    const backfillFilter = buildListAccountsOwnerFilter(owner, dataSizes, minUpdatedSlot);
    let pageToken: string | undefined;

    do {
      if (shouldStop()) return;

      const request: Partial<ListAccountsRequest> = {
        view: AccountView.META_ONLY, // Address + metadata only, no data
        filter: backfillFilter,
        page: create(PageRequestSchema, {
          pageSize,
          pageToken,
        }),
      };

      let response;
      try {
        response = await client.listAccounts(request);
      } catch (err) {
        if (shouldStop(err)) return;
        throw err;
      }

      // Queue addresses for GetAccount
      for (const account of response.accounts) {
        if (account.address?.value) {
          fetchQueue.push(account.address.value);
        }
      }

      pageToken = response.page?.nextPageToken;

      // Yield any buffered stream events between pages
      yield* yieldStreamBuffer();
    } while (pageToken);

    // Process fetch queue with GetAccount (sequential)
    for (const address of fetchQueue) {
      if (shouldStop()) return;

      const addressHex = bytesToHex(address);

      // Skip if already seen from stream
      if (seenFromStream.has(addressHex)) {
        continue;
      }

      // Yield any buffered stream events first
      yield* yieldStreamBuffer();

      // Check again after processing buffer (stream may have delivered this address)
      if (seenFromStream.has(addressHex)) {
        continue;
      }

      // Fetch with retry
      let account: Account | null = null;
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          account = await client.getAccount({
            address: create(PubkeySchema, { value: address }),
            view: AccountView.FULL,
          });
          break;
        } catch (err) {
          if (shouldStop(err)) return;
          if (attempt === maxRetries - 1) {
            logger.error(`[backfill] failed to fetch account ${addressHex} after ${maxRetries} attempts`, { error: err });
          } else {
            // Brief delay before retry
            await abortableDelay(100 * (attempt + 1), signal);
          }
        }
      }

      if (account) {
        const state = getAccountToState(account);
        if (state && shouldEmitAccountState(state)) {
          yield { type: "account", account: state };
        }
      }
    }

    // Signal backfill queue drained
    if (onBackfillComplete) {
      onBackfillComplete(highestSlotSeen);
    }

    // Streaming phase with reconnection
    retryAttempt = 0;
    lastActivityTime = Date.now();

    // Continue yielding stream events with reconnection on error
    while (true) {
      if (shouldStop()) return;

      // Yield any buffered events
      const hadEvents = streamBuffer.length > 0;
      yield* yieldStreamBuffer();
      if (hadEvents) {
        lastActivityTime = Date.now();
      }

      // Check for idle timeout - force reconnection if no activity
      const idleMs = Date.now() - lastActivityTime;
      if (!streamDone && idleMs > retryConfig.connectionTimeoutMs) {
        logger.warn("Replay stream idle timeout detected", {
          event: "replay.stream.idle_timeout",
          idleMs,
          connectionTimeoutMs: retryConfig.connectionTimeoutMs,
        });
        streamDone = true;
        streamError = createIdleTimeoutError(retryConfig.connectionTimeoutMs);
      }

      // Check if stream finished (normally or with error)
      if (streamDone) {
        if (streamError) {
          if (shouldStop(streamError)) return;

          // Stream error - reconnect with backoff
          const idleTimeout = isIdleTimeoutError(streamError);
          const backoffMs = idleTimeout ? 0 : calculateBackoff(retryAttempt, retryConfig);
          logger.warn("Replay stream reconnect started", {
            event: "replay.stream.reconnect.started",
            reason: "stream_error",
            error: streamError.message,
            backoffMs,
            attempt: retryAttempt + 1,
            idle_timeout: idleTimeout,
            highestSlotSeen: highestSlotSeen.toString(),
          });
          if (backoffMs > 0) {
            await abortableDelay(backoffMs, signal);
            if (shouldStop()) return;
          }
          if (idleTimeout) {
            retryAttempt = 0;
          } else {
            retryAttempt++;
          }

          // Reset state
          const reconnectFromSlot = getReconnectFromSlot();
          markCatchUpPending(reconnectFromSlot);
          const retired = retireActiveStream();
          streamDone = false;
          streamError = null;
          streamBuffer.length = 0;
          lastActivityTime = Date.now();

          createFreshClient();
          createStreamProcessor("reconnect", reconnectFromSlot > 0n ? reconnectFromSlot : undefined);
          cleanupRetiredStreamInBackground(retired, "old iterator close", "old processor drain");
          await queueCatchUpAccountsForReconnect(reconnectFromSlot, "stream_error");
          continue;
        } else {
          if (shouldStop()) return;

          // Stream ended normally (no error) - this shouldn't happen in practice
          // but if it does, reconnect to maintain live updates
          logger.warn("Replay stream reconnect started", {
            event: "replay.stream.reconnect.started",
            reason: "stream_ended",
            attempt: retryAttempt + 1,
            highestSlotSeen: highestSlotSeen.toString(),
          });
          retryAttempt++;
          const reconnectFromSlot = getReconnectFromSlot();
          markCatchUpPending(reconnectFromSlot);
          const retired = retireActiveStream();
          streamDone = false;
          streamError = null;
          streamBuffer.length = 0;
          lastActivityTime = Date.now();
          createFreshClient();
          createStreamProcessor("reconnect", reconnectFromSlot > 0n ? reconnectFromSlot : undefined);
          cleanupRetiredStreamInBackground(retired, "old iterator close", "old processor drain");
          await queueCatchUpAccountsForReconnect(reconnectFromSlot, "stream_ended");
          continue;
        }
      }

      // Wait a bit for more stream events
      await abortableDelay(10, signal);
    }
  } finally {
    if (cleanupTimer) {
      clearInterval(cleanupTimer);
    }
    const retired = retireActiveStream();
    if (ownsClient) {
      closeIfCloseable(client);
    }
    await cleanupRetiredStream(retired, "final iterator close", "final processor drain");
    if (pendingCleanupTasks.size > 0) {
      await Promise.allSettled([...pendingCleanupTasks]);
    }
    assembler.clear();
  }
}

/**
 * Build owner filter for streaming with minimum slot filter.
 * Only yields accounts updated at or after minSlot.
 */
function buildOwnerFilterWithMinSlot(
  owner: Uint8Array,
  dataSizes?: number[],
  minSlot?: bigint
): Filter {
  // Base filter: match owner on both snapshot and update
  let expression = "(has(snapshot.meta.owner) && snapshot.meta.owner.value == params.owner) || (has(account_update.meta.owner) && account_update.meta.owner.value == params.owner)";

  // Add data size filter if specified
  if (dataSizes && dataSizes.length > 0) {
    const sizeConditions = dataSizes
      .map((size) => `snapshot.meta.data_size == uint(${size}) || account_update.meta.data_size == uint(${size})`)
      .join(" || ");
    expression = `(${expression}) && (${sizeConditions})`;
  }

  // Add slot filter for handover from backfill
  // Note: We allow snapshots through (they don't have slot field) and filter updates by slot
  // has() requires a field path, so we check has(snapshot.address) to detect snapshot messages
  if (minSlot !== undefined && minSlot > 0n) {
    // Snapshots pass through (check via has(snapshot.address)), updates must have slot >= minSlot
    expression = `(${expression}) && (has(snapshot.address) || (has(account_update.slot) && account_update.slot >= params.min_slot))`;
  }

  const params: { [key: string]: FilterParamValue } = {
    owner: create(FilterParamValueSchema, { kind: { case: "bytesValue", value: new Uint8Array(owner) } }),
  };

  if (minSlot !== undefined && minSlot > 0n) {
    params["min_slot"] = create(FilterParamValueSchema, { kind: { case: "uintValue", value: minSlot } });
  }

  return create(FilterSchema, { expression, params });
}

/**
 * Create an async iterable for account replay with page assembly.
 *
 * This function streams account updates with proper page assembly for
 * large accounts. It handles:
 * - Initial snapshots
 * - Live updates with page assembly
 * - Block finished signals
 *
 * @param options - Account replay options
 * @returns Async iterable of account replay events
 *
 * @example
 * ```typescript
 * const client = new ChainClient({ baseUrl: "https://grpc.thru.org" });
 *
 * for await (const event of createAccountReplay({
 *   client,
 *   address: accountPubkey,
 *   view: AccountView.FULL,
 * })) {
 *   if (event.type === "account") {
 *     console.log("Account update:", event.account.seq);
 *   } else if (event.type === "blockFinished") {
 *     console.log("Block finished:", event.block.slot);
 *   }
 * }
 * ```
 */
export async function* createAccountReplay(
  options: AccountReplayOptions
): AsyncGenerator<AccountReplayEvent, void, undefined> {
  const {
    client,
    address,
    view = AccountView.FULL,
    filter,
    pageAssemblerOptions,
    cleanupInterval = 10000,
  } = options;

  const assembler = new PageAssembler(pageAssemblerOptions);
  let cleanupTimer: ReturnType<typeof setInterval> | null = null;

  try {
    // Set up periodic cleanup
    cleanupTimer = setInterval(() => {
      assembler.cleanup();
    }, cleanupInterval);
    cleanupTimer.unref?.();

    // Build request with address filter
    const filterParams: { [key: string]: FilterParamValue } = {
      address: create(FilterParamValueSchema, { kind: { case: "bytesValue", value: new Uint8Array(address) } }),
    };
    if (filter?.params) {
      for (const [key, value] of Object.entries(filter.params)) {
        filterParams[key] = create(FilterParamValueSchema, value as any);
      }
    }

    const request: Partial<StreamAccountUpdatesRequest> = {
      view,
      filter: create(FilterSchema, {
        expression: filter?.expression
          ? `(snapshot.address.value == params.address) && (${filter.expression})`
          : "snapshot.address.value == params.address",
        params: filterParams,
      }),
    };

    // Stream account updates
    const stream = client.streamAccountUpdates(request);

    for await (const response of stream) {
      const event = processResponse(response, address, assembler);
      if (event) {
        yield event;
      }
    }
  } finally {
    // Cleanup
    if (cleanupTimer) {
      clearInterval(cleanupTimer);
    }
    assembler.clear();
  }
}

/**
 * Process a streaming response and return an event if available
 */
function processResponse(
  response: StreamAccountUpdatesResponse,
  address: Uint8Array,
  assembler: PageAssembler
): AccountReplayEvent | null {
  switch (response.message.case) {
    case "snapshot": {
      const state = snapshotToState(response.message.value);
      if (state) {
        return { type: "account", account: state };
      }
      return null;
    }

    case "update": {
      const assembled = assembler.processUpdate(address, response.message.value);
      if (assembled) {
        return { type: "account", account: assembledToState(assembled) };
      }
      return null;
    }

    case "finished": {
      return {
        type: "blockFinished",
        block: { slot: BigInt(response.message.value.slot.toString()) },
      };
    }

    default:
      return null;
  }
}

/**
 * Process a streaming response for multi-account streams (gets address from response)
 */
function processResponseMulti(
  response: StreamAccountUpdatesResponse,
  assembler: PageAssembler
): AccountReplayEvent | null {
  switch (response.message.case) {
    case "snapshot": {
      const state = snapshotToState(response.message.value);
      if (state) {
        return { type: "account", account: state };
      }
      return null;
    }

    case "update": {
      const update = response.message.value;
      // Get address from the update message
      const address = update.address?.value;
      if (!address) {
        // No address in update, cannot process
        return null;
      }
      const assembled = assembler.processUpdate(address, update);
      if (assembled) {
        return { type: "account", account: assembledToState(assembled) };
      }
      return null;
    }

    case "finished": {
      return {
        type: "blockFinished",
        block: { slot: BigInt(response.message.value.slot.toString()) },
      };
    }

    default:
      return null;
  }
}

/**
 * State tracker for account sequence numbers.
 *
 * Used to track the highest sequence number seen per account address
 * to ensure updates are applied in order.
 */
export class AccountSeqTracker {
  private seqs: Map<string, bigint> = new Map();

  /**
   * Get the current sequence number for an address
   */
  getSeq(addressHex: string): bigint | undefined {
    return this.seqs.get(addressHex);
  }

  /**
   * Check if an update should be applied (seq > current)
   */
  shouldApply(addressHex: string, seq: bigint): boolean {
    const current = this.seqs.get(addressHex);
    return current === undefined || seq > current;
  }

  /**
   * Update the sequence number for an address
   * Only updates if new seq is greater than current
   */
  update(addressHex: string, seq: bigint): boolean {
    const current = this.seqs.get(addressHex);
    if (current === undefined || seq > current) {
      this.seqs.set(addressHex, seq);
      return true;
    }
    return false;
  }

  /**
   * Remove tracking for an address
   */
  remove(addressHex: string): void {
    this.seqs.delete(addressHex);
  }

  /**
   * Clear all tracking
   */
  clear(): void {
    this.seqs.clear();
  }

  /**
   * Get count of tracked addresses
   */
  size(): number {
    return this.seqs.size;
  }
}

/**
 * Multi-account replay manager for streaming updates from multiple accounts.
 *
 * This class manages multiple account streams and provides:
 * - Unified event stream from multiple accounts
 * - Sequence number tracking per account
 * - Automatic reconnection on errors
 */
export class MultiAccountReplay {
  private client: AccountSource;
  private view: AccountView;
  private seqTracker: AccountSeqTracker;
  private activeStreams: Map<string, AbortController> = new Map();

  constructor(options: { client: AccountSource; view?: AccountView }) {
    this.client = options.client;
    this.view = options.view ?? AccountView.FULL;
    this.seqTracker = new AccountSeqTracker();
  }

  /**
   * Add an account to stream updates for
   */
  async *addAccount(address: Uint8Array): AsyncGenerator<AccountReplayEvent> {
    const addressHex = bytesToHex(address);

    // Check if already streaming
    if (this.activeStreams.has(addressHex)) {
      return;
    }

    const controller = new AbortController();
    this.activeStreams.set(addressHex, controller);

    try {
      for await (const event of createAccountReplay({
        client: this.client,
        address,
        view: this.view,
      })) {
        // Filter by sequence number
        if (event.type === "account") {
          if (this.seqTracker.shouldApply(event.account.addressHex, event.account.seq)) {
            this.seqTracker.update(event.account.addressHex, event.account.seq);
            yield event;
          }
        } else {
          yield event;
        }
      }
    } finally {
      this.activeStreams.delete(addressHex);
    }
  }

  /**
   * Remove an account from streaming
   */
  removeAccount(address: Uint8Array): void {
    const addressHex = bytesToHex(address);
    const controller = this.activeStreams.get(addressHex);
    if (controller) {
      controller.abort();
      this.activeStreams.delete(addressHex);
    }
    this.seqTracker.remove(addressHex);
  }

  /**
   * Get the current sequence number for an account
   */
  getSeq(addressHex: string): bigint | undefined {
    return this.seqTracker.getSeq(addressHex);
  }

  /**
   * Stop all streams
   */
  stop(): void {
    for (const controller of this.activeStreams.values()) {
      controller.abort();
    }
    this.activeStreams.clear();
    this.seqTracker.clear();
  }
}
