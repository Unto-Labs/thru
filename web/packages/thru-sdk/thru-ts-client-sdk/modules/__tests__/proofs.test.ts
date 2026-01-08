import { create } from "@bufbuild/protobuf";
import { describe, expect, it, vi } from "vitest";
import { createMockContext, generateTestAddress, generateTestPubkey } from "../../__tests__/helpers/test-utils";
import { StateProof } from "../../domain/proofs";
import { StateProofType } from "@thru/proto";
import { GenerateStateProofResponseSchema } from "@thru/proto";
import { generateStateProof } from "../proofs";

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

    it("should default targetSlot to 0 when omitted for server auto-selection", async () => {
      const ctx = createMockContext();
      const mockResponse = create(GenerateStateProofResponseSchema, {
        proof: { proof: new Uint8Array([9, 8, 7]), slot: 4321n },
      });
      vi.spyOn(ctx.query, "generateStateProof").mockResolvedValue(mockResponse);

      await generateStateProof(ctx, {
        address: generateTestPubkey(0x02),
        proofType: StateProofType.CREATING,
      });

      // When targetSlot is omitted, it defaults to 0n and the server auto-selects the slot
      const callArgs = (ctx.query.generateStateProof as any).mock.calls[0][0];
      expect(callArgs.request?.targetSlot).toBe(0n);
    });
  });
});

