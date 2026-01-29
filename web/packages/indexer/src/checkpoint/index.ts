/**
 * Checkpoint module exports.
 */

export { checkpointTable, type Checkpoint } from "./table";
export {
  getCheckpoint,
  updateCheckpoint,
  deleteCheckpoint,
  getAllCheckpoints,
} from "./repository";

import { checkpointTable } from "./table";
import type { EventStream } from "../streams/types";
import type { AccountStream } from "../accounts/types";
import type { PgTableWithColumns } from "drizzle-orm/pg-core";

/**
 * Get all tables that need to be exported for Drizzle migrations.
 *
 * This helper collects the checkpoint table and all stream tables
 * into a single object for easy export in your schema file.
 *
 * @example
 * ```ts
 * // db/schema.ts
 * import { getSchemaExports } from "@thru/indexer";
 * import transfers from "../streams/transfers";
 * import tokenAccounts from "../account-streams/token-accounts";
 *
 * export const {
 *   checkpointTable,
 *   transfersTable,
 *   tokenAccountsTable,
 * } = getSchemaExports({
 *   eventStreams: [transfers],
 *   accountStreams: [tokenAccounts],
 *   tableNames: {
 *     transfers: "transfersTable",
 *     "token-accounts": "tokenAccountsTable",
 *   },
 * });
 * ```
 */
export function getSchemaExports(config: {
  eventStreams?: EventStream<any>[];
  accountStreams?: AccountStream<any>[];
  tableNames?: Record<string, string>;
}): Record<string, PgTableWithColumns<any>> {
  const { eventStreams = [], accountStreams = [], tableNames = {} } = config;

  const exports: Record<string, PgTableWithColumns<any>> = {
    checkpointTable,
  };

  for (const stream of eventStreams) {
    const exportName = tableNames[stream.name] ?? `${stream.name}Table`;
    exports[exportName] = stream.table as PgTableWithColumns<any>;
  }

  for (const stream of accountStreams) {
    const exportName = tableNames[stream.name] ?? `${stream.name.replace(/-/g, "")}Table`;
    exports[exportName] = stream.table as PgTableWithColumns<any>;
  }

  return exports;
}
