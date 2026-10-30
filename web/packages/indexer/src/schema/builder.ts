import type { PgTableWithColumns } from "drizzle-orm/pg-core";
import type { ColumnDef, ColumnType } from "./types";

interface ColumnState<T> {
  _type: T;
  _columnType: ColumnType;
  _nullable: boolean;
  _indexed: boolean;
  _unique: boolean;
  _primary: boolean;
  _default?: T;
  _defaultNow?: boolean;
  _references?: { table: PgTableWithColumns<any>; column: string };
}

function createBuilder<T, TNull extends boolean>(
  state: ColumnState<T>
): ColumnDef<T, TNull> {
  const builder: ColumnDef<T, TNull> = {
    get _type() { return state._type; },
    get _columnType() { return state._columnType; },
    get _nullable() { return state._nullable as TNull; },
    get _indexed() { return state._indexed; },
    get _unique() { return state._unique; },
    get _primary() { return state._primary; },
    get _default() { return state._default; },
    get _defaultNow() { return state._defaultNow; },
    get _references() { return state._references; },

    notNull(): ColumnDef<T, false> {
      state._nullable = false;
      return createBuilder<T, false>(state);
    },

    index(): ColumnDef<T, TNull> {
      state._indexed = true;
      return builder;
    },

    unique(): ColumnDef<T, TNull> {
      state._unique = true;
      return builder;
    },

    primaryKey(): ColumnDef<T, false> {
      state._primary = true;
      state._nullable = false;
      return createBuilder<T, false>(state);
    },

    default(value: T): ColumnDef<T, TNull> {
      state._default = value;
      return builder;
    },

    defaultNow(): ColumnDef<T, TNull> {
      state._defaultNow = true;
      return builder;
    },

    references<TTable extends PgTableWithColumns<any>>(
      table: TTable | (() => TTable),
      column: keyof TTable["_"]["columns"]
    ): ColumnDef<T, TNull> {
      const resolvedTable = typeof table === "function" ? table() : table;
      state._references = { table: resolvedTable, column: column as string };
      return builder;
    },
  };

  return builder;
}

function createColumnDef<T>(type: ColumnType): ColumnDef<T, true> {
  const state: ColumnState<T> = {
    _type: undefined as T,
    _columnType: type,
    _nullable: true,
    _indexed: false,
    _unique: false,
    _primary: false,
    _default: undefined,
    _defaultNow: false,
    _references: undefined,
  };

  return createBuilder<T, true>(state);
}

/**
 * Interface for the column builder.
 * Each method creates a new column definition of the appropriate type.
 */
export interface ColumnBuilder {
  /** Text column (varchar) */
  text(): ColumnDef<string, true>;
  /** BigInt column (64-bit integer) - use for slots, amounts */
  bigint(): ColumnDef<bigint, true>;
  /** Integer column (32-bit) */
  integer(): ColumnDef<number, true>;
  /** Boolean column */
  boolean(): ColumnDef<boolean, true>;
  /** Timestamp column with timezone */
  timestamp(): ColumnDef<Date, true>;
}

/**
 * Global column builder for defining schemas.
 *
 * @example
 * ```ts
 * const schema = {
 *   id: t.text().primaryKey(),
 *   slot: t.bigint().notNull().index(),
 *   name: t.text(),
 *   active: t.boolean().notNull().default(true),
 *   createdAt: t.timestamp().notNull().defaultNow(),
 * };
 * ```
 */
export const t: ColumnBuilder = {
  text: () => createColumnDef<string>("text"),
  bigint: () => createColumnDef<bigint>("bigint"),
  integer: () => createColumnDef<number>("integer"),
  boolean: () => createColumnDef<boolean>("boolean"),
  timestamp: () => createColumnDef<Date>("timestamp"),
};

/**
 * Alternative export for the column builder.
 * Same as `t` but with a more descriptive name.
 */
export const columnBuilder = t;
