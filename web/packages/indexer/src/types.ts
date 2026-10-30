import type { DatabaseClient } from "./schema/types";

export type { DatabaseClient } from "./schema/types";

/**
 * API configuration for route generation.
 * Used by event streams, account streams, and tables.
 */
export interface ApiConfig {
  /** Enable API routes (default: true) */
  enabled?: boolean;
  /** Fields that can be filtered via query params */
  filters?: string[];
  /** Primary key field name (default: "id" for event streams, "address" for account streams) */
  idField?: string;
}

/**
 * A batch of parsed events ready to commit.
 * Used by the stream processor for batching before database writes.
 */
export interface StreamBatch<T = unknown> {
  /** Slot of the last event; a batch can span several slots */
  slot: bigint;
  /** The parsed events in this batch */
  events: T[];
}

/**
 * Context passed to stream hooks (filterBatch, onCommit).
 */
export interface HookContext {
  /** Database client for queries */
  db: DatabaseClient;
}
