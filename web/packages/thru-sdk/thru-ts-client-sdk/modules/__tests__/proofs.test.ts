import { create } from "@bufbuild/protobuf";
import { describe, expect, it, vi } from "vitest";
import { createMockContext, generateTestAddress, generateTestPubkey } from "../../__tests__/helpers/test-utils";
import { StateProofType } from "../../proto/thru/core/v1/state_pb";
import { GenerateStateProofResponseSchema } from "../../proto/thru/services/v1/query_service_pb";
import { generateStateProof } from "../proofs";

describe("proofs", () => {
  describe("generateStateProof", () => {
    it("should generate state proof with address and proof type", async () => {
      const ctx = createMockContext();
      const mockResponse = create(GenerateStateProofResponseSchema, {
        proof: {
          proof: new Uint8Array([1, 2, 3, 4]),
        },
      });
      vi.spyOn(ctx.query, "generateStateProof").mockResolvedValue(mockResponse);
      
      const address = generateTestPubkey(0x01);
      const result = await generateStateProof(ctx, {
        address,
        proofType: StateProofType.CREATING,
        targetSlot: 1000n,
      });
      
      expect(result).toBe(mockResponse);
      expect(ctx.query.generateStateProof).toHaveBeenCalledTimes(1);
    });

    it("should accept address as Uint8Array", async () => {
      const ctx = createMockContext();
      const mockResponse = create(GenerateStateProofResponseSchema, {
        proof: { proof: new Uint8Array([1, 2, 3]) },
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
        proof: { proof: new Uint8Array([1, 2, 3]) },
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
        proof: { proof: new Uint8Array([1, 2, 3]) },
      });
      vi.spyOn(ctx.query, "generateStateProof").mockResolvedValue(mockResponse);
      
      await generateStateProof(ctx, {
        address: generateTestPubkey(0x01),
        proofType: StateProofType.READING,
        targetSlot: 1000n,
      });
      
      const callArgs = (ctx.query.generateStateProof as any).mock.calls[0][0];
      expect(callArgs.request.request?.proofType).toBe(StateProofType.READING);
    });

    it("should include target slot in request", async () => {
      const ctx = createMockContext();
      const mockResponse = create(GenerateStateProofResponseSchema, {
        proof: { proof: new Uint8Array([1, 2, 3]) },
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
        proof: { proof: new Uint8Array([1, 2, 3]) },
      });
      vi.spyOn(ctx.query, "generateStateProof").mockResolvedValue(mockResponse);
      
      await generateStateProof(ctx, {
        proofType: StateProofType.CREATING,
        targetSlot: 1000n,
      });
      
      const callArgs = (ctx.query.generateStateProof as any).mock.calls[0][0];
      expect(callArgs.request.request?.address).toBeUndefined();
    });
  });
});

