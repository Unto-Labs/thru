import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@connectrpc/connect-web", () => ({
  createGrpcWebTransport: vi.fn(() => ({ mockTransport: true })),
}));

import * as connectWeb from "@connectrpc/connect-web";
import { DEFAULT_HOST } from "../../defaults";
import { TransactionSigningScheme } from "../../domain/transactions/transaction-signing-scheme";
import { createThruClientContext, withCallOptions } from "../client";

afterEach(() => {
  vi.clearAllMocks();
});

describe("createThruClientContext", () => {
  it("should create context with default host when no config provided", () => {
    const ctx = createThruClientContext();
    
    expect(ctx.baseUrl).toBe(DEFAULT_HOST);
    expect(ctx.transport).toBeDefined();
    expect(ctx.query).toBeDefined();
    expect(ctx.command).toBeDefined();
    expect(ctx.streaming).toBeDefined();
    expect(ctx.transactionSigningScheme).toBe(TransactionSigningScheme.Rfc8032);
  });

  it("stores an explicit legacy transaction signing default", () => {
    const ctx = createThruClientContext({
      transactionSigningScheme: TransactionSigningScheme.Legacy,
    });
    expect(ctx.transactionSigningScheme).toBe(TransactionSigningScheme.Legacy);
  });

  it("rejects an invalid transaction signing scheme", () => {
    expect(() =>
      createThruClientContext({
        transactionSigningScheme: "future" as TransactionSigningScheme,
      }),
    ).toThrow("Invalid transaction signing scheme: future");
  });

  it("should create context with custom baseUrl", () => {
    const customUrl = "https://custom.thruput.org";
    const ctx = createThruClientContext({ baseUrl: customUrl });
    
    expect(ctx.baseUrl).toBe(customUrl);
    expect(ctx.transport).toBeDefined();
    expect(ctx.query).toBeDefined();
    expect(ctx.command).toBeDefined();
    expect(ctx.streaming).toBeDefined();
  });

  it("should create gRPC clients for all services", () => {
    const ctx = createThruClientContext();
    
    // QueryService should have methods
    expect(ctx.query).toBeDefined();
    expect(typeof ctx.query.getHeight).toBe("function");
    expect(typeof ctx.query.getAccount).toBe("function");
    
    // CommandService should have methods
    expect(ctx.command).toBeDefined();
    expect(typeof ctx.command.sendTransaction).toBe("function");
    
    // StreamingService should have methods
    expect(ctx.streaming).toBeDefined();
    expect(typeof ctx.streaming.trackTransaction).toBe("function");
  });

  it("should create transport with correct baseUrl", () => {
    const customUrl = "https://test.thruput.org";
    const ctx = createThruClientContext({ baseUrl: customUrl });
    
    // Transport should be created (we can't easily test internal config)
    expect(ctx.transport).toBeDefined();
    expect(ctx.baseUrl).toBe(customUrl);
  });

  it("uses provided transport when supplied", () => {
    const transport = {} as any;
    const ctx = createThruClientContext({ transport });
    expect(ctx.transport).toBe(transport);
  });

  it("merges transport options and interceptors", () => {
    const spy = vi.spyOn(connectWeb, "createGrpcWebTransport");
    const interceptorA = vi.fn();
    const interceptorB = vi.fn();
    createThruClientContext({
      baseUrl: "https://custom.example",
      transportOptions: {
        baseUrl: "https://ignored.example",
        useBinaryFormat: false,
        interceptors: [interceptorA],
      },
      interceptors: [interceptorB],
    });
    expect(spy).toHaveBeenCalledTimes(1);
    const options = spy.mock.calls[0][0];
    expect(options.baseUrl).toBe("https://custom.example");
    expect(options.useBinaryFormat).toBe(false);
    expect(options.interceptors).toEqual([interceptorA, interceptorB]);
  });

  it("stores default call options", () => {
    const ctx = createThruClientContext({
      callOptions: { timeoutMs: 5000 },
    });
    expect(ctx.callOptions?.timeoutMs).toBe(5000);
  });

  it("merges call options via helper", () => {
    const aborter = new AbortController();
    const ctx = createThruClientContext({
      callOptions: { timeoutMs: 1000, headers: [["x-test", "1"]] },
    });
    const merged = withCallOptions(ctx, { headers: [["y-test", "2"]], signal: aborter.signal });
    expect(merged?.timeoutMs).toBe(1000);
    expect(merged?.signal).toBe(aborter.signal);
    expect(merged?.headers).toEqual([["x-test", "1"], ["y-test", "2"]]);
  });

  it("replaces earlier headers with the same name when merging", () => {
    const ctx = createThruClientContext({
      callOptions: { headers: [["x-trace", "a=1"], ["x-test", "1"]] },
    });
    const merged = withCallOptions(ctx, { headers: [["X-Trace", "b=2"]] });
    expect(merged?.headers).toEqual([
      ["x-test", "1"],
      ["X-Trace", "b=2"],
    ]);
  });

  describe("apiKey", () => {
    const VALID_KEY = "thru_" + "x".repeat(32);

    it("adds an Authorization Bearer header to default call options", () => {
      const ctx = createThruClientContext({ apiKey: VALID_KEY });
      expect(ctx.callOptions?.headers).toEqual([["Authorization", `Bearer ${VALID_KEY}`]]);
    });

    it("merges with user-provided call option headers", () => {
      const ctx = createThruClientContext({
        apiKey: VALID_KEY,
        callOptions: { timeoutMs: 250, headers: [["x-test", "1"]] },
      });
      expect(ctx.callOptions?.timeoutMs).toBe(250);
      expect(ctx.callOptions?.headers).toEqual([
        ["Authorization", `Bearer ${VALID_KEY}`],
        ["x-test", "1"],
      ]);
      const merged = withCallOptions(ctx, { headers: [["y-test", "2"]] });
      expect(merged?.headers).toEqual([
        ["Authorization", `Bearer ${VALID_KEY}`],
        ["x-test", "1"],
        ["y-test", "2"],
      ]);
    });

    it("lets a per-call Authorization header replace the apiKey-derived one", () => {
      const ctx = createThruClientContext({ apiKey: VALID_KEY });
      const merged = withCallOptions(ctx, { headers: [["authorization", "Bearer other"]] });
      expect(merged?.headers).toEqual([["authorization", "Bearer other"]]);
      const fromHeaders = withCallOptions(ctx, { headers: new Headers({ Authorization: "Bearer other" }) });
      expect(fromHeaders?.headers).toEqual([["authorization", "Bearer other"]]);
    });

    it("lets callOptions.headers given at client creation replace the apiKey-derived one", () => {
      const ctx = createThruClientContext({
        apiKey: VALID_KEY,
        callOptions: { headers: { Authorization: "Bearer other" } },
      });
      expect(ctx.callOptions?.headers).toEqual([["Authorization", "Bearer other"]]);
    });

    it("applies the header even when a custom transport is supplied", () => {
      const transport = {} as any;
      const ctx = createThruClientContext({ transport, apiKey: VALID_KEY });
      expect(ctx.transport).toBe(transport);
      expect(ctx.callOptions?.headers).toEqual([["Authorization", `Bearer ${VALID_KEY}`]]);
    });

    it("sends no header when apiKey is unset or blank", () => {
      expect(createThruClientContext({}).callOptions).toBeUndefined();
      expect(createThruClientContext({ apiKey: undefined }).callOptions).toBeUndefined();
      expect(createThruClientContext({ apiKey: "" }).callOptions).toBeUndefined();
      expect(createThruClientContext({ apiKey: "   " }).callOptions).toBeUndefined();
      const ctx = createThruClientContext({ apiKey: "", callOptions: { timeoutMs: 1 } });
      expect(ctx.callOptions).toEqual({ timeoutMs: 1 });
    });

    it("rejects malformed keys with a clear error", () => {
      expect(() => createThruClientContext({ apiKey: "thru_short" })).toThrow(/Invalid Thru API key/);
      expect(() => createThruClientContext({ apiKey: "sk_" + "a".repeat(32) })).toThrow(/Invalid Thru API key/);
      expect(() => createThruClientContext({ apiKey: "thru_" + "a".repeat(31) + "!" })).toThrow(
        /Invalid Thru API key/,
      );
    });
  });
});
