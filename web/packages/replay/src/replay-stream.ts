import { LivePump } from "./live-pump";
import { NOOP_LOGGER } from "./logger";
import {
  DEFAULT_RETRY_CONFIG,
  abortableDelay,
  calculateBackoff,
  isAbortError,
  withTimeout,
} from "./retry";
import type { BackfillFetcher, LiveSubscriber, ReplayConfig, ReplayMetrics, Slot } from "./types";

const DEFAULT_METRICS: ReplayMetrics = {
  bufferedItems: 0,
  emittedBackfill: 0,
  emittedLive: 0,
  emittedReconnect: 0,
  discardedDuplicates: 0,
};
const RECONNECT_STUCK_THRESHOLD_MS = 30_000;

function compareBigint(a: Slot, b: Slot): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function isNonDecreasing<T>(items: T[], extractSlot: (item: T) => Slot): boolean {
  for (let idx = 1; idx < items.length; idx += 1) {
    if (extractSlot(items[idx]) < extractSlot(items[idx - 1])) return false;
  }
  return true;
}

function assertBackfillPageOrder<T>(
  previousPage: T[] | null,
  currentPage: T[],
  extractSlot: (item: T) => Slot,
): void {
  if (!isNonDecreasing(currentPage, extractSlot)) {
    throw new Error(
      "backfill source returned a page that is not ordered by ascending slot"
    );
  }
  if (!previousPage?.length || !currentPage.length) return;

  const previousMaxSlot = extractSlot(previousPage[previousPage.length - 1]);
  const currentMinSlot = extractSlot(currentPage[0]);
  if (currentMinSlot < previousMaxSlot) {
    throw new Error(
      `backfill source returned pages out of ascending slot order: page minimum slot ${currentMinSlot} is before previous page maximum slot ${previousMaxSlot}`
    );
  }
}

export class ReplayStream<T, Cursor = unknown> implements AsyncIterable<T> {
  private readonly config: ReplayConfig<T, Cursor>;
  private readonly logger;
  private readonly metrics: ReplayMetrics = { ...DEFAULT_METRICS };

  constructor(config: ReplayConfig<T, Cursor>) {
    this.config = config;
    this.logger = config.logger ?? NOOP_LOGGER;
  }

  getMetrics(): ReplayMetrics {
    return { ...this.metrics };
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return this.run();
  }

  private async *run(): AsyncGenerator<T> {
    const {
      startSlot,
      fetchBackfill,
      subscribeLive,
      extractSlot,
      extractKey,
      safetyMargin,
      resubscribeOnEnd,
      onReconnect,
      signal,
      dispose,
    } = this.config;
    const shouldResubscribeOnEnd = resubscribeOnEnd ?? true;
    const keyOf = extractKey ?? ((item: T) => extractSlot(item).toString());
    const shouldStop = (err?: unknown): boolean => signal?.aborted === true || isAbortError(err);

    // Mutable data sources - may be replaced on reconnection with fresh client
    let currentSubscribeLive: LiveSubscriber<T> = subscribeLive;
    let currentFetchBackfill: BackfillFetcher<T, Cursor> = fetchBackfill;
    let currentDispose = dispose ?? (() => {});

    const createLivePump = (slot: Slot, startStreaming = false, emitFloor?: Slot) =>
      new LivePump<T>({
        source: currentSubscribeLive(slot),
        slotOf: extractSlot,
        keyOf,
        logger: this.logger,
        startInStreamingMode: startStreaming,
        initialEmitFloor: emitFloor,
      });
    let livePump = createLivePump(startSlot);

    let cursor: Cursor | undefined;
    let backfillDone = false;
    let currentSlot: Slot = startSlot > 0n ? startSlot - 1n : 0n;
    let lastEmittedSlot: Slot | null = null;
    let lastSlotKeys = new Set<string>();

    const seenItem = (slot: Slot, key: string): boolean => {
      if (lastEmittedSlot === null) return false;
      if (slot < lastEmittedSlot) return true;
      if (slot > lastEmittedSlot) return false;
      return lastSlotKeys.has(key);
    };

    const recordEmission = (slot: Slot, key: string): void => {
      if (lastEmittedSlot === null || slot !== lastEmittedSlot) {
        lastEmittedSlot = slot;
        lastSlotKeys = new Set([key]);
      } else {
        lastSlotKeys.add(key);
      }
    };

    this.logger.info(
      `replay entering BACKFILLING state (startSlot=${startSlot}, safetyMargin=${safetyMargin})`
    );

    let pendingOrderedPage: T[] | null = null;

    const emitBackfillItems = async function* (
      self: ReplayStream<T, Cursor>,
      items: T[],
    ): AsyncGenerator<T> {
      for (const item of items) {
        const slot = extractSlot(item);
        const key = keyOf(item);
        if (slot < startSlot) continue;
        if (seenItem(slot, key)) {
          self.metrics.discardedDuplicates += 1;
          continue;
        }
        currentSlot = slot;
        recordEmission(slot, key);
        self.metrics.emittedBackfill += 1;
        yield item;
      }
    };
    const flushPendingBackfill = async function* (
      self: ReplayStream<T, Cursor>,
    ): AsyncGenerator<T> {
      if (!pendingOrderedPage) return;
      for await (const item of emitBackfillItems(self, pendingOrderedPage)) {
        yield item;
      }
      pendingOrderedPage = null;
    };

    let emptyPageRetries = 0;
    const MAX_EMPTY_PAGE_RETRIES = 10;

    try {
      while (!backfillDone) {
        if (shouldStop()) return;

        let page;
        try {
          page = await currentFetchBackfill({ startSlot, cursor });
        } catch (err) {
          if (shouldStop(err)) return;
          throw err;
        }

        if (!page.items.length && !page.cursor && !page.done) {
          emptyPageRetries++;
          if (emptyPageRetries > MAX_EMPTY_PAGE_RETRIES) {
            this.logger.error(
              `backfill returned ${MAX_EMPTY_PAGE_RETRIES} consecutive empty pages; treating as done`
            );
            for await (const item of flushPendingBackfill(this)) {
              yield item;
            }
            break;
          }
          const backoffMs = calculateBackoff(emptyPageRetries - 1, DEFAULT_RETRY_CONFIG);
          this.logger.warn(
            `empty backfill page without cursor; retrying in ${backoffMs}ms (${emptyPageRetries}/${MAX_EMPTY_PAGE_RETRIES})`
          );
          await abortableDelay(backoffMs, signal);
          continue;
        }
        emptyPageRetries = 0;

        assertBackfillPageOrder(pendingOrderedPage, page.items, extractSlot);
        if (pendingOrderedPage !== null) {
          for await (const item of flushPendingBackfill(this)) {
            if (shouldStop()) return;
            yield item;
          }
        }
        pendingOrderedPage = [...page.items];

        const reachedEnd = page.done || page.cursor === undefined;
        if (reachedEnd) {
          for await (const item of flushPendingBackfill(this)) {
            if (shouldStop()) return;
            yield item;
          }
        }

        const duplicatesTrimmed = livePump.discardBufferedUpTo(currentSlot);
        this.metrics.discardedDuplicates += duplicatesTrimmed;

        cursor = page.cursor;

        const maxStreamSlot = livePump.maxSlot();
        if (maxStreamSlot !== null) {
          const catchUpSlot =
            maxStreamSlot > safetyMargin ? (maxStreamSlot - safetyMargin) : 0n;
          if (currentSlot >= catchUpSlot) {
            for await (const item of flushPendingBackfill(this)) {
              if (shouldStop()) return;
              yield item;
            }
            this.logger.info(
              `replay reached SWITCHING threshold (currentSlot=${currentSlot}, maxStreamSlot=${maxStreamSlot}, catchUpSlot=${catchUpSlot})`
            );
            backfillDone = true;
          }
        }

        if (reachedEnd) backfillDone = true;
      }

      if (shouldStop()) return;

      this.logger.info(`replay entering SWITCHING state (currentSlot=${currentSlot})`);

      const { drained, discarded } = livePump.enableStreaming(currentSlot);
      this.metrics.bufferedItems = drained.length;
      this.metrics.discardedDuplicates += discarded;

      for (const item of drained) {
        if (shouldStop()) return;

        const slot = extractSlot(item);
        const key = keyOf(item);
        if (seenItem(slot, key)) {
          this.metrics.discardedDuplicates += 1;
          continue;
        }
        currentSlot = slot;
        recordEmission(slot, key);
        this.metrics.emittedLive += 1;
        yield item;
        livePump.updateEmitFloor(currentSlot);
      }
      if (!drained.length) livePump.updateEmitFloor(currentSlot);

      this.logger.info("replay entering STREAMING state");
      const retryConfig = DEFAULT_RETRY_CONFIG;
      let retryAttempt = 0;
      let waitingFirstReconnectEvent: {
        startedAtMs: number;
        attempt: number;
        resumeSlot: Slot;
      } | null = null;
      while (true) {
        if (shouldStop()) return;

        try {
          const next = await withTimeout(
            livePump.next(),
            retryConfig.connectionTimeoutMs
          );
          retryAttempt = 0;
          if (next.done) {
            if (shouldStop()) return;
            if (!shouldResubscribeOnEnd) break;
            throw new Error("stream ended");
          }
          const slot = extractSlot(next.value);
          if (waitingFirstReconnectEvent) {
            this.logger.info("Replay stream reconnect completed", {
              event: "replay.stream.reconnect.completed",
              attempt: waitingFirstReconnectEvent.attempt,
              resume_slot: waitingFirstReconnectEvent.resumeSlot.toString(),
              first_event_slot: slot.toString(),
              duration_ms: Date.now() - waitingFirstReconnectEvent.startedAtMs,
            });
            waitingFirstReconnectEvent = null;
          }
          const key = keyOf(next.value);
          if (seenItem(slot, key)) {
            this.metrics.discardedDuplicates += 1;
            continue;
          }
          currentSlot = slot;
          recordEmission(slot, key);
          this.metrics.emittedLive += 1;
          yield next.value;
          livePump.updateEmitFloor(currentSlot);
        } catch (err) {
          if (shouldStop(err)) return;

          const errMsg = err instanceof Error ? err.message : String(err);
          const backoffMs = calculateBackoff(retryAttempt, retryConfig);
          const attempt = retryAttempt + 1;
          const reconnectStartedAtMs = Date.now();
          this.logger.warn("Replay stream reconnect started", {
            event: "replay.stream.reconnect.started",
            reason: errMsg === "stream ended" ? "stream_ended" : "stream_error",
            error: errMsg,
            backoff_ms: backoffMs,
            attempt,
            current_slot: currentSlot.toString(),
          });
          await abortableDelay(backoffMs, signal);
          if (shouldStop()) return;

          const cleanupStartedAtMs = Date.now();
          this.logger.info("Replay stream reconnect cleanup started", {
            event: "replay.stream.reconnect.cleanup_started",
            phase: "live_pump_close",
            attempt,
            current_slot: currentSlot.toString(),
          });
          currentDispose();
          const closeResult = await safeClose(livePump, signal);
          const cleanupDurationMs = Date.now() - cleanupStartedAtMs;
          if (closeResult === "timed-out") {
            this.logger.warn("Replay stream reconnect cleanup stuck", {
              event: "replay.stream.reconnect.stuck",
              phase: "live_pump_close",
              attempt,
              duration_ms: cleanupDurationMs,
              timeout_ms: RECONNECT_STUCK_THRESHOLD_MS,
            });
          }
          this.logger.info("Replay stream reconnect cleanup completed", {
            event: "replay.stream.reconnect.cleanup_completed",
            phase: "live_pump_close",
            attempt,
            duration_ms: cleanupDurationMs,
            result: closeResult,
          });
          if (shouldStop()) return;
          retryAttempt++;

          if (onReconnect) {
            try {
              const fresh = onReconnect();
              currentSubscribeLive = fresh.subscribeLive;
              if (fresh.fetchBackfill) {
                currentFetchBackfill = fresh.fetchBackfill;
              }
              currentDispose = fresh.dispose ?? (() => {});
              this.logger.info("Replay stream fresh reconnect sources created", {
                event: "replay.stream.reconnect.sources_created",
                attempt,
              });
            } catch (factoryErr) {
              this.logger.error("Replay stream fresh reconnect sources failed", {
                event: "replay.stream.reconnect.sources_failed",
                attempt,
                error: factoryErr,
              });
            }
          }

          if (onReconnect && currentSlot > 0n) {
            for await (const item of this.miniBackfill(
              currentSlot,
              currentFetchBackfill,
              extractSlot,
              keyOf,
              seenItem,
              recordEmission,
              signal,
            )) {
              if (shouldStop()) return;

              const itemSlot = extractSlot(item);
              if (itemSlot > currentSlot) {
                currentSlot = itemSlot;
              }
              yield item;
            }
          }

          const resumeSlot = currentSlot > 0n ? currentSlot : 0n;
          livePump = createLivePump(resumeSlot, true, currentSlot);
          waitingFirstReconnectEvent = {
            startedAtMs: reconnectStartedAtMs,
            attempt,
            resumeSlot,
          };
          this.logger.info("Replay stream waiting for first event", {
            event: "replay.stream.waiting_first_event",
            attempt,
            resume_slot: resumeSlot.toString(),
          });
        }
      }
    } finally {
      currentDispose();
      await safeClose(livePump, signal);
    }
  }

  /**
   * Perform mini-backfill from lastProcessedSlot to catch up after reconnection.
   * Ensures no data gaps from events that occurred during disconnection.
   */
  private async *miniBackfill(
    fromSlot: Slot,
    fetchBackfill: BackfillFetcher<T, Cursor>,
    extractSlot: (item: T) => Slot,
    keyOf: (item: T) => string,
    seenItem: (slot: Slot, key: string) => boolean,
    recordEmission: (slot: Slot, key: string) => void,
    signal?: AbortSignal,
  ): AsyncGenerator<T> {
    this.logger.info(`mini-backfill starting from slot ${fromSlot}`);
    const MINI_BACKFILL_TIMEOUT = 30000; // 30 seconds max
    let lastProgressTime = Date.now();

    let cursor: Cursor | undefined;
    let itemsYielded = 0;

    try {
      while (true) {
        if (signal?.aborted) return;
        if (Date.now() - lastProgressTime > MINI_BACKFILL_TIMEOUT) {
          this.logger.warn(`mini-backfill timed out after ${MINI_BACKFILL_TIMEOUT}ms with no progress`);
          break;
        }

        const page = await fetchBackfill({ startSlot: fromSlot, cursor });

        const sorted = [...page.items].sort((a, b) =>
          compareBigint(extractSlot(a), extractSlot(b))
        );

        let pageYielded = 0;
        for (const item of sorted) {
          if (signal?.aborted) return;
          const slot = extractSlot(item);
          const key = keyOf(item);
          if (seenItem(slot, key)) {
            this.metrics.discardedDuplicates += 1;
            continue;
          }
          recordEmission(slot, key);
          itemsYielded++;
          pageYielded++;
          this.metrics.emittedReconnect += 1;
          yield item;
        }
        if (pageYielded > 0) lastProgressTime = Date.now();

        cursor = page.cursor;
        if (page.done || cursor === undefined) break;
      }

      this.logger.info(`mini-backfill complete: ${itemsYielded} items yielded`);
    } catch (err) {
      if (signal?.aborted || isAbortError(err)) {
        return;
      }
      this.logger.warn(
        `mini-backfill failed: ${err instanceof Error ? err.message : String(err)}; proceeding with live stream`
      );
    }
  }
}

async function safeClose<T>(
  pump: LivePump<T>,
  signal?: AbortSignal
): Promise<"closed" | "timed-out" | "aborted"> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    if (signal?.aborted) {
      return "aborted";
    }

    const timeout = new Promise<"timeout">((resolve) => {
      timeoutId = setTimeout(() => resolve("timeout"), RECONNECT_STUCK_THRESHOLD_MS);
    });
    const abort = signal
      ? new Promise<"aborted">((resolve) => {
          onAbort = () => resolve("aborted");
          signal.addEventListener("abort", onAbort, { once: true });
        })
      : null;

    const close = pump.close().then<"closed", "closed">(
      () => "closed",
      () => "closed"
    );
    const result = await Promise.race([
      close,
      timeout,
      ...(abort ? [abort] : []),
    ]);
    if (result === "aborted") {
      return "aborted";
    }
    if (result === "timeout") {
      // pump.close() is still pending — the underlying gRPC stream may leak
      // until garbage collected. This is expected for stale connections.
      return "timed-out";
    }
  } catch {
    /* ignore close errors */
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
    if (signal && onAbort) {
      signal.removeEventListener("abort", onAbort);
    }
  }
  return "closed";
}
