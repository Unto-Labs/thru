/**
 * Event stream type definitions.
 */

import type { Event, Filter } from "@thru/replay";
import type { PgTableWithColumns } from "drizzle-orm/pg-core";
import type { SchemaDefinition, InferRow, Columns } from "../schema/types";
import type { ApiConfig, StreamBatch, HookContext } from "../types";

/**
 * Definition input for creating an event stream.
 * This is what users pass to defineEventStream().
 */
export interface EventStreamDefinition<TSchema extends SchemaDefinition> {
  /** Unique stream name (used for table name, checkpointing) */
  name: string;

  /** Human-readable description */
  description?: string;

  /**
   * Schema definition using the column builder.
   * Defines the structure of the indexed event data.
   *
   * @example
   * ```ts
   * schema: {
   *   id: t.text().primaryKey(),
   *   slot: t.bigint().notNull().index(),
   *   amount: t.bigint().notNull(),
   * }
   * ```
   */
  schema: TSchema;

  /**
   * CEL filter for @thru/replay.
   * Determines which events this stream receives.
   *
   * Use `filter` for direct filter values, or `filterFactory` for lazy loading
   * (required for drizzle-kit compatibility when config isn't available at import time).
   *
   * @example
   * ```ts
   * // Direct filter (simpler, but requires config at import time)
   * filter: create(FilterSchema, {
   *   expression: "event.program.value == params.address",
   *   params: { address: ... }
   * })
   *
   * // Factory pattern (drizzle-kit compatible)
   * filterFactory: () => create(FilterSchema, { ... loadConfig() ... })
   * ```
   */
  filter?: Filter;

  /**
   * Lazy filter factory for drizzle-kit compatibility.
   * Called once when the indexer starts.
   */
  filterFactory?: () => Filter;

  /**
   * Parse a raw event into a table row.
   * Return null to skip the event.
   *
   * @param event - Raw event from the chain
   * @returns Parsed row data or null to skip
   */
  parse: (event: Event) => InferRow<TSchema> | null;

  /** API configuration (used for route generation) */
  api?: ApiConfig;

  /**
   * Filter batch before committing to database.
   * Use to filter events based on external state (e.g., registered accounts).
   *
   * @param events - Parsed events about to be committed
   * @param ctx - Hook context with database access
   * @returns Filtered array of events to commit
   */
  filterBatch?: (
    events: InferRow<TSchema>[],
    ctx: HookContext
  ) => Promise<InferRow<TSchema>[]>;

  /**
   * Called after a batch of events is committed to the database.
   * Use for side effects like notifications, webhooks, analytics.
   * Errors are logged but do not block indexing.
   *
   * @param batch - The committed batch with slot and events
   * @param ctx - Hook context with database access
   */
  onCommit?: (batch: StreamBatch<InferRow<TSchema>>, ctx: HookContext) => Promise<void>;
}

/**
 * A compiled event stream with table and methods.
 * This is what defineEventStream() returns.
 */
export interface EventStream<TSchema extends SchemaDefinition = SchemaDefinition> {
  /** Stream name */
  readonly name: string;

  /** Human-readable description */
  readonly description: string;

  /** The schema definition (for validation) */
  readonly schema: TSchema;

  /** The Drizzle table for this stream */
  readonly table: PgTableWithColumns<any>;

  /**
   * Typed column accessors for use with Drizzle operators.
   * Use with eq(), inArray(), etc.
   *
   * @example
   * ```ts
   * db.select().from(stream.table).where(eq(stream.c.source, address))
   * ```
   */
  readonly c: Columns<TSchema>;

  /** Get the CEL filter for @thru/replay (resolves lazy factory if used) */
  getFilter(): Filter;

  /** Parse function */
  readonly parse: (event: Event) => InferRow<TSchema> | null;

  /** API configuration */
  readonly api?: ApiConfig;

  /** Filter batch hook */
  readonly filterBatch?: (
    events: InferRow<TSchema>[],
    ctx: HookContext
  ) => Promise<InferRow<TSchema>[]>;

  /** Post-commit hook */
  readonly onCommit?: (
    batch: StreamBatch<InferRow<TSchema>>,
    ctx: HookContext
  ) => Promise<void>;
}
