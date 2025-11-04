import { describe, expect, it } from "vitest";
import { DEFAULT_HOST } from "../../defaults";
import { createThruClientContext } from "../client";

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
});

