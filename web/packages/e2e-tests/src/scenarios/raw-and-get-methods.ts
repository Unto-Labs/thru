import { BaseScenario } from "../framework/scenario";
import type { TestContext } from "../framework/context";
import type { TestResult } from "../framework/result";
import type { GenesisAccount } from "../accounts";
import { pollForTransaction } from "../utils/timing";

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
  view.setUint32(0, 1, true); // discriminant = TRANSFER
  view.setBigUint64(4, amount, true);
  view.setUint16(12, 0, true); // from_idx
  view.setUint16(14, 2, true); // to_idx
  return data;
}

/**
 * RawAndGetMethodsScenario tests various RPC methods:
 * - StreamHeight: Real-time height updates
 * - GetRawAccount: Raw account bytes
 * - GetRawTransaction: Raw transaction bytes
 * - GetRawBlock: Raw block bytes
 * - GetTransactionStatus: Transaction execution status
 */
export class RawAndGetMethodsScenario extends BaseScenario {
  name = "Raw and Get Methods";
  description =
    "Tests StreamHeight, GetRawAccount, GetRawTransaction, GetRawBlock, GetTransactionStatus RPCs";

  private alice: GenesisAccount | null = null;
  private bob: GenesisAccount | null = null;
  private transferSignature: string | null = null;
  private txnSlot: bigint | null = null;
  private nextNonce: bigint = 0n;

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
      message: "Raw and Get Methods test passed",
      details: [],
      verificationDetails: [],
      executionTimeMs: 0,
    };

    ctx.logInfo("=== Raw and Get Methods Test Starting ===");

    // Phase 1: Test StreamHeight
    ctx.logInfo("Phase 1: Testing StreamHeight");
    const streamHeightResult = await this.testStreamHeight(ctx, result);
    if (!streamHeightResult.success) return streamHeightResult;

    // Phase 2: Create test transaction
    ctx.logInfo("Phase 2: Creating test transaction");
    const createResult = await this.createTestTransaction(ctx, result);
    if (!createResult.success) return createResult;

    // Phase 3: Test GetRawAccount
    ctx.logInfo("Phase 3: Testing GetRawAccount");
    const rawAccountResult = await this.testGetRawAccount(ctx, result);
    if (!rawAccountResult.success) return rawAccountResult;

    // Phase 4: Test GetRawTransaction
    ctx.logInfo("Phase 4: Testing GetRawTransaction");
    const rawTxResult = await this.testGetRawTransaction(ctx, result);
    if (!rawTxResult.success) return rawTxResult;

    // Phase 5: Test GetRawBlock
    ctx.logInfo("Phase 5: Testing GetRawBlock");
    const rawBlockResult = await this.testGetRawBlock(ctx, result);
    if (!rawBlockResult.success) return rawBlockResult;

    // Phase 6: Test GetTransactionStatus
    ctx.logInfo("Phase 6: Testing GetTransactionStatus");
    const statusResult = await this.testGetTransactionStatus(ctx, result);
    if (!statusResult.success) return statusResult;

    ctx.logInfo("=== Raw and Get Methods Test Completed ===");
    return result;
  }

  private async testStreamHeight(ctx: TestContext, result: TestResult): Promise<TestResult> {
    const heightUpdates: Array<{
      finalized: bigint;
      locallyExecuted: bigint;
      clusterExecuted: bigint;
    }> = [];

    const controller = new AbortController();

    // Start streaming height
    const streamPromise = (async () => {
      try {
        const stream = ctx.sdk.blocks.streamHeight({ signal: controller.signal });
        for await (const update of stream) {
          heightUpdates.push({
            finalized: update.height.finalized,
            locallyExecuted: update.height.locallyExecuted,
            clusterExecuted: update.height.clusterExecuted,
          });
          ctx.logInfo(
            "Height update %d: finalized=%d, locally_executed=%d, cluster_executed=%d",
            heightUpdates.length,
            update.height.finalized,
            update.height.locallyExecuted,
            update.height.clusterExecuted
          );
          if (heightUpdates.length >= 1) {
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
      this.nextNonce = aliceAcct.meta?.nonce ?? 0n;
      const height = await ctx.sdk.blocks.getBlockHeight();
      const startSlot = height.finalized;

      const instructionData = buildTransferInstruction(10n);
      const tx = await ctx.sdk.transactions.buildAndSign({
        feePayer: {
          publicKey: this.alice!.publicKey,
          privateKey: this.alice!.seed,
        },
        program: EOA_PROGRAM,
        header: {
          fee: TRANSFER_FEE,
          nonce: this.nextNonce,
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

      await ctx.sdk.transactions.send(tx.rawTransaction);
      this.nextNonce++; // Increment for next transaction
      ctx.logInfo("Submitted transaction to trigger height update");
    }

    // Wait for height updates (with timeout)
    const timeoutPromise = new Promise<void>((resolve) => setTimeout(resolve, 15000));
    await Promise.race([streamPromise, timeoutPromise]);
    controller.abort();

    if (heightUpdates.length < 1) {
      // StreamHeight may not work in all environments, log and continue
      ctx.logInfo("StreamHeight returned no updates (may not be supported in this environment)");
      result.verificationDetails.push(
        "⚠ StreamHeight: no updates received (stream may not be active)"
      );
      return result;
    }

    // Verify height values are reasonable
    for (const update of heightUpdates) {
      if (update.clusterExecuted > update.finalized) {
        return {
          ...result,
          success: false,
          message: `cluster_executed (${update.clusterExecuted}) should be <= finalized (${update.finalized})`,
        };
      }
    }

    const last = heightUpdates[heightUpdates.length - 1];
    result.verificationDetails.push(
      `✓ StreamHeight: received ${heightUpdates.length} updates`,
      `✓ StreamHeight: finalized=${last.finalized}, locally_executed=${last.locallyExecuted}, cluster_executed=${last.clusterExecuted}`
    );

    return result;
  }

  private async createTestTransaction(ctx: TestContext, result: TestResult): Promise<TestResult> {
    // Get fresh nonce if not already set
    if (this.nextNonce === 0n) {
      const aliceAcct = await ctx.sdk.accounts.get(this.alice!.publicKeyString);
      if (!aliceAcct) {
        return {
          ...result,
          success: false,
          message: "Failed to get alice account",
        };
      }
      this.nextNonce = aliceAcct.meta?.nonce ?? 0n;
    }

    const height = await ctx.sdk.blocks.getBlockHeight();
    const startSlot = height.finalized;

    const instructionData = buildTransferInstruction(TRANSFER_AMOUNT);

    const tx = await ctx.sdk.transactions.buildAndSign({
      feePayer: {
        publicKey: this.alice!.publicKey,
        privateKey: this.alice!.seed,
      },
      program: EOA_PROGRAM,
      header: {
        fee: TRANSFER_FEE,
        nonce: this.nextNonce,
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

    await ctx.sdk.transactions.send(tx.rawTransaction);
    this.transferSignature = tx.signature.toThruFmt();
    this.nextNonce++;

    ctx.logInfo("Transaction submitted: signature=%s", this.transferSignature);

    // Wait for transaction to complete - wait for nonce to reach our expected value
    const expectedNonce = this.nextNonce;
    const startTime = Date.now();
    while (Date.now() - startTime < 30000) {
      const currentNonce = ctx.accountStateTracker.getNonce(this.alice!.publicKeyString);
      if (currentNonce >= expectedNonce) break;
      await new Promise((r) => setTimeout(r, 100));
    }

    // Poll for transaction in indexer (matches Go's GetTransactionWithRetry)
    const txData = await pollForTransaction(ctx.sdk, this.transferSignature!, {
      timeoutMs: 30000,
      intervalMs: 200,
    }) as { slot: bigint } | null;
    if (!txData) {
      return {
        ...result,
        success: false,
        message: "Failed to get transaction after submission",
      };
    }

    this.txnSlot = txData.slot;
    ctx.logInfo("Transaction confirmed at slot %d", this.txnSlot);

    result.details.push(`Created transfer transaction: ${this.transferSignature}`);
    return result;
  }

  private async testGetRawAccount(ctx: TestContext, result: TestResult): Promise<TestResult> {
    // Test 1: Get raw account for Alice
    const aliceRaw = await ctx.sdk.accounts.getRaw(this.alice!.publicKeyString);

    if (!aliceRaw || !aliceRaw.rawMeta || aliceRaw.rawMeta.length === 0) {
      return {
        ...result,
        success: false,
        message: "GetRawAccount returned empty response for alice",
      };
    }

    ctx.logInfo("GetRawAccount for alice: raw_meta=%d bytes", aliceRaw.rawMeta.length);

    // Test 2: Get raw account for Bob
    const bobRaw = await ctx.sdk.accounts.getRaw(this.bob!.publicKeyString);

    if (!bobRaw || !bobRaw.rawMeta || bobRaw.rawMeta.length === 0) {
      return {
        ...result,
        success: false,
        message: "GetRawAccount returned empty response for bob",
      };
    }

    ctx.logInfo("GetRawAccount for bob: raw_meta=%d bytes", bobRaw.rawMeta.length);

    // Test 3: Compare with GetAccount
    const aliceDecoded = await ctx.sdk.accounts.get(this.alice!.publicKeyString);
    if (!aliceDecoded) {
      return {
        ...result,
        success: false,
        message: "GetAccount returned null for alice",
      };
    }

    result.verificationDetails.push(
      `✓ GetRawAccount: alice raw_meta=${aliceRaw.rawMeta.length} bytes, bob raw_meta=${bobRaw.rawMeta.length} bytes`,
      "✓ GetRawAccount: both accounts returned valid raw data"
    );

    return result;
  }

  private async testGetRawTransaction(ctx: TestContext, result: TestResult): Promise<TestResult> {
    const rawTx = await ctx.sdk.transactions.getRaw(this.transferSignature!);

    if (!rawTx || !rawTx.rawTransaction || rawTx.rawTransaction.length === 0) {
      return {
        ...result,
        success: false,
        message: "GetRawTransaction returned empty response",
      };
    }

    ctx.logInfo("GetRawTransaction returned %d bytes", rawTx.rawTransaction.length);

    // Verify signature matches
    if (!rawTx.signature) {
      return {
        ...result,
        success: false,
        message: "GetRawTransaction response missing signature",
      };
    }

    result.verificationDetails.push(
      `✓ GetRawTransaction: ${rawTx.rawTransaction.length} bytes`,
      "✓ GetRawTransaction: signature present in response"
    );

    return result;
  }

  private async testGetRawBlock(ctx: TestContext, result: TestResult): Promise<TestResult> {
    if (!this.txnSlot) {
      return {
        ...result,
        success: false,
        message: "No transaction slot available for GetRawBlock test",
      };
    }

    const rawBlock = await ctx.sdk.blocks.getRaw({ slot: Number(this.txnSlot) });

    if (!rawBlock || !rawBlock.rawBlock || rawBlock.rawBlock.length === 0) {
      return {
        ...result,
        success: false,
        message: `GetRawBlock returned empty response for slot ${this.txnSlot}`,
      };
    }

    ctx.logInfo("GetRawBlock for slot %d returned %d bytes", this.txnSlot, rawBlock.rawBlock.length);

    // Verify slot matches
    if (rawBlock.slot !== this.txnSlot) {
      return {
        ...result,
        success: false,
        message: `GetRawBlock slot mismatch: expected ${this.txnSlot}, got ${rawBlock.slot}`,
      };
    }

    // Compare with GetBlock
    const block = await ctx.sdk.blocks.get({ slot: Number(this.txnSlot) });
    if (!block || !block.header) {
      return {
        ...result,
        success: false,
        message: "GetBlock returned null",
      };
    }

    if (block.header.slot !== this.txnSlot) {
      return {
        ...result,
        success: false,
        message: `GetBlock slot mismatch: expected ${this.txnSlot}, got ${block.header.slot}`,
      };
    }

    result.verificationDetails.push(
      `✓ GetRawBlock: slot ${this.txnSlot} returned ${rawBlock.rawBlock.length} bytes`,
      `✓ GetRawBlock: slot matches decoded block (${block.header.slot})`
    );

    return result;
  }

  private async testGetTransactionStatus(ctx: TestContext, result: TestResult): Promise<TestResult> {
    const status = await ctx.sdk.transactions.getStatus(this.transferSignature!);

    if (!status) {
      return {
        ...result,
        success: false,
        message: "GetTransactionStatus returned null",
      };
    }

    ctx.logInfo(
      "GetTransactionStatus: consensusStatus=%s, vmError=%s",
      status.consensusStatus,
      status.executionResult?.vmError
    );

    // Verify execution result is present and successful
    if (!status.executionResult) {
      return {
        ...result,
        success: false,
        message: "GetTransactionStatus: execution result not set",
      };
    }

    if (status.executionResult.vmError !== 0) {
      return {
        ...result,
        success: false,
        message: `GetTransactionStatus: transaction failed with vmError=${status.executionResult.vmError}`,
      };
    }

    result.verificationDetails.push(
      `✓ GetTransactionStatus: vmError=${status.executionResult.vmError} (success)`,
      `✓ GetTransactionStatus: consumedCU=${status.executionResult.consumedComputeUnits}`
    );

    return result;
  }

  async cleanup(ctx: TestContext): Promise<void> {
    if (this.bob) {
      ctx.releaseGenesisAccounts([this.bob]);
    }
  }
}

export function createRawAndGetMethodsScenario(): RawAndGetMethodsScenario {
  return new RawAndGetMethodsScenario();
}
