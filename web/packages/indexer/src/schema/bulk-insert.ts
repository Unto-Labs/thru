import { getTableColumns, is, sql, SQL } from "drizzle-orm";
import { getTableConfig, type PgColumn, type PgTable } from "drizzle-orm/pg-core";

/* postgres.js refuses 65,534 or more bind parameters in one statement. */
const MAX_BIND_PARAMS = 60_000;

/* The slice of a postgres.js client the bulk path uses. */
interface RawClient {
  unsafe(query: string, params: unknown[]): { values(): Promise<unknown[][] & { count: number }> };
}

export type BulkConflict =
  | { kind: "nothing" }
  /* Update the `set` fields from the proposed row when the existing row's (slot, seq) is at most its own. */
  | { kind: "versioned-update"; target: PgColumn; set: string[]; slot: PgColumn; seq?: PgColumn };

/* Inserts rows the way drizzle's insert builder would, returning the
   `returning` columns of the rows written. On a postgres.js client it sends
   the identical statement and parameters without drizzle's per-value SQL
   assembly, which dominated backfill CPU; any other client goes through
   drizzle. */
export async function bulkInsert(
  db: unknown,
  table: PgTable,
  rows: Record<string, unknown>[],
  conflict: BulkConflict,
  returning: PgColumn[] | "all",
): Promise<{ count: number; rows: Record<string, unknown>[] }> {
  if (rows.length === 0) return { count: 0, rows: [] };
  const client = rawClientOf(db);
  if (client) {
    const columns = returning === "all" ? Object.values(getTableColumns(table)) : returning;
    const statements = buildBulkInsert(table, rows, conflict, columns);
    if (statements) return runBulkInsert(client, table, statements, columns);
  }

  const columns = getTableColumns(table);
  let insert: any = (db as any).insert(table).values(rows);
  if (conflict.kind === "nothing") {
    insert = insert.onConflictDoNothing();
  } else {
    const excluded = (column: PgColumn) => sql.raw(`excluded.${quote(column.name)}`);
    const where = conflict.seq
      ? sql`(${conflict.slot} < ${excluded(conflict.slot)} or (${conflict.slot} = ${excluded(conflict.slot)} and ${conflict.seq} <= ${excluded(conflict.seq)}))`
      : sql`${conflict.slot} <= ${excluded(conflict.slot)}`;
    const set = Object.fromEntries(conflict.set.map((key) => [key, excluded(columns[key])]));
    insert = insert.onConflictDoUpdate({ target: conflict.target, set, where });
  }
  const written = (await insert.returning()) as Record<string, unknown>[];
  return { count: written.length, rows: written };
}

/* The postgres.js client behind a drizzle database or transaction, when there is one. */
export function rawClientOf(db: unknown): RawClient | null {
  const client = (db as { session?: { client?: { unsafe?: unknown } } })?.session?.client;
  return typeof client?.unsafe === "function" ? (client as RawClient) : null;
}

const quote = (identifier: string) => `"${identifier.replace(/"/g, '""')}"`;

/* Builds what drizzle's insert builder sends for these rows: the same column
   order, driver values and DEFAULT handling, without assembling SQL chunk by
   chunk. Returns null for what only drizzle renders: SQL values or defaults,
   and onUpdateFn columns an upsert would have to set. */
export function buildBulkInsert(
  table: PgTable,
  rows: Record<string, unknown>[],
  conflict: BulkConflict,
  returning: PgColumn[],
): Array<{ text: string; params: unknown[] }> | null {
  const config = getTableConfig(table);
  const target = (config.schema ? `${quote(config.schema)}.` : "") + quote(config.name);
  /* shouldDisableInsert (generated columns) is internal in drizzle's types; its insert builder uses it. */
  const columns = Object.entries(getTableColumns(table)).filter(
    ([, column]) => !(column as unknown as { shouldDisableInsert(): boolean }).shouldDisableInsert(),
  );
  const columnList = columns.map(([, column]) => quote(column.name)).join(", ");

  let suffix = "";
  if (conflict.kind === "versioned-update" && columns.some(([key, column]) => column.onUpdateFn && !conflict.set.includes(key))) {
    return null;
  }
  if (conflict.kind === "nothing") {
    suffix = " on conflict do nothing";
  } else {
    const byKey = getTableColumns(table);
    const set = conflict.set
      .map((key) => quote(byKey[key].name))
      .map((name) => `${name} = excluded.${name}`)
      .join(", ");
    const slot = `${target}.${quote(conflict.slot.name)}`;
    const excludedSlot = `excluded.${quote(conflict.slot.name)}`;
    const version = conflict.seq
      ? `(${slot} < ${excludedSlot} or (${slot} = ${excludedSlot} and ${target}.${quote(conflict.seq.name)} <= excluded.${quote(conflict.seq.name)}))`
      : `${slot} <= ${excludedSlot}`;
    suffix = ` on conflict (${quote(conflict.target.name)}) do update set ${set} where ${version}`;
  }
  if (returning.length) suffix += ` returning ${returning.map((column) => quote(column.name)).join(", ")}`;

  const perChunk = Math.max(1, Math.floor(MAX_BIND_PARAMS / Math.max(1, columns.length)));
  const statements: Array<{ text: string; params: unknown[] }> = [];
  for (let start = 0; start < rows.length; start += perChunk) {
    const params: unknown[] = [];
    const tuples: string[] = [];
    for (const row of rows.slice(start, start + perChunk)) {
      const values: string[] = [];
      for (const [key, column] of columns) {
        let value = row[key];
        if (value === undefined) {
          const fill = column.defaultFn ?? (!column.default ? column.onUpdateFn : undefined);
          if (!fill) {
            values.push("default");
            continue;
          }
          value = fill();
        }
        if (is(value, SQL)) return null;
        params.push(value === null ? null : column.mapToDriverValue(value));
        values.push(`$${params.length}`);
      }
      tuples.push(`(${values.join(", ")})`);
    }
    statements.push({ text: `insert into ${target} (${columnList}) values ${tuples.join(", ")}${suffix}`, params });
  }
  return statements;
}

/* Runs the statements and maps returned rows back to the table's field names
   and JS values, as drizzle's `.returning()` does: by position, so a client
   with a column-name transform still lines up. */
export async function runBulkInsert(
  client: RawClient,
  table: PgTable,
  statements: Array<{ text: string; params: unknown[] }>,
  returning: PgColumn[],
): Promise<{ count: number; rows: Record<string, unknown>[] }> {
  const keys = new Map<string, string>();
  for (const [key, column] of Object.entries(getTableColumns(table))) keys.set(column.name, key);
  let count = 0;
  const rows: Record<string, unknown>[] = [];
  for (const { text, params } of statements) {
    const result = await client.unsafe(text, params).values();
    count += result.count;
    for (const raw of result) {
      const row: Record<string, unknown> = {};
      returning.forEach((column, i) => {
        const value = raw[i];
        row[keys.get(column.name) ?? column.name] = value === null ? null : column.mapFromDriverValue(value);
      });
      rows.push(row);
    }
  }
  return { count, rows };
}
