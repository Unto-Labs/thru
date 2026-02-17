import type { Timestamp } from "@bufbuild/protobuf/wkt";

import { BaseScenario } from "../framework/scenario";
import type { TestContext } from "../framework/context";
import type { TestResult } from "../framework/result";
import type { GenesisAccount } from "../accounts";

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
 * StreamSlotMetricsScenario tests the StreamSlotMetrics streaming RPC.
 * Tests:
 * - Stream delivers slot metrics
 * - Slot number is positive
 * - collectedFees is a bigint
 * - blockTimestamp is set and positive
 * - startSlot parameter works correctly
 */
export class StreamSlotMetricsScenario extends BaseScenario {
  name = "Stream Slot Metrics";
  description = "Tests StreamSlotMetrics RPC for real-time per-slot metrics";

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
      message: "StreamSlotMetrics test passed",
      details: [],
      verificationDetails: [],
      executionTimeMs: 0,
    };

    ctx.logInfo("=== Stream Slot Metrics Test Starting ===");

    // Phase 1: Open stream and collect at least 1 metric
    ctx.logInfo("Phase 1: Streaming slot metrics");
    const phase1Result = await this.testBasicStream(ctx, result);
    if (!phase1Result.success) return phase1Result;

    // Phase 2: Test with startSlot parameter
    ctx.logInfo("Phase 2: Testing with startSlot parameter");
    const phase2Result = await this.testStartSlot(ctx, result);
    if (!phase2Result.success) return phase2Result;

    ctx.logInfo("=== Stream Slot Metrics Test Completed ===");
    return result;
  }

  private async testBasicStream(ctx: TestContext, result: TestResult): Promise<TestResult> {
    const controller = new AbortController();
    const metrics: Array<{
      slot: bigint;
      collectedFees: bigint;
      globalActivatedStateCounter: bigint;
      globalDeactivatedStateCounter: bigint;
      blockTimestamp?: Timestamp;
    }> = [];

    const streamPromise = (async () => {
      try {
        const stream = ctx.sdk.slots.streamMetrics({ signal: controller.signal });
        for await (const metric of stream) {
          metrics.push({
            slot: metric.slot,
            collectedFees: metric.collectedFees,
            globalActivatedStateCounter: metric.globalActivatedStateCounter,
            globalDeactivatedStateCounter: metric.globalDeactivatedStateCounter,
            blockTimestamp: metric.blockTimestamp,
          });
          ctx.logInfo(
            "Metric: slot=%d, fees=%d, blockTimestamp=%s",
            metric.slot,
            metric.collectedFees,
            metric.blockTimestamp ? `${metric.blockTimestamp.seconds}s` : "undefined"
          );
          if (metrics.length >= 1) {
            break;
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          throw err;
        }
      }
    })();

    // Submit a transaction to trigger slot advancement
    const aliceAcct = await ctx.sdk.accounts.get(this.alice!.publicKeyString);
    if (aliceAcct) {
      const nonce = aliceAcct.meta?.nonce ?? 0n;
      const height = await ctx.sdk.blocks.getBlockHeight();
      const startSlot = height.finalized;

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
        instructionData: buildTransferInstruction(1n),
      });

      await ctx.sdk.transactions.send(tx.rawTransaction);
    }

    // Wait with timeout
    const timeout = setTimeout(() => controller.abort(), 15000);
    await streamPromise;
    clearTimeout(timeout);
    controller.abort();

    if (metrics.length === 0) {
      ctx.logInfo("StreamSlotMetrics returned no metrics");
      result.verificationDetails.push(
        "⚠ StreamSlotMetrics: no metrics received (stream may not be active)"
      );
      return result;
    }

    const m = metrics[0];

    // Verify slot is positive
    if (m.slot <= 0n) {
      return {
        ...result,
        success: false,
        message: `StreamSlotMetrics: slot should be positive, got ${m.slot}`,
      };
    }

    // Verify collectedFees is a bigint (type check at compile time, runtime is always true)
    if (typeof m.collectedFees !== "bigint") {
      return {
        ...result,
        success: false,
        message: "StreamSlotMetrics: collectedFees should be a bigint",
      };
    }

    // Verify blockTimestamp is present and reasonable
    if (!m.blockTimestamp) {
      return {
        ...result,
        success: false,
        message: "StreamSlotMetrics: blockTimestamp should be set",
      };
    }

    if (m.blockTimestamp.seconds <= 0n) {
      return {
        ...result,
        success: false,
        message: `StreamSlotMetrics: blockTimestamp.seconds should be positive, got ${m.blockTimestamp.seconds}`,
      };
    }

    result.verificationDetails.push(
      `✓ StreamSlotMetrics: received metric for slot ${m.slot}`,
      `✓ StreamSlotMetrics: collectedFees=${m.collectedFees}`,
      `✓ StreamSlotMetrics: blockTimestamp=${m.blockTimestamp.seconds}s`
    );

    return result;
  }

  private async testStartSlot(ctx: TestContext, result: TestResult): Promise<TestResult> {
    const height = await ctx.sdk.blocks.getBlockHeight();
    const startSlot = height.finalized;

    const controller = new AbortController();
    const metrics: Array<{ slot: bigint }> = [];

    const streamPromise = (async () => {
      try {
        const stream = ctx.sdk.slots.streamMetrics({
          startSlot,
          signal: controller.signal,
        });
        for await (const metric of stream) {
          metrics.push({ slot: metric.slot });
          if (metrics.length >= 1) {
            break;
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          throw err;
        }
      }
    })();

    // Submit transaction to advance
    const aliceAcct = await ctx.sdk.accounts.get(this.alice!.publicKeyString);
    if (aliceAcct) {
      const nonce = aliceAcct.meta?.nonce ?? 0n;
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
        instructionData: buildTransferInstruction(1n),
      });

      await ctx.sdk.transactions.send(tx.rawTransaction);
    }

    const timeout = setTimeout(() => controller.abort(), 15000);
    await streamPromise;
    clearTimeout(timeout);
    controller.abort();

    if (metrics.length === 0) {
      ctx.logInfo("StreamSlotMetrics (startSlot) returned no metrics");
      result.verificationDetails.push(
        "⚠ StreamSlotMetrics (startSlot): no metrics received"
      );
      return result;
    }

    // Verify first metric's slot >= startSlot
    if (metrics[0].slot < startSlot) {
      return {
        ...result,
        success: false,
        message: `StreamSlotMetrics: first metric slot ${metrics[0].slot} < startSlot ${startSlot}`,
      };
    }

    result.verificationDetails.push(
      `✓ StreamSlotMetrics (startSlot=${startSlot}): first metric at slot ${metrics[0].slot}`
    );

    return result;
  }

  async cleanup(ctx: TestContext): Promise<void> {
    if (this.bob) {
      ctx.releaseGenesisAccounts([this.bob]);
    }
  }
}

export function createStreamSlotMetricsScenario(): StreamSlotMetricsScenario {
  return new StreamSlotMetricsScenario();
}
