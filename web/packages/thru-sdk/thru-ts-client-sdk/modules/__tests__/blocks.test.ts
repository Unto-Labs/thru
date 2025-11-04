import { describe, expect, it, vi } from "vitest";
import { createMockBlock, createMockContext, createMockListBlocksResponse } from "../../__tests__/helpers/test-utils";
import { ConsensusStatus } from "../../proto/thru/common/v1/consensus_pb";
import { BlockView } from "../../proto/thru/core/v1/block_pb";
import { getBlock, getRawBlock, listBlocks } from "../blocks";

describe("blocks", () => {
  describe("getBlock", () => {
    it("should get block by slot (number)", async () => {
      const ctx = createMockContext();
      const mockBlock = createMockBlock({ header: { slot: 1000n } });
      vi.spyOn(ctx.query, "getBlock").mockResolvedValue(mockBlock);
      
      const result = await getBlock(ctx, { slot: 1000 });
      
      expect(result).toBe(mockBlock);
      expect(ctx.query.getBlock).toHaveBeenCalledTimes(1);
      const callArgs = (ctx.query.getBlock as any).mock.calls[0][0];
      expect(callArgs.selector.case).toBe("slot");
      expect(callArgs.selector.value).toBe(1000n);
    });

    it("should get block by slot (bigint)", async () => {
      const ctx = createMockContext();
      const mockBlock = createMockBlock({ header: { slot: 1000n } });
      vi.spyOn(ctx.query, "getBlock").mockResolvedValue(mockBlock);
      
      const result = await getBlock(ctx, { slot: 1000n });
      
      expect(result).toBe(mockBlock);
      const callArgs = (ctx.query.getBlock as any).mock.calls[0][0];
      expect(callArgs.selector.case).toBe("slot");
      expect(callArgs.selector.value).toBe(1000n);
    });

    it("should get block by blockHash", async () => {
      const ctx = createMockContext();
      const mockBlock = createMockBlock();
      const blockHash = new Uint8Array(32);
      blockHash.fill(0x42);
      vi.spyOn(ctx.query, "getBlock").mockResolvedValue(mockBlock);
      
      const result = await getBlock(ctx, { blockHash });
      
      expect(result).toBe(mockBlock);
      const callArgs = (ctx.query.getBlock as any).mock.calls[0][0];
      expect(callArgs.selector.case).toBe("blockHash");
      expect(callArgs.selector.value.value).toEqual(blockHash);
    });

    it("should use default view when not provided", async () => {
      const ctx = createMockContext();
      const mockBlock = createMockBlock();
      vi.spyOn(ctx.query, "getBlock").mockResolvedValue(mockBlock);
      
      await getBlock(ctx, { slot: 1000 });
      
      const callArgs = (ctx.query.getBlock as any).mock.calls[0][0];
      expect(callArgs.view).toBe(BlockView.FULL);
    });

    it("should use custom view when provided", async () => {
      const ctx = createMockContext();
      const mockBlock = createMockBlock();
      vi.spyOn(ctx.query, "getBlock").mockResolvedValue(mockBlock);
      
      await getBlock(ctx, { slot: 1000 }, { view: BlockView.HEADER_ONLY });
      
      const callArgs = (ctx.query.getBlock as any).mock.calls[0][0];
      expect(callArgs.view).toBe(BlockView.HEADER_ONLY);
    });

    it("should use default minConsensus when not provided", async () => {
      const ctx = createMockContext();
      const mockBlock = createMockBlock();
      vi.spyOn(ctx.query, "getBlock").mockResolvedValue(mockBlock);
      
      await getBlock(ctx, { slot: 1000 });
      
      const callArgs = (ctx.query.getBlock as any).mock.calls[0][0];
      expect(callArgs.minConsensus).toBe(ConsensusStatus.UNSPECIFIED);
    });

    it("should use custom minConsensus when provided", async () => {
      const ctx = createMockContext();
      const mockBlock = createMockBlock();
      vi.spyOn(ctx.query, "getBlock").mockResolvedValue(mockBlock);
      
      await getBlock(ctx, { slot: 1000 }, { minConsensus: ConsensusStatus.FINALIZED });
      
      const callArgs = (ctx.query.getBlock as any).mock.calls[0][0];
      expect(callArgs.minConsensus).toBe(ConsensusStatus.FINALIZED);
    });
  });

  describe("getRawBlock", () => {
    it("should get raw block by slot", async () => {
      const ctx = createMockContext();
      const mockRawBlock = { slot: 1000n, rawBlock: new Uint8Array([1, 2, 3]) };
      vi.spyOn(ctx.query, "getRawBlock").mockResolvedValue(mockRawBlock as any);
      
      const result = await getRawBlock(ctx, { slot: 1000 });
      
      expect(result).toBe(mockRawBlock);
      expect(ctx.query.getRawBlock).toHaveBeenCalledTimes(1);
    });

    it("should get raw block by blockHash", async () => {
      const ctx = createMockContext();
      const blockHash = new Uint8Array(32);
      blockHash.fill(0x42);
      const mockRawBlock = { slot: 1000n, rawBlock: new Uint8Array([1, 2, 3]) };
      vi.spyOn(ctx.query, "getRawBlock").mockResolvedValue(mockRawBlock as any);
      
      const result = await getRawBlock(ctx, { blockHash });
      
      expect(result).toBe(mockRawBlock);
      const callArgs = (ctx.query.getRawBlock as any).mock.calls[0][0];
      expect(callArgs.selector.case).toBe("blockHash");
    });

    it("should use default minConsensus", async () => {
      const ctx = createMockContext();
      const mockRawBlock = { slot: 1000n, rawBlock: new Uint8Array() };
      vi.spyOn(ctx.query, "getRawBlock").mockResolvedValue(mockRawBlock as any);
      
      await getRawBlock(ctx, { slot: 1000 });
      
      const callArgs = (ctx.query.getRawBlock as any).mock.calls[0][0];
      expect(callArgs.minConsensus).toBe(ConsensusStatus.UNSPECIFIED);
    });
  });

  describe("listBlocks", () => {
    it("should list blocks with default options", async () => {
      const ctx = createMockContext();
      const mockResponse = createMockListBlocksResponse();
      vi.spyOn(ctx.query, "listBlocks").mockResolvedValue(mockResponse);
      
      const result = await listBlocks(ctx);
      
      expect(result).toBe(mockResponse);
      expect(ctx.query.listBlocks).toHaveBeenCalledTimes(1);
      const callArgs = (ctx.query.listBlocks as any).mock.calls[0][0];
      expect(callArgs.view).toBe(BlockView.FULL);
      expect(callArgs.minConsensus).toBe(ConsensusStatus.UNSPECIFIED);
    });

    it("should list blocks with custom view", async () => {
      const ctx = createMockContext();
      const mockResponse = createMockListBlocksResponse();
      vi.spyOn(ctx.query, "listBlocks").mockResolvedValue(mockResponse);
      
      await listBlocks(ctx, { view: BlockView.HEADER_ONLY });
      
      const callArgs = (ctx.query.listBlocks as any).mock.calls[0][0];
      expect(callArgs.view).toBe(BlockView.HEADER_ONLY);
    });

    it("should list blocks with filter", async () => {
      const ctx = createMockContext();
      const mockResponse = createMockListBlocksResponse();
      const filter = { expression: "slot > 1000" };
      vi.spyOn(ctx.query, "listBlocks").mockResolvedValue(mockResponse);
      
      await listBlocks(ctx, { filter: filter as any });
      
      const callArgs = (ctx.query.listBlocks as any).mock.calls[0][0];
      expect(callArgs.filter).toBeDefined();
      expect(callArgs.filter.expression).toBe("slot > 1000");
    });

    it("should list blocks with pagination", async () => {
      const ctx = createMockContext();
      const mockResponse = createMockListBlocksResponse();
      const page = { pageSize: 10, pageToken: "token" };
      vi.spyOn(ctx.query, "listBlocks").mockResolvedValue(mockResponse);
      
      await listBlocks(ctx, { page: page as any });
      
      const callArgs = (ctx.query.listBlocks as any).mock.calls[0][0];
      expect(callArgs.page).toBeDefined();
      expect(callArgs.page.pageSize).toBe(10);
      expect(callArgs.page.pageToken).toBe("token");
    });

    it("should list blocks with custom minConsensus", async () => {
      const ctx = createMockContext();
      const mockResponse = createMockListBlocksResponse();
      vi.spyOn(ctx.query, "listBlocks").mockResolvedValue(mockResponse);
      
      await listBlocks(ctx, { minConsensus: ConsensusStatus.FINALIZED });
      
      const callArgs = (ctx.query.listBlocks as any).mock.calls[0][0];
      expect(callArgs.minConsensus).toBe(ConsensusStatus.FINALIZED);
    });
  });
});

