import { LivePump } from "./live-pump";
import { NOOP_LOGGER } from "./logger";
import {
  DEFAULT_RETRY_CONFIG,
  calculateBackoff,
  withTimeout,
  delay,
  type RetryConfig,
} from "./retry";
import type { BackfillFetcher, LiveSubscriber, ReplayConfig, ReplayMetrics, Slot } from "./types";

const DEFAULT_METRICS: ReplayMetrics = {
  bufferedItems: 0,
  emittedBackfill: 0,
  emittedLive: 0,
  emittedReconnect: 0,
  discardedDuplicates: 0,
};

function compareBigint(a: Slot, b: Slot): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
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
    } = this.config;
    const shouldResubscribeOnEnd = resubscribeOnEnd ?? true;
    const keyOf = extractKey ?? ((item: T) => extractSlot(item).toString());

    // Mutable data sources - may be replaced on reconnection with fresh client
    let currentSubscribeLive: LiveSubscriber<T> = subscribeLive;
    let currentFetchBackfill: BackfillFetcher<T, Cursor> = fetchBackfill;

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

    while (!backfillDone) {
      const page = await fetchBackfill({ startSlot, cursor });
      if (!page.items.length && !page.cursor && !page.done) {
        // Nothing returned but not marked done: continue to avoid tight loops
        this.logger.warn("empty backfill page without cursor; retrying");
        continue;
      }

      const sorted = [...page.items].sort((a, b) =>
        compareBigint(extractSlot(a), extractSlot(b)),
      );

      for (const item of sorted) {
        const slot = extractSlot(item);
        const key = keyOf(item);
        if (slot < startSlot) continue;
        if (seenItem(slot, key)) {
          this.metrics.discardedDuplicates += 1;
          continue;
        }
        currentSlot = slot;
        recordEmission(slot, key);
        this.metrics.emittedBackfill += 1;
        yield item;
      }

      const duplicatesTrimmed = livePump.discardBufferedUpTo(currentSlot);
      this.metrics.discardedDuplicates += duplicatesTrimmed;

      cursor = page.cursor;

      const maxStreamSlot = livePump.maxSlot();
      if (maxStreamSlot !== null) {
        const catchUpSlot =
          maxStreamSlot > safetyMargin ? (maxStreamSlot - safetyMargin) : 0n;
        if (currentSlot >= catchUpSlot) {
          this.logger.info(
            `replay reached SWITCHING threshold (currentSlot=${currentSlot}, maxStreamSlot=${maxStreamSlot}, catchUpSlot=${catchUpSlot})`
          );
          backfillDone = true;
        }
      }

      if (page.done || cursor === undefined) backfillDone = true;
    }

    this.logger.info(`replay entering SWITCHING state (currentSlot=${currentSlot})`);

    const { drained, discarded } = livePump.enableStreaming(currentSlot);
    this.metrics.bufferedItems = drained.length;
    this.metrics.discardedDuplicates += discarded;

    for (const item of drained) {
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
    while (true) {
      try {
        // Add timeout to detect hung streams
        const next = await withTimeout(
          livePump.next(),
          retryConfig.connectionTimeoutMs
        );
        retryAttempt = 0; // Reset on successful message
        if (next.done) {
          if (!shouldResubscribeOnEnd) break;
          throw new Error("stream ended");
        }
        const slot = extractSlot(next.value);
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
        const errMsg = err instanceof Error ? err.message : String(err);
        const backoffMs = calculateBackoff(retryAttempt, retryConfig);
        this.logger.warn(
          `live stream disconnected (${errMsg}); reconnecting in ${backoffMs}ms from slot ${currentSlot} (attempt ${retryAttempt + 1})`
        );
        await delay(backoffMs);
        await safeClose(livePump);
        retryAttempt++;

        // Get fresh data sources from new client if factory provided
        if (onReconnect) {
          try {
            const fresh = onReconnect();
            currentSubscribeLive = fresh.subscribeLive;
            if (fresh.fetchBackfill) {
              currentFetchBackfill = fresh.fetchBackfill;
            }
            this.logger.info("created fresh client for reconnection");
          } catch (factoryErr) {
            this.logger.error(
              `failed to create fresh client: ${factoryErr instanceof Error ? factoryErr.message : String(factoryErr)}; using existing`
            );
          }
        }

        // Mini-backfill to catch any missed events during disconnection
        if (onReconnect && currentSlot > 0n) {
          for await (const item of this.miniBackfill(
            currentSlot,
            currentFetchBackfill,
            extractSlot,
            keyOf,
            seenItem,
            recordEmission
          )) {
            // Update currentSlot as we yield items to prevent gaps
            const itemSlot = extractSlot(item);
            if (itemSlot > currentSlot) {
              currentSlot = itemSlot;
            }
            yield item;
          }
        }

        const resumeSlot = currentSlot > 0n ? currentSlot : 0n;
        livePump = createLivePump(resumeSlot, true, currentSlot);
      }
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
    recordEmission: (slot: Slot, key: string) => void
  ): AsyncGenerator<T> {
    this.logger.info(`mini-backfill starting from slot ${fromSlot}`);
    const MINI_BACKFILL_TIMEOUT = 30000; // 30 seconds max
    const startTime = Date.now();

    let cursor: Cursor | undefined;
    let itemsYielded = 0;

    try {
      while (true) {
        if (Date.now() - startTime > MINI_BACKFILL_TIMEOUT) {
          this.logger.warn(`mini-backfill timed out after ${MINI_BACKFILL_TIMEOUT}ms`);
          break;
        }

        const page = await fetchBackfill({ startSlot: fromSlot, cursor });

        const sorted = [...page.items].sort((a, b) =>
          compareBigint(extractSlot(a), extractSlot(b))
        );

        for (const item of sorted) {
          const slot = extractSlot(item);
          const key = keyOf(item);
          if (seenItem(slot, key)) {
            this.metrics.discardedDuplicates += 1;
            continue;
          }
          recordEmission(slot, key);
          itemsYielded++;
          this.metrics.emittedReconnect += 1;
          yield item;
        }

        cursor = page.cursor;
        if (page.done || cursor === undefined) break;
      }

      this.logger.info(`mini-backfill complete: ${itemsYielded} items yielded`);
    } catch (err) {
      this.logger.warn(
        `mini-backfill failed: ${err instanceof Error ? err.message : String(err)}; proceeding with live stream`
      );
    }
  }
}

async function safeClose<T>(pump: LivePump<T>): Promise<void> {
  try {
    await pump.close();
  } catch {
    /* ignore */
  }
}
