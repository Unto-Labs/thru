import { create } from "@bufbuild/protobuf";
import { describe, expect, it, vi } from "vitest";
import { createMockAccount, createMockContext, createMockHeightResponse, generateTestPubkey } from "../../__tests__/helpers/test-utils";
import * as keysModule from "../../modules/keys";
import { ConsensusStatus } from "../../proto/thru/common/v1/consensus_pb";
import { StreamAccountUpdatesResponseSchema, StreamBlocksResponseSchema, StreamEventsResponseSchema, StreamTransactionsResponseSchema } from "../../proto/thru/services/v1/streaming_service_pb";
import { createBoundThruClient } from "../bound-client";

describe("createBoundThruClient", () => {
  it("should create bound client with all modules", () => {
    const ctx = createMockContext();
    const client = createBoundThruClient(ctx);
    
    expect(client.ctx).toBe(ctx);
    expect(client.blocks).toBeDefined();
    expect(client.accounts).toBeDefined();
    expect(client.transactions).toBeDefined();
    expect(client.events).toBeDefined();
    expect(client.proofs).toBeDefined();
    expect(client.keys).toBeDefined();
    expect(client.version).toBeDefined();
    expect(client.helpers).toBeDefined();
  });

  it("should bind blocks module methods", () => {
    const ctx = createMockContext();
    vi.spyOn(ctx.query, "getBlock").mockResolvedValue({} as any);
    vi.spyOn(ctx.query, "getRawBlock").mockResolvedValue({} as any);
    vi.spyOn(ctx.query, "listBlocks").mockResolvedValue({} as any);
    vi.spyOn(ctx.query, "getHeight").mockResolvedValue(createMockHeightResponse());
    vi.spyOn(ctx.streaming, "streamBlocks").mockReturnValue(
      (async function* () {})()
    );
    
    const client = createBoundThruClient(ctx);
    
    expect(typeof client.blocks.get).toBe("function");
    expect(typeof client.blocks.getRaw).toBe("function");
    expect(typeof client.blocks.list).toBe("function");
    expect(typeof client.blocks.stream).toBe("function");
    expect(typeof client.blocks.getBlockHeight).toBe("function");
    
    // Verify bound functions don't require context parameter
    client.blocks.get({ slot: 1000n });
    expect(ctx.query.getBlock).toHaveBeenCalledTimes(1);
  });

    it("should bind accounts module methods", async () => {
      const ctx = createMockContext();
      const mockAccount = createMockAccount();
      vi.spyOn(ctx.query, "getAccount").mockResolvedValue(mockAccount);
      vi.spyOn(ctx.query, "getRawAccount").mockResolvedValue({} as any);
      vi.spyOn(ctx.query, "listAccounts").mockResolvedValue({ accounts: [] } as any);
      vi.spyOn(ctx.streaming, "streamAccountUpdates").mockReturnValue(
        (async function* () {})()
      );
      
      const client = createBoundThruClient(ctx);
      
      expect(typeof client.accounts.get).toBe("function");
      expect(typeof client.accounts.getRaw).toBe("function");
      expect(typeof client.accounts.list).toBe("function");
      expect(typeof client.accounts.stream).toBe("function");
      expect(typeof client.accounts.create).toBe("function");
      
      // Verify bound function works without context parameter
      const address = generateTestPubkey();
      await client.accounts.get(address);
      expect(ctx.query.getAccount).toHaveBeenCalledTimes(1);
    });

  it("should bind transactions module methods", () => {
    const ctx = createMockContext();
    vi.spyOn(ctx.query, "getTransaction").mockResolvedValue({} as any);
    vi.spyOn(ctx.query, "getRawTransaction").mockResolvedValue({} as any);
    vi.spyOn(ctx.query, "getTransactionStatus").mockResolvedValue({} as any);
    vi.spyOn(ctx.query, "listTransactionsForAccount").mockResolvedValue({ signatures: [] } as any);
    vi.spyOn(ctx.command, "sendTransaction").mockResolvedValue({ signature: { value: new Uint8Array(64) } } as any);
    vi.spyOn(ctx.command, "batchSendTransactions").mockResolvedValue({ signatures: [] } as any);
    vi.spyOn(ctx.streaming, "streamTransactions").mockReturnValue(
      (async function* () {})()
    );
    vi.spyOn(ctx.streaming, "trackTransaction").mockReturnValue(
      (async function* () {})()
    );
    
    const client = createBoundThruClient(ctx);
    
    expect(typeof client.transactions.get).toBe("function");
    expect(typeof client.transactions.getRaw).toBe("function");
    expect(typeof client.transactions.getStatus).toBe("function");
    expect(typeof client.transactions.listForAccount).toBe("function");
    expect(typeof client.transactions.stream).toBe("function");
    expect(typeof client.transactions.build).toBe("function");
    expect(typeof client.transactions.buildAndSign).toBe("function");
    expect(typeof client.transactions.send).toBe("function");
    expect(typeof client.transactions.batchSend).toBe("function");
    expect(typeof client.transactions.track).toBe("function");
  });

  it("should bind events module methods", () => {
    const ctx = createMockContext();
    vi.spyOn(ctx.query, "getEvent").mockResolvedValue({} as any);
    vi.spyOn(ctx.streaming, "streamEvents").mockReturnValue(
      (async function* () {})()
    );
    
    const client = createBoundThruClient(ctx);
    
    expect(typeof client.events.get).toBe("function");
    expect(typeof client.events.stream).toBe("function");
  });

  it("should bind proofs module methods", () => {
    const ctx = createMockContext();
    vi.spyOn(ctx.query, "generateStateProof").mockResolvedValue({} as any);
    
    const client = createBoundThruClient(ctx);
    
    expect(typeof client.proofs.generate).toBe("function");
  });

  it("should bind version module methods", async () => {
    const ctx = createMockContext();
    const mockVersionResponse = { versions: { "component": "1.0.0" } };
    vi.spyOn(ctx.query, "getVersion").mockResolvedValue(mockVersionResponse as any);
    
    const client = createBoundThruClient(ctx);
    
    expect(typeof client.version.get).toBe("function");
    
    // Verify bound function works without context parameter
    const result = await client.version.get();
    expect(result).toBe(mockVersionResponse);
    expect(ctx.query.getVersion).toHaveBeenCalledTimes(1);
  });

  it("should expose keys module (not bound, direct reference)", () => {
    const ctx = createMockContext();
    const client = createBoundThruClient(ctx);
    
    expect(typeof client.keys.generateKeyPair).toBe("function");
    expect(client.keys.generateKeyPair).toBe(keysModule.generateKeyPair);
  });

  it("should expose helpers (not bound, direct functions)", () => {
    const ctx = createMockContext();
    const client = createBoundThruClient(ctx);
    
    expect(typeof client.helpers.toSignature).toBe("function");
    expect(typeof client.helpers.toPubkey).toBe("function");
    expect(typeof client.helpers.toBlockHash).toBe("function");
    expect(typeof client.helpers.encodeSignature).toBe("function");
    expect(typeof client.helpers.decodeSignature).toBe("function");
    expect(typeof client.helpers.encodeAddress).toBe("function");
    expect(typeof client.helpers.decodeAddress).toBe("function");
    expect(typeof client.helpers.deriveProgramAddress).toBe("function");
  });

  it("should inject context into bound functions", async () => {
    const ctx = createMockContext();
    const mockAccount = createMockAccount();
    vi.spyOn(ctx.query, "getAccount").mockResolvedValue(mockAccount);
    
    const client = createBoundThruClient(ctx);
    const address = generateTestPubkey();
    
    // Call bound function without context parameter
    const result = await client.accounts.get(address);
    
    expect(result).toBe(mockAccount);
    expect(ctx.query.getAccount).toHaveBeenCalledTimes(1);
    // Verify the request was created with correct address
    const callArgs = (ctx.query.getAccount as any).mock.calls[0][0];
    expect(callArgs.address?.value).toEqual(address);
  });

  it("should preserve function signatures (bound functions don't have context parameter)", () => {
    const ctx = createMockContext();
    const client = createBoundThruClient(ctx);
    
    // Original function signature: getAccount(ctx, address, options?)
    // Bound function signature: getAccount(address, options?)
    // Should not require context as first parameter
    
    const address = generateTestPubkey();
    
    // This should work without context parameter
    expect(() => {
      client.accounts.get(address);
    }).not.toThrow();
  });

  it("should allow passing options to bound functions", async () => {
    const ctx = createMockContext();
    const mockAccount = createMockAccount();
    vi.spyOn(ctx.query, "getAccount").mockResolvedValue(mockAccount);
    
    const client = createBoundThruClient(ctx);
    const address = generateTestPubkey();
    
    await client.accounts.get(address, {
      view: 1, // AccountView enum value
    });
    
    expect(ctx.query.getAccount).toHaveBeenCalledTimes(1);
    const callArgs = (ctx.query.getAccount as any).mock.calls[0][0];
    expect(callArgs.view).toBe(1);
  });

  it("should expose context for advanced usage", () => {
    const ctx = createMockContext();
    const client = createBoundThruClient(ctx);
    
    expect(client.ctx).toBe(ctx);
    expect(client.ctx.baseUrl).toBe(ctx.baseUrl);
    expect(client.ctx.query).toBe(ctx.query);
    expect(client.ctx.command).toBe(ctx.command);
    expect(client.ctx.streaming).toBe(ctx.streaming);
  });

  it("should bind listForAccount and pass parameters correctly", async () => {
    const ctx = createMockContext();
    const mockResponse = { signatures: [] };
    vi.spyOn(ctx.query, "listTransactionsForAccount").mockResolvedValue(mockResponse as any);
    
    const client = createBoundThruClient(ctx);
    const account = generateTestPubkey();
    
    // Verify bound function works without context parameter
    const result = await client.transactions.listForAccount(account);
    expect(result).toBe(mockResponse);
    expect(ctx.query.listTransactionsForAccount).toHaveBeenCalledTimes(1);
  });

  it("should bind batchSend and pass parameters correctly", async () => {
    const ctx = createMockContext();
    const mockResponse = { signatures: [] };
    vi.spyOn(ctx.command, "batchSendTransactions").mockResolvedValue(mockResponse as any);
    
    const client = createBoundThruClient(ctx);
    
    // Verify bound function works without context parameter
    const result = await client.transactions.batchSend([new Uint8Array(100)]);
    expect(result).toBe(mockResponse);
    expect(ctx.command.batchSendTransactions).toHaveBeenCalledTimes(1);
  });

  it("should return async iterable from blocks.stream", async () => {
    const ctx = createMockContext();
    const mockResponse = create(StreamBlocksResponseSchema, {});
    vi.spyOn(ctx.streaming, "streamBlocks").mockReturnValue(
      (async function* () {
        yield mockResponse;
      })()
    );
    
    const client = createBoundThruClient(ctx);
    
    const iterable = client.blocks.stream();
    const results = [];
    for await (const response of iterable) {
      results.push(response);
    }
    
    expect(results).toHaveLength(1);
    expect(results[0]).toBe(mockResponse);
    expect(ctx.streaming.streamBlocks).toHaveBeenCalledTimes(1);
  });

  it("should return async iterable from accounts.stream", async () => {
    const ctx = createMockContext();
    const mockResponse = create(StreamAccountUpdatesResponseSchema, {});
    vi.spyOn(ctx.streaming, "streamAccountUpdates").mockReturnValue(
      (async function* () {
        yield mockResponse;
      })()
    );
    
    const client = createBoundThruClient(ctx);
    const address = generateTestPubkey();
    
    const iterable = client.accounts.stream(address);
    const results = [];
    for await (const response of iterable) {
      results.push(response);
    }
    
    expect(results).toHaveLength(1);
    expect(results[0]).toBe(mockResponse);
    const callArgs = (ctx.streaming.streamAccountUpdates as any).mock.calls[0][0];
    expect(callArgs.address?.value).toEqual(address);
  });

  it("should return async iterable from transactions.stream", async () => {
    const ctx = createMockContext();
    const mockResponse = create(StreamTransactionsResponseSchema, {});
    vi.spyOn(ctx.streaming, "streamTransactions").mockReturnValue(
      (async function* () {
        yield mockResponse;
      })()
    );
    
    const client = createBoundThruClient(ctx);
    
    const iterable = client.transactions.stream();
    const results = [];
    for await (const response of iterable) {
      results.push(response);
    }
    
    expect(results).toHaveLength(1);
    expect(results[0]).toBe(mockResponse);
    expect(ctx.streaming.streamTransactions).toHaveBeenCalledTimes(1);
  });

  it("should return async iterable from events.stream", async () => {
    const ctx = createMockContext();
    const mockResponse = create(StreamEventsResponseSchema, {});
    vi.spyOn(ctx.streaming, "streamEvents").mockReturnValue(
      (async function* () {
        yield mockResponse;
      })()
    );
    
    const client = createBoundThruClient(ctx);
    
    const iterable = client.events.stream();
    const results = [];
    for await (const response of iterable) {
      results.push(response);
    }
    
    expect(results).toHaveLength(1);
    expect(results[0]).toBe(mockResponse);
    expect(ctx.streaming.streamEvents).toHaveBeenCalledTimes(1);
  });

  it("should pass options to streaming methods", async () => {
    const ctx = createMockContext();
    vi.spyOn(ctx.streaming, "streamBlocks").mockReturnValue(
      (async function* () {})()
    );
    
    const client = createBoundThruClient(ctx);
    
    client.blocks.stream({ startSlot: 1000n, minConsensus: ConsensusStatus.FINALIZED });
    
    const callArgs = (ctx.streaming.streamBlocks as any).mock.calls[0][0];
    expect(callArgs.startSlot).toBe(1000n);
    expect(callArgs.minConsensus).toBe(ConsensusStatus.FINALIZED);
  });
});

