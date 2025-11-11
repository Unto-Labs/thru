import { create } from "@bufbuild/protobuf";
import { describe, expect, it, vi } from "vitest";
import { createMockAccount, createMockBlock, createMockContext, generateTestPubkey, generateTestSignature, generateTestSignatureString } from "../../__tests__/helpers/test-utils";
import { Account } from "../../domain/accounts";
import { Block } from "../../domain/blocks";
import { ChainEvent } from "../../domain/events";
import { Transaction } from "../../domain/transactions/Transaction";
import { ConsensusStatus } from "../../proto/thru/common/v1/consensus_pb";
import { TransactionExecutionResultSchema, TransactionSchema } from "../../proto/thru/core/v1/transaction_pb";
import { AccountUpdateSchema, StreamAccountUpdatesResponseSchema, StreamEventsResponseSchema, TrackTransactionResponseSchema } from "../../proto/thru/services/v1/streaming_service_pb";
import { streamAccountUpdates, streamBlocks, streamEvents, streamTransactions, trackTransaction } from "../streaming";

describe("streaming", () => {
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

  describe("streamBlocks", () => {
    it("should yield Block instances", async () => {
      const ctx = createMockContext();
      const mockBlock = createMockBlock();

      vi.spyOn(ctx.streaming, "streamBlocks").mockReturnValue(
        (async function* () {
          yield { block: mockBlock };
        })() as AsyncIterable<any>
      );

      const results: Block[] = [];
      for await (const { block } of streamBlocks(ctx)) {
        results.push(block);
      }

      expect(results).toHaveLength(1);
      expect(results[0]).toBeInstanceOf(Block);
    });
  });

  describe("streamAccountUpdates", () => {
    it("should yield domain snapshots", async () => {
      const ctx = createMockContext();
      const accountProto = createMockAccount();
      const response = create(StreamAccountUpdatesResponseSchema, {
        message: {
          case: "snapshot",
          value: accountProto,
        },
      });

      vi.spyOn(ctx.streaming, "streamAccountUpdates").mockReturnValue(
        (async function* () {
          yield response;
        })() as AsyncIterable<any>
      );

      const results = [] as Account[];
      for await (const { update } of streamAccountUpdates(ctx, generateTestPubkey())) {
        expect(update.kind).toBe("snapshot");
        results.push(update.snapshot.account);
      }

      expect(results).toHaveLength(1);
      expect(results[0]).toBeInstanceOf(Account);
    });

    it("should yield deltas with page data", async () => {
      const ctx = createMockContext();
      const updateProto = create(AccountUpdateSchema, {
        slot: 42n,
        meta: createMockAccount().meta,
        page: {
          pageIdx: 1,
          pageSize: 2,
          pageData: new Uint8Array([9, 8]),
        },
        delete: true,
      });
      const response = create(StreamAccountUpdatesResponseSchema, {
        message: {
          case: "update",
          value: updateProto,
        },
      });

      vi.spyOn(ctx.streaming, "streamAccountUpdates").mockReturnValue(
        (async function* () {
          yield response;
        })() as AsyncIterable<any>
      );

      const results = [] as any[];
      for await (const { update } of streamAccountUpdates(ctx, generateTestPubkey())) {
        expect(update.kind).toBe("update");
        results.push(update.update);
      }

      expect(results).toHaveLength(1);
      expect(results[0].slot).toBe(42n);
      expect(results[0].page?.data).toEqual(new Uint8Array([9, 8]));
      expect(results[0].deleted).toBe(true);
    });
  });

  describe("streamEvents", () => {
    it("should yield ChainEvent instances", async () => {
      const ctx = createMockContext();
      const proto = create(StreamEventsResponseSchema, {
        eventId: "evsig:10:2:0:extra",
        signature: { value: generateTestSignature() },
        program: { value: generateTestSignature(0x33).slice(0, 32) },
        payload: new Uint8Array([1, 2, 3]),
        slot: 10n,
        callIdx: 2,
        timestamp: { seconds: 1n, nanos: 5 },
      });

      vi.spyOn(ctx.streaming, "streamEvents").mockReturnValue(
        (async function* () {
          yield proto;
        })() as AsyncIterable<any>
      );

      const results: ChainEvent[] = [];
      for await (const { event } of streamEvents(ctx)) {
        results.push(event);
      }

      expect(results).toHaveLength(1);
      expect(results[0]).toBeInstanceOf(ChainEvent);
      expect(results[0].id).toBe("evsig:10:2:0");
      expect(results[0].slot).toBe(10n);
      expect(results[0].timestampNs).toBe(1_000_000_005n);
    });
  });

  describe("streamTransactions", () => {
    it("should yield Transaction instances", async () => {
      const ctx = createMockContext();
      const mockTransaction = createMockTransactionProto();

      vi.spyOn(ctx.streaming, "streamTransactions").mockReturnValue(
        (async function* () {
          yield { transaction: mockTransaction };
        })() as AsyncIterable<any>
      );

      const results: Transaction[] = [];
      for await (const { transaction } of streamTransactions(ctx)) {
        results.push(transaction);
      }

      expect(results).toHaveLength(1);
      expect(results[0]).toBeInstanceOf(Transaction);
      expect(results[0].fee).toBe(1n);
    });

    it("should parse transactions when body includes full wire payload", async () => {
      const ctx = createMockContext();

      const localTransaction = new Transaction({
        feePayer: generateTestSignature(0x11).slice(0, 32),
        program: generateTestSignature(0x22).slice(0, 32),
        header: {
          fee: 5n,
          nonce: 2n,
          startSlot: 3n,
        },
      });

      const proto = createMockTransactionProto({
        header: {
          readwriteAccountsCount: localTransaction.readWriteAccounts.length,
          readonlyAccountsCount: localTransaction.readOnlyAccounts.length,
          instructionDataSize: localTransaction.instructionData?.length ?? 0,
          fee: localTransaction.fee,
          nonce: localTransaction.nonce,
          startSlot: localTransaction.startSlot,
        },
        body: localTransaction.toWire(),
      });

      vi.spyOn(ctx.streaming, "streamTransactions").mockReturnValue(
        (async function* () {
          yield { transaction: proto };
        })() as AsyncIterable<any>
      );

      const results: Transaction[] = [];
      for await (const { transaction } of streamTransactions(ctx)) {
        results.push(transaction);
      }

      expect(results).toHaveLength(1);
      expect(results[0].fee).toBe(5n);
      expect(results[0].nonce).toBe(2n);
    });
  });

  describe("trackTransaction", () => {
    it("should return async iterable for transaction tracking", async () => {
      const ctx = createMockContext();
      const mockResponse1 = create(TrackTransactionResponseSchema, { 
        consensusStatus: ConsensusStatus.UNSPECIFIED,
      });
      const mockResponse2 = create(TrackTransactionResponseSchema, { 
        consensusStatus: ConsensusStatus.FINALIZED,
      });
      
      vi.spyOn(ctx.streaming, "trackTransaction").mockReturnValue(
        (async function* () {
          yield mockResponse1;
          yield mockResponse2;
        })()
      );
      
      const signature = generateTestSignature();
      const iterable = trackTransaction(ctx, signature);
      
      const results = [];
      for await (const response of iterable) {
        results.push(response);
      }
      
      expect(results).toHaveLength(2);
      expect(results[0].statusCode).toBe(ConsensusStatus.UNSPECIFIED);
      expect(results[0].status).toBe("UNSPECIFIED");
      expect(results[1].statusCode).toBe(ConsensusStatus.FINALIZED);
      expect(results[1].status).toBe("FINALIZED");
      expect(ctx.streaming.trackTransaction).toHaveBeenCalledTimes(1);
    });

    it("should accept signature as Uint8Array", async () => {
      const ctx = createMockContext();
      const signature = generateTestSignature();
      vi.spyOn(ctx.streaming, "trackTransaction").mockReturnValue(
        (async function* () { yield create(TrackTransactionResponseSchema, {}); })()
      );
      
      trackTransaction(ctx, signature);
      
      const callArgs = (ctx.streaming.trackTransaction as any).mock.calls[0][0];
      expect(callArgs.signature.value).toEqual(signature);
    });

    it("should accept signature as string", async () => {
      const ctx = createMockContext();
      const signatureString = generateTestSignatureString();
      vi.spyOn(ctx.streaming, "trackTransaction").mockReturnValue(
        (async function* () { yield create(TrackTransactionResponseSchema, {}); })()
      );
      
      trackTransaction(ctx, signatureString);
      
      const callArgs = (ctx.streaming.trackTransaction as any).mock.calls[0][0];
      expect(callArgs.signature.value.length).toBe(64);
    });

    it("should convert timeoutMs to seconds and nanos", async () => {
      const ctx = createMockContext();
      const signature = generateTestSignature();
      vi.spyOn(ctx.streaming, "trackTransaction").mockReturnValue(
        (async function* () { yield create(TrackTransactionResponseSchema, {}); })()
      );
      
      trackTransaction(ctx, signature, { timeoutMs: 2500 });
      
      const callArgs = (ctx.streaming.trackTransaction as any).mock.calls[0][0];
      expect(callArgs.timeout?.seconds).toBe(2n);
      expect(callArgs.timeout?.nanos).toBe(500_000_000);
    });

    it("should handle timeoutMs less than 1000ms", async () => {
      const ctx = createMockContext();
      const signature = generateTestSignature();
      vi.spyOn(ctx.streaming, "trackTransaction").mockReturnValue(
        (async function* () { yield create(TrackTransactionResponseSchema, {}); })()
      );
      
      trackTransaction(ctx, signature, { timeoutMs: 500 });
      
      const callArgs = (ctx.streaming.trackTransaction as any).mock.calls[0][0];
      expect(callArgs.timeout?.seconds).toBe(0n);
      expect(callArgs.timeout?.nanos).toBe(500_000_000);
    });

    it("should not include timeout when timeoutMs is undefined", async () => {
      const ctx = createMockContext();
      const signature = generateTestSignature();
      vi.spyOn(ctx.streaming, "trackTransaction").mockReturnValue(
        (async function* () { yield create(TrackTransactionResponseSchema, {}); })()
      );
      
      trackTransaction(ctx, signature);
      
      const callArgs = (ctx.streaming.trackTransaction as any).mock.calls[0][0];
      expect(callArgs.timeout).toBeUndefined();
    });

    it("should pass AbortSignal to streaming client", async () => {
      const ctx = createMockContext();
      const signature = generateTestSignature();
      const abortController = new AbortController();
      vi.spyOn(ctx.streaming, "trackTransaction").mockReturnValue(
        (async function* () { yield create(TrackTransactionResponseSchema, {}); })()
      );
      
      trackTransaction(ctx, signature, { signal: abortController.signal });
      
      const callOptions = (ctx.streaming.trackTransaction as any).mock.calls[0][1];
      expect(callOptions.signal).toBe(abortController.signal);
    });

    it("should handle multiple responses", async () => {
      const ctx = createMockContext();
      const responses = [
        create(TrackTransactionResponseSchema, { consensusStatus: ConsensusStatus.OBSERVED }),
        create(TrackTransactionResponseSchema, { consensusStatus: ConsensusStatus.INCLUDED }),
        create(TrackTransactionResponseSchema, { consensusStatus: ConsensusStatus.FINALIZED }),
      ];
      
      vi.spyOn(ctx.streaming, "trackTransaction").mockReturnValue(
        (async function* () {
          for (const response of responses) {
            yield response;
          }
        })()
      );
      
      const signature = generateTestSignature();
      const iterable = trackTransaction(ctx, signature);
      
      const results = [];
      for await (const response of iterable) {
        results.push(response);
      }
      
      expect(results).toHaveLength(3);
      expect(results[0].statusCode).toBe(ConsensusStatus.OBSERVED);
      expect(results[1].statusCode).toBe(ConsensusStatus.INCLUDED);
      expect(results[2].statusCode).toBe(ConsensusStatus.FINALIZED);
    });

    it("should convert execution result when present", async () => {
      const ctx = createMockContext();
      const executionResultProto = create(TransactionExecutionResultSchema, {
        consumedComputeUnits: 10,
        consumedMemoryUnits: 2,
        consumedStateUnits: 1,
        userErrorCode: 0n,
        vmError: 0,
        executionResult: 0n,
        pagesUsed: 1,
        eventsCount: 0,
        eventsSize: 0,
        readwriteAccounts: [],
        readonlyAccounts: [],
      });
      const response = create(TrackTransactionResponseSchema, {
        consensusStatus: ConsensusStatus.INCLUDED,
        executionResult: executionResultProto,
      });

      vi.spyOn(ctx.streaming, "trackTransaction").mockReturnValue(
        (async function* () {
          yield response;
        })()
      );

      const iterator = trackTransaction(ctx, generateTestSignature());
      const updates = [];
      for await (const update of iterator) {
        updates.push(update);
      }

      expect(updates[0].executionResult?.consumedComputeUnits).toBe(10);
    });
  });
});

