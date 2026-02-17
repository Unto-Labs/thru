import { BaseScenario } from "../framework/scenario";
import type { TestContext } from "../framework/context";
import type { TestResult } from "../framework/result";
import type { GenesisAccount } from "../accounts";
import { Filter, FilterParamValue } from "@thru/thru-sdk";
import type { StreamAccountUpdate } from "@thru/thru-sdk";

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
 * AccountUpdatesFiltersScenario tests StreamAccountUpdates with CEL filters.
 * Tests various filter expressions on account update streams including:
 * - balance threshold filters
 * - nonce threshold filters
 * - address filters with params
 * - multi-account filters with list params
 */
export class AccountUpdatesFiltersScenario extends BaseScenario {
  name = "Account Updates Filters";
  description = "Tests StreamAccountUpdates RPC with CEL filter expressions";

  private alice: GenesisAccount | null = null;
  private bob: GenesisAccount | null = null;
  private aliceNonce: bigint = 0n;

  async setup(ctx: TestContext): Promise<void> {
    const accounts = ctx.getGenesisAccounts(2);
    this.alice = accounts[0];
    this.bob = accounts[1];

    ctx.logInfo("Using alice: %s", this.alice.publicKeyString);
    ctx.logInfo("Using bob: %s", this.bob.publicKeyString);

    await ctx.accountStateTracker.subscribeAccount(this.alice.publicKeyString);
    await ctx.accountStateTracker.subscribeAccount(this.bob.publicKeyString);

    // Get initial nonce
    const aliceAcct = await ctx.sdk.accounts.get(this.alice.publicKeyString);
    this.aliceNonce = aliceAcct?.meta?.nonce ?? 0n;
  }

  async execute(ctx: TestContext): Promise<TestResult> {
    const result: TestResult = {
      success: true,
      message: "Account updates filters test passed",
      details: [],
      verificationDetails: [],
      executionTimeMs: 0,
    };

    ctx.logInfo("=== Account Updates Filters Test Starting ===");

    // Phase 1: Test address filter
    ctx.logInfo("Phase 1: Testing address filter");
    const addressResult = await this.testAddressFilter(ctx, result);
    if (!addressResult.success) return addressResult;

    // Phase 2: Test balance threshold filter
    ctx.logInfo("Phase 2: Testing balance threshold filter");
    const balanceResult = await this.testBalanceThresholdFilter(ctx, result);
    if (!balanceResult.success) return balanceResult;

    // Phase 3: Test nonce threshold filter
    ctx.logInfo("Phase 3: Testing nonce threshold filter");
    const nonceResult = await this.testNonceThresholdFilter(ctx, result);
    if (!nonceResult.success) return nonceResult;

    // Phase 4: Test multi-account filter
    ctx.logInfo("Phase 4: Testing multi-account filter");
    const multiResult = await this.testMultiAccountFilter(ctx, result);
    if (!multiResult.success) return multiResult;

    ctx.logInfo("=== Account Updates Filters Test Completed ===");
    return result;
  }

  private async doTransfer(ctx: TestContext): Promise<string> {
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
        nonce: this.aliceNonce,
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

    // Send as block to ensure it's processed
    await ctx.blockSender.sendAsBlock([tx.rawTransaction]);
    this.aliceNonce++;

    return tx.signature.toThruFmt();
  }

  private async testAddressFilter(
    ctx: TestContext,
    result: TestResult
  ): Promise<TestResult> {
    // Subscribe to alice's account updates - SDK automatically filters by address
    const updates = await this.streamAccountAndTransfer(
      ctx,
      this.alice!.publicKeyString,
      undefined,
      1
    );

    if (updates.length === 0) {
      return {
        ...result,
        success: false,
        message: "Address filter returned no updates",
      };
    }

    // Verify update is for alice
    for (const update of updates) {
      const address = this.getUpdateAddress(update);
      if (address && !this.bytesEqual(address, this.alice!.publicKey)) {
        return {
          ...result,
          success: false,
          message: "Address filter returned update for wrong account",
        };
      }
    }

    result.verificationDetails.push(
      `✓ Address filter returned ${updates.length} update(s) for correct account`
    );
    return result;
  }

  private async testBalanceThresholdFilter(
    ctx: TestContext,
    result: TestResult
  ): Promise<TestResult> {
    // Get bob's current balance
    const bobAcct = await ctx.sdk.accounts.get(this.bob!.publicKeyString);
    const bobBalance = bobAcct?.meta?.balance ?? 0n;

    // Set threshold to current balance - 5, so next transfer (adds 10) should pass
    const threshold = bobBalance - 5n;

    // Use additional filter on top of address filter
    const filter = new Filter({
      expression:
        "(has(snapshot.meta) && snapshot.meta.balance > params.min_balance) || " +
        "(has(account_update.meta) && account_update.meta.balance > params.min_balance)",
      params: {
        min_balance: FilterParamValue.uint(threshold),
      },
    });

    const updates = await this.streamAccountAndTransfer(
      ctx,
      this.bob!.publicKeyString,
      filter,
      1
    );

    if (updates.length === 0) {
      return {
        ...result,
        success: false,
        message: "Balance threshold filter returned no updates",
      };
    }

    // Verify all updates have balance > threshold
    for (const update of updates) {
      const balance = this.getUpdateBalance(update);
      if (balance !== undefined && balance <= threshold) {
        return {
          ...result,
          success: false,
          message: `Balance filter returned update with balance ${balance} <= threshold ${threshold}`,
        };
      }
    }

    result.verificationDetails.push(
      `✓ Balance threshold filter (> ${threshold}) returned ${updates.length} update(s)`
    );
    return result;
  }

  private async testNonceThresholdFilter(
    ctx: TestContext,
    result: TestResult
  ): Promise<TestResult> {
    // Set threshold to current nonce + 1, so next transfer should trigger
    const threshold = this.aliceNonce;

    const filter = new Filter({
      expression:
        "(has(snapshot.meta) && snapshot.meta.nonce >= params.min_nonce) || " +
        "(has(account_update.meta) && account_update.meta.nonce >= params.min_nonce)",
      params: {
        min_nonce: FilterParamValue.uint(threshold),
      },
    });

    const updates = await this.streamAccountAndTransfer(
      ctx,
      this.alice!.publicKeyString,
      filter,
      1
    );

    if (updates.length === 0) {
      return {
        ...result,
        success: false,
        message: "Nonce threshold filter returned no updates",
      };
    }

    // Verify all updates have nonce >= threshold
    for (const update of updates) {
      const nonce = this.getUpdateNonce(update);
      if (nonce !== undefined && nonce < threshold) {
        return {
          ...result,
          success: false,
          message: `Nonce filter returned update with nonce ${nonce} < threshold ${threshold}`,
        };
      }
    }

    result.verificationDetails.push(
      `✓ Nonce threshold filter (>= ${threshold}) returned ${updates.length} update(s)`
    );
    return result;
  }

  private async testMultiAccountFilter(
    ctx: TestContext,
    result: TestResult
  ): Promise<TestResult> {
    // Test receiving updates for both alice and bob by subscribing to both
    // Note: SDK's streamAccountUpdates is per-address, so we run two streams
    const aliceUpdates: StreamAccountUpdate[] = [];
    const bobUpdates: StreamAccountUpdate[] = [];
    const controller = new AbortController();

    // Start alice stream
    const aliceStreamPromise = (async () => {
      try {
        const stream = ctx.sdk.accounts.stream(this.alice!.publicKeyString, {
          signal: controller.signal,
        });
        for await (const { update } of stream) {
          if (update.kind === "finished") continue;
          aliceUpdates.push(update);
          if (aliceUpdates.length >= 1) break;
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          ctx.logInfo("Alice stream error: %s", (err as Error).message);
        }
      }
    })();

    // Start bob stream
    const bobStreamPromise = (async () => {
      try {
        const stream = ctx.sdk.accounts.stream(this.bob!.publicKeyString, {
          signal: controller.signal,
        });
        for await (const { update } of stream) {
          if (update.kind === "finished") continue;
          bobUpdates.push(update);
          if (bobUpdates.length >= 1) break;
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          ctx.logInfo("Bob stream error: %s", (err as Error).message);
        }
      }
    })();

    // Give streams time to connect
    await new Promise((r) => setTimeout(r, 300));

    // Do a transfer which updates both alice and bob
    await this.doTransfer(ctx);

    // Wait for updates with timeout
    const timeout = setTimeout(() => controller.abort(), 15000);
    await Promise.all([aliceStreamPromise, bobStreamPromise]);
    clearTimeout(timeout);
    controller.abort();

    if (aliceUpdates.length === 0) {
      return {
        ...result,
        success: false,
        message: "Multi-account test: no updates for alice",
      };
    }

    if (bobUpdates.length === 0) {
      return {
        ...result,
        success: false,
        message: "Multi-account test: no updates for bob",
      };
    }

    result.verificationDetails.push(
      `✓ Multi-account streams: alice=${aliceUpdates.length}, bob=${bobUpdates.length} updates`
    );
    return result;
  }

  private async streamAccountAndTransfer(
    ctx: TestContext,
    address: string,
    filter: Filter | undefined,
    expectedCount: number
  ): Promise<StreamAccountUpdate[]> {
    const updates: StreamAccountUpdate[] = [];
    const controller = new AbortController();

    // Start stream
    const streamPromise = (async () => {
      try {
        const stream = ctx.sdk.accounts.stream(address, {
          filter,
          signal: controller.signal,
        });
        for await (const { update } of stream) {
          // Skip block finished messages
          if (update.kind === "finished") continue;

          updates.push(update);
          if (updates.length >= expectedCount) {
            break;
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          ctx.logInfo("Stream error: %s", (err as Error).message);
        }
      }
    })();

    // Give stream time to connect
    await new Promise((r) => setTimeout(r, 300));

    // Do a transfer to trigger account updates
    await this.doTransfer(ctx);

    // Wait for updates with timeout
    const timeout = setTimeout(() => controller.abort(), 15000);
    await streamPromise;
    clearTimeout(timeout);
    controller.abort();

    return updates;
  }

  private getUpdateAddress(update: StreamAccountUpdate): Uint8Array | undefined {
    if (update.kind === "snapshot" && update.snapshot?.account) {
      return update.snapshot.account.address?.toBytes();
    }
    // AccountUpdateDelta doesn't have address - updates are for subscribed accounts
    return undefined;
  }

  private getUpdateBalance(update: StreamAccountUpdate): bigint | undefined {
    if (update.kind === "snapshot" && update.snapshot?.account?.meta) {
      return update.snapshot.account.meta.balance;
    } else if (update.kind === "update" && update.update?.meta) {
      return update.update.meta.balance;
    }
    return undefined;
  }

  private getUpdateNonce(update: StreamAccountUpdate): bigint | undefined {
    if (update.kind === "snapshot" && update.snapshot?.account?.meta) {
      return update.snapshot.account.meta.nonce;
    } else if (update.kind === "update" && update.update?.meta) {
      return update.update.meta.nonce;
    }
    return undefined;
  }

  private bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  async cleanup(ctx: TestContext): Promise<void> {
    if (this.alice && this.bob) {
      ctx.releaseGenesisAccounts([this.alice, this.bob]);
    }
  }
}

export function createAccountUpdatesFiltersScenario(): AccountUpdatesFiltersScenario {
  return new AccountUpdatesFiltersScenario();
}
