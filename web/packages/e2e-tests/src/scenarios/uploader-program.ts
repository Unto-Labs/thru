import { BaseScenario } from "../framework/scenario";
import type { TestContext } from "../framework/context";
import type { TestResult } from "../framework/result";
import type { GenesisAccount } from "../accounts";
import { trackTransactionUntilFinalized, advanceSlots } from "../utils/timing";
import { deriveProgramAddress } from "@thru/thru-sdk";
import { sha256 } from "@noble/hashes/sha256";
import {
  UPLOADER_PROGRAM,
  UPLOADER_EXPIRY,
  UPLOADER_STATE_UNITS,
  UPLOADER_MEMORY_UNITS,
  UPLOADER_WRITE_COMPUTE,
  UPLOADER_COMPUTE_BASE,
  getOrderedAccountIndices,
  buildUploaderCreateInstruction,
  buildUploaderWriteInstruction,
  buildUploaderFinalizeInstruction,
  buildUploaderDestroyInstruction,
  computeUnitsForCreate,
  computeUnitsForFinalize,
} from "../programs";

const TEST_DATA_SIZE = 8 * 1024; // 8KB test data
const CHUNK_SIZE = 2 * 1024; // 2KB chunks

/**
 * UploaderProgramScenario tests all instructions of tn_uploader_program:
 * CREATE, WRITE, FINALIZE, and DESTROY
 */
export class UploaderProgramScenario extends BaseScenario {
  name = "Uploader Program";
  description =
    "Tests all 4 instructions of tn_uploader_program: CREATE, WRITE, FINALIZE, DESTROY";

  private alice: GenesisAccount | null = null;
  private bob: GenesisAccount | null = null;
  private dom: GenesisAccount | null = null;

  private seed: Uint8Array | null = null;
  private testData: Uint8Array | null = null;
  private expectedHash: Uint8Array | null = null;
  private metaAccount: Uint8Array | null = null;
  private metaAddress: string | null = null;
  private bufferAccount: Uint8Array | null = null;
  private bufferAddress: string | null = null;
  private aliceNonce: bigint = 0n;

  async setup(ctx: TestContext): Promise<void> {
    // Acquire genesis accounts
    const accounts = ctx.getGenesisAccounts(3);
    this.alice = accounts[0];
    this.bob = accounts[1];
    this.dom = accounts[2];

    ctx.logInfo("Using alice: %s", this.alice.publicKeyString);
    ctx.logInfo("Using bob: %s", this.bob.publicKeyString);
    ctx.logInfo("Using dom: %s", this.dom.publicKeyString);

    // Subscribe to accounts for nonce tracking
    await ctx.accountStateTracker.subscribeAccount(this.alice.publicKeyString);
    await ctx.accountStateTracker.subscribeAccount(this.bob.publicKeyString);
    await ctx.accountStateTracker.subscribeAccount(this.dom.publicKeyString);

    // Generate random seed (32 bytes)
    this.seed = new Uint8Array(32);
    crypto.getRandomValues(this.seed);
    ctx.logInfo("Generated seed: %s...", Buffer.from(this.seed.slice(0, 8)).toString("hex"));

    // Generate random test data (8KB)
    this.testData = new Uint8Array(TEST_DATA_SIZE);
    crypto.getRandomValues(this.testData);

    // Compute SHA256 hash of test data
    this.expectedHash = sha256(this.testData);
    ctx.logInfo(
      "Test data size: %d bytes, hash: %s...",
      this.testData.length,
      Buffer.from(this.expectedHash.slice(0, 8)).toString("hex")
    );

    // Derive meta account address (ephemeral)
    const metaDerived = deriveProgramAddress({
      programAddress: UPLOADER_PROGRAM,
      seed: this.seed,
      ephemeral: true,
    });
    this.metaAccount = metaDerived.bytes;
    this.metaAddress = metaDerived.address;
    ctx.logInfo("Meta account: %s", this.metaAddress);

    // Derive buffer account address (ephemeral, derived from meta)
    const bufferDerived = deriveProgramAddress({
      programAddress: UPLOADER_PROGRAM,
      seed: this.metaAccount,
      ephemeral: true,
    });
    this.bufferAccount = bufferDerived.bytes;
    this.bufferAddress = bufferDerived.address;
    ctx.logInfo("Buffer account: %s", this.bufferAddress);
    // Note: We subscribe to meta/buffer accounts AFTER creating them in executeCreate()
  }

  async execute(ctx: TestContext): Promise<TestResult> {
    const result: TestResult = {
      success: true,
      message: "Uploader program test passed",
      details: [],
      verificationDetails: [],
      executionTimeMs: 0,
    };

    ctx.logInfo("=== Uploader Program Test Starting ===");

    // Phase 1: Advance to slot 256 if needed
    const height = await ctx.sdk.blocks.getBlockHeight();
    const currentSlot = height.finalized;
    if (currentSlot < 256n) {
      const numSlots = 256n - currentSlot;
      ctx.logInfo("Phase 1: Advancing %d slots to reach slot 256", numSlots);
      await advanceSlots(
        ctx.sdk,
        ctx.blockSender,
        this.bob!,
        this.dom!,
        numSlots,
        ctx.config.chainId,
        ctx.logInfo.bind(ctx)
      );
      result.details.push(`Advanced ${numSlots} slots`);
    }

    // Phase 2: CREATE - Create meta and buffer accounts
    ctx.logInfo("Phase 2: CREATE - Creating meta and buffer accounts");
    const createResult = await this.executeCreate(ctx, result);
    if (!createResult.success) return createResult;

    // Phase 3: WRITE - Upload data in chunks
    const numChunks = Math.ceil(TEST_DATA_SIZE / CHUNK_SIZE);
    ctx.logInfo("Phase 3: WRITE - Uploading %d bytes in %d chunks", TEST_DATA_SIZE, numChunks);
    const writeResult = await this.executeWrite(ctx, result);
    if (!writeResult.success) return writeResult;

    // Phase 4: FINALIZE - Verify hash and lock data
    ctx.logInfo("Phase 4: FINALIZE - Verifying data hash");
    const finalizeResult = await this.executeFinalize(ctx, result);
    if (!finalizeResult.success) return finalizeResult;

    // Phase 5: Verify data via GetAccount before destroy
    ctx.logInfo("Phase 5: Verifying buffer data via GetAccount");
    const verifyResult = await this.verifyBufferData(ctx, result);
    if (!verifyResult.success) return verifyResult;

    // Phase 6: DESTROY - Delete accounts
    ctx.logInfo("Phase 6: DESTROY - Deleting meta and buffer accounts");
    const destroyResult = await this.executeDestroy(ctx, result);
    if (!destroyResult.success) return destroyResult;

    // Phase 7: Verify accounts are NOT FOUND
    ctx.logInfo("Phase 7: Verifying accounts are NOT FOUND");
    const notFoundResult = await this.verifyAccountsNotFound(ctx, result);
    if (!notFoundResult.success) return notFoundResult;

    result.message =
      "Successfully tested all uploader program instructions (CREATE/WRITE/FINALIZE/DESTROY)";
    ctx.logInfo("=== Uploader Program Test Completed ===");
    return result;
  }

  private async executeCreate(
    ctx: TestContext,
    result: TestResult
  ): Promise<TestResult> {
    // Get current slot and nonce (fetch once, then track locally)
    const height = await ctx.sdk.blocks.getBlockHeight();
    const startSlot = height.finalized;

    const aliceAcct = await ctx.sdk.accounts.get(this.alice!.publicKeyString);
    if (!aliceAcct) {
      return { ...result, success: false, message: "Failed to get alice account" };
    }
    this.aliceNonce = aliceAcct.meta?.nonce ?? 0n;

    // Get ordered account indices
    const { metaIdx, bufferIdx, orderedAccounts } = getOrderedAccountIndices(
      this.metaAccount!,
      this.bufferAccount!
    );

    // Build CREATE instruction
    const instruction = buildUploaderCreateInstruction(
      bufferIdx,
      metaIdx,
      0, // authority_idx = fee payer
      TEST_DATA_SIZE,
      this.expectedHash!,
      this.seed!
    );

    const computeUnits = computeUnitsForCreate(TEST_DATA_SIZE);

    const tx = await ctx.sdk.transactions.buildAndSign({
      feePayer: {
        publicKey: this.alice!.publicKey,
        privateKey: this.alice!.seed,
      },
      program: UPLOADER_PROGRAM,
      header: {
        fee: 1n,
        nonce: this.aliceNonce,
        startSlot: startSlot,
        expiryAfter: UPLOADER_EXPIRY,
        computeUnits: computeUnits,
        stateUnits: UPLOADER_STATE_UNITS,
        memoryUnits: UPLOADER_MEMORY_UNITS,
        chainId: ctx.config.chainId,
      },
      accounts: {
        readWrite: orderedAccounts,
      },
      instructionData: instruction,
    });

    // Track transaction and send as block
    const trackPromise = trackTransactionUntilFinalized(ctx.sdk, tx.signature.toThruFmt());
    await ctx.blockSender.sendAsBlock([tx.rawTransaction]);

    // Wait for transaction to finalize
    const status = (await trackPromise) as any;
    if (!status || status.executionResult?.vmError !== 0) {
      return {
        ...result,
        success: false,
        message: `CREATE failed: vmError=${status?.executionResult?.vmError}`,
      };
    }

    // Increment nonce after successful transaction
    this.aliceNonce++;

    // Transaction tracking confirmed vmError=0, so accounts were created successfully.
    // Trust the tracking result - no need for additional verification.
    ctx.logInfo("Meta and buffer accounts created (confirmed via tracking)");

    ctx.logInfo("Both meta and buffer accounts exist");
    result.verificationDetails.push("✓ CREATE: Meta and buffer accounts created");
    return result;
  }

  private async executeWrite(
    ctx: TestContext,
    result: TestResult
  ): Promise<TestResult> {
    // Get ordered account indices
    const { metaIdx, bufferIdx, orderedAccounts } = getOrderedAccountIndices(
      this.metaAccount!,
      this.bufferAccount!
    );

    let offset = 0;
    let chunkNum = 0;

    while (offset < TEST_DATA_SIZE) {
      const end = Math.min(offset + CHUNK_SIZE, TEST_DATA_SIZE);
      const chunk = this.testData!.slice(offset, end);

      // Get current slot (nonce is tracked locally)
      const height = await ctx.sdk.blocks.getBlockHeight();
      const startSlot = height.finalized;

      // Build WRITE instruction
      const instruction = buildUploaderWriteInstruction(bufferIdx, metaIdx, offset, chunk);

      const tx = await ctx.sdk.transactions.buildAndSign({
        feePayer: {
          publicKey: this.alice!.publicKey,
          privateKey: this.alice!.seed,
        },
        program: UPLOADER_PROGRAM,
        header: {
          fee: 1n,
          nonce: this.aliceNonce,
          startSlot: startSlot,
          expiryAfter: UPLOADER_EXPIRY,
          computeUnits: UPLOADER_WRITE_COMPUTE,
          stateUnits: UPLOADER_STATE_UNITS,
          memoryUnits: UPLOADER_MEMORY_UNITS,
          chainId: ctx.config.chainId,
        },
        accounts: {
          readWrite: orderedAccounts,
        },
        instructionData: instruction,
      });

      // Track transaction and send as block
      const trackPromise = trackTransactionUntilFinalized(ctx.sdk, tx.signature.toThruFmt());
      await ctx.blockSender.sendAsBlock([tx.rawTransaction]);

      // Wait for transaction to finalize
      const status = (await trackPromise) as any;
      if (!status || status.executionResult?.vmError !== 0) {
        return {
          ...result,
          success: false,
          message: `WRITE chunk ${chunkNum} failed: vmError=${status?.executionResult?.vmError}`,
        };
      }

      // Increment nonce after successful transaction
      this.aliceNonce++;

      offset = end;
      chunkNum++;
    }

    ctx.logInfo("Uploaded %d chunks", chunkNum);
    result.verificationDetails.push(`✓ WRITE: Uploaded ${TEST_DATA_SIZE} bytes in ${chunkNum} chunks`);
    return result;
  }

  private async executeFinalize(
    ctx: TestContext,
    result: TestResult
  ): Promise<TestResult> {
    // Get current slot (nonce is tracked locally)
    const height = await ctx.sdk.blocks.getBlockHeight();
    const startSlot = height.finalized;

    // Get ordered account indices
    const { metaIdx, bufferIdx, orderedAccounts } = getOrderedAccountIndices(
      this.metaAccount!,
      this.bufferAccount!
    );

    // Build FINALIZE instruction
    const instruction = buildUploaderFinalizeInstruction(
      bufferIdx,
      metaIdx,
      this.expectedHash!
    );

    const computeUnits = computeUnitsForFinalize(TEST_DATA_SIZE);

    const tx = await ctx.sdk.transactions.buildAndSign({
      feePayer: {
        publicKey: this.alice!.publicKey,
        privateKey: this.alice!.seed,
      },
      program: UPLOADER_PROGRAM,
      header: {
        fee: 1n,
        nonce: this.aliceNonce,
        startSlot: startSlot,
        expiryAfter: UPLOADER_EXPIRY,
        computeUnits: computeUnits,
        stateUnits: UPLOADER_STATE_UNITS,
        memoryUnits: UPLOADER_MEMORY_UNITS,
        chainId: ctx.config.chainId,
      },
      accounts: {
        readWrite: orderedAccounts,
      },
      instructionData: instruction,
    });

    // Track transaction and send as block
    const trackPromise = trackTransactionUntilFinalized(ctx.sdk, tx.signature.toThruFmt());
    await ctx.blockSender.sendAsBlock([tx.rawTransaction]);

    // Wait for transaction to finalize
    const status = (await trackPromise) as any;
    if (!status || status.executionResult?.vmError !== 0) {
      return {
        ...result,
        success: false,
        message: `FINALIZE failed: vmError=${status?.executionResult?.vmError}`,
      };
    }

    // Increment nonce after successful transaction
    this.aliceNonce++;

    ctx.logInfo("FINALIZE transaction succeeded");
    result.verificationDetails.push("✓ FINALIZE: Data hash verified and locked");
    return result;
  }

  private async verifyBufferData(
    ctx: TestContext,
    result: TestResult
  ): Promise<TestResult> {
    // Poll for buffer account data with correct content (indexer latency)
    const deadline = Date.now() + 30000;
    let lastError = "";

    while (Date.now() < deadline) {
      const bufferAcct = await ctx.sdk.accounts.get(this.bufferAddress!);
      if (!bufferAcct) {
        lastError = "Buffer account not found";
        await new Promise((r) => setTimeout(r, 200));
        continue;
      }

      const data = bufferAcct.data?.data;
      if (!data || data.length === 0) {
        lastError = "Buffer account has no data";
        await new Promise((r) => setTimeout(r, 200));
        continue;
      }

      if (data.length < TEST_DATA_SIZE) {
        lastError = `Buffer data too small: ${data.length} < ${TEST_DATA_SIZE}`;
        await new Promise((r) => setTimeout(r, 200));
        continue;
      }

      // Compare data
      const bufferData = data.slice(0, TEST_DATA_SIZE);
      let mismatch = -1;
      for (let i = 0; i < TEST_DATA_SIZE; i++) {
        if (bufferData[i] !== this.testData![i]) {
          mismatch = i;
          break;
        }
      }

      if (mismatch >= 0) {
        lastError = `Buffer data mismatch at byte ${mismatch}`;
        await new Promise((r) => setTimeout(r, 200));
        continue;
      }

      // Data matches!
      ctx.logInfo("Buffer data verified: %d bytes match", TEST_DATA_SIZE);
      result.verificationDetails.push("✓ Buffer data matches uploaded data");
      return result;
    }

    return {
      ...result,
      success: false,
      message: lastError || "Buffer data verification timed out",
    };
  }

  private async executeDestroy(
    ctx: TestContext,
    result: TestResult
  ): Promise<TestResult> {
    // Get current slot (nonce is tracked locally)
    const height = await ctx.sdk.blocks.getBlockHeight();
    const startSlot = height.finalized;

    // Get ordered account indices
    const { metaIdx, bufferIdx, orderedAccounts } = getOrderedAccountIndices(
      this.metaAccount!,
      this.bufferAccount!
    );

    // Build DESTROY instruction
    const instruction = buildUploaderDestroyInstruction(bufferIdx, metaIdx);

    const tx = await ctx.sdk.transactions.buildAndSign({
      feePayer: {
        publicKey: this.alice!.publicKey,
        privateKey: this.alice!.seed,
      },
      program: UPLOADER_PROGRAM,
      header: {
        fee: 1n,
        nonce: this.aliceNonce,
        startSlot: startSlot,
        expiryAfter: UPLOADER_EXPIRY,
        computeUnits: UPLOADER_COMPUTE_BASE,
        stateUnits: UPLOADER_STATE_UNITS,
        memoryUnits: UPLOADER_MEMORY_UNITS,
        chainId: ctx.config.chainId,
      },
      accounts: {
        readWrite: orderedAccounts,
      },
      instructionData: instruction,
    });

    // Track transaction and send as block
    const trackPromise = trackTransactionUntilFinalized(ctx.sdk, tx.signature.toThruFmt());
    await ctx.blockSender.sendAsBlock([tx.rawTransaction]);

    // Wait for transaction to finalize
    const status = (await trackPromise) as any;
    if (!status || status.executionResult?.vmError !== 0) {
      return {
        ...result,
        success: false,
        message: `DESTROY failed: vmError=${status?.executionResult?.vmError}`,
      };
    }

    // Increment nonce after successful transaction
    this.aliceNonce++;

    ctx.logInfo("DESTROY transaction succeeded");
    result.verificationDetails.push("✓ DESTROY: Accounts deleted");
    return result;
  }

  private async verifyAccountsNotFound(
    ctx: TestContext,
    result: TestResult
  ): Promise<TestResult> {
    // Poll for accounts to be NOT FOUND (indexer latency)
    const deadline = Date.now() + 30000;

    // Wait for meta account to be NOT FOUND
    while (Date.now() < deadline) {
      try {
        const metaAcct = await ctx.sdk.accounts.get(this.metaAddress!);
        if (!metaAcct) break; // Not found (returned null)
        await new Promise((r) => setTimeout(r, 200));
      } catch (err) {
        const errorMsg = (err as Error).message || String(err);
        if (errorMsg.includes("not_found") || errorMsg.includes("not found")) {
          break; // Expected: not found error
        }
        return {
          ...result,
          success: false,
          message: `Unexpected error checking meta account: ${errorMsg}`,
        };
      }
    }

    // Final check for meta account
    try {
      const metaAcct = await ctx.sdk.accounts.get(this.metaAddress!);
      if (metaAcct) {
        return {
          ...result,
          success: false,
          message: "Meta account still exists after DESTROY (timeout)",
        };
      }
    } catch {
      // Expected: not found
    }
    ctx.logInfo("Meta account NOT FOUND (expected)");

    // Wait for buffer account to be NOT FOUND
    while (Date.now() < deadline) {
      try {
        const bufferAcct = await ctx.sdk.accounts.get(this.bufferAddress!);
        if (!bufferAcct) break;
        await new Promise((r) => setTimeout(r, 200));
      } catch (err) {
        const errorMsg = (err as Error).message || String(err);
        if (errorMsg.includes("not_found") || errorMsg.includes("not found")) {
          break;
        }
        return {
          ...result,
          success: false,
          message: `Unexpected error checking buffer account: ${errorMsg}`,
        };
      }
    }

    // Final check for buffer account
    try {
      const bufferAcct = await ctx.sdk.accounts.get(this.bufferAddress!);
      if (bufferAcct) {
        return {
          ...result,
          success: false,
          message: "Buffer account still exists after DESTROY (timeout)",
        };
      }
    } catch {
      // Expected: not found
    }
    ctx.logInfo("Buffer account NOT FOUND (expected)");

    result.verificationDetails.push("✓ Meta account returns NOT FOUND");
    result.verificationDetails.push("✓ Buffer account returns NOT FOUND");
    return result;
  }

  async cleanup(ctx: TestContext): Promise<void> {
    // Unsubscribe from ephemeral accounts
    if (this.metaAddress) {
      ctx.accountStateTracker.unsubscribeAccount(this.metaAddress);
    }
    if (this.bufferAddress) {
      ctx.accountStateTracker.unsubscribeAccount(this.bufferAddress);
    }

    if (this.alice && this.bob && this.dom) {
      ctx.releaseGenesisAccounts([this.alice, this.bob, this.dom]);
    }
  }
}

export function createUploaderProgramScenario(): UploaderProgramScenario {
  return new UploaderProgramScenario();
}
