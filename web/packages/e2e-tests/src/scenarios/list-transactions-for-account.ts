import { BaseScenario } from "../framework/scenario";
import type { TestContext } from "../framework/context";
import type { TestResult } from "../framework/result";
import type { GenesisAccount } from "../accounts";
import { PageRequest, Filter } from "@thru/thru-sdk";

// EOA program address (all zeros)
const EOA_PROGRAM = new Uint8Array(32);

// Transfer constants
const TRANSFER_AMOUNT = 100n;
const TRANSFER_FEE = 10n;
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
 * ListTransactionsForAccountScenario tests the ListTransactionsForAccount RPC endpoint with CEL filtering
 */
export class ListTransactionsForAccountScenario extends BaseScenario {
  name = "List Transactions For Account";
  description = "Tests ListTransactionsForAccount RPC with CEL filters";

  private alice: GenesisAccount | null = null;
  private bob: GenesisAccount | null = null;
  private transferSignatures: string[] = [];

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
      message: "ListTransactionsForAccount test passed",
      details: [],
      verificationDetails: [],
      executionTimeMs: 0,
    };

    ctx.logInfo("Phase 1: Create balance transfer transactions");
    const createResult = await this.createTransactions(ctx, result);
    if (!createResult.success) return createResult;

    ctx.logInfo("Phase 2: Test basic ListTransactionsForAccount");
    const basicResult = await this.testBasicList(ctx, result);
    if (!basicResult.success) return basicResult;

    ctx.logInfo("Phase 3: Test filtering by vm_error");
    const filterResult = await this.testVmErrorFiltering(ctx, result);
    if (!filterResult.success) return filterResult;

    ctx.logInfo("Phase 4: Test pagination");
    const paginationResult = await this.testPagination(ctx, result);
    if (!paginationResult.success) return paginationResult;

    return result;
  }

  private async createTransactions(
    ctx: TestContext,
    result: TestResult
  ): Promise<TestResult> {
    // Get alice's nonce
    const aliceAcct = await ctx.sdk.accounts.get(this.alice!.publicKeyString);
    if (!aliceAcct) {
      return {
        ...result,
        success: false,
        message: "Failed to get alice account",
      };
    }

    const aliceNonce = aliceAcct.meta?.nonce ?? 0n;
    const height = await ctx.sdk.blocks.getBlockHeight();
    const startSlot = height.finalized;

    // Create multiple transfer transactions
    const numTransfers = 3;
    for (let i = 0; i < numTransfers; i++) {
      const instructionData = buildTransferInstruction(TRANSFER_AMOUNT + BigInt(i * 10));

      const tx = await ctx.sdk.transactions.buildAndSign({
        feePayer: {
          publicKey: this.alice!.publicKey,
          privateKey: this.alice!.seed,
        },
        program: EOA_PROGRAM,
        header: {
          fee: TRANSFER_FEE,
          nonce: aliceNonce + BigInt(i),
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
      this.transferSignatures.push(tx.signature.toThruFmt());
      ctx.logInfo("Submitted transaction %d: %s", i + 1, tx.signature.toThruFmt());

      // Small delay between transactions
      await new Promise((r) => setTimeout(r, 100));
    }

    // Wait for all transactions to complete
    const expectedNonce = aliceNonce + BigInt(numTransfers);
    const startTime = Date.now();
    while (Date.now() - startTime < 30000) {
      const currentNonce = ctx.accountStateTracker.getNonce(this.alice!.publicKeyString);
      if (currentNonce >= expectedNonce) break;
      await new Promise((r) => setTimeout(r, 100));
    }

    result.details.push(`Created ${numTransfers} transfer transactions`);
    return result;
  }

  private async testBasicList(ctx: TestContext, result: TestResult): Promise<TestResult> {
    // Poll until indexer has all transactions (async indexing may lag behind execution)
    const expected = this.transferSignatures.length;
    const deadline = Date.now() + 30_000;
    let lastCount = 0;

    while (Date.now() < deadline) {
      const resp = await ctx.sdk.transactions.listForAccount(this.alice!.publicKeyString, {
        page: new PageRequest({ pageSize: 10 }),
      });

      lastCount = resp?.transactions?.length ?? 0;
      if (lastCount >= expected) {
        ctx.logInfo("ListTransactionsForAccount returned %d transactions", lastCount);
        result.verificationDetails.push(
          `✓ ListTransactionsForAccount returned ${lastCount} transactions`
        );
        return result;
      }

      await new Promise((r) => setTimeout(r, 500));
    }

    return {
      ...result,
      success: false,
      message: `Expected at least ${expected} transactions, got ${lastCount}`,
    };
  }

  private async testVmErrorFiltering(
    ctx: TestContext,
    result: TestResult
  ): Promise<TestResult> {
    // Filter for successful transactions (vm_error == 0)
    const resp = await ctx.sdk.transactions.listForAccount(this.alice!.publicKeyString, {
      filter: new Filter({
        expression: "transaction.execution_result.vm_error == 0",
      }),
      page: new PageRequest({ pageSize: 10 }),
    });

    if (!resp || !resp.transactions) {
      return {
        ...result,
        success: false,
        message: "ListTransactionsForAccount with filter returned null",
      };
    }

    ctx.logInfo(
      "ListTransactionsForAccount (vm_error==0) returned %d transactions",
      resp.transactions.length
    );

    // All returned transactions should be successful
    for (const tx of resp.transactions) {
      if (tx.executionResult?.vmError !== 0) {
        return {
          ...result,
          success: false,
          message: `Filter failed: found transaction with vmError=${tx.executionResult?.vmError}`,
        };
      }
    }

    result.verificationDetails.push(
      `✓ vm_error filter returned ${resp.transactions.length} successful transactions`
    );
    return result;
  }

  private async testPagination(ctx: TestContext, result: TestResult): Promise<TestResult> {
    // Get first page with small page size
    const page1 = await ctx.sdk.transactions.listForAccount(this.alice!.publicKeyString, {
      page: new PageRequest({ pageSize: 2 }),
    });

    if (!page1 || !page1.transactions) {
      return {
        ...result,
        success: false,
        message: "First page returned null",
      };
    }

    ctx.logInfo("Page 1: %d transactions", page1.transactions.length);

    // If there's a next page, fetch it
    if (page1.page?.nextPageToken) {
      const page2 = await ctx.sdk.transactions.listForAccount(this.alice!.publicKeyString, {
        page: new PageRequest({
          pageSize: 2,
          pageToken: page1.page.nextPageToken,
        }),
      });

      if (page2 && page2.transactions) {
        ctx.logInfo("Page 2: %d transactions", page2.transactions.length);
        result.verificationDetails.push(
          `✓ Pagination: page1=${page1.transactions.length}, page2=${page2.transactions.length}`
        );
      }
    } else {
      result.verificationDetails.push(
        `✓ Pagination: page1=${page1.transactions.length} (no more pages)`
      );
    }

    return result;
  }

  async cleanup(ctx: TestContext): Promise<void> {
    if (this.alice && this.bob) {
      ctx.releaseGenesisAccounts([this.alice, this.bob]);
    }
  }
}

export function createListTransactionsForAccountScenario(): ListTransactionsForAccountScenario {
  return new ListTransactionsForAccountScenario();
}
