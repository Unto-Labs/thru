import { createEventReplay, type ChainClientFactory, type Event } from '@thru/replay';
import { setTimeout as sleep } from 'node:timers/promises';
import type { ProcessorStatusObserver } from '../runtime/status';
import type { AccountGroup, AccountProjectionOptions, EventProjectionOptions, Observation } from './define';
import { FatalProjectionError, QuarantineInput } from './writer';
import { isSourceUnreachable, SourceBackoff } from '../runtime/backoff';

export interface AccountProjectionState {
  ready: boolean;
  lastSlot: bigint;
  minimum: bigint;
  waitingFor?: bigint;
  cut?: Omit<Observation, 'client' | 'signal'>;
  pending?: Map<string, AccountGroup<unknown>>;
  /** Failed attempts at the retained cut. */
  attempts?: number;
}
/* Failed attempts at one selected cut before the lane takes a fresh one. */
export const CUT_ATTEMPTS = 3;
/** The RPC found no account (gRPC NotFound, code 5): at a pinned cut this
    means the account did not exist at that slot yet. */
export function isNotFound(error: unknown): boolean {
  const e = error as { code?: unknown; cause?: unknown } | null;
  return e?.code === 5 || (e?.cause !== undefined && e.cause !== error && isNotFound(e.cause));
}
/* A supervisor restart retains the selected cut and unresolved groups, so a
   transient failure retries only the failed groups at that cut. The cut is
   given up, and the next attempt selects a fresh one, when a read found no
   account at it (retrying that slot can never succeed: the accounts were
   created later, e.g. a program redeployed after a regenesis reset the
   dataset) or after CUT_ATTEMPTS failed attempts (the RPC may no longer
   serve the slot). A process restart activates again: all initial groups
   commit together in one transaction, so readers see the previous run's rows
   until it commits. The epoch's first activation records its cut
   (ProjectionWriter.activate). */
export async function runAccounts(options: AccountProjectionOptions<any, any, any, any>, state: AccountProjectionState,
  factory: ChainClientFactory, signal: AbortSignal, observer: ProcessorStatusObserver) {
  const client = factory();
  const stop = new AbortController();
  const cancel = () => { stop.abort(); client.close(); };
  signal.addEventListener('abort', cancel, { once: true });
  if (signal.aborted) cancel();
  let wake: (() => void) | undefined;
  /* The notification stream resubscribes 1 s after it ends; after a failure
     to reach the source it backs off (1 s doubling to 30 s, with jitter), so
     an RPC outage logs once per step instead of once a second. */
  const updates = options.updates ? (async () => {
    const backoff = new SourceBackoff();
    while (!stop.signal.aborted) {
      let wait = 1000;
      try {
        for await (const update of options.updates!(stop.signal)) {
          backoff.reset();
          if (update.slot > state.minimum) state.minimum = update.slot;
          wake?.();
        }
        backoff.reset();
      } catch (e) {
        if (!stop.signal.aborted) {
          if (isSourceUnreachable(e)) wait = backoff.next();
          options.onError?.(e);
        }
      }
      await new Promise<void>(resolve => {
        const done = () => { clearTimeout(timer); stop.signal.removeEventListener('abort', done); resolve(); };
        const timer = setTimeout(done, wait);
        stop.signal.addEventListener('abort', done, { once: true });
        if (stop.signal.aborted) done();
      });
    }
  })() : Promise.resolve();
  const wait = () => new Promise<void>(resolve => {
    const done = () => { clearTimeout(timer); wake = undefined; stop.signal.removeEventListener('abort', done); resolve(); };
    const timer = setTimeout(done, options.intervalMs ?? 2500);
    wake = done;
    stop.signal.addEventListener('abort', done, { once: true });
    if (stop.signal.aborted || state.minimum > state.lastSlot) done();
  });
  observer.onStart?.({ checkpointSlot: state.lastSlot });
  try {
    while (!signal.aborted) {
      const [height, identity] = await Promise.all([client.getHeight(), client.getChainInfo()]);
      if (identity.chainId !== options.chainId || height.finalized < (state.cut?.slot ?? state.lastSlot))
        throw new FatalProjectionError('Source identity/height changed; advancement frozen');
      if (!state.cut) {
        // Freeze this wait target; newer notifications belong to the next cut.
        state.waitingFor ??= state.minimum;
        if (height.finalized < state.waitingFor) { await sleep(50, undefined, { signal }); continue; }
        state.cut = { slot: height.finalized, height, observedAtMs: Date.now(),
          chainTimeNs: identity.minLockTime ?? BigInt(Date.now()) * 1000000n };
      }
      const at: Observation = { ...state.cut, client, signal };
      observer.onRecord?.({ slot: at.slot });
      await options.verify?.(at);
      if (!state.pending) {
        const groups = await options.resolveGroups(at);
        if (!groups.length || new Set(groups.map(g => g.key)).size !== groups.length)
          throw new Error('Projection groups must be nonempty and have unique stable keys');
        state.pending = new Map(groups.map(g => [g.key, g]));
      }
      const pending = state.pending;
      const activation = !state.ready;
      const current = [...pending.values()];
      const sets = activation ? [current] : current.map(g => [g]);
      const results = await Promise.allSettled(sets.map(async set => {
        const projected = await Promise.all(set.map(group => options.project(group.value, at)));
        signal.throwIfAborted();
        await options.writer.transaction(async ctx => {
          observer.onPhase?.({ phase: 'commit', slot: at.slot });
          await options.commit(projected, ctx, activation);
          if (activation) await options.writer.activate(ctx.tx.sql, at.slot);
        }, { tables: options.tables, validate: options.validateMessage,
          progress: set.map(g => ({ lane: `${options.name}:${g.key}`, slot: at.slot })) });
        for (const group of set) pending.delete(group.key);
        if (activation) state.ready = true;
        observer.onBatchCommitted?.({ slot: at.slot, count: set.length });
      }));
      observer.onPhase?.({ phase: null });
      const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      if (failures.length) {
        const error = failures.find(r => r.reason instanceof FatalProjectionError)?.reason
          ?? failures.find(r => isNotFound(r.reason))?.reason ?? failures[0].reason;
        observer.onError?.('commit', error);
        throw error;
      }
      signal.throwIfAborted();
      state.lastSlot = at.slot;
      state.cut = undefined;
      state.waitingFor = undefined;
      state.pending = undefined;
      state.attempts = undefined;
      observer.onCheckpoint?.({ slot: at.slot });
      options.onCommitted?.(at, current.length);
      await wait();
    }
  } catch (e) {
    if (!signal.aborted && state.cut && !(e instanceof FatalProjectionError)) {
      state.attempts = (state.attempts ?? 0) + 1;
      if (isNotFound(e) || state.attempts >= CUT_ATTEMPTS) {
        state.cut = undefined;
        state.waitingFor = undefined;
        state.pending = undefined;
        state.attempts = undefined;
      }
    }
    if (!signal.aborted) options.onError?.(e);
    throw e;
  }
  finally { cancel(); signal.removeEventListener('abort', cancel); await updates; }
}

/* Events per writer transaction. A batch also ends when the replay has no
   event ready, so live events commit without waiting for company. */
const EVENT_BATCH = 1_000;
/* Parallel history readers, as the event-stream processor uses. */
const HISTORY_CONNECTIONS = 16;
/* Message bytes per publication, before a flush adds its own (perps: one
   candle per touched minute). The API stream closes a subscriber on any
   frame over 256 KiB, and resuming would request the same frame again. */
const PUBLICATION_BYTES = 64 * 1024;
/* A failed live mark is retried this often until it lands or the lane stops:
   a quiet stream may bring no event that would try again. */
const MARK_LIVE_RETRY_MS = 1_000;
const IDLE = Symbol('idle');

/* Yields runs of up to max items that are ready now, waiting only for the first of each run. */
async function* readyBatches<T>(source: AsyncIterable<T>, max: number): AsyncGenerator<T[]> {
  const items = source[Symbol.asyncIterator]();
  let next: Promise<IteratorResult<T>> | undefined;
  const idle = () => new Promise<typeof IDLE>(resolve => setImmediate(resolve, IDLE));
  try {
    for (;;) {
      const batch: T[] = [];
      while (batch.length < max) {
        next ??= items.next();
        const step = batch.length ? await Promise.race([next, idle()]) : await next;
        if (step === IDLE) break;
        next = undefined;
        if (step.done) { if (batch.length) yield batch; return; }
        batch.push(step.value);
      }
      yield batch;
    }
  } finally {
    next?.catch(() => {});
    const closing = items.return?.().catch(() => {});
    // A pending read settles only once its source is aborted; returning would wait behind it.
    if (!next) await closing;
  }
}

/* Counts what the replay yields, so the lane knows when every event it
   received before the replay reported history read has committed. */
async function* counted<T>(source: AsyncIterable<T>, seen: { received: number }) {
  for await (const item of source) { seen.received++; yield item; }
}
export async function runEvents(options: EventProjectionOptions<any, any, any>, factory: ChainClientFactory,
  signal: AbortSignal, observer: ProcessorStatusObserver) {
  const checkpoint = await options.writer.progress(options.name);
  const prior = checkpoint ? checkpoint.slot - 64n : null;
  const startSlot = prior != null && prior > options.startSlot ? prior : options.startSlot;
  observer.onStart?.({ startSlot, checkpointSlot: checkpoint?.slot });
  // A read can be pending while a batch commits; ending this run must end it too.
  const stop = new AbortController();
  const cancel = () => stop.abort();
  signal.addEventListener('abort', cancel, { once: true });
  if (signal.aborted) cancel();
  /* Live = every event the replay yielded before it reported history read
     has committed; then the lane no longer holds back the epoch's readiness. */
  const seen = { received: 0, committed: 0, streamingAt: null as number | null, live: checkpoint?.live ?? false, busy: false };
  const maybeLive = () => {
    if (seen.live || seen.busy || seen.streamingAt === null || seen.committed < seen.streamingAt) return;
    seen.live = true;
    void options.writer.markLive(options.name).catch(e => {
      seen.live = false;
      options.onError?.(e);
      if (!stop.signal.aborted) setTimeout(() => { if (!stop.signal.aborted) maybeLive(); }, MARK_LIVE_RETRY_MS).unref?.();
    });
  };
  const replay = createEventReplay({ clientFactory: factory, startSlot, historyConnections: HISTORY_CONNECTIONS,
    onStreaming: () => { seen.streamingAt ??= seen.received; maybeLive(); },
    // Overlap live delivery on restart; durable claims suppress duplicate effects.
    // The bound holds one page per history connection (at most 64 MiB at 4 KiB per event).
    filter: options.filterFactory(), signal: stop.signal, resubscribeOnEnd: true, pageSize: 1000,
    maxBufferedItems: HISTORY_CONNECTIONS * 1000, maxEventBytes: 4096 });
  try {
    for await (const events of readyBatches(counted(replay, seen), EVENT_BATCH)) {
      seen.busy = true;
      const batch: { event: Event; result: unknown; quarantined?: QuarantineInput }[] = [];
      for (const event of events) {
        signal.throwIfAborted();
        if (event.slot === undefined || !event.eventId) throw new FatalProjectionError('Source event has no durable identity');
        observer.onRecord?.({ slot: event.slot, id: event.eventId });
        try { batch.push({ event, result: await options.parse(event) }); }
        catch (e) { if (!(e instanceof QuarantineInput)) throw e; batch.push({ event, result: null, quarantined: e }); }
      }
      const last = events[events.length - 1];
      observer.onPhase?.({ phase: 'commit', slot: last.slot! });
      try {
        await options.writer.transaction(async ctx => {
          // The envelope is the source event; its payload is stored once, in the payload column.
          const claimed = await options.writer.claimEvents(ctx.tx.sql, events.map(event =>
            ({ id: event.eventId, slot: String(event.slot), payload: event.payload ?? new Uint8Array(), envelope: { ...event, payload: undefined } })));
          for (const { event, result, quarantined } of batch) {
            // delete: a repeated id in one batch takes effect once, as sequential claims would.
            if (!claimed.delete(event.eventId)) continue;
            if (quarantined) await options.writer.quarantine(ctx, event.eventId, quarantined.message, event.payload ?? new Uint8Array());
            else if (result !== null) await options.commit(result, ctx, event);
            await options.writer.publishOver(ctx, PUBLICATION_BYTES);
          }
        }, { tables: options.tables, validate: options.validateMessage, beforePublish: options.flush,
          progress: { lane: options.name, slot: last.slot!, eventId: last.eventId } });
        seen.committed += events.length;
        observer.onBatchCommitted?.({ slot: last.slot!, count: events.length });
        observer.onCheckpoint?.({ slot: last.slot! });
      } catch (e) { observer.onError?.('commit', e); options.onError?.(e); throw e; }
      finally { seen.busy = false; observer.onPhase?.({ phase: null }); }
      maybeLive();
    }
  } finally {
    signal.removeEventListener('abort', cancel);
    stop.abort();
  }
}
