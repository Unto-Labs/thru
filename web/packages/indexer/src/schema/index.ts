/**
 * Schema module exports.
 */

// Types
export type {
  ColumnDef,
  AnyColumnDef,
  ColumnType,
  SchemaDefinition,
  InferRow,
  InferInsert,
  Columns,
  DatabaseClient,
} from "./types";

// Column builder
export { t, columnBuilder, type ColumnBuilder } from "./builder";

// Table builder
export { buildDrizzleTable } from "./table";

// Validation
export { generateZodSchema, validateParsedData } from "./validation";
