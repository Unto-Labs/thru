import { BaseScenario } from "../framework/scenario";
import type { TestContext } from "../framework/context";
import type { TestResult } from "../framework/result";
import type { GenesisAccount } from "../accounts";
import { deriveProgramAddress, consensus } from "@thru/thru-sdk";
import { StateProofType } from "@thru/proto";
import { sha256 } from "@noble/hashes/sha256";
import {
  TEST_UPLOADER_PROGRAM,
  SYSTEM_PROGRAM,
  buildTestUploaderCreateInstruction,
  buildTestUploaderWriteInstruction,
  buildCompressInstruction,
  buildDecompress2Instruction,
  getDecompressAccountIndices,
} from "../programs";

/* Constants */
const ACCOUNT_META_FOOTPRINT = 64;
const TEST_UPLOADER_CHUNK_SIZE = 31 * 1024; /* 31 KiB chunks */
const DUMB_FILL_COUNT = 256;
const MAX_ACCOUNT_DATA_SIZE = 16 * 1024 * 1024; /* 16MB max */

/* Compute unit constants */
const COMPRESS_COMPUTE_CU = 0x80000000; /* High compute for compression */
const COMPRESS_STATE_UNITS = 10_000;
const COMPRESS_MEMORY_UNITS = 10_000;
const COMPRESS_EXPIRY = 10_000;

const DEFAULT_EXPIRY = 100;
const DEFAULT_STATE_UNITS = 10_000;
const DEFAULT_MEMORY_UNITS = 10_000;

/**
 * HugeAccountCreator manages the creation and tracking of large test accounts
 */
class HugeAccountCreator {
  label: string;
  targetSize: number;

  /* Target account */
  seed: Uint8Array;
  account: Uint8Array;
  accountAddress: string;

  /* Test data */
  testData: Uint8Array;
  expectedHash: Uint8Array;

  /* Uploader helper accounts (ephemeral) */
  metaSeed: Uint8Array;
  metaAccount: Uint8Array;
  metaAddress: string;
  bufferSeed: Uint8Array;
  bufferAccount: Uint8Array;
  bufferAddress: string;

  constructor(label: string, size: number) {
    this.label = label;
    this.targetSize = size;

    /* Generate seeds */
    this.seed = new Uint8Array(16);
    crypto.getRandomValues(this.seed);

    this.metaSeed = new Uint8Array(16);
    crypto.getRandomValues(this.metaSeed);

    this.bufferSeed = new Uint8Array(16);
    crypto.getRandomValues(this.bufferSeed);

    /* Derive target account (permanent) */
    const targetDerived = deriveProgramAddress({
      programAddress: TEST_UPLOADER_PROGRAM,
      seed: this.seed,
      ephemeral: false,
    });
    this.account = targetDerived.bytes;
    this.accountAddress = targetDerived.address;

    /* Derive meta account (ephemeral) */
    const metaDerived = deriveProgramAddress({
      programAddress: TEST_UPLOADER_PROGRAM,
      seed: this.metaSeed,
      ephemeral: true,
    });
    this.metaAccount = metaDerived.bytes;
    this.metaAddress = metaDerived.address;

    /* Derive buffer account (ephemeral) */
    const bufferDerived = deriveProgramAddress({
      programAddress: TEST_UPLOADER_PROGRAM,
      seed: this.bufferSeed,
      ephemeral: true,
    });
    this.bufferAccount = bufferDerived.bytes;
    this.bufferAddress = bufferDerived.address;

    /* Generate test data in chunks (crypto.getRandomValues has 65536 byte limit) */
    this.testData = new Uint8Array(size);
    const chunkSize = 65536;
    for (let offset = 0; offset < size; offset += chunkSize) {
      const end = Math.min(offset + chunkSize, size);
      crypto.getRandomValues(this.testData.subarray(offset, end));
    }
    this.expectedHash = sha256(this.testData);
  }
}

/**
 * DecompressHugeScenario tests compression and decompression of a large account
 */
export class DecompressHugeScenario extends BaseScenario {
  private size: number;
  private alice: GenesisAccount | null = null;
  private bob: GenesisAccount | null = null;
  private dom: GenesisAccount | null = null;
  private creator: HugeAccountCreator | null = null;

  constructor(size: number = 1 * 1024 * 1024) {
    super();
    this.size = size;
  }

  get name(): string {
    const label = `${Math.floor(this.size / (1024 * 1024))}MB`;
    return `Huge Account Compression/Decompression (${label})`;
  }

  get description(): string {
    const label = `${Math.floor(this.size / (1024 * 1024))}MB`;
    return `Tests ${label} account compression, decompression cycle, and data integrity verification`;
  }

  async setup(ctx: TestContext): Promise<void> {
    /* Acquire genesis accounts */
    const accounts = ctx.getGenesisAccounts(3);
    this.alice = accounts[0];
    this.bob = accounts[1];
    this.dom = accounts[2];

    ctx.logInfo("Using alice: %s", this.alice.publicKeyString);
    ctx.logInfo("Using bob: %s", this.bob.publicKeyString);
    ctx.logInfo("Using dom: %s", this.dom.publicKeyString);

    /* Initialize HugeAccountCreator */
    const label = `${Math.floor(this.size / (1024 * 1024))}MB`;
    this.creator = new HugeAccountCreator(label, this.size);

    ctx.logInfo("Target account: %s", this.creator.accountAddress);
    ctx.logInfo("Meta account: %s", this.creator.metaAddress);
    ctx.logInfo("Buffer account: %s", this.creator.bufferAddress);

    /* Subscribe to accounts for nonce tracking */
    await ctx.accountStateTracker.subscribeAccount(this.alice.publicKeyString);
    await ctx.accountStateTracker.subscribeAccount(this.bob.publicKeyString);
    await ctx.accountStateTracker.subscribeAccount(this.dom.publicKeyString);
    await ctx.accountStateTracker.subscribeAccount(ctx.genesisAccount.publicKeyString);
  }

  async execute(ctx: TestContext): Promise<TestResult> {
    const result: TestResult = {
      success: true,
      message: "Huge account compression/decompression test passed",
      details: [],
      verificationDetails: [],
      executionTimeMs: 0,
    };

    const creator = this.creator!;

    /* Phase 1: Ensure we're past slot 256 for compression to work */
    ctx.logInfo("Phase 1: Checking current slot");
    const height = await ctx.sdk.blocks.getBlockHeight();
    let currentSlot = height.finalized;

    if (currentSlot < 256n) {
      const slotsNeeded = Number(256n - currentSlot);
      ctx.logInfo("Need to advance %d slots to reach slot 256", slotsNeeded);
      await this.executeDumbFill(ctx, slotsNeeded);
      result.details.push(`Advanced ${slotsNeeded} slots to reach slot 256`);
    }

    /* Phase 2: Create uploader buffer and meta accounts */
    ctx.logInfo("Phase 2: Creating uploader accounts");
    await this.createUploaderAccounts(ctx);
    result.details.push("Created buffer and meta ephemeral accounts");

    /* Phase 3: Create and fill target account */
    ctx.logInfo("Phase 3: Creating and filling %s account", creator.label);
    await this.createAndFillAccount(ctx);
    result.verificationDetails.push(`✓ Created ${creator.label} account with test data`);

    /* Phase 4: Verify data via GetAccount */
    ctx.logInfo("Phase 4: Verifying account data via GetAccount");
    await this.verifyAccountData(ctx);
    result.verificationDetails.push(`✓ Verified ${creator.label} account data via GetAccount`);

    /* Phase 4b: Verify data via GetRawAccount */
    ctx.logInfo("Phase 4b: Verifying account data via GetRawAccount");
    await this.verifyAccountDataRaw(ctx);
    result.verificationDetails.push(`✓ Verified ${creator.label} account data via GetRawAccount`);

    /* Phase 5: Compress account */
    ctx.logInfo("Phase 5: Compressing %s account", creator.label);
    await this.compressAccount(ctx);
    result.verificationDetails.push(`✓ Compressed ${creator.label} account successfully`);

    /* Phase 6: Execute dumb fill to advance slots */
    ctx.logInfo("Phase 6: Executing dumb fill (%d blocks)", DUMB_FILL_COUNT);
    await this.executeDumbFill(ctx, DUMB_FILL_COUNT);
    result.details.push(`Executed ${DUMB_FILL_COUNT} dumb fill blocks`);

    /* Phase 7: Decompress account */
    ctx.logInfo("Phase 7: Decompressing %s account", creator.label);
    await this.decompressAccount(ctx);
    result.verificationDetails.push(`✓ Decompressed ${creator.label} account successfully`);

    /* Phase 8: Verify data integrity after decompression */
    ctx.logInfo("Phase 8: Verifying data integrity after decompression");
    await this.verifyAccountData(ctx);
    result.verificationDetails.push(`✓ Verified ${creator.label} data integrity after decompression`);

    result.message = "Successfully tested huge account compression/decompression cycle";
    return result;
  }

  async cleanup(ctx: TestContext): Promise<void> {
    if (this.alice && this.bob && this.dom) {
      ctx.releaseGenesisAccounts([this.alice, this.bob, this.dom]);
    }
  }

  /**
   * Execute dumb fill transactions to advance slots
   */
  private async executeDumbFill(ctx: TestContext, count: number): Promise<void> {
    const bob = this.bob!;
    const dom = this.dom!;

    /* Get starting slot for finality tracking */
    const startHeight = await ctx.sdk.blocks.getBlockHeight();
    const startingSlot = startHeight.finalized;

    /* Get current nonce */
    const bobAcct = await ctx.sdk.accounts.get(bob.publicKeyString);
    let bobNonce = bobAcct?.meta?.nonce ?? 0n;

    for (let i = 0; i < count; i++) {
      const height = await ctx.sdk.blocks.getBlockHeight();
      const startSlot = height.finalized + 1n;

      /* Build transfer transaction from bob to dom */
      const tx = await ctx.sdk.transactions.buildAndSign({
        feePayer: {
          publicKey: bob.publicKey,
          privateKey: bob.seed,
        },
        program: new Uint8Array(32), /* EOA program (all zeros) */
        header: {
          fee: 1n,
          nonce: bobNonce,
          startSlot,
          expiryAfter: 1_000_000,
          computeUnits: 1_000_000,
          stateUnits: 10_000,
          memoryUnits: 10_000,
          chainId: ctx.config.chainId,
        },
        accounts: {
          readWrite: [dom.publicKey],
        },
        instructionData: buildTransferInstruction(1n, 0, 2),
      });

      /* Send as single-transaction block */
      await ctx.blockSender.sendAsBlock([tx.rawTransaction]);
      bobNonce++;

      if ((i + 1) % 32 === 0) {
        ctx.logInfo("Submitted %d/%d dumb fill blocks", i + 1, count);
      }
    }

    /* Wait for finality - target slot is startingSlot + count */
    const targetSlot = startingSlot + BigInt(count);
    await this.waitForFinalizedSlot(ctx, targetSlot, 60_000);
  }

  /**
   * Wait for a specific slot to be finalized
   */
  private async waitForFinalizedSlot(
    ctx: TestContext,
    targetSlot: bigint,
    timeoutMs: number
  ): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const height = await ctx.sdk.blocks.getBlockHeight();
      if (height.finalized >= targetSlot) {
        ctx.logInfo("Reached finalized slot %d (target: %d)", height.finalized, targetSlot);
        return;
      }
      await new Promise((r) => setTimeout(r, 500));
    }

    throw new Error(`Timeout waiting for finalized slot ${targetSlot}`);
  }

  /**
   * Create buffer and meta ephemeral accounts
   */
  private async createUploaderAccounts(ctx: TestContext): Promise<void> {
    const creator = this.creator!;
    const bufferSize = Math.min(creator.targetSize + ACCOUNT_META_FOOTPRINT, 16 * 1024 * 1024);

    /* Create buffer account */
    await this.createUploaderAccount(ctx, creator.bufferAccount, creator.bufferSeed, bufferSize, true);
    ctx.logInfo("Created buffer account %s with size %d", creator.bufferAddress, bufferSize);

    /* Create meta account */
    await this.createUploaderAccount(ctx, creator.metaAccount, creator.metaSeed, ACCOUNT_META_FOOTPRINT, true);
    ctx.logInfo("Created meta account %s with size %d", creator.metaAddress, ACCOUNT_META_FOOTPRINT);
  }

  /**
   * Create a single uploader account
   */
  private async createUploaderAccount(
    ctx: TestContext,
    account: Uint8Array,
    seed: Uint8Array,
    size: number,
    isEphemeral: boolean
  ): Promise<void> {
    const height = await ctx.sdk.blocks.getBlockHeight();
    const startSlot = height.finalized + 1n;

    /* Get joe's nonce */
    const joeAcct = await ctx.sdk.accounts.get(ctx.genesisAccount.publicKeyString);
    const nonce = joeAcct?.meta?.nonce ?? 0n;

    /* Build create instruction */
    const createInstruction = buildTestUploaderCreateInstruction(
      2, /* target account at index 2 */
      size,
      seed,
      isEphemeral,
      new Uint8Array(0) /* no state proof for ephemeral */
    );

    const computeUnits = 100_000 + size;

    const tx = await ctx.sdk.transactions.buildAndSign({
      feePayer: {
        publicKey: ctx.genesisAccount.publicKey,
        privateKey: ctx.genesisAccount.seed,
      },
      program: TEST_UPLOADER_PROGRAM,
      header: {
        fee: 1n,
        nonce,
        startSlot,
        expiryAfter: DEFAULT_EXPIRY,
        computeUnits,
        stateUnits: DEFAULT_STATE_UNITS,
        memoryUnits: DEFAULT_MEMORY_UNITS,
        chainId: ctx.config.chainId,
      },
      accounts: {
        readWrite: [account],
      },
      instructionData: createInstruction,
    });

    /* Send and wait for confirmation */
    await ctx.blockSender.sendAsBlock([tx.rawTransaction]);

    /* Wait for account to exist */
    await this.waitForAccountExists(ctx, account);
  }

  /**
   * Create target account and upload test data
   */
  private async createAndFillAccount(ctx: TestContext): Promise<void> {
    const creator = this.creator!;

    /* Generate state proof for permanent account creation */
    ctx.logInfo("Generating state proof for account creation");
    const stateProof = await ctx.sdk.proofs.generate({
      address: creator.accountAddress,
      proofType: StateProofType.CREATING,
    });

    const height = await ctx.sdk.blocks.getBlockHeight();
    const startSlot = height.finalized + 1n;

    /* Get joe's nonce */
    const joeAcct = await ctx.sdk.accounts.get(ctx.genesisAccount.publicKeyString);
    const nonce = joeAcct?.meta?.nonce ?? 0n;

    /* Build create instruction with state proof */
    const createInstruction = buildTestUploaderCreateInstruction(
      2, /* target account at index 2 */
      creator.targetSize,
      creator.seed,
      false, /* permanent */
      stateProof.proof
    );

    const computeUnits = 100_000 + creator.targetSize;

    const tx = await ctx.sdk.transactions.buildAndSign({
      feePayer: {
        publicKey: ctx.genesisAccount.publicKey,
        privateKey: ctx.genesisAccount.seed,
      },
      program: TEST_UPLOADER_PROGRAM,
      header: {
        fee: 1n,
        nonce,
        startSlot,
        expiryAfter: DEFAULT_EXPIRY,
        computeUnits,
        stateUnits: DEFAULT_STATE_UNITS,
        memoryUnits: DEFAULT_MEMORY_UNITS,
        chainId: ctx.config.chainId,
      },
      accounts: {
        readWrite: [creator.account],
      },
      instructionData: createInstruction,
    });

    /* Send and wait */
    await ctx.blockSender.sendAsBlock([tx.rawTransaction]);
    await this.waitForAccountExists(ctx, creator.account);

    /* Upload test data */
    ctx.logInfo("Uploading %d bytes of test data", creator.testData.length);
    await this.uploadData(ctx, creator.account, creator.testData);
  }

  /**
   * Upload data to an account in chunks
   */
  private async uploadData(ctx: TestContext, target: Uint8Array, data: Uint8Array): Promise<void> {
    let offset = 0;
    let chunkNum = 0;
    const totalChunks = Math.ceil(data.length / TEST_UPLOADER_CHUNK_SIZE);

    /* Get initial nonce */
    const joeAcctInitial = await ctx.sdk.accounts.get(ctx.genesisAccount.publicKeyString);
    let nonce = joeAcctInitial?.meta?.nonce ?? 0n;

    /* Get initial slot */
    const heightInitial = await ctx.sdk.blocks.getBlockHeight();
    let startSlot = heightInitial.finalized + 1n;

    /* Build all transactions first */
    const transactions: Uint8Array[] = [];

    while (offset < data.length) {
      const end = Math.min(offset + TEST_UPLOADER_CHUNK_SIZE, data.length);
      const chunk = data.slice(offset, end);

      const writeInstruction = buildTestUploaderWriteInstruction(2, offset, chunk);

      const tx = await ctx.sdk.transactions.buildAndSign({
        feePayer: {
          publicKey: ctx.genesisAccount.publicKey,
          privateKey: ctx.genesisAccount.seed,
        },
        program: TEST_UPLOADER_PROGRAM,
        header: {
          fee: 1n,
          nonce,
          startSlot,
          expiryAfter: 10_000, /* Long expiry for bulk upload */
          computeUnits: 500_000_000, /* High compute for large writes */
          stateUnits: DEFAULT_STATE_UNITS,
          memoryUnits: DEFAULT_MEMORY_UNITS,
          chainId: ctx.config.chainId,
        },
        accounts: {
          readWrite: [target],
        },
        instructionData: writeInstruction,
      });

      transactions.push(tx.rawTransaction);
      nonce++;
      chunkNum++;
      offset = end;
    }

    ctx.logInfo("Built %d transactions for upload", transactions.length);

    /* Send all transactions as a single block */
    const blockResult = await ctx.blockSender.sendAsBlock(transactions);
    ctx.logInfo("Uploaded all %d chunks in block slot %d", totalChunks, blockResult.slot);

    /* Wait for block to be finalized */
    await ctx.accountStateTracker.waitForFinalizedSlot(blockResult.slot, 60000);

    /* Small delay for state to settle after finalization */
    await new Promise((r) => setTimeout(r, 500));
  }

  /**
   * Verify account data matches expected
   */
  private async verifyAccountData(ctx: TestContext): Promise<void> {
    const creator = this.creator!;

    /* Retry loop for data verification (data may take time to sync) */
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        /* Get account data */
        const acct = await ctx.sdk.accounts.get(creator.accountAddress);
        if (!acct) {
          ctx.logInfo("Account not found, retrying...");
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }

        const dataSize = Number(acct.meta?.dataSize ?? 0);
        if (dataSize !== creator.targetSize) {
          ctx.logInfo("Data size mismatch: expected %d, got %d, retrying...", creator.targetSize, dataSize);
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }

        if (acct.data?.data) {
          if (acct.data.data.length !== creator.targetSize) {
            ctx.logInfo("Returned data length mismatch: expected %d, got %d, retrying...",
              creator.targetSize, acct.data.data.length);
            await new Promise((r) => setTimeout(r, 1000));
            continue;
          }

          const hash = sha256(acct.data.data);
          if (!arraysEqual(hash, creator.expectedHash)) {
            /* Find first differing byte for debugging */
            let firstDiff = -1;
            for (let i = 0; i < Math.min(acct.data.data.length, creator.testData.length); i++) {
              if (acct.data.data[i] !== creator.testData[i]) {
                firstDiff = i;
                break;
              }
            }
            if (attempt === 0) {
              ctx.logInfo("Data hash mismatch. First diff at byte %d. Actual[0:32]: %s, Expected[0:32]: %s",
                firstDiff,
                Buffer.from(acct.data.data.slice(0, 32)).toString("hex"),
                Buffer.from(creator.testData.slice(0, 32)).toString("hex"));
            }
            ctx.logInfo("Data hash mismatch, retrying... (attempt %d)", attempt + 1);
            await new Promise((r) => setTimeout(r, 1000));
            continue;
          }
        } else {
          ctx.logInfo("No data returned, retrying...");
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }

        ctx.logInfo("Account data verified: %d bytes", dataSize);
        return;
      } catch (err) {
        ctx.logInfo("Verification error: %s, retrying...", (err as Error).message);
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    throw new Error("Data verification failed after 30 attempts");
  }

  /**
   * Verify account data via GetRawAccount (tests different code path)
   */
  private async verifyAccountDataRaw(ctx: TestContext): Promise<void> {
    const creator = this.creator!;

    const rawAcct = await ctx.sdk.accounts.getRaw(creator.accountAddress);
    if (!rawAcct) {
      throw new Error("GetRawAccount returned null");
    }

    if (!rawAcct.rawMeta || rawAcct.rawMeta.length === 0) {
      throw new Error("GetRawAccount raw_meta is empty");
    }

    if (!rawAcct.rawData) {
      throw new Error("GetRawAccount raw_data is empty");
    }

    if (rawAcct.rawData.length !== creator.testData.length) {
      throw new Error(
        `GetRawAccount data size mismatch: expected ${creator.testData.length}, got ${rawAcct.rawData.length}`
      );
    }

    if (!arraysEqual(rawAcct.rawData, creator.testData)) {
      /* Find first differing byte for debugging */
      let firstDiff = -1;
      for (let i = 0; i < rawAcct.rawData.length; i++) {
        if (rawAcct.rawData[i] !== creator.testData[i]) {
          firstDiff = i;
          break;
        }
      }
      throw new Error(
        `GetRawAccount data content mismatch at byte ${firstDiff}`
      );
    }

    ctx.logInfo("GetRawAccount data verified: %d bytes", rawAcct.rawData.length);
  }

  /**
   * Compress the target account
   */
  private async compressAccount(ctx: TestContext): Promise<void> {
    const creator = this.creator!;
    const alice = this.alice!;

    /* Generate state proof for compression */
    const stateProof = await ctx.sdk.proofs.generate({
      address: creator.accountAddress,
      proofType: StateProofType.CREATING,
    });

    const height = await ctx.sdk.blocks.getBlockHeight();
    const startSlot = height.finalized + 1n;

    /* Get alice's nonce */
    const aliceAcct = await ctx.sdk.accounts.get(alice.publicKeyString);
    const nonce = aliceAcct?.meta?.nonce ?? 0n;

    /* Build compress instruction */
    const compressInstruction = buildCompressInstruction(2, stateProof.proof);

    /* mayCompressAccount flag = 1 << 1 = 2 */
    const MAY_COMPRESS_ACCOUNT_FLAG = 2;

    const tx = await ctx.sdk.transactions.buildAndSign({
      feePayer: {
        publicKey: alice.publicKey,
        privateKey: alice.seed,
      },
      program: SYSTEM_PROGRAM,
      header: {
        fee: 1n,
        nonce,
        startSlot,
        expiryAfter: COMPRESS_EXPIRY,
        computeUnits: COMPRESS_COMPUTE_CU,
        stateUnits: COMPRESS_STATE_UNITS,
        memoryUnits: COMPRESS_MEMORY_UNITS,
        chainId: ctx.config.chainId,
        flags: MAY_COMPRESS_ACCOUNT_FLAG,
      },
      accounts: {
        readWrite: [creator.account],
      },
      instructionData: compressInstruction,
    });

    /* Send and wait */
    await ctx.blockSender.sendAsBlock([tx.rawTransaction]);

    /* Wait for transaction to complete */
    const sig = tx.signature.toThruFmt();
    for (let attempt = 0; attempt < 60; attempt++) {
      try {
        const status = await ctx.sdk.transactions.getStatus(sig);
        if (status && status.executionResult) {
          if (status.executionResult.vmError !== 0) {
            throw new Error(`Compress failed: vmError=${status.executionResult.vmError}`);
          }
          ctx.logInfo("Compression transaction confirmed");
          return;
        }
      } catch (err) {
        const errorMsg = (err as Error).message || String(err);
        if (!errorMsg.includes("not_found")) {
          throw err;
        }
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error("Compression transaction timeout");
  }

  /**
   * Decompress the target account
   */
  private async decompressAccount(ctx: TestContext): Promise<void> {
    const creator = this.creator!;
    const alice = this.alice!;

    /* Fetch compressed account data */
    ctx.logInfo("Fetching compressed account data");
    const rawAcct = await ctx.sdk.accounts.getRaw(creator.accountAddress, {
      versionContext: consensus.currentOrHistoricalVersionContext(),
    });

    if (!rawAcct || !rawAcct.rawMeta || rawAcct.rawMeta.length === 0) {
      throw new Error("Failed to fetch compressed account data");
    }

    const rawMeta = rawAcct.rawMeta;
    const rawData = rawAcct.rawData || new Uint8Array(0);

    ctx.logInfo("Compressed data: meta=%d bytes, data=%d bytes", rawMeta.length, rawData.length);

    /* Verify data integrity before decompression */
    if (rawData.length !== creator.testData.length) {
      throw new Error(`Compressed data size mismatch: expected ${creator.testData.length}, got ${rawData.length}`);
    }

    if (!arraysEqual(rawData, creator.testData)) {
      throw new Error("Compressed data content mismatch");
    }

    /* For 1MB or smaller: single buffer with meta included */
    let metaAccountPtr: Uint8Array;
    let bufferAccountPtr: Uint8Array;
    let metaOffset: number;
    let totalDataLen: number;

    if (this.size <= 1 * 1024 * 1024) {
      /* Single buffer strategy */
      metaAccountPtr = creator.bufferAccount;
      bufferAccountPtr = creator.bufferAccount;
      metaOffset = ACCOUNT_META_FOOTPRINT;
      totalDataLen = rawMeta.length + rawData.length;

      /* Upload combined meta + data to buffer */
      const combined = new Uint8Array(rawMeta.length + rawData.length);
      combined.set(rawMeta, 0);
      combined.set(rawData, rawMeta.length);
      await this.uploadData(ctx, creator.bufferAccount, combined);
    } else {
      /* Separate meta and data buffers */
      metaAccountPtr = creator.metaAccount;
      bufferAccountPtr = creator.bufferAccount;
      metaOffset = 0;
      totalDataLen = rawData.length;

      /* Upload meta to meta account */
      await this.uploadData(ctx, creator.metaAccount, rawMeta);

      /* Upload data to buffer account */
      await this.uploadData(ctx, creator.bufferAccount, rawData);
    }

    /* Generate state proof for decompression */
    const stateProof = await ctx.sdk.proofs.generate({
      address: creator.accountAddress,
      proofType: StateProofType.EXISTING,
    });

    const height = await ctx.sdk.blocks.getBlockHeight();
    const startSlot = height.finalized + 1n;

    /* Get alice's nonce */
    const aliceAcct = await ctx.sdk.accounts.get(alice.publicKeyString);
    const nonce = aliceAcct?.meta?.nonce ?? 0n;

    /* Get account indices for decompress */
    const { metaIdx, dataIdx, orderedAccounts } = getDecompressAccountIndices(
      metaAccountPtr,
      bufferAccountPtr
    );

    /* Build decompress instruction */
    const decompressInstruction = buildDecompress2Instruction(
      2, /* target at index 2 */
      metaIdx,
      dataIdx,
      metaOffset,
      stateProof.proof
    );

    /* Calculate compute and state units */
    const computeUnits = 10_000 + 2 * totalDataLen;
    const stateUnits = Math.max(Math.min(Math.ceil(totalDataLen / 4096), 65535), 10);

    const tx = await ctx.sdk.transactions.buildAndSign({
      feePayer: {
        publicKey: alice.publicKey,
        privateKey: alice.seed,
      },
      program: SYSTEM_PROGRAM,
      header: {
        fee: 1n,
        nonce,
        startSlot,
        expiryAfter: 10_000,
        computeUnits,
        stateUnits,
        memoryUnits: DEFAULT_MEMORY_UNITS,
        chainId: ctx.config.chainId,
      },
      accounts: {
        readWrite: [creator.account],
        readOnly: orderedAccounts,
      },
      instructionData: decompressInstruction,
    });

    /* Send and wait */
    await ctx.blockSender.sendAsBlock([tx.rawTransaction]);

    /* Wait for transaction to complete */
    const sig = tx.signature.toThruFmt();
    for (let attempt = 0; attempt < 60; attempt++) {
      try {
        const status = await ctx.sdk.transactions.getStatus(sig);
        if (status && status.executionResult) {
          if (status.executionResult.vmError !== 0) {
            throw new Error(`Decompress failed: vmError=${status.executionResult.vmError}`);
          }
          ctx.logInfo("Decompression transaction confirmed");
          return;
        }
      } catch (err) {
        const errorMsg = (err as Error).message || String(err);
        if (!errorMsg.includes("not_found")) {
          throw err;
        }
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error("Decompression transaction timeout");
  }

  /**
   * Wait for an account to exist
   */
  private async waitForAccountExists(ctx: TestContext, pubkey: Uint8Array): Promise<void> {
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        const acct = await ctx.sdk.accounts.getRaw(pubkey);
        if (acct && acct.rawMeta && acct.rawMeta.length > 0) {
          return;
        }
      } catch {
        /* Account not found, keep trying */
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error("Timeout waiting for account to exist");
  }
}

/**
 * Build EOA transfer instruction
 */
function buildTransferInstruction(amount: bigint, fromIdx: number, toIdx: number): Uint8Array {
  const data = new Uint8Array(4 + 8 + 2 + 2);
  const view = new DataView(data.buffer);

  view.setUint32(0, 1, true); /* discriminant = TN_EOA_INSTRUCTION_TRANSFER */
  view.setBigUint64(4, amount, true);
  view.setUint16(12, fromIdx, true);
  view.setUint16(14, toIdx, true);

  return data;
}

function arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Create a 1MB decompress huge scenario (default)
 */
export function createDecompressHugeScenario(): DecompressHugeScenario {
  return new DecompressHugeScenario(1 * 1024 * 1024);
}

/**
 * Create a 16MB decompress huge scenario
 */
export function createDecompressHuge16MBScenario(): DecompressHugeScenario {
  return new DecompressHugeScenario(16 * 1024 * 1024);
}

/**
 * Create a decompress huge scenario with custom size
 */
export function createDecompressHugeScenarioWithSize(size: number): DecompressHugeScenario {
  return new DecompressHugeScenario(size);
}
