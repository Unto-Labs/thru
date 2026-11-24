import type postgres from 'postgres';
import type { Sql, TransactionSql } from 'postgres';
import type { PgRemoteDatabase } from 'drizzle-orm/pg-proxy';
import { transactionDatabase } from './database';
import type { PgTable } from 'drizzle-orm/pg-core';
import { PROJECTION_TABLES } from './migration';

export type ProjectionTables = Record<string, PgTable>;
export type ProjectionRows<T extends ProjectionTables> = { [K in keyof T]: T[K]['$inferSelect'] };
export type ProjectionInserts<T extends ProjectionTables> = { [K in keyof T]: T[K]['$inferInsert'] };
export type ProjectionTransaction<T extends ProjectionTables = ProjectionTables> = {
  sql: TransactionSql;
  db: Omit<PgRemoteDatabase<T>, 'transaction'>;
};
export interface CommitContext<T extends ProjectionTables = ProjectionTables, M = unknown> {
  tx: ProjectionTransaction<T>;
  /** The dataset's epoch: changes only when the worker resets the data. */
  epoch: string;
  /** An account lane has committed a complete cut in this epoch. */
  readonly activated: boolean;
  /** The epoch serves reads: activated, and every ready lane caught up. */
  readonly ready: boolean;
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
const canonical = (v: unknown) => json(sorted(v));

function validateDelivery(message: unknown) {
  const m = message as Record<string, unknown> | null;
  if (!m || typeof m.topic !== 'string' || typeof m.key !== 'string' ||
      typeof m.operation !== 'string' || typeof m.revision !== 'string' ||
      !/^(0|[1-9][0-9]*)$/.test(m.revision) || m.payload === undefined)
    throw new Error('Invalid projection notification');
}

export type ProjectionProgress = { lane: string; slot: bigint; eventId?: string };
export type ClaimInput = { id: string; slot: string; payload: Uint8Array; envelope: unknown };
/* Claims store bytes as hex: JSON number arrays cost Postgres ~70 us per event to parse into jsonb.
   The replacer reads this[key] because Buffer.toJSON runs before it sees the value. */
const claimJson = (events: ClaimInput[]) => JSON.stringify(events, function (this: any, key: string, x: unknown) {
  const raw = this[key];
  return raw instanceof Uint8Array ? Buffer.from(raw).toString('hex') : typeof x === 'bigint' ? x.toString() : x;
});

/** What a dataset belongs to. `chainId` and `program` are mandatory; any
    other key (spot: `exchangeMeta`; perps: `markets`) also resets the data
    when it changes. Never put file bytes or cosmetic fields here. */
export interface WriterIdentity { chainId: number; program: string; [key: string]: unknown }
export interface ResetDecision { reason: string; detail: Record<string, unknown> }
/** Reasons decided from the chain or the storage rather than the stored identity. */
const CHAIN_REASONS = new Set(['chain_height_rewound', 'chain_anchor_changed', 'storage_restored']);
/* The cluster's system identifier, this database's OID and the current WAL
   timeline. A dump restored into another database or cluster changes the
   first two. A physical restore (a PITR clone, a base backup recovered to a
   point) keeps them, but recovery ends on a new timeline. A restart or a
   crash recovery keeps all three, so does an HA failover onto the same disk;
   a promoted replica gets a new timeline (a new epoch, data kept). A restore
   that keeps the timeline (a disk snapshot started as is) cannot be told
   apart from inside the database: run reset-request after one (database.md). */
async function storageId(sql: postgres.ReservedSql) {
  const [{ oid }] = await sql`SELECT oid::text FROM pg_database WHERE datname=current_database()`;
  let system = 'unknown', timeline = 'unknown';
  try { [{ system }] = await sql`SELECT system_identifier::text AS system FROM pg_control_system()`; } catch { /* restricted */ }
  try { [{ timeline }] = await sql`SELECT substr(pg_walfile_name(pg_current_wal_lsn()),1,8) AS timeline`; } catch { /* restricted */ }
  return `${system}:${oid}:${timeline}`;
}
const KEY_REASONS: Record<string, string> = {
  chainId: 'chain_identity_changed',
  program: 'program_identity_changed',
  markets: 'market_set_changed',
  exchangeMeta: 'exchange_meta_changed',
};
const snake = (k: string) => k.replace(/[A-Z]/g, c => '_' + c.toLowerCase());
/** Why the stored dataset cannot continue under `configured`, or null. Order:
    a fresh database, an operator request, the chain, the program, the other
    identity keys (sorted), then a height rewind. */
export function resetReason(stored: { identity: Record<string, unknown>; resetRequested?: string | null } | null,
  configured: WriterIdentity, indexedHeight: bigint, remoteHeight: bigint): ResetDecision | null {
  if (!stored) return { reason: 'initial', detail: {} };
  if (stored.resetRequested) return { reason: 'operator_requested', detail: { note: stored.resetRequested } };
  const keys = [...new Set([...Object.keys(stored.identity), ...Object.keys(configured)])]
    .sort((a, b) => (KEY_ORDER(a) - KEY_ORDER(b)) || a.localeCompare(b));
  for (const key of keys) {
    const before = stored.identity[key], after = (configured as Record<string, unknown>)[key];
    if (canonical(before ?? null) !== canonical(after ?? null))
      return { reason: KEY_REASONS[key] ?? `${snake(key)}_changed`, detail: { key, stored: before ?? null, configured: after ?? null } };
  }
  if (indexedHeight > remoteHeight)
    return { reason: 'chain_height_rewound', detail: { indexedHeight: String(indexedHeight), remoteHeight: String(remoteHeight) } };
  return null;
}
const KEY_ORDER = (k: string) => k === 'chainId' ? 0 : k === 'program' ? 1 : 2;

export interface AcquireOptions {
  identity: WriterIdentity;
  /** The chain's highest reported slot (max of finalized and executed heights). */
  height: () => Promise<bigint>;
  /** Every table whose name starts with this is the service's read model and
      is truncated, with the writer's data tables, on a reset (e.g. `perps_`). */
  tablePrefix: string;
  /** Event lanes that must reach the first complete account cut (or have read
      all history) before the epoch serves reads. */
  readyLanes?: string[];
  /** A rewind resets only when this many further height reads, rewindConfirmMs
      apart, all stay below the indexed height (a lagging RPC behind a load
      balancer must not wipe the data). Default 3 x 5 s. */
  rewindConfirmations?: number;
  rewindConfirmMs?: number;
  /** The block hash at `slot` (hex), or null when the RPC has no block there.
      When the dataset has an anchor (recordAnchor), its hash must still be
      served at its slot; a mismatch confirmed like a rewind resets the data
      (a regenesis that kept the chain ID and every address). */
  anchor?: (slot: bigint) => Promise<string | null>;
  log?: (event: Record<string, unknown>) => void;
}
const WRITER_LOCK = 'thru-indexer:writer:';
/* Cleanup on a session that may be dead (terminated mid-reset): never wait on it. */
const DEAD = new Set(['57P01', '57P02', '57P03', 'CONNECTION_CLOSED', 'CONNECTION_ENDED', 'CONNECTION_DESTROYED', 'ECONNRESET', 'EPIPE']);
/* A session the server terminated takes no further writes (the driver would throw outside any promise). */
const dead = (e: unknown) => DEAD.has(String((e as { code?: unknown })?.code ?? ''));
const bounded = (p: PromiseLike<unknown>, ms = 2000) => Promise.race([Promise.resolve(p).catch(() => {}),
  new Promise(resolve => setTimeout(resolve, ms).unref?.())]);
const lockKey = (sql: Sql | TransactionSql) => sql`hashtextextended(${WRITER_LOCK}||current_schema(),0)`;
/** Re-reads `count` times, `ms` apart, while `still` holds: a rewind or an
    anchor mismatch counts only when every re-read agrees (a lagging RPC
    behind a load balancer must not wipe the data). */
type Confirmation = { count: number; ms: number };
async function confirmed(c: Confirmation, still: () => Promise<boolean>) {
  for (let i = 0; i < c.count; i++) {
    await new Promise(resolve => setTimeout(resolve, c.ms));
    if (!await still()) return false;
  }
  return true;
}

export class ProjectionWriter {
  private tail: Promise<unknown> = Promise.resolve();
  private closing = false;
  private lost = false;
  private closed?: Promise<void>;
  private states = new WeakMap<object, any>();
  private contexts = new WeakMap<object, CommitContext<any, any>>();
  private publications = new WeakMap<object, { bytes: () => number; publish: () => Promise<void> }>();
  private constructor(
    private readonly pool: Sql,
    readonly session: postgres.ReservedSql,
    readonly fence: string,
    /** The epoch this writer writes; a reset by anyone else fences it. */
    readonly epoch: string,
    /** The reset this acquisition performed (null on a plain restart). */
    readonly reset: (ResetDecision & { previousEpoch: string | null }) | null,
    private readonly readyLanes: string[],
    private readonly log: (event: Record<string, unknown>) => void,
    private ready: boolean,
    private readonly confirmation: Confirmation,
  ) {}
  /** This epoch serves reads (`indexer_identity.ready`): as acquired, latched
      when a transaction makes it ready (`indexer_epoch_ready`), and re-read by
      refreshEpochReady (that transaction may still have rolled back). */
  get epochReady() { return this.ready; }
  async refreshEpochReady() {
    const [row] = await this.pool`SELECT ready,epoch::text AS epoch FROM indexer_identity`;
    return this.ready = row?.ready === true && row.epoch === this.epoch;
  }
  /** Takes the database's single-writer lock, then, in one transaction,
      resets the dataset when its identity changed, the chain rewound or an
      operator asked for it, and advances the writer fence. */
  static async acquire(sql: Sql, options: AcquireOptions) {
    /* Structured lines on stderr by default; workers pass their own logger. */
    const log = options.log ?? ((e) => console.warn(JSON.stringify(e)));
    const identity = options.identity;
    if (!Number.isInteger(identity.chainId) || typeof identity.program !== 'string' || !identity.program)
      throw new Error('Writer identity requires chainId and program');
    if (!/^[a-z][a-z0-9]*_$/.test(options.tablePrefix)) throw new Error('Invalid read-model table prefix');
    const session = await sql.reserve();
    let locked = false;
    try {
      const [lock] = await session`SELECT pg_try_advisory_lock(${lockKey(session)}) AS held`;
      if (!lock.held) throw new FatalProjectionError('Another worker owns this database');
      locked = true;
      const [stored] = await session`SELECT identity,reset_requested,anchor_slot::text,anchor_hash,storage_id FROM indexer_identity`;
      const storage = await storageId(session);
      const [{ indexed: indexedText }] = await session`SELECT COALESCE(max(slot),0)::text AS indexed FROM indexer_projection_progress`;
      const indexed = BigInt(indexedText);
      const remoteHeight = await options.height();
      let decision = resetReason(stored ? { identity: stored.identity, resetRequested: stored.reset_requested } : null, identity, indexed, remoteHeight);
      const confirmation = { count: options.rewindConfirmations ?? 3, ms: options.rewindConfirmMs ?? 5000 };
      const confirm = (still: () => Promise<boolean>) => confirmed(confirmation, still);
      if (decision?.reason === 'chain_height_rewound' && !await confirm(async () => await options.height() < indexed)) {
        log({ event: 'indexer_rewind_unconfirmed', indexedHeight: String(indexed), remoteHeight: String(await options.height()) });
        decision = null;
      }
      /* The anchor is checked before the restore path below: a database
         restored after a regenesis must not keep the old chain's rows. */
      if (!decision && stored?.anchor_slot != null && options.anchor) {
        const slot = BigInt(stored.anchor_slot);
        const observed = await options.anchor(slot);
        if (observed !== stored.anchor_hash) {
          if (await confirm(async () => await options.anchor!(slot) !== stored.anchor_hash))
            decision = { reason: 'chain_anchor_changed', detail: { anchorSlot: String(slot), stored: stored.anchor_hash, observed } };
          else log({ event: 'indexer_anchor_unconfirmed', anchorSlot: String(slot), stored: stored.anchor_hash, observed });
        }
      }
      /* A restored or cloned database of the same chain is an earlier
         timeline of this dataset: keep the data, but start a new epoch (every
         cursor a client holds is from the other timeline) and serve nothing
         until it is current again. */
      const restored = !!stored?.storage_id && stored.storage_id !== storage;
      if (!decision && restored)
        decision = { reason: 'storage_restored', detail: { stored: stored.storage_id, current: storage } };
      await session`BEGIN`;
      try {
        const [row] = await session`SELECT epoch::text,identity,reset_requested FROM indexer_identity FOR UPDATE`;
        /* A decision from the chain stands; identity and requests are re-read under the row lock. */
        if (!decision || !CHAIN_REASONS.has(decision.reason))
          decision = resetReason(row ? { identity: row.identity, resetRequested: row.reset_requested } : null, identity, 0n, 0n);
        let previousEpoch: string | null = row ? row.epoch : null;
        /* The epoch must never repeat across restores: restoring the same backup
           twice would otherwise hand out the same epoch twice (whether the
           restore keeps its data or resets fully), and a cursor from the first
           restored timeline would pass the epoch check on the second. On
           another storage the new epoch jumps to the current time in ms. */
        const restoredEpoch = session`GREATEST(epoch+1,(extract(epoch FROM clock_timestamp())*1000)::bigint)`;
        if (decision?.reason === 'storage_restored') {
          await session`LOCK TABLE indexer_identity IN ACCESS EXCLUSIVE MODE`;
          await session`TRUNCATE TABLE indexer_outbox`;
          /* Lanes must prove again that they reached the (new) first cut. */
          await session`UPDATE indexer_projection_progress SET live=false`;
          await session`UPDATE indexer_identity SET epoch=${restoredEpoch},
            activated_slot=NULL,ready=false,ready_at=NULL,
            reset_reason=${decision.reason},reset_detail=${json(decision.detail)}::text::jsonb,reset_at=now(),updated_at=now()`;
        } else if (decision) {
          /* Waits for in-flight API reads (they hold ACCESS SHARE from their
             first statement) and blocks new ones until this commits: no read
             straddles the reset, which TRUNCATE alone would allow. */
          await session`LOCK TABLE indexer_identity IN ACCESS EXCLUSIVE MODE`;
          const [{ tables }] = await session`SELECT string_agg(format('%I',tablename),',' ORDER BY tablename) AS tables FROM pg_tables
            WHERE schemaname=current_schema() AND (starts_with(tablename,${options.tablePrefix}) OR tablename=ANY(${[...PROJECTION_TABLES.data]}::text[]))`;
          if (tables) await session.unsafe(`TRUNCATE TABLE ${tables}`);
          const detail = json(decision.detail);
          if (row)
            await session`UPDATE indexer_identity SET epoch=${restored ? restoredEpoch : session`epoch+1`},chain_id=${identity.chainId},program=${identity.program},identity=${json(identity)}::text::jsonb,
              batch_seq=0,activated_slot=NULL,ready=false,ready_at=NULL,reset_reason=${decision.reason},reset_detail=${detail}::text::jsonb,
              reset_at=now(),reset_requested=NULL,anchor_slot=NULL,anchor_hash=NULL,updated_at=now()`;
          else
            await session`INSERT INTO indexer_identity(chain_id,program,identity,reset_reason,reset_detail)
              VALUES(${identity.chainId},${identity.program},${json(identity)}::text::jsonb,${decision.reason},${detail}::text::jsonb)`;
        }
        const [f] = await session`UPDATE indexer_identity SET writer_fence=writer_fence+1,storage_id=${storage} RETURNING writer_fence::text,epoch::text,ready`;
        await session`COMMIT`;
        const reset = decision ? { ...decision, previousEpoch } : null;
        log(reset
          ? { event: 'indexer_reset', reason: reset.reason, detail: reset.detail, previousEpoch, epoch: f.epoch, identity }
          : { event: 'indexer_resumed', epoch: f.epoch, ready: f.ready, identity });
        return new ProjectionWriter(sql, session, f.writer_fence, f.epoch, reset, options.readyLanes ?? [], log, f.ready === true, confirmation);
      } catch (e) {
        if (!dead(e)) await bounded(session`ROLLBACK`);
        throw e;
      }
    } catch (e) {
      if (locked && !dead(e)) await bounded(session`SELECT pg_advisory_unlock(${lockKey(session)})`);
      session.release();
      throw e;
    }
  }
  private async ownership(tx: TransactionSql) {
    const [[lock], [ns]] = await Promise.all([
      tx`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND pid=pg_backend_pid() AND granted AND classid::bigint=((${lockKey(tx)}>>32)&4294967295) AND objid::bigint=(${lockKey(tx)}&4294967295) AND objsubid=1) AS held`,
      tx`SELECT writer_fence::text,epoch::text,batch_seq::text,activated_slot::text,ready FROM indexer_identity FOR UPDATE`,
    ]);
    if (!lock.held) throw new FatalProjectionError('Writer lock connection lost');
    if (!ns || ns.writer_fence !== this.fence || ns.epoch !== this.epoch) throw new FatalProjectionError('Writer fenced');
    return ns;
  }
  transaction<R, T extends ProjectionTables = ProjectionTables, M = unknown>(
    fn: (ctx: CommitContext<T, M>) => Promise<R>,
    options: { tables?: T; validate?: (message: M) => M;
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
          epoch: this.epoch,
          get activated() { return ns.activated_slot != null; },
          get ready() { return !!ns.ready; },
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
          await this.flush(sql, { seq: revision, messages });
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
        const progress = options.progress ? (Array.isArray(options.progress) ? options.progress : [options.progress]) : [];
        for (const p of progress) {
          await sql`INSERT INTO indexer_projection_progress(lane,slot,event_id)
            VALUES(${p.lane},${p.slot.toString()},${p.eventId ?? null})
            ON CONFLICT(lane) DO UPDATE SET slot=excluded.slot,event_id=excluded.event_id
            WHERE indexer_projection_progress.slot<=excluded.slot`;
        }
        if (!ns.ready && (progress.length || ns.activated_slot != null)) await this.maybeReady(sql, ns);
        await this.ownership(sql);
        await sql`COMMIT`;
        return value;
      } catch (e) {
        if (dead(e)) this.lost = true;
        else await bounded(sql`ROLLBACK`);
        throw e;
      } finally { this.contexts.delete(sql); this.states.delete(sql); }
    });
    this.tail = result.catch(() => {});
    return result;
  }
  /* Latches `ready` once an account lane activated and every ready lane has
     read all history or committed past that cut. Past, not up to: an event
     lane's progress is the last committed event's slot, and a batch can end
     inside a slot, so only a later slot proves the cut's slot complete. */
  private async maybeReady(sql: TransactionSql, ns: any) {
    const rows = await sql`UPDATE indexer_identity i SET ready=true,ready_at=now(),updated_at=now()
      WHERE NOT i.ready AND i.activated_slot IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM unnest(${this.readyLanes}::text[]) AS l(lane) WHERE NOT EXISTS (
          SELECT 1 FROM indexer_projection_progress p WHERE p.lane=l.lane AND (p.live OR p.slot>i.activated_slot)))
      RETURNING activated_slot::text`;
    if (rows.length) {
      ns.ready = this.ready = true;
      this.log({ event: 'indexer_epoch_ready', epoch: this.epoch, activatedSlot: rows[0].activated_slot });
    }
  }
  private async flush(sql: TransactionSql, { seq, messages }: { seq: string; messages: unknown[] }) {
    const payload = { schemaVersion: 2, epoch: this.epoch, batchSeq: seq, messages };
    await Promise.all([
      sql`UPDATE indexer_identity SET batch_seq=${seq}`,
      sql`INSERT INTO indexer_outbox(batch_seq,epoch,payload) VALUES(${seq},${this.epoch},${json(payload)}::text::jsonb)`,
      sql`SELECT pg_notify(${'indexer_outbox'},${this.epoch})`,
    ]);
  }
  /** Publishes the messages emitted so far once they reach `bytes`; later
      emits in the same transaction take the next revision. */
  async publishOver(ctx: CommitContext<any, any>, bytes: number) {
    const publication = this.publications.get(ctx);
    if (!publication || this.contexts.get(ctx.tx.sql) !== ctx) throw new Error('Publication requires an owned transaction');
    if (publication.bytes() >= bytes) await publication.publish();
  }
  async claimEvent(sql: TransactionSql, event: ClaimInput) {
    return (await this.claimEvents(sql, [event])).has(event.id);
  }
  /** Claims many events in one statement and returns the ids this call claimed. */
  async claimEvents(sql: TransactionSql, events: ClaimInput[]) {
    if (!this.contexts.has(sql)) throw new Error('Event claim requires an owned transaction');
    const rows = await sql`INSERT INTO indexer_raw_events(event_id,slot,payload,envelope)
      SELECT e.id,e.slot,decode(e.payload,'hex'),e.envelope
      FROM jsonb_to_recordset(${claimJson(events)}::text::jsonb)
        AS e(id text,slot numeric,payload text,envelope jsonb)
      ON CONFLICT DO NOTHING RETURNING event_id`;
    return new Set(rows.map(r => r.event_id as string));
  }
  async quarantine(ctx: CommitContext<any, any>, id: string, reason: string, payload: Uint8Array) {
    if (this.contexts.get(ctx.tx.sql) !== ctx) throw new Error('Quarantine requires an owned transaction');
    const sql = ctx.tx.sql;
    await sql`INSERT INTO indexer_quarantine(id,reason,payload)
      VALUES(${id},${reason},${Buffer.from(payload)})
      ON CONFLICT(id) DO UPDATE SET reason=excluded.reason`;
  }
  async progress(lane: string) {
    return this.transaction(async ({tx: {sql}}) => {
      const [row] = await sql`SELECT slot::text,event_id,live FROM indexer_projection_progress WHERE lane=${lane}`;
      return row ? { slot: BigInt(row.slot), eventId: row.event_id as string | null, live: !!row.live } : null;
    });
  }
  /** An account lane's first complete cut of this epoch (all markets, one
      transaction). Later activations (after a plain restart) keep the first. */
  async activate(sql: TransactionSql, slot: bigint) {
    if (!this.contexts.has(sql)) throw new Error('Activation requires an owned transaction');
    const ns = this.states.get(sql);
    if (ns.activated_slot != null) return;
    await sql`UPDATE indexer_identity SET activated_slot=${slot.toString()},updated_at=now() WHERE activated_slot IS NULL`;
    ns.activated_slot = slot.toString();
    this.log({ event: 'indexer_epoch_activated', epoch: this.epoch, slot: slot.toString() });
  }
  /** Whether the stored chain anchor is still served (`hashAt`: the block
      hash at a slot on the chain the worker reads now), checked before the
      anchor moves. A mismatch, or a slot the node no longer serves, that the
      same re-reads as at start confirm means the RPC now serves another
      chain (a regenesis that kept the chain ID and is already taller than
      this dataset): it throws FatalProjectionError, so the worker stops
      without moving the anchor and its next start resets
      (`chain_anchor_changed`). An unconfirmed mismatch is logged and the
      anchor stays where it is this round (false). True with no anchor yet. */
  async anchorHolds(hashAt: (slot: bigint) => Promise<string | null>): Promise<boolean> {
    const [row] = await this.pool`SELECT anchor_slot::text AS slot,anchor_hash AS hash FROM indexer_identity`;
    if (row?.slot == null) return true;
    const slot = BigInt(row.slot);
    const observed = await hashAt(slot);
    if (observed === row.hash) return true;
    if (!await confirmed(this.confirmation, async () => await hashAt(slot) !== row.hash)) {
      this.log({ event: 'indexer_anchor_unconfirmed', anchorSlot: row.slot, stored: row.hash, observed, running: true });
      return false;
    }
    this.log({ event: 'indexer_anchor_changed', epoch: this.epoch, anchorSlot: row.slot, stored: row.hash, observed });
    throw new FatalProjectionError(`Chain anchor changed while running: the block at slot ${row.slot} is ${observed ?? 'missing'}, not ${row.hash} ` +
      '(the RPC serves another chain); advancement frozen: the next start resets the data');
  }
  /** Records a recent block of the chain this epoch indexes (slot, hash);
      the next start verifies it (AcquireOptions.anchor). Only moves forward;
      callers check anchorHolds first. */
  async recordAnchor(slot: bigint, hash: string) {
    return this.transaction(async ({ tx: { sql } }) => {
      const rows = await sql`UPDATE indexer_identity SET anchor_slot=${slot.toString()},anchor_hash=${hash},updated_at=now()
        WHERE anchor_slot IS NULL OR anchor_slot<${slot.toString()} RETURNING anchor_slot`;
      return rows.length > 0;
    });
  }
  /** An event lane has read all history and is live; in its own transaction,
      or in `ctx`'s when given (the batch that holds the last history event). */
  async markLive(lane: string, ctx?: CommitContext<any, any>) {
    const mark = async (sql: TransactionSql) => {
      await sql`INSERT INTO indexer_projection_progress(lane,slot,live) VALUES(${lane},0,true)
        ON CONFLICT(lane) DO UPDATE SET live=true`;
      const ns = this.states.get(sql);
      if (!ns.ready) await this.maybeReady(sql, ns);
    };
    if (ctx) {
      if (this.contexts.get(ctx.tx.sql) !== ctx) throw new Error('markLive requires an owned transaction');
      return mark(ctx.tx.sql);
    }
    return this.transaction(({ tx: { sql } }) => mark(sql));
  }
  close(): Promise<void> {
    if (this.closed) return this.closed;
    this.closing = true;
    return this.closed = (async () => {
      await this.tail;
      if (!this.lost) await bounded(this.session`SELECT pg_advisory_unlock(${lockKey(this.session)})`);
      this.session.release();
    })();
  }
}

/** Asks the next worker start to reset the dataset (corrupt or diverged read
    model). Safe while a worker runs: it only marks the identity row. */
export async function requestReset(sql: Sql, note: string) {
  if (!note.trim()) throw new Error('A reset request needs a note (ticket or reason)');
  const rows = await sql`UPDATE indexer_identity SET reset_requested=${note.trim()},updated_at=now() RETURNING epoch::text`;
  if (!rows.length) throw new Error('No dataset identity: nothing to reset');
  return rows[0].epoch as string;
}
