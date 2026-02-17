import { BaseScenario } from "../framework/scenario";
import type { TestContext } from "../framework/context";
import type { TestResult } from "../framework/result";
import type { GenesisAccount } from "../accounts";

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
  view.setUint32(0, 1, true); // discriminant = transfer
  view.setBigUint64(4, amount, true);
  view.setUint16(12, 0, true); // from_account_idx = fee payer
  view.setUint16(14, 2, true); // to_account_idx = first RW account
  return data;
}

/**
 * StreamBlocksScenario tests the StreamBlocks streaming API
 */
export class StreamBlocksScenario extends BaseScenario {
  name = "Stream Blocks";
  description = "Test StreamBlocks CEL filters on block headers";

  private senderAccount: GenesisAccount | null = null;
  private receiverAccount: GenesisAccount | null = null;

  async setup(ctx: TestContext): Promise<void> {
    const accounts = ctx.getGenesisAccounts(1);
    this.senderAccount = ctx.genesisAccount;
    this.receiverAccount = accounts[0];
    ctx.logInfo(
      "Using accounts: sender=%s receiver=%s",
      this.senderAccount.publicKeyString,
      this.receiverAccount.publicKeyString
    );
  }

  async execute(ctx: TestContext): Promise<TestResult> {
    const result: TestResult = {
      success: true,
      message: "StreamBlocks test passed",
      details: [],
      verificationDetails: [],
      executionTimeMs: 0,
    };

    ctx.logInfo("=== StreamBlocks Test Starting ===");

    result.details.push("Testing StreamBlocks subscription");

    // Get current height - start stream from current slot
    const height = await ctx.sdk.blocks.getBlockHeight();
    const startSlot = height.finalized;
    ctx.logInfo("Starting stream from slot %d", startSlot);

    const blocksReceived: bigint[] = [];
    const controller = new AbortController();

    // Set timeout to abort after 30 seconds
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, 30000);

    // Start stream FIRST (before submitting transactions)
    ctx.logInfo("Starting block stream...");
    const iterable = ctx.sdk.blocks.stream({ startSlot, signal: controller.signal });

    // Submit transactions in background to generate new blocks
    const submitTransactions = async () => {
      try {
        // Get fresh account data
        const sender = await ctx.sdk.accounts.get(this.senderAccount!.publicKeyString);
        if (!sender) return;

        const senderNonce = sender.meta?.nonce ?? 0n;
        const instructionData = buildTransferInstruction(TRANSFER_AMOUNT);

        // Submit 3 transactions to generate blocks
        for (let i = 0; i < 3; i++) {
          const tx = await ctx.sdk.transactions.buildAndSign({
            feePayer: {
              publicKey: this.senderAccount!.publicKey,
              privateKey: this.senderAccount!.seed,
            },
            program: EOA_PROGRAM,
            header: {
              fee: TRANSFER_FEE,
              nonce: senderNonce + BigInt(i),
              startSlot: startSlot,
              expiryAfter: TRANSFER_EXPIRY,
              computeUnits: TRANSFER_CU,
              stateUnits: TRANSFER_SU,
              memoryUnits: TRANSFER_MU,
              chainId: ctx.config.chainId,
            },
            accounts: {
              readWrite: [this.receiverAccount!.publicKey],
            },
            instructionData,
          });

          await ctx.sdk.transactions.send(tx.rawTransaction);
          ctx.logInfo("Submitted transaction %d", i + 1);

          // Small delay between transactions
          await new Promise((r) => setTimeout(r, 500));
        }
      } catch (err) {
        ctx.logError("Error submitting transactions: %s", (err as Error).message);
      }
    };

    // Start transaction submission in background
    const submissionPromise = submitTransactions();

    try {
      for await (const response of iterable) {
        const slot = response.block?.header?.slot ?? 0n;
        blocksReceived.push(slot);
        ctx.logInfo("Received block: slot=%d", slot);

        // Stop after receiving 3 blocks
        if (blocksReceived.length >= 3) {
          controller.abort();
          break;
        }
      }
    } catch (err) {
      // AbortError and canceled errors are expected when we cancel
      const errName = (err as Error).name;
      const errMessage = (err as Error).message;
      if (errName !== "AbortError" && !errMessage?.includes("canceled")) {
        ctx.logError("Stream error: %s (name=%s)", errMessage, errName);
      }
    } finally {
      clearTimeout(timeoutId);
      await submissionPromise; // Wait for transaction submission to complete
    }

    if (blocksReceived.length === 0) {
      return {
        ...result,
        success: false,
        message: "No blocks received from stream",
      };
    }

    result.verificationDetails.push(`✓ Received ${blocksReceived.length} blocks via streaming`);
    result.verificationDetails.push(`✓ Block slots: ${blocksReceived.join(", ")}`);

    ctx.logInfo("=== StreamBlocks Test Completed ===");

    return result;
  }

  async cleanup(ctx: TestContext): Promise<void> {
    // Only release accounts acquired via getGenesisAccounts
    if (this.receiverAccount) {
      ctx.releaseGenesisAccounts([this.receiverAccount]);
    }
  }
}

export function createStreamBlocksScenario(): StreamBlocksScenario {
  return new StreamBlocksScenario();
}
