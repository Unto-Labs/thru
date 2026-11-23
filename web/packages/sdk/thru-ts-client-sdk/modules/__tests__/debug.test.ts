import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it, vi } from "vitest";
import { createMockContext, generateTestSignature } from "../../__tests__/helpers/test-utils";
import { createBoundThruClient } from "../../core/bound-client";
import { Signature } from "../../domain/primitives";
import {
  DebugReExecuteResponseSchema,
  VmExecutionDetailsSchema,
  VmFaultCode,
} from "@thru/sdk/proto";
import { callStack, reExecuteTransaction } from "../debug";

function frame(programAccIdx: number) {
  return { programAccIdx, programCounter: BigInt(programAccIdx) * 4n };
}

describe("debug", () => {
  describe("reExecuteTransaction", () => {
    it("sends the signature with every include flag off by default", async () => {
      const ctx = createMockContext();
      const response = create(DebugReExecuteResponseSchema, { stdout: "hi", log: "", trace: "" });
      vi.mocked(ctx.debug.debugReExecute).mockResolvedValue(response);
      const signature = generateTestSignature(0x11);

      const result = await reExecuteTransaction(ctx, signature);

      expect(result).toBe(response);
      const [request, options] = vi.mocked(ctx.debug.debugReExecute).mock.calls[0]!;
      expect(request.signature?.value).toEqual(signature);
      expect(request.includeStateBefore).toBe(false);
      expect(request.includeStateAfter).toBe(false);
      expect(request.includeAccountData).toBe(false);
      expect(request.includeMemoryDump).toBe(false);
      expect(options).toBeUndefined();
    });

    it("accepts a ts-encoded signature and passes include flags, call options and the abort signal", async () => {
      const ctx = createMockContext({ callOptions: { timeoutMs: 5000 } });
      vi.mocked(ctx.debug.debugReExecute).mockResolvedValue(create(DebugReExecuteResponseSchema));
      const signature = Signature.from(generateTestSignature(0x22));
      const controller = new AbortController();

      await reExecuteTransaction(ctx, signature.toThruFmt(), {
        includeStateBefore: true,
        includeStateAfter: true,
        includeAccountData: true,
        includeMemoryDump: true,
        signal: controller.signal,
      });

      const [request, options] = vi.mocked(ctx.debug.debugReExecute).mock.calls[0]!;
      expect(request.signature?.value).toEqual(signature.toBytes());
      expect(request.includeStateBefore).toBe(true);
      expect(request.includeStateAfter).toBe(true);
      expect(request.includeAccountData).toBe(true);
      expect(request.includeMemoryDump).toBe(true);
      expect(options?.timeoutMs).toBe(5000);
      expect(options?.signal).toBe(controller.signal);
    });

    it("lets RPC errors through so callers can tell NotFound and Unimplemented apart", async () => {
      const ctx = createMockContext();
      vi.mocked(ctx.debug.debugReExecute).mockRejectedValue(
        new ConnectError("historical account data unavailable", Code.NotFound),
      );
      await expect(reExecuteTransaction(ctx, generateTestSignature())).rejects.toMatchObject({
        code: Code.NotFound,
      });
    });

    it("is bound on the client as debug.reExecute", async () => {
      const ctx = createMockContext();
      vi.mocked(ctx.debug.debugReExecute).mockResolvedValue(create(DebugReExecuteResponseSchema));
      const thru = createBoundThruClient(ctx);
      await thru.debug.reExecute(generateTestSignature());
      expect(ctx.debug.debugReExecute).toHaveBeenCalledTimes(1);
      expect(thru.debug.callStack).toBe(callStack);
    });
  });

  describe("callStack", () => {
    it("drops the sentinel frame and returns root to failing frame", () => {
      /* Program A (1) calls B (2), which calls A again and reverts there. */
      const details = create(VmExecutionDetailsSchema, {
        callDepth: 3n,
        maxCallDepth: 3n,
        faultCode: VmFaultCode.VM_FAULT_REVERT,
        callFrames: [frame(0), frame(1), frame(2), frame(1)],
      });
      expect(callStack(details).map(f => f.programAccIdx)).toEqual([1, 2, 1]);
    });

    it("ignores frames past the call depth", () => {
      const details = create(VmExecutionDetailsSchema, {
        callDepth: 1n,
        callFrames: [frame(0), frame(1), frame(2)],
      });
      expect(callStack(details).map(f => f.programAccIdx)).toEqual([1]);
    });

    it("is empty without execution details or frames", () => {
      expect(callStack(undefined)).toEqual([]);
      expect(callStack(create(VmExecutionDetailsSchema, { callDepth: 0n }))).toEqual([]);
      expect(callStack(create(VmExecutionDetailsSchema, { callDepth: 2n }))).toEqual([]);
    });
  });
});
