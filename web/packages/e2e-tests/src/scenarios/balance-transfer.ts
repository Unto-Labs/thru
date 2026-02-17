import { BaseScenario } from "../framework/scenario";
import type { TestContext } from "../framework/context";
import type { TestResult } from "../framework/result";
import type { GenesisAccount } from "../accounts";

const TRANSFER_AMOUNT = 71n;
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
 * BalanceTransferScenario tests a comprehensive balance transfer workflow:
 * - Transaction submission and tracking
 * - Balance updates via streaming
 * - Block inclusion and retrieval
 */
export class BalanceTransferScenario extends BaseScenario {
  name = "Balance Transfer";
  description =
    "Comprehensive test of balance transfer including streaming updates, block inclusion, and execution verification";

  private carolAccount: GenesisAccount | null = null;
  private daveAccount: GenesisAccount | null = null;

  async setup(ctx: TestContext): Promise<void> {
    // Get two accounts from genesis pool
    const accounts = ctx.getGenesisAccounts(1);
    this.carolAccount = ctx.genesisAccount;
    this.daveAccount = accounts[0];

    ctx.logInfo(
      "Using accounts: carol=%s dave=%s",
      this.carolAccount.publicKeyString,
      this.daveAccount.publicKeyString
    );
  }

  async execute(ctx: TestContext): Promise<TestResult> {
    const result: TestResult = {
      success: true,
      message: "Balance transfer test passed",
      details: [],
      verificationDetails: [],
      executionTimeMs: 0,
    };

    ctx.logInfo("=== Balance Transfer Test Starting ===");

    // Get current balances
    const carolAcct = await ctx.sdk.accounts.get(this.carolAccount!.publicKeyString);
    const daveAcct = await ctx.sdk.accounts.get(this.daveAccount!.publicKeyString);

    if (!carolAcct) {
      return {
        ...result,
        success: false,
        message: "Failed to get carol account",
      };
    }
    if (!daveAcct) {
      return {
        ...result,
        success: false,
        message: "Failed to get dave account",
      };
    }

    const carolBalance = carolAcct.meta?.balance ?? 0n;
    const daveBalance = daveAcct.meta?.balance ?? 0n;

    ctx.logInfo("Initial balances: carol=%d dave=%d", carolBalance, daveBalance);

    // Get current slot
    const height = await ctx.sdk.blocks.getBlockHeight();
    const startSlot = height.finalized + 1n;
    ctx.logInfo("Using startSlot=%d", startSlot);

    result.details.push(
      `Transfer ${TRANSFER_AMOUNT} units from carol to dave with fee ${TRANSFER_FEE}`
    );

    const expectedCarol = carolBalance - TRANSFER_AMOUNT - TRANSFER_FEE;
    const expectedDave = daveBalance + TRANSFER_AMOUNT;

    // Subscribe to account updates
    await ctx.accountStateTracker.subscribeAccount(this.carolAccount!.publicKeyString);
    await ctx.accountStateTracker.subscribeAccount(this.daveAccount!.publicKeyString);

    ctx.logInfo("Subscribed to account updates for carol and dave");

    // Build transfer instruction
    const instructionData = buildTransferInstruction(TRANSFER_AMOUNT);

    // Build and sign transfer transaction
    const tx = await ctx.sdk.transactions.buildAndSign({
      feePayer: {
        publicKey: this.carolAccount!.publicKey,
        privateKey: this.carolAccount!.seed,
      },
      program: EOA_PROGRAM,
      header: {
        fee: TRANSFER_FEE,
        nonce: carolAcct.meta?.nonce ?? 0n,
        startSlot: startSlot,
        expiryAfter: TRANSFER_EXPIRY,
        computeUnits: TRANSFER_CU,
        stateUnits: TRANSFER_SU,
        memoryUnits: TRANSFER_MU,
        chainId: ctx.config.chainId,
      },
      accounts: {
        readWrite: [this.daveAccount!.publicKey],
      },
      instructionData,
    });

    // Submit transaction
    const submittedSignature = await ctx.sdk.transactions.send(tx.rawTransaction);
    const signature = tx.signature.toThruFmt();

    ctx.logInfo("Transaction submitted: signature=%s", signature);
    result.verificationDetails.push(`✓ Transaction submitted (signature: ${signature})`);

    // Wait for account balance updates via streaming
    ctx.logInfo("Waiting for carol balance to reach %d...", expectedCarol);
    await ctx.accountStateTracker.waitForBalanceChange(
      this.carolAccount!.publicKeyString,
      expectedCarol,
      15000
    );

    ctx.logInfo("Waiting for dave balance to reach %d...", expectedDave);
    await ctx.accountStateTracker.waitForBalanceChange(
      this.daveAccount!.publicKeyString,
      expectedDave,
      15000
    );


    // Get final balances
    const finalCarolBalance = ctx.accountStateTracker.getBalance(
      this.carolAccount!.publicKeyString
    );
    const finalDaveBalance = ctx.accountStateTracker.getBalance(this.daveAccount!.publicKeyString);

    ctx.logInfo(
      "Final balances: carol=%d (expected %d) dave=%d (expected %d)",
      finalCarolBalance,
      expectedCarol,
      finalDaveBalance,
      expectedDave
    );

    if (finalCarolBalance !== expectedCarol) {
      return {
        ...result,
        success: false,
        message: `Carol balance mismatch: got ${finalCarolBalance}, expected ${expectedCarol}`,
      };
    }

    if (finalDaveBalance !== expectedDave) {
      return {
        ...result,
        success: false,
        message: `Dave balance mismatch: got ${finalDaveBalance}, expected ${expectedDave}`,
      };
    }

    result.verificationDetails.push(
      `✓ Carol balance: ${finalCarolBalance} (transferred out ${TRANSFER_AMOUNT} + fee ${TRANSFER_FEE})`
    );
    result.verificationDetails.push(
      `✓ Dave balance: ${finalDaveBalance} (received ${TRANSFER_AMOUNT})`
    );

    ctx.logInfo("=== Balance Transfer Test Completed ===");

    return result;
  }

  async cleanup(ctx: TestContext): Promise<void> {
    // Only release accounts acquired via getGenesisAccounts, not ctx.genesisAccount
    if (this.daveAccount) {
      ctx.releaseGenesisAccounts([this.daveAccount]);
    }
  }
}

export function createBalanceTransferScenario(): BalanceTransferScenario {
  return new BalanceTransferScenario();
}
