import { create } from "@bufbuild/protobuf";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMockAccount, createMockBlock, createMockContext, createMockHeightResponse, generateTestPubkey, generateTestSignature } from "../../__tests__/helpers/test-utils";
import { Account } from "../../domain/accounts";
import { Block } from "../../domain/blocks";
import { ChainEvent } from "../../domain/events";
import { TransactionStatusSnapshot } from "../../domain/transactions";
import { Transaction } from "../../domain/transactions/Transaction";
import * as keysModule from "../../modules/keys";
import { ConsensusStatus } from "../../proto/thru/common/v1/consensus_pb";
import { TransactionSchema } from "../../proto/thru/core/v1/transaction_pb";
import { EventSchema } from "../../proto/thru/services/v1/query_service_pb";
import { StreamAccountUpdatesResponseSchema, StreamBlocksResponseSchema, StreamEventsResponseSchema, StreamTransactionsResponseSchema } from "../../proto/thru/services/v1/streaming_service_pb";
import { createBoundThruClient } from "../bound-client";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createBoundThruClient", () => {
  function createMockTransactionProto(overrides: any = {}) {
    const headerOverrides = overrides.header ?? {};
    const header = {
      version: 1,
      flags: 0,
      readwriteAccountsCount: 0,
      readonlyAccountsCount: 0,
      instructionDataSize: 0,
      requestedComputeUnits: 0,
      requestedStateUnits: 0,
      requestedMemoryUnits: 0,
      expiryAfter: 0,
      fee: 1n,
      nonce: 1n,
      startSlot: 1n,
      feePayerPubkey: { value: generateTestSignature(0x11).slice(0, 32) },
      programPubkey: { value: generateTestSignature(0x22).slice(0, 32) },
      ...headerOverrides,
    };

    return create(TransactionSchema, {
      header,
      ...overrides,
    });
  }

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
    expect(client.consensus).toBeDefined();
    expect(client.helpers).toBeDefined();
  });

  it("should bind blocks module methods", async () => {
    const ctx = createMockContext();
    const mockBlock = createMockBlock();
    vi.spyOn(ctx.query, "getBlock").mockResolvedValue(mockBlock as any);
    vi.spyOn(ctx.query, "getRawBlock").mockResolvedValue({} as any);
    vi.spyOn(ctx.query, "listBlocks").mockResolvedValue({ blocks: [mockBlock] } as any);
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

    const height = await client.blocks.getBlockHeight();
    expect(height.finalized).toBe(1000n);
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
    vi.spyOn(ctx.query, "getTransactionStatus").mockResolvedValue({
      signature: { value: generateTestSignature() },
      consensusStatus: ConsensusStatus.UNSPECIFIED,
    } as any);
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
    expect(result.components.component).toBe("1.0.0");
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
    expect(typeof client.helpers.toSignatureBytes).toBe("function");
    expect(typeof client.helpers.toTsSignature).toBe("function");
    expect(typeof client.helpers.toPubkey).toBe("function");
    expect(typeof client.helpers.toPubkeyBytes).toBe("function");
    expect(typeof client.helpers.toTaPubkey).toBe("function");
    expect(typeof client.helpers.toBlockHash).toBe("function");
    expect(typeof client.helpers.encodeSignature).toBe("function");
    expect(typeof client.helpers.decodeSignature).toBe("function");
    expect(typeof client.helpers.encodeAddress).toBe("function");
    expect(typeof client.helpers.decodeAddress).toBe("function");
    expect(typeof client.helpers.deriveProgramAddress).toBe("function");
  });

  it("should expose consensus helpers", () => {
    const ctx = createMockContext();
    const client = createBoundThruClient(ctx);

    expect(typeof client.consensus.currentVersionContext).toBe("function");
    expect(typeof client.consensus.slotVersionContext).toBe("function");
    expect(client.consensus.statusToString(ConsensusStatus.INCLUDED)).toBe("INCLUDED");
  });

  it("should inject context into bound functions", async () => {
    const ctx = createMockContext();
    const mockAccount = createMockAccount();
    vi.spyOn(ctx.query, "getAccount").mockResolvedValue(mockAccount);
    
    const client = createBoundThruClient(ctx);
    const address = generateTestPubkey();
    
    // Call bound function without context parameter
    const result = await client.accounts.get(address);
    
    expect(result).toBeInstanceOf(Account);
    expect(result.address).toEqual(mockAccount.address?.value);
    expect(ctx.query.getAccount).toHaveBeenCalledTimes(1);
    // Verify the request was created with correct address
    const callArgs = (ctx.query.getAccount as any).mock.calls[0][0];
    expect(callArgs.address?.value).toEqual(address);
  });

  it("should return ChainEvent from events.get", async () => {
    const ctx = createMockContext();
    const eventProto = create(EventSchema, {
      eventId: "ev-domain",
      transactionSignature: { value: generateTestSignature() },
    });
    vi.spyOn(ctx.query, "getEvent").mockResolvedValue(eventProto as any);

    const client = createBoundThruClient(ctx);
    const event = await client.events.get("ev-domain");

    expect(event).toBeInstanceOf(ChainEvent);
    expect(event.id).toBe("ev-domain");
  });

  it("should preserve function signatures (bound functions don't have context parameter)", async () => {
    const ctx = createMockContext();
    const mockAccount = createMockAccount();
    vi.spyOn(ctx.query, "getAccount").mockResolvedValue(mockAccount);
    
    const client = createBoundThruClient(ctx);
    const address = generateTestPubkey();
    
    await expect(client.accounts.get(address)).resolves.toBeInstanceOf(Account);
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
    const signatureBytes = generateTestSignature();
    vi.spyOn(ctx.query, "listTransactionsForAccount").mockResolvedValue({
      signatures: [{ value: signatureBytes }],
      page: undefined,
    } as any);
    const transactionProto = createMockTransactionProto();
    vi.spyOn(ctx.query, "getTransaction").mockResolvedValue(transactionProto as any);
    
    const client = createBoundThruClient(ctx);
    const account = generateTestPubkey();
    
    // Verify bound function works without context parameter
    const result = await client.transactions.listForAccount(account);
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0]).toBeInstanceOf(Transaction);
    expect(result.page).toBeUndefined();
    expect(ctx.query.listTransactionsForAccount).toHaveBeenCalledTimes(1);
    expect(ctx.query.getTransaction).toHaveBeenCalledTimes(1);
    const listArgs = (ctx.query.listTransactionsForAccount as any).mock.calls[0][0];
    expect(listArgs.account?.value).toEqual(account);
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
    const blockProto = createMockBlock();
    const mockResponse = create(StreamBlocksResponseSchema, { block: blockProto });
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
    expect(results[0].block).toBeInstanceOf(Block);
    expect(results[0].block.header.slot).toBe(blockProto.header?.slot);
    expect(ctx.streaming.streamBlocks).toHaveBeenCalledTimes(1);
  });

  it("should return async iterable from accounts.stream", async () => {
    const ctx = createMockContext();
    const snapshot = create(StreamAccountUpdatesResponseSchema, {
      message: {
        case: "snapshot",
        value: createMockAccount(),
      },
    });
    vi.spyOn(ctx.streaming, "streamAccountUpdates").mockReturnValue(
      (async function* () {
        yield snapshot;
      })()
    );
    
    const client = createBoundThruClient(ctx);
    const address = generateTestPubkey();
    
    const iterable = client.accounts.stream(address);
    const results = [] as Account[];
    for await (const { update } of iterable) {
      if (update.kind === "snapshot") {
        results.push(update.snapshot.account);
      }
    }
    
    expect(results).toHaveLength(1);
    expect(results[0]).toBeInstanceOf(Account);
    const callArgs = (ctx.streaming.streamAccountUpdates as any).mock.calls[0][0];
    expect(callArgs.address?.value).toEqual(address);
  });

  it("should return async iterable from transactions.stream", async () => {
    const ctx = createMockContext();
    const transactionProto = createMockTransactionProto();
    const mockResponse = create(StreamTransactionsResponseSchema, { transaction: transactionProto });
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
    expect(results[0].transaction).toBeInstanceOf(Transaction);
    expect(results[0].transaction.fee).toBe(1n);
    expect(ctx.streaming.streamTransactions).toHaveBeenCalledTimes(1);
  });

  it("should return async iterable from events.stream", async () => {
    const ctx = createMockContext();
    const mockResponse = create(StreamEventsResponseSchema, {
      eventId: "ev-1",
      signature: { value: generateTestSignature() },
    });
    vi.spyOn(ctx.streaming, "streamEvents").mockReturnValue(
      (async function* () {
        yield mockResponse;
      })()
    );
    
    const client = createBoundThruClient(ctx);
    
    const iterable = client.events.stream();
    const results = [] as string[];
    for await (const { event } of iterable) {
      results.push(event.id);
    }
    
    expect(results).toHaveLength(1);
    expect(results[0]).toBe("ev-1");
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

  it("should return TransactionStatusSnapshot from transactions.getStatus", async () => {
    const ctx = createMockContext();
    const transactionProto = createMockTransactionProto();
    vi.spyOn(ctx.query, "getTransaction").mockResolvedValue(transactionProto as any);
    vi.spyOn(ctx.query, "getTransactionStatus").mockResolvedValue({
      signature: { value: generateTestSignature() },
      consensusStatus: ConsensusStatus.UNSPECIFIED,
    } as any);
    
    const client = createBoundThruClient(ctx);
    
    const status = await client.transactions.getStatus(generateTestSignature());
    expect(status).toBeInstanceOf(TransactionStatusSnapshot);
    expect(ctx.query.getTransactionStatus).toHaveBeenCalledTimes(1);
  });
});

