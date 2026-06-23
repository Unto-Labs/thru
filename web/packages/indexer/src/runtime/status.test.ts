import { describe, expect, it } from "vitest";
import { normalizeIndexerError, type IndexerErrorPhase } from "./status";

describe("normalizeIndexerError", () => {
  function normalized(phase: IndexerErrorPhase) {
    return normalizeIndexerError({
      error: new Error("boom"),
      phase,
      streamName: "pack-purchases",
      streamKind: "event",
    });
  }

  it("marks transport and commit phases retryable", () => {
    expect(normalized("starting").retryable).toBe(true);
    expect(normalized("backfill").retryable).toBe(true);
    expect(normalized("live").retryable).toBe(true);
    expect(normalized("commit").retryable).toBe(true);
    expect(normalized("supervisor").retryable).toBe(true);
  });

  it("marks application hook and parser phases non-retryable", () => {
    expect(normalized("parse").retryable).toBe(false);
    expect(normalized("filterBatch").retryable).toBe(false);
    expect(normalized("onCommit").retryable).toBe(false);
  });
});
