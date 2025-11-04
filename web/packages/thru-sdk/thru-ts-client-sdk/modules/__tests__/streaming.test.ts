import { create } from "@bufbuild/protobuf";
import { describe, expect, it, vi } from "vitest";
import { createMockContext, generateTestSignature, generateTestSignatureString } from "../../__tests__/helpers/test-utils";
import { ConsensusStatus } from "../../proto/thru/common/v1/consensus_pb";
import { TrackTransactionResponseSchema } from "../../proto/thru/services/v1/streaming_service_pb";
import { trackTransaction } from "../streaming";

describe("streaming", () => {
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
      expect(results[0]).toBe(mockResponse1);
      expect(results[1]).toBe(mockResponse2);
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
      expect(results[0].consensusStatus).toBe(ConsensusStatus.OBSERVED);
      expect(results[1].consensusStatus).toBe(ConsensusStatus.INCLUDED);
      expect(results[2].consensusStatus).toBe(ConsensusStatus.FINALIZED);
    });
  });
});

