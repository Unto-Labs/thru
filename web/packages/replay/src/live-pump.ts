import { AsyncQueue } from "./async-queue";
import { DedupBuffer } from "./dedup-buffer";
import { NOOP_LOGGER } from "./logger";
import type { ReplayLogger, Slot } from "./types";

type PumpMode = "buffering" | "streaming";

export class LivePump<T> {
  private readonly queue = new AsyncQueue<T>();
  private readonly buffer: DedupBuffer<T>;
  private readonly slotOf: (item: T) => Slot;
  private readonly keyOf: (item: T) => string;
  private readonly sourceIterator: AsyncIterator<T>;
  private readonly logger: ReplayLogger;
  private mode: PumpMode;
  private minSlotSeen: Slot | null = null;
  private maxSlotSeen: Slot | null = null;
  private minEmitSlot: Slot | null = null;
  private pumpPromise: Promise<void>;
  private closing = false;

  constructor(options: {
    source: AsyncIterable<T>;
    slotOf: (item: T) => Slot;
    keyOf?: (item: T) => string;
    logger?: ReplayLogger;
    startInStreamingMode?: boolean;
    initialEmitFloor?: Slot;
  }) {
    this.sourceIterator = options.source[Symbol.asyncIterator]();
    this.slotOf = options.slotOf;
    this.keyOf = options.keyOf ?? ((item) => options.slotOf(item).toString());
    this.logger = options.logger ?? NOOP_LOGGER;
    this.buffer = new DedupBuffer({ slotOf: this.slotOf, keyOf: this.keyOf });
    this.mode = options.startInStreamingMode ? "streaming" : "buffering";
    if (options.startInStreamingMode) this.minEmitSlot = options.initialEmitFloor ?? 0n;
    this.pumpPromise = this.start();
  }

  minSlot(): Slot | null {
    if (this.minSlotSeen !== null) return this.minSlotSeen;
    return this.buffer.minSlot();
  }

  maxSlot(): Slot | null {
    return this.maxSlotSeen;
  }

  bufferedSize(): number {
    return this.buffer.size;
  }

  discardBufferedUpTo(cutoffSlot: Slot): number {
    if (this.mode === "streaming") return 0;
    const discarded = this.buffer.discardUpTo(cutoffSlot);
    if (discarded) {
      this.logger.debug(
        `discarded ${discarded} buffered items up to cutoff slot ${cutoffSlot}`
      );
    }
    return discarded;
  }

  enableStreaming(cutoffSlot: Slot): { drained: T[]; discarded: number } {
    if (this.mode === "streaming") return { drained: [], discarded: 0 };
    const discarded = this.discardBufferedUpTo(cutoffSlot);
    const drained = this.buffer.drainAbove(cutoffSlot);
    this.mode = "streaming";
    this.minEmitSlot = cutoffSlot;
    return { drained, discarded };
  }

  updateEmitFloor(slot: Slot): void {
    this.minEmitSlot = slot;
  }

  async next(): Promise<IteratorResult<T>> {
    return this.queue.next();
  }

  async close(): Promise<void> {
    this.closing = true;
    this.queue.close();
    await Promise.allSettled([
      this.closeSourceIterator(),
      this.pumpPromise,
    ]);
  }

  private async start(): Promise<void> {
    try {
      while (!this.closing) {
        const next = await this.sourceIterator.next();
        if (next.done || this.closing) break;

        const item = next.value;
        const slot = this.slotOf(item);
        if (this.minSlotSeen === null || slot < this.minSlotSeen) this.minSlotSeen = slot;
        if (this.maxSlotSeen === null || slot > this.maxSlotSeen) this.maxSlotSeen = slot;
        if (this.mode === "buffering") this.buffer.insert(item);
        else {
          if (this.minEmitSlot !== null && slot < this.minEmitSlot) continue;
          this.queue.push(item);
        }
      }
    } catch (err) {
      // Don't log here - let the consumer (ReplayStream) handle logging
      // since it knows whether a retry will happen
      if (!this.closing) {
        this.queue.fail(err);
      }
    } finally {
      this.queue.close();
    }
  }

  private async closeSourceIterator(): Promise<void> {
    if (typeof this.sourceIterator.return !== "function") {
      return;
    }

    try {
      await this.sourceIterator.return();
    } catch {
      /* best-effort */
    }
  }
}
