import { BaseScenario } from "../framework/scenario";
import type { TestContext } from "../framework/context";
import type { TestResult } from "../framework/result";
import type { GenesisAccount } from "../accounts";
import { trackTransactionUntilFinalized, pollForTransactionStatus, pollForTransaction } from "../utils/timing";

// EOA program address (all zeros)
const EOA_PROGRAM = new Uint8Array(32);

// Transfer constants
const TRANSFER_AMOUNT = 100n;
const TRANSFER_FEE = 1n;
const TRANSFER_CU = 1_000_000;
const TRANSFER_SU = 10_000;
const TRANSFER_MU = 10_000;
const TRANSFER_EXPIRY = 1_000_000;

function buildTransferInstruction(amount: bigint): Uint8Array {
  const data = new Uint8Array(16);
  const view = new DataView(data.buffer);
  view.setUint32(0, 1, true);
  view.setBigUint64(4, amount, true);
  view.setUint16(12, 0, true);
  view.setUint16(14, 2, true);
  return data;
}

/**
 * TransactionStatusScenario tests GetTransactionStatus RPC
 */
export class TransactionStatusScenario extends BaseScenario {
  name = "Transaction Status";
  description = "Tests GetTransactionStatus and GetTransaction RPCs";

  private alice: GenesisAccount | null = null;
  private bob: GenesisAccount | null = null;
  private transferSignature: string | null = null;
  private expectedAliceBalance: bigint = 0n;
  private expectedBobBalance: bigint = 0n;

  async setup(ctx: TestContext): Promise<void> {
    this.alice = ctx.genesisAccount;
    const accounts = ctx.getGenesisAccounts(1);
    this.bob = accounts[0];

    ctx.logInfo("Using alice: %s", this.alice.publicKeyString);
    ctx.logInfo("Using bob: %s", this.bob.publicKeyString);

    await ctx.accountStateTracker.subscribeAccount(this.alice.publicKeyString);
    await ctx.accountStateTracker.subscribeAccount(this.bob.publicKeyString);
  }

  async execute(ctx: TestContext): Promise<TestResult> {
    const result: TestResult = {
      success: true,
      message: "Transaction status test passed",
      details: [],
      verificationDetails: [],
      executionTimeMs: 0,
    };

    ctx.logInfo("=== Transaction Status Test Starting ===");

    // Phase 1: Create a test transaction
    ctx.logInfo("Phase 1: Creating test transaction");
    const createResult = await this.createTestTransaction(ctx, result);
    if (!createResult.success) return createResult;

    // Phase 2: Test GetTransactionStatus
    ctx.logInfo("Phase 2: Testing GetTransactionStatus");
    const statusResult = await this.testGetTransactionStatus(ctx, result);
    if (!statusResult.success) return statusResult;

    // Phase 3: Test GetTransaction
    ctx.logInfo("Phase 3: Testing GetTransaction");
    const txResult = await this.testGetTransaction(ctx, result);
    if (!txResult.success) return txResult;

    ctx.logInfo("=== Transaction Status Test Completed ===");
    return result;
  }

  private async createTestTransaction(
    ctx: TestContext,
    result: TestResult
  ): Promise<TestResult> {
    // Get fresh account data
    const aliceAcct = await ctx.sdk.accounts.get(this.alice!.publicKeyString);
    const bobAcct = await ctx.sdk.accounts.get(this.bob!.publicKeyString);
    if (!aliceAcct) {
      return {
        ...result,
        success: false,
        message: "Failed to get alice account",
      };
    }
    if (!bobAcct) {
      return {
        ...result,
        success: false,
        message: "Failed to get bob account",
      };
    }

    const aliceBalance = aliceAcct.meta?.balance ?? 0n;
    const bobBalance = bobAcct.meta?.balance ?? 0n;
    const aliceNonce = aliceAcct.meta?.nonce ?? 0n;
    const height = await ctx.sdk.blocks.getBlockHeight();
    const startSlot = height.finalized;

    // Calculate expected balances after transfer
    this.expectedAliceBalance = aliceBalance - TRANSFER_AMOUNT - TRANSFER_FEE;
    this.expectedBobBalance = bobBalance + TRANSFER_AMOUNT;

    // Build transfer instruction
    const instructionData = buildTransferInstruction(TRANSFER_AMOUNT);

    // Build and sign transfer transaction
    const tx = await ctx.sdk.transactions.buildAndSign({
      feePayer: {
        publicKey: this.alice!.publicKey,
        privateKey: this.alice!.seed,
      },
      program: EOA_PROGRAM,
      header: {
        fee: TRANSFER_FEE,
        nonce: aliceNonce,
        startSlot: startSlot,
        expiryAfter: TRANSFER_EXPIRY,
        computeUnits: TRANSFER_CU,
        stateUnits: TRANSFER_SU,
        memoryUnits: TRANSFER_MU,
        chainId: ctx.config.chainId,
      },
      accounts: {
        readWrite: [this.bob!.publicKey],
      },
      instructionData,
    });

    // Start tracking and submit transaction
    const signature = tx.signature.toThruFmt();
    this.transferSignature = signature;
    const trackPromise = trackTransactionUntilFinalized(ctx.sdk, signature);
    await ctx.sdk.transactions.send(tx.rawTransaction);

    ctx.logInfo("Transaction submitted: signature=%s", this.transferSignature);

    // Wait for transaction to finalize via tracking stream
    const trackResult = await trackPromise;

    // Verify execution succeeded from tracking result
    if (trackResult.executionResult?.vmError !== 0) {
      return {
        ...result,
        success: false,
        message: `Transaction execution failed: vmError=${trackResult.executionResult?.vmError}`,
      };
    }

    // Wait for account state changes via streaming
    await ctx.accountStateTracker.waitForBalanceChange(
      this.alice!.publicKeyString,
      this.expectedAliceBalance,
      30000
    );
    await ctx.accountStateTracker.waitForBalanceChange(
      this.bob!.publicKeyString,
      this.expectedBobBalance,
      30000
    );

    // Wait for nonce to update in the streaming cache (ensures indexer sync)
    // This follows the pattern from raw-and-get-methods that works reliably
    const startTime = Date.now();
    const expectedNonce = aliceNonce + 1n;
    while (Date.now() - startTime < 30000) {
      const currentNonce = ctx.accountStateTracker.getNonce(this.alice!.publicKeyString);
      if (currentNonce >= expectedNonce) break;
      await new Promise((r) => setTimeout(r, 100));
    }

    result.details.push(`Created transfer transaction: ${this.transferSignature}`);
    return result;
  }

  private async testGetTransactionStatus(
    ctx: TestContext,
    result: TestResult
  ): Promise<TestResult> {
    // Poll for transaction status - this test specifically tests the GetTransactionStatus RPC
    const status = await pollForTransactionStatus(ctx.sdk, this.transferSignature!, {
      timeoutMs: 30000,
      intervalMs: 200,
    }) as Awaited<ReturnType<typeof ctx.sdk.transactions.getStatus>>;

    if (!status) {
      return {
        ...result,
        success: false,
        message: "GetTransactionStatus returned null",
      };
    }

    ctx.logInfo(
      "GetTransactionStatus: consensusStatus=%d, vmError=%s",
      status.consensusStatus,
      status.executionResult?.vmError ?? "none"
    );

    // Note: consensusStatus might be undefined in some SDK versions, so we check statusCode instead
    // if consensusStatus is available
    if (status.consensusStatus !== undefined) {
      ctx.logInfo("Consensus status: %d", status.consensusStatus);
    }

    // Verify execution result is present and successful
    if (!status.executionResult) {
      return {
        ...result,
        success: false,
        message: "Execution result not set",
      };
    }

    // vmError = 0 means success
    if (status.executionResult.vmError !== 0) {
      return {
        ...result,
        success: false,
        message: `Transaction failed: vmError=${status.executionResult.vmError}`,
      };
    }

    result.verificationDetails.push(
      `✓ GetTransactionStatus: vmError=${status.executionResult.vmError} (success)`
    );

    return result;
  }

  private async testGetTransaction(
    ctx: TestContext,
    result: TestResult
  ): Promise<TestResult> {
    // Poll for transaction - this test specifically tests the GetTransaction RPC
    const tx = await pollForTransaction(ctx.sdk, this.transferSignature!, {
      timeoutMs: 30000,
      intervalMs: 200,
    }) as Awaited<ReturnType<typeof ctx.sdk.transactions.get>>;

    if (!tx) {
      return {
        ...result,
        success: false,
        message: "GetTransaction returned null",
      };
    }

    ctx.logInfo("GetTransaction: slot=%d, signature=%s", tx.slot, tx.signature?.toThruFmt());

    // Verify signature matches
    if (tx.signature?.toThruFmt() !== this.transferSignature) {
      return {
        ...result,
        success: false,
        message: `Signature mismatch: expected ${this.transferSignature}, got ${tx.signature?.toThruFmt()}`,
      };
    }

    // Verify slot is set
    if (tx.slot === undefined) {
      return {
        ...result,
        success: false,
        message: "Transaction slot not set",
      };
    }

    result.verificationDetails.push(`✓ GetTransaction: slot=${tx.slot}`);
    result.verificationDetails.push("✓ Transaction signature matches");

    return result;
  }

  async cleanup(ctx: TestContext): Promise<void> {
    if (this.bob) {
      ctx.releaseGenesisAccounts([this.bob]);
    }
  }
}

export function createTransactionStatusScenario(): TransactionStatusScenario {
  return new TransactionStatusScenario();
}
