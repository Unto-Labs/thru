import type postgres from 'postgres';
import type { Sql, TransactionSql } from 'postgres';
import type { PgRemoteDatabase } from 'drizzle-orm/pg-proxy';
import { transactionDatabase } from './database';
import type { PgTable } from 'drizzle-orm/pg-core';

export type ProjectionTables = Record<string, PgTable>;
export type ProjectionRows<T extends ProjectionTables> = { [K in keyof T]: T[K]['$inferSelect'] };
export type ProjectionInserts<T extends ProjectionTables> = { [K in keyof T]: T[K]['$inferInsert'] };
export type ProjectionTransaction<T extends ProjectionTables = ProjectionTables> = {
  sql: TransactionSql;
  db: Omit<PgRemoteDatabase<T>, 'transaction'>;
};
export interface CommitContext<T extends ProjectionTables = ProjectionTables, M = unknown> {
  tx: ProjectionTransaction<T>;
  namespace: string;
  sourceGeneration: string;
  projectionGeneration: string;
  readonly activeGeneration: string | null;
  /** The revision emits publish at; ProjectionWriter.publishOver advances it. */
  readonly revision: string;
  /** Publish this revision, even when the batch has no subscribed messages. */
  emit(...messages: M[]): void;
}
export class FatalProjectionError extends Error {}
export class QuarantineInput extends Error {}
const json = (v: unknown) => JSON.stringify(v, (_, x) => typeof x === 'bigint' ? x.toString() : x instanceof Uint8Array ? Array.from(x) : x);
const sorted = (v: any): any => Array.isArray(v) ? v.map(sorted) : v && typeof v === 'object'
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sorted(v[k])])) : v;

function validateDelivery(message: unknown) {
  const m = message as Record<string, unknown> | null;
  if (!m || typeof m.topic !== 'string' || typeof m.key !== 'string' ||
      typeof m.operation !== 'string' || typeof m.revision !== 'string' ||
      !/^(0|[1-9][0-9]*)$/.test(m.revision) || m.payload === undefined)
    throw new Error('Invalid projection notification');
}

export type ProjectionProgress = { lane: string; slot: bigint; eventId?: string; generation?: string };
export type ClaimInput = { id: string; slot: string; payload: Uint8Array; envelope: unknown };
/* Claims store bytes as hex: JSON number arrays cost Postgres ~70 us per event to parse into jsonb.
   The replacer reads this[key] because Buffer.toJSON runs before it sees the value. */
const claimJson = (events: ClaimInput[]) => JSON.stringify(events, function (this: any, key: string, x: unknown) {
  const raw = this[key];
  return raw instanceof Uint8Array ? Buffer.from(raw).toString('hex') : typeof x === 'bigint' ? x.toString() : x;
});
export class ProjectionWriter {
  private tail: Promise<unknown> = Promise.resolve();
  private closing = false;
  private closed?: Promise<void>;
  private states = new WeakMap<object, any>();
  private contexts = new WeakMap<object, CommitContext<any, any>>();
  private publications = new WeakMap<object, { bytes: () => number; publish: () => Promise<void> }>();
  private constructor(
    private readonly pool: Sql,
    readonly session: postgres.ReservedSql,
    readonly namespace: string,
    readonly fence: string,
  ) {}
  static async acquire(sql: Sql, namespace: string, identity: unknown,
    accepts?: (stored: any) => boolean) {
    const session = await sql.reserve();
    try {
      const [lock] = await session`SELECT pg_try_advisory_lock(hashtextextended(${namespace},0)) AS held`;
      if (!lock.held) throw new FatalProjectionError('Another worker owns this namespace');
      await session`INSERT INTO indexer_namespaces(id,identity) VALUES(${namespace},${json(identity)}::text::jsonb) ON CONFLICT DO NOTHING`;
      const [ns] = await session`SELECT * FROM indexer_namespaces WHERE id=${namespace}`;
      if (json(sorted(ns.identity)) !== json(sorted(identity)) && !accepts?.(ns.identity))
        throw new FatalProjectionError('Namespace identity mismatch; use a new namespace after a verified reset');
      const [f] = await session`UPDATE indexer_namespaces SET writer_fence=writer_fence+1 WHERE id=${namespace} RETURNING writer_fence::text`;
      return new ProjectionWriter(sql, session, namespace, f.writer_fence);
    } catch (e) {
      await session`SELECT pg_advisory_unlock(hashtextextended(${namespace},0))`.catch(() => {});
      session.release();
      throw e;
    }
  }
  private async ownership(tx: TransactionSql) {
    const [[lock], [ns]] = await Promise.all([
      tx`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND pid=pg_backend_pid() AND granted AND classid::bigint=((hashtextextended(${this.namespace},0)>>32)&4294967295) AND objid::bigint=(hashtextextended(${this.namespace},0)&4294967295) AND objsubid=1) AS held`,
      tx`SELECT *,source_generation::text AS source_generation FROM indexer_namespaces WHERE id=${this.namespace} FOR UPDATE`,
    ]);
    if (!lock.held) throw new FatalProjectionError('Writer lock connection lost');
    if (!ns || String(ns.writer_fence) !== this.fence) throw new FatalProjectionError('Writer fenced');
    return ns;
  }
  transaction<R, T extends ProjectionTables = ProjectionTables, M = unknown>(
    fn: (ctx: CommitContext<T, M>) => Promise<R>,
    options: { tables?: T; generation?: string; validate?: (message: M) => M;
      /** Runs before every publication and before commit, even with nothing to publish. */
      beforePublish?: (ctx: CommitContext<T, M>) => Promise<void>;
      progress?: ProjectionProgress | ProjectionProgress[] } = {},
  ): Promise<R> {
    if (this.closing) return Promise.reject(new FatalProjectionError('Writer closed'));
    const result = this.tail.then(async () => {
      const sql = this.session as unknown as TransactionSql;
      await sql`BEGIN`;
      try {
        const ns = await this.ownership(sql);
        let messages: M[] = [];
        let bytes = 0;
        let publish = false;
        let revision = String(BigInt(ns.batch_seq) + 1n);
        let database: PgRemoteDatabase<T> | undefined;
        const owner = this;
        const ctx: CommitContext<T, M> = {
          tx: { sql, get db() {
            if (owner.contexts.get(sql) !== ctx) throw new Error('Expired projection transaction');
            return database ??= transactionDatabase(owner.pool, sql, options.tables);
          } },
          namespace: this.namespace, sourceGeneration: ns.source_generation,
          get activeGeneration() { return ns.active_generation == null ? null : String(ns.active_generation); },
          projectionGeneration: options.generation ?? String(ns.active_generation ?? 0),
          get revision() { return revision; },
          emit: (...batch) => {
            if (this.contexts.get(sql) !== ctx) throw new Error('Expired projection transaction');
            for (const message of batch) {
              const validated = options.validate ? options.validate(message) : message;
              validateDelivery(validated);
              messages.push(validated);
              bytes += json(validated).length;
            }
            publish = true;
          },
        };
        const publishPending = async () => {
          await options.beforePublish?.(ctx);
          if (!publish) return;
          await this.flush(sql, { ns, seq: revision, generation: ctx.projectionGeneration, messages });
          revision = String(BigInt(revision) + 1n);
          messages = [];
          bytes = 0;
          publish = false;
        };
        this.contexts.set(sql, ctx);
        this.states.set(sql, ns);
        this.publications.set(ctx, { bytes: () => bytes, publish: publishPending });
        const value = await fn(ctx);
        await publishPending();
        for (const p of options.progress ? (Array.isArray(options.progress) ? options.progress : [options.progress]) : []) {
          await sql`INSERT INTO indexer_projection_progress(namespace_id,source_generation,projection_generation,lane,slot,event_id)
            VALUES(${this.namespace},${ctx.sourceGeneration},${p.generation ?? ctx.projectionGeneration},${p.lane},${p.slot.toString()},${p.eventId ?? null})
            ON CONFLICT(namespace_id,source_generation,projection_generation,lane) DO UPDATE SET slot=excluded.slot,event_id=excluded.event_id
            WHERE indexer_projection_progress.slot<=excluded.slot`;
        }
        await this.ownership(sql);
        await sql`COMMIT`;
        return value;
      } catch (e) {
        await sql`ROLLBACK`.catch(() => {});
        throw e;
      } finally { this.contexts.delete(sql); this.states.delete(sql); }
    });
    this.tail = result.catch(() => {});
    return result;
  }
  private async flush(sql: TransactionSql, { ns, seq, generation, messages }: { ns: any; seq: string; generation: string; messages: unknown[] }) {
    const payload = { schemaVersion: 1, namespace: this.namespace, sourceGeneration: ns.source_generation,
      projectionGeneration: generation, batchSeq: seq, messages };
    await Promise.all([
      sql`UPDATE indexer_namespaces SET batch_seq=${seq} WHERE id=${this.namespace}`,
      sql`INSERT INTO indexer_outbox(namespace_id,batch_seq,generation,payload) VALUES(${this.namespace},${seq},${generation},${json(payload)}::text::jsonb)`,
      sql`SELECT pg_notify(${'indexer_outbox'},${this.namespace})`,
    ]);
  }
  /** Publishes the messages emitted so far once they reach `bytes`; later
      emits in the same transaction take the next revision. */
  async publishOver(ctx: CommitContext<any, any>, bytes: number) {
    const publication = this.publications.get(ctx);
    if (!publication || this.contexts.get(ctx.tx.sql) !== ctx) throw new Error('Publication requires an owned transaction');
    if (publication.bytes() >= bytes) await publication.publish();
  }
  async claimEvent(sql: TransactionSql, sourceGeneration: string, event: ClaimInput) {
    return (await this.claimEvents(sql, sourceGeneration, [event])).has(event.id);
  }
  /** Claims many events in one statement and returns the ids this call claimed. */
  async claimEvents(sql: TransactionSql, sourceGeneration: string, events: ClaimInput[]) {
    if (!this.contexts.has(sql)) throw new Error('Event claim requires an owned transaction');
    const rows = await sql`INSERT INTO indexer_raw_events(namespace_id,source_generation,event_id,slot,payload,envelope)
      SELECT ${this.namespace},${sourceGeneration},e.id,e.slot,decode(e.payload,'hex'),e.envelope
      FROM jsonb_to_recordset(${claimJson(events)}::text::jsonb)
        AS e(id text,slot numeric,payload text,envelope jsonb)
      ON CONFLICT DO NOTHING RETURNING event_id`;
    return new Set(rows.map(r => r.event_id as string));
  }
  async quarantine(ctx: CommitContext<any, any>, id: string, reason: string, payload: Uint8Array) {
    if (this.contexts.get(ctx.tx.sql) !== ctx) throw new Error('Quarantine requires an owned transaction');
    const sql = ctx.tx.sql;
    await sql`INSERT INTO indexer_quarantine(namespace_id,source_generation,id,reason,payload)
      VALUES(${this.namespace},${ctx.sourceGeneration},${id},${reason},${Buffer.from(payload)})
      ON CONFLICT(namespace_id,source_generation,id) DO UPDATE SET reason=excluded.reason`;
  }
  async progress(lane: string, generation: string) {
    return this.transaction(async ({tx: {sql}}) => {
    const [row] = await sql`SELECT p.slot::text,p.event_id FROM indexer_projection_progress p
      JOIN indexer_namespaces n ON n.id=p.namespace_id AND n.source_generation=p.source_generation
      WHERE p.namespace_id=${this.namespace} AND p.projection_generation=${generation} AND p.lane=${lane}`;
    return row ? { slot: BigInt(row.slot), eventId: row.event_id as string | null } : null;
    });
  }
  async generation() {
    return this.transaction(async ({ tx: { sql } }) => {
      const [r] = await sql`INSERT INTO indexer_generations(namespace_id,status) VALUES(${this.namespace},'building') RETURNING generation::text`;
      return r.generation as string;
    });
  }
  async activate(sql: TransactionSql, generation: string) {
    if (!this.contexts.has(sql)) throw new Error('Activation requires an owned transaction');
    if (String(this.states.get(sql).active_generation) === generation) return;
    await sql`UPDATE indexer_generations SET status='retired' WHERE namespace_id=${this.namespace} AND status='active'`;
    const rows = await sql`UPDATE indexer_generations SET status='active' WHERE namespace_id=${this.namespace} AND generation=${generation} RETURNING generation`;
    if (!rows.length) throw new Error('Unknown projection generation');
    await sql`UPDATE indexer_namespaces SET active_generation=${generation} WHERE id=${this.namespace}`;
    this.states.get(sql).active_generation = generation;
  }
  close(): Promise<void> {
    if (this.closed) return this.closed;
    this.closing = true;
    return this.closed = (async () => {
      await this.tail;
      await this.session`SELECT pg_advisory_unlock(hashtextextended(${this.namespace},0))`.catch(() => {});
      this.session.release();
    })();
  }
}
