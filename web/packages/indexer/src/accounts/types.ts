import type { AccountState } from "@thru/replay";
import type { PgTableWithColumns } from "drizzle-orm/pg-core";
import type { SchemaDefinition, InferRow, Columns } from "../schema/types";
import type { TableExtraConfig, TableIndexDefinition } from "../schema/table";
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

  /**
   * Expected account data size: a server-side prefilter only. Size does not
   * identify an account kind; `parse` must still check the account type
   * (byte 0 of every program-owned account) through the program's ABI root.
   */
  expectedSize?: number;

  /**
   * Additional data sizes to accept (prefilter only, like `expectedSize`).
   * Use when a stream reads more than one fixed-size account kind.
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

  /** Composite database indexes for multi-column lookup paths. */
  indexes?: readonly TableIndexDefinition<TSchema>[];

  /** Checks and expression, descending or partial indexes; see TableExtraConfig. */
  extraConfig?: TableExtraConfig<TSchema>;

  /**
   * Parse account state into a table row.
   * Return null to skip the account.
   *
   * @param account - Account state from the chain
   * @returns Parsed row data or null to skip
   */
  parse: (account: AccountState) => InferRow<TSchema> | null;

  /**
   * Whether a live account is closed. A program may close an account by
   * zeroing it in place instead of deleting it; its row is then removed
   * like a deleted account's, rather than skipped like an unparsable one.
   */
  isClosed?: (account: AccountState) => boolean;

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

  /** Closed-account check (see AccountStreamDefinition.isClosed) */
  readonly isClosed?: (account: AccountState) => boolean;

  /** API configuration */
  readonly api?: ApiConfig;
}
