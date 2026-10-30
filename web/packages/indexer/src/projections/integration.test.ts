import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import postgres from 'postgres';
import { integer, pgTable, text, jsonb, numeric, timestamp } from 'drizzle-orm/pg-core';
import { sql as query } from 'drizzle-orm';
import { ProjectionWriter, QuarantineInput, FatalProjectionError, type ProjectionInserts, type ProjectionRows } from './writer';
import { migrateProjectionStorage } from './migration';
import { defineAccountProjection, defineEventProjection } from './define';
import { Indexer } from '../runtime/indexer';
import { OutboxReader } from '../delivery/outbox';
const source = vi.hoisted(() => ({ events: [] as any[], options: null as any, stream: undefined as undefined | ((signal: AbortSignal) => AsyncGenerator<any>) }));
vi.mock('@thru/replay', async original => ({ ...await original<object>(), createEventReplay: (options: any) => {
  source.options = options;
  return source.stream?.(options.signal) ?? (async function* () { for (const event of source.events) yield event; })();
} }));
const url = process.env.TEST_DATABASE_URL;
const sql = url ? postgres(url, { max: 8, onnotice: () => {} }) : null!;
const effects = pgTable('indexer_test_effects', { namespace: text().notNull(), id: text().notNull(), value: integer().notNull() });
const codecs = pgTable('indexer_test_codecs', {
  namespace: text().notNull(), payload: jsonb(), amounts: numeric().array(), at: timestamp({withTimezone: true, mode: 'string'}),
});
const tables = { effects, codecs };
// Both native Drizzle type surfaces must remain usable without wrapper columns.
const typedInsert: ProjectionInserts<typeof tables>['effects'] = { namespace: 'n', id: 'i', value: 1 };
const typedRow: ProjectionRows<typeof tables>['effects'] = typedInsert;
void typedRow;
const writers = new Set<ProjectionWriter>();
async function writer(namespace: string = crypto.randomUUID()) {
  const w = await ProjectionWriter.acquire(sql, namespace, { chain: 7 });
  writers.add(w);
  return w;
}
async function close(w: ProjectionWriter) { writers.delete(w); await w.close(); }
afterAll(async () => { for (const w of writers) await w.close(); await sql?.end(); });
describe.skipIf(!url)('projection ownership and commits (real Postgres)', () => {
  beforeAll(async () => {
    await migrateProjectionStorage(sql);
    await sql`CREATE TABLE IF NOT EXISTS indexer_test_effects(namespace text NOT NULL,id text NOT NULL,value integer NOT NULL)`;
    await sql`CREATE TABLE IF NOT EXISTS indexer_test_codecs(namespace text NOT NULL,payload jsonb,amounts numeric[],at timestamptz)`;
  });
  it('uses the lock connection for raw SQL and Drizzle, and rolls back data, progress, notifications and revisions', async () => {
    const w = await writer();
    const reader = new OutboxReader(sql, w.namespace);
    const notifications = vi.fn();
    const unlisten = await reader.listen(notifications, () => {});
    try {
      const before = await reader.head();
      await expect(w.transaction(async ctx => {
        const [raw] = await ctx.tx.sql`SELECT pg_backend_pid() AS pid`;
        const [typed] = await ctx.tx.db.execute<{pid: number}>(query`SELECT pg_backend_pid() AS pid`);
        expect(typed.pid).toBe(raw.pid);
        await ctx.tx.db.insert(effects).values({ namespace: ctx.namespace, id: 'rollback', value: 1 });
        ctx.emit({ topic: 'test', key: 'x', revision: ctx.revision, operation: 'replace', payload: {} });
        throw new Error('crash before commit');
      }, { tables, progress: { lane: 'events', slot: 10n, generation: '0' } })).rejects.toThrow('crash before commit');
      expect(await sql`SELECT * FROM indexer_test_effects WHERE namespace=${w.namespace}`).toHaveLength(0);
      expect(await w.progress('events', '0')).toBeNull();
      expect(await reader.outbox('0')).toHaveLength(0);
      expect((await reader.head()).ns!.batch_seq).toBe(before.ns!.batch_seq);
      expect(notifications).not.toHaveBeenCalled();
      await w.transaction(async ctx => {
        await ctx.tx.db.insert(effects).values({ namespace: ctx.namespace, id: 'commit', value: 2 });
        ctx.emit({ topic: 'test', key: 'x', revision: ctx.revision, operation: 'replace', payload: { value: 2 } });
      }, { tables, progress: { lane: 'events', slot: 10n, generation: '0' } });
      await vi.waitFor(() => expect(notifications).toHaveBeenCalledTimes(1));
      expect((await w.progress('events', '0'))?.slot).toBe(10n);
      expect((await reader.outbox('0'))[0].payload.messages[0].payload).toEqual({ value: 2 });
    } finally { await unlisten(); await close(w); }
  });
  it('keeps raw and typed JSON, numeric arrays and timestamps compatible on the same connection', async () => {
    const w = await writer();
    const serializers = { ...sql.options.serializers };
    const parsers = { ...sql.options.parsers };
    await w.transaction(async ctx => {
      await ctx.tx.db.insert(codecs).values({ namespace: ctx.namespace, payload: { nested: ['x'] }, amounts: ['1.5', '2.5'], at: '2026-01-02T03:04:05Z' });
      const [row] = await ctx.tx.db.select().from(codecs).where(query`namespace=${ctx.namespace}`);
      expect(row.payload).toEqual({ nested: ['x'] });
      expect(row.amounts).toEqual(['1.5', '2.5']);
      expect(typeof row.at).toBe('string');
      const [raw] = await ctx.tx.sql`SELECT ${['3.5','4.5']}::numeric[] AS amounts,${ctx.tx.sql.json('raw JSON string')}::jsonb AS payload,now() AS at`;
      expect(raw.amounts).toEqual(['3.5', '4.5']);
      expect(raw.payload).toBe('raw JSON string');
      expect(raw.at).toBeInstanceOf(Date);
      await ctx.tx.db.update(codecs).set({payload: 'typed JSON string'}).where(query`namespace=${ctx.namespace}`);
      const [updated] = await ctx.tx.sql`SELECT payload FROM indexer_test_codecs WHERE namespace=${ctx.namespace}`;
      expect(updated.payload).toBe('typed JSON string');
      await ctx.tx.db.delete(codecs).where(query`namespace=${ctx.namespace}`);
    }, { tables });
    expect(sql.options.serializers).toEqual(serializers);
    expect(sql.options.parsers).toEqual(parsers);
    await close(w);
  });
  it('rejects a second owner and rechecks ownership after the domain callback', async () => {
    const w = await writer();
    await expect(writer(w.namespace)).rejects.toThrow('Another worker');
    await expect(w.transaction(async ctx => {
      await ctx.tx.db.insert(effects).values({ namespace: ctx.namespace, id: 'fenced', value: 3 });
      await ctx.tx.sql`SELECT pg_advisory_unlock(hashtextextended(${w.namespace},0))`;
    }, { tables })).rejects.toThrow('Writer lock connection lost');
    expect(await sql`SELECT * FROM indexer_test_effects WHERE namespace=${w.namespace}`).toHaveLength(0);
    const replacement = await writer(w.namespace);
    await expect(w.transaction(async () => {})).rejects.toThrow('Writer lock connection lost');
    await close(w);
    await close(replacement);
  });
  it('deduplicates before derived effects after restart, distinguishes skip, quarantine and failure', async () => {
    let w = await writer();
    const namespace = w.namespace;
    const event = (id: number) => ({ eventId: `sig:100:0:0:${id}`, slot: 100n, payload: new Uint8Array([id]) });
    source.events = [event(1), event(2), event(3)];
    const define = () => defineEventProjection({ name: 'history', tables, writer: w, startSlot: 0n, filterFactory: () => ({}) as any,
      parse: e => { const id = e.payload![0]; if (id === 2) return null; if (id === 3) throw new QuarantineInput('unsupported'); return id; },
      commit: async (id, ctx) => {
        await ctx.tx.db.insert(effects).values({ namespace, id: String(id), value: id });
        ctx.emit({ topic: 'test', key: 'x', revision: ctx.revision, operation: 'append', payload: id });
      },
    });
    await define().run(() => null! , new AbortController().signal, {});
    expect(await sql`SELECT * FROM indexer_test_effects WHERE namespace=${namespace}`).toHaveLength(1);
    expect(await sql`SELECT * FROM indexer_quarantine WHERE namespace_id=${namespace}`).toHaveLength(1);
    await close(w);
    w = await writer(namespace);
    await define().run(() => null!, new AbortController().signal, {});
    expect(await sql`SELECT * FROM indexer_test_effects WHERE namespace=${namespace}`).toHaveLength(1);
    expect(await new OutboxReader(sql, namespace).outbox('0')).toHaveLength(1);
    expect((await w.progress('history', '0'))?.eventId).toBe(event(3).eventId);
    source.events = [event(4)];
    const broken = defineEventProjection({ name: 'history', tables, writer: w, startSlot: 0n, filterFactory: () => ({}) as any,
      parse: () => 4, commit: async () => { throw new Error('database failed'); } });
    await expect(broken.run(() => null!, new AbortController().signal, {})).rejects.toThrow('database failed');
    expect(await sql`SELECT * FROM indexer_raw_events WHERE namespace_id=${namespace}`).toHaveLength(3);
    expect((await w.progress('history', '0'))?.eventId).toBe(event(3).eventId);
    await close(w);
  });
  it('commits ready events in order in one transaction, all or none, and claims a repeated id once', async () => {
    const w = await writer();
    const namespace = w.namespace;
    const event = (id: number, slot = 100) => ({ eventId: `sig:${slot}:0:0:${id}`, slot: BigInt(slot), payload: new Uint8Array([id]) });
    let failOn: number | undefined;
    const projection = defineEventProjection({ name: 'batched', tables, writer: w, startSlot: 0n, filterFactory: () => ({}) as any,
      parse: e => e.payload![0],
      commit: async (id, ctx) => {
        if (id === failOn) throw new Error('database failed');
        await ctx.tx.db.insert(effects).values({ namespace, id: String(id), value: id });
        ctx.emit({ topic: 'test', key: 'x', revision: ctx.revision, operation: 'append', payload: id });
      },
    });
    source.events = [event(1), event(2), event(2), event(3, 101), event(4, 102)];
    failOn = 4;
    await expect(projection.run(() => null!, new AbortController().signal, {})).rejects.toThrow('database failed');
    expect(await sql`SELECT * FROM indexer_test_effects WHERE namespace=${namespace}`).toHaveLength(0);
    expect(await sql`SELECT * FROM indexer_raw_events WHERE namespace_id=${namespace}`).toHaveLength(0);
    expect(await w.progress('batched', '0')).toBeNull();
    failOn = undefined;
    await projection.run(() => null!, new AbortController().signal, {});
    expect((await sql`SELECT id FROM indexer_test_effects WHERE namespace=${namespace} ORDER BY ctid`).map(r => r.id)).toEqual(['1', '2', '3', '4']);
    const outbox = await new OutboxReader(sql, namespace).outbox('0');
    expect(outbox.map(r => r.payload.messages.map(m => m.payload))).toEqual([[1, 2, 3, 4]]);
    expect(await w.progress('batched', '0')).toEqual({ slot: 102n, eventId: event(4, 102).eventId });
    await close(w);
  });
  it('splits a batch into publications under the stream frame bound, in order, each at its own revision', async () => {
    const w = await writer();
    const namespace = w.namespace;
    source.events = Array.from({ length: 40 }, (_, i) => ({ eventId: `sig:100:0:0:${i}`, slot: 100n, payload: new Uint8Array([i]) }));
    await defineEventProjection({ name: 'large', tables, writer: w, startSlot: 0n, filterFactory: () => ({}) as any,
      parse: e => e.payload![0],
      commit: async (id, ctx) => {
        ctx.emit({ topic: 'test', key: 'x', revision: ctx.revision, operation: 'append', payload: { id, fill: 'x'.repeat(10_000) } });
      },
    }).run(() => null!, new AbortController().signal, {});
    const rows = await new OutboxReader(sql, namespace).outbox('0');
    expect(rows.map(r => r.payload.messages.map(m => (m.payload as { id: number }).id)).flat()).toEqual(Array.from({ length: 40 }, (_, i) => i));
    // Seven 10 KB messages pass the 64 KiB bound: 40 events take six publications.
    expect(rows.length).toBe(6);
    for (const [i, row] of rows.entries()) {
      expect(row.batch_seq).toBe(String(BigInt(rows[0].batch_seq) + BigInt(i)));
      expect(row.payload.messages.every(m => m.revision === row.batch_seq)).toBe(true);
      expect(JSON.stringify(row.payload).length).toBeLessThan(80_000);
    }
    expect((await new OutboxReader(sql, namespace).head()).ns!.batch_seq).toBe(rows.at(-1)!.batch_seq);
    await close(w);
  });
  it('flushes staged rows before each publication and before commit, at the revision of their messages, all or none', async () => {
    const w = await writer();
    const namespace = w.namespace;
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
        if (ids.length) await ctx.tx.db.insert(effects).values(ids.map(id => ({ namespace, id: String(id), value: Number(ctx.revision) })));
      },
    });
    await expect(projection.run(() => null!, new AbortController().signal, {})).rejects.toThrow('flush failed');
    expect(await sql`SELECT * FROM indexer_test_effects WHERE namespace=${namespace}`).toHaveLength(0);
    expect(await sql`SELECT * FROM indexer_raw_events WHERE namespace_id=${namespace}`).toHaveLength(0);
    expect(await w.progress('staged', '0')).toBeNull();
    failFlush = false;
    await projection.run(() => null!, new AbortController().signal, {});
    const rows = await new OutboxReader(sql, namespace).outbox('0');
    const revisionOf = new Map(rows.flatMap(r => r.payload.messages.map(m => [String((m.payload as { id: number }).id), Number(r.batch_seq)] as const)));
    const effectRows = await sql`SELECT id, value FROM indexer_test_effects WHERE namespace=${namespace} ORDER BY id::int`;
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
      await vi.waitFor(async () => expect((await w.progress('live', '0'))?.slot).toBe(200n));
      stop.abort();
      await running;
    } finally { source.stream = undefined; stop.abort(); await close(w); }
  });
  it('claims a Buffer payload as its bytes', async () => {
    const w = await writer();
    const claimed = await w.transaction(ctx => w.claimEvents(ctx.tx.sql, ctx.sourceGeneration,
      [{ id: 'buffer', slot: '1', payload: Buffer.from([1, 2, 255]), envelope: { signature: Buffer.from([7]) } }]));
    expect([...claimed]).toEqual(['buffer']);
    const [row] = await sql`SELECT payload, envelope FROM indexer_raw_events WHERE namespace_id=${w.namespace}`;
    expect(Buffer.from(row.payload).toString('hex')).toBe('0102ff');
    expect(row.envelope).toEqual({ signature: '07' });
    await close(w);
  });
  it('publishes empty domain batches atomically with SDK progress and never derives progress from raw history', async () => {
    const w = await writer();
    const options = { name: 'fresh', tables, writer: w, startSlot: 10n, filterFactory: () => ({}) as any,
      parse: () => 1, commit: async (_: number, ctx: import('./writer').CommitContext) => { ctx.emit(); } };
    // A raw claim is not proof that projection progress committed.
    await w.transaction(ctx => w.claimEvent(ctx.tx.sql, ctx.sourceGeneration,
      { id: 'unrelated', slot: '900', payload: new Uint8Array(), envelope: {} }));
    source.events = [{ eventId: 'fresh:200', slot: 200n, payload: new Uint8Array() }];
    await defineEventProjection(options).run(() => null!, new AbortController().signal, {});
    expect(source.options.startSlot).toBe(10n);
    const reader = new OutboxReader(sql, w.namespace);
    expect((await reader.outbox('0')).map(r => r.payload.messages)).toEqual([[]]);
    expect((await w.progress('fresh', '0'))?.slot).toBe(200n);
    source.events = [];
    await defineEventProjection(options).run(() => null!, new AbortController().signal, {});
    expect(source.options.startSlot).toBe(136n);
    await expect(w.transaction(async ctx => { ctx.emit(); throw new Error('rollback empty batch'); },
      { progress: { lane: 'fresh', slot: 300n, generation: '0' } })).rejects.toThrow('rollback empty batch');
    expect((await reader.outbox('0'))).toHaveLength(1);
    expect((await w.progress('fresh', '0'))?.slot).toBe(200n);
    await close(w);
  });
  it('keeps the old generation active until a complete replacement commits', async () => {
    const w = await writer();
    const old = await w.generation();
    await w.transaction(ctx => w.activate(ctx.tx.sql, old));
    const next = await w.generation();
    await expect(w.transaction(async ctx => {
      await w.activate(ctx.tx.sql, next);
      throw new Error('incomplete');
    })).rejects.toThrow('incomplete');
    expect(String((await new OutboxReader(sql, w.namespace).head()).ns!.active_generation)).toBe(old);
    await w.transaction(ctx => w.activate(ctx.tx.sql, next));
    expect(String((await new OutboxReader(sql, w.namespace).head()).ns!.active_generation)).toBe(next);
    await close(w);
  });
  it('runs grouped work under the existing supervisor, retries only failed groups at the selected cut, then handles merges and splits', async () => {
    const w = await writer();
    const generation = await w.generation();
    let round = 0, fail = true;
    const reads: string[] = [], commits: string[][] = [];
    const factory = () => ({ getHeight: async () => ({ finalized: BigInt((round + 1) * 100), locallyExecuted: 500n, clusterExecuted: 500n }),
      getChainInfo: async () => ({ chainId: 7 }), close() {} }) as any;
    const projection = defineAccountProjection({ name: 'groups', tables, writer: w, generation, chainId: 7, intervalMs: 1,
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
        await ctx.tx.db.insert(effects).values(names.map(id => ({ namespace: ctx.namespace, id, value: Number(results[0].slot) })));
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
    expect((await w.progress('groups:A', generation))?.slot).toBe(400n);
    expect(indexer.getStatus().streams[0].restartCount).toBe(1);
    expect(metrics.record.mock.calls.some(c => c[0] === 'apps.indexer.retries')).toBe(true);
    await close(w);
  });
  it('stops all supervised work on a fatal identity failure', async () => {
    const w = await writer();
    const p = defineAccountProjection({ name: 'wrong-chain', tables, writer: w, generation: await w.generation(), chainId: 8,
      resolveGroups: async () => [], project: async () => null, commit: async () => {} });
    const indexer = new Indexer({ clientFactory: () => ({ getHeight: async () => ({finalized: 1n}),
      getChainInfo: async () => ({chainId: 7}), close() {} }) as any, projections: [p], logLevel: 'error' });
    await expect(indexer.start()).rejects.toBeInstanceOf(FatalProjectionError);
    expect(indexer.getStatus().running).toBe(false);
    await close(w);
  });
});
