import { describe, expect, it, vi } from "vitest";
import { createMockContext, createMockHeightResponse } from "../../__tests__/helpers/test-utils";
import { HeightSnapshot } from "../../domain/height";
import { getBlockHeight } from "../height";

describe("height", () => {
  describe("getBlockHeight", () => {
    it("should return height response", async () => {
      const ctx = createMockContext();
      const mockResponse = createMockHeightResponse({
        finalized: 1000n,
        locallyExecuted: 1001n,
        clusterExecuted: 1002n,
      });
      
      vi.spyOn(ctx.query, "getHeight").mockResolvedValue(mockResponse);
      
      const result = await getBlockHeight(ctx);
      
      expect(result).toBeInstanceOf(HeightSnapshot);
      expect(result.finalized).toBe(1000n);
      expect(result.locallyExecuted).toBe(1001n);
      expect(result.clusterExecuted).toBe(1002n);
      expect(ctx.query.getHeight).toHaveBeenCalledTimes(1);
    });

    it("should create empty request", async () => {
      const ctx = createMockContext();
      const mockResponse = createMockHeightResponse();
      vi.spyOn(ctx.query, "getHeight").mockResolvedValue(mockResponse);
      
      await getBlockHeight(ctx);
      
      const callArgs = (ctx.query.getHeight as any).mock.calls[0][0];
      // Request should be created (empty GetHeightRequest)
      expect(callArgs).toBeDefined();
    });
  });
});

