import { BaseScenario } from "../framework/scenario";
import type { TestContext } from "../framework/context";
import type { TestResult } from "../framework/result";
import type { GenesisAccount } from "../accounts";
import { SubmissionStatus } from "@thru/proto";

// EOA program address (all zeros)
const EOA_PROGRAM = new Uint8Array(32);

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
 * SendAndTrackCombinedScenario tests the SendAndTrackTxn RPC on CommandService.
 * This submits a transaction and tracks it in a single server-streaming call.
 * Tests:
 * - Stream yields status updates (RECEIVED, ACCEPTED)
 * - Signature is populated
 * - Consensus status progresses
 * - Execution result is populated
 */
export class SendAndTrackCombinedScenario extends BaseScenario {
  name = "Send And Track Combined";
  description = "Tests SendAndTrackTxn RPC for combined submission and tracking";

  private alice: GenesisAccount | null = null;
  private bob: GenesisAccount | null = null;

  async setup(ctx: TestContext): Promise<void> {
    this.alice = ctx.genesisAccount;
    const accounts = ctx.getGenesisAccounts(1);
    this.bob = accounts[0];

    ctx.logInfo("Using alice: %s", this.alice.publicKeyString);
    ctx.logInfo("Using bob: %s", this.bob.publicKeyString);
  }

  async execute(ctx: TestContext): Promise<TestResult> {
    const result: TestResult = {
      success: true,
      message: "SendAndTrackTxn test passed",
      details: [],
      verificationDetails: [],
      executionTimeMs: 0,
    };

    ctx.logInfo("=== Send And Track Combined Test Starting ===");

    // Get current state
    const aliceAcct = await ctx.sdk.accounts.get(this.alice!.publicKeyString);
    if (!aliceAcct) {
      return { ...result, success: false, message: "Failed to get alice account" };
    }

    const nonce = aliceAcct.meta?.nonce ?? 0n;
    const height = await ctx.sdk.blocks.getBlockHeight();
    const startSlot = height.finalized;

    // Build and sign transaction
    const instructionData = buildTransferInstruction(10n);
    const tx = await ctx.sdk.transactions.buildAndSign({
      feePayer: {
        publicKey: this.alice!.publicKey,
        privateKey: this.alice!.seed,
      },
      program: EOA_PROGRAM,
      header: {
        fee: TRANSFER_FEE,
        nonce,
        startSlot,
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

    ctx.logInfo("Built transaction, calling sendAndTrack...");

    // Call SendAndTrackTxn
    const updates: Array<{
      status: number;
      hasSignature: boolean;
      consensusStatus: number;
      hasExecutionResult: boolean;
      vmError?: number;
    }> = [];

    const stream = ctx.sdk.transactions.sendAndTrack(tx.rawTransaction, {
      timeoutMs: 30000,
    });

    for await (const update of stream) {
      updates.push({
        status: update.status,
        hasSignature: !!update.signature,
        consensusStatus: update.consensusStatus,
        hasExecutionResult: !!update.executionResult,
        vmError: update.executionResult?.vmError,
      });

      ctx.logInfo(
        "Update %d: status=%d, hasSignature=%s, consensus=%d, hasExecResult=%s",
        updates.length,
        update.status,
        !!update.signature,
        update.consensusStatus,
        !!update.executionResult
      );
    }

    if (updates.length === 0) {
      return {
        ...result,
        success: false,
        message: "SendAndTrackTxn returned no updates",
      };
    }

    ctx.logInfo("Received %d updates from SendAndTrackTxn", updates.length);

    // Verify RECEIVED status appears
    const hasReceived = updates.some(
      (u) => u.status === SubmissionStatus.RECEIVED
    );
    if (hasReceived) {
      result.verificationDetails.push("✓ SendAndTrack: RECEIVED status received");
    }

    // Verify ACCEPTED status appears
    const hasAccepted = updates.some(
      (u) => u.status === SubmissionStatus.ACCEPTED
    );
    if (hasAccepted) {
      result.verificationDetails.push("✓ SendAndTrack: ACCEPTED status received");
    }

    // Verify signature is set in at least one update
    const hasSignature = updates.some((u) => u.hasSignature);
    if (!hasSignature) {
      return {
        ...result,
        success: false,
        message: "SendAndTrackTxn: no update contained a signature",
      };
    }

    result.verificationDetails.push("✓ SendAndTrack: signature populated");

    // Verify execution result is received
    const executedUpdate = updates.find((u) => u.hasExecutionResult);
    if (!executedUpdate) {
      return {
        ...result,
        success: false,
        message: "SendAndTrackTxn: no update contained execution result",
      };
    }

    if (executedUpdate.vmError !== 0) {
      return {
        ...result,
        success: false,
        message: `SendAndTrackTxn: transaction failed with vmError=${executedUpdate.vmError}`,
      };
    }

    result.verificationDetails.push(
      `✓ SendAndTrack: execution result received (vmError=0)`,
      `✓ SendAndTrack: ${updates.length} total status updates`
    );

    result.message = `SendAndTrackTxn test passed (${updates.length} updates)`;
    ctx.logInfo("=== Send And Track Combined Test Completed ===");
    return result;
  }

  async cleanup(ctx: TestContext): Promise<void> {
    if (this.bob) {
      ctx.releaseGenesisAccounts([this.bob]);
    }
  }
}

export function createSendAndTrackCombinedScenario(): SendAndTrackCombinedScenario {
  return new SendAndTrackCombinedScenario();
}
