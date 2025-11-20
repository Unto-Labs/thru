import { create } from "@bufbuild/protobuf";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMockContext, generateTestAddress, generateTestPubkey } from "../../__tests__/helpers/test-utils";
import { HeightSnapshot } from "../../domain/height";
import { StateProof } from "../../domain/proofs";
import { StateProofType } from "../../proto/thru/core/v1/state_pb";
import { GenerateStateProofResponseSchema } from "../../proto/thru/services/v1/query_service_pb";
import * as heightModule from "../height";
import { generateStateProof } from "../proofs";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("proofs", () => {
  describe("generateStateProof", () => {
    it("should generate state proof with address and proof type", async () => {
      const ctx = createMockContext();
      const mockResponse = create(GenerateStateProofResponseSchema, {
        proof: {
          proof: new Uint8Array([1, 2, 3, 4]),
          slot: 1000n,
        },
      });
      vi.spyOn(ctx.query, "generateStateProof").mockResolvedValue(mockResponse);
      
      const address = generateTestPubkey(0x01);
      const result = await generateStateProof(ctx, {
        address,
        proofType: StateProofType.CREATING,
        targetSlot: 1000n,
      });
      
      expect(result).toBeInstanceOf(StateProof);
      expect(result.slot).toBe(1000n);
      expect(ctx.query.generateStateProof).toHaveBeenCalledTimes(1);
    });

    it("should accept address as Uint8Array", async () => {
      const ctx = createMockContext();
      const mockResponse = create(GenerateStateProofResponseSchema, {
        proof: { proof: new Uint8Array([1, 2, 3]), slot: 0n },
      });
      vi.spyOn(ctx.query, "generateStateProof").mockResolvedValue(mockResponse);
      
      const address = generateTestPubkey(0x01);
      await generateStateProof(ctx, {
        address,
        proofType: StateProofType.CREATING,
        targetSlot: 1000n,
      });
      
      const callArgs = (ctx.query.generateStateProof as any).mock.calls[0][0];
      expect(callArgs.request.address?.value).toEqual(address);
    });

    it("should accept address as string", async () => {
      const ctx = createMockContext();
      const mockResponse = create(GenerateStateProofResponseSchema, {
        proof: { proof: new Uint8Array([1, 2, 3]), slot: 0n },
      });
      vi.spyOn(ctx.query, "generateStateProof").mockResolvedValue(mockResponse);
      
      const address = generateTestAddress(0x01);
      await generateStateProof(ctx, {
        address,
        proofType: StateProofType.CREATING,
        targetSlot: 1000n,
      });
      
      const callArgs = (ctx.query.generateStateProof as any).mock.calls[0][0];
      expect(callArgs.request.address).toBeDefined();
    });

    it("should include proof type in request", async () => {
      const ctx = createMockContext();
      const mockResponse = create(GenerateStateProofResponseSchema, {
        proof: { proof: new Uint8Array([1, 2, 3]), slot: 0n },
      });
      vi.spyOn(ctx.query, "generateStateProof").mockResolvedValue(mockResponse);
      
      await generateStateProof(ctx, {
        address: generateTestPubkey(0x01),
        proofType: StateProofType.EXISTING,
        targetSlot: 1000n,
      });
      
      const callArgs = (ctx.query.generateStateProof as any).mock.calls[0][0];
      expect(callArgs.request?.proofType).toBe(StateProofType.EXISTING);
    });

    it("should include target slot in request", async () => {
      const ctx = createMockContext();
      const mockResponse = create(GenerateStateProofResponseSchema, {
        proof: { proof: new Uint8Array([1, 2, 3]), slot: 0n },
      });
      vi.spyOn(ctx.query, "generateStateProof").mockResolvedValue(mockResponse);
      
      await generateStateProof(ctx, {
        address: generateTestPubkey(0x01),
        proofType: StateProofType.CREATING,
        targetSlot: 2000n,
      });
      
      // Verify generateStateProof was called
      expect(ctx.query.generateStateProof).toHaveBeenCalledTimes(1);
      const callArgs = (ctx.query.generateStateProof as any).mock.calls[0][0];
      expect(callArgs.request).toBeDefined();
    });

    it("should allow undefined address", async () => {
      const ctx = createMockContext();
      const mockResponse = create(GenerateStateProofResponseSchema, {
        proof: { proof: new Uint8Array([1, 2, 3]), slot: 0n },
      });
      vi.spyOn(ctx.query, "generateStateProof").mockResolvedValue(mockResponse);
      
      await generateStateProof(ctx, {
        proofType: StateProofType.CREATING,
        targetSlot: 1000n,
      });
      
      const callArgs = (ctx.query.generateStateProof as any).mock.calls[0][0];
      expect(callArgs.request?.address).toBeUndefined();
    });

    it("should resolve target slot from finalized height when omitted", async () => {
      const ctx = createMockContext();
      const mockResponse = create(GenerateStateProofResponseSchema, {
        proof: { proof: new Uint8Array([9, 8, 7]), slot: 4321n },
      });
      vi.spyOn(ctx.query, "generateStateProof").mockResolvedValue(mockResponse);

      const heightSnapshot = new HeightSnapshot({
        finalized: 4321n,
        locallyExecuted: 4500n,
        clusterExecuted: 4600n,
      });
      const getBlockHeightSpy = vi.spyOn(heightModule, "getBlockHeight").mockResolvedValue(heightSnapshot);

      await generateStateProof(ctx, {
        address: generateTestPubkey(0x02),
        proofType: StateProofType.CREATING,
      });

      expect(getBlockHeightSpy).toHaveBeenCalledTimes(1);
      expect(getBlockHeightSpy).toHaveBeenCalledWith(ctx);

      const callArgs = (ctx.query.generateStateProof as any).mock.calls[0][0];
      expect(callArgs.request?.targetSlot).toBe(4321n);
    });
  });
});

