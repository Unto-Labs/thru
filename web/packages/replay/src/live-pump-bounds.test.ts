import { it, expect } from "vitest";
import { LivePump } from "./live-pump";
it("bounds capture while backfill is stalled and demands replay on overflow", async () => {
  const source = {
    async *[Symbol.asyncIterator]() {
      for (let i = 0; i < 10; i++) yield { slot: BigInt(i) };
    },
  };
  const pump = new LivePump({
    source,
    slotOf: (x) => x.slot,
    maxBufferedItems: 2,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(pump.bufferedSize()).toBe(2);
  await expect(pump.next()).rejects.toThrow("capacity");
  await pump.close();
});
it("bounds the live consumer queue as well as bootstrap capture", async () => {
  const source = {
    async *[Symbol.asyncIterator]() {
      for (let i = 0; i < 10; i++) yield { slot: BigInt(i) };
    },
  };
  const pump = new LivePump({
    source,
    slotOf: (x) => x.slot,
    maxBufferedItems: 2,
    startInStreamingMode: true,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await expect(pump.next()).rejects.toThrow("capacity");
  await pump.close();
});

it("allows buffered duplicates when capture is at capacity", async () => {
  const source = { async *[Symbol.asyncIterator]() { yield 1n; yield 2n; yield 1n; yield 2n; } };
  const pump = new LivePump({ source, slotOf: slot => slot, maxBufferedItems: 2 });
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(pump.enableStreaming(0n).drained).toEqual([1n, 2n]);
  expect(await pump.next()).toEqual({ done: true, value: undefined });
  await pump.close();
});

it("discards below-floor overlap even when the consumer queue is full", async () => {
  const source = { async *[Symbol.asyncIterator]() { yield 10n; yield 11n; yield 9n; } };
  const pump = new LivePump({ source, slotOf: slot => slot, maxBufferedItems: 2, startInStreamingMode: true, initialEmitFloor: 10n });
  await new Promise(resolve => setTimeout(resolve, 0));
  expect((await pump.next()).value).toBe(10n);
  expect((await pump.next()).value).toBe(11n);
  expect((await pump.next()).done).toBe(true);
  await pump.close();
});
