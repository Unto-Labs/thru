/**
 * @thru/indexer - Reusable blockchain indexing framework
 *
 * A flexible library for building backends that index Thru chain data.
 *
 * @example
 * ```ts
 * import {
 *   defineEventStream,
 *   defineAccountStream,
 *   t,
 *   Indexer,
 *   checkpointTable,
 * } from "@thru/indexer";
 * ```
 */

// ============================================================
// Schema Builder
// ============================================================

export { t, columnBuilder, type ColumnBuilder } from "./schema";
export type {
  ColumnDef,
  AnyColumnDef,
  SchemaDefinition,
  InferRow,
  InferInsert,
  Columns,
  DatabaseClient,
} from "./schema";

// Validation (for development/debugging)
export { generateZodSchema, validateParsedData } from "./schema";

// ============================================================
// Event Streams
// ============================================================

export { defineEventStream } from "./streams";
export type { EventStream, EventStreamDefinition } from "./streams";

// ============================================================
// Account Streams
// ============================================================

export { defineAccountStream } from "./accounts";
export type { AccountStream, AccountStreamDefinition } from "./accounts";

// ============================================================
// Checkpoint
// ============================================================

export { checkpointTable, type Checkpoint } from "./checkpoint";
export {
  getCheckpoint,
  updateCheckpoint,
  deleteCheckpoint,
  getAllCheckpoints,
  getSchemaExports,
} from "./checkpoint";

// ============================================================
// Runtime
// ============================================================

export { Indexer, type IndexerResult } from "./runtime";
export type {
  IndexerConfig,
  IndexerStatus,
  IndexerStreamStatus,
  IndexerStreamState,
  IndexerStreamKind,
  NormalizedIndexerError,
} from "./runtime";

// ============================================================
// Shared Types
// ============================================================

export type { ApiConfig, StreamBatch, HookContext } from "./types";
