/* Live account write throughput of runAccountStreamProcessor against a real
   Postgres. A fake @thru/replay finishes backfill at once, then streams
   --blocks blocks of --per-block token-account updates, each followed by its
   blockFinished marker.

   TEST_DATABASE_URL=postgres://... npx tsx bench/live-accounts.bench.ts \
     --blocks 200 --per-block 50 [--distinct N] [--processor-dir DIR]

   --processor-dir (or BENCH_PROCESSOR_DIR) is the directory holding the
   processor.ts to measure, e.g. a scratch checkout's src/accounts. Its bare
   imports resolve from this package, so the checkout needs no node_modules. */
import { registerHooks } from "node:module";
import { resolve as resolvePath } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { getTableConfig } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { t } from "../src/schema/builder";
import { buildDrizzleTable } from "../src/schema/table";

const { values: args } = parseArgs({
  options: {
    blocks: { type: "string", default: "200" },
    "per-block": { type: "string", default: "50" },
    distinct: { type: "string" },
    "processor-dir": { type: "string" },
  },
});
const blocks = Number(args.blocks);
const perBlock = Number(args["per-block"]);
const updates = blocks * perBlock;
const distinct = Number(args.distinct ?? Math.max(1, Math.floor(updates / 2)));
const processorDir = resolvePath(
  args["processor-dir"] ?? process.env.BENCH_PROCESSOR_DIR ?? resolvePath(import.meta.dirname, "../src/accounts"),
);
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL is required");
if (![blocks, perBlock, distinct].every((n) => Number.isInteger(n) && n > 0)) throw new Error("bad --blocks/--per-block/--distinct");

const fakeReplay = "data:text/javascript," + encodeURIComponent(
  'export const AccountView = { FULL: "full" };' +
    "export const createAccountsByOwnerReplay = (options) => globalThis.__liveBenchReplay(options);",
);
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "@thru/replay") return { url: fakeReplay, shortCircuit: true };
    const fromSource = context.parentURL?.startsWith("file:") && !context.parentURL.includes("/node_modules/");
    if (fromSource && !/^(\.|\/|[a-z]+:)/i.test(specifier)) {
      try {
        return next(specifier, { ...context, parentURL: import.meta.url });
      } catch {}
    }
    const resolved = next(specifier, context);
    /* A bare source tree has no package.json "type", and as CommonJS it would skip these hooks. */
    return fromSource && resolved.url.endsWith(".ts") ? { ...resolved, format: "module" } : resolved;
  },
});

/* Copy of the token indexer's token_accounts schema (web/indexers/token/packages/streams). */
const table = buildDrizzleTable("token_accounts", {
  address: t.text().primaryKey(),
  mint: t.text().notNull().index(),
  owner: t.text().notNull().index(),
  amount: t.text().notNull(),
  frozen: t.boolean().notNull().index(),
  slot: t.bigint().notNull().index(),
  seq: t.bigint().notNull(),
  stateHash: t.text().notNull(),
  updatedAt: t.timestamp().notNull().defaultNow(),
});

const schemaName = `bench_live_accounts_${process.pid}`;
let inserts = 0;
let statements = 0;
const client = postgres(url, {
  max: 2,
  onnotice: () => {},
  connection: { search_path: schemaName },
  debug: (_connection, query) => {
    statements++;
    if (/^\s*insert\s+into\s+"?token_accounts"?/i.test(query)) inserts++;
  },
});
const db = drizzle(client);

const firstSlot = 1_000n;
const addressOf = (i: number) => {
  const bytes = new Uint8Array(32);
  new DataView(bytes.buffer).setUint32(28, i);
  return bytes;
};
const addresses = Array.from({ length: distinct }, (_, i) => addressOf(i));
const addressText = addresses.map((_, i) => `acct-${String(i).padStart(8, "0")}`);
const mints = ["mint-usd", "mint-btc", "mint-eth"];

let liveStart = 0;
(globalThis as any).__liveBenchReplay = (options: { onBackfillComplete?: (a: bigint, b: bigint) => void }) => ({
  [Symbol.asyncIterator]: async function* () {
    options.onBackfillComplete?.(0n, 0n);
    liveStart = performance.now();
    for (let b = 0; b < blocks; b++) {
      const slot = firstSlot + BigInt(b);
      for (let k = 0; k < perBlock; k++) {
        const i = b * perBlock + k;
        const a = i % distinct;
        const address = addresses[a];
        yield {
          type: "account",
          account: { address, addressHex: Buffer.from(address).toString("hex"), data: new Uint8Array(165), isDelete: false, slot, seq: BigInt(i), index: a },
        };
      }
      yield { type: "blockFinished", block: { slot } };
    }
  },
});

const stream = {
  name: "bench-token-accounts",
  description: "bench token accounts",
  schema: {},
  table,
  getOwnerProgram: () => new Uint8Array(32),
  parse: (account: { index: number; slot: bigint; seq: bigint }) => ({
    address: addressText[account.index],
    mint: mints[account.index % mints.length],
    owner: `owner-${account.index % 997}`,
    amount: String(account.seq * 1_000_000n + 17n),
    frozen: account.index % 50 === 0,
    slot: account.slot,
    seq: account.seq,
    stateHash: `hash-${account.slot}-${account.seq}`,
  }),
};

async function setUp() {
  const { columns, indexes } = getTableConfig(table);
  const columnSql = columns.map((c) =>
    [`"${c.name}" ${c.getSQLType()}`, c.primary ? "primary key" : "", c.notNull ? "not null" : "", c.hasDefault ? "default now()" : ""].filter(Boolean).join(" "),
  );
  await client.unsafe(`create schema "${schemaName}"`);
  await client.unsafe(`create table token_accounts (${columnSql.join(", ")})`);
  for (const index of indexes) {
    const cols = index.config.columns.map((c: any) => `"${c.name}"`).join(", ");
    await client.unsafe(`create index "${index.config.name}" on token_accounts (${cols})`);
  }
  await client.unsafe(
    `create table indexer_checkpoints (stream_name text primary key, last_indexed_slot bigint not null, last_event_id text, updated_at timestamptz not null default now())`,
  );
}

try {
  await setUp();
  const { runAccountStreamProcessor } = await import(pathToFileURL(resolvePath(processorDir, "processor.ts")).href);
  inserts = 0;
  statements = 0;
  const stats = await runAccountStreamProcessor(stream, { clientFactory: () => ({}), db, logLevel: "error" });
  const wallMs = performance.now() - liveStart;

  const [{ rows, seq_sum }] = await client.unsafe(`select count(*)::int as rows, coalesce(sum(seq), 0)::text as seq_sum from token_accounts`);
  const [checkpoint] = await client.unsafe(`select last_indexed_slot::text as slot from indexer_checkpoints where stream_name = 'account:bench-token-accounts'`);
  let expectedSeqSum = 0n;
  for (let a = 0; a < distinct; a++) {
    const last = a + Math.floor((updates - 1 - a) / distinct) * distinct;
    if (a < updates) expectedSeqSum += BigInt(last);
  }
  const expectedRows = Math.min(distinct, updates);
  const lastSlot = String(firstSlot + BigInt(blocks - 1));

  const result = {
    processor: processorDir,
    blocks,
    perBlock,
    distinct,
    liveUpdates: updates,
    wallMs: Math.round(wallMs),
    rowsPerSec: Math.round(updates / (wallMs / 1000)),
    inserts,
    statements,
    finalRows: rows,
    checkpoint: checkpoint?.slot ?? null,
    accountsUpdated: stats.accountsUpdated,
  };
  console.log(JSON.stringify(result));
  const failures = [
    rows !== expectedRows && `final rows ${rows} != distinct addresses ${expectedRows}`,
    seq_sum !== String(expectedSeqSum) && `rows do not hold each address's last version (seq sum ${seq_sum} != ${expectedSeqSum})`,
    checkpoint?.slot !== lastSlot && `checkpoint ${checkpoint?.slot} != last block slot ${lastSlot}`,
  ].filter(Boolean);
  if (failures.length > 0) {
    console.error(failures.join("\n"));
    process.exitCode = 1;
  }
} finally {
  await client.unsafe(`drop schema if exists "${schemaName}" cascade`);
  await client.end();
}
