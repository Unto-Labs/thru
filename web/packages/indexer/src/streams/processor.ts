/**
 * Event stream processor.
 *
 * Processes events from @thru/replay and commits them to the database
 * with batching and checkpointing.
 */

import type { ChainClientFactory } from "@thru/replay";
import { createEventReplay, createConsoleLogger } from "@thru/replay";
import type { PgTable } from "drizzle-orm/pg-core";
import type { DatabaseClient } from "../schema/types";
import { validateParsedData } from "../schema/validation";
import { getCheckpoint, updateCheckpoint } from "../checkpoint";
import type { EventStream } from "./types";
import type { StreamBatch } from "../types";

// ============================================================
// Types
// ============================================================

export interface ProcessorOptions {
  /** Factory to create fresh chain clients for reconnection */
  clientFactory: ChainClientFactory;
  /** Database client */
  db: DatabaseClient;
  /** Start slot if no checkpoint exists */
  defaultStartSlot: bigint;
  /** Safety margin for finality (in slots) */
  safetyMargin?: number;
  /** Page size for fetching events */
  pageSize?: number;
  /** Log level */
  logLevel?: "debug" | "info" | "warn" | "error";
  /** Validate parse output with Zod (useful for development) */
  validateParse?: boolean;
}

export interface ProcessorStats {
  /** Total events processed */
  eventsProcessed: number;
  /** Total batches committed */
  batchesCommitted: number;
  /** Last slot processed */
  lastSlot: bigint | null;
}

// ============================================================
// Batcher
// ============================================================

/**
 * Generic batcher that collects events by slot and flushes on slot change
 * or when thresholds are reached.
 */
class StreamBatcher {
  private currentSlot: bigint | null = null;
  private pendingEvents: unknown[] = [];
  private lastFlushTime = Date.now();
  private maxPendingCount = 100;
  private maxPendingMs = 5000;

  addEvent(event: unknown, slot: bigint): StreamBatch | null {
    // If slot changed or thresholds reached, flush pending
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
    if (this.currentSlot !== null && newSlot !== this.currentSlot) return true;
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

  /**
   * Flush if the timeout has elapsed since last flush.
   * Called by background timer to ensure events don't sit in buffer indefinitely.
   */
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

// ============================================================
// Processor
// ============================================================

/**
 * Run an event stream processor.
 *
 * Fetches events from the chain using @thru/replay, parses them,
 * batches by slot, and commits to the database with checkpointing.
 *
 * @param stream - The event stream to process
 * @param options - Processor configuration
 * @param abortSignal - Optional signal to stop processing
 * @returns Processor statistics
 */
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
    validateParse = false,
  } = options;

  const log = (level: string, msg: string) => {
    if (logLevel === "debug" || level !== "debug") {
      console.log(`[${stream.name}] ${msg}`);
    }
  };

  log("info", `Starting stream processor: ${stream.description}`);

  // Get checkpoint for this stream
  const checkpoint = await getCheckpoint(db, stream.name);
  const startSlot = checkpoint ? checkpoint.slot + 1n : defaultStartSlot;

  log(
    "info",
    `Starting from slot ${startSlot}${checkpoint ? " (resuming)" : " (fresh start)"}`
  );

  // Create logger
  const logger =
    logLevel === "debug"
      ? createConsoleLogger(stream.name)
      : {
          debug: () => {},
          info: (msg: string) => log("info", msg),
          warn: (msg: string) => log("warn", msg),
          error: (msg: string) => log("error", msg),
        };

  // Create replay stream with factory for robust reconnection
  const replay = createEventReplay({
    clientFactory,
    startSlot,
    safetyMargin: BigInt(safetyMargin),
    pageSize,
    filter: stream.getFilter(),
    logger,
    resubscribeOnEnd: true,
  });

  const batcher = new StreamBatcher();
  const stats: ProcessorStats = {
    eventsProcessed: 0,
    batchesCommitted: 0,
    lastSlot: null,
  };

  let lastLogTime = Date.now();
  let eventsReceivedSinceLastLog = 0;

  // Commit a batch to the database
  const commitBatch = async (batch: StreamBatch): Promise<void> => {
    let eventsToCommit = batch.events as Record<string, unknown>[];

    // Apply filterBatch hook if defined
    if (stream.filterBatch) {
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
          return;
        }
        if (eventsToCommit.length < batch.events.length) {
          log(
            "debug",
            `Filtered ${batch.events.length - eventsToCommit.length} of ${batch.events.length} events at slot ${batch.slot}`
          );
        }
      } catch (filterErr) {
        log(
          "error",
          `filterBatch hook failed: ${filterErr instanceof Error ? filterErr.message : String(filterErr)}`
        );
        // On filter error, skip the batch
        return;
      }
    }

    await db.transaction(async (tx) => {
      // Insert events (skip duplicates)
      await tx
        .insert(stream.table as PgTable)
        .values(eventsToCommit)
        .onConflictDoNothing();

      // Update checkpoint
      const lastEvent = eventsToCommit[eventsToCommit.length - 1] as {
        id: string;
      };
      await updateCheckpoint(
        tx as unknown as DatabaseClient,
        stream.name,
        batch.slot,
        lastEvent.id
      );
    });

    stats.batchesCommitted++;
    stats.lastSlot = batch.slot;

    // Call onCommit hook if defined
    if (stream.onCommit) {
      try {
        await stream.onCommit({ ...batch, events: eventsToCommit }, { db });
      } catch (hookErr) {
        log(
          "error",
          `onCommit hook failed: ${hookErr instanceof Error ? hookErr.message : String(hookErr)}`
        );
        // Don't rethrow - hooks should not block indexing
      }
    }
  };

  // Background timer to flush pending events that exceed the timeout
  const flushInterval = setInterval(async () => {
    const batch = batcher.flushIfStale();
    if (batch) {
      try {
        await commitBatch(batch);
        log(
          "debug",
          `Timeout flush: ${batch.events.length} event(s) at slot ${batch.slot}`
        );
      } catch (err) {
        log(
          "error",
          `Timeout flush failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  }, 1000);

  try {
    for await (const event of replay) {
      if (abortSignal?.aborted) {
        log("info", "Abort signal received, stopping...");
        break;
      }

      eventsReceivedSinceLastLog++;

      // Parse the event
      const parsed = stream.parse(event);
      if (!parsed) continue;

      // Validate parse output if enabled
      if (validateParse) {
        const validation = validateParsedData(stream.schema, parsed, stream.name);
        if (!validation.success) {
          log("error", validation.error);
          continue; // Skip invalid events
        }
      }

      stats.eventsProcessed++;

      // Add to batcher
      const batch = batcher.addEvent(parsed, event.slot!);
      if (batch) {
        await commitBatch(batch);
        log(
          "info",
          `Committed ${batch.events.length} event(s) at slot ${batch.slot} (total: ${stats.eventsProcessed})`
        );
      }

      // Heartbeat logging
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

    // Flush any remaining events
    const finalBatch = batcher.flush();
    if (finalBatch) {
      await commitBatch(finalBatch);
      log(
        "info",
        `Final flush: ${finalBatch.events.length} event(s) at slot ${finalBatch.slot}`
      );
    }
  } catch (err) {
    log(
      "error",
      `Stream error: ${err instanceof Error ? err.message : String(err)}`
    );
    throw err;
  } finally {
    clearInterval(flushInterval);
  }

  log(
    "info",
    `Stream stopped. Processed ${stats.eventsProcessed} events in ${stats.batchesCommitted} batches.`
  );
  return stats;
}
