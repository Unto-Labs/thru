import { afterEach, describe, expect, it, vi } from "vitest";
import { createScopedLogger, formatLogLine, logFatal } from "./logger";

/* Every console call the sinks make: one argument, one line, valid JSON (F-E4:
   a VM shipping stdout to Cloud Logging makes every line its own entry). */
function capture() {
  const calls: { stream: string; args: unknown[] }[] = [];
  for (const stream of ["log", "info", "warn", "error", "debug"] as const)
    vi.spyOn(console, stream).mockImplementation((...args: unknown[]) => { calls.push({ stream, args }); });
  const lines = () => calls.map((c) => {
    expect(c.args).toHaveLength(1);
    expect(typeof c.args[0]).toBe("string");
    expect(c.args[0] as string).not.toContain("\n");
    return { stream: c.stream, record: JSON.parse(c.args[0] as string) };
  });
  return lines;
}
afterEach(() => vi.restoreAllMocks());

describe("the default log sink", () => {
  it("writes each record as one JSON line with severity, logger, message and the fields", () => {
    const lines = capture();
    const logger = createScopedLogger({ prefix: "indexer", bindings: { component: "indexer-runtime" } });
    logger.info("Indexer stream state changed", {
      event: "indexer.stream.state_changed", stream: "perps-markets", kind: "account",
      previous_state: "idle", next_state: "starting", start_slot: undefined, checkpoint_slot: 3646n,
      nested: { a: [1, 2, { b: "c" }] },
    });
    const failure = Object.assign(new Error("Source identity/height changed; advancement frozen"), { code: 9 });
    logger.error("Indexer stream failed", { stream: "perps-markets", error: failure });
    logger.warn("Indexer stream supervisor restarting", { stream: "perps-events" });
    logger.debug("not at the default level");
    const [info, error, warn, ...rest] = lines();
    expect(rest).toEqual([]);
    expect(info).toEqual({
      stream: "log",
      record: {
        severity: "INFO", logger: "indexer", message: "Indexer stream state changed", component: "indexer-runtime",
        event: "indexer.stream.state_changed", stream: "perps-markets", kind: "account", previous_state: "idle",
        next_state: "starting", checkpoint_slot: "3646", nested: { a: [1, 2, { b: "c" }] },
      },
    });
    expect(error.stream).toBe("error");
    expect(error.record).toMatchObject({
      severity: "ERROR", message: "Indexer stream failed",
      error: { name: "Error", message: "Source identity/height changed; advancement frozen", code: 9 },
    });
    expect(error.record.error.stack).toContain("advancement frozen\n    at ");
    expect(warn).toMatchObject({ stream: "warn", record: { severity: "WARNING", message: "Indexer stream supervisor restarting" } });
  });

  it("keeps its own severity and message over fields of the same name, and survives a circular field", () => {
    expect(JSON.parse(formatLogLine({ severity: "INFO", message: "m" }, { message: "other", severity: "x", n: 1 })))
      .toEqual({ severity: "INFO", message: "m", n: 1 });
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    const line = formatLogLine({ severity: "INFO", message: "m" }, { loop });
    expect(line).not.toContain("\n");
    expect(JSON.parse(line)).toMatchObject({ severity: "INFO", message: "m", fieldsError: expect.any(String) });
  });

  it("writes a fatal error as one line with its stack and cause", () => {
    const lines = capture();
    logFatal("perps-indexer", "indexer_fatal", new Error("outer", { cause: new Error("inner") }));
    const [fatal] = lines();
    expect(fatal.stream).toBe("error");
    expect(fatal.record).toMatchObject({
      severity: "ERROR", message: "outer", event: "indexer_fatal", service: "perps-indexer",
      error: { message: "outer", cause: { message: "inner" } },
    });
    expect(fatal.record.error.stack).toMatch(/^Error: outer\n/);
  });
});
