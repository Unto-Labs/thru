import { getTableColumns, getTableName, is, sql, SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import {
  bigint,
  boolean,
  getTableConfig,
  integer,
  jsonb,
  PgDialect,
  pgSchema,
  pgTable,
  text,
  timestamp,
  type PgColumn,
  type PgTable,
} from "drizzle-orm/pg-core";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { t } from "./builder";
import { buildBulkInsert, bulkInsert, type BulkConflict } from "./bulk-insert";
import { buildDrizzleTable } from "./table";

const url = process.env.TEST_DATABASE_URL;
const schemaName = `bulk_insert_test_${process.pid}`;
/* Real tables in a private schema, not temp tables, so the pool can hold
   several connections and a write that escapes its transaction stays visible. */
const client = url
  ? postgres(url, { max: 4, onnotice: () => {}, connection: { search_path: schemaName } })
  : null;
const db = client ? drizzle(client) : null;

type Row = Record<string, unknown>;
type Returning = PgColumn[] | "all";

/* Copies of the token indexer schemas in web/indexers/token/packages/streams,
   built by the same buildDrizzleTable that defineAccountStream and
   defineEventStream use. */
const tokenMintSchema = {
  address: t.text().primaryKey(),
  decimals: t.integer().notNull(),
  supply: t.text().notNull(),
  creator: t.text().notNull().index(),
  mintAuthority: t.text().notNull().index(),
  freezeAuthority: t.text().index(),
  hasFreezeAuthority: t.boolean().notNull(),
  ticker: t.text().notNull().index(),
  slot: t.bigint().notNull().index(),
  seq: t.bigint().notNull(),
  stateHash: t.text().notNull(),
  updatedAt: t.timestamp().notNull().defaultNow(),
};

const tokenAccountSchema = {
  address: t.text().primaryKey(),
  mint: t.text().notNull().index(),
  owner: t.text().notNull().index(),
  amount: t.text().notNull(),
  frozen: t.boolean().notNull().index(),
  slot: t.bigint().notNull().index(),
  seq: t.bigint().notNull(),
  stateHash: t.text().notNull(),
  updatedAt: t.timestamp().notNull().defaultNow(),
};

const tokenEventSchema = {
  id: t.text().primaryKey(),
  type: t.text().notNull().index(),
  slot: t.bigint().notNull().index(),
  blockOffset: t.integer().notNull(),
  callIdx: t.integer().notNull(),
  eventIdx: t.integer().notNull(),
  programIdx: t.integer().notNull(),
  transactionHash: t.text(),
  timestamp: t.timestamp().index(),
  feePayer: t.text().index(),
  mint: t.text().index(),
  account: t.text().index(),
  source: t.text().index(),
  destination: t.text().index(),
  owner: t.text().index(),
  authority: t.text().index(),
  amount: t.text(),
  sourcePostBalance: t.text(),
  destinationPostBalance: t.text(),
  accountPostBalance: t.text(),
  mintSupply: t.text(),
  decimals: t.integer(),
  ticker: t.text().index(),
  freezeAuthority: t.text().index(),
  hasFreezeAuthority: t.boolean(),
};

/* Column kinds the token tables lack: a schema-qualified name, jsonb, a
   timestamp without time zone, a literal default, $defaultFn, $onUpdateFn and
   a generated column, with no seq so the slot-only version check runs. */
const extrasTable = (name: string) =>
  pgSchema(schemaName).table(name, {
    id: text("id").primaryKey(),
    slot: bigint("slot", { mode: "bigint" }).notNull(),
    hits: integer("hits").notNull().default(7),
    flag: boolean("flag"),
    localAt: timestamp("local_at"),
    zonedAt: timestamp("zoned_at", { withTimezone: true }).notNull().defaultNow(),
    meta: jsonb("meta"),
    tag: text("tag").$defaultFn(() => "from defaultFn"),
    touched: text("touched").$onUpdateFn(() => "from onUpdateFn"),
    halved: bigint("halved", { mode: "bigint" }).generatedAlwaysAs(sql`slot / 2`),
  });

const maxInt8 = 2n ** 63n - 1n;
const above2p53 = 2n ** 53n + 1n;
const at = new Date("2026-10-16T12:34:56.789Z");
const quoted = `it's "quoted" \\ back; ünïcødé 🚀`;

const mintRows: Row[] = [
  { address: "mint-a", decimals: 0, supply: "0", creator: quoted, mintAuthority: "auth", freezeAuthority: null, hasFreezeAuthority: false, ticker: "", slot: maxInt8, seq: above2p53, stateHash: "h", updatedAt: at },
  { address: "mint-b", decimals: 255, supply: "18446744073709551615", creator: "c", mintAuthority: quoted, freezeAuthority: "freeze", hasFreezeAuthority: true, ticker: "TĪCKÉR 🚀", slot: 5n, seq: 1n, stateHash: "", updatedAt: undefined },
  { address: "mint-c", decimals: 9, supply: "1", creator: "c", mintAuthority: "m", freezeAuthority: null, hasFreezeAuthority: false, ticker: "t", slot: 5n, seq: 1n, stateHash: "s" },
];
const mintRowsLater: Row[] = [
  { ...mintRows[0], slot: 5n, supply: "9" },
  { ...mintRows[1], seq: 2n, supply: "9" },
  { ...mintRows[2], seq: 0n, supply: "9" },
  { ...mintRows[2], address: "mint-d", updatedAt: at },
];

const accountRows: Row[] = [
  { address: "acct-a", mint: "mint-a", owner: quoted, amount: "0", frozen: false, slot: maxInt8, seq: above2p53, stateHash: "", updatedAt: at },
  { address: "acct-b", mint: "mint-b", owner: "", amount: "18446744073709551615", frozen: true, slot: 0n, seq: 0n, stateHash: quoted, updatedAt: undefined },
  { address: "acct-c", mint: "mint-b", owner: "o", amount: "5", frozen: false, slot: 10n, seq: 3n, stateHash: "h" },
];
const accountRowsLater: Row[] = [
  { ...accountRows[0], slot: 1n, amount: "1" },
  { ...accountRows[1], slot: above2p53, amount: "1" },
  { ...accountRows[2], seq: 3n, amount: "1", updatedAt: at },
  { ...accountRows[2], address: "acct-d", amount: "1" },
];

const fullEvent = (id: string, slot: bigint): Row => ({
  id, type: "transfer", slot, blockOffset: -1, callIdx: 2, eventIdx: 3, programIdx: 4, transactionHash: quoted,
  timestamp: at, feePayer: "fee", mint: "mint", account: "acct", source: "src", destination: "dst", owner: "own",
  authority: "auth", amount: "18446744073709551615", sourcePostBalance: "0", destinationPostBalance: "1",
  accountPostBalance: "2", mintSupply: "3", decimals: 255, ticker: "TĪCKÉR", freezeAuthority: "", hasFreezeAuthority: true,
});
const eventRows: Row[] = [
  fullEvent("event-a", maxInt8),
  { ...fullEvent("event-b", above2p53), transactionHash: null, timestamp: null, feePayer: null, mint: null, decimals: null, hasFreezeAuthority: null },
  { id: "event-c", type: "burn", slot: 0n, blockOffset: 0, callIdx: 0, eventIdx: 0, programIdx: 0, timestamp: undefined, amount: "" },
  { ...fullEvent("event-d", 7n), hasFreezeAuthority: false, ticker: quoted },
];
const eventRowsLater: Row[] = [
  { ...eventRows[0], slot: 1n, type: "mint_to" },
  { ...eventRows[2], slot: 9n, amount: "4" },
  fullEvent("event-e", 8n),
];

const extrasRows: Row[] = [
  { id: "x-a", slot: maxInt8, hits: 3, flag: true, localAt: at, zonedAt: at, meta: { nested: [1, "two", null], quoted, n: 1.5 }, tag: "explicit", touched: "explicit" },
  { id: "x-b", slot: above2p53, hits: undefined, flag: null, localAt: null, zonedAt: undefined, meta: null, tag: undefined, touched: undefined },
  { id: "x-c", slot: 0n },
  { id: "x-d", slot: 4n, meta: "a 'json' string", localAt: new Date("1999-12-31T23:59:59.999Z"), tag: "" },
];
const extrasRowsLater: Row[] = [
  { ...extrasRows[0], slot: 1n, hits: 99 },
  { ...extrasRows[1], hits: 99 },
  { ...extrasRows[3], slot: 5n, hits: 99, meta: [] },
  { id: "x-e", slot: 1n },
];

interface TableKind {
  make: (name: string) => PgTable;
  pk: string;
  rows: Row[];
  later: Row[];
}

const kinds: Record<string, TableKind> = {
  token_mints: { make: (name) => buildDrizzleTable(name, tokenMintSchema), pk: "address", rows: mintRows, later: mintRowsLater },
  token_accounts: { make: (name) => buildDrizzleTable(name, tokenAccountSchema), pk: "address", rows: accountRows, later: accountRowsLater },
  token_events: { make: (name) => buildDrizzleTable(name, tokenEventSchema), pk: "id", rows: eventRows, later: eventRowsLater },
  extras: { make: extrasTable, pk: "id", rows: extrasRows, later: extrasRowsLater },
};

/* One table written through drizzle and one through bulkInsert, per kind. */
const tables = Object.fromEntries(
  Object.entries(kinds).map(([kind, { make }]) => [kind, { viaDrizzle: make(`${kind}_drizzle`), viaBulk: make(`${kind}_bulk`) }]),
) as Record<string, { viaDrizzle: any; viaBulk: any }>;

const sqlDefaultTable = pgTable("sql_default", {
  id: text("id").primaryKey(),
  label: text("label").$defaultFn(() => sql`'from sql'`),
});

const nothing: BulkConflict = { kind: "nothing" };

/* The conflict the account processor passes: update every field the first row carries. */
function versioned(table: any, pk: string, rows: Row[]): BulkConflict {
  const columns = getTableColumns(table);
  return {
    kind: "versioned-update",
    target: table[pk],
    set: Object.keys(rows[0]).filter((key) => key in columns),
    slot: table.slot,
    seq: table.seq,
  };
}

/* The drizzle builder the processors used before bulkInsert. */
function drizzleInsert(target: any, table: any, rows: Row[], conflict: BulkConflict, returning: Returning) {
  const columns = getTableColumns(table);
  let query = target.insert(table).values(rows);
  if (conflict.kind === "nothing") {
    query = query.onConflictDoNothing();
  } else {
    const excluded = (column: PgColumn) => sql.raw(`excluded."${column.name}"`);
    const set = Object.fromEntries(conflict.set.map((key) => [key, excluded(columns[key])]));
    const where = conflict.seq
      ? sql`(${conflict.slot} < ${excluded(conflict.slot)} or (${conflict.slot} = ${excluded(conflict.slot)} and ${conflict.seq} <= ${excluded(conflict.seq)}))`
      : sql`${conflict.slot} <= ${excluded(conflict.slot)}`;
    query = query.onConflictDoUpdate({ target: conflict.target, set, where });
  }
  if (returning === "all") return query.returning();
  if (returning.length === 0) return query;
  const fieldOf = (column: PgColumn) => Object.entries(columns).find(([, candidate]) => candidate === column)![0];
  return query.returning(Object.fromEntries(returning.map((column) => [fieldOf(column), column])));
}

const dialect = new PgDialect();
const render = (value: unknown) => (is(value, SQL) ? dialect.sqlToQuery(value).sql : String(value));

function createTableSql(table: PgTable) {
  const { name, schema, columns } = getTableConfig(table);
  const definitions = columns.map((column) =>
    [
      `"${column.name}" ${column.getSQLType()}`,
      column.generated ? `generated always as (${render(column.generated.as)}) stored` : "",
      column.primary ? "primary key" : "",
      column.notNull ? "not null" : "",
      column.default !== undefined ? `default ${render(column.default)}` : "",
    ].filter(Boolean).join(" "),
  );
  return `create table ${schema ? `"${schema}".` : ""}"${name}" (${definitions.join(", ")})`;
}

const selectAll = async (target: any, table: any, pk: string) =>
  [...(await target.execute(sql`select * from ${table} order by ${table[pk]}`))];

const countRows = async (table: PgTable) =>
  Number((await db!.execute(sql`select count(*)::int as n from ${table}`))[0].n);

const normalize = (text: string) => text.replace(/\s+/g, " ").trim();

const cases = Object.entries(kinds).flatMap(([kind, { pk, rows }]) => {
  const table = tables[kind].viaBulk;
  return [
    { kind, variant: "nothing, no returning", conflict: nothing, returning: [] as Returning },
    { kind, variant: "nothing, returning all", conflict: nothing, returning: "all" as Returning },
    { kind, variant: "versioned-update, returning slot", conflict: versioned(table, pk, rows), returning: [table.slot] as Returning },
  ];
});

describe.skipIf(!url)("bulkInsert against Postgres", () => {
  beforeAll(async () => {
    await client!.unsafe(`drop schema if exists "${schemaName}" cascade`);
    await client!.unsafe(`create schema "${schemaName}"`);
    for (const { viaDrizzle, viaBulk } of Object.values(tables)) {
      await client!.unsafe(createTableSql(viaDrizzle));
      await client!.unsafe(createTableSql(viaBulk));
    }
    await client!.unsafe(createTableSql(sqlDefaultTable));
  });

  beforeEach(async () => {
    const names = [...Object.values(tables).flatMap(({ viaDrizzle, viaBulk }) => [viaDrizzle, viaBulk]), sqlDefaultTable];
    await client!.unsafe(`truncate ${names.map((table) => `"${getTableName(table)}"`).join(", ")}`);
  });

  afterAll(async () => {
    await client?.unsafe(`drop schema if exists "${schemaName}" cascade`);
    await client?.end();
  });

  it.each(cases)("builds the drizzle statement and parameters for $kind ($variant)", ({ kind, conflict, returning }) => {
    const table = tables[kind].viaBulk;
    const { rows } = kinds[kind];
    const columns = returning === "all" ? Object.values(getTableColumns(table as PgTable)) : returning;

    const statements = buildBulkInsert(table, rows, conflict, columns)!;
    const expected = drizzleInsert(db, table, rows, conflict, returning).toSQL();

    expect(statements).toHaveLength(1);
    expect(statements[0].params).toStrictEqual(expected.params);
    expect(normalize(statements[0].text)).toBe(normalize(expected.sql));
  });

  it.each(Object.keys(kinds))("writes and returns what drizzle does for %s, then upserts by version", async (kind) => {
    const { viaDrizzle, viaBulk } = tables[kind];
    const { pk, rows, later } = kinds[kind];
    /* One transaction, so DEFAULT now() is the same instant in both tables. */
    await db!.transaction(async (tx) => {
      const drizzleRows = await drizzleInsert(tx, viaDrizzle, rows, nothing, "all");
      const bulk = await bulkInsert(tx, viaBulk, rows, nothing, "all");
      expect(bulk).toStrictEqual({ count: rows.length, rows: drizzleRows });
      expect(await selectAll(tx, viaBulk, pk)).toStrictEqual(await selectAll(tx, viaDrizzle, pk));

      const drizzleUpserted = await drizzleInsert(tx, viaDrizzle, later, versioned(viaDrizzle, pk, later), [viaDrizzle.slot]);
      const bulkUpserted = await bulkInsert(tx, viaBulk, later, versioned(viaBulk, pk, later), [viaBulk.slot]);
      expect(bulkUpserted).toStrictEqual({ count: drizzleUpserted.length, rows: drizzleUpserted });
      expect(await selectAll(tx, viaBulk, pk)).toStrictEqual(await selectAll(tx, viaDrizzle, pk));
    });
  });

  it("counts only the new rows under ON CONFLICT DO NOTHING", async () => {
    const { viaDrizzle, viaBulk } = tables.token_events;
    await bulkInsert(db, viaBulk, eventRows.slice(0, 2), nothing, []);
    await expect(bulkInsert(db, viaBulk, eventRows, nothing, [])).resolves.toStrictEqual({ count: 2, rows: [] });
    expect(await countRows(viaBulk)).toBe(4);

    await client!.unsafe(`truncate "${getTableName(viaBulk)}"`);
    await drizzleInsert(db, viaDrizzle, eventRows.slice(0, 2), nothing, []);
    await bulkInsert(db, viaBulk, eventRows.slice(0, 2), nothing, []);
    const drizzleRows = await drizzleInsert(db, viaDrizzle, eventRows, nothing, "all");
    const bulk = await bulkInsert(db, viaBulk, eventRows, nothing, "all");
    expect(bulk.count).toBe(2);
    expect(bulk.rows.map((row) => row.id)).toStrictEqual(["event-c", "event-d"]);
    expect(bulk.rows).toStrictEqual(drizzleRows);
  });

  it("updates on a newer slot or an equal slot with an equal or higher seq, and nothing older", async () => {
    const table = tables.token_accounts.viaBulk;
    const account = (address: string, slot: bigint, seq: bigint, amount: string): Row => ({
      address, mint: "m", owner: "o", amount, frozen: false, slot, seq, stateHash: "h", updatedAt: at,
    });
    const first = ["older-slot", "newer-slot", "higher-seq", "lower-seq", "equal"].map((address) => account(address, 10n, 5n, "1"));
    await bulkInsert(db, table, first, versioned(table, "address", first), [table.slot]);

    const second = [
      account("older-slot", 9n, 99n, "2"),
      account("newer-slot", 11n, 0n, "2"),
      account("higher-seq", 10n, 6n, "2"),
      account("lower-seq", 10n, 4n, "2"),
      account("equal", 10n, 5n, "2"),
      account("fresh", 1n, 0n, "2"),
    ];
    await expect(bulkInsert(db, table, second, versioned(table, "address", second), [table.slot])).resolves.toStrictEqual({
      count: 4,
      rows: [{ slot: 11n }, { slot: 10n }, { slot: 10n }, { slot: 1n }],
    });

    const stored = await db!
      .select({ address: table.address, amount: table.amount, slot: table.slot, seq: table.seq })
      .from(table)
      .orderBy(table.address);
    expect(stored).toStrictEqual([
      { address: "equal", amount: "2", slot: 10n, seq: 5n },
      { address: "fresh", amount: "2", slot: 1n, seq: 0n },
      { address: "higher-seq", amount: "2", slot: 10n, seq: 6n },
      { address: "lower-seq", amount: "1", slot: 10n, seq: 5n },
      { address: "newer-slot", amount: "2", slot: 11n, seq: 0n },
      { address: "older-slot", amount: "1", slot: 10n, seq: 5n },
    ]);
  });

  it("rolls back with the transaction it runs in", async () => {
    const table = tables.token_events.viaBulk;
    const failed = db!.transaction(async (tx) => {
      await expect(bulkInsert(tx, table, eventRows, nothing, [])).resolves.toStrictEqual({ count: 4, rows: [] });
      await tx.execute(sql`select 1 / 0`);
    });
    await expect(failed).rejects.toMatchObject({ cause: { message: "division by zero" } });
    expect(await countRows(table)).toBe(0);

    await db!.transaction(async (tx) => {
      await bulkInsert(tx, table, eventRows, nothing, []);
    });
    expect(await countRows(table)).toBe(4);
  });

  it("splits statements past the 65,535 bind parameter limit", async () => {
    const { viaDrizzle, viaBulk } = tables.token_events;
    const many = Array.from({ length: 3_000 }, (_, i) => fullEvent(`event-${String(i).padStart(4, "0")}`, BigInt(i) + above2p53));

    expect(buildBulkInsert(viaBulk, many, nothing, [])!.map((statement) => statement.params.length)).toStrictEqual([60_000, 15_000]);
    await expect(drizzleInsert(db, viaDrizzle, many, nothing, [])).rejects.toMatchObject({
      cause: { code: "MAX_PARAMETERS_EXCEEDED" },
    });

    await expect(bulkInsert(db, viaBulk, many, nothing, [])).resolves.toStrictEqual({ count: 3_000, rows: [] });
    for (let i = 0; i < many.length; i += 2_400) await drizzleInsert(db, viaDrizzle, many.slice(i, i + 2_400), nothing, []);
    expect(await selectAll(db, viaBulk, "id")).toStrictEqual(await selectAll(db, viaDrizzle, "id"));
  });

  it("returns the same rows as drizzle through a client with a column-name transform", async () => {
    const camel = postgres(url!, { max: 1, onnotice: () => {}, connection: { search_path: schemaName }, transform: postgres.camel });
    try {
      const camelDb = drizzle(camel);
      const { viaDrizzle, viaBulk } = tables.token_events;
      const drizzleRows = await drizzleInsert(camelDb, viaDrizzle, eventRows, nothing, "all");
      await expect(bulkInsert(camelDb, viaBulk, eventRows, nothing, "all")).resolves.toStrictEqual({
        count: eventRows.length,
        rows: drizzleRows,
      });
    } finally {
      await camel.end();
    }
  });

  it("goes through drizzle when a row value is SQL", async () => {
    const { viaDrizzle, viaBulk } = tables.token_accounts;
    const rows = [{ ...kinds.token_accounts.rows[0], updatedAt: sql`'2026-01-02T03:04:05Z'::timestamptz` }];
    expect(buildBulkInsert(viaBulk, rows, nothing, [])).toBeNull();

    await drizzleInsert(db, viaDrizzle, rows, nothing, []);
    await expect(bulkInsert(db, viaBulk, rows, nothing, [])).resolves.toMatchObject({ count: 1 });
    expect(await selectAll(db, viaBulk, "address")).toStrictEqual(await selectAll(db, viaDrizzle, "address"));
  });

  it("goes through drizzle when an upsert leaves out an onUpdateFn column", async () => {
    const { viaDrizzle, viaBulk } = tables.extras;
    const first = [{ id: "p", slot: 1n, touched: "explicit" }];
    const later = [{ id: "p", slot: 2n, hits: 1 }];
    const conflict = (table: any) => versioned(table, "id", later);
    expect(buildBulkInsert(viaBulk, later, conflict(viaBulk), [viaBulk.slot])).toBeNull();

    /* One transaction, so DEFAULT now() is the same instant in both tables. */
    await db!.transaction(async (tx) => {
      for (const table of [viaDrizzle, viaBulk]) await bulkInsert(tx, table, first, nothing, []);
      await drizzleInsert(tx, viaDrizzle, later, conflict(viaDrizzle), [viaDrizzle.slot]);
      await bulkInsert(tx, viaBulk, later, conflict(viaBulk), [viaBulk.slot]);
      const stored = await selectAll(tx, viaBulk, "id");
      expect(stored).toStrictEqual(await selectAll(tx, viaDrizzle, "id"));
      expect(stored.map((row: Row) => row.touched)).toStrictEqual(["from onUpdateFn"]);
    });
  });

  it("goes through drizzle when a defaultFn returns SQL", async () => {
    const rows = [{ id: "a" }, { id: "b", label: "given" }];
    expect(buildBulkInsert(sqlDefaultTable, rows, nothing, [])).toBeNull();

    await expect(bulkInsert(db, sqlDefaultTable, rows, nothing, [])).resolves.toStrictEqual({
      count: 2,
      rows: [{ id: "a", label: "from sql" }, { id: "b", label: "given" }],
    });
  });
});
