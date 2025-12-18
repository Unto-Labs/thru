import type { Slot } from "./types";

interface DedupBufferOptions<T> {
  slotOf: (item: T) => Slot;
  keyOf: (item: T) => string;
}

export class DedupBuffer<T> {
  private readonly slotOf: (item: T) => Slot;
  private readonly keyOf: (item: T) => string;
  private readonly slots: Slot[] = [];
  private readonly itemsBySlot = new Map<Slot, Map<string, T>>();
  private sizeValue = 0;

  constructor(options: DedupBufferOptions<T>) {
    this.slotOf = options.slotOf;
    this.keyOf = options.keyOf;
  }

  insert(item: T): boolean {
    const slot = this.slotOf(item);
    const key = this.keyOf(item);
    let bucket = this.itemsBySlot.get(slot);
    if (!bucket) {
      bucket = new Map();
      this.itemsBySlot.set(slot, bucket);
      const idx = this.findInsertIndex(slot);
      this.slots.splice(idx, 0, slot);
    }
    if (bucket.has(key)) return false;
    bucket.set(key, item);
    this.sizeValue += 1;
    return true;
  }

  discardUpTo(cutoff: Slot): number {
    let removed = 0;
    while (this.slots.length && this.slots[0] <= cutoff) {
      const slot = this.slots.shift()!;
      const bucket = this.itemsBySlot.get(slot);
      if (!bucket) continue;
      removed += bucket.size;
      this.itemsBySlot.delete(slot);
    }
    this.sizeValue = Math.max(0, this.sizeValue - removed);
    return removed;
  }

  drainAbove(cutoff: Slot): T[] {
    if (!this.slots.length) return [];
    const drained: T[] = [];
    const keep: Slot[] = [];
    for (const slot of this.slots) {
      if (slot > cutoff) {
        const bucket = this.itemsBySlot.get(slot);
        if (bucket) {
          for (const item of bucket.values()) drained.push(item);
          this.itemsBySlot.delete(slot);
          this.sizeValue -= bucket.size;
        }
      } else {
        keep.push(slot);
      }
    }
    this.slots.length = 0;
    this.slots.push(...keep);
    return drained;
  }

  drainAll(): T[] {
    if (!this.slots.length) return [];
    const drained: T[] = [];
    for (const slot of this.slots) {
      const bucket = this.itemsBySlot.get(slot);
      if (!bucket) continue;
      for (const item of bucket.values()) drained.push(item);
      this.sizeValue -= bucket.size;
      this.itemsBySlot.delete(slot);
    }
    this.slots.length = 0;
    return drained;
  }

  minSlot(): Slot | null {
    return this.slots.length ? this.slots[0] : null;
  }

  get size(): number {
    return this.sizeValue;
  }

  private findInsertIndex(slot: Slot): number {
    let low = 0;
    let high = this.slots.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (this.slots[mid] < slot) low = mid + 1;
      else high = mid;
    }
    return low;
  }
}
