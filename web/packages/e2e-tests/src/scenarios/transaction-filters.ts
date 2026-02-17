import { BaseScenario } from "../framework/scenario";
import type { TestContext } from "../framework/context";
import type { TestResult } from "../framework/result";
import type { GenesisAccount } from "../accounts";
import { Filter, FilterParamValue } from "@thru/thru-sdk";
import type { StreamTransactionUpdate } from "@thru/thru-sdk";

// EOA program address (all zeros)
const EOA_PROGRAM = new Uint8Array(32);

// Transfer constants
const TRANSFER_FEE = 10n;
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

interface TransferInfo {
  signature: string;
  signatureBytes: Uint8Array;
  feePayer: string;
  feePayerPubkey: Uint8Array;
  fee: bigint;
}

/**
 * TransactionFiltersScenario tests StreamTransactions with CEL filters.
 * Tests various filter expressions including:
 * - has(transaction.slot)
 * - transaction.header.fee
 * - transaction.header.fee_payer_pubkey.value
 * - transaction.signature.value
 * - has(transaction.execution_result)
 * - transaction.execution_result.vm_error
 * - params.min_fee
 * - params.fee_payer
 * - Combined filters
 */
export class TransactionFiltersScenario extends BaseScenario {
  name = "Transaction Filters";
  description = "Tests StreamTransactions RPC with CEL filter expressions";

  private alice: GenesisAccount | null = null;
  private bob: GenesisAccount | null = null;
  private transfers: TransferInfo[] = [];

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
      message: "Transaction filters test passed",
      details: [],
      verificationDetails: [],
      executionTimeMs: 0,
    };

    ctx.logInfo("=== Transaction Filters Test Starting ===");

    // Phase 1: Test has(transaction.slot) filter with live transactions
    ctx.logInfo("Phase 1: Testing has(transaction.slot) filter");
    const hasSlotResult = await this.testFilterWithLiveTx(
      ctx,
      result,
      "has(transaction.slot)",
      new Filter({ expression: "has(transaction.slot)" }),
      (_tx) => true // All transactions should have slots
    );
    if (!hasSlotResult.success) return hasSlotResult;

    // Phase 2: Test transaction.header.fee filter
    ctx.logInfo("Phase 2: Testing transaction.header.fee filter");
    const feeResult = await this.testFilterWithLiveTx(
      ctx,
      result,
      `transaction.header.fee == ${TRANSFER_FEE}u`,
      new Filter({ expression: `transaction.header.fee == ${TRANSFER_FEE}u` }),
      (tx) => {
        if (tx.kind === "full") {
          return tx.transaction.fee === TRANSFER_FEE;
        }
        return true;
      }
    );
    if (!feeResult.success) return feeResult;

    // Phase 3: Test fee_payer_pubkey filter
    ctx.logInfo("Phase 3: Testing fee_payer_pubkey filter");
    const feePayerResult = await this.testFilterWithLiveTx(
      ctx,
      result,
      "fee_payer_pubkey.value == params.fee_payer",
      new Filter({
        expression: "transaction.header.fee_payer_pubkey.value == params.fee_payer",
        params: {
          fee_payer: FilterParamValue.bytes(this.alice!.publicKey),
        },
      }),
      (tx) => {
        if (tx.kind === "full") {
          return this.bytesEqual(tx.transaction.feePayer.toBytes(), this.alice!.publicKey);
        }
        return true;
      }
    );
    if (!feePayerResult.success) return feePayerResult;

    // Phase 4: Test has(execution_result) filter
    ctx.logInfo("Phase 4: Testing has(execution_result) filter");
    const hasExecResult = await this.testFilterWithLiveTx(
      ctx,
      result,
      "has(transaction.execution_result)",
      new Filter({ expression: "has(transaction.execution_result)" }),
      (tx) => {
        if (tx.kind === "full") {
          return tx.transaction.executionResult !== undefined;
        }
        return true;
      }
    );
    if (!hasExecResult.success) return hasExecResult;

    // Phase 5: Test vm_error == 0 filter (with has() to ensure execution result exists)
    ctx.logInfo("Phase 5: Testing vm_error filter");
    const vmErrorResult = await this.testFilterWithLiveTx(
      ctx,
      result,
      "has(execution_result) && vm_error == 0",
      new Filter({
        expression: "has(transaction.execution_result) && transaction.execution_result.vm_error == 0",
      }),
      (tx) => {
        if (tx.kind === "full") {
          // With has() filter, execution_result should exist
          if (tx.transaction.executionResult === undefined) {
            return false;
          }
          return tx.transaction.executionResult.vmError === 0;
        }
        return true;
      }
    );
    if (!vmErrorResult.success) return vmErrorResult;

    // Phase 6: Test params.min_fee filter
    ctx.logInfo("Phase 6: Testing params.min_fee filter");
    const minFee = 5n;
    const minFeeResult = await this.testFilterWithLiveTx(
      ctx,
      result,
      `transaction.header.fee >= params.min_fee (${minFee})`,
      new Filter({
        expression: "transaction.header.fee >= params.min_fee",
        params: {
          min_fee: FilterParamValue.uint(minFee),
        },
      }),
      (tx) => {
        if (tx.kind === "full") {
          return tx.transaction.fee >= minFee;
        }
        return true;
      }
    );
    if (!minFeeResult.success) return minFeeResult;

    // Phase 7: Test params.fee_payer (pubkey type) filter
    ctx.logInfo("Phase 7: Testing params.fee_payer (pubkey) filter");
    const feePayerPubkeyResult = await this.testFilterWithLiveTx(
      ctx,
      result,
      "fee_payer_pubkey.value == params.fee_payer (pubkey)",
      new Filter({
        expression: "transaction.header.fee_payer_pubkey.value == params.fee_payer",
        params: {
          fee_payer: FilterParamValue.pubkey(this.alice!.publicKey),
        },
      }),
      (tx) => {
        if (tx.kind === "full") {
          return this.bytesEqual(tx.transaction.feePayer.toBytes(), this.alice!.publicKey);
        }
        return true;
      }
    );
    if (!feePayerPubkeyResult.success) return feePayerPubkeyResult;

    // Phase 8: Test combined filters
    ctx.logInfo("Phase 8: Testing combined filters");
    const combinedResult = await this.testFilterWithLiveTx(
      ctx,
      result,
      "fee >= min_fee && fee_payer matches && has(exec) && vm_error == 0",
      new Filter({
        expression:
          "transaction.header.fee >= params.min_fee && " +
          "transaction.header.fee_payer_pubkey.value == params.fee_payer && " +
          "has(transaction.execution_result) && " +
          "transaction.execution_result.vm_error == 0",
        params: {
          min_fee: FilterParamValue.uint(5n),
          fee_payer: FilterParamValue.pubkey(this.alice!.publicKey),
        },
      }),
      (tx) => {
        if (tx.kind === "full") {
          if (tx.transaction.executionResult === undefined) {
            return false;
          }
          return (
            tx.transaction.fee >= 5n &&
            this.bytesEqual(tx.transaction.feePayer.toBytes(), this.alice!.publicKey) &&
            tx.transaction.executionResult.vmError === 0
          );
        }
        return true;
      }
    );
    if (!combinedResult.success) return combinedResult;

    ctx.logInfo("=== Transaction Filters Test Completed ===");
    return result;
  }

  /**
   * Test a filter by:
   * 1. Starting a stream with the filter
   * 2. Submitting a transaction
   * 3. Waiting for the transaction to appear in the stream
   * 4. Verifying the filter condition
   */
  private async testFilterWithLiveTx(
    ctx: TestContext,
    result: TestResult,
    filterName: string,
    filter: Filter,
    verify: (tx: StreamTransactionUpdate) => boolean
  ): Promise<TestResult> {
    const controller = new AbortController();
    const receivedTxs: StreamTransactionUpdate[] = [];
    let streamError: Error | null = null;

    // Start stream
    const streamPromise = (async () => {
      try {
        const stream = ctx.sdk.transactions.stream({
          filter,
          signal: controller.signal,
        });
        for await (const update of stream) {
          receivedTxs.push(update);
          // We only need one matching transaction
          if (receivedTxs.length >= 1) {
            break;
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          streamError = err as Error;
        }
      }
    })();

    // Give stream time to connect
    await new Promise((r) => setTimeout(r, 500));

    // Submit a transaction
    const aliceAcct = await ctx.sdk.accounts.get(this.alice!.publicKeyString);
    if (!aliceAcct) {
      controller.abort();
      return {
        ...result,
        success: false,
        message: `[${filterName}] Failed to get alice account`,
      };
    }

    const aliceNonce = aliceAcct.meta?.nonce ?? 0n;
    const height = await ctx.sdk.blocks.getBlockHeight();
    const startSlot = height.finalized;

    const instructionData = buildTransferInstruction(100n);
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

    await ctx.sdk.transactions.send(tx.rawTransaction);
    const signature = tx.signature.toThruFmt();
    ctx.logInfo("Submitted test transaction: %s", signature);

    this.transfers.push({
      signature,
      signatureBytes: tx.signature.toBytes(),
      feePayer: this.alice!.publicKeyString,
      feePayerPubkey: this.alice!.publicKey,
      fee: TRANSFER_FEE,
    });

    // Wait for transaction to appear in stream (with timeout)
    const waitStart = Date.now();
    const timeout = 15000;
    while (Date.now() - waitStart < timeout && receivedTxs.length === 0) {
      await new Promise((r) => setTimeout(r, 100));
    }

    // Abort the stream
    controller.abort();
    await streamPromise;

    if (streamError !== null) {
      return {
        ...result,
        success: false,
        message: `[${filterName}] Stream error: ${(streamError as Error).message}`,
      };
    }

    if (receivedTxs.length === 0) {
      return {
        ...result,
        success: false,
        message: `[${filterName}] No transactions received in stream (timeout ${timeout}ms)`,
      };
    }

    // Verify all received transactions match the filter condition
    for (const receivedTx of receivedTxs) {
      if (!verify(receivedTx)) {
        // Log details for debugging
        if (receivedTx.kind === "full") {
          ctx.logInfo(
            "[%s] Mismatch: fee=%d, vmError=%s, feePayer=%s",
            filterName,
            receivedTx.transaction.fee,
            receivedTx.transaction.executionResult?.vmError,
            receivedTx.transaction.feePayer.toThruFmt()
          );
        }
        return {
          ...result,
          success: false,
          message: `[${filterName}] Received transaction that doesn't match filter condition`,
        };
      }
    }

    result.verificationDetails.push(
      `✓ ${filterName}: received ${receivedTxs.length} matching transaction(s)`
    );
    return result;
  }

  private bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  async cleanup(ctx: TestContext): Promise<void> {
    if (this.bob) {
      ctx.releaseGenesisAccounts([this.bob]);
    }
  }
}

export function createTransactionFiltersScenario(): TransactionFiltersScenario {
  return new TransactionFiltersScenario();
}
