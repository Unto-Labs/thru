import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@connectrpc/connect-web", () => ({
  createGrpcWebTransport: vi.fn(() => ({ mockTransport: true })),
}));

import * as connectWeb from "@connectrpc/connect-web";
import { DEFAULT_HOST } from "../../defaults";
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

  it("preserves duplicate headers when merging", () => {
    const ctx = createThruClientContext({
      callOptions: { headers: [["set-cookie", "a=1"], ["x-test", "1"]] },
    });
    const merged = withCallOptions(ctx, { headers: [["set-cookie", "b=2"]] });
    expect(merged?.headers).toEqual([
      ["set-cookie", "a=1"],
      ["x-test", "1"],
      ["set-cookie", "b=2"],
    ]);
  });
});

