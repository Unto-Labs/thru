/**
 * Build Drizzle tables from schema definitions.
 */

import {
  pgTable,
  text,
  bigint,
  integer,
  boolean,
  timestamp,
  index,
  type PgTableWithColumns,
  type PgColumnBuilderBase,
  type ExtraConfigColumn,
  type PgTableExtraConfigValue,
} from "drizzle-orm/pg-core";
import type { AnyColumnDef, ColumnType, SchemaDefinition } from "./types";

export interface TableIndexDefinition<TSchema extends SchemaDefinition> {
  /** Optional database index name. A deterministic name is generated when omitted. */
  name?: string;
  /** Schema fields included in the index, in query-prefix order. */
  columns: readonly (keyof TSchema & string)[];
}

/**
 * Extra Drizzle table config: checks, and indexes the schema builder cannot
 * express (expression, descending or partial). Receives the built columns and
 * returns values appended to the pgTable extra config, so drizzle-kit
 * generates them into migrations.
 *
 * @example
 * ```ts
 * extraConfig: (table) => [
 *   check("mints_decimals_check", sql`${table.decimals} BETWEEN 0 AND 255`),
 *   index("mints_ticker_search_idx").on(sql`lower(${table.ticker})`, table.address),
 *   index("events_history_idx").on(table.slot.desc(), table.id.desc()),
 * ]
 * ```
 */
export type TableExtraConfig<TSchema extends SchemaDefinition> = (
  table: { [K in keyof TSchema]: ExtraConfigColumn }
) => PgTableExtraConfigValue[];

// ============================================================
// Internal Types
// ============================================================

interface ColumnDefInternal {
  _type: unknown;
  _columnType: ColumnType;
  _nullable: boolean;
  _indexed: boolean;
  _unique: boolean;
  _primary: boolean;
  _default?: unknown;
  _defaultNow?: boolean;
  _references?: { table: PgTableWithColumns<any>; column: string };
}

// ============================================================
// Utilities
// ============================================================

/**
 * Convert camelCase to snake_case for database column names.
 */
function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

// ============================================================
// Table Builder
// ============================================================

/**
 * Build a Drizzle pgTable from a schema definition object.
 *
 * @param tableName - The database table name
 * @param schema - Schema definition object with column definitions
 * @param compositeIndexes - Multi-column indexes over plain columns
 * @param extraConfig - Checks and other extra table config, see TableExtraConfig
 * @returns A Drizzle table with proper types
 *
 * @example
 * ```ts
 * const schema = {
 *   id: t.text().primaryKey(),
 *   slot: t.bigint().notNull().index(),
 * };
 *
 * const table = buildDrizzleTable("my_events", schema);
 * ```
 */
export function buildDrizzleTable<TSchema extends SchemaDefinition>(
  tableName: string,
  schema: TSchema,
  compositeIndexes: readonly TableIndexDefinition<TSchema>[] = [],
  extraConfig?: TableExtraConfig<TSchema>
): PgTableWithColumns<any> {
  // Build column definitions
  const columns: Record<string, PgColumnBuilderBase> = {};
  const indices: Array<(table: any) => any> = [];

  for (const [name, def] of Object.entries(schema)) {
    const internal = def as ColumnDefInternal;
    const snakeName = camelToSnake(name);

    // Create the base column
    let col: PgColumnBuilderBase;
    switch (internal._columnType) {
      case "text":
        col = text(snakeName);
        break;
      case "bigint":
        col = bigint(snakeName, { mode: "bigint" });
        break;
      case "integer":
        col = integer(snakeName);
        break;
      case "boolean":
        col = boolean(snakeName);
        break;
      case "timestamp":
        col = timestamp(snakeName, { withTimezone: true });
        break;
      default:
        throw new Error(`Unknown column type: ${internal._columnType}`);
    }

    // Apply modifiers
    if (internal._primary) {
      col = (col as any).primaryKey();
    }
    if (internal._unique) {
      col = (col as any).unique();
    }
    if (!internal._nullable) {
      col = (col as any).notNull();
    }
    if (internal._defaultNow && internal._columnType === "timestamp") {
      col = (col as any).defaultNow();
    } else if (internal._default !== undefined) {
      col = (col as any).default(internal._default);
    }
    if (internal._references) {
      const refTable = internal._references.table;
      const refColumn = internal._references.column;
      col = (col as any).references(() => refTable[refColumn]);
    }

    columns[name] = col;

    // Track indices
    if (internal._indexed) {
      indices.push((table: any) =>
        index(`${tableName}_${snakeName}_idx`).on(table[name])
      );
    }
  }

  for (const definition of compositeIndexes) {
    if (definition.columns.length < 2) {
      throw new Error(`Composite index on "${tableName}" must include at least two columns`);
    }

    for (const columnName of definition.columns) {
      if (!(columnName in schema)) {
        throw new Error(`Composite index on "${tableName}" references unknown column "${columnName}"`);
      }
    }

    const indexName = definition.name
      ?? `${tableName}_${definition.columns.map(camelToSnake).join("_")}_idx`;
    indices.push((table: any) => {
      const indexColumns = definition.columns.map((columnName) => table[columnName]) as [any, ...any[]];
      return index(indexName).on(...indexColumns);
    });
  }

  // Create the table
  if (indices.length > 0 || extraConfig) {
    return pgTable(tableName, columns, (table) => [
      ...indices.map((fn) => fn(table)),
      ...(extraConfig?.(table as Parameters<TableExtraConfig<TSchema>>[0]) ?? []),
    ]);
  }
  return pgTable(tableName, columns);
}
