import { create } from "@bufbuild/protobuf";
import { Code } from "@connectrpc/connect";
import { describe, expect, it, vi } from "vitest";
import { createMockContext, generateTestAddress, generateTestPubkey } from "../../__tests__/helpers/test-utils";
import { StateProof } from "../../domain/proofs";
import { StateProofType } from "@thru/sdk/proto";
import { GenerateStateProofResponseSchema, BatchGenerateStateProofsResponseSchema } from "@thru/sdk/proto";
import { generateStateProof, generateStateProofs } from "../proofs";

describe("proofs", () => {
  describe("generateStateProofs", () => {
    it("preserves positional successes, duplicate addresses and per-item errors", async () => {
      const ctx = createMockContext();
      vi.mocked(ctx.query.batchGenerateStateProofs).mockResolvedValue(create(BatchGenerateStateProofsResponseSchema, {
        results: [{ proof: { proof: new Uint8Array([1]), slot: 100n } },
          { errorCode: Code.NotFound, errorMessage: "missing leaf" },
          { proof: { proof: new Uint8Array([3]), slot: 100n } }],
      }));
      const request = { address: generateTestAddress(1), proofType: StateProofType.EXISTING };
      const results = await generateStateProofs(ctx, { requests: [request, request, request], targetSlot: 100n });
      expect(results.map(result => result.proof?.proof[0])).toEqual([1, undefined, 3]);
      expect(results[1]?.error?.code).toBe(Code.NotFound);
      const sent = vi.mocked(ctx.query.batchGenerateStateProofs).mock.calls[0]![0];
      expect(sent.targetSlot).toBe(100n);
      expect(sent.requests?.every(request => request.targetSlot === undefined)).toBe(true);
    });

    it("chunks above 1000 and pins later chunks to the first usable root", async () => {
      const ctx = createMockContext();
      vi.mocked(ctx.query.batchGenerateStateProofs).mockImplementation(async request =>
        create(BatchGenerateStateProofsResponseSchema, {
          results: request.requests?.map(() => ({ proof: { proof: new Uint8Array([1]), slot: 123n } })),
        }));
      const results = await generateStateProofs(ctx, { requests: Array.from({ length: 1001 }, () => ({
        address: generateTestAddress(2), proofType: StateProofType.CREATING,
      })) });
      expect(results).toHaveLength(1001);
      const calls = vi.mocked(ctx.query.batchGenerateStateProofs).mock.calls;
      expect(calls.map(([request]) => request.requests?.length)).toEqual([1000, 1]);
      expect(calls.map(([request]) => request.targetSlot)).toEqual([0n, 123n]);
    });

    it("makes no request for an empty list and rejects malformed positional responses", async () => {
      const ctx = createMockContext();
      expect(await generateStateProofs(ctx, { requests: [] })).toEqual([]);
      expect(ctx.query.batchGenerateStateProofs).not.toHaveBeenCalled();
      vi.mocked(ctx.query.batchGenerateStateProofs).mockResolvedValue(create(BatchGenerateStateProofsResponseSchema, { results: [] }));
      await expect(generateStateProofs(ctx, { requests: [{ proofType: StateProofType.CREATING }] })).rejects.toThrow("result count");
      vi.mocked(ctx.query.batchGenerateStateProofs).mockResolvedValue(create(BatchGenerateStateProofsResponseSchema, { results: [{}] }));
      await expect(generateStateProofs(ctx, { requests: [{ proofType: StateProofType.CREATING }] })).rejects.toThrow("either a proof or an error");
    });
  });
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
