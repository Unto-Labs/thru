import type { ChainClientFactory, ReplayLogger } from "@thru/replay";
import { createEventReplay } from "@thru/replay";
import type { PgTable } from "drizzle-orm/pg-core";
import type { DatabaseClient } from "../schema/types";
import { validateParsedData } from "../schema/validation";
import { bulkInsert } from "../schema/bulk-insert";
import { getCheckpoint, updateCheckpoint } from "../checkpoint";
import type { EventStream } from "./types";
import type { StreamBatch } from "../types";
import type { ProcessorStatusObserver } from "../runtime/status";
import { createScopedLogger } from "../runtime/logger";

export interface ProcessorOptions {
  clientFactory: ChainClientFactory;
  db: DatabaseClient;
  defaultStartSlot: bigint;
  safetyMargin?: number;
  pageSize?: number;
  logLevel?: "debug" | "info" | "warn" | "error";
  logger?: ReplayLogger;
  validateParse?: boolean;
  observer?: ProcessorStatusObserver;
}

export interface ProcessorStats {
  eventsProcessed: number;
  batchesCommitted: number;
  lastSlot: bigint | null;
}

// A slot change flushes only after this long, so a backfill's dense history batches across slots.
const SLOT_FLUSH_MIN_MS = 250;

class StreamBatcher {
  private currentSlot: bigint | null = null;
  private pendingEvents: unknown[] = [];
  private lastFlushTime = Date.now();
  private maxPendingCount = 1000;
  private maxPendingMs = 5000;

  addEvent(event: unknown, slot: bigint): StreamBatch | null {
    if (this.shouldFlush(slot)) {
      const batch = this.flush();
      this.currentSlot = slot;
      this.pendingEvents = [event];
      return batch;
    }

    this.currentSlot = slot;
    this.pendingEvents.push(event);
    return null;
  }

  private shouldFlush(newSlot: bigint): boolean {
    if (this.pendingEvents.length === 0) return false;
    if (
      this.currentSlot !== null &&
      newSlot !== this.currentSlot &&
      Date.now() - this.lastFlushTime >= SLOT_FLUSH_MIN_MS
    ) {
      return true;
    }
    if (this.pendingEvents.length >= this.maxPendingCount) return true;
    if (Date.now() - this.lastFlushTime >= this.maxPendingMs) return true;
    return false;
  }

  flush(): StreamBatch | null {
    if (this.pendingEvents.length === 0 || this.currentSlot === null) {
      return null;
    }
    const batch = {
      slot: this.currentSlot,
      events: this.pendingEvents,
    };
    this.pendingEvents = [];
    this.lastFlushTime = Date.now();
    return batch;
  }

  getPendingCount(): number {
    return this.pendingEvents.length;
  }

  flushIfStale(): StreamBatch | null {
    if (
      this.pendingEvents.length > 0 &&
      Date.now() - this.lastFlushTime >= this.maxPendingMs
    ) {
      return this.flush();
    }
    return null;
  }
}

export async function runEventStreamProcessor(
  stream: EventStream,
  options: ProcessorOptions,
  abortSignal?: AbortSignal
): Promise<ProcessorStats> {
  const {
    clientFactory,
    db,
    defaultStartSlot,
    safetyMargin = 64,
    pageSize = 512,
    logLevel = "info",
    logger: baseLogger,
    validateParse = false,
    observer,
  } = options;

  const logger = createScopedLogger({
    logger: baseLogger,
    level: logLevel,
    prefix: stream.name,
    bindings: {
      component: "indexer-stream",
      stream: stream.name,
      kind: "event",
    },
  });
  const log = (
    level: "debug" | "info" | "warn" | "error",
    msg: string,
    meta?: Record<string, unknown>
  ) => logger[level](msg, meta);

  log("info", `Starting stream processor: ${stream.description}`);

  const checkpoint = await getCheckpoint(db, stream.name);
  const startSlot = checkpoint ? checkpoint.slot : defaultStartSlot;
  observer?.onStart?.({
    startSlot,
    checkpointSlot: checkpoint?.slot ?? null,
  });

  log(
    "info",
    `Starting from slot ${startSlot}${checkpoint ? " (resuming)" : " (fresh start)"}`
  );

  const replay = createEventReplay({
    clientFactory,
    /* Parallel history backfill; see BACKFILL_CONNECTIONS in accounts/processor.ts. */
    historyConnections: 16,
    startSlot,
    resumeAfter: checkpoint?.eventId
      ? { slot: checkpoint.slot, eventId: checkpoint.eventId }
      : undefined,
    safetyMargin: BigInt(safetyMargin),
    pageSize,
    filter: stream.getFilter(),
    logger,
    resubscribeOnEnd: true,
    signal: abortSignal,
  });

  const batcher = new StreamBatcher();
  const stats: ProcessorStats = {
    eventsProcessed: 0,
    batchesCommitted: 0,
    lastSlot: null,
  };

  let lastLogTime = Date.now();
  let eventsReceivedSinceLastLog = 0;

  let phaseActive = false;
  const observePhase: NonNullable<ProcessorStatusObserver["onPhase"]> = (info) => {
    if (info.phase === null && !phaseActive) return;
    phaseActive = info.phase !== null;
    observer?.onPhase?.(info);
  };

  const commitBatch = async (batch: StreamBatch): Promise<void> => {
    try {
      await commitBatchPhases(batch);
    } finally {
      observePhase({ phase: null });
    }
  };

  const commitBatchPhases = async (batch: StreamBatch): Promise<void> => {
    const lastSeenEvent = (batch.events as Record<string, unknown>[])[
      batch.events.length - 1
    ] as { id?: string } | undefined;
    const lastSeenEventId = lastSeenEvent?.id ?? null;
    let eventsToCommit = batch.events as Record<string, unknown>[];

    if (stream.filterBatch) {
      observePhase({ phase: "filterBatch", slot: batch.slot });
      try {
        eventsToCommit = (await stream.filterBatch(
          eventsToCommit as any,
          { db }
        )) as any;
        if (eventsToCommit.length === 0) {
          log(
            "debug",
            `All ${batch.events.length} events filtered out at slot ${batch.slot}`
          );
          await updateCheckpoint(db, stream.name, batch.slot, lastSeenEventId);
          stats.lastSlot = batch.slot;
          observer?.onCheckpoint?.({ slot: batch.slot });
          return;
        }
        if (eventsToCommit.length < batch.events.length) {
          log(
            "debug",
            `Filtered ${batch.events.length - eventsToCommit.length} of ${batch.events.length} events at slot ${batch.slot}`
          );
        }
      } catch (filterErr) {
        observer?.onError?.("filterBatch", filterErr);
        log(
          "error",
          `filterBatch hook failed: ${filterErr instanceof Error ? filterErr.message : String(filterErr)}`
        );
        throw filterErr;
      }
    }

    const lastEventToCommit = eventsToCommit[eventsToCommit.length - 1] as
      | { id?: string }
      | undefined;
    const lastEventToCommitId = lastEventToCommit?.id ?? null;
    let committedEvents = eventsToCommit;
    let insertedCount = 0;
    observePhase({ phase: "commit", slot: batch.slot });
    try {
      await db.transaction(async (tx) => {
        /* Only onCommit reads the written rows; otherwise the count is enough. */
        const written = await bulkInsert(tx, stream.table as PgTable, eventsToCommit, { kind: "nothing" }, stream.onCommit ? "all" : []);
        committedEvents = written.rows;
        insertedCount = written.count;

        await updateCheckpoint(
          tx as unknown as DatabaseClient,
          stream.name,
          batch.slot,
          lastEventToCommitId
        );
      });
    } catch (commitErr) {
      observer?.onError?.("commit", commitErr);
      throw commitErr;
    } finally { observePhase({ phase: null }); }

    stats.batchesCommitted++;
    stats.lastSlot = batch.slot;
    observer?.onBatchCommitted?.({
      slot: batch.slot,
      count: eventsToCommit.length,
      insertedCount,
    });
    observer?.onCheckpoint?.({ slot: batch.slot });

    if (stream.onCommit && insertedCount > 0) {
      try {
        await stream.onCommit({ ...batch, events: committedEvents }, { db });
      } catch (hookErr) {
        observer?.onError?.("onCommit", hookErr);
        log(
          "error",
          `onCommit hook failed: ${hookErr instanceof Error ? hookErr.message : String(hookErr)}`
        );
      }
    }
  };

  let commitTail: Promise<void> = Promise.resolve();
  const commitInOrder = (batch: StreamBatch): Promise<void> => {
    const run = commitTail.then(() => commitBatch(batch));
    commitTail = run;
    return run;
  };

  let rejectFlushFailure: (error: unknown) => void = () => {};
  const flushFailure = new Promise<never>((_, reject) => {
    rejectFlushFailure = reject;
  });

  const flushInterval = setInterval(async () => {
    const batch = batcher.flushIfStale();
    if (batch) {
      try {
        await commitInOrder(batch);
        log(
          "debug",
          `Timeout flush: ${batch.events.length} event(s) at slot ${batch.slot}`
        );
      } catch (err) {
        log(
          "error",
          `Timeout flush failed: ${err instanceof Error ? err.message : String(err)}`
        );
        clearInterval(flushInterval);
        rejectFlushFailure(err);
      }
    }
  }, 1000);

  let inFlightCommit: Promise<void> = Promise.resolve();
  const processReplay = async () => {
    for await (const event of replay) {
      if (abortSignal?.aborted) {
        log("info", "Abort signal received, stopping...");
        break;
      }

      eventsReceivedSinceLastLog++;
      observer?.onRecord?.({
        slot: event.slot ?? null,
        id: event.eventId ?? null,
      });

      let parsed: Record<string, unknown> | null;
      try {
        parsed = stream.parse(event) as Record<string, unknown> | null;
      } catch (parseErr) {
        observer?.onParserError?.(parseErr);
        observer?.onError?.("parse", parseErr);
        throw parseErr;
      }
      if (!parsed) {
        observer?.onParserNull?.();
        continue;
      }

      if (validateParse) {
        const validation = validateParsedData(stream.schema, parsed, stream.name);
        if (!validation.success) {
          observer?.onParseValidationError?.(validation.error);
          log("error", validation.error);
          continue;
        }
      }

      stats.eventsProcessed++;

      const batch = batcher.addEvent(parsed, event.slot!);
      if (batch) {
        /* Queue this batch before waiting, so a timer flush of newer events
           cannot commit ahead of it. One commit stays in flight while the next batch fills. */
        const previousCommit = inFlightCommit;
        const total = stats.eventsProcessed;
        inFlightCommit = commitInOrder(batch).then(() =>
          log("info", `Committed ${batch.events.length} event(s) at slot ${batch.slot} (total: ${total})`)
        );
        inFlightCommit.catch(() => {});
        await previousCommit;
      }

      const now = Date.now();
      if (now - lastLogTime >= 30000) {
        log(
          "info",
          `Heartbeat: ${eventsReceivedSinceLastLog} events received, ${batcher.getPendingCount()} pending`
        );
        eventsReceivedSinceLastLog = 0;
        lastLogTime = now;
      }
    }

    const finalBatch = batcher.flush();
    if (finalBatch) {
      await commitInOrder(finalBatch);
      log(
        "info",
        `Final flush: ${finalBatch.events.length} event(s) at slot ${finalBatch.slot}`
      );
    }
  };

  try {
    await Promise.race([processReplay(), flushFailure]);
  } catch (err) {
    log(
      "error",
      `Stream error: ${err instanceof Error ? err.message : String(err)}`
    );
    throw err;
  } finally {
    clearInterval(flushInterval);
    rejectFlushFailure = () => {};
    await commitTail.catch(() => {});
  }

  await commitTail.catch((err) => {
    log(
      "error",
      `Stream error: ${err instanceof Error ? err.message : String(err)}`
    );
    throw err;
  });

  log(
    "info",
    `Stream stopped. Processed ${stats.eventsProcessed} events in ${stats.batchesCommitted} batches.`
  );
  return stats;
}
