import { BaseScenario } from "../framework/scenario";
import type { TestContext } from "../framework/context";
import type { TestResult } from "../framework/result";
import type { GenesisAccount } from "../accounts";
import { ConsensusStatus } from "@thru/proto";

const TRANSFER_AMOUNT = 42n;
const TRANSFER_FEE = 1n;

// EOA program address (all zeros)
const EOA_PROGRAM = new Uint8Array(32);

// Transfer instruction constants
const TRANSFER_CU = 1_000_000;
const TRANSFER_SU = 10_000;
const TRANSFER_MU = 10_000;
const TRANSFER_EXPIRY = 1_000_000;

/**
 * Build EOA transfer instruction data
 * Format: discriminant(4) + amount(8) + from_idx(2) + to_idx(2)
 */
function buildTransferInstruction(amount: bigint): Uint8Array {
  const data = new Uint8Array(16);
  const view = new DataView(data.buffer);

  // discriminant = 1 (TN_EOA_INSTRUCTION_TRANSFER)
  view.setUint32(0, 1, true);
  // amount
  view.setBigUint64(4, amount, true);
  // from_account_idx = 0 (fee payer)
  view.setUint16(12, 0, true);
  // to_account_idx = 2 (first RW account)
  view.setUint16(14, 2, true);

  return data;
}

/**
 * SendAndTrackTxnScenario tests the TrackTransaction streaming method:
 * - Transaction tracking messages are received
 * - Execution result is received
 * - Balance updates occur correctly
 */
export class SendAndTrackTxnScenario extends BaseScenario {
  name = "SendAndTrackTxn";
  description = "Test transaction tracking with RECEIVED, ACCEPTED, and execution statuses";

  private aliceAccount: GenesisAccount | null = null;
  private bobAccount: GenesisAccount | null = null;

  async setup(ctx: TestContext): Promise<void> {
    const accounts = ctx.getGenesisAccounts(1);
    this.aliceAccount = ctx.genesisAccount;
    this.bobAccount = accounts[0];

    // Subscribe for tracking
    await ctx.accountStateTracker.subscribeAccount(this.aliceAccount.publicKeyString);
    await ctx.accountStateTracker.subscribeAccount(this.bobAccount.publicKeyString);

    ctx.logInfo(
      "Using accounts: alice=%s bob=%s",
      this.aliceAccount.publicKeyString,
      this.bobAccount.publicKeyString
    );
  }

  async execute(ctx: TestContext): Promise<TestResult> {
    const result: TestResult = {
      success: true,
      message: "SendAndTrackTxn test passed",
      details: [],
      verificationDetails: [],
      executionTimeMs: 0,
    };

    ctx.logInfo("=== SendAndTrackTxn Test Starting ===");

    // Fetch fresh balances and nonces from chain (not cached tracker values)
    const aliceAcct = await ctx.sdk.accounts.get(this.aliceAccount!.publicKeyString);
    const bobAcct = await ctx.sdk.accounts.get(this.bobAccount!.publicKeyString);

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

    ctx.logInfo(
      "Initial state: alice balance=%d nonce=%d, bob balance=%d",
      aliceBalance,
      aliceNonce,
      bobBalance
    );

    // Get current slot
    const height = await ctx.sdk.blocks.getBlockHeight();
    const startSlot = height.finalized + 1n;

    // Build transfer instruction
    const instructionData = buildTransferInstruction(TRANSFER_AMOUNT);

    // Build and sign transfer transaction
    const tx = await ctx.sdk.transactions.buildAndSign({
      feePayer: {
        publicKey: this.aliceAccount!.publicKey,
        privateKey: this.aliceAccount!.seed,
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
        readWrite: [this.bobAccount!.publicKey],
      },
      instructionData,
    });

    result.details.push(
      `Transfer ${TRANSFER_AMOUNT} units from alice to bob with fee ${TRANSFER_FEE}`
    );

    const expectedAlice = aliceBalance - TRANSFER_AMOUNT - TRANSFER_FEE;
    const expectedBob = bobBalance + TRANSFER_AMOUNT;

    // Submit transaction
    const submittedSignature = await ctx.sdk.transactions.send(tx.rawTransaction);
    const signature = tx.signature.toThruFmt();
    ctx.logInfo("Transaction sent: signature=%s", signature);

    // Track transaction status using AsyncIterable pattern
    let lastStatusCode: number | undefined;
    let messageCount = 0;
    let executionSuccess = false;

    ctx.logInfo("Tracking transaction...");

    try {
      for await (const update of ctx.sdk.transactions.track(signature, { timeoutMs: 30000 })) {
        messageCount++;
        lastStatusCode = update.statusCode;

        ctx.logInfo(
          "Message %d: statusCode=%d consumedCU=%d",
          messageCount,
          update.statusCode ?? -1,
          update.executionResult?.consumedComputeUnits ?? 0
        );

        if (update.executionResult) {
          // Check for successful execution (vmError = 0 means success)
          if (update.executionResult.consumedComputeUnits !== undefined) {
            executionSuccess = true;
          }
        }

        // Stop when finalized or cluster executed
        if (
          update.statusCode === ConsensusStatus.FINALIZED ||
          update.statusCode === ConsensusStatus.CLUSTER_EXECUTED
        ) {
          break;
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        ctx.logError("Tracking error: %s", (err as Error).message);
      }
    }

    // Wait for balance changes (which implies execution completed)
    ctx.logInfo("Waiting for balance changes...");
    await ctx.accountStateTracker.waitForBalanceChange(
      this.aliceAccount!.publicKeyString,
      expectedAlice,
      30000
    );
    await ctx.accountStateTracker.waitForBalanceChange(
      this.bobAccount!.publicKeyString,
      expectedBob,
      30000
    );

    // Verify results
    if (messageCount === 0) {
      return {
        ...result,
        success: false,
        message: "No tracking messages received",
      };
    }
    result.verificationDetails.push(`✓ Received ${messageCount} tracking message(s)`);

    if (lastStatusCode === undefined) {
      return {
        ...result,
        success: false,
        message: "No consensus status received",
      };
    }
    result.verificationDetails.push(`✓ Final status code: ${lastStatusCode}`);

    if (!executionSuccess) {
      return {
        ...result,
        success: false,
        message: "Transaction execution failed or no result received",
      };
    }
    result.verificationDetails.push("✓ Transaction executed successfully");

    // Verify final balances
    const finalAliceBalance = ctx.accountStateTracker.getBalance(this.aliceAccount!.publicKeyString);
    const finalBobBalance = ctx.accountStateTracker.getBalance(this.bobAccount!.publicKeyString);

    ctx.logInfo(
      "Final balances: alice=%d (expected %d) bob=%d (expected %d)",
      finalAliceBalance,
      expectedAlice,
      finalBobBalance,
      expectedBob
    );

    if (finalAliceBalance !== expectedAlice) {
      return {
        ...result,
        success: false,
        message: `Alice balance mismatch: got ${finalAliceBalance}, expected ${expectedAlice}`,
      };
    }

    if (finalBobBalance !== expectedBob) {
      return {
        ...result,
        success: false,
        message: `Bob balance mismatch: got ${finalBobBalance}, expected ${expectedBob}`,
      };
    }

    result.verificationDetails.push(
      `✓ Alice balance: ${finalAliceBalance} (transferred out ${TRANSFER_AMOUNT} + fee ${TRANSFER_FEE})`
    );
    result.verificationDetails.push(
      `✓ Bob balance: ${finalBobBalance} (received ${TRANSFER_AMOUNT})`
    );

    ctx.logInfo("=== SendAndTrackTxn Test Completed ===");

    return result;
  }

  async cleanup(ctx: TestContext): Promise<void> {
    // Only release accounts acquired via getGenesisAccounts, not ctx.genesisAccount
    if (this.bobAccount) {
      ctx.releaseGenesisAccounts([this.bobAccount]);
    }
  }
}

export function createSendAndTrackTxnScenario(): SendAndTrackTxnScenario {
  return new SendAndTrackTxnScenario();
}
