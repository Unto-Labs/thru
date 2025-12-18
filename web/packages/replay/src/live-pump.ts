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
  private readonly source: AsyncIterable<T>;
  private readonly logger: ReplayLogger;
  private mode: PumpMode;
  private minSlotSeen: Slot | null = null;
  private maxSlotSeen: Slot | null = null;
  private minEmitSlot: Slot | null = null;
  private pumpPromise: Promise<void>;

  constructor(options: {
    source: AsyncIterable<T>;
    slotOf: (item: T) => Slot;
    keyOf?: (item: T) => string;
    logger?: ReplayLogger;
    startInStreamingMode?: boolean;
    initialEmitFloor?: Slot;
  }) {
    this.source = options.source;
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
      this.logger.debug("discarded buffered items up to cutoff", {
        discarded,
        cutoff: cutoffSlot.toString(),
      });
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
    this.queue.close();
    await this.pumpPromise;
  }

  private async start(): Promise<void> {
    try {
      for await (const item of this.source) {
        const slot = this.slotOf(item);
        if (this.minSlotSeen === null || slot < this.minSlotSeen) this.minSlotSeen = slot;
        if (this.maxSlotSeen === null || slot > this.maxSlotSeen) this.maxSlotSeen = slot;
        if (this.mode === "buffering") this.buffer.insert(item);
        else {
          if (this.minEmitSlot !== null && slot < this.minEmitSlot) continue;
          this.queue.push(item);
        }
      }
      this.queue.close();
    } catch (err) {
      this.logger.error("live stream failed", { err });
      this.queue.fail(err);
    }
  }
}
