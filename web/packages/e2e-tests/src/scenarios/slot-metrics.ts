import { BaseScenario } from "../framework/scenario";
import type { TestContext } from "../framework/context";
import type { TestResult } from "../framework/result";
import type { GenesisAccount } from "../accounts";

// EOA program address (all zeros)
const EOA_PROGRAM = new Uint8Array(32);

// Transfer constants
const TRANSFER_AMOUNT = 10000n;
const TRANSFER_FEE = 1000n;
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
 * SlotMetricsScenario tests slot metrics (state counters, collected fees)
 */
export class SlotMetricsScenario extends BaseScenario {
  name = "Slot Metrics";
  description = "Tests slot metrics streaming and historical queries (state counters, collected fees)";

  private alice: GenesisAccount | null = null;
  private bob: GenesisAccount | null = null;
  private finalSlot = 0n;

  async setup(ctx: TestContext): Promise<void> {
    const accounts = ctx.getGenesisAccounts(2);
    this.alice = accounts[0];
    this.bob = accounts[1];

    ctx.logInfo("Using alice: %s", this.alice.publicKeyString);
    ctx.logInfo("Using bob: %s", this.bob.publicKeyString);

    await ctx.accountStateTracker.subscribeAccount(this.alice.publicKeyString);
    await ctx.accountStateTracker.subscribeAccount(this.bob.publicKeyString);
  }

  async execute(ctx: TestContext): Promise<TestResult> {
    const result: TestResult = {
      success: true,
      message: "SlotMetrics test passed",
      details: [],
      verificationDetails: [],
      executionTimeMs: 0,
    };

    ctx.logInfo("Phase 1: Submit transfer transaction and verify metrics via streaming");
    const streamingResult = await this.testStreamingMetrics(ctx, result);
    if (!streamingResult.success) return streamingResult;

    ctx.logInfo("Phase 2: Test GetSlotMetrics historical query");
    const getResult = await this.testGetSlotMetrics(ctx, result);
    if (!getResult.success) return getResult;

    ctx.logInfo("Phase 3: Test ListSlotMetrics historical query");
    const listResult = await this.testListSlotMetrics(ctx, result);
    if (!listResult.success) return listResult;

    result.message = `SlotMetrics test passed (final slot: ${this.finalSlot})`;
    return result;
  }

  private async testStreamingMetrics(
    ctx: TestContext,
    result: TestResult
  ): Promise<TestResult> {
    const height = await ctx.sdk.blocks.getBlockHeight();
    const currentSlot = height.finalized;
    ctx.logInfo("Starting at slot %d", currentSlot);

    // Subscribe to slot metrics stream BEFORE sending the transaction,
    // so we don't miss the metrics if the tx lands quickly.
    const controller = new AbortController();
    const stream = ctx.sdk.slots.streamMetrics({
      startSlot: currentSlot,
      signal: controller.signal,
    });
    const timeout = setTimeout(() => controller.abort(), 30000);

    // Collect metrics in background while we send the transaction
    const metricsPromise = (async () => {
      try {
        for await (const metric of stream) {
          if (metric.collectedFees > 0n) {
            this.finalSlot = metric.slot;
            break;
          }
        }
      } catch (err) {
        const errName = (err as Error).name;
        const errMessage = (err as Error).message || "";
        if (errName !== "AbortError" && !errMessage.includes("canceled")) {
          throw err;
        }
      }
    })();

    // Get alice's nonce
    const aliceNonce = ctx.accountStateTracker.getNonce(this.alice!.publicKeyString);

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

    // Submit transaction
    await ctx.sdk.transactions.send(tx.rawTransaction);
    ctx.logInfo("Transaction submitted, waiting for metrics...");

    // Wait for the stream to find our slot with fees
    await metricsPromise;
    clearTimeout(timeout);
    controller.abort();

    if (this.finalSlot === 0n) {
      return {
        ...result,
        success: false,
        message: "Timed out waiting for a slot with collected fees > 0",
      };
    }
    ctx.logInfo("Transaction confirmed in slot %d", this.finalSlot);

    result.details.push(`Transaction executed in slot ${this.finalSlot} with fee ${TRANSFER_FEE}`);
    result.verificationDetails.push("Transaction submitted and confirmed successfully");

    return result;
  }

  private async testGetSlotMetrics(
    ctx: TestContext,
    result: TestResult
  ): Promise<TestResult> {
    // Retry — slot may not be indexed in ClickHouse immediately after streaming
    let resp: Awaited<ReturnType<typeof ctx.sdk.slots.getMetrics>> | null = null;
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        resp = await ctx.sdk.slots.getMetrics(this.finalSlot);
        break;
      } catch (err) {
        if (attempt === 9) throw err;
        ctx.logInfo("GetSlotMetrics not found yet, retrying (%d/10)...", attempt + 1);
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    const metrics = resp!;
    ctx.logInfo(
      "GetSlotMetrics returned: slot=%d activated=%d deactivated=%d fees=%d",
      metrics.slot,
      metrics.globalActivatedStateCounter,
      metrics.globalDeactivatedStateCounter,
      metrics.collectedFees
    );

    if (metrics.slot !== this.finalSlot) {
      return {
        ...result,
        success: false,
        message: `Expected slot ${this.finalSlot}, got ${metrics.slot}`,
      };
    }

    // Verify collected_fees is greater than 0 since we submitted a transaction with fees
    if (metrics.collectedFees === 0n) {
      return {
        ...result,
        success: false,
        message: "Expected collected_fees > 0, got 0",
      };
    }

    // Verify block_timestamp is set
    if (!metrics.blockTimestamp) {
      return {
        ...result,
        success: false,
        message: "Expected block_timestamp to be set",
      };
    }

    result.verificationDetails.push(
      `GetSlotMetrics returned slot=${metrics.slot} with collected_fees=${metrics.collectedFees}`
    );

    return result;
  }

  private async testListSlotMetrics(
    ctx: TestContext,
    result: TestResult
  ): Promise<TestResult> {
    // Query a range that includes our transaction slot
    const startSlot = this.finalSlot > 5n ? this.finalSlot - 5n : 0n;
    const endSlot = this.finalSlot + 1n;

    const resp = await ctx.sdk.slots.listMetrics({
      startSlot,
      endSlot,
    });

    ctx.logInfo(
      "ListSlotMetrics returned %d entries for range [%d, %d]",
      resp.metrics.length,
      startSlot,
      endSlot
    );

    if (resp.metrics.length === 0) {
      return {
        ...result,
        success: false,
        message: "Expected at least one slot metric, got 0",
      };
    }

    // Find our slot in the results
    const foundSlot = resp.metrics.find((m: { slot: bigint }) => m.slot === this.finalSlot);

    if (!foundSlot) {
      return {
        ...result,
        success: false,
        message: `Slot ${this.finalSlot} not found in ListSlotMetrics response`,
      };
    }

    // Verify collected_fees
    if (foundSlot.collectedFees === 0n) {
      return {
        ...result,
        success: false,
        message: `Expected collected_fees > 0 in ListSlotMetrics for slot ${this.finalSlot}`,
      };
    }

    // Verify ascending order
    for (let i = 1; i < resp.metrics.length; i++) {
      if (resp.metrics[i].slot < resp.metrics[i - 1].slot) {
        return {
          ...result,
          success: false,
          message: `ListSlotMetrics not in ascending order: slot[${i}]=${resp.metrics[i].slot} < slot[${i - 1}]=${resp.metrics[i - 1].slot}`,
        };
      }
    }

    result.verificationDetails.push(
      `ListSlotMetrics returned ${resp.metrics.length} entries in ascending order`
    );

    return result;
  }

  async cleanup(ctx: TestContext): Promise<void> {
    if (this.alice && this.bob) {
      ctx.releaseGenesisAccounts([this.alice, this.bob]);
    }
  }
}

export function createSlotMetricsScenario(): SlotMetricsScenario {
  return new SlotMetricsScenario();
}
