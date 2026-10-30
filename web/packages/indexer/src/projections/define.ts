import type { ChainClient, ChainClientFactory, Event, Filter } from '@thru/replay';
import type { ProcessorStatusObserver } from '../runtime/status';
import type { CommitContext, ProjectionTables, ProjectionWriter } from './writer';
import { runAccounts, runEvents } from './processor';

export interface ProjectionRuntime {
  readonly name: string;
  readonly kind: 'account' | 'event';
  run(clientFactory: ChainClientFactory, signal: AbortSignal, observer: ProcessorStatusObserver): Promise<void>;
}
export interface Observation {
  slot: bigint;
  observedAtMs: number;
  chainTimeNs: bigint;
  height: Awaited<ReturnType<ChainClient['getHeight']>>;
  signal: AbortSignal;
  client: ChainClient;
}
/** Keys identify connected components, independent of input ordering.
    On a merge or split resolve the union of old and new dependencies for
    that cut so replacement/deletion cannot publish half a transition. */
export interface AccountGroup<T> { key: string; value: T }
export interface AccountProjectionOptions<T extends ProjectionTables, G, R, M> {
  name: string;
  tables: T;
  writer: ProjectionWriter;
  generation: string;
  chainId: number;
  intervalMs?: number;
  /** Notifications only wake the scheduler; pinned reads remain authoritative. */
  updates?: (signal: AbortSignal) => AsyncIterable<{ slot: bigint }>;
  verify?: (observation: Observation) => Promise<void>;
  /** Discover dependencies at observation.slot, never at "current". Failure
      retains the cut across supervisor retries. */
  resolveGroups(observation: Observation): Promise<AccountGroup<G>[]>;
  /** Required missing/deleted/archived-without-bytes accounts must throw.
      A domain which permits absence represents it explicitly in R and deletes
      its rows in commit; the runtime never substitutes a newer account. */
  project(group: G, observation: Observation): Promise<R>;
  commit(results: R[], ctx: CommitContext<T, M>, activation: boolean): Promise<void>;
  validateMessage?: (message: M) => M;
  onCommitted?: (observation: Observation, groups: number) => void;
  onError?: (error: unknown) => void;
}
export interface EventProjectionOptions<T extends ProjectionTables, R, M> {
  name: string;
  tables: T;
  writer: ProjectionWriter;
  startSlot: bigint;
  filterFactory: () => Filter;
  /** null skips intentionally; QuarantineInput records a durable rejection;
      infrastructure errors retry; FatalProjectionError stops the runtime. */
  parse(event: Event): R | null | Promise<R | null>;
  commit(result: R, ctx: CommitContext<T, M>, event: Event): Promise<void>;
  /** Writes what commit staged. Called before each publication and before the
      transaction commits, so a projection can stage rows per event and write
      them with set-based SQL; staged rows take the current ctx.revision. */
  flush?: (ctx: CommitContext<T, M>) => Promise<void>;
  validateMessage?: (message: M) => M;
  onError?: (error: unknown) => void;
}
export function defineAccountProjection<T extends ProjectionTables, G, R, M = unknown>(options: AccountProjectionOptions<T, G, R, M>): ProjectionRuntime {
  const state = { ready: false, lastSlot: 0n, minimum: 0n };
  return { name: options.name, kind: 'account', run: (factory, signal, observer) => runAccounts(options, state, factory, signal, observer) };
}
export function defineEventProjection<T extends ProjectionTables, R, M = unknown>(options: EventProjectionOptions<T, R, M>): ProjectionRuntime {
  return { name: options.name, kind: 'event', run: (factory, signal, observer) => runEvents(options, factory, signal, observer) };
}

/** Periodic domain observations (for example oracle or token freshness).
    Scheduling, failure retry and cancellation use the same runtime supervisor. */
export function defineRefresh(options: {
  name: string;
  intervalMs: number;
  refresh(client: ChainClient, signal: AbortSignal): Promise<void>;
  onError?: (error: unknown) => void;
}): ProjectionRuntime {
  return { name: options.name, kind: 'account', async run(factory, signal, observer) {
    const client = factory();
    const cancel = () => client.close();
    signal.addEventListener('abort', cancel, { once: true });
    try {
      observer.onStart?.({});
      while (!signal.aborted) {
        await options.refresh(client, signal);
        observer.onRecord?.({});
        await new Promise<void>(resolve => {
          const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
          const timer = setTimeout(done, options.intervalMs);
          signal.addEventListener('abort', done, { once: true });
          if (signal.aborted) done();
        });
      }
    } catch (error) { if (!signal.aborted) options.onError?.(error); throw error; }
    finally { signal.removeEventListener('abort', cancel); client.close(); }
  } };
}
