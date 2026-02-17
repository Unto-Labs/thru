import { BaseScenario } from "../framework/scenario";
import type { TestContext } from "../framework/context";
import type { TestResult } from "../framework/result";
import type { GenesisAccount } from "../accounts";
import { trackTransactionUntilFinalized, advanceSlots } from "../utils/timing";
import { deriveProgramAddress } from "@thru/thru-sdk";
import { sha256 } from "@noble/hashes/sha256";
import { StateProofType } from "@thru/proto";
import {
  MANAGER_PROGRAM,
  MANAGER_EXPIRY,
  MANAGER_STATE_UNITS,
  MANAGER_MEMORY_UNITS,
  MANAGER_COMPUTE_BASE,
  MANAGER_CREATE_COMPUTE,
  MANAGER_STATE_OPEN,
  MANAGER_STATE_PAUSED,
  MANAGER_STATE_FINALIZED,
  managerSortAccounts,
  buildManagerCreateEphemeralInstruction,
  buildManagerCreatePermanentInstruction,
  buildManagerSetPauseInstruction,
  buildManagerDestroyInstruction,
  buildManagerFinalizeInstruction,
  buildManagerSetAuthorityInstruction,
  buildManagerClaimAuthorityInstruction,
  buildManagerUpgradeInstruction,
  computeUnitsForUpgrade,
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
  computeUnitsForCreate as uploaderComputeUnitsForCreate,
  computeUnitsForFinalize as uploaderComputeUnitsForFinalize,
} from "../programs";

// Embedded program binaries (noop and counter programs)
const NOOP_PROGRAM_HEX =
  "0100000000000000370f00011b0f0f04034f0f007d1f63160f04aa823703000283530300fd13194eb383c303a1031e9383532300b203154e221e854ee20e336ede01330e7e40856e3305de41728181487300000019e5011106ec22e81685ef00c000ad488545730000004111014506e4ef0040004111814506e4ef004000ad487300000000000000";

const COUNTER_PROGRAM_HEX =
  "0100000000000000370f00011b0f0f04034f0f007d1f63160f04aa823703000283530300fd13194eb383c303a1031e9383532300b203154e221e854ee20e336ede01330e7e40856e3305de41728181487300000019e5011106ec22e826e48d4763feb7001c4191cf05476386e70005650505ef00c0229947638af5060565ef00002293079002e3fbb7fe83467502034665020347850283479502a206d18e4207558fe207d98f1387a702be868127e397e5fc034455000347450001462204598c99c31306a502930565002285ef00e01e69e52285ef00e01d0de9a1452285ef00e02361c505651105ef00601b8344550083474500a204dd8c2685ef0080192a844dc12685ef00e01a09c505650d05ef00001903471400834604008347240083453400034644002207558fc20783465400d98fe20503476400dd8d0216834774004d8ea216d18e4217558fe217d98f85071bd5870193d5070293d8870013d8070113d6870293d6070313d78703a301a4002302b4002300f400a300140123010401a302c4002303d400a303e4002285a145ef00a0190145ef00201105650905ef00001005651505ef00800f2285ef00600e6dd923000500a300050023010500a301050023020500a302050023030500a30305000145ef00400d1308f6ff55ca9d471387150063fc0709b367b5009d8b13871500c9e7b307e54093b77700c1e3937886ffb3861501aa879861a105a10723bce7fee39bb6feb3071841330715016309160703c606002300c700bdc383c516000546a300b700638dc70483c5260009462301b7006386c70483c536000d46a301b700638fc70283c5460011462302b7006388c70283c556001546a302b7006381c70283c766002303f70082802a96aa878346f7ff85070507a38fd7fee39ac7fe828062051315852a1315952a82804111854506e4ef0000084111814506e4ef00600789487300000082805d714af84ef43289aa8921460a8586e4a2e026fc2e84b684eff07ff09305840028002146eff0bfef9305040108082146eff0ffee9305840128082146eff03fee82652266c26662674e85ca872688914873000000a6600664e2744279a279616182809d48730000008280ad4873000000b54873000000828000000000";

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

/**
 * ManagerProgramScenario tests the key instructions of tn_manager_program:
 * CREATE_EPHEMERAL, SET_PAUSE, SET_AUTHORITY, CLAIM_AUTHORITY, UPGRADE, DESTROY,
 * CREATE_PERMANENT, and FINALIZE
 */
export class ManagerProgramScenario extends BaseScenario {
  name = "Manager Program";
  description =
    "Tests manager program instructions: CREATE, PAUSE, AUTHORITY, UPGRADE, DESTROY, FINALIZE";

  private alice: GenesisAccount | null = null;
  private bob: GenesisAccount | null = null;
  private charlie: GenesisAccount | null = null;

  // Ephemeral program accounts
  private ephemeralSeed: Uint8Array | null = null;
  private ephemeralMetaAccount: Uint8Array | null = null;
  private ephemeralMetaAddress: string | null = null;
  private ephemeralProgramAccount: Uint8Array | null = null;
  private ephemeralProgramAddress: string | null = null;

  // Permanent program accounts
  private permanentSeed: Uint8Array | null = null;
  private permanentMetaAccount: Uint8Array | null = null;
  private permanentMetaAddress: string | null = null;
  private permanentProgramAccount: Uint8Array | null = null;
  private permanentProgramAddress: string | null = null;

  // Source buffers
  private srcbufSeed: Uint8Array | null = null;
  private srcbufMetaAccount: Uint8Array | null = null;
  private srcbufAccount: Uint8Array | null = null;
  private srcbufAddress: string | null = null;
  private programBinary: Uint8Array | null = null;
  private programBinaryHash: Uint8Array | null = null;

  private srcbuf2Seed: Uint8Array | null = null;
  private srcbuf2MetaAccount: Uint8Array | null = null;
  private srcbuf2Account: Uint8Array | null = null;
  private srcbuf2Address: string | null = null;
  private programBinary2: Uint8Array | null = null;
  private programBinary2Hash: Uint8Array | null = null;

  // Local nonce tracking to avoid indexer latency issues
  private aliceNonce: bigint = 0n;
  private bobNonce: bigint = 0n;

  async setup(ctx: TestContext): Promise<void> {
    // Acquire genesis accounts
    const accounts = ctx.getGenesisAccounts(3);
    this.alice = accounts[0];
    this.bob = accounts[1];
    this.charlie = accounts[2];

    ctx.logInfo("Using alice: %s", this.alice.publicKeyString);
    ctx.logInfo("Using bob: %s", this.bob.publicKeyString);
    ctx.logInfo("Using charlie: %s", this.charlie.publicKeyString);

    // Subscribe to accounts for nonce tracking
    await ctx.accountStateTracker.subscribeAccount(this.alice.publicKeyString);
    await ctx.accountStateTracker.subscribeAccount(this.bob.publicKeyString);
    await ctx.accountStateTracker.subscribeAccount(this.charlie.publicKeyString);

    // Generate seeds
    this.ephemeralSeed = new Uint8Array(32);
    crypto.getRandomValues(this.ephemeralSeed);

    this.permanentSeed = new Uint8Array(32);
    crypto.getRandomValues(this.permanentSeed);

    this.srcbufSeed = new Uint8Array(32);
    crypto.getRandomValues(this.srcbufSeed);

    this.srcbuf2Seed = new Uint8Array(32);
    crypto.getRandomValues(this.srcbuf2Seed);

    // Load program binaries
    this.programBinary = hexToBytes(NOOP_PROGRAM_HEX);
    this.programBinaryHash = sha256(this.programBinary);
    ctx.logInfo("Loaded noop program binary (%d bytes)", this.programBinary.length);

    this.programBinary2 = hexToBytes(COUNTER_PROGRAM_HEX);
    this.programBinary2Hash = sha256(this.programBinary2);
    ctx.logInfo("Loaded counter program binary (%d bytes)", this.programBinary2.length);

    // Derive ephemeral meta and program accounts
    const ephMetaDerived = deriveProgramAddress({
      programAddress: MANAGER_PROGRAM,
      seed: this.ephemeralSeed,
      ephemeral: true,
    });
    this.ephemeralMetaAccount = ephMetaDerived.bytes;
    this.ephemeralMetaAddress = ephMetaDerived.address;

    const ephProgramDerived = deriveProgramAddress({
      programAddress: MANAGER_PROGRAM,
      seed: this.ephemeralMetaAccount,
      ephemeral: true,
    });
    this.ephemeralProgramAccount = ephProgramDerived.bytes;
    this.ephemeralProgramAddress = ephProgramDerived.address;

    ctx.logInfo("Ephemeral meta account: %s", this.ephemeralMetaAddress);
    ctx.logInfo("Ephemeral program account: %s", this.ephemeralProgramAddress);

    // Derive permanent meta and program accounts
    const permMetaDerived = deriveProgramAddress({
      programAddress: MANAGER_PROGRAM,
      seed: this.permanentSeed,
      ephemeral: false,
    });
    this.permanentMetaAccount = permMetaDerived.bytes;
    this.permanentMetaAddress = permMetaDerived.address;

    const permProgramDerived = deriveProgramAddress({
      programAddress: MANAGER_PROGRAM,
      seed: this.permanentMetaAccount,
      ephemeral: false,
    });
    this.permanentProgramAccount = permProgramDerived.bytes;
    this.permanentProgramAddress = permProgramDerived.address;

    ctx.logInfo("Permanent meta account: %s", this.permanentMetaAddress);
    ctx.logInfo("Permanent program account: %s", this.permanentProgramAddress);

    // Derive srcbuf accounts (using uploader program)
    const srcbufMetaDerived = deriveProgramAddress({
      programAddress: UPLOADER_PROGRAM,
      seed: this.srcbufSeed,
      ephemeral: true,
    });
    this.srcbufMetaAccount = srcbufMetaDerived.bytes;

    const srcbufDerived = deriveProgramAddress({
      programAddress: UPLOADER_PROGRAM,
      seed: this.srcbufMetaAccount,
      ephemeral: true,
    });
    this.srcbufAccount = srcbufDerived.bytes;
    this.srcbufAddress = srcbufDerived.address;
    ctx.logInfo("Srcbuf account: %s", this.srcbufAddress);

    // Derive srcbuf2 accounts for upgrade
    const srcbuf2MetaDerived = deriveProgramAddress({
      programAddress: UPLOADER_PROGRAM,
      seed: this.srcbuf2Seed,
      ephemeral: true,
    });
    this.srcbuf2MetaAccount = srcbuf2MetaDerived.bytes;

    const srcbuf2Derived = deriveProgramAddress({
      programAddress: UPLOADER_PROGRAM,
      seed: this.srcbuf2MetaAccount,
      ephemeral: true,
    });
    this.srcbuf2Account = srcbuf2Derived.bytes;
    this.srcbuf2Address = srcbuf2Derived.address;
    ctx.logInfo("Srcbuf2 account: %s", this.srcbuf2Address);
  }

  async execute(ctx: TestContext): Promise<TestResult> {
    const result: TestResult = {
      success: true,
      message: "Manager program test passed",
      details: [],
      verificationDetails: [],
      executionTimeMs: 0,
    };

    ctx.logInfo("=== Manager Program Test Starting ===");

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
        this.charlie!,
        numSlots,
        ctx.config.chainId,
        ctx.logInfo.bind(ctx)
      );
      result.details.push(`Advanced ${numSlots} slots`);
    }

    // Initialize nonces (fetch once, then track locally to avoid indexer latency)
    const aliceAcct = await ctx.sdk.accounts.get(this.alice!.publicKeyString);
    const bobAcct = await ctx.sdk.accounts.get(this.bob!.publicKeyString);
    this.aliceNonce = aliceAcct?.meta?.nonce ?? 0n;
    this.bobNonce = bobAcct?.meta?.nonce ?? 0n;

    // Phase 2: Create srcbuf with program binary using uploader program
    ctx.logInfo("Phase 2: Creating srcbuf with program binary");
    const srcbufResult = await this.createSrcbuf(
      ctx,
      result,
      this.srcbufSeed!,
      this.srcbufMetaAccount!,
      this.srcbufAccount!,
      this.programBinary!,
      this.programBinaryHash!
    );
    if (!srcbufResult.success) return srcbufResult;

    // Phase 3: CREATE_EPHEMERAL - Create ephemeral program
    ctx.logInfo("Phase 3: CREATE_EPHEMERAL - Creating ephemeral program");
    const createEphResult = await this.executeCreateEphemeral(ctx, result);
    if (!createEphResult.success) return createEphResult;

    // Phase 4: SET_PAUSE (pause)
    ctx.logInfo("Phase 4: SET_PAUSE - Pausing program");
    const pauseResult = await this.executeSetPause(ctx, result, true, this.alice!);
    if (!pauseResult.success) return pauseResult;

    // Phase 5: SET_PAUSE (unpause)
    ctx.logInfo("Phase 5: SET_PAUSE - Unpausing program");
    const unpauseResult = await this.executeSetPause(ctx, result, false, this.alice!);
    if (!unpauseResult.success) return unpauseResult;

    // Phase 6: SET_AUTHORITY - Propose bob as new authority
    ctx.logInfo("Phase 6: SET_AUTHORITY - Proposing bob as new authority");
    const setAuthResult = await this.executeSetAuthority(ctx, result);
    if (!setAuthResult.success) return setAuthResult;

    // Phase 7: CLAIM_AUTHORITY - Bob claims authority
    ctx.logInfo("Phase 7: CLAIM_AUTHORITY - Bob claiming authority");
    const claimAuthResult = await this.executeClaimAuthority(ctx, result);
    if (!claimAuthResult.success) return claimAuthResult;

    // Phase 8: Create srcbuf2 with new program binary for upgrade
    ctx.logInfo("Phase 8: Creating srcbuf2 with new program binary for upgrade");
    const srcbuf2Result = await this.createSrcbuf(
      ctx,
      result,
      this.srcbuf2Seed!,
      this.srcbuf2MetaAccount!,
      this.srcbuf2Account!,
      this.programBinary2!,
      this.programBinary2Hash!
    );
    if (!srcbuf2Result.success) return srcbuf2Result;

    // Phase 9: UPGRADE - Bob upgrades program code
    ctx.logInfo("Phase 9: UPGRADE - Bob upgrading program code");
    const upgradeResult = await this.executeUpgrade(ctx, result);
    if (!upgradeResult.success) return upgradeResult;

    // Phase 10: DESTROY (ephemeral) - Bob destroys ephemeral program
    ctx.logInfo("Phase 10: DESTROY - Bob destroying ephemeral program");
    const destroyResult = await this.executeDestroy(ctx, result);
    if (!destroyResult.success) return destroyResult;

    // Phase 11: CREATE_PERMANENT - Create permanent program with state proofs
    ctx.logInfo("Phase 11: CREATE_PERMANENT - Creating permanent program");
    const createPermResult = await this.executeCreatePermanent(ctx, result);
    if (!createPermResult.success) return createPermResult;

    // Phase 12: FINALIZE - Lock permanent program
    ctx.logInfo("Phase 12: FINALIZE - Locking permanent program");
    const finalizeResult = await this.executeFinalize(ctx, result);
    if (!finalizeResult.success) return finalizeResult;

    result.message = "Successfully tested all 8 manager program instructions";
    ctx.logInfo("=== Manager Program Test Completed ===");
    return result;
  }

  private async createSrcbuf(
    ctx: TestContext,
    result: TestResult,
    seed: Uint8Array,
    metaAccount: Uint8Array,
    bufferAccount: Uint8Array,
    data: Uint8Array,
    hash: Uint8Array
  ): Promise<TestResult> {
    const { metaIdx, bufferIdx, orderedAccounts } = getOrderedAccountIndices(
      metaAccount,
      bufferAccount
    );

    // CREATE
    let height = await ctx.sdk.blocks.getBlockHeight();
    let startSlot = height.finalized;

    const createInstruction = buildUploaderCreateInstruction(
      bufferIdx,
      metaIdx,
      0, // authority_idx
      data.length,
      hash,
      seed
    );

    let tx = await ctx.sdk.transactions.buildAndSign({
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
        computeUnits: uploaderComputeUnitsForCreate(data.length),
        stateUnits: UPLOADER_STATE_UNITS,
        memoryUnits: UPLOADER_MEMORY_UNITS,
        chainId: ctx.config.chainId,
      },
      accounts: { readWrite: orderedAccounts },
      instructionData: createInstruction,
    });

    const trackPromise = trackTransactionUntilFinalized(ctx.sdk, tx.signature.toThruFmt());
    await ctx.blockSender.sendAsBlock([tx.rawTransaction]);
    let status = (await trackPromise) as any;
    if (!status || status.executionResult?.vmError !== 0) {
      return {
        ...result,
        success: false,
        message: `Srcbuf CREATE failed: vmError=${status?.executionResult?.vmError}`,
      };
    }
    this.aliceNonce++;

    // WRITE
    height = await ctx.sdk.blocks.getBlockHeight();
    startSlot = height.finalized;

    const writeInstruction = buildUploaderWriteInstruction(bufferIdx, metaIdx, 0, data);

    tx = await ctx.sdk.transactions.buildAndSign({
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
      accounts: { readWrite: orderedAccounts },
      instructionData: writeInstruction,
    });

    const trackPromise2 = trackTransactionUntilFinalized(ctx.sdk, tx.signature.toThruFmt());
    await ctx.blockSender.sendAsBlock([tx.rawTransaction]);
    status = (await trackPromise2) as any;
    if (!status || status.executionResult?.vmError !== 0) {
      return {
        ...result,
        success: false,
        message: `Srcbuf WRITE failed: vmError=${status?.executionResult?.vmError}`,
      };
    }
    this.aliceNonce++;

    // FINALIZE (using uploader finalize)
    height = await ctx.sdk.blocks.getBlockHeight();
    startSlot = height.finalized;

    const { buildUploaderFinalizeInstruction } = await import("../programs/uploader");
    const finalizeInstruction = buildUploaderFinalizeInstruction(bufferIdx, metaIdx, hash);

    tx = await ctx.sdk.transactions.buildAndSign({
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
        computeUnits: uploaderComputeUnitsForFinalize(data.length),
        stateUnits: UPLOADER_STATE_UNITS,
        memoryUnits: UPLOADER_MEMORY_UNITS,
        chainId: ctx.config.chainId,
      },
      accounts: { readWrite: orderedAccounts },
      instructionData: finalizeInstruction,
    });

    const trackPromise3 = trackTransactionUntilFinalized(ctx.sdk, tx.signature.toThruFmt());
    await ctx.blockSender.sendAsBlock([tx.rawTransaction]);
    status = (await trackPromise3) as any;
    if (!status || status.executionResult?.vmError !== 0) {
      return {
        ...result,
        success: false,
        message: `Srcbuf FINALIZE failed: vmError=${status?.executionResult?.vmError}`,
      };
    }
    this.aliceNonce++;

    result.verificationDetails.push("✓ Srcbuf created with program binary");
    return result;
  }

  private async executeCreateEphemeral(
    ctx: TestContext,
    result: TestResult
  ): Promise<TestResult> {
    const height = await ctx.sdk.blocks.getBlockHeight();
    const startSlot = height.finalized;

    const { metaIdx, programIdx, srcbufIdx, rwAccounts, roAccounts } = managerSortAccounts(
      this.ephemeralMetaAccount!,
      this.ephemeralProgramAccount!,
      this.srcbufAccount!
    );

    const instruction = buildManagerCreateEphemeralInstruction(
      metaIdx,
      programIdx,
      srcbufIdx,
      0, // srcbuf offset
      this.programBinary!.length,
      0, // authority is fee payer
      this.ephemeralSeed!
    );

    const tx = await ctx.sdk.transactions.buildAndSign({
      feePayer: {
        publicKey: this.alice!.publicKey,
        privateKey: this.alice!.seed,
      },
      program: MANAGER_PROGRAM,
      header: {
        fee: 1n,
        nonce: this.aliceNonce,
        startSlot: startSlot,
        expiryAfter: MANAGER_EXPIRY,
        computeUnits: MANAGER_CREATE_COMPUTE,
        stateUnits: MANAGER_STATE_UNITS,
        memoryUnits: MANAGER_MEMORY_UNITS,
        chainId: ctx.config.chainId,
      },
      accounts: { readWrite: rwAccounts, readOnly: roAccounts },
      instructionData: instruction,
    });

    const trackPromise = trackTransactionUntilFinalized(ctx.sdk, tx.signature.toThruFmt());
    await ctx.blockSender.sendAsBlock([tx.rawTransaction]);
    const status = (await trackPromise) as any;
    if (!status || status.executionResult?.vmError !== 0) {
      return {
        ...result,
        success: false,
        message: `CREATE_EPHEMERAL failed: vmError=${status?.executionResult?.vmError}`,
      };
    }
    this.aliceNonce++;

    // Verify accounts exist with polling (indexer latency)
    // Note: sdk.accounts.get throws "not_found" error for non-existent accounts
    const startTime = Date.now();
    const pollTimeout = 30000;
    const pollInterval = 200;

    while (Date.now() - startTime < pollTimeout) {
      try {
        const metaAcct = await ctx.sdk.accounts.get(this.ephemeralMetaAddress!);
        const programAcct = await ctx.sdk.accounts.get(this.ephemeralProgramAddress!);
        if (metaAcct && programAcct) {
          break;
        }
      } catch (err) {
        // Ignore not_found errors during polling
        const msg = (err as Error).message || "";
        if (!msg.includes("not_found") && !msg.includes("not found")) {
          throw err;
        }
      }
      await new Promise((r) => setTimeout(r, pollInterval));
    }

    // Final verification
    let metaAcct, programAcct;
    try {
      metaAcct = await ctx.sdk.accounts.get(this.ephemeralMetaAddress!);
    } catch (err) {
      const msg = (err as Error).message || "";
      if (!msg.includes("not_found") && !msg.includes("not found")) throw err;
    }
    if (!metaAcct) {
      return {
        ...result,
        success: false,
        message: "Meta account not found after CREATE_EPHEMERAL",
      };
    }

    try {
      programAcct = await ctx.sdk.accounts.get(this.ephemeralProgramAddress!);
    } catch (err) {
      const msg = (err as Error).message || "";
      if (!msg.includes("not_found") && !msg.includes("not found")) throw err;
    }
    if (!programAcct) {
      return {
        ...result,
        success: false,
        message: "Program account not found after CREATE_EPHEMERAL",
      };
    }

    result.verificationDetails.push("✓ CREATE_EPHEMERAL: Ephemeral program created");
    return result;
  }

  private async executeSetPause(
    ctx: TestContext,
    result: TestResult,
    isPaused: boolean,
    authority: GenesisAccount
  ): Promise<TestResult> {
    const height = await ctx.sdk.blocks.getBlockHeight();
    const startSlot = height.finalized;

    // Use local nonce tracking based on authority
    const isAlice = authority.publicKeyString === this.alice!.publicKeyString;
    const nonce = isAlice ? this.aliceNonce : this.bobNonce;

    const { metaIdx, programIdx, rwAccounts } = managerSortAccounts(
      this.ephemeralMetaAccount!,
      this.ephemeralProgramAccount!,
      null
    );

    const instruction = buildManagerSetPauseInstruction(metaIdx, programIdx, isPaused);

    const tx = await ctx.sdk.transactions.buildAndSign({
      feePayer: {
        publicKey: authority.publicKey,
        privateKey: authority.seed,
      },
      program: MANAGER_PROGRAM,
      header: {
        fee: 1n,
        nonce: nonce,
        startSlot: startSlot,
        expiryAfter: MANAGER_EXPIRY,
        computeUnits: MANAGER_COMPUTE_BASE,
        stateUnits: MANAGER_STATE_UNITS,
        memoryUnits: MANAGER_MEMORY_UNITS,
        chainId: ctx.config.chainId,
      },
      accounts: { readWrite: rwAccounts },
      instructionData: instruction,
    });

    const trackPromise = trackTransactionUntilFinalized(ctx.sdk, tx.signature.toThruFmt());
    await ctx.blockSender.sendAsBlock([tx.rawTransaction]);
    const status = (await trackPromise) as any;
    if (!status || status.executionResult?.vmError !== 0) {
      return {
        ...result,
        success: false,
        message: `SET_PAUSE failed: vmError=${status?.executionResult?.vmError}`,
      };
    }

    // Increment local nonce
    if (isAlice) {
      this.aliceNonce++;
    } else {
      this.bobNonce++;
    }

    result.verificationDetails.push(
      `✓ SET_PAUSE: Program ${isPaused ? "paused" : "unpaused"}`
    );
    return result;
  }

  private async executeSetAuthority(
    ctx: TestContext,
    result: TestResult
  ): Promise<TestResult> {
    const height = await ctx.sdk.blocks.getBlockHeight();
    const startSlot = height.finalized;

    const { metaIdx, programIdx, rwAccounts } = managerSortAccounts(
      this.ephemeralMetaAccount!,
      this.ephemeralProgramAccount!,
      null
    );

    const instruction = buildManagerSetAuthorityInstruction(
      metaIdx,
      programIdx,
      this.bob!.publicKey
    );

    const tx = await ctx.sdk.transactions.buildAndSign({
      feePayer: {
        publicKey: this.alice!.publicKey,
        privateKey: this.alice!.seed,
      },
      program: MANAGER_PROGRAM,
      header: {
        fee: 1n,
        nonce: this.aliceNonce,
        startSlot: startSlot,
        expiryAfter: MANAGER_EXPIRY,
        computeUnits: MANAGER_COMPUTE_BASE,
        stateUnits: MANAGER_STATE_UNITS,
        memoryUnits: MANAGER_MEMORY_UNITS,
        chainId: ctx.config.chainId,
      },
      accounts: { readWrite: rwAccounts },
      instructionData: instruction,
    });

    const trackPromise = trackTransactionUntilFinalized(ctx.sdk, tx.signature.toThruFmt());
    await ctx.blockSender.sendAsBlock([tx.rawTransaction]);
    const status = (await trackPromise) as any;
    if (!status || status.executionResult?.vmError !== 0) {
      return {
        ...result,
        success: false,
        message: `SET_AUTHORITY failed: vmError=${status?.executionResult?.vmError}`,
      };
    }
    this.aliceNonce++;

    result.verificationDetails.push("✓ SET_AUTHORITY: Bob proposed as new authority");
    return result;
  }

  private async executeClaimAuthority(
    ctx: TestContext,
    result: TestResult
  ): Promise<TestResult> {
    const height = await ctx.sdk.blocks.getBlockHeight();
    const startSlot = height.finalized;

    const { metaIdx, programIdx, rwAccounts } = managerSortAccounts(
      this.ephemeralMetaAccount!,
      this.ephemeralProgramAccount!,
      null
    );

    const instruction = buildManagerClaimAuthorityInstruction(metaIdx, programIdx);

    const tx = await ctx.sdk.transactions.buildAndSign({
      feePayer: {
        publicKey: this.bob!.publicKey,
        privateKey: this.bob!.seed,
      },
      program: MANAGER_PROGRAM,
      header: {
        fee: 1n,
        nonce: this.bobNonce,
        startSlot: startSlot,
        expiryAfter: MANAGER_EXPIRY,
        computeUnits: MANAGER_COMPUTE_BASE,
        stateUnits: MANAGER_STATE_UNITS,
        memoryUnits: MANAGER_MEMORY_UNITS,
        chainId: ctx.config.chainId,
      },
      accounts: { readWrite: rwAccounts },
      instructionData: instruction,
    });

    const trackPromise = trackTransactionUntilFinalized(ctx.sdk, tx.signature.toThruFmt());
    await ctx.blockSender.sendAsBlock([tx.rawTransaction]);
    const status = (await trackPromise) as any;
    if (!status || status.executionResult?.vmError !== 0) {
      return {
        ...result,
        success: false,
        message: `CLAIM_AUTHORITY failed: vmError=${status?.executionResult?.vmError}`,
      };
    }
    this.bobNonce++;

    result.verificationDetails.push("✓ CLAIM_AUTHORITY: Bob is now the authority");
    return result;
  }

  private async executeUpgrade(
    ctx: TestContext,
    result: TestResult
  ): Promise<TestResult> {
    const height = await ctx.sdk.blocks.getBlockHeight();
    const startSlot = height.finalized;

    const { metaIdx, programIdx, srcbufIdx, rwAccounts, roAccounts } = managerSortAccounts(
      this.ephemeralMetaAccount!,
      this.ephemeralProgramAccount!,
      this.srcbuf2Account!
    );

    const instruction = buildManagerUpgradeInstruction(
      metaIdx,
      programIdx,
      srcbufIdx,
      0, // srcbuf offset
      this.programBinary2!.length
    );

    const tx = await ctx.sdk.transactions.buildAndSign({
      feePayer: {
        publicKey: this.bob!.publicKey,
        privateKey: this.bob!.seed,
      },
      program: MANAGER_PROGRAM,
      header: {
        fee: 1n,
        nonce: this.bobNonce,
        startSlot: startSlot,
        expiryAfter: MANAGER_EXPIRY,
        computeUnits: computeUnitsForUpgrade(this.programBinary2!.length),
        stateUnits: MANAGER_STATE_UNITS,
        memoryUnits: MANAGER_MEMORY_UNITS,
        chainId: ctx.config.chainId,
      },
      accounts: { readWrite: rwAccounts, readOnly: roAccounts },
      instructionData: instruction,
    });

    const trackPromise = trackTransactionUntilFinalized(ctx.sdk, tx.signature.toThruFmt());
    await ctx.blockSender.sendAsBlock([tx.rawTransaction]);
    const status = (await trackPromise) as any;
    if (!status || status.executionResult?.vmError !== 0) {
      return {
        ...result,
        success: false,
        message: `UPGRADE failed: vmError=${status?.executionResult?.vmError}`,
      };
    }
    this.bobNonce++;

    result.verificationDetails.push("✓ UPGRADE: Program code upgraded");
    return result;
  }

  private async executeDestroy(
    ctx: TestContext,
    result: TestResult
  ): Promise<TestResult> {
    const height = await ctx.sdk.blocks.getBlockHeight();
    const startSlot = height.finalized;

    const { metaIdx, programIdx, rwAccounts } = managerSortAccounts(
      this.ephemeralMetaAccount!,
      this.ephemeralProgramAccount!,
      null
    );

    const instruction = buildManagerDestroyInstruction(metaIdx, programIdx);

    const tx = await ctx.sdk.transactions.buildAndSign({
      feePayer: {
        publicKey: this.bob!.publicKey,
        privateKey: this.bob!.seed,
      },
      program: MANAGER_PROGRAM,
      header: {
        fee: 1n,
        nonce: this.bobNonce,
        startSlot: startSlot,
        expiryAfter: MANAGER_EXPIRY,
        computeUnits: MANAGER_COMPUTE_BASE,
        stateUnits: MANAGER_STATE_UNITS,
        memoryUnits: MANAGER_MEMORY_UNITS,
        chainId: ctx.config.chainId,
      },
      accounts: { readWrite: rwAccounts },
      instructionData: instruction,
    });

    const trackPromise = trackTransactionUntilFinalized(ctx.sdk, tx.signature.toThruFmt());
    await ctx.blockSender.sendAsBlock([tx.rawTransaction]);
    const status = (await trackPromise) as any;
    if (!status || status.executionResult?.vmError !== 0) {
      return {
        ...result,
        success: false,
        message: `DESTROY failed: vmError=${status?.executionResult?.vmError}`,
      };
    }
    this.bobNonce++;

    // Verify accounts are NOT FOUND with polling (indexer latency)
    // Note: sdk.accounts.get throws "not_found" error for non-existent accounts
    const startTime = Date.now();
    const pollTimeout = 30000;
    const pollInterval = 200;

    while (Date.now() - startTime < pollTimeout) {
      try {
        const metaAcct = await ctx.sdk.accounts.get(this.ephemeralMetaAddress!);
        const programAcct = await ctx.sdk.accounts.get(this.ephemeralProgramAddress!);
        if (!metaAcct && !programAcct) {
          break;
        }
      } catch (err) {
        // "not_found" error means account doesn't exist - that's what we want
        const msg = (err as Error).message || "";
        if (!msg.includes("not_found") && !msg.includes("not found")) {
          throw err;
        }
        break;
      }
      await new Promise((r) => setTimeout(r, pollInterval));
    }

    // Final verification - accounts should not exist
    let metaExists = false;
    let programExists = false;
    try {
      const metaAcct = await ctx.sdk.accounts.get(this.ephemeralMetaAddress!);
      if (metaAcct) metaExists = true;
    } catch (err) {
      const msg = (err as Error).message || "";
      if (!msg.includes("not_found") && !msg.includes("not found")) throw err;
    }

    try {
      const programAcct = await ctx.sdk.accounts.get(this.ephemeralProgramAddress!);
      if (programAcct) programExists = true;
    } catch (err) {
      const msg = (err as Error).message || "";
      if (!msg.includes("not_found") && !msg.includes("not found")) throw err;
    }

    if (metaExists) {
      return {
        ...result,
        success: false,
        message: "Ephemeral meta account still exists after DESTROY",
      };
    }

    if (programExists) {
      return {
        ...result,
        success: false,
        message: "Ephemeral program account still exists after DESTROY",
      };
    }

    result.verificationDetails.push("✓ DESTROY: Ephemeral program destroyed");
    result.verificationDetails.push("✓ Ephemeral meta account NOT FOUND");
    result.verificationDetails.push("✓ Ephemeral program account NOT FOUND");
    return result;
  }

  private async executeCreatePermanent(
    ctx: TestContext,
    result: TestResult
  ): Promise<TestResult> {
    // Generate state proofs for both accounts
    const metaProof = await ctx.sdk.proofs.generate({
      address: this.permanentMetaAccount!,
      proofType: StateProofType.CREATING,
    });
    const programProof = await ctx.sdk.proofs.generate({
      address: this.permanentProgramAccount!,
      proofType: StateProofType.CREATING,
    });

    const height = await ctx.sdk.blocks.getBlockHeight();
    const startSlot = height.finalized;

    const { metaIdx, programIdx, srcbufIdx, rwAccounts, roAccounts } = managerSortAccounts(
      this.permanentMetaAccount!,
      this.permanentProgramAccount!,
      this.srcbufAccount!
    );

    const instruction = buildManagerCreatePermanentInstruction(
      metaIdx,
      programIdx,
      srcbufIdx,
      0, // srcbuf offset
      this.programBinary!.length,
      0, // authority is fee payer
      this.permanentSeed!,
      metaProof.proof,
      programProof.proof
    );

    const tx = await ctx.sdk.transactions.buildAndSign({
      feePayer: {
        publicKey: this.alice!.publicKey,
        privateKey: this.alice!.seed,
      },
      program: MANAGER_PROGRAM,
      header: {
        fee: 1n,
        nonce: this.aliceNonce,
        startSlot: startSlot,
        expiryAfter: MANAGER_EXPIRY,
        computeUnits: MANAGER_CREATE_COMPUTE,
        stateUnits: MANAGER_STATE_UNITS,
        memoryUnits: MANAGER_MEMORY_UNITS,
        chainId: ctx.config.chainId,
      },
      accounts: { readWrite: rwAccounts, readOnly: roAccounts },
      instructionData: instruction,
    });

    const trackPromise = trackTransactionUntilFinalized(ctx.sdk, tx.signature.toThruFmt());
    await ctx.blockSender.sendAsBlock([tx.rawTransaction]);
    const status = (await trackPromise) as any;
    if (!status || status.executionResult?.vmError !== 0) {
      return {
        ...result,
        success: false,
        message: `CREATE_PERMANENT failed: vmError=${status?.executionResult?.vmError}`,
      };
    }
    this.aliceNonce++;

    // Verify accounts exist with polling (indexer latency)
    // Note: sdk.accounts.get throws "not_found" error for non-existent accounts
    const startTime = Date.now();
    const pollTimeout = 30000;
    const pollInterval = 200;

    while (Date.now() - startTime < pollTimeout) {
      try {
        const metaAcct = await ctx.sdk.accounts.get(this.permanentMetaAddress!);
        const programAcct = await ctx.sdk.accounts.get(this.permanentProgramAddress!);
        if (metaAcct && programAcct) {
          break;
        }
      } catch (err) {
        // Ignore not_found errors during polling
        const msg = (err as Error).message || "";
        if (!msg.includes("not_found") && !msg.includes("not found")) {
          throw err;
        }
      }
      await new Promise((r) => setTimeout(r, pollInterval));
    }

    // Final verification
    let metaAcct, programAcct;
    try {
      metaAcct = await ctx.sdk.accounts.get(this.permanentMetaAddress!);
    } catch (err) {
      const msg = (err as Error).message || "";
      if (!msg.includes("not_found") && !msg.includes("not found")) throw err;
    }
    if (!metaAcct) {
      return {
        ...result,
        success: false,
        message: "Permanent meta account not found after CREATE_PERMANENT",
      };
    }

    try {
      programAcct = await ctx.sdk.accounts.get(this.permanentProgramAddress!);
    } catch (err) {
      const msg = (err as Error).message || "";
      if (!msg.includes("not_found") && !msg.includes("not found")) throw err;
    }
    if (!programAcct) {
      return {
        ...result,
        success: false,
        message: "Permanent program account not found after CREATE_PERMANENT",
      };
    }

    result.verificationDetails.push("✓ CREATE_PERMANENT: Permanent program created");
    return result;
  }

  private async executeFinalize(
    ctx: TestContext,
    result: TestResult
  ): Promise<TestResult> {
    const height = await ctx.sdk.blocks.getBlockHeight();
    const startSlot = height.finalized;

    const { metaIdx, programIdx, rwAccounts } = managerSortAccounts(
      this.permanentMetaAccount!,
      this.permanentProgramAccount!,
      null
    );

    const instruction = buildManagerFinalizeInstruction(metaIdx, programIdx);

    const tx = await ctx.sdk.transactions.buildAndSign({
      feePayer: {
        publicKey: this.alice!.publicKey,
        privateKey: this.alice!.seed,
      },
      program: MANAGER_PROGRAM,
      header: {
        fee: 1n,
        nonce: this.aliceNonce,
        startSlot: startSlot,
        expiryAfter: MANAGER_EXPIRY,
        computeUnits: MANAGER_COMPUTE_BASE,
        stateUnits: MANAGER_STATE_UNITS,
        memoryUnits: MANAGER_MEMORY_UNITS,
        chainId: ctx.config.chainId,
      },
      accounts: { readWrite: rwAccounts },
      instructionData: instruction,
    });

    const trackPromise = trackTransactionUntilFinalized(ctx.sdk, tx.signature.toThruFmt());
    await ctx.blockSender.sendAsBlock([tx.rawTransaction]);
    const status = (await trackPromise) as any;
    if (!status || status.executionResult?.vmError !== 0) {
      return {
        ...result,
        success: false,
        message: `FINALIZE failed: vmError=${status?.executionResult?.vmError}`,
      };
    }
    this.aliceNonce++;

    result.verificationDetails.push("✓ FINALIZE: Permanent program locked");
    result.verificationDetails.push(
      "✓ Finalized permanent program persists (cannot be destroyed by design)"
    );
    return result;
  }

  async cleanup(ctx: TestContext): Promise<void> {
    if (this.alice && this.bob && this.charlie) {
      ctx.releaseGenesisAccounts([this.alice, this.bob, this.charlie]);
    }
  }
}

export function createManagerProgramScenario(): ManagerProgramScenario {
  return new ManagerProgramScenario();
}
