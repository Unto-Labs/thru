/**
 * Define an event stream for indexing blockchain events.
 *
 * Event streams index historical, immutable event data from the chain.
 * Each event is stored once and never updated.
 *
 * @example
 * ```ts
 * import { defineEventStream, t } from "@thru/indexer";
 * import { create } from "@bufbuild/protobuf";
 * import { FilterSchema, type Event } from "@thru/replay";
 *
 * export const transfers = defineEventStream({
 *   name: "transfers",
 *
 *   schema: {
 *     id: t.text().primaryKey(),
 *     slot: t.bigint().notNull().index(),
 *     source: t.text().notNull().index(),
 *     dest: t.text().notNull().index(),
 *     amount: t.bigint().notNull(),
 *   },
 *
 *   filter: create(FilterSchema, {
 *     expression: "event.program.value == params.address",
 *     params: { address: ... },
 *   }),
 *
 *   parse: (event: Event) => {
 *     if (!event.payload) return null;
 *     return {
 *       id: event.eventId,
 *       slot: event.slot!,
 *       source: decodeAddress(event.payload, 0),
 *       dest: decodeAddress(event.payload, 32),
 *       amount: decodeBigint(event.payload, 64),
 *     };
 *   },
 *
 *   api: { filters: ["source", "dest"] },
 * });
 *
 * // Export the table for Drizzle migrations
 * export const transfersTable = transfers.table;
 * ```
 */

import type { Filter } from "@thru/replay";
import type { SchemaDefinition } from "../schema/types";
import { buildDrizzleTable } from "../schema/table";
import type { EventStreamDefinition, EventStream } from "./types";

// ============================================================
// Utilities
// ============================================================

function pascalCase(str: string): string {
  return str
    .split(/[-_\s]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join("");
}

// ============================================================
// Main Export
// ============================================================

/**
 * Define an event stream for indexing blockchain events.
 *
 * @param definition - Stream definition with schema, filter, and parse function
 * @returns A compiled event stream ready for use with the indexer
 */
export function defineEventStream<TSchema extends SchemaDefinition>(
  definition: EventStreamDefinition<TSchema>
): EventStream<TSchema> {
  // Validate that either filter or filterFactory is provided
  if (!definition.filter && !definition.filterFactory) {
    throw new Error(`Stream "${definition.name}" must provide either filter or filterFactory`);
  }

  // Build table name (e.g., "transfers" -> "transfer_events")
  const tableName = `${definition.name.replace(/s$/, "")}_events`;

  // Build Drizzle table from schema
  const table = buildDrizzleTable(tableName, definition.schema);

  // Lazy filter resolution (cached after first call)
  let cachedFilter: Filter | null = definition.filter ?? null;
  const getFilter = (): Filter => {
    if (!cachedFilter) {
      if (definition.filterFactory) {
        cachedFilter = definition.filterFactory();
      } else {
        throw new Error(`Stream "${definition.name}" has no filter configured`);
      }
    }
    return cachedFilter;
  };

  return {
    name: definition.name,
    description: definition.description ?? `${pascalCase(definition.name)} events`,
    schema: definition.schema,
    table,
    // Column accessors for Drizzle operators
    c: table as any,
    getFilter,
    parse: definition.parse,
    api: definition.api,
    filterBatch: definition.filterBatch,
    onCommit: definition.onCommit,
  };
}
