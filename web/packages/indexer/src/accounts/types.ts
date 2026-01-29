/**
 * Account stream type definitions.
 */

import type { AccountState } from "@thru/replay";
import type { PgTableWithColumns } from "drizzle-orm/pg-core";
import type { SchemaDefinition, InferRow, Columns } from "../schema/types";
import type { ApiConfig } from "../types";

/**
 * Definition input for creating an account stream.
 * This is what users pass to defineAccountStream().
 */
export interface AccountStreamDefinition<TSchema extends SchemaDefinition> {
  /** Unique stream name (used for table name, checkpointing) */
  name: string;

  /** Human-readable description */
  description?: string;

  /**
   * Owner program address bytes.
   * Filters accounts by their owner program.
   *
   * Use `ownerProgram` for direct values, or `ownerProgramFactory` for lazy loading
   * (required for drizzle-kit compatibility when config isn't available at import time).
   */
  ownerProgram?: Uint8Array;

  /**
   * Lazy factory for owner program address.
   * Called once when the indexer starts.
   */
  ownerProgramFactory?: () => Uint8Array;

  /** Expected account data size (for filtering by account type) */
  expectedSize?: number;

  /**
   * Additional data sizes to accept.
   * Use when an account type can have multiple valid sizes.
   */
  dataSizes?: number[];

  /**
   * Schema definition using the column builder.
   * Defines the structure of the indexed account data.
   *
   * @example
   * ```ts
   * schema: {
   *   address: t.text().primaryKey(),
   *   mint: t.text().notNull().index(),
   *   owner: t.text().notNull().index(),
   *   amount: t.bigint().notNull(),
   *   slot: t.bigint().notNull(),
   *   seq: t.bigint().notNull(),
   *   updatedAt: t.timestamp().notNull().defaultNow(),
   * }
   * ```
   */
  schema: TSchema;

  /**
   * Parse account state into a table row.
   * Return null to skip the account.
   *
   * @param account - Account state from the chain
   * @returns Parsed row data or null to skip
   */
  parse: (account: AccountState) => InferRow<TSchema> | null;

  /** API configuration (used for route generation) */
  api?: ApiConfig;
}

/**
 * A compiled account stream with table and methods.
 * This is what defineAccountStream() returns.
 */
export interface AccountStream<TSchema extends SchemaDefinition = SchemaDefinition> {
  /** Stream name */
  readonly name: string;

  /** Human-readable description */
  readonly description: string;

  /** The schema definition (for validation) */
  readonly schema: TSchema;

  /** Get owner program address bytes (resolves lazy factory if used) */
  getOwnerProgram(): Uint8Array;

  /** Expected account data size */
  readonly expectedSize?: number;

  /** Additional data sizes to accept */
  readonly dataSizes?: number[];

  /** The Drizzle table for this stream */
  readonly table: PgTableWithColumns<any>;

  /**
   * Typed column accessors for use with Drizzle operators.
   * Use with eq(), inArray(), etc.
   *
   * @example
   * ```ts
   * db.select().from(stream.table).where(eq(stream.c.owner, address))
   * ```
   */
  readonly c: Columns<TSchema>;

  /** Parse function */
  readonly parse: (account: AccountState) => InferRow<TSchema> | null;

  /** API configuration */
  readonly api?: ApiConfig;
}
