/**
 * Define an account stream for indexing on-chain account state.
 *
 * Account streams track current state of on-chain accounts.
 * Unlike event streams (historical log), account streams are mutable -
 * rows are updated when account state changes.
 *
 * @example
 * ```ts
 * import { defineAccountStream, t } from "@thru/indexer";
 * import { decodeAddress } from "@thru/helpers";
 * import type { AccountState } from "@thru/replay";
 *
 * export const tokenAccounts = defineAccountStream({
 *   name: "token-accounts",
 *
 *   ownerProgram: decodeAddress(TOKEN_PROGRAM_PUBKEY),
 *   expectedSize: 73,  // TokenAccount size in bytes
 *
 *   schema: {
 *     address: t.text().primaryKey(),
 *     mint: t.text().notNull().index(),
 *     owner: t.text().notNull().index(),
 *     amount: t.bigint().notNull(),
 *     isFrozen: t.boolean().notNull(),
 *     slot: t.bigint().notNull(),
 *     seq: t.bigint().notNull(),
 *     updatedAt: t.timestamp().notNull().defaultNow(),
 *   },
 *
 *   parse: (account: AccountState) => {
 *     if (account.data.length !== 73) return null;
 *     return {
 *       address: encodeAddress(account.address),
 *       mint: parseAddress(account.data, 0),
 *       owner: parseAddress(account.data, 32),
 *       amount: parseBigint(account.data, 64),
 *       isFrozen: account.data[72] !== 0,
 *       slot: account.slot,
 *       seq: account.seq,
 *       updatedAt: new Date(),
 *     };
 *   },
 *
 *   api: { filters: ["mint", "owner"], idField: "address" },
 * });
 *
 * // Export the table for Drizzle migrations
 * export const tokenAccountsTable = tokenAccounts.table;
 * ```
 */

import type { SchemaDefinition } from "../schema/types";
import { buildDrizzleTable } from "../schema/table";
import type { AccountStreamDefinition, AccountStream } from "./types";

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
 * Define an account stream for indexing on-chain account state.
 *
 * @param definition - Stream definition with schema, ownerProgram, and parse function
 * @returns A compiled account stream ready for use with the indexer
 */
export function defineAccountStream<TSchema extends SchemaDefinition>(
  definition: AccountStreamDefinition<TSchema>
): AccountStream<TSchema> {
  // Validate that either ownerProgram or ownerProgramFactory is provided
  if (!definition.ownerProgram && !definition.ownerProgramFactory) {
    throw new Error(`Stream "${definition.name}" must provide either ownerProgram or ownerProgramFactory`);
  }

  // Build table name (e.g., "token-accounts" -> "token_accounts")
  const tableName = definition.name.replace(/-/g, "_");

  // Build Drizzle table from schema
  const table = buildDrizzleTable(tableName, definition.schema);

  // Lazy ownerProgram resolution (cached after first call)
  let cachedOwnerProgram: Uint8Array | null = definition.ownerProgram ?? null;
  const getOwnerProgram = (): Uint8Array => {
    if (!cachedOwnerProgram) {
      if (definition.ownerProgramFactory) {
        cachedOwnerProgram = definition.ownerProgramFactory();
      } else {
        throw new Error(`Stream "${definition.name}" has no ownerProgram configured`);
      }
    }
    return cachedOwnerProgram;
  };

  return {
    name: definition.name,
    description: definition.description ?? `${pascalCase(definition.name)} accounts`,
    schema: definition.schema,
    getOwnerProgram,
    expectedSize: definition.expectedSize,
    dataSizes: definition.dataSizes,
    table,
    // Column accessors for Drizzle operators
    c: table as any,
    parse: definition.parse,
    api: definition.api,
  };
}
