import { BaseScenario } from "../framework/scenario";
import type { TestContext } from "../framework/context";
import type { TestResult } from "../framework/result";
import type { GenesisAccount } from "../accounts";
import { deriveProgramAddress, consensus } from "@thru/thru-sdk";
import {
  TEST_UPLOADER_PROGRAM,
  buildTestUploaderCreateInstruction,
  buildTestUploaderWriteInstruction,
  buildTestUploaderResizeInstruction,
} from "../programs";

const DEFAULT_EXPIRY = 100;
const DEFAULT_STATE_UNITS = 10_000;
const DEFAULT_MEMORY_UNITS = 10_000;

/**
 * IntraBlockSeqTrackingScenario tests GetAccount with seq numbers for tracking
 * intra-block account state changes. It performs multiple operations on an
 * account within a single block and verifies that each intermediate state can
 * be retrieved using the seq number.
 *
 * Operations performed in one block:
 *  1. Create account with 100 bytes (seq=1)
 *  2. Write pattern 0xAA to those 100 bytes (seq=2)
 *  3. Resize up to 2MB (seq=3)
 *  4. Write pattern 0xBB to start of 2MB (seq=4)
 *  5. Write pattern 0xCC to middle of 2MB at 1MB offset (seq=5)
 *  6. Write pattern 0xDD to end of 2MB (seq=6)
 *  7. Resize down to 50 bytes (seq=7)
 *  8. Write pattern 0xEE to those 50 bytes (seq=8)
 */
export class IntraBlockSeqTrackingScenario extends BaseScenario {
  name = "Intra-Block Seq Tracking";
  description =
    "Tests GetAccount with seq numbers for tracking intra-block account state changes";

  private alice: GenesisAccount | null = null;
  private seed: Uint8Array | null = null;
  private ephemeralAccount: Uint8Array | null = null;
  private ephemeralAddress: string | null = null;

  /* Test data patterns */
  private pattern1: Uint8Array | null = null;
  private pattern2Start: Uint8Array | null = null;
  private pattern2Middle: Uint8Array | null = null;
  private pattern2End: Uint8Array | null = null;
  private pattern3: Uint8Array | null = null;

  /* Constants */
  private readonly SIZE_1 = 100; /* Initial small size */
  private readonly SIZE_2 = 2 * 1024 * 1024; /* 2MB */
  private readonly SIZE_3 = 50; /* Final small size */

  async setup(ctx: TestContext): Promise<void> {
    /* Acquire genesis account */
    const accounts = ctx.getGenesisAccounts(1);
    this.alice = accounts[0];

    ctx.logInfo("Using alice: %s", this.alice.publicKeyString);

    /* Generate a random seed for the ephemeral account */
    this.seed = new Uint8Array(16);
    crypto.getRandomValues(this.seed);

    /* Derive the ephemeral account address using TestUploaderProgram as owner */
    const derived = deriveProgramAddress({
      programAddress: TEST_UPLOADER_PROGRAM,
      seed: this.seed,
      ephemeral: true,
    });
    this.ephemeralAccount = derived.bytes;
    this.ephemeralAddress = derived.address;

    ctx.logInfo("Ephemeral account: %s", this.ephemeralAddress);

    /* Generate patterns */
    this.pattern1 = generatePattern(0xaa, this.SIZE_1);
    this.pattern2Start = generatePattern(0xbb, 4096);
    this.pattern2Middle = generatePattern(0xcc, 4096);
    this.pattern2End = generatePattern(0xdd, 4096);
    this.pattern3 = generatePattern(0xee, this.SIZE_3);

    /* Subscribe to alice for nonce tracking */
    await ctx.accountStateTracker.subscribeAccount(this.alice.publicKeyString);
  }

  async execute(ctx: TestContext): Promise<TestResult> {
    const result: TestResult = {
      success: true,
      message: "Intra-block seq tracking test passed",
      details: [],
      verificationDetails: [],
      executionTimeMs: 0,
    };

    ctx.logInfo("=== Intra-Block Seq Tracking Test Starting ===");
    ctx.logInfo("Testing ephemeral account: %s", this.ephemeralAddress);

    /* Get current nonce and slot */
    const aliceAcct = await ctx.sdk.accounts.get(this.alice!.publicKeyString);
    if (!aliceAcct) {
      return { ...result, success: false, message: "Failed to get alice account" };
    }
    let nonce = aliceAcct.meta?.nonce ?? 0n;

    const height = await ctx.sdk.blocks.getBlockHeight();
    const startSlot = height.finalized + 1n;

    ctx.logInfo("Building transactions for single-block execution...");

    const transactions: Uint8Array[] = [];
    const txnNames = [
      "create_100",
      "write_100",
      "resize_2MB",
      "write_2MB_start",
      "write_2MB_middle",
      "write_2MB_end",
      "resize_50",
      "write_50",
    ];

    /* 1. Create account with 100 bytes using TestUploaderProgram */
    const createInstruction = buildTestUploaderCreateInstruction(
      2, /* target account at index 2 */
      this.SIZE_1,
      this.seed!,
      true, /* isEphemeral */
      new Uint8Array(0) /* no state proof needed for ephemeral */
    );
    const createTx = await ctx.sdk.transactions.buildAndSign({
      feePayer: {
        publicKey: this.alice!.publicKey,
        privateKey: this.alice!.seed,
      },
      program: TEST_UPLOADER_PROGRAM,
      header: {
        fee: 1n,
        nonce: nonce++,
        startSlot: startSlot,
        expiryAfter: DEFAULT_EXPIRY,
        computeUnits: 100_000,
        stateUnits: DEFAULT_STATE_UNITS,
        memoryUnits: DEFAULT_MEMORY_UNITS,
        chainId: ctx.config.chainId,
      },
      accounts: {
        readWrite: [this.ephemeralAccount!],
      },
      instructionData: createInstruction,
    });
    transactions.push(createTx.rawTransaction);

    /* 2. Write pattern1 to 100 bytes */
    const write1Instruction = buildTestUploaderWriteInstruction(
      2, /* target account at index 2 */
      0,
      this.pattern1!
    );
    const write1Tx = await ctx.sdk.transactions.buildAndSign({
      feePayer: {
        publicKey: this.alice!.publicKey,
        privateKey: this.alice!.seed,
      },
      program: TEST_UPLOADER_PROGRAM,
      header: {
        fee: 1n,
        nonce: nonce++,
        startSlot: startSlot,
        expiryAfter: DEFAULT_EXPIRY,
        computeUnits: 50_000,
        stateUnits: DEFAULT_STATE_UNITS,
        memoryUnits: DEFAULT_MEMORY_UNITS,
        chainId: ctx.config.chainId,
      },
      accounts: {
        readWrite: [this.ephemeralAccount!],
      },
      instructionData: write1Instruction,
    });
    transactions.push(write1Tx.rawTransaction);

    /* 3. Resize to 2MB */
    const resize2Instruction = buildTestUploaderResizeInstruction(2, this.SIZE_2);
    const computeForResize2 = 100_000 + this.SIZE_2;
    const resize2Tx = await ctx.sdk.transactions.buildAndSign({
      feePayer: {
        publicKey: this.alice!.publicKey,
        privateKey: this.alice!.seed,
      },
      program: TEST_UPLOADER_PROGRAM,
      header: {
        fee: 1n,
        nonce: nonce++,
        startSlot: startSlot,
        expiryAfter: DEFAULT_EXPIRY,
        computeUnits: computeForResize2,
        stateUnits: DEFAULT_STATE_UNITS,
        memoryUnits: DEFAULT_MEMORY_UNITS,
        chainId: ctx.config.chainId,
      },
      accounts: {
        readWrite: [this.ephemeralAccount!],
      },
      instructionData: resize2Instruction,
    });
    transactions.push(resize2Tx.rawTransaction);

    /* 4a. Write pattern2Start to beginning of 2MB */
    const write2aInstruction = buildTestUploaderWriteInstruction(
      2,
      0,
      this.pattern2Start!
    );
    const write2aTx = await ctx.sdk.transactions.buildAndSign({
      feePayer: {
        publicKey: this.alice!.publicKey,
        privateKey: this.alice!.seed,
      },
      program: TEST_UPLOADER_PROGRAM,
      header: {
        fee: 1n,
        nonce: nonce++,
        startSlot: startSlot,
        expiryAfter: DEFAULT_EXPIRY,
        computeUnits: 100_000,
        stateUnits: DEFAULT_STATE_UNITS,
        memoryUnits: DEFAULT_MEMORY_UNITS,
        chainId: ctx.config.chainId,
      },
      accounts: {
        readWrite: [this.ephemeralAccount!],
      },
      instructionData: write2aInstruction,
    });
    transactions.push(write2aTx.rawTransaction);

    /* 4b. Write pattern2Middle to middle of 2MB (at 1MB offset) */
    const write2bInstruction = buildTestUploaderWriteInstruction(
      2,
      1024 * 1024, /* 1MB offset */
      this.pattern2Middle!
    );
    const write2bTx = await ctx.sdk.transactions.buildAndSign({
      feePayer: {
        publicKey: this.alice!.publicKey,
        privateKey: this.alice!.seed,
      },
      program: TEST_UPLOADER_PROGRAM,
      header: {
        fee: 1n,
        nonce: nonce++,
        startSlot: startSlot,
        expiryAfter: DEFAULT_EXPIRY,
        computeUnits: 100_000,
        stateUnits: DEFAULT_STATE_UNITS,
        memoryUnits: DEFAULT_MEMORY_UNITS,
        chainId: ctx.config.chainId,
      },
      accounts: {
        readWrite: [this.ephemeralAccount!],
      },
      instructionData: write2bInstruction,
    });
    transactions.push(write2bTx.rawTransaction);

    /* 4c. Write pattern2End to end of 2MB (near the end) */
    const write2cInstruction = buildTestUploaderWriteInstruction(
      2,
      this.SIZE_2 - 4096, /* Near end */
      this.pattern2End!
    );
    const write2cTx = await ctx.sdk.transactions.buildAndSign({
      feePayer: {
        publicKey: this.alice!.publicKey,
        privateKey: this.alice!.seed,
      },
      program: TEST_UPLOADER_PROGRAM,
      header: {
        fee: 1n,
        nonce: nonce++,
        startSlot: startSlot,
        expiryAfter: DEFAULT_EXPIRY,
        computeUnits: 100_000,
        stateUnits: DEFAULT_STATE_UNITS,
        memoryUnits: DEFAULT_MEMORY_UNITS,
        chainId: ctx.config.chainId,
      },
      accounts: {
        readWrite: [this.ephemeralAccount!],
      },
      instructionData: write2cInstruction,
    });
    transactions.push(write2cTx.rawTransaction);

    /* 5. Resize down to 50 bytes */
    const resize3Instruction = buildTestUploaderResizeInstruction(2, this.SIZE_3);
    const computeForResize3 = 100_000 + this.SIZE_3;
    const resize3Tx = await ctx.sdk.transactions.buildAndSign({
      feePayer: {
        publicKey: this.alice!.publicKey,
        privateKey: this.alice!.seed,
      },
      program: TEST_UPLOADER_PROGRAM,
      header: {
        fee: 1n,
        nonce: nonce++,
        startSlot: startSlot,
        expiryAfter: DEFAULT_EXPIRY,
        computeUnits: computeForResize3,
        stateUnits: DEFAULT_STATE_UNITS,
        memoryUnits: DEFAULT_MEMORY_UNITS,
        chainId: ctx.config.chainId,
      },
      accounts: {
        readWrite: [this.ephemeralAccount!],
      },
      instructionData: resize3Instruction,
    });
    transactions.push(resize3Tx.rawTransaction);

    /* 6. Write pattern3 to final 50 bytes */
    const write3Instruction = buildTestUploaderWriteInstruction(
      2,
      0,
      this.pattern3!
    );
    const write3Tx = await ctx.sdk.transactions.buildAndSign({
      feePayer: {
        publicKey: this.alice!.publicKey,
        privateKey: this.alice!.seed,
      },
      program: TEST_UPLOADER_PROGRAM,
      header: {
        fee: 1n,
        nonce: nonce++,
        startSlot: startSlot,
        expiryAfter: DEFAULT_EXPIRY,
        computeUnits: 50_000,
        stateUnits: DEFAULT_STATE_UNITS,
        memoryUnits: DEFAULT_MEMORY_UNITS,
        chainId: ctx.config.chainId,
      },
      accounts: {
        readWrite: [this.ephemeralAccount!],
      },
      instructionData: write3Instruction,
    });
    transactions.push(write3Tx.rawTransaction);

    ctx.logInfo("Submitting %d transactions as a single block...", transactions.length);

    /* Send all transactions as a single block */
    const blockResult = await ctx.blockSender.sendAsBlock(transactions);
    ctx.logInfo("Block sent at slot %d", blockResult.slot);

    /* Wait for all transactions to be executed and verify they're in the same block */
    ctx.logInfo("Waiting for transactions to execute...");
    let blockSlot: bigint | undefined;

    const txnResults = [
      createTx,
      write1Tx,
      resize2Tx,
      write2aTx,
      write2bTx,
      write2cTx,
      resize3Tx,
      write3Tx,
    ];

    /* Wait for block to be finalized */
    await ctx.accountStateTracker.waitForFinalizedSlot(blockResult.slot, 30000);

    for (let i = 0; i < txnResults.length; i++) {
      const txn = txnResults[i];
      const sig = txn.signature.toThruFmt();

      /* Wait for transaction with retry */
      let status = null;
      for (let attempt = 0; attempt < 30; attempt++) {
        try {
          status = await ctx.sdk.transactions.getStatus(sig);
          if (status) break;
        } catch (err) {
          const errorMsg = (err as Error).message || String(err);
          if (!errorMsg.includes("not_found") && !errorMsg.includes("not found")) {
            throw err; /* Rethrow unexpected errors */
          }
          /* Transaction not found yet, will retry */
        }
        await new Promise((r) => setTimeout(r, 1000));
      }

      if (!status) {
        return {
          ...result,
          success: false,
          message: `${txnNames[i]} tx not found after 30 seconds`,
        };
      }

      if (!status.executionResult) {
        return {
          ...result,
          success: false,
          message: `${txnNames[i]} tx has no execution result`,
        };
      }

      if (status.executionResult.vmError !== 0) {
        return {
          ...result,
          success: false,
          message: `${txnNames[i]} tx failed: vmError=${status.executionResult.vmError}`,
        };
      }

      const txnSlot = status.slot ? BigInt(status.slot) : 0n;
      ctx.logInfo("  %s: executed in slot %d", txnNames[i], txnSlot);

      /* Verify all transactions are in the same block */
      if (i === 0) {
        blockSlot = txnSlot;
      } else if (txnSlot !== blockSlot) {
        return {
          ...result,
          success: false,
          message: `CRITICAL: ${txnNames[i]} tx executed in slot ${txnSlot}, but expected slot ${blockSlot} (same block as first tx)`,
        };
      }
    }

    ctx.logInfo(
      "✓ All %d transactions executed in the same block (slot %d)",
      transactions.length,
      blockSlot
    );
    result.verificationDetails.push(
      `✓ All ${transactions.length} transactions executed in single block (slot ${blockSlot})`
    );

    /* Now query account at different seq numbers and verify data */
    ctx.logInfo("Verifying account states via seq numbers...");

    /* First, get the current state to find the latest seq */
    const currentState = await ctx.sdk.accounts.get(this.ephemeralAddress!);
    if (!currentState) {
      return { ...result, success: false, message: "Current account state not found" };
    }

    const latestSeq = currentState.meta?.seq ?? 0n;
    ctx.logInfo("Latest account seq: %d", latestSeq);

    /* Verify final state (50 bytes with pattern3) */
    const finalSize = Number(currentState.meta?.dataSize ?? 0);
    if (finalSize !== this.SIZE_3) {
      return {
        ...result,
        success: false,
        message: `Final state size mismatch: expected ${this.SIZE_3}, got ${finalSize}`,
      };
    }
    ctx.logInfo("✓ Final state verified: size=%d bytes", this.SIZE_3);

    /* Define states to verify (most recent first, working backwards through seq numbers) */
    const seqsToVerify: Array<{
      description: string;
      expectedSize: number;
      checkData: boolean;
      offset?: number;
      pattern?: Uint8Array;
    }> = [
      {
        description: "after write_50",
        expectedSize: this.SIZE_3,
        checkData: true,
        offset: 0,
        pattern: this.pattern3!,
      },
      {
        description: "after resize_50",
        expectedSize: this.SIZE_3,
        checkData: false,
      },
      {
        description: "after write_2MB_end",
        expectedSize: this.SIZE_2,
        checkData: true,
        offset: this.SIZE_2 - 4096,
        pattern: this.pattern2End!,
      },
      {
        description: "after write_2MB_middle",
        expectedSize: this.SIZE_2,
        checkData: true,
        offset: 1024 * 1024,
        pattern: this.pattern2Middle!,
      },
      {
        description: "after write_2MB_start",
        expectedSize: this.SIZE_2,
        checkData: true,
        offset: 0,
        pattern: this.pattern2Start!,
      },
      {
        description: "after resize_2MB",
        expectedSize: this.SIZE_2,
        checkData: false,
      },
      {
        description: "after write_100",
        expectedSize: this.SIZE_1,
        checkData: true,
        offset: 0,
        pattern: this.pattern1!,
      },
      {
        description: "after create_100",
        expectedSize: this.SIZE_1,
        checkData: false,
      },
    ];

    /* Work backwards from latest seq */
    let seq = latestSeq;
    for (const verify of seqsToVerify) {
      if (seq < 1n) {
        ctx.logInfo("Ran out of seq numbers to verify (expected more states)");
        break;
      }

      ctx.logInfo(
        "Checking seq=%d: %s (expected size=%d)",
        seq,
        verify.description,
        verify.expectedSize
      );

      const resp = await ctx.sdk.accounts.get(this.ephemeralAddress!, {
        versionContext: consensus.seqVersionContext(seq),
      });
      if (!resp) {
        return {
          ...result,
          success: false,
          message: `Account not found at seq=${seq}`,
        };
      }

      const actualSize = Number(resp.meta?.dataSize ?? 0);
      const returnedDataLen = resp.data?.data?.length ?? 0;
      ctx.logInfo(
        "  Meta.DataSize=%d, returned_data_len=%d",
        actualSize,
        returnedDataLen
      );

      /* Check for data length mismatch - this is a bug if returned_data_len != Meta.DataSize */
      if (returnedDataLen > 0 && returnedDataLen !== actualSize) {
        return {
          ...result,
          success: false,
          message: `BUG: returned_data_len (${returnedDataLen}) != Meta.DataSize (${actualSize}) at seq=${seq} (${verify.description})`,
        };
      }

      if (actualSize !== verify.expectedSize) {
        return {
          ...result,
          success: false,
          message: `size mismatch at seq=${seq} (${verify.description}): expected ${verify.expectedSize}, got ${actualSize}`,
        };
      }

      if (
        verify.checkData &&
        resp.data?.data &&
        verify.pattern &&
        verify.offset !== undefined
      ) {
        /* Verify the pattern at the expected offset */
        const endOffset = verify.offset + verify.pattern.length;
        if (endOffset > resp.data.data.length) {
          return {
            ...result,
            success: false,
            message: `pattern extends beyond returned data at seq=${seq}: data_len=${resp.data.data.length}, pattern_end=${endOffset}`,
          };
        }

        const slice = resp.data.data.slice(verify.offset, endOffset);
        if (!arraysEqual(slice, verify.pattern)) {
          /* Find first differing byte for diagnostics */
          let firstDiff = -1;
          for (let i = 0; i < slice.length; i++) {
            if (slice[i] !== verify.pattern[i]) {
              firstDiff = i;
              break;
            }
          }
          ctx.logInfo(
            "  Data content mismatch at offset %d, first difference at byte %d: got 0x%02x, expected 0x%02x",
            verify.offset,
            firstDiff,
            slice[firstDiff],
            verify.pattern[firstDiff]
          );
          return {
            ...result,
            success: false,
            message: `data mismatch at seq=${seq} (${verify.description}), offset=${verify.offset}, first_diff_byte=${firstDiff}`,
          };
        }
        ctx.logInfo(
          "  ✓ Data verified at offset %d (%d bytes)",
          verify.offset,
          verify.pattern.length
        );
      }

      result.verificationDetails.push(
        `✓ seq=${seq} (${verify.description}): size=${actualSize} bytes`
      );

      seq--;
    }

    /* Verify GetRawAccount with seq for all historical states */
    ctx.logInfo("Verifying GetRawAccount with seq for all states...");
    seq = latestSeq;
    for (const verify of seqsToVerify) {
      if (seq < 1n) {
        break;
      }

      const rawResp = await ctx.sdk.accounts.getRaw(this.ephemeralAddress!, {
        versionContext: consensus.seqVersionContext(seq),
      });

      if (!rawResp || !rawResp.rawMeta || rawResp.rawMeta.length === 0) {
        return {
          ...result,
          success: false,
          message: `GetRawAccount seq=${seq} returned empty raw_meta`,
        };
      }

      const rawDataLen = rawResp.rawData?.length ?? 0;
      ctx.logInfo(
        "  GetRawAccount seq=%d: raw_meta=%d bytes, raw_data=%d bytes (expected %d)",
        seq,
        rawResp.rawMeta.length,
        rawDataLen,
        verify.expectedSize
      );

      /* Verify raw data length matches expected size */
      if (rawDataLen !== verify.expectedSize) {
        return {
          ...result,
          success: false,
          message: `GetRawAccount seq=${seq}: raw_data length mismatch: got ${rawDataLen}, expected ${verify.expectedSize}`,
        };
      }

      /* Verify raw data content if checkData is true */
      if (
        verify.checkData &&
        rawResp.rawData &&
        verify.pattern &&
        verify.offset !== undefined
      ) {
        const endOffset = verify.offset + verify.pattern.length;
        if (endOffset <= rawDataLen) {
          const slice = rawResp.rawData.slice(verify.offset, endOffset);
          if (!arraysEqual(slice, verify.pattern)) {
            return {
              ...result,
              success: false,
              message: `GetRawAccount seq=${seq}: raw_data mismatch at offset ${verify.offset}`,
            };
          }
          ctx.logInfo(
            "  ✓ GetRawAccount seq=%d: data verified at offset %d",
            seq,
            verify.offset
          );
        }
      }

      result.verificationDetails.push(
        `✓ GetRawAccount seq=${seq} (${verify.description}): raw_data=${rawDataLen} bytes`
      );

      seq--;
    }

    result.details.push(`Executed ${transactions.length} transactions in one block`);
    result.details.push(`Verified ${seqsToVerify.length} historical states via GetAccount seq`);
    result.details.push(`Verified ${seqsToVerify.length} historical states via GetRawAccount seq`);

    ctx.logInfo("=== Intra-Block Seq Tracking Test Completed ===");
    return result;
  }

  async cleanup(ctx: TestContext): Promise<void> {
    if (this.alice) {
      ctx.releaseGenesisAccounts([this.alice]);
    }
  }
}

/* generatePattern creates a repeating byte pattern of the specified length */
function generatePattern(b: number, length: number): Uint8Array {
  const data = new Uint8Array(length);
  data.fill(b);
  return data;
}

/* arraysEqual compares two Uint8Arrays for equality */
function arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function createIntraBlockSeqTrackingScenario(): IntraBlockSeqTrackingScenario {
  return new IntraBlockSeqTrackingScenario();
}
