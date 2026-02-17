import { BaseScenario } from "../framework/scenario";
import type { TestContext } from "../framework/context";
import type { TestResult } from "../framework/result";
import type { GenesisAccount } from "../accounts";
import { type StateRootEntry } from "@thru/proto";

// EOA program address (all zeros)
const EOA_PROGRAM = new Uint8Array(32);

// Transfer constants
const TRANSFER_AMOUNT = 10n;
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
 * GetStateRootsScenario tests the GetStateRoots RPC for transaction replay.
 * Tests:
 * - GetStateRoots returns state roots
 * - State roots are 32 bytes each
 * - State roots are in ascending slot order
 * - Slot 0 returns exactly 1 state root
 */
export class GetStateRootsScenario extends BaseScenario {
  name = "Get State Roots";
  description = "Tests GetStateRoots RPC for retrieving historical state roots";

  private alice: GenesisAccount | null = null;
  private bob: GenesisAccount | null = null;
  private finalSlot: bigint = 0n;

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
      message: "GetStateRoots RPC test passed",
      details: [],
      verificationDetails: [],
      executionTimeMs: 0,
    };

    ctx.logInfo("=== GetStateRoots Test Starting ===");

    // Phase 1: Ensure we have some blocks
    ctx.logInfo("Phase 1: Ensuring blocks exist");
    const ensureResult = await this.ensureBlocks(ctx, result);
    if (!ensureResult.success) return ensureResult;

    // Phase 2: Test basic GetStateRoots
    ctx.logInfo("Phase 2: Testing basic GetStateRoots");
    const basicResult = await this.testBasicGetStateRoots(ctx, result);
    if (!basicResult.success) return basicResult;

    // Phase 3: Test state root format and ordering
    ctx.logInfo("Phase 3: Testing state root format and ordering");
    const formatResult = await this.testFormatAndOrdering(ctx, result);
    if (!formatResult.success) return formatResult;

    // Phase 4: Test GetStateRoots with slot=0
    ctx.logInfo("Phase 4: Testing GetStateRoots with slot=0");
    const slotZeroResult = await this.testSlotZero(ctx, result);
    if (!slotZeroResult.success) return slotZeroResult;

    // Phase 5: Test GetStateRoots with specific slot
    ctx.logInfo("Phase 5: Testing GetStateRoots with specific slot");
    const specificSlotResult = await this.testSpecificSlot(ctx, result);
    if (!specificSlotResult.success) return specificSlotResult;

    result.message = `GetStateRoots RPC test passed (final slot: ${this.finalSlot})`;
    ctx.logInfo("=== GetStateRoots Test Completed ===");
    return result;
  }

  private async ensureBlocks(ctx: TestContext, result: TestResult): Promise<TestResult> {
    // Get current height
    const height = await ctx.sdk.blocks.getBlockHeight();
    const currentSlot = height.finalized;

    ctx.logInfo("Current finalized slot: %d", currentSlot);

    // We need at least a few slots for the test
    if (currentSlot < 10n) {
      ctx.logInfo("Submitting transactions to advance slots...");

      const aliceAcct = await ctx.sdk.accounts.get(this.alice!.publicKeyString);
      if (!aliceAcct) {
        return {
          ...result,
          success: false,
          message: "Failed to get alice account",
        };
      }

      let aliceNonce = aliceAcct.meta?.nonce ?? 0n;

      // Submit a few transactions to advance slots
      for (let i = 0; i < 5; i++) {
        const instructionData = buildTransferInstruction(TRANSFER_AMOUNT);
        const tx = await ctx.sdk.transactions.buildAndSign({
          feePayer: {
            publicKey: this.alice!.publicKey,
            privateKey: this.alice!.seed,
          },
          program: EOA_PROGRAM,
          header: {
            fee: TRANSFER_FEE,
            nonce: aliceNonce,
            startSlot: currentSlot,
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

        await ctx.sdk.transactions.send(tx.rawTransaction);
        aliceNonce++;

        await new Promise((r) => setTimeout(r, 100));
      }

      // Wait for transactions to complete
      await ctx.accountStateTracker.waitForNonceIncrement(this.alice!.publicKeyString, 30000);
    }

    // Get final slot
    const finalHeight = await ctx.sdk.blocks.getBlockHeight();
    this.finalSlot = finalHeight.finalized;

    ctx.logInfo("Final slot: %d", this.finalSlot);
    result.details.push(`Final slot: ${this.finalSlot}`);

    return result;
  }

  private async testBasicGetStateRoots(ctx: TestContext, result: TestResult): Promise<TestResult> {
    const response = await ctx.sdk.proofs.getStateRoots();

    if (!response.stateRoots || response.stateRoots.length === 0) {
      return {
        ...result,
        success: false,
        message: "GetStateRoots returned no state roots",
      };
    }

    ctx.logInfo("GetStateRoots returned %d state roots", response.stateRoots.length);

    // Get the last slot from the response
    const lastEntry = response.stateRoots[response.stateRoots.length - 1];
    this.finalSlot = lastEntry.slot;

    result.verificationDetails.push(
      `✓ GetStateRoots returned ${response.stateRoots.length} state roots`
    );

    return result;
  }

  private async testFormatAndOrdering(ctx: TestContext, result: TestResult): Promise<TestResult> {
    const response = await ctx.sdk.proofs.getStateRoots();

    const stateRoots: StateRootEntry[] = response.stateRoots;

    let prevSlot = -1n;
    for (let i = 0; i < stateRoots.length; i++) {
      const entry = stateRoots[i];

      // Verify 32-byte state root
      if (entry.stateRoot.length !== 32) {
        return {
          ...result,
          success: false,
          message: `State root at slot ${entry.slot} has length ${entry.stateRoot.length}, expected 32`,
        };
      }

      // Verify ascending order
      if (i > 0 && entry.slot <= prevSlot) {
        return {
          ...result,
          success: false,
          message: `State roots not strictly ascending: slot[${i}]=${entry.slot} <= slot[${i - 1}]=${prevSlot}`,
        };
      }

      // Verify consecutive slots (no gaps) - only if not at the boundary
      if (i > 0 && entry.slot !== prevSlot + 1n) {
        return {
          ...result,
          success: false,
          message: `Gap in slots: slot[${i - 1}]=${prevSlot}, slot[${i}]=${entry.slot} (expected ${prevSlot + 1n})`,
        };
      }

      prevSlot = entry.slot;
    }

    ctx.logInfo("Verified %d state roots: all 32 bytes, strictly ascending, consecutive", stateRoots.length);

    // Log sample state roots
    const first = stateRoots[0];
    const last = stateRoots[stateRoots.length - 1];
    ctx.logInfo("First: slot=%d", first.slot);
    ctx.logInfo("Last:  slot=%d", last.slot);

    result.verificationDetails.push(
      `✓ All ${stateRoots.length} state roots are 32 bytes, strictly ascending, consecutive slots`
    );

    return result;
  }

  private async testSlotZero(ctx: TestContext, result: TestResult): Promise<TestResult> {
    const response = await ctx.sdk.proofs.getStateRoots({ slot: 0n });

    if (response.stateRoots.length !== 1) {
      return {
        ...result,
        success: false,
        message: `Expected exactly 1 state root for slot 0, got ${response.stateRoots.length}`,
      };
    }

    if (response.stateRoots[0].slot !== 0n) {
      return {
        ...result,
        success: false,
        message: `Expected slot 0, got slot ${response.stateRoots[0].slot}`,
      };
    }

    if (response.stateRoots[0].stateRoot.length !== 32) {
      return {
        ...result,
        success: false,
        message: `State root for slot 0 has length ${response.stateRoots[0].stateRoot.length}, expected 32`,
      };
    }

    ctx.logInfo("GetStateRoots (slot=0) returned exactly 1 root at slot 0");
    result.verificationDetails.push(
      "✓ GetStateRoots (slot=0) correctly returned exactly 1 state root at slot 0"
    );

    return result;
  }

  private async testSpecificSlot(ctx: TestContext, result: TestResult): Promise<TestResult> {
    // Test with a low slot to get a predictable range
    const testSlot = 10n;

    // Only run this test if we have at least 10 slots
    if (this.finalSlot < testSlot) {
      ctx.logInfo("Skipping specific slot test - not enough slots (final=%d)", this.finalSlot);
      result.verificationDetails.push(
        `✓ Specific slot test skipped (final slot ${this.finalSlot} < ${testSlot})`
      );
      return result;
    }

    const response = await ctx.sdk.proofs.getStateRoots({ slot: testSlot });

    // For slot 10, should return 11 roots (slots 0-10 inclusive)
    const expectedCount = Number(testSlot) + 1;
    if (response.stateRoots.length !== expectedCount) {
      return {
        ...result,
        success: false,
        message: `Expected ${expectedCount} state roots for slot ${testSlot}, got ${response.stateRoots.length}`,
      };
    }

    // Verify first slot is 0
    if (response.stateRoots[0].slot !== 0n) {
      return {
        ...result,
        success: false,
        message: `For slot ${testSlot}: first slot should be 0, got ${response.stateRoots[0].slot}`,
      };
    }

    // Verify last slot matches requested slot
    const lastSlot = response.stateRoots[response.stateRoots.length - 1].slot;
    if (lastSlot !== testSlot) {
      return {
        ...result,
        success: false,
        message: `For slot ${testSlot}: last slot should be ${testSlot}, got ${lastSlot}`,
      };
    }

    ctx.logInfo(
      "GetStateRoots (slot=%d) returned %d roots (slots 0 to %d)",
      testSlot,
      response.stateRoots.length,
      lastSlot
    );

    result.verificationDetails.push(
      `✓ GetStateRoots (slot=${testSlot}) correctly returned ${response.stateRoots.length} roots (slots 0 to ${testSlot})`
    );

    return result;
  }

  async cleanup(ctx: TestContext): Promise<void> {
    if (this.bob) {
      ctx.releaseGenesisAccounts([this.bob]);
    }
  }
}

export function createGetStateRootsScenario(): GetStateRootsScenario {
  return new GetStateRootsScenario();
}
