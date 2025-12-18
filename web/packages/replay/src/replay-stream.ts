import { LivePump } from "./live-pump";
import { NOOP_LOGGER } from "./logger";
import type { ReplayConfig, ReplayMetrics, Slot } from "./types";

const DEFAULT_METRICS: ReplayMetrics = {
  bufferedItems: 0,
  emittedBackfill: 0,
  emittedLive: 0,
  discardedDuplicates: 0,
};

function compareBigint(a: Slot, b: Slot): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

const RETRY_DELAY_MS = 1000;

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
    } = this.config;
    const shouldResubscribeOnEnd = resubscribeOnEnd ?? true;
    const keyOf = extractKey ?? ((item: T) => extractSlot(item).toString());
    const createLivePump = (slot: Slot, startStreaming = false, emitFloor?: Slot) =>
      new LivePump<T>({
        source: subscribeLive(slot),
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

    this.logger.info("replay entering BACKFILLING state", {
      startSlot: startSlot.toString(),
      safetyMargin: safetyMargin.toString(),
    });

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
          this.logger.info("replay reached SWITCHING threshold", {
            currentSlot: currentSlot.toString(),
            maxStreamSlot: maxStreamSlot.toString(),
            catchUpSlot: catchUpSlot.toString(),
          });
          backfillDone = true;
        }
      }

      if (page.done || cursor === undefined) backfillDone = true;
    }

    this.logger.info("replay entering SWITCHING state", {
      currentSlot: currentSlot.toString(),
    });

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
    while (true) {
      try {
        const next = await livePump.next();
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
        this.logger.warn("live stream error; retrying", {
          err,
          retryDelayMs: RETRY_DELAY_MS,
          slot: currentSlot.toString(),
        });
        await delay(RETRY_DELAY_MS);
        await safeClose(livePump);
        const resumeSlot = currentSlot > 0n ? currentSlot : 0n;
        livePump = createLivePump(resumeSlot, true, currentSlot);
      }
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function safeClose<T>(pump: LivePump<T>): Promise<void> {
  try {
    await pump.close();
  } catch {
    /* ignore */
  }
}
