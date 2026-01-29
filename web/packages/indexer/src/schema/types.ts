/**
 * Schema type definitions with improved type safety.
 * Uses branded types and conditional inference for better DX.
 */

import type { PgTableWithColumns, PgColumn } from "drizzle-orm/pg-core";

// ============================================================
// Column Definition Types
// ============================================================

/** Supported column data types */
export type ColumnType = "text" | "bigint" | "integer" | "boolean" | "timestamp";

/** Internal modifiers for a column definition */
export interface ColumnModifiers<T, TNull extends boolean = boolean> {
  /** Phantom type for inference */
  readonly _type: T;
  /** Whether the column allows null - literal type for proper inference */
  readonly _nullable: TNull;
  /** Whether the column is indexed */
  readonly _indexed: boolean;
  /** Whether the column has a unique constraint */
  readonly _unique: boolean;
  /** Whether the column is the primary key */
  readonly _primary: boolean;
  /** Default value for the column */
  readonly _default?: T;
  /** Whether to use current timestamp as default */
  readonly _defaultNow?: boolean;
  /** Foreign key reference */
  readonly _references?: { table: PgTableWithColumns<any>; column: string };
  /** The underlying column type */
  readonly _columnType: ColumnType;
}

/** A column definition with fluent modifiers */
export interface ColumnDef<T, TNull extends boolean = true> extends ColumnModifiers<T, TNull> {
  /** Mark column as NOT NULL - changes the type to non-nullable */
  notNull(): ColumnDef<T, false>;
  /** Add an index on this column */
  index(): ColumnDef<T, TNull>;
  /** Add a unique constraint */
  unique(): ColumnDef<T, TNull>;
  /** Mark as primary key (implies NOT NULL) */
  primaryKey(): ColumnDef<T, false>;
  /** Set a default value */
  default(value: T): ColumnDef<T, TNull>;
  /** Use current timestamp as default (only for timestamp columns) */
  defaultNow(): ColumnDef<T, TNull>;
  /** Add a foreign key reference */
  references<TTable extends PgTableWithColumns<any>>(
    table: TTable | (() => TTable),
    column: keyof TTable["_"]["columns"]
  ): ColumnDef<T, TNull>;
}

/** Any column definition (for generic constraints) */
export type AnyColumnDef = ColumnDef<unknown, boolean>;

// ============================================================
// Schema Definition Types
// ============================================================

/** A schema is a record of column definitions */
export type SchemaDefinition = Record<string, AnyColumnDef>;

/**
 * Infer the row type from a schema definition.
 * Handles nullable columns and preserves exact types.
 * Uses conditional type to check the literal `_nullable` type parameter.
 */
export type InferRow<TSchema extends SchemaDefinition> = {
  [K in keyof TSchema]: TSchema[K] extends ColumnDef<infer T, infer TNull>
    ? TNull extends false
      ? T
      : T | null
    : never;
};

/**
 * Infer the insert type from a schema definition.
 * Makes fields optional if they have defaults or are nullable.
 */
export type InferInsert<TSchema extends SchemaDefinition> = {
  // Required fields: NOT NULL without default
  [K in keyof TSchema as TSchema[K] extends ColumnDef<unknown, false>
    ? TSchema[K]["_default"] extends undefined
      ? TSchema[K]["_defaultNow"] extends true
        ? never
        : K
      : never
    : never]: TSchema[K] extends ColumnDef<infer T, infer _TNull> ? T : never;
} & {
  // Optional fields: nullable OR has default
  [K in keyof TSchema as TSchema[K] extends ColumnDef<unknown, true>
    ? K
    : TSchema[K]["_default"] extends undefined
      ? TSchema[K]["_defaultNow"] extends true
        ? K
        : never
      : K]?: TSchema[K] extends ColumnDef<infer T, infer _TNull> ? T | null : never;
};

/**
 * Column accessors for use with Drizzle operators (eq, inArray, etc.).
 * Maps field names to Drizzle column references.
 *
 * Note: We use `any` here because the full PgColumn type is complex
 * and varies based on many internal Drizzle factors. The column
 * references work correctly at runtime for use with eq(), inArray(), etc.
 */
export type Columns<TSchema extends SchemaDefinition> = {
  [K in keyof TSchema]: PgColumn<any>;
};

// ============================================================
// Database Types
// ============================================================

import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

/** Database client type - generic to work with any schema */
export type DatabaseClient = PostgresJsDatabase<Record<string, unknown>>;
