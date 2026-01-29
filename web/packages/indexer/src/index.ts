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
 *   mountStreamRoutes,
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
// API Generation
// ============================================================

export { mountStreamRoutes, type MountRoutesOptions } from "./api";
export { generateSchemas, type GeneratedSchemas } from "./api";
export {
  paginationQuerySchema,
  paginationResponseSchema,
  dataResponse,
  listResponse,
  errorSchema,
  paginate,
  parseCursor,
  type PaginationQuery,
  type PaginationResponse,
  type PaginationResult,
  type ErrorResponse,
} from "./api";

// ============================================================
// Runtime
// ============================================================

export { Indexer, type IndexerResult } from "./runtime";
export type { IndexerConfig } from "./runtime";

// ============================================================
// Shared Types
// ============================================================

export type { ApiConfig, StreamBatch, HookContext } from "./types";
