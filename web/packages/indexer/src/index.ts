export {
  t,
  columnBuilder,
  type ColumnBuilder,
  type TableExtraConfig,
  type TableIndexDefinition,
} from "./schema";
export type {
  ColumnDef,
  AnyColumnDef,
  SchemaDefinition,
  InferRow,
  InferInsert,
  Columns,
  DatabaseClient,
} from "./schema";

export { generateZodSchema, validateParsedData } from "./schema";

export { defineEventStream } from "./streams";
export type { EventStream, EventStreamDefinition } from "./streams";

export { defineAccountStream } from "./accounts";
export type { AccountStream, AccountStreamDefinition } from "./accounts";

export { checkpointTable, type Checkpoint } from "./checkpoint";
export {
  getCheckpoint,
  updateCheckpoint,
  deleteCheckpoint,
  getAllCheckpoints,
  getSchemaExports,
} from "./checkpoint";

export { Indexer, type IndexerResult } from "./runtime";
export type {
  IndexerConfig,
  IndexerStatus,
  IndexerStreamStatus,
  IndexerStreamState,
  IndexerStreamKind,
  NormalizedIndexerError,
} from "./runtime";

export type { ApiConfig, StreamBatch, HookContext } from "./types";

export * from "./projections/writer";
export * from "./projections/define";

export * from "./delivery/outbox";
export { migrateProjectionStorage } from "./projections/migration";
export { projectionStorage } from "./projections/schema";

export { createPostgresClient } from "./postgres";
