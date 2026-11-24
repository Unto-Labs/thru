import { expect, it } from "vitest";
import { isSourceUnreachable, SourceBackoff } from "./backoff";

it("tells a source that cannot be reached from one that answered", () => {
  const refused = Object.assign(new Error("[unavailable] connect ECONNREFUSED 127.0.0.1:8473"), { code: 14 });
  expect(isSourceUnreachable(refused)).toBe(true);
  expect(isSourceUnreachable(Object.assign(new Error("deadline"), { code: 4 }))).toBe(true);
  expect(isSourceUnreachable(Object.assign(new Error("rate limited"), { code: 8 }))).toBe(true);
  expect(isSourceUnreachable(new Error("wrapped", { cause: Object.assign(new Error("connect"), { code: "ECONNREFUSED" }) }))).toBe(true);
  expect(isSourceUnreachable(Object.assign(new Error("not found"), { code: 5 }))).toBe(false);
  expect(isSourceUnreachable(Object.assign(new Error("canceled"), { code: 1 }))).toBe(false);
  expect(isSourceUnreachable(new Error("Oracle owner mismatch"))).toBe(false);
  expect(isSourceUnreachable(null)).toBe(false);
});

it("backs off exponentially to the cap, with at most 20 % jitter, and starts over after a success", () => {
  const low = new SourceBackoff({ random: () => 0 });
  expect(Array.from({ length: 8 }, () => low.next())).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
  expect(low.failures).toBe(8);
  low.reset();
  expect([low.failures, low.next()]).toEqual([0, 1000]);
  const high = new SourceBackoff({ random: () => 0.999 });
  expect([high.next(), high.next()]).toEqual([1199, 2399]);
  const custom = new SourceBackoff({ initialMs: 250, maxMs: 1000, random: () => 0 });
  expect([custom.next(), custom.next(), custom.next(), custom.next()]).toEqual([250, 500, 1000, 1000]);
});

it("waits the steady delay before reopening a stream, and backs off only while the source cannot be reached", () => {
  const b = new SourceBackoff({ random: () => 0 });
  const refused = Object.assign(new Error("connect ECONNREFUSED"), { code: 14 });
  expect([b.retryDelay(false, refused, 20), b.retryDelay(false, refused, 20)]).toEqual([1000, 2000]);
  expect(b.retryDelay(false, new Error("protocol error"), 20)).toBe(20);
  expect(b.failures).toBe(2);
  /* A stream that opened starts the backoff over, whatever ended it. */
  expect(b.retryDelay(true, refused, 20)).toBe(20);
  expect([b.failures, b.retryDelay(false, refused, 20)]).toEqual([0, 1000]);
});
