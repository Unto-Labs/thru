import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import postgres, { type Sql } from 'postgres';
import { integer, pgTable, text, jsonb, numeric, timestamp } from 'drizzle-orm/pg-core';
import { sql as query } from 'drizzle-orm';
import { ProjectionWriter, QuarantineInput, FatalProjectionError, requestReset, resetReason, type ProjectionInserts, type ProjectionRows, type WriterIdentity } from './writer';
import { PROJECTION_STORAGE_SQL } from './migration';
import { migrateSchema, parseMigration } from './schema-migrations';
import { defineAccountProjection, defineEventProjection } from './define';
import { Indexer } from '../runtime/indexer';
import { OutboxReader } from '../delivery/outbox';
import { NO_PINS, NotReadyError, expectedIdentity, identityMatches, readReadyEpoch } from './read';
import { requestResetFor, resetRequestCommand } from './commands';
import { defineAnchorRefresh } from './anchor';
const source = vi.hoisted(() => ({ events: [] as any[], options: null as any, stream: undefined as undefined | ((signal: AbortSignal) => AsyncGenerator<any>) }));
vi.mock('@thru/replay', async original => ({ ...await original<object>(), createEventReplay: (options: any) => {
  source.options = options;
  return source.stream?.(options.signal) ?? (async function* () { for (const event of source.events) yield event; options.onStreaming?.(); })();
} }));
const url = process.env.TEST_DATABASE_URL;
const admin = url ? postgres(url, { max: 2, onnotice: () => {} }) : null!;
const effects = pgTable('test_effects', { id: text().notNull(), value: integer().notNull() });
const codecs = pgTable('test_codecs', {
  payload: jsonb(), amounts: numeric().array(), at: timestamp({withTimezone: true, mode: 'string'}),
});
const tables = { effects, codecs };
// Both native Drizzle type surfaces must remain usable without wrapper columns.
const typedInsert: ProjectionInserts<typeof tables>['effects'] = { id: 'i', value: 1 };
const typedRow: ProjectionRows<typeof tables>['effects'] = typedInsert;
void typedRow;
const storage = parseMigration('0001_test.sql', `-- min-binary: 1
${PROJECTION_STORAGE_SQL}
CREATE TABLE test_effects(id text NOT NULL, value integer NOT NULL);
CREATE TABLE test_codecs(payload jsonb, amounts numeric[], at timestamptz);`);
/* One dataset per database: every test gets its own. */
const databases: { name: string; sql: Sql }[] = [];
async function freshDb(): Promise<Sql> {
  const name = `idx_writer_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  await admin.unsafe(`CREATE DATABASE ${name}`);
  const u = new URL(url!); u.pathname = `/${name}`;
  const sql = postgres(u.toString(), { max: 8, onnotice: () => {} });
  databases.push({ name, sql });
  await migrateSchema(sql, [storage], { name: 'test' });
  return sql;
}
const databaseUrl = (db: Sql) => { const u = new URL(url!); u.pathname = `/${databases.find(d => d.sql === db)!.name}`; return u.toString(); };
const writers = new Set<ProjectionWriter>();
let sql: Sql;
const base: WriterIdentity = { chainId: 7, program: 'prog' };
async function writer(db: Sql = sql, options: { identity?: WriterIdentity; height?: bigint | (() => Promise<bigint>); readyLanes?: string[]; log?: (e: any) => void;
  anchor?: (slot: bigint) => Promise<string | null> } = {}) {
  const h = options.height;
  const w = await ProjectionWriter.acquire(db, { identity: options.identity ?? base, tablePrefix: 'test_', readyLanes: options.readyLanes, anchor: options.anchor,
    height: typeof h === 'function' ? h : async () => h ?? 0n, rewindConfirmations: 2, rewindConfirmMs: 1, log: options.log ?? (() => {}) });
  writers.add(w);
  return w;
}
async function close(w: ProjectionWriter) { writers.delete(w); await w.close(); }
afterAll(async () => {
  for (const w of writers) await w.close();
  for (const d of databases) { await d.sql.end(); await admin.unsafe(`DROP DATABASE IF EXISTS ${d.name} WITH (FORCE)`); }
  await admin?.end();
});
describe.skipIf(!url)('projection ownership and commits (real Postgres)', () => {
  beforeEach(async () => { sql = await freshDb(); });
  it('uses the lock connection for raw SQL and Drizzle, and rolls back data, progress, notifications and revisions', async () => {
    const w = await writer();
    const reader = new OutboxReader(sql);
    const notifications = vi.fn();
    const unlisten = await reader.listen(notifications, () => {});
    try {
      const before = await reader.head();
      await expect(w.transaction(async ctx => {
        const [raw] = await ctx.tx.sql`SELECT pg_backend_pid() AS pid`;
        const [typed] = await ctx.tx.db.execute<{pid: number}>(query`SELECT pg_backend_pid() AS pid`);
        expect(typed.pid).toBe(raw.pid);
        await ctx.tx.db.insert(effects).values({ id: 'rollback', value: 1 });
        ctx.emit({ topic: 'test', key: 'x', revision: ctx.revision, operation: 'replace', payload: {} });
        throw new Error('crash before commit');
      }, { tables, progress: { lane: 'events', slot: 10n } })).rejects.toThrow('crash before commit');
      expect(await sql`SELECT * FROM test_effects`).toHaveLength(0);
      expect(await w.progress('events')).toBeNull();
      expect(await reader.outbox('0')).toHaveLength(0);
      expect((await reader.head()).ns!.batch_seq).toBe(before.ns!.batch_seq);
      expect(notifications).not.toHaveBeenCalled();
      await w.transaction(async ctx => {
        await ctx.tx.db.insert(effects).values({ id: 'commit', value: 2 });
        ctx.emit({ topic: 'test', key: 'x', revision: ctx.revision, operation: 'replace', payload: { value: 2 } });
      }, { tables, progress: { lane: 'events', slot: 10n } });
      await vi.waitFor(() => expect(notifications).toHaveBeenCalledTimes(1));
      expect((await w.progress('events'))?.slot).toBe(10n);
      expect((await reader.outbox('0'))[0].payload.messages[0].payload).toEqual({ value: 2 });
    } finally { await unlisten(); await close(w); }
  });
  it('keeps raw and typed JSON, numeric arrays and timestamps compatible on the same connection', async () => {
    const w = await writer();
    const serializers = { ...sql.options.serializers };
    const parsers = { ...sql.options.parsers };
    await w.transaction(async ctx => {
      await ctx.tx.db.insert(codecs).values({ payload: { nested: ['x'] }, amounts: ['1.5', '2.5'], at: '2026-01-02T03:04:05Z' });
      const [row] = await ctx.tx.db.select().from(codecs);
      expect(row.payload).toEqual({ nested: ['x'] });
      expect(row.amounts).toEqual(['1.5', '2.5']);
      expect(typeof row.at).toBe('string');
      const [raw] = await ctx.tx.sql`SELECT ${['3.5','4.5']}::numeric[] AS amounts,${ctx.tx.sql.json('raw JSON string')}::jsonb AS payload,now() AS at`;
      expect(raw.amounts).toEqual(['3.5', '4.5']);
      expect(raw.payload).toBe('raw JSON string');
      expect(raw.at).toBeInstanceOf(Date);
      await ctx.tx.db.update(codecs).set({payload: 'typed JSON string'}).where(query`true`);
      const [updated] = await ctx.tx.sql`SELECT payload FROM test_codecs`;
      expect(updated.payload).toBe('typed JSON string');
      await ctx.tx.db.delete(codecs);
    }, { tables });
    expect(sql.options.serializers).toEqual(serializers);
    expect(sql.options.parsers).toEqual(parsers);
    await close(w);
  });
  it('rejects a second owner and rechecks ownership after the domain callback', async () => {
    const w = await writer();
    await expect(writer()).rejects.toThrow('Another worker');
    await expect(w.transaction(async ctx => {
      await ctx.tx.db.insert(effects).values({ id: 'fenced', value: 3 });
      await ctx.tx.sql`SELECT pg_advisory_unlock(hashtextextended('thru-indexer:writer:'||current_schema(),0))`;
    }, { tables })).rejects.toThrow('Writer lock connection lost');
    expect(await sql`SELECT * FROM test_effects`).toHaveLength(0);
    const replacement = await writer();
    await expect(w.transaction(async () => {})).rejects.toThrow('Writer lock connection lost');
    await close(w);
    await close(replacement);
  });
  it('deduplicates before derived effects after restart, distinguishes skip, quarantine and failure', async () => {
    let w = await writer();
    const event = (id: number) => ({ eventId: `sig:100:0:0:${id}`, slot: 100n, payload: new Uint8Array([id]) });
    source.events = [event(1), event(2), event(3)];
    const define = () => defineEventProjection({ name: 'history', tables, writer: w, startSlot: 0n, filterFactory: () => ({}) as any,
      parse: e => { const id = e.payload![0]; if (id === 2) return null; if (id === 3) throw new QuarantineInput('unsupported'); return id; },
      commit: async (id, ctx) => {
        await ctx.tx.db.insert(effects).values({ id: String(id), value: id });
        ctx.emit({ topic: 'test', key: 'x', revision: ctx.revision, operation: 'append', payload: id });
      },
    });
    await define().run(() => null! , new AbortController().signal, {});
    expect(await sql`SELECT * FROM test_effects`).toHaveLength(1);
    expect(await sql`SELECT * FROM indexer_quarantine`).toHaveLength(1);
    await close(w);
    w = await writer();
    await define().run(() => null!, new AbortController().signal, {});
    expect(await sql`SELECT * FROM test_effects`).toHaveLength(1);
    expect(await new OutboxReader(sql).outbox('0')).toHaveLength(1);
    expect((await w.progress('history'))?.eventId).toBe(event(3).eventId);
    source.events = [event(4)];
    const broken = defineEventProjection({ name: 'history', tables, writer: w, startSlot: 0n, filterFactory: () => ({}) as any,
      parse: () => 4, commit: async () => { throw new Error('database failed'); } });
    await expect(broken.run(() => null!, new AbortController().signal, {})).rejects.toThrow('database failed');
    expect(await sql`SELECT * FROM indexer_raw_events`).toHaveLength(3);
    expect((await w.progress('history'))?.eventId).toBe(event(3).eventId);
    await close(w);
  });
  it('commits ready events in order in one transaction, all or none, and claims a repeated id once', async () => {
    const w = await writer();
    const event = (id: number, slot = 100) => ({ eventId: `sig:${slot}:0:0:${id}`, slot: BigInt(slot), payload: new Uint8Array([id]) });
    let failOn: number | undefined;
    const projection = defineEventProjection({ name: 'batched', tables, writer: w, startSlot: 0n, filterFactory: () => ({}) as any,
      parse: e => e.payload![0],
      commit: async (id, ctx) => {
        if (id === failOn) throw new Error('database failed');
        await ctx.tx.db.insert(effects).values({ id: String(id), value: id });
        ctx.emit({ topic: 'test', key: 'x', revision: ctx.revision, operation: 'append', payload: id });
      },
    });
    source.events = [event(1), event(2), event(2), event(3, 101), event(4, 102)];
    failOn = 4;
    await expect(projection.run(() => null!, new AbortController().signal, {})).rejects.toThrow('database failed');
    expect(await sql`SELECT * FROM test_effects`).toHaveLength(0);
    expect(await sql`SELECT * FROM indexer_raw_events`).toHaveLength(0);
    expect(await w.progress('batched')).toBeNull();
    failOn = undefined;
    await projection.run(() => null!, new AbortController().signal, {});
    expect((await sql`SELECT id FROM test_effects ORDER BY ctid`).map(r => r.id)).toEqual(['1', '2', '3', '4']);
    const outbox = await new OutboxReader(sql).outbox('0');
    expect(outbox.map(r => r.payload.messages.map(m => m.payload))).toEqual([[1, 2, 3, 4]]);
    expect(await w.progress('batched')).toEqual({ slot: 102n, eventId: event(4, 102).eventId, live: true });
    await close(w);
  });
  it('retries marking a quiet lane live after a failed attempt, without waiting for another event', async () => {
    const w = await writer();
    const real = w.markLive.bind(w);
    let attempts = 0;
    (w as any).markLive = async (lane: string, ctx?: any) => { attempts++; if (attempts === 1) throw new Error('connection reset'); return real(lane, ctx); };
    /* One event, then history is read and the stream stays quiet. */
    source.stream = signal => (async function* () {
      yield { eventId: 'sig:100:0:0:1', slot: 100n, payload: new Uint8Array([1]) };
      source.options.onStreaming?.();
      await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
    })();
    const errors: unknown[] = [];
    const stop = new AbortController();
    const running = defineEventProjection({ name: 'quiet', tables, writer: w, startSlot: 0n, filterFactory: () => ({}) as any,
      parse: e => e.payload![0], commit: async () => {}, onError: e => errors.push(e) }).run(() => null!, stop.signal, {}).catch(() => {});
    try {
      for (let i = 0; i < 300 && !(await w.progress('quiet'))?.live; i++) await new Promise(resolve => setTimeout(resolve, 10));
    } finally {
      stop.abort();
      await running;
      source.stream = undefined;
    }
    expect(attempts).toBe(2);
    expect((await w.progress('quiet'))?.live).toBe(true);
    expect(errors.map(e => (e as Error).message)).toEqual(['connection reset']);
    await close(w);
  });
  it('splits a batch into publications under the stream frame bound, in order, each at its own revision', async () => {
    const w = await writer();
    source.events = Array.from({ length: 40 }, (_, i) => ({ eventId: `sig:100:0:0:${i}`, slot: 100n, payload: new Uint8Array([i]) }));
    await defineEventProjection({ name: 'large', tables, writer: w, startSlot: 0n, filterFactory: () => ({}) as any,
      parse: e => e.payload![0],
      commit: async (id, ctx) => {
        ctx.emit({ topic: 'test', key: 'x', revision: ctx.revision, operation: 'append', payload: { id, fill: 'x'.repeat(10_000) } });
      },
    }).run(() => null!, new AbortController().signal, {});
    const rows = await new OutboxReader(sql).outbox('0');
    expect(rows.map(r => r.payload.messages.map(m => (m.payload as { id: number }).id)).flat()).toEqual(Array.from({ length: 40 }, (_, i) => i));
    // Seven 10 KB messages pass the 64 KiB bound: 40 events take six publications.
    expect(rows.length).toBe(6);
    for (const [i, row] of rows.entries()) {
      expect(row.batch_seq).toBe(String(BigInt(rows[0].batch_seq) + BigInt(i)));
      expect(row.payload.messages.every(m => m.revision === row.batch_seq)).toBe(true);
      expect(JSON.stringify(row.payload).length).toBeLessThan(80_000);
    }
    expect((await new OutboxReader(sql).head()).ns!.batch_seq).toBe(rows.at(-1)!.batch_seq);
    await close(w);
  });
  it('reads the outbox in numeric batch order across a digit boundary, so a page never reorders or skips', async () => {
    for (const seq of [8, 9, 10, 11, 98, 99, 100, 101])
      await sql`INSERT INTO indexer_outbox(batch_seq,epoch,payload) VALUES(${seq},1,${sql.json({ batchSeq: String(seq), messages: [] })})`;
    const reader = new OutboxReader(sql);
    expect((await reader.outbox('7')).map(r => r.batch_seq)).toEqual(['8', '9', '10', '11', '98', '99', '100', '101']);
    expect((await reader.outbox('97', 3)).map(r => r.batch_seq)).toEqual(['98', '99', '100']);
  });
  it('flushes staged rows before each publication and before commit, at the revision of their messages, all or none', async () => {
    const w = await writer();
    source.events = Array.from({ length: 20 }, (_, i) => ({ eventId: `sig:100:0:0:${i}`, slot: 100n, payload: new Uint8Array([i]) }));
    const staged = new WeakMap<object, number[]>();
    let failFlush = true;
    const projection = defineEventProjection({ name: 'staged', tables, writer: w, startSlot: 0n, filterFactory: () => ({}) as any,
      parse: e => e.payload![0],
      commit: async (id, ctx) => {
        staged.set(ctx, [...staged.get(ctx) ?? [], id]);
        ctx.emit({ topic: 'test', key: 'x', revision: ctx.revision, operation: 'append', payload: { id, fill: 'x'.repeat(10_000) } });
      },
      flush: async ctx => {
        const ids = staged.get(ctx) ?? [];
        staged.delete(ctx);
        if (failFlush && ids.includes(19)) throw new Error('flush failed');
        if (ids.length) await ctx.tx.db.insert(effects).values(ids.map(id => ({ id: String(id), value: Number(ctx.revision) })));
      },
    });
    await expect(projection.run(() => null!, new AbortController().signal, {})).rejects.toThrow('flush failed');
    expect(await sql`SELECT * FROM test_effects`).toHaveLength(0);
    expect(await sql`SELECT * FROM indexer_raw_events`).toHaveLength(0);
    expect(await w.progress('staged')).toBeNull();
    failFlush = false;
    await projection.run(() => null!, new AbortController().signal, {});
    const rows = await new OutboxReader(sql).outbox('0');
    const revisionOf = new Map(rows.flatMap(r => r.payload.messages.map(m => [String((m.payload as { id: number }).id), Number(r.batch_seq)] as const)));
    const effectRows = await sql`SELECT id, value FROM test_effects ORDER BY id::int`;
    expect(effectRows.map(r => r.id)).toEqual(Array.from({ length: 20 }, (_, i) => String(i)));
    expect(rows.length).toBeGreaterThan(1);
    for (const r of effectRows) expect(r.value).toBe(revisionOf.get(r.id));
    await close(w);
  });
  it('commits a live event without waiting for the next one', async () => {
    const w = await writer();
    const stop = new AbortController();
    source.stream = async function* (signal) {
      yield { eventId: 'live:200', slot: 200n, payload: new Uint8Array([7]) };
      await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
    };
    try {
      const running = defineEventProjection({ name: 'live', tables, writer: w, startSlot: 0n, filterFactory: () => ({}) as any,
        parse: () => null, commit: async () => {} }).run(() => null!, stop.signal, {});
      await vi.waitFor(async () => expect((await w.progress('live'))?.slot).toBe(200n));
      stop.abort();
      await running;
    } finally { source.stream = undefined; stop.abort(); await close(w); }
  });
  it('claims a Buffer payload as its bytes', async () => {
    const w = await writer();
    const claimed = await w.transaction(ctx => w.claimEvents(ctx.tx.sql,
      [{ id: 'buffer', slot: '1', payload: Buffer.from([1, 2, 255]), envelope: { signature: Buffer.from([7]) } }]));
    expect([...claimed]).toEqual(['buffer']);
    const [row] = await sql`SELECT payload, envelope FROM indexer_raw_events`;
    expect(Buffer.from(row.payload).toString('hex')).toBe('0102ff');
    expect(row.envelope).toEqual({ signature: '07' });
    await close(w);
  });
  it('publishes empty domain batches atomically with SDK progress and never derives progress from raw history', async () => {
    const w = await writer();
    const options = { name: 'fresh', tables, writer: w, startSlot: 10n, filterFactory: () => ({}) as any,
      parse: () => 1, commit: async (_: number, ctx: import('./writer').CommitContext) => { ctx.emit(); } };
    // A raw claim is not proof that projection progress committed.
    await w.transaction(ctx => w.claimEvent(ctx.tx.sql,
      { id: 'unrelated', slot: '900', payload: new Uint8Array(), envelope: {} }));
    source.events = [{ eventId: 'fresh:200', slot: 200n, payload: new Uint8Array() }];
    await defineEventProjection(options).run(() => null!, new AbortController().signal, {});
    expect(source.options.startSlot).toBe(10n);
    const reader = new OutboxReader(sql);
    expect((await reader.outbox('0')).map(r => r.payload.messages)).toEqual([[]]);
    expect((await w.progress('fresh'))?.slot).toBe(200n);
    source.events = [];
    await defineEventProjection(options).run(() => null!, new AbortController().signal, {});
    expect(source.options.startSlot).toBe(136n);
    await expect(w.transaction(async ctx => { ctx.emit(); throw new Error('rollback empty batch'); },
      { progress: { lane: 'fresh', slot: 300n } })).rejects.toThrow('rollback empty batch');
    expect((await reader.outbox('0'))).toHaveLength(1);
    expect((await w.progress('fresh'))?.slot).toBe(200n);
    await close(w);
  });
  it('records the epoch\'s first complete cut once, rolls it back with its transaction, and latches ready behind the ready lanes', async () => {
    const w = await writer(sql, { readyLanes: ['ev'], height: 1000n });
    await expect(w.transaction(async ctx => {
      await w.activate(ctx.tx.sql, 100n);
      throw new Error('incomplete');
    })).rejects.toThrow('incomplete');
    expect((await new OutboxReader(sql).head()).ns!.activated_slot).toBeNull();
    await w.transaction(ctx => w.activate(ctx.tx.sql, 100n));
    await w.transaction(ctx => w.activate(ctx.tx.sql, 150n));
    let head = (await new OutboxReader(sql).head()).ns!;
    expect([head.activated_slot, head.ready]).toEqual(['100', false]);
    await w.transaction(async () => {}, { progress: { lane: 'ev', slot: 99n } });
    expect((await new OutboxReader(sql).head()).ns!.ready).toBe(false);
    /* Progress at the cut's slot may be a batch that ended inside it: not yet complete. */
    await w.transaction(async () => {}, { progress: { lane: 'ev', slot: 100n } });
    expect((await new OutboxReader(sql).head()).ns!.ready).toBe(false);
    await w.transaction(async () => {}, { progress: { lane: 'ev', slot: 101n } });
    head = (await new OutboxReader(sql).head()).ns!;
    expect(head.ready).toBe(true);
    await close(w);
    /* A plain restart keeps the epoch and readiness. */
    const again = await writer(sql, { readyLanes: ['ev'], height: 1000n });
    expect(again.reset).toBeNull();
    head = (await new OutboxReader(sql).head()).ns!;
    expect([head.epoch, head.ready, head.activated_slot]).toEqual(['1', true, '100']);
    await close(again);
  });
  it('lets an event lane that has read all history mark itself live, which releases readiness on a quiet chain', async () => {
    const w = await writer(sql, { readyLanes: ['quiet'] });
    await w.transaction(ctx => w.activate(ctx.tx.sql, 500n));
    source.events = [];
    await defineEventProjection({ name: 'quiet', tables, writer: w, startSlot: 0n, filterFactory: () => ({}) as any,
      parse: () => null, commit: async () => {} }).run(() => null!, new AbortController().signal, {});
    await vi.waitFor(async () => expect((await new OutboxReader(sql).head()).ns!.ready).toBe(true));
    expect((await w.progress('quiet'))?.live).toBe(true);
    await close(w);
  });
  it('runs grouped work under the existing supervisor, retries only failed groups at the selected cut, then handles merges and splits', async () => {
    const w = await writer();
    let round = 0, fail = true;
    const reads: string[] = [], commits: string[][] = [];
    const factory = () => ({ getHeight: async () => ({ finalized: BigInt((round + 1) * 100), locallyExecuted: 500n, clusterExecuted: 500n }),
      getChainInfo: async () => ({ chainId: 7 }), close() {} }) as any;
    const projection = defineAccountProjection({ name: 'groups', tables, writer: w, chainId: 7, intervalMs: 1,
      resolveGroups: async () => (round === 2 ? [['A', 'B']] : [['A'], ['B']]).map(value => ({ key: value.join(','), value })),
      project: async (group, at) => {
        reads.push(`${group.join(',')}@${at.slot}`);
        if (round === 1 && group[0] === 'B' && fail) { fail = false; throw new Error('missing at fixed slot'); }
        return { group, slot: at.slot };
      },
      commit: async (results, ctx, activation) => {
        const names = results.flatMap(r => r.group);
        if (round === 0) expect(activation).toBe(true);
        commits.push(names);
        await ctx.tx.db.insert(effects).values(names.map(id => ({ id, value: Number(results[0].slot) })));
        ctx.emit({ topic: 'test', key: 'x', revision: ctx.revision, operation: 'replace', payload: names });
      },
      onCommitted: () => { if (++round === 4) indexer.stop(); },
    });
    const metrics = { record: vi.fn() };
    const indexer = new Indexer({ clientFactory: factory, projections: [projection],
      supervisorInitialBackoffMs: 1, supervisorMaxBackoffMs: 1, telemetry: metrics, logLevel: 'error' });
    await indexer.start();
    expect(reads.filter(r => r === 'A@200')).toHaveLength(1);
    expect(reads.filter(r => r === 'B@200')).toHaveLength(2);
    expect(commits).toEqual([['A', 'B'], ['A'], ['B'], ['A', 'B'], ['A'], ['B']]);
    expect((await w.progress('groups:A'))?.slot).toBe(400n);
    expect((await new OutboxReader(sql).head()).ns!.activated_slot).toBe('100');
    expect(indexer.getStatus().streams[0].restartCount).toBe(1);
    expect(metrics.record.mock.calls.some(c => c[0] === 'apps.indexer.retries')).toBe(true);
    await close(w);
  });
  it('takes a fresh cut when the first one finds no account (accounts created later, e.g. a redeploy after a reset), and activates without a restart', async () => {
    const w = await writer();
    let height = 100n;
    const reads: bigint[] = [];
    const factory = () => ({ getHeight: async () => ({ finalized: height, locallyExecuted: height, clusterExecuted: height }),
      getChainInfo: async () => ({ chainId: 7 }), close() {} }) as any;
    const projection = defineAccountProjection({ name: 'late', tables, writer: w, chainId: 7, intervalMs: 1,
      resolveGroups: async () => [{ key: 'A', value: 'A' }],
      project: async (_group, at) => {
        reads.push(at.slot);
        if (reads.length > 12) indexer.stop();
        /* The program and its accounts exist from slot 300 on; the chain moves on meanwhile. */
        if (at.slot < 300n) { height += 100n; throw Object.assign(new Error('account not found'), { code: 5 }); }
        return at.slot;
      },
      commit: async (results, ctx) => {
        await ctx.tx.db.insert(effects).values({ id: 'late', value: Number(results[0]) });
        ctx.emit({ topic: 'test', key: 'x', revision: ctx.revision, operation: 'replace', payload: results });
      },
      onCommitted: () => indexer.stop(),
    });
    const indexer = new Indexer({ clientFactory: factory, projections: [projection],
      supervisorInitialBackoffMs: 1, supervisorMaxBackoffMs: 1, logLevel: 'error' });
    await indexer.start();
    expect(reads).toEqual([100n, 200n, 300n]);
    expect((await new OutboxReader(sql).head()).ns!.activated_slot).toBe('300');
    await close(w);
  });
  it('gives up a cut that keeps failing for another reason after a few attempts', async () => {
    const w = await writer();
    let height = 100n;
    const reads: bigint[] = [];
    const factory = () => ({ getHeight: async () => ({ finalized: height, locallyExecuted: height, clusterExecuted: height }),
      getChainInfo: async () => ({ chainId: 7 }), close() {} }) as any;
    const projection = defineAccountProjection({ name: 'pruned', tables, writer: w, chainId: 7, intervalMs: 1,
      resolveGroups: async () => [{ key: 'A', value: 'A' }],
      project: async (_group, at) => {
        reads.push(at.slot);
        if (reads.length > 12) indexer.stop();
        height += 1n;
        /* The RPC no longer serves pinned reads at slot 100. */
        if (at.slot === 100n) throw new Error('slot below the retained history');
        return at.slot;
      },
      commit: async () => {},
      onCommitted: () => indexer.stop(),
    });
    const indexer = new Indexer({ clientFactory: factory, projections: [projection],
      supervisorInitialBackoffMs: 1, supervisorMaxBackoffMs: 1, logLevel: 'error' });
    await indexer.start();
    expect(reads).toEqual([100n, 100n, 100n, 103n]);
    await close(w);
  });
  it('stops all supervised work on a fatal identity failure', async () => {
    const w = await writer();
    const p = defineAccountProjection({ name: 'wrong-chain', tables, writer: w, chainId: 8,
      resolveGroups: async () => [], project: async () => null, commit: async () => {} });
    const indexer = new Indexer({ clientFactory: () => ({ getHeight: async () => ({finalized: 1n}),
      getChainInfo: async () => ({chainId: 7}), close() {} }) as any, projections: [p], logLevel: 'error' });
    await expect(indexer.start()).rejects.toBeInstanceOf(FatalProjectionError);
    expect(indexer.getStatus().running).toBe(false);
    await close(w);
  });
});

describe('reset reasons (pure)', () => {
  const stored = { identity: { chainId: 7, program: 'p', markets: ['a', 'b'] } };
  it('orders chain, program, other keys, then a rewind; ignores key order inside values', () => {
    expect(resetReason(null, { chainId: 7, program: 'p' }, 0n, 0n)?.reason).toBe('initial');
    expect(resetReason(stored, { chainId: 8, program: 'q', markets: ['a'] }, 0n, 0n)?.reason).toBe('chain_identity_changed');
    expect(resetReason(stored, { chainId: 7, program: 'q', markets: ['a'] }, 0n, 0n)?.reason).toBe('program_identity_changed');
    expect(resetReason(stored, { chainId: 7, program: 'p', markets: ['a'] }, 0n, 0n)?.reason).toBe('market_set_changed');
    expect(resetReason({ identity: { chainId: 7, program: 'p', exchangeMeta: 'x' } }, { chainId: 7, program: 'p', exchangeMeta: 'y' }, 0n, 0n)?.reason).toBe('exchange_meta_changed');
    expect(resetReason({ identity: { chainId: 7, program: 'p', sourceMode: 'a' } }, { chainId: 7, program: 'p', sourceMode: 'b' }, 0n, 0n)?.reason).toBe('source_mode_changed');
    expect(resetReason(stored, { markets: ['a', 'b'], program: 'p', chainId: 7 }, 100n, 99n)).toEqual({ reason: 'chain_height_rewound', detail: { indexedHeight: '100', remoteHeight: '99' } });
    expect(resetReason(stored, { markets: ['a', 'b'], program: 'p', chainId: 7 }, 100n, 100n)).toBeNull();
    expect(resetReason({ ...stored, resetRequested: 'UNTO-1' }, { chainId: 8, program: 'p' }, 0n, 0n)).toEqual({ reason: 'operator_requested', detail: { note: 'UNTO-1' } });
  });
});

describe.skipIf(!url)('automatic reset on worker start (real Postgres)', () => {
  beforeEach(async () => { sql = await freshDb(); });
  /* Writes one row in every kind of table a reset must clear, at the writer's epoch. */
  async function seed(w: ProjectionWriter, slot = 100n) {
    await w.transaction(async ctx => {
      await ctx.tx.db.insert(effects).values({ id: 'row', value: 1 });
      await w.claimEvent(ctx.tx.sql, { id: `e${slot}`, slot: String(slot), payload: new Uint8Array([1]), envelope: {} });
      await w.quarantine(ctx, `q${slot}`, 'bad', new Uint8Array([2]));
      await w.activate(ctx.tx.sql, slot);
      ctx.emit({ topic: 't', key: 'k', revision: ctx.revision, operation: 'replace', payload: {} });
    }, { tables, progress: { lane: 'ev', slot } });
  }
  const counts = async () => {
    const [r] = await sql`SELECT (SELECT count(*) FROM test_effects)::int AS effects,(SELECT count(*) FROM indexer_raw_events)::int AS raw,
      (SELECT count(*) FROM indexer_quarantine)::int AS quarantine,(SELECT count(*) FROM indexer_outbox)::int AS outbox,
      (SELECT count(*) FROM indexer_projection_progress)::int AS progress`;
    return r;
  };
  const identity = async () => (await sql`SELECT epoch::text,batch_seq::text,ready,activated_slot::text,reset_reason,reset_detail,identity FROM indexer_identity`)[0];

  it('starts a fresh database at epoch 1 with reason initial, and a plain restart keeps epoch, data and sequence', async () => {
    const events: any[] = [];
    let w = await writer(sql, { log: e => events.push(e), height: 200n, readyLanes: ['ev'] });
    expect(w.reset?.reason).toBe('initial');
    expect(w.epoch).toBe('1');
    await seed(w);
    expect(w.epochReady).toBe(false);
    /* The event lane commits past the cut's slot (100): that slot is complete. */
    await w.transaction(async () => {}, { progress: { lane: 'ev', slot: 101n } });
    expect(w.epochReady).toBe(true);
    const before = await identity();
    expect([before.epoch, before.batch_seq, before.ready]).toEqual(['1', '1', true]);
    await close(w);
    w = await writer(sql, { log: e => events.push(e), height: 200n, readyLanes: ['ev'] });
    expect(w.reset).toBeNull();
    expect(w.epoch).toBe('1');
    /* A plain restart keeps readiness; the database, re-read, is authoritative. */
    expect(w.epochReady).toBe(true);
    await sql`UPDATE indexer_identity SET ready=false`;
    expect(w.epochReady).toBe(true);
    expect(await w.refreshEpochReady()).toBe(false);
    expect(w.epochReady).toBe(false);
    await sql`UPDATE indexer_identity SET ready=true`;
    expect(await w.refreshEpochReady()).toBe(true);
    expect(await counts()).toEqual({ effects: 1, raw: 1, quarantine: 1, outbox: 1, progress: 1 });
    await w.transaction(async ctx => { ctx.emit({ topic: 't', key: 'k', revision: ctx.revision, operation: 'replace', payload: {} }); });
    expect((await identity()).batch_seq).toBe('2');
    expect(events.map(e => e.event)).toEqual(['indexer_reset', 'indexer_epoch_activated', 'indexer_epoch_ready', 'indexer_resumed']);
    await close(w);
  });
  for (const [name, next, reason] of [
    ['chain', { chainId: 8, program: 'prog' }, 'chain_identity_changed'],
    ['program', { chainId: 7, program: 'prog2' }, 'program_identity_changed'],
    ['market set', { chainId: 7, program: 'prog', markets: ['m1', 'm2'] }, 'market_set_changed'],
  ] as const) {
    it(`resets every read-model and writer table and bumps the epoch when the ${name} changes`, async () => {
      let w = await writer(sql, { identity: { chainId: 7, program: 'prog', markets: ['m1'] }, height: 100n });
      await seed(w);
      await close(w);
      const events: any[] = [];
      w = await writer(sql, { identity: next as WriterIdentity, height: 100n, log: e => events.push(e) });
      expect(w.reset?.reason).toBe(reason);
      expect(w.epoch).toBe('2');
      expect(await counts()).toEqual({ effects: 0, raw: 0, quarantine: 0, outbox: 0, progress: 0 });
      const row = await identity();
      expect([row.epoch, row.batch_seq, row.ready, row.activated_slot, row.reset_reason]).toEqual(['2', '0', false, null, reason]);
      expect(row.identity).toEqual(next);
      expect(events[0]).toMatchObject({ event: 'indexer_reset', reason, previousEpoch: '1', epoch: '2' });
      /* The new epoch's publications start over and carry the new epoch. */
      await seed(w);
      const [batch] = await new OutboxReader(sql).outbox('0');
      expect([batch.batch_seq, batch.payload.epoch]).toEqual(['1', '2']);
      await close(w);
    });
  }
  it('resets on a confirmed height rewind, and not when a lagging RPC catches up during confirmation', async () => {
    let w = await writer(sql, { height: 1000n });
    await seed(w, 900n);
    await close(w);
    const heights = [10n, 10n, 950n];
    w = await writer(sql, { height: async () => heights.shift() ?? 950n });
    expect(w.reset).toBeNull();
    expect(w.epoch).toBe('1');
    await close(w);
    w = await writer(sql, { height: async () => 5n });
    expect(w.reset).toMatchObject({ reason: 'chain_height_rewound', detail: { indexedHeight: '900', remoteHeight: '5' } });
    expect(w.epoch).toBe('2');
    expect((await counts()).effects).toBe(0);
    await close(w);
  });
  it('resets when the anchored block changed (a regenesis that kept chain ID and addresses), not on a transient mismatch', async () => {
    let w = await writer(sql, { height: 1000n });
    await seed(w, 900n);
    expect(await w.recordAnchor(950n, 'aa')).toBe(true);
    expect(await w.recordAnchor(940n, 'bb')).toBe(false);
    await close(w);
    /* Same chain: the anchor matches; a plain restart. */
    w = await writer(sql, { height: 2000n, anchor: async () => 'aa' });
    expect(w.reset).toBeNull();
    await close(w);
    /* A lagging or flaky RPC: one wrong answer, then the right one. */
    const answers = ['zz', 'aa', 'aa'];
    w = await writer(sql, { height: 2000n, anchor: async () => answers.shift() ?? 'aa' });
    expect(w.reset).toBeNull();
    await close(w);
    /* A new chain, taller than the old one, with another block at the anchor slot. */
    w = await writer(sql, { height: 5000n, anchor: async slot => (slot === 950n ? 'cc' : null) });
    expect(w.reset).toMatchObject({ reason: 'chain_anchor_changed', detail: { anchorSlot: '950', stored: 'aa', observed: 'cc' } });
    expect((await identity()).epoch).toBe('2');
    expect((await sql`SELECT anchor_slot,anchor_hash FROM indexer_identity`)[0]).toEqual({ anchor_slot: null, anchor_hash: null });
    expect((await counts()).effects).toBe(0);
    await close(w);
  });
  /* A chain the RPC serves: `hashes(slot)` is the block hash (hex) at a slot, or null. */
  const chain = (finalized: bigint, hashes: (slot: bigint) => string | null) => ({
    getHeight: async () => ({ finalized }), close() {},
    listBlocks: async (r: any) => {
      const slot = BigInt(r.filter.params.slot.kind.value), hash = hashes(slot);
      return { blocks: hash ? [{ header: { slot, blockHash: { value: Buffer.from(hash, 'hex') } } }] : [] };
    },
  });
  /* Runs the anchor lane once: resolves after one refresh, rejects with what it threw. */
  const refreshAnchor = async (w: ProjectionWriter, source: ReturnType<typeof chain>) => {
    const stop = new AbortController();
    await defineAnchorRefresh({ name: 'anchor', writer: w, intervalMs: 60_000 }).run(() => source as any, stop.signal, { onRecord: () => stop.abort() });
  };
  const storedAnchor = async () => (await sql`SELECT anchor_slot::text AS slot,anchor_hash AS hash FROM indexer_identity`)[0];
  it('stops instead of moving the anchor when a replacement chain is already taller, and the restart resets', async () => {
    const events: any[] = [];
    let w = await writer(sql, { height: 1000n, log: e => events.push(e) });
    await seed(w, 900n);
    expect(w.epochReady).toBe(true);
    await refreshAnchor(w, chain(950n, () => 'aa'));
    expect(await storedAnchor()).toEqual({ slot: '950', hash: 'aa' });
    /* Another chain with the same ID (another block at the anchor slot), already taller than the
       dataset, so no height check trips: the lane stops the worker and leaves the anchor alone. */
    await expect(refreshAnchor(w, chain(5000n, slot => (slot === 950n ? 'dd' : 'ee')))).rejects.toBeInstanceOf(FatalProjectionError);
    expect(events.at(-1)).toMatchObject({ event: 'indexer_anchor_changed', anchorSlot: '950', stored: 'aa', observed: 'dd' });
    expect(await storedAnchor()).toEqual({ slot: '950', hash: 'aa' });
    await close(w);
    /* The restart on that chain resets the data through the start-up anchor check. */
    w = await writer(sql, { height: 5000n, anchor: async slot => (slot === 950n ? 'dd' : 'ee') });
    expect(w.reset).toMatchObject({ reason: 'chain_anchor_changed', detail: { anchorSlot: '950', stored: 'aa', observed: 'dd' } });
    await close(w);
  });
  it('moves the anchor along the same chain, and holds it through a mismatch the re-reads do not confirm', async () => {
    const events: any[] = [];
    const w = await writer(sql, { height: 1000n, log: e => events.push(e) });
    await seed(w, 900n);
    await refreshAnchor(w, chain(950n, () => 'aa'));
    await refreshAnchor(w, chain(1200n, slot => (slot === 1200n ? 'bb' : 'aa')));
    expect(await storedAnchor()).toEqual({ slot: '1200', hash: 'bb' });
    /* A flaky read at the anchor slot (also a slot the node does not serve yet): logged, the anchor stays this round. */
    for (const first of ['ff', null]) {
      const answers = [first];
      await refreshAnchor(w, chain(1300n, slot => (slot === 1200n ? (answers.length ? answers.shift()! : 'bb') : 'cc')));
      expect(await storedAnchor()).toEqual({ slot: '1200', hash: 'bb' });
      expect(events.at(-1)).toMatchObject({ event: 'indexer_anchor_unconfirmed', anchorSlot: '1200', stored: 'bb', observed: first });
    }
    await refreshAnchor(w, chain(1300n, slot => (slot === 1200n ? 'bb' : 'cc')));
    expect(await storedAnchor()).toEqual({ slot: '1300', hash: 'cc' });
    await close(w);
  });
  it('starts a new epoch over the same data when the database was restored or cloned elsewhere', async () => {
    let w = await writer(sql, { height: 1000n, readyLanes: ['ev'] });
    await seed(w, 900n);
    await w.markLive('ev');
    await close(w);
    const [{ storage_id }] = await sql`SELECT storage_id FROM indexer_identity`;
    /* system identifier : database OID : WAL timeline */
    expect(storage_id).toMatch(/^\d+:\d+:[0-9A-F]{8}$/);
    /* What a PITR clone or a dump restored into another database looks like to the worker. */
    await sql`UPDATE indexer_identity SET storage_id='1234:5678'`;
    w = await writer(sql, { height: 1000n, readyLanes: ['ev'] });
    expect(w.reset).toMatchObject({ reason: 'storage_restored', detail: { stored: '1234:5678', current: storage_id } });
    /* A restore's epoch is the restore time in ms: never one a client saw before. */
    expect(BigInt(w.epoch) > 1_700_000_000_000n).toBe(true);
    const firstRestore = w.epoch;
    const c = await counts();
    expect(c).toEqual({ effects: 1, raw: 1, quarantine: 1, outbox: 0, progress: 1 });
    const row = await identity();
    expect([row.ready, row.activated_slot]).toEqual([false, null]);
    expect((await w.progress('ev'))?.live).toBe(false);
    await close(w);
    /* The next start on the same storage is a plain restart. */
    w = await writer(sql, { height: 1000n, readyLanes: ['ev'] });
    expect(w.reset).toBeNull();
    await close(w);
    /* The same backup (epoch 1) restored again elsewhere: another epoch than the first restore's. */
    await new Promise(resolve => setTimeout(resolve, 5));
    await sql`UPDATE indexer_identity SET storage_id='9999:1',epoch=1`;
    w = await writer(sql, { height: 1000n, readyLanes: ['ev'] });
    expect(w.reset).toMatchObject({ reason: 'storage_restored' });
    expect(w.epoch).not.toBe(firstRestore);
    expect(BigInt(w.epoch) > BigInt(firstRestore)).toBe(true);
    await close(w);
  });
  it('fully resets a restored database whose chain was replaced since (the anchor decides before the restore)', async () => {
    let w = await writer(sql, { height: 1000n });
    await seed(w, 900n);
    expect(await w.recordAnchor(950n, 'aa')).toBe(true);
    await close(w);
    /* Restored elsewhere, and the chain kept its ID and addresses but is a new one, already taller. */
    await sql`UPDATE indexer_identity SET storage_id='1234:5678'`;
    w = await writer(sql, { height: 5000n, anchor: async slot => (slot === 950n ? 'cc' : null) });
    expect(w.reset).toMatchObject({ reason: 'chain_anchor_changed', detail: { anchorSlot: '950', stored: 'aa', observed: 'cc' } });
    expect((await counts()).effects).toBe(0);
    /* A reset of a restored database never reuses an epoch either (restore time in ms). */
    const fullReset = w.epoch;
    expect(BigInt(fullReset) > 1_700_000_000_000n).toBe(true);
    await close(w);
    /* The same backup restored again, through the same full reset: another epoch. */
    await new Promise(resolve => setTimeout(resolve, 5));
    await sql`UPDATE indexer_identity SET storage_id='4321:8765',epoch=1,anchor_slot=950,anchor_hash='aa'`;
    w = await writer(sql, { height: 5000n, anchor: async slot => (slot === 950n ? 'cc' : null) });
    expect(w.reset).toMatchObject({ reason: 'chain_anchor_changed' });
    expect(BigInt(w.epoch) > BigInt(fullReset)).toBe(true);
    await close(w);
    /* The same chain: the restore keeps the data and only starts a new epoch. */
    w = await writer(sql, { height: 5000n });
    await seed(w, 4000n);
    expect(await w.recordAnchor(4500n, 'dd')).toBe(true);
    await close(w);
    await sql`UPDATE indexer_identity SET storage_id='1234:5678'`;
    w = await writer(sql, { height: 5000n, anchor: async () => 'dd' });
    expect(w.reset).toMatchObject({ reason: 'storage_restored' });
    expect((await counts()).effects).toBe(1);
    await close(w);
  });
  it('resets on an operator request recorded while a worker runs, then clears the request', async () => {
    let w = await writer(sql, { height: 100n });
    await seed(w);
    expect(await requestReset(sql, 'UNTO-1234 corrupt seats')).toBe('1');
    /* The running writer is unaffected until it restarts. */
    await w.transaction(async ctx => { ctx.emit({ topic: 't', key: 'k', revision: ctx.revision, operation: 'replace', payload: {} }); });
    await close(w);
    w = await writer(sql, { height: 100n });
    expect(w.reset).toMatchObject({ reason: 'operator_requested', detail: { note: 'UNTO-1234 corrupt seats' } });
    expect((await sql`SELECT reset_requested FROM indexer_identity`)[0].reset_requested).toBeNull();
    await close(w);
    expect((await writer(sql, { height: 100n })).reset).toBeNull();
    await expect(requestReset(sql, ' ')).rejects.toThrow('note');
  });
  it('records reset requests from the reset-request command and from reconcile', async () => {
    const w = await writer(sql, { height: 100n });
    await expect(resetRequestCommand('test', [], {})).rejects.toThrow('usage: reset-request');
    await expect(resetRequestCommand('test', ['UNTO-1'], {})).rejects.toThrow('DATABASE_URL is required');
    expect(await resetRequestCommand('test', ['UNTO-1', 'corrupt'], { DATABASE_URL: databaseUrl(sql) }))
      .toEqual({ event: 'indexer_reset_requested', service: 'test', epoch: '1', note: 'UNTO-1 corrupt' });
    const r = await requestResetFor(sql, [{ check: 'seats', detail: 1 }, { check: 'book', detail: 2 }, { check: 'seats', detail: 3 }]);
    expect(r.epoch).toBe('1');
    expect(r.note).toMatch(/^reconcile \S+Z: seats,book$/);
    expect((await sql`SELECT reset_requested FROM indexer_identity`)[0].reset_requested).toBe(r.note);
    await close(w);
  });
  it('reads only a ready epoch of the pinned dataset, under the identity lock', async () => {
    const state = (tx: any) => tx`SELECT epoch::text AS epoch,ready,chain_id::text AS chain_id,program FROM indexer_identity`;
    const read = (pins = NO_PINS) => readReadyEpoch<{ epoch: string }, string>(sql, state, pins, async (_tx, s) => s.epoch);
    await expect(read()).rejects.toBeInstanceOf(NotReadyError);
    const w = await writer(sql, { height: 200n });
    await expect(read()).rejects.toThrow('NOT_READY');
    await seed(w);
    expect(await read()).toBe('1');
    expect(await read(expectedIdentity({ EXPECTED_CHAIN_ID: '7', EXPECTED_PROGRAM: 'prog' }))).toBe('1');
    await expect(read(expectedIdentity({ EXPECTED_CHAIN_ID: '8' }))).rejects.toBeInstanceOf(NotReadyError);
    await expect(read(expectedIdentity({ EXPECTED_PROGRAM: 'other' }))).rejects.toBeInstanceOf(NotReadyError);
    expect(identityMatches(null, NO_PINS)).toBe(false);
    expect(() => expectedIdentity({ EXPECTED_CHAIN_ID: 'x' })).toThrow('integer');
    /* Reads run read-only with the 200 ms statement bound. */
    expect(await readReadyEpoch(sql, state, NO_PINS, async tx => (await tx`SHOW statement_timeout`)[0].statement_timeout)).toBe('200ms');
    await expect(readReadyEpoch(sql, state, NO_PINS, async tx => tx`DELETE FROM test_effects`)).rejects.toThrow(/read-only/);
    await close(w);
  });
  it('lets exactly one of two workers started at once own the database', async () => {
    const results = await Promise.allSettled([writer(sql, { height: 1n }), writer(sql, { height: 1n })]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(r => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(FatalProjectionError);
    expect(String(rejected.reason)).toContain('Another worker owns this database');
    expect((await identity()).epoch).toBe('1');
  });
  it('fences a writer whose epoch was reset under it', async () => {
    const w = await writer(sql, { height: 1n });
    await seed(w, 1n);
    /* Simulates a stale writer: someone else reset the dataset meanwhile. */
    await sql`UPDATE indexer_identity SET epoch=epoch+1`;
    await expect(w.transaction(async () => {})).rejects.toThrow('Writer fenced');
    await close(w);
  });
  it('blocks behind an in-flight reader, converges after being killed mid-reset, and never shows a reader mixed data', async () => {
    let w = await writer(sql, { height: 100n });
    await seed(w);
    await close(w);
    /* An API-style read transaction: its first statement locks the identity table. */
    const reader = await sql.reserve();
    await reader`BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`;
    await reader`SELECT epoch FROM indexer_identity`;
    /* Its own pool, as a separate worker process has: the killed session dies with it. */
    const worker = postgres(databaseUrl(sql), { max: 2, onnotice: () => {} });
    const resetting = writer(worker, { identity: { chainId: 8, program: 'prog' }, height: 100n });
    resetting.catch(() => {});
    /* The reset waits on the reader's lock; kill the resetting worker's session there. */
    await vi.waitFor(async () => {
      const [r] = await sql`SELECT count(*)::int AS n FROM pg_locks l JOIN pg_class c ON c.oid=l.relation WHERE c.relname='indexer_identity' AND l.mode='AccessExclusiveLock' AND NOT l.granted`;
      expect(r.n).toBe(1);
    });
    expect((await reader`SELECT count(*)::int AS n FROM test_effects`)[0].n).toBe(1);
    await sql`SELECT pg_terminate_backend(pid) FROM pg_locks l JOIN pg_class c ON c.oid=l.relation WHERE c.relname='indexer_identity' AND l.mode='AccessExclusiveLock' AND NOT l.granted`;
    await expect(resetting).rejects.toThrow();
    await worker.end({ timeout: 1 }).catch(() => {});
    await reader`COMMIT`;
    reader.release();
    /* Nothing changed: the killed reset rolled back as a whole. */
    expect(await counts()).toEqual({ effects: 1, raw: 1, quarantine: 1, outbox: 1, progress: 1 });
    expect((await identity()).epoch).toBe('1');
    /* The next start performs the reset. */
    w = await writer(sql, { identity: { chainId: 8, program: 'prog' }, height: 100n });
    expect([w.reset?.reason, w.epoch]).toEqual(['chain_identity_changed', '2']);
    expect(await counts()).toEqual({ effects: 0, raw: 0, quarantine: 0, outbox: 0, progress: 0 });
    await close(w);
  }, 30_000);
});
