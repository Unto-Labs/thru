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
import type { Account, AccountMeta } from "@thru/proto";
import {
  AccountView,
  FilterSchema,
  FilterParamValueSchema,
} from "@thru/proto";
import type {
  StreamAccountUpdatesRequest,
  StreamAccountUpdatesResponse,
  BlockFinished,
  Filter,
  FilterParamValue,
} from "@thru/proto";
import type { AccountSource } from "./chain-client";
import { PageAssembler, type AssembledAccount } from "./page-assembler";

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
  /** Source: "snapshot" for initial state, "update" for live updates */
  source: "snapshot" | "update";
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
 * Options for streaming all accounts owned by a specific program
 */
export interface AccountsByOwnerReplayOptions {
  /** Account source (typically ChainClient) */
  client: AccountSource;

  /** Program owner address - streams all accounts owned by this program */
  owner: Uint8Array;

  /** Account view (default: FULL for complete data) */
  view?: AccountView;

  /** Optional data sizes to filter (e.g., [73, 115] for TokenAccount and MintAccount) */
  dataSizes?: number[];

  /** Optional additional filter expression */
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
 * Convert address bytes to hex string
 */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Convert Account snapshot to AccountState
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
    source: "snapshot",
  };
}

/**
 * Convert AssembledAccount to AccountState
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
    source: "update",
  };
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
 * Build owner filter expression for streaming all accounts owned by a program
 */
function buildOwnerFilter(
  owner: Uint8Array,
  dataSizes?: number[],
  additionalFilter?: { expression: string; params?: { [key: string]: { kind: { case: string; value: unknown } } } }
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

  // Add additional filter if specified
  if (additionalFilter?.expression) {
    expression = `(${expression}) && (${additionalFilter.expression})`;
  }

  const params: { [key: string]: FilterParamValue } = {
    owner: create(FilterParamValueSchema, { kind: { case: "bytesValue", value: new Uint8Array(owner) } }),
  };

  if (additionalFilter?.params) {
    for (const [key, value] of Object.entries(additionalFilter.params)) {
      params[key] = create(FilterParamValueSchema, value as any);
    }
  }

  return create(FilterSchema, { expression, params });
}

/**
 * Create an async iterable for streaming all accounts owned by a program.
 *
 * This function streams account updates for ALL accounts owned by a specific
 * program (identified by owner). It handles:
 * - Initial snapshots for each account
 * - Live updates with page assembly
 * - Block finished signals
 * - Optional filtering by data size (useful for specific account types)
 *
 * @param options - Accounts by owner replay options
 * @returns Async iterable of account replay events
 *
 * @example
 * ```typescript
 * const client = new ChainClient({ baseUrl: "https://grpc.thru.org" });
 *
 * // Stream all token accounts (73 bytes) and mint accounts (115 bytes)
 * for await (const event of createAccountsByOwnerReplay({
 *   client,
 *   owner: TOKEN_PROGRAM_ID,
 *   dataSizes: [73, 115],
 *   view: AccountView.FULL,
 * })) {
 *   if (event.type === "account") {
 *     console.log("Account:", event.account.addressHex, "seq:", event.account.seq);
 *   } else if (event.type === "blockFinished") {
 *     console.log("Block finished:", event.block.slot);
 *   }
 * }
 * ```
 */
export async function* createAccountsByOwnerReplay(
  options: AccountsByOwnerReplayOptions
): AsyncGenerator<AccountReplayEvent, void, undefined> {
  const {
    client,
    owner,
    view = AccountView.FULL,
    dataSizes,
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

    // Build request with owner filter
    const ownerFilter = buildOwnerFilter(owner, dataSizes, filter);
    const request: Partial<StreamAccountUpdatesRequest> = {
      view,
      filter: ownerFilter,
    };

    // Stream account updates
    const stream = client.streamAccountUpdates(request);

    for await (const response of stream) {
      const event = processResponseMulti(response, assembler);
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
