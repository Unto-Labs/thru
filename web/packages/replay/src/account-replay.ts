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
import type { Account, AccountMeta, GetAccountRequest } from "@thru/proto";
import {
  AccountView,
  FilterSchema,
  FilterParamValueSchema,
  PageRequestSchema,
  PubkeySchema,
} from "@thru/proto";
import type {
  StreamAccountUpdatesRequest,
  StreamAccountUpdatesResponse,
  ListAccountsRequest,
  BlockFinished,
  Filter,
  FilterParamValue,
} from "@thru/proto";
import type { AccountSource } from "./chain-client";
import { PageAssembler, type AssembledAccount } from "./page-assembler";
import {
  DEFAULT_RETRY_CONFIG,
  calculateBackoff,
  delay,
  type RetryConfig,
} from "./retry";
import type { ReplayLogger } from "./types";
import { resolveClient } from "./types";
import { NOOP_LOGGER } from "./logger";

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

  /** Called when backfill queue is drained. Returns the highest slot seen during backfill. */
  onBackfillComplete?: (highestSlot: bigint) => void;

  /** Logger for debug/info/warn/error messages (default: NOOP_LOGGER) */
  logger?: ReplayLogger;
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
    onBackfillComplete,
    clientFactory,
    logger = NOOP_LOGGER,
  } = options;

  // Resolve initial client - either from options or from factory
  let client = resolveClient(options, "AccountsByOwnerReplayOptions");

  // Track addresses seen from stream (these win - skip GetAccount)
  const seenFromStream = new Set<string>();

  // Queue of addresses to fetch via GetAccount
  const fetchQueue: Uint8Array[] = [];

  // Highest slot seen (for checkpoint callback)
  let highestSlotSeen = minUpdatedSlot ?? 0n;

  // Page assembler for streaming
  const assembler = new PageAssembler(pageAssemblerOptions);
  let cleanupTimer: ReturnType<typeof setInterval> | null = null;

  // Buffer for stream events
  const streamBuffer: AccountReplayEvent[] = [];
  let streamDone = false;
  let streamError: Error | null = null;

  try {
    // Set up periodic cleanup for page assembler
    cleanupTimer = setInterval(() => {
      assembler.cleanup();
    }, cleanupInterval);

    // Start streaming FIRST (concurrent with backfill)
    const streamFilter = buildOwnerFilterWithMinSlot(owner, dataSizes, minUpdatedSlot);
    const stream = client.streamAccountUpdates({ view, filter: streamFilter });

    // Process stream in background, buffering events
    const streamProcessor = (async () => {
      try {
        for await (const response of stream) {
          const event = processResponseMulti(response, assembler);
          if (event) {
            if (event.type === "account") {
              // Mark as seen - don't need to GetAccount for this one
              seenFromStream.add(event.account.addressHex);
              if (event.account.slot > highestSlotSeen) {
                highestSlotSeen = event.account.slot;
              }
            }
            streamBuffer.push(event);
          }
        }
      } catch (err) {
        streamError = err as Error;
      } finally {
        streamDone = true;
      }
    })();

    // Helper to yield buffered stream events
    const yieldStreamBuffer = function* (): Generator<AccountReplayEvent> {
      while (streamBuffer.length > 0) {
        const event = streamBuffer.shift()!;
        if (event.type === "account") {
          // Ensure it's marked as seen (should already be, but belt and suspenders)
          seenFromStream.add(event.account.addressHex);
        }
        yield event;
      }
    };

    // ListAccounts with META_ONLY view to get addresses (no data)
    const backfillFilter = buildListAccountsOwnerFilter(owner, dataSizes, minUpdatedSlot);
    let pageToken: string | undefined;

    do {
      const request: Partial<ListAccountsRequest> = {
        view: AccountView.META_ONLY, // Address + metadata only, no data
        filter: backfillFilter,
        page: create(PageRequestSchema, {
          pageSize,
          pageToken,
        }),
      };

      const response = await client.listAccounts(request);

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
          if (attempt === maxRetries - 1) {
            logger.error(`[backfill] failed to fetch account ${addressHex} after ${maxRetries} attempts`, { error: err });
          } else {
            // Brief delay before retry
            await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
          }
        }
      }

      if (account) {
        const state = getAccountToState(account);
        if (state) {
          if (state.slot > highestSlotSeen) {
            highestSlotSeen = state.slot;
          }
          yield { type: "account", account: state };
        }
      }
    }

    // Signal backfill queue drained
    if (onBackfillComplete) {
      onBackfillComplete(highestSlotSeen);
    }

    // Streaming phase with reconnection
    const retryConfig = DEFAULT_RETRY_CONFIG;
    let retryAttempt = 0;
    let currentStream = stream;
    let currentStreamProcessor = streamProcessor;

    // Helper to create a new stream and processor with fresh client
    const createStreamProcessor = () => {
      // Get fresh client if factory available (key fix for reconnection)
      if (clientFactory) {
        try {
          client = clientFactory();
          logger.info("[account-stream] created fresh client for reconnection");
        } catch (err) {
          logger.error("[account-stream] failed to create fresh client", { error: err });
          // Continue with existing client as fallback
        }
      }

      const newStreamFilter = buildOwnerFilterWithMinSlot(owner, dataSizes, highestSlotSeen > 0n ? highestSlotSeen : minUpdatedSlot);
      const newStream = client.streamAccountUpdates({ view, filter: newStreamFilter });
      const newProcessor = (async () => {
        try {
          for await (const response of newStream) {
            retryAttempt = 0; // Reset on successful message
            const event = processResponseMulti(response, assembler);
            if (event) {
              if (event.type === "account") {
                seenFromStream.add(event.account.addressHex);
                if (event.account.slot > highestSlotSeen) {
                  highestSlotSeen = event.account.slot;
                }
              }
              streamBuffer.push(event);
            }
          }
        } catch (err) {
          streamError = err as Error;
        } finally {
          streamDone = true;
        }
      })();
      return { stream: newStream, processor: newProcessor };
    };

    // Continue yielding stream events with reconnection on error
    while (true) {
      // Yield any buffered events
      yield* yieldStreamBuffer();

      // Check if stream finished (normally or with error)
      if (streamDone) {
        if (streamError) {
          // Stream error - reconnect with backoff
          const backoffMs = calculateBackoff(retryAttempt, retryConfig);
          logger.warn(
            `[account-stream] disconnected (${streamError.message}); reconnecting in ${backoffMs}ms (attempt ${retryAttempt + 1})`
          );
          await delay(backoffMs);
          retryAttempt++;

          // Reset state
          streamDone = false;
          streamError = null;
          streamBuffer.length = 0;

          // Create new stream
          const { stream: newStream, processor: newProcessor } = createStreamProcessor();
          currentStream = newStream;
          currentStreamProcessor = newProcessor;
          continue;
        } else {
          // Stream ended normally (no error) - this shouldn't happen in practice
          // but if it does, reconnect to maintain live updates
          logger.warn("[account-stream] stream ended unexpectedly; reconnecting...");
          streamDone = false;
          const { stream: newStream, processor: newProcessor } = createStreamProcessor();
          currentStream = newStream;
          currentStreamProcessor = newProcessor;
          continue;
        }
      }

      // Wait a bit for more stream events
      await delay(10);
    }
  } finally {
    if (cleanupTimer) {
      clearInterval(cleanupTimer);
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
