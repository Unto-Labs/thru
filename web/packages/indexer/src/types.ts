/**
 * Shared types for the indexer library.
 */

import type { DatabaseClient } from "./schema/types";

// Re-export database client type
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
  /** The slot these events belong to */
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
