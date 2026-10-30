import type { PgTableWithColumns, PgColumn } from "drizzle-orm/pg-core";

export type ColumnType = "text" | "bigint" | "integer" | "boolean" | "timestamp";

export interface ColumnModifiers<T, TNull extends boolean = boolean> {
  readonly _type: T;
  readonly _nullable: TNull;
  readonly _indexed: boolean;
  readonly _unique: boolean;
  readonly _primary: boolean;
  readonly _default?: T;
  readonly _defaultNow?: boolean;
  readonly _references?: { table: PgTableWithColumns<any>; column: string };
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
  [K in keyof TSchema as TSchema[K] extends ColumnDef<unknown, false>
    ? TSchema[K]["_default"] extends undefined
      ? TSchema[K]["_defaultNow"] extends true
        ? never
        : K
      : never
    : never]: TSchema[K] extends ColumnDef<infer T, infer _TNull> ? T : never;
} & {
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
 */
export type Columns<TSchema extends SchemaDefinition> = {
  [K in keyof TSchema]: PgColumn<any>;
};

import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

/** Database client type - generic to work with any schema */
export type DatabaseClient = PostgresJsDatabase<Record<string, unknown>>;
