import { BaseScenario } from "../framework/scenario";
import type { TestContext } from "../framework/context";
import type { TestResult } from "../framework/result";
import type { GenesisAccount } from "../accounts";
import { trackTransactionUntilFinalized } from "../utils/timing";
import { pollForTransaction } from "../utils/timing";
import {
  DEBUG_TEST_PROGRAM_A,
  DEBUG_TEST_PROGRAM_B,
  DEBUG_TEST_CU,
  DEBUG_TEST_SU,
  DEBUG_TEST_MU,
  DEBUG_TEST_EXPIRY,
  buildDebugTestRevertInstruction,
  buildDebugTestRecursiveCPIRevertInstruction,
} from "../programs";
import { TransactionVmError } from "@thru/proto";

/**
 * ErrorProgramAccIdxScenario verifies that the error_program_acc_idx field
 * in TransactionExecutionResult correctly identifies which program caused
 * a failure. This matters for CPI scenarios where program A calls program B
 * and B reverts — the field should point to B, not A.
 */
export class ErrorProgramAccIdxScenario extends BaseScenario {
  name = "ErrorProgramAccIdx";
  description = "Verifies error_program_acc_idx identifies the faulting program in single-program and CPI reverts";

  private alice: GenesisAccount | null = null;
  private aliceNonce: bigint = 0n;

  async setup(ctx: TestContext): Promise<void> {
    this.alice = ctx.genesisAccount;
    await ctx.accountStateTracker.subscribeAccount(this.alice.publicKeyString);
    const acct = await ctx.sdk.accounts.get(this.alice.publicKeyString);
    this.aliceNonce = acct?.meta?.nonce ?? 0n;
  }

  async execute(ctx: TestContext): Promise<TestResult> {
    const result: TestResult = {
      success: true,
      message: "ErrorProgramAccIdx test passed",
      details: [],
      verificationDetails: [],
      executionTimeMs: 0,
    };

    ctx.logInfo("Phase 1: Single-program revert — error_program_acc_idx should be 1 (main program)");
    const phase1 = await this.testSingleProgramRevert(ctx, result);
    if (!phase1.success) return phase1;

    ctx.logInfo("Phase 2: CPI revert — error_program_acc_idx should be 2 (callee program B)");
    const phase2 = await this.testCPIRevert(ctx, result);
    if (!phase2.success) return phase2;

    result.message = "Successfully verified error_program_acc_idx for single-program and CPI reverts";
    return result;
  }

  /**
   * Phase 1: Sends a revert transaction with a single program (A at index 1)
   * and verifies error_program_acc_idx == 1.
   */
  private async testSingleProgramRevert(ctx: TestContext, result: TestResult): Promise<TestResult> {
    const height = await ctx.sdk.blocks.getBlockHeight();
    const startSlot = height.finalized;

    const errorCode = 0xbeef;
    const instruction = buildDebugTestRevertInstruction(errorCode);

    const tx = await ctx.sdk.transactions.buildAndSign({
      feePayer: {
        publicKey: this.alice!.publicKey,
        privateKey: this.alice!.seed,
      },
      program: DEBUG_TEST_PROGRAM_A,
      header: {
        fee: 1n,
        nonce: this.aliceNonce,
        startSlot,
        expiryAfter: DEBUG_TEST_EXPIRY,
        computeUnits: DEBUG_TEST_CU,
        stateUnits: DEBUG_TEST_SU,
        memoryUnits: DEBUG_TEST_MU,
        chainId: ctx.config.chainId,
      },
      instructionData: instruction,
    });

    const signature = tx.signature.toThruFmt();
    const trackPromise = trackTransactionUntilFinalized(ctx.sdk, signature);
    await ctx.blockSender.sendAsBlock([tx.rawTransaction]);
    this.aliceNonce++;

    ctx.logInfo("Submitted single-program revert tx: %s", signature.slice(0, 16));

    // Wait for execution (expect failure)
    await trackPromise;

    // Fetch the transaction to check error_program_acc_idx
    const txResp = (await pollForTransaction(ctx.sdk, signature, { timeoutMs: 30000 })) as any;
    const execResult = txResp?.executionResult;
    if (!execResult) {
      return { ...result, success: false, message: "execution result is nil" };
    }

    if (execResult.vmError !== TransactionVmError.TRANSACTION_VM_ERROR_VM_REVERT) {
      return { ...result, success: false, message: `expected VM_REVERT, got ${execResult.vmError}` };
    }

    if (execResult.errorProgramAccIdx !== 1) {
      return { ...result, success: false, message: `expected error_program_acc_idx=1, got ${execResult.errorProgramAccIdx}` };
    }

    if (execResult.userErrorCode !== BigInt(errorCode)) {
      return { ...result, success: false, message: `expected user_error_code=${errorCode}, got ${execResult.userErrorCode}` };
    }

    result.verificationDetails.push(
      `✓ Phase 1: single-program revert: error_program_acc_idx=${execResult.errorProgramAccIdx}, vm_error=${execResult.vmError}, user_error_code=0x${execResult.userErrorCode.toString(16)}`
    );
    return result;
  }

  /**
   * Phase 2: Sends a CPI revert transaction where program A (index 1) calls
   * program B (index 2) and B reverts. error_program_acc_idx should be 2.
   */
  private async testCPIRevert(ctx: TestContext, result: TestResult): Promise<TestResult> {
    const height = await ctx.sdk.blocks.getBlockHeight();
    const startSlot = height.finalized;

    const errorCode = 0xcafe;
    // depth=1: A calls B, B reverts immediately
    const instruction = buildDebugTestRecursiveCPIRevertInstruction(1, errorCode);

    const tx = await ctx.sdk.transactions.buildAndSign({
      feePayer: {
        publicKey: this.alice!.publicKey,
        privateKey: this.alice!.seed,
      },
      program: DEBUG_TEST_PROGRAM_A,
      header: {
        fee: 1n,
        nonce: this.aliceNonce,
        startSlot,
        expiryAfter: DEBUG_TEST_EXPIRY,
        computeUnits: DEBUG_TEST_CU,
        stateUnits: DEBUG_TEST_SU,
        memoryUnits: DEBUG_TEST_MU,
        chainId: ctx.config.chainId,
      },
      accounts: {
        readOnly: [DEBUG_TEST_PROGRAM_B],
      },
      instructionData: instruction,
    });

    const signature = tx.signature.toThruFmt();
    const trackPromise = trackTransactionUntilFinalized(ctx.sdk, signature);
    await ctx.blockSender.sendAsBlock([tx.rawTransaction]);
    this.aliceNonce++;

    ctx.logInfo("Submitted CPI revert tx: %s", signature.slice(0, 16));

    await trackPromise;

    const txResp = (await pollForTransaction(ctx.sdk, signature, { timeoutMs: 30000 })) as any;
    const execResult = txResp?.executionResult;
    if (!execResult) {
      return { ...result, success: false, message: "execution result is nil" };
    }

    if (execResult.vmError !== TransactionVmError.TRANSACTION_VM_ERROR_VM_REVERT) {
      return { ...result, success: false, message: `expected VM_REVERT, got ${execResult.vmError}` };
    }

    if (execResult.errorProgramAccIdx !== 2) {
      return { ...result, success: false, message: `expected error_program_acc_idx=2 (program B), got ${execResult.errorProgramAccIdx}` };
    }

    if (execResult.userErrorCode !== BigInt(errorCode)) {
      return { ...result, success: false, message: `expected user_error_code=${errorCode}, got ${execResult.userErrorCode}` };
    }

    result.verificationDetails.push(
      `✓ Phase 2: CPI revert: error_program_acc_idx=${execResult.errorProgramAccIdx}, vm_error=${execResult.vmError}, user_error_code=0x${execResult.userErrorCode.toString(16)}`
    );
    return result;
  }
}

export function createErrorProgramAccIdxScenario(): ErrorProgramAccIdxScenario {
  return new ErrorProgramAccIdxScenario();
}
