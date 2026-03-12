import { BaseScenario } from "../framework/scenario";
import type { TestContext } from "../framework/context";
import type { TestResult } from "../framework/result";
import type { GenesisAccount } from "../accounts";
import { trackTransactionUntilFinalized, pollForTransaction } from "../utils/timing";
import {
  EVENT_PROGRAM,
  EVENT_COMPUTE_UNITS,
  EVENT_STATE_UNITS,
  EVENT_MEMORY_UNITS,
  EVENT_EXPIRY,
  buildMessageEventInstruction,
  buildCounterEventInstruction,
} from "../programs";
import {
  DEBUG_TEST_PROGRAM_A,
  DEBUG_TEST_PROGRAM_B,
  DEBUG_TEST_SCRATCH,
  DEBUG_TEST_CU,
  DEBUG_TEST_SU,
  DEBUG_TEST_MU,
  DEBUG_TEST_EXPIRY,
  buildDebugTestSuccessInstruction,
  buildDebugTestRevertInstruction,
  buildDebugTestSegfaultInstruction,
  buildDebugTestExhaustCUInstruction,
  buildDebugTestRecursiveCPIInstruction,
  buildDebugTestRecursiveCPIRevertInstruction,
  buildDebugTestEmitEventsThenRevertInstruction,
  buildDebugTestWriteScratchInstruction,
} from "../programs";
import {
  DebugService,
  DebugReExecuteRequestSchema,
  VmFaultCode,
  type DebugReExecuteResponse,
} from "@thru/proto";
import { create } from "@bufbuild/protobuf";
import { decodeSignature } from "@thru/helpers";
import type { Client } from "@connectrpc/connect";

type DebugClient = Client<typeof DebugService>;

/**
 * DebugReExecuteScenario tests the DebugService.DebugReExecute RPC method.
 *
 * REQUIREMENTS:
 * - The debug service must be enabled in thrud (debug.enabled = true)
 * - ClickHouse must be running and populated
 */
export class DebugReExecuteScenario extends BaseScenario {
  name = "DebugReExecute";
  description = "Tests DebugService.DebugReExecute RPC for re-executing transactions with stdout, log, trace capture, VM state, and account snapshots";

  private alice: GenesisAccount | null = null;
  private aliceNonce: bigint = 0n;

  async setup(ctx: TestContext): Promise<void> {
    this.alice = ctx.genesisAccount;
    ctx.logInfo("Using alice: %s", this.alice.publicKeyString);
    await ctx.accountStateTracker.subscribeAccount(this.alice.publicKeyString);
    const acct = await ctx.sdk.accounts.get(this.alice.publicKeyString);
    this.aliceNonce = acct?.meta?.nonce ?? 0n;
  }

  async execute(ctx: TestContext): Promise<TestResult> {
    const result: TestResult = {
      success: true,
      message: "DebugReExecute test passed",
      details: [],
      verificationDetails: [],
      executionTimeMs: 0,
    };

    // Create debug service client
    const { createGrpcTransport } = await import("@connectrpc/connect-node");
    const { createClient } = await import("@connectrpc/connect");
    const transport = createGrpcTransport({ baseUrl: ctx.config.baseUrl });
    const debugClient: DebugClient = createClient(DebugService, transport);

    ctx.logInfo("Phase 1: Testing stdout capture from event emission transaction");
    const p1 = await this.testCaptureStdout(ctx, debugClient, result);
    if (!p1.success) return p1;

    ctx.logInfo("Phase 2: Testing trace capture");
    const p2 = await this.testCaptureTrace(ctx, debugClient, result);
    if (!p2.success) return p2;

    ctx.logInfo("Phase 3: Testing capture with multiple events");
    const p3 = await this.testCaptureMultipleEvents(ctx, debugClient, result);
    if (!p3.success) return p3;

    ctx.logInfo("Phase 4: Testing transaction details in response");
    const p4 = await this.testTransactionDetails(ctx, debugClient, result);
    if (!p4.success) return p4;

    ctx.logInfo("Phase 5: Testing VM execution details");
    const p5 = await this.testExecutionDetails(ctx, debugClient, result);
    if (!p5.success) return p5;

    ctx.logInfo("Phase 6: Testing state_before snapshots");
    const p6 = await this.testStateBefore(ctx, debugClient, result);
    if (!p6.success) return p6;

    ctx.logInfo("Phase 7: Testing state_after snapshots");
    const p7 = await this.testStateAfter(ctx, debugClient, result);
    if (!p7.success) return p7;

    ctx.logInfo("Phase 8: Testing revert with partial output");
    const p8 = await this.testRevertWithPartialOutput(ctx, debugClient, result);
    if (!p8.success) return p8;

    ctx.logInfo("Phase 9: Testing segfault detection");
    const p9 = await this.testSegfault(ctx, debugClient, result);
    if (!p9.success) return p9;

    ctx.logInfo("Phase 10: Testing deep call stack");
    const p10 = await this.testDeepCallStack(ctx, debugClient, result);
    if (!p10.success) return p10;

    ctx.logInfo("Phase 11: Testing compute exhaustion");
    const p11 = await this.testComputeExhaustion(ctx, debugClient, result);
    if (!p11.success) return p11;

    ctx.logInfo("Phase 12: Testing mid-block re-execute state correctness");
    const p12 = await this.testMidBlockState(ctx, debugClient, result);
    if (!p12.success) return p12;

    result.message = "Successfully tested DebugReExecute with capture, VM state, account snapshots, and error modes";
    return result;
  }

  /** Submit an event message tx and wait for success, returning the signature string. */
  private async submitEventMessageTx(ctx: TestContext, message: string): Promise<string> {
    const height = await ctx.sdk.blocks.getBlockHeight();
    const instruction = buildMessageEventInstruction(1, message);
    const tx = await ctx.sdk.transactions.buildAndSign({
      feePayer: { publicKey: this.alice!.publicKey, privateKey: this.alice!.seed },
      program: EVENT_PROGRAM,
      header: {
        fee: 1n, nonce: this.aliceNonce, startSlot: height.finalized,
        expiryAfter: EVENT_EXPIRY, computeUnits: EVENT_COMPUTE_UNITS,
        stateUnits: EVENT_STATE_UNITS, memoryUnits: EVENT_MEMORY_UNITS,
        chainId: ctx.config.chainId,
      },
      instructionData: instruction,
    });
    const signature = tx.signature.toThruFmt();
    const trackPromise = trackTransactionUntilFinalized(ctx.sdk, signature);
    await ctx.blockSender.sendAsBlock([tx.rawTransaction]);
    this.aliceNonce++;
    const status = (await trackPromise) as any;
    if (status?.executionResult?.vmError !== 0) {
      throw new Error(`event message tx failed: vmError=${status?.executionResult?.vmError}`);
    }
    return signature;
  }

  /** Submit a debug test tx (program A) and wait for success, returning the signature string. */
  private async submitDebugTestTx(
    ctx: TestContext,
    instruction: Uint8Array,
    opts?: { readOnly?: Uint8Array[]; readWrite?: Uint8Array[]; expectFailure?: boolean },
  ): Promise<string> {
    const height = await ctx.sdk.blocks.getBlockHeight();
    const accounts: any = {};
    if (opts?.readOnly) accounts.readOnly = opts.readOnly;
    if (opts?.readWrite) accounts.readWrite = opts.readWrite;
    const tx = await ctx.sdk.transactions.buildAndSign({
      feePayer: { publicKey: this.alice!.publicKey, privateKey: this.alice!.seed },
      program: DEBUG_TEST_PROGRAM_A,
      header: {
        fee: 1n, nonce: this.aliceNonce, startSlot: height.finalized,
        expiryAfter: DEBUG_TEST_EXPIRY, computeUnits: DEBUG_TEST_CU,
        stateUnits: DEBUG_TEST_SU, memoryUnits: DEBUG_TEST_MU,
        chainId: ctx.config.chainId,
      },
      accounts,
      instructionData: instruction,
    });
    const signature = tx.signature.toThruFmt();
    const trackPromise = trackTransactionUntilFinalized(ctx.sdk, signature);
    await ctx.blockSender.sendAsBlock([tx.rawTransaction]);
    this.aliceNonce++;
    const status = (await trackPromise) as any;
    if (!opts?.expectFailure && status?.executionResult?.vmError !== 0) {
      throw new Error(`debug test tx failed: vmError=${status?.executionResult?.vmError}`);
    }
    return signature;
  }

  private async debugReExecute(
    debugClient: DebugClient,
    signatureStr: string,
    opts?: { includeStateBefore?: boolean; includeStateAfter?: boolean; includeAccountData?: boolean; includeMemoryDump?: boolean },
  ): Promise<DebugReExecuteResponse> {
    const sigBytes = decodeSignature(signatureStr);
    const req = create(DebugReExecuteRequestSchema, {
      signature: { value: sigBytes },
      includeStateBefore: opts?.includeStateBefore ?? false,
      includeStateAfter: opts?.includeStateAfter ?? false,
      includeAccountData: opts?.includeAccountData ?? false,
      includeMemoryDump: opts?.includeMemoryDump ?? false,
    });

    const timeoutMs = 15000;
    const intervalMs = 500;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      try {
        return await debugClient.debugReExecute(req);
      } catch (err: any) {
        // NotFound (code 5) means ClickHouse hasn't ingested the tx yet — retry
        if (err?.code === 5 && Date.now() + intervalMs < deadline) {
          await new Promise((r) => setTimeout(r, intervalMs));
          continue;
        }
        throw err;
      }
    }
    throw new Error(`debugReExecute timed out after ${timeoutMs}ms waiting for transaction ingestion`);
  }

  private fail(result: TestResult, message: string): TestResult {
    return { ...result, success: false, message };
  }

  // Phase 1: Stdout capture from event emission
  private async testCaptureStdout(ctx: TestContext, debugClient: DebugClient, result: TestResult): Promise<TestResult> {
    const sig = await this.submitEventMessageTx(ctx, "Hello from debug capture test!");
    ctx.logInfo("Submitted transaction: %s", sig.slice(0, 16));
    const resp = await this.debugReExecute(debugClient, sig);
    if (!resp.stdout || resp.stdout.length === 0) {
      return this.fail(result, "expected stdout capture, got empty string");
    }
    ctx.logInfo("Captured stdout (%d bytes)", resp.stdout.length);
    result.verificationDetails.push(`✓ Captured stdout (${resp.stdout.length} bytes)`);
    result.details.push("Stdout capture successful");
    return result;
  }

  // Phase 2: Trace capture
  private async testCaptureTrace(ctx: TestContext, debugClient: DebugClient, result: TestResult): Promise<TestResult> {
    const sig = await this.submitEventMessageTx(ctx, "Trace test message");
    ctx.logInfo("Submitted transaction: %s", sig.slice(0, 16));
    const resp = await this.debugReExecute(debugClient, sig);
    if (!resp.trace || resp.trace.length === 0) {
      return this.fail(result, "expected trace capture, got empty string");
    }
    ctx.logInfo("Captured trace (%d bytes)", resp.trace.length);
    if (!resp.stdout || resp.stdout.length === 0) {
      return this.fail(result, "expected stdout capture in trace mode, got empty string");
    }
    result.verificationDetails.push(`✓ Captured trace (${resp.trace.length} bytes)`);
    result.verificationDetails.push(`✓ Captured stdout (${resp.stdout.length} bytes)`);
    result.details.push("Trace capture successful");
    return result;
  }

  // Phase 3: Multiple events capture
  private async testCaptureMultipleEvents(ctx: TestContext, debugClient: DebugClient, result: TestResult): Promise<TestResult> {
    const height = await ctx.sdk.blocks.getBlockHeight();
    const instruction = buildCounterEventInstruction(5);
    const tx = await ctx.sdk.transactions.buildAndSign({
      feePayer: { publicKey: this.alice!.publicKey, privateKey: this.alice!.seed },
      program: EVENT_PROGRAM,
      header: {
        fee: 1n, nonce: this.aliceNonce, startSlot: height.finalized,
        expiryAfter: EVENT_EXPIRY, computeUnits: EVENT_COMPUTE_UNITS,
        stateUnits: EVENT_STATE_UNITS, memoryUnits: EVENT_MEMORY_UNITS,
        chainId: ctx.config.chainId,
      },
      instructionData: instruction,
    });
    const signature = tx.signature.toThruFmt();
    const trackPromise = trackTransactionUntilFinalized(ctx.sdk, signature);
    await ctx.blockSender.sendAsBlock([tx.rawTransaction]);
    this.aliceNonce++;
    await trackPromise;

    ctx.logInfo("Submitted counter transaction: %s", signature.slice(0, 16));
    const resp = await this.debugReExecute(debugClient, signature);
    const total = (resp.stdout?.length ?? 0) + (resp.log?.length ?? 0) + (resp.trace?.length ?? 0);
    if (total === 0) {
      return this.fail(result, "expected some captured output, got nothing");
    }
    ctx.logInfo("Multiple events: stdout=%d bytes, log=%d bytes, trace=%d bytes", resp.stdout?.length ?? 0, resp.log?.length ?? 0, resp.trace?.length ?? 0);
    result.verificationDetails.push(`✓ Multiple events: total captured ${total} bytes`);
    result.details.push("Multiple events capture successful");
    return result;
  }

  // Phase 4: Transaction details
  private async testTransactionDetails(ctx: TestContext, debugClient: DebugClient, result: TestResult): Promise<TestResult> {
    const sig = await this.submitEventMessageTx(ctx, "Transaction details test");
    ctx.logInfo("Submitted transaction: %s", sig.slice(0, 16));
    const resp = await this.debugReExecute(debugClient, sig);
    if (!resp.transaction) return this.fail(result, "expected transaction details, got nil");
    const txn = resp.transaction as any;
    if (!txn.header) return this.fail(result, "expected transaction header, got nil");
    if (!txn.header.feePayerPubkey) return this.fail(result, "expected fee payer pubkey, got nil");
    const fpBytes = txn.header.feePayerPubkey.value;
    if (!fpBytes || fpBytes.length !== 32) {
      return this.fail(result, `expected 32-byte fee payer pubkey, got ${fpBytes?.length ?? 0} bytes`);
    }
    for (let i = 0; i < 32; i++) {
      if (fpBytes[i] !== this.alice!.publicKey[i]) {
        return this.fail(result, `fee payer pubkey mismatch at byte ${i}`);
      }
    }
    result.verificationDetails.push("✓ Transaction details returned correctly");
    result.verificationDetails.push(`✓ Fee payer verified`);
    result.details.push("Transaction details verification successful");
    return result;
  }

  // Phase 5: VM execution details
  private async testExecutionDetails(ctx: TestContext, debugClient: DebugClient, result: TestResult): Promise<TestResult> {
    const sig = await this.submitDebugTestTx(ctx, buildDebugTestSuccessInstruction("execution details test"));
    ctx.logInfo("Submitted debug test success txn: %s", sig.slice(0, 16));
    const resp = await this.debugReExecute(debugClient, sig);
    const ed = resp.executionDetails;
    if (!ed) return this.fail(result, "expected execution_details, got nil");
    if (ed.executionCode !== 0n) return this.fail(result, `expected execution_code 0, got ${ed.executionCode}`);
    if (ed.registers.length !== 32) return this.fail(result, `expected 32 registers, got ${ed.registers.length}`);
    if (ed.programCounter === 0n) return this.fail(result, "expected non-zero program_counter");
    if (ed.instructionCounter === 0n) return this.fail(result, "expected non-zero instruction_counter");
    if (ed.computeUnitsConsumed === 0n) return this.fail(result, "expected non-zero compute_units_consumed");
    ctx.logInfo("Execution details: code=%s pc=%s ic=%s cu=%s regs=%d fault=%d",
      ed.executionCode, ed.programCounter, ed.instructionCounter, ed.computeUnitsConsumed, ed.registers.length, ed.faultCode);
    result.verificationDetails.push(`✓ Execution details: code=${ed.executionCode} pc=${ed.programCounter} ic=${ed.instructionCounter} cu=${ed.computeUnitsConsumed}`);
    result.details.push("Execution details verification successful");
    return result;
  }

  // Phase 6: state_before snapshots
  private async testStateBefore(ctx: TestContext, debugClient: DebugClient, result: TestResult): Promise<TestResult> {
    const sig = await this.submitDebugTestTx(ctx, buildDebugTestSuccessInstruction("state before test"));
    ctx.logInfo("Submitted txn for state_before: %s", sig.slice(0, 16));
    const resp = await this.debugReExecute(debugClient, sig, { includeStateBefore: true, includeAccountData: true });
    if (resp.stateBefore.length === 0) return this.fail(result, "expected state_before snapshots, got empty");
    const fpSnap = resp.stateBefore.find((s) => s.address && bytesEqual(s.address.value, this.alice!.publicKey));
    if (!fpSnap) return this.fail(result, "fee payer not found in state_before snapshots");
    if (!fpSnap.exists) return this.fail(result, "expected fee payer to exist in state_before");
    if (!fpSnap.meta) return this.fail(result, "expected fee payer meta in state_before");
    ctx.logInfo("state_before: %d snapshots, fee_payer nonce=%s balance=%s",
      resp.stateBefore.length, fpSnap.meta.nonce, fpSnap.meta.balance);
    result.verificationDetails.push(`✓ state_before: ${resp.stateBefore.length} account snapshots`);
    result.details.push("State before verification successful");
    return result;
  }

  // Phase 7: state_after snapshots
  private async testStateAfter(ctx: TestContext, debugClient: DebugClient, result: TestResult): Promise<TestResult> {
    const sig = await this.submitDebugTestTx(ctx, buildDebugTestSuccessInstruction("state after test"));
    ctx.logInfo("Submitted txn for state_after: %s", sig.slice(0, 16));
    const resp = await this.debugReExecute(debugClient, sig, { includeStateAfter: true });
    if (resp.stateAfter.length === 0) return this.fail(result, "expected state_after snapshots, got empty");
    const fpSnap = resp.stateAfter.find((s) => s.address && bytesEqual(s.address.value, this.alice!.publicKey));
    if (!fpSnap) return this.fail(result, "fee payer not found in state_after snapshots");
    if (!fpSnap.exists) return this.fail(result, "expected fee payer to exist in state_after");
    ctx.logInfo("state_after: %d snapshots, fee_payer exists=%s", resp.stateAfter.length, fpSnap.exists);
    result.verificationDetails.push(`✓ state_after: ${resp.stateAfter.length} account snapshots`);
    result.details.push("State after verification successful");
    return result;
  }

  // Phase 8: Revert with partial output
  private async testRevertWithPartialOutput(ctx: TestContext, debugClient: DebugClient, result: TestResult): Promise<TestResult> {
    const errorCode = 42;
    const sig = await this.submitDebugTestTx(
      ctx,
      buildDebugTestEmitEventsThenRevertInstruction(3, errorCode),
      { expectFailure: true },
    );
    ctx.logInfo("Submitted emit-then-revert txn: %s", sig.slice(0, 16));
    const resp = await this.debugReExecute(debugClient, sig);
    const ed = resp.executionDetails;
    if (!ed) return this.fail(result, "expected execution_details, got nil");
    if (ed.faultCode === VmFaultCode.VM_FAULT_NONE) {
      return this.fail(result, "expected non-zero fault_code for revert, got 0");
    }
    if (ed.userErrorCode !== BigInt(errorCode)) {
      return this.fail(result, `expected user_error_code ${errorCode}, got ${ed.userErrorCode}`);
    }
    if (!resp.stdout || resp.stdout.length === 0) {
      ctx.logInfo("Note: stdout is empty (events may not produce stdout)");
    }
    ctx.logInfo("Revert test: fault=%d user_error=%s stdout=%d bytes", ed.faultCode, ed.userErrorCode, resp.stdout?.length ?? 0);
    result.verificationDetails.push(`✓ Revert: fault=${ed.faultCode} user_error=${ed.userErrorCode}`);
    result.details.push("Revert with partial output verification successful");
    return result;
  }

  // Phase 9: Segfault detection
  private async testSegfault(ctx: TestContext, debugClient: DebugClient, result: TestResult): Promise<TestResult> {
    const sig = await this.submitDebugTestTx(ctx, buildDebugTestSegfaultInstruction(), { expectFailure: true });
    ctx.logInfo("Submitted segfault txn: %s", sig.slice(0, 16));
    const resp = await this.debugReExecute(debugClient, sig);
    const ed = resp.executionDetails;
    if (!ed) return this.fail(result, "expected execution_details, got nil");
    if (ed.executionCode === 0n) return this.fail(result, "expected non-zero execution_code for segfault, got 0");
    if (ed.programCounter === 0n) return this.fail(result, "expected non-zero program_counter at crash location");
    ctx.logInfo("Segfault test: exec_code=%s fault=%d segv_vaddr=%s segv_sz=%s pc=%s",
      ed.executionCode, ed.faultCode, ed.segvVaddr, ed.segvSize, ed.programCounter);
    result.verificationDetails.push(`✓ Segfault: exec_code=${ed.executionCode} segv_vaddr=${ed.segvVaddr} pc=${ed.programCounter}`);
    result.details.push("Segfault detection verification successful");
    return result;
  }

  // Phase 10: Deep call stack (3 sub-tests)
  private async testDeepCallStack(ctx: TestContext, debugClient: DebugClient, result: TestResult): Promise<TestResult> {
    // Sub-test A: Normal CPI (depth=4)
    ctx.logInfo("Phase 10a: Normal CPI (depth=4)");
    const sigA = await this.submitDebugTestTx(ctx, buildDebugTestRecursiveCPIInstruction(4), { readOnly: [DEBUG_TEST_PROGRAM_B] });
    ctx.logInfo("Submitted normal CPI txn (depth=4): %s", sigA.slice(0, 16));
    const respA = await this.debugReExecute(debugClient, sigA);
    const edA = respA.executionDetails;
    if (!edA) return this.fail(result, "expected execution_details for normal CPI, got nil");
    if (edA.callDepth !== 1n) return this.fail(result, `normal CPI: expected call_depth=1, got ${edA.callDepth}`);
    if (edA.maxCallDepth !== 5n) return this.fail(result, `normal CPI: expected max_call_depth=5, got ${edA.maxCallDepth}`);
    if (edA.faultCode !== VmFaultCode.VM_FAULT_REVERT) return this.fail(result, `normal CPI: expected fault_code=VM_FAULT_REVERT, got ${edA.faultCode}`);
    if (edA.callFrames.length !== 2) return this.fail(result, `normal CPI: expected 2 call_frames, got ${edA.callFrames.length}`);
    ctx.logInfo("Normal CPI: call_depth=%s max_call_depth=%s fault=%d frames=%d", edA.callDepth, edA.maxCallDepth, edA.faultCode, edA.callFrames.length);
    result.verificationDetails.push(`✓ Normal CPI: call_depth=${edA.callDepth} max_call_depth=${edA.maxCallDepth} frames=${edA.callFrames.length}`);

    // Sub-test B: CPI with revert at leaf (depth=2)
    ctx.logInfo("Phase 10b: CPI with revert at leaf (depth=2)");
    const sigB = await this.submitDebugTestTx(ctx, buildDebugTestRecursiveCPIRevertInstruction(2, 0), { readOnly: [DEBUG_TEST_PROGRAM_B], expectFailure: true });
    ctx.logInfo("Submitted revert CPI txn (depth=2): %s", sigB.slice(0, 16));
    const respB = await this.debugReExecute(debugClient, sigB);
    const edB = respB.executionDetails;
    if (!edB) return this.fail(result, "expected execution_details for revert CPI, got nil");
    if (edB.callDepth !== 3n) return this.fail(result, `revert CPI: expected call_depth=3, got ${edB.callDepth}`);
    if (edB.maxCallDepth !== 3n) return this.fail(result, `revert CPI: expected max_call_depth=3, got ${edB.maxCallDepth}`);
    if (edB.faultCode !== VmFaultCode.VM_FAULT_REVERT) return this.fail(result, `revert CPI: expected fault_code=VM_FAULT_REVERT, got ${edB.faultCode}`);
    if (edB.callFrames.length !== 4) return this.fail(result, `revert CPI: expected 4 call_frames, got ${edB.callFrames.length}`);

    // Verify frame program_acc_idx values: [0, 1, 2, 1]
    const expectedAccIdx = [0, 1, 2, 1];
    for (let i = 0; i < expectedAccIdx.length; i++) {
      if (edB.callFrames[i].programAccIdx !== expectedAccIdx[i]) {
        return this.fail(result, `revert CPI: call_frames[${i}].programAccIdx=${edB.callFrames[i].programAccIdx}, expected ${expectedAccIdx[i]}`);
      }
    }

    // Verify non-sentinel frames (1-3) have 32 saved registers with valid stack pointers
    for (let i = 1; i < edB.callFrames.length; i++) {
      if (edB.callFrames[i].savedRegisters.length !== 32) {
        return this.fail(result, `revert CPI: call_frames[${i}].savedRegisters has ${edB.callFrames[i].savedRegisters.length} entries, expected 32`);
      }
      const sp = edB.callFrames[i].savedRegisters[2];
      const segType = sp >> 40n;
      if (segType !== 0x05n) {
        return this.fail(result, `revert CPI: call_frames[${i}].savedRegisters[2] (sp) seg_type=0x${segType.toString(16)}, expected 0x05`);
      }
    }

    // Verify sentinel frame (index 0) has 32 all-zero registers
    if (edB.callFrames[0].savedRegisters.length !== 32) {
      return this.fail(result, `revert CPI: sentinel frame has ${edB.callFrames[0].savedRegisters.length} saved registers, expected 32`);
    }
    for (let j = 0; j < edB.callFrames[0].savedRegisters.length; j++) {
      if (edB.callFrames[0].savedRegisters[j] !== 0n) {
        return this.fail(result, `revert CPI: sentinel frame savedRegisters[${j}]=${edB.callFrames[0].savedRegisters[j]}, expected 0`);
      }
    }

    // Verify active frame has valid StackPointer and ProgramCounter
    const activeIdx = Number(edB.callDepth);
    const activeFrame = edB.callFrames[activeIdx];
    if (activeFrame.stackPointer === 0n) {
      return this.fail(result, `revert CPI: active frame StackPointer=0, expected valid stack address`);
    }
    if ((activeFrame.stackPointer >> 40n) !== 0x05n) {
      return this.fail(result, `revert CPI: active frame StackPointer seg_type!=0x05`);
    }
    if (activeFrame.programCounter === 0n) {
      return this.fail(result, `revert CPI: active frame ProgramCounter=0, expected non-zero`);
    }

    // Verify non-active frames (1 to callDepth-1) have valid StackPointer and ProgramCounter
    for (let i = 1; i < activeIdx; i++) {
      const f = edB.callFrames[i];
      if ((f.stackPointer >> 40n) !== 0x05n) {
        return this.fail(result, `revert CPI: call_frames[${i}].StackPointer seg_type!=0x05`);
      }
      if (f.programCounter === 0n) {
        return this.fail(result, `revert CPI: call_frames[${i}].ProgramCounter=0, expected non-zero`);
      }
    }

    // Verify stack windows on non-sentinel frames
    for (let i = 1; i < edB.callFrames.length; i++) {
      if (edB.callFrames[i].stackWindow.length === 0) {
        return this.fail(result, `revert CPI: call_frames[${i}] has empty stack_window`);
      }
      if (edB.callFrames[i].stackWindowBase !== edB.callFrames[i].stackPointer) {
        return this.fail(result, `revert CPI: call_frames[${i}] stack_window_base != stack_pointer`);
      }
      if (edB.callFrames[i].stackWindow.length > 1024) {
        return this.fail(result, `revert CPI: call_frames[${i}] stack_window length ${edB.callFrames[i].stackWindow.length} exceeds 1024`);
      }
    }

    ctx.logInfo("Revert CPI: call_depth=%s max_call_depth=%s fault=%d frames=%d", edB.callDepth, edB.maxCallDepth, edB.faultCode, edB.callFrames.length);
    result.verificationDetails.push(`✓ Revert CPI: call_depth=${edB.callDepth} max_call_depth=${edB.maxCallDepth} frames=${edB.callFrames.length} accIdx=[0,1,2,1]`);

    // Sub-test C: Memory dump
    ctx.logInfo("Phase 10c: Memory dump (include_memory_dump=true)");
    const respC = await this.debugReExecute(debugClient, sigB, { includeMemoryDump: true });
    if (respC.memorySegments.length === 0) return this.fail(result, "expected memory_segments, got empty");
    const stackSeg = respC.memorySegments.find((s) => s.segmentType === 5);
    if (!stackSeg) return this.fail(result, "no stack segment (type=5) in memory_segments");
    if (stackSeg.pages.length === 0) return this.fail(result, "stack segment has no pages");
    for (const page of stackSeg.pages) {
      if (page.data.length !== 4096) {
        return this.fail(result, `stack page ${page.pageIndex} data length ${page.data.length}, expected 4096`);
      }
    }
    ctx.logInfo("Memory dump: %d segments", respC.memorySegments.length);
    result.verificationDetails.push(`✓ Memory dump: ${respC.memorySegments.length} segments with stack pages`);
    result.details.push("Deep call stack verification successful");
    return result;
  }

  // Phase 11: Compute exhaustion
  private async testComputeExhaustion(ctx: TestContext, debugClient: DebugClient, result: TestResult): Promise<TestResult> {
    const sig = await this.submitDebugTestTx(ctx, buildDebugTestExhaustCUInstruction(), { expectFailure: true });
    ctx.logInfo("Submitted CU exhaustion txn: %s", sig.slice(0, 16));
    const resp = await this.debugReExecute(debugClient, sig);
    const ed = resp.executionDetails;
    if (!ed) return this.fail(result, "expected execution_details, got nil");
    if (ed.executionCode === 0n) return this.fail(result, "expected non-zero execution_code for CU exhaustion, got 0");
    ctx.logInfo("CU exhaustion: exec_code=%s fault=%d cu_consumed=%s", ed.executionCode, ed.faultCode, ed.computeUnitsConsumed);
    result.verificationDetails.push(`✓ CU exhaustion: exec_code=${ed.executionCode} cu_consumed=${ed.computeUnitsConsumed}`);
    result.details.push("Compute exhaustion verification successful");
    return result;
  }

  // Phase 12: Mid-block state correctness
  private async testMidBlockState(ctx: TestContext, debugClient: DebugClient, result: TestResult): Promise<TestResult> {
    const height = await ctx.sdk.blocks.getBlockHeight();
    const startSlot = height.finalized;
    const nonceBeforeBlock = this.aliceNonce;

    // Build Tx0: WriteScratch(0xAA)
    const instr0 = buildDebugTestWriteScratchInstruction(0xaa);
    const tx0 = await ctx.sdk.transactions.buildAndSign({
      feePayer: { publicKey: this.alice!.publicKey, privateKey: this.alice!.seed },
      program: DEBUG_TEST_PROGRAM_A,
      header: {
        fee: 1n, nonce: this.aliceNonce, startSlot,
        expiryAfter: DEBUG_TEST_EXPIRY, computeUnits: DEBUG_TEST_CU,
        stateUnits: DEBUG_TEST_SU, memoryUnits: DEBUG_TEST_MU,
        chainId: ctx.config.chainId,
      },
      accounts: { readWrite: [DEBUG_TEST_SCRATCH] },
      instructionData: instr0,
    });
    this.aliceNonce++;

    // Build Tx1: WriteScratch(0xBB) — target for re-execute
    const instr1 = buildDebugTestWriteScratchInstruction(0xbb);
    const tx1 = await ctx.sdk.transactions.buildAndSign({
      feePayer: { publicKey: this.alice!.publicKey, privateKey: this.alice!.seed },
      program: DEBUG_TEST_PROGRAM_A,
      header: {
        fee: 1n, nonce: this.aliceNonce, startSlot,
        expiryAfter: DEBUG_TEST_EXPIRY, computeUnits: DEBUG_TEST_CU,
        stateUnits: DEBUG_TEST_SU, memoryUnits: DEBUG_TEST_MU,
        chainId: ctx.config.chainId,
      },
      accounts: { readWrite: [DEBUG_TEST_SCRATCH] },
      instructionData: instr1,
    });
    this.aliceNonce++;

    const sig1 = tx1.signature.toThruFmt();

    // Send both as a single block
    await ctx.blockSender.sendAsBlock([tx0.rawTransaction, tx1.rawTransaction]);
    ctx.logInfo("Sent 2 WriteScratch txns as single block");

    // Wait for both to execute
    const sig0 = tx0.signature.toThruFmt();
    const tx0Resp = (await pollForTransaction(ctx.sdk, sig0, { timeoutMs: 30000 })) as any;
    if (!tx0Resp?.executionResult || tx0Resp.executionResult.vmError !== 0) {
      return this.fail(result, `tx0 failed: vmError=${tx0Resp?.executionResult?.vmError}`);
    }
    const tx1Resp = (await pollForTransaction(ctx.sdk, sig1, { timeoutMs: 30000 })) as any;
    if (!tx1Resp?.executionResult || tx1Resp.executionResult.vmError !== 0) {
      return this.fail(result, `tx1 failed: vmError=${tx1Resp?.executionResult?.vmError}`);
    }

    if (tx0Resp.slot !== tx1Resp.slot) {
      return this.fail(result, `tx0 slot ${tx0Resp.slot} != tx1 slot ${tx1Resp.slot}, expected same block`);
    }
    ctx.logInfo("Both txns executed in same block (slot %s)", tx0Resp.slot);

    // Re-execute Tx1 with state_before
    const debugResp = await this.debugReExecute(debugClient, sig1, { includeStateBefore: true, includeAccountData: true });
    if (debugResp.stateBefore.length === 0) return this.fail(result, "expected state_before snapshots, got empty");

    const fpSnap = debugResp.stateBefore.find((s) => s.address && bytesEqual(s.address.value, this.alice!.publicKey));
    const scratchSnap = debugResp.stateBefore.find((s) => s.address && bytesEqual(s.address.value, DEBUG_TEST_SCRATCH));

    // Verify fee payer nonce == nonceBeforeBlock + 1 (after Tx0 executed)
    if (!fpSnap) return this.fail(result, "fee payer not found in state_before snapshots");
    if (!fpSnap.meta) return this.fail(result, "fee payer meta is nil in state_before");
    const expectedNonce = nonceBeforeBlock + 1n;
    const actualNonce = fpSnap.meta.nonce;
    ctx.logInfo("Fee payer state_before: nonce=%s (expected %s, block_start_nonce=%s)", actualNonce, expectedNonce, nonceBeforeBlock);
    if (actualNonce !== expectedNonce) {
      if (actualNonce === nonceBeforeBlock) {
        return this.fail(result, `BUG: fee payer nonce=${actualNonce} equals block-start nonce, re-execute using block-start state instead of mid-block state`);
      }
      return this.fail(result, `fee payer nonce=${actualNonce}, expected ${expectedNonce}`);
    }

    // Verify scratch account has data == 0xAA (written by Tx0)
    if (!scratchSnap) return this.fail(result, "scratch account (0xED) not found in state_before snapshots");
    if (!scratchSnap.exists) return this.fail(result, "scratch account does not exist in state_before");
    if (!scratchSnap.meta) return this.fail(result, "scratch account meta is nil");
    if (scratchSnap.meta.dataSize < 32n) return this.fail(result, `scratch account data_size=${scratchSnap.meta.dataSize}, expected >= 32`);
    if (!scratchSnap.data || scratchSnap.data.length < 32) return this.fail(result, `scratch account data length=${scratchSnap.data?.length ?? 0}, expected >= 32`);

    for (let i = 0; i < 32; i++) {
      const b = scratchSnap.data[i];
      if (b !== 0xaa) {
        if (b === 0x00) return this.fail(result, `BUG: scratch data[${i}]=0x00, re-execute using block-start state instead of mid-block state`);
        if (b === 0xbb) return this.fail(result, `BUG: scratch data[${i}]=0xBB, re-execute using state after tx1 instead of before`);
        return this.fail(result, `scratch data[${i}]=0x${b.toString(16)}, expected 0xAA`);
      }
    }

    ctx.logInfo("Mid-block state verified: fee_payer nonce=%s (correct), scratch data[0:32]=all 0xAA (correct)", actualNonce);
    result.verificationDetails.push(`✓ Mid-block re-execute: fee_payer nonce=${actualNonce} (post-tx0), scratch[0:32]=0xAA`);
    result.details.push("Mid-block state correctness verification successful");
    return result;
  }
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function createDebugReExecuteScenario(): DebugReExecuteScenario {
  return new DebugReExecuteScenario();
}
