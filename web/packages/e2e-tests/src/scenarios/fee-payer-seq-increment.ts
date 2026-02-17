import { BaseScenario } from "../framework/scenario";
import type { TestContext } from "../framework/context";
import type { TestResult } from "../framework/result";
import type { GenesisAccount } from "../accounts";
import { trackTransactionUntilFinalized, pollForTransaction } from "../utils/timing";

// EOA program address (all zeros)
const EOA_PROGRAM = new Uint8Array(32);

// Transfer constants
const TRANSFER_AMOUNT = 1n;
const TRANSFER_FEE = 1n;
const TRANSFER_CU = 1_000_000;
const TRANSFER_SU = 10_000;
const TRANSFER_MU = 10_000;
const TRANSFER_EXPIRY = 1_000_000;

function buildTransferInstruction(amount: bigint): Uint8Array {
  const data = new Uint8Array(16);
  const view = new DataView(data.buffer);
  view.setUint32(0, 1, true); // discriminant = transfer
  view.setBigUint64(4, amount, true);
  view.setUint16(12, 0, true); // from_account_idx = fee payer
  view.setUint16(14, 2, true); // to_account_idx = first RW account
  return data;
}

/**
 * FeePayerSeqIncrementScenario tests that the fee payer's seq is only incremented once
 * per successful transaction.
 *
 * This test exposes a bug where the fee payer's seq was being incremented twice.
 * The expected behavior is that seq should only be incremented ONCE per successful transaction.
 */
export class FeePayerSeqIncrementScenario extends BaseScenario {
  name = "Fee Payer Seq Increment";
  description =
    "Tests that fee payer's seq is only incremented once per successful transaction";

  private recipientAccount: GenesisAccount | null = null;

  async setup(ctx: TestContext): Promise<void> {
    const accounts = ctx.getGenesisAccounts(1);
    this.recipientAccount = accounts[0];

    ctx.logInfo("Fee payer: %s", ctx.genesisAccount.publicKeyString);
    ctx.logInfo("Recipient: %s", this.recipientAccount.publicKeyString);
  }

  async execute(ctx: TestContext): Promise<TestResult> {
    const result: TestResult = {
      success: true,
      message: "Fee payer seq increment test passed",
      details: [],
      verificationDetails: [],
      executionTimeMs: 0,
    };

    ctx.logInfo("=== Fee Payer Seq Increment Test Starting ===");

    // Get fee payer's initial state directly from chain (like Go version)
    const feePayerResp = await ctx.sdk.accounts.get(ctx.genesisAccount.publicKeyString);
    if (!feePayerResp || !feePayerResp.meta) {
      return {
        ...result,
        success: false,
        message: "Failed to get fee payer account or meta is null",
      };
    }
    const initialSeq: bigint = feePayerResp.meta.seq ?? 0n;
    const initialNonce: bigint = feePayerResp.meta.nonce ?? 0n;
    const initialBalance: bigint = feePayerResp.meta.balance ?? 0n;

    ctx.logInfo(
      "Fee payer initial state: seq=%d, nonce=%d, balance=%d",
      initialSeq,
      initialNonce,
      initialBalance
    );
    result.details.push(`Initial fee payer seq: ${initialSeq}`);

    // Get current slot
    const height = await ctx.sdk.blocks.getBlockHeight();
    const startSlot = height.finalized + 1n;

    // Build transfer instruction
    const instructionData = buildTransferInstruction(TRANSFER_AMOUNT);

    // Build and sign transfer transaction
    const tx = await ctx.sdk.transactions.buildAndSign({
      feePayer: {
        publicKey: ctx.genesisAccount.publicKey,
        privateKey: ctx.genesisAccount.seed,
      },
      program: EOA_PROGRAM,
      header: {
        fee: TRANSFER_FEE,
        nonce: initialNonce,
        startSlot: startSlot,
        expiryAfter: TRANSFER_EXPIRY,
        computeUnits: TRANSFER_CU,
        stateUnits: TRANSFER_SU,
        memoryUnits: TRANSFER_MU,
        chainId: ctx.config.chainId,
      },
      accounts: {
        readWrite: [this.recipientAccount!.publicKey],
      },
      instructionData,
    });

    ctx.logInfo("Submitting transfer transaction...");

    // Start tracking before sending
    const signature = tx.signature.toThruFmt();
    const trackPromise = trackTransactionUntilFinalized(ctx.sdk, signature);

    // Submit transaction
    await ctx.sdk.transactions.send(tx.rawTransaction);

    ctx.logInfo("Transaction submitted: signature=%s", signature);

    // Wait for transaction to finalize via tracking stream
    const trackResult = await trackPromise;

    ctx.logInfo(
      "Tracking result: statusCode=%d, vmError=%s, consumedCU=%s",
      trackResult.statusCode,
      trackResult.executionResult?.vmError ?? "none",
      trackResult.executionResult?.consumedComputeUnits ?? "none"
    );

    if (trackResult.executionResult?.vmError !== 0) {
      return {
        ...result,
        success: false,
        message: `Transaction failed: vmError=${trackResult.executionResult?.vmError}`,
      };
    }

    result.verificationDetails.push("✓ Transaction executed successfully");

    // Poll for transaction to be in indexer (like Go's GetTransactionWithRetry)
    const txDetails = await pollForTransaction(ctx.sdk, signature, {
      timeoutMs: 30000,
      intervalMs: 200,
    }) as Awaited<ReturnType<typeof ctx.sdk.transactions.get>>;

    if (!txDetails || txDetails.slot === undefined) {
      return {
        ...result,
        success: false,
        message: "Failed to get transaction details after execution",
      };
    }

    ctx.logInfo("Transaction included in slot %d", txDetails.slot);

    // Get fee payer's state after transaction - now indexer should have it
    const feePayerRespAfter = await ctx.sdk.accounts.get(ctx.genesisAccount.publicKeyString);
    if (!feePayerRespAfter || !feePayerRespAfter.meta) {
      return {
        ...result,
        success: false,
        message: "Failed to get fee payer account after tx",
      };
    }

    const finalSeq: bigint = feePayerRespAfter.meta.seq ?? 0n;
    const finalNonce: bigint = feePayerRespAfter.meta.nonce ?? 0n;
    const finalBalance: bigint = feePayerRespAfter.meta.balance ?? 0n;

    ctx.logInfo(
      "Fee payer final state: seq=%d, nonce=%d, balance=%d",
      finalSeq,
      finalNonce,
      finalBalance
    );
    result.details.push(`Final fee payer seq: ${finalSeq}`);

    // Calculate increments
    const seqIncrement = finalSeq - initialSeq;
    const nonceIncrement = finalNonce - initialNonce;
    const balanceDecrease = initialBalance - finalBalance;

    ctx.logInfo("Fee payer changes:");
    ctx.logInfo("  seq increment: %d (expected: 1)", seqIncrement);
    ctx.logInfo("  nonce increment: %d (expected: 1)", nonceIncrement);
    ctx.logInfo(
      "  balance decrease: %d (expected: %d)",
      balanceDecrease,
      TRANSFER_AMOUNT + TRANSFER_FEE
    );

    // Verify nonce was incremented by 1
    if (nonceIncrement !== 1n) {
      return {
        ...result,
        success: false,
        message: `Nonce increment mismatch: got ${nonceIncrement}, expected 1`,
      };
    }
    result.verificationDetails.push("✓ Nonce incremented by 1");

    // Verify balance decreased correctly
    const expectedBalanceDecrease = TRANSFER_AMOUNT + TRANSFER_FEE;
    if (balanceDecrease !== expectedBalanceDecrease) {
      return {
        ...result,
        success: false,
        message: `Balance decrease mismatch: got ${balanceDecrease}, expected ${expectedBalanceDecrease}`,
      };
    }
    result.verificationDetails.push(
      `✓ Balance decreased by ${balanceDecrease} (transfer ${TRANSFER_AMOUNT} + fee ${TRANSFER_FEE})`
    );

    // CRITICAL CHECK: Verify seq was incremented by exactly 1
    if (seqIncrement !== 1n) {
      ctx.logInfo(
        "❌ BUG DETECTED: Fee payer seq was incremented by %d instead of 1!",
        seqIncrement
      );
      return {
        ...result,
        success: false,
        message: `BUG DETECTED: Fee payer seq was incremented by ${seqIncrement} instead of 1!`,
      };
    }

    result.verificationDetails.push("✓ Seq incremented by exactly 1");
    ctx.logInfo("✓ Fee payer seq was correctly incremented by 1");

    ctx.logInfo("=== Fee Payer Seq Increment Test Completed ===");
    return result;
  }

  async cleanup(ctx: TestContext): Promise<void> {
    if (this.recipientAccount) {
      ctx.releaseGenesisAccounts([this.recipientAccount]);
    }
  }
}

export function createFeePayerSeqIncrementScenario(): FeePayerSeqIncrementScenario {
  return new FeePayerSeqIncrementScenario();
}
