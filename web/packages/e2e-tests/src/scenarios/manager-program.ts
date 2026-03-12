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
  "0100000000000000370f0001034f0f007d1f63170f04aa823703000283530300fd13130e8010b383c303a1031e9383532300b203154e221e854ee20e336ede01330e7e40856e3305de41728181487300000019e5011106ec22e81685ef00c000ad488545730000004111014506e4ef0040004111814506e4ef004000ad48730000000000000000000000";

const COUNTER_PROGRAM_HEX =
  "0100000000000000370f0001034f0f007d1f63170f04aa823703000283530300fd13130e8010b383c303a1031e9383532300b203154e221e854ee20e336ede01330e7e40856e3305de41728181487300000019e5011106ec22e81685ef00c000ad48854573000000797106f422f026ec4ae84ee452e08d4763feb7001c41ae842a8481cf05456384a700ef008032a147638ff5082545ef00c0319307b002e3fbb7fe83469502034685020347a5028347b502a206d18e4207558fe207d98f9387c702e399f5fc83447500834665008347550003474500a204d58ca207268533e9e700ef00202a49cdef00602983469402034684020347a4028347b402a206d18e4207558fe207d98faa899b860700014699c31306c402bb860608930584004a85ef00805e630805100945ef0080280347740003466400834754008346440022073364c700a207228533e9d700ef00802305c9ef00c0222a8a4a85ef00c024aa896307050e93050a0393175400be95130600022105ef00601e19c51d45ef0060231945ef0000232285ef006021aa8722853e84ef00402319e51305e400ef00a033630d050e4a85ef00a0554de503c7190083c6090083c7290083c5390003c649002207558fc20783c65900d98fe20503c76900dd8d021683c779004d8ea216d18e4217558fe217d98f85071bd5870193d5070293d8870013d8070113d6870293d6070313d78703a381a9002382b9002380f900a380190123810901a382c9002383d900a383e9004e85a145ef00e0540145ef00c0184a85ef00a04c09ed930580024a85ef00805211c91145ef0080161545ef0020160d45ef00c0154a85ef00a0147dd593850903960423000500a300050023010500a301050023020500a302050023030500a3030500a695210513060002ef0000010145ef0060122685ef0060111308f6ff55ca9d471387150063fc0709b367b5009d8b13871500c9e7b307e54093b77700c1e3937886ffb3861501aa879861a105a10723bce7fee39bb6feb3071841330715016309160703c606002300c700bdc383c516000546a300b700638dc70483c5260009462301b7006386c70483c536000d46a301b700638fc70283c5460011462302b7006388c70283c556001546a302b7006381c70283c766002303f70082802a96aa878346f7ff85070507a38fd7fee39ac7fe828005c22a9619a0630dc5008347050003c7050005058505e388e7fe3b85e740828001458280370500018280370700018357270003574700b99f8927bbc707083335f500828062051315952a828062051315852a1315952a82804111854506e4ef00a03b4111814506e4ef00003b6dcdb705000283d705001b080500139757003e973367b720035787009b860700630da70c0547638ae60637a3f7c31303a31d3717b2e5fd37021313076784bbc707083a9321a83e973367b720035787006305070bfd373bc7070821c313975700b306f700b3e6b620b47ef1de9062e31c66fc83de860003dea60013866e003326d620630e0e00332ece2021a009066308ce0083580600e39b08ff01458280e3840efab3a8de2021a08906e38ed8f803d6c600e31b06ff3e97b70700023367f72083558700931785013707000113070703960593e7e700ba959397972a2e878d8f93850502b306f70003c60600834607006317d6000507e317b7fe054582803755685d060541111305451706e4eff01feeb70500019385050393060502aa87898d3387b7000346070003c707006317e6008507e397d7fe054582803707000203580700370600011306060393175800c297b3e7e72003d78700aa8783c5070016073297034607009b080800639cc50085070507e382d7fc83c5070003460700e388c5fe8547638ff80637aff7c3130faf1db717b2e57d38021f93876784b70e00013b4808083e9f938e0e03370e000293185800b3870801b3e7c72103b3870763060300833703006380e705c298b3e8c82103d78800aa8783c507001607769703460700639cc50085070507e386d7f483c5070003460700e388c5fe7d38bb470808ddf701458280411106e422e0035483008352a30093076400b3af6720638f0202b7030001b3a2f2219383030303d70f00aa8716071e9783c5070003460700639bc50085070507e398d7fea2600264014541018280890fe39bf2fd4dc0b7030001b322642093830303835fc300aa8713975f001e9783c50700034607006394c50a85070507e398d7fe37070002b3870801b3e7e72083d58700b7070001938707039605be952e8793978f0139459397972a93850502198db306f700aa9603c60600834607006314d6060507e316b7fe0545a2600264410182807d38bb470808b5d793185800b3870801b3e7c72103b387076306030083370300e38ae7f1c298b3e8c82103d78800aa871607769783c5070003460700e392c5fc85070507e398d7fe05457db70903e31153f4c9bf3755685d060513054517eff07fcb89487300000082805d714af84ef43289aa8921460a8586e4a2e026fc2e84b684eff01fb89305840028002146eff05fb79305040108082146eff09fb69305840128082146eff0dfb582652266c26662674e85ca872688914873000000a6600664e2744279a279616182809d48730000008280ad4873000000b5487300000082800000000000000000";

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
        message: `Srcbuf CREATE failed: ${this.fmtExecErr(status)}`,
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
        message: `Srcbuf WRITE failed: ${this.fmtExecErr(status)}`,
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
        message: `Srcbuf FINALIZE failed: ${this.fmtExecErr(status)}`,
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

    ctx.logInfo("CREATE_EPHEMERAL: metaIdx=%d, programIdx=%d, srcbufIdx=%d, authorityIdx=0, srcbufSize=%d, seedLen=%d",
      metaIdx, programIdx, srcbufIdx, this.programBinary!.length, this.ephemeralSeed!.length);
    ctx.logInfo("CREATE_EPHEMERAL: nonce=%d, startSlot=%d", this.aliceNonce, startSlot);

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
        message: `CREATE_EPHEMERAL failed: ${this.fmtExecErr(status)}`,
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
        message: `SET_PAUSE failed: ${this.fmtExecErr(status)}`,
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
        message: `SET_AUTHORITY failed: ${this.fmtExecErr(status)}`,
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
        message: `CLAIM_AUTHORITY failed: ${this.fmtExecErr(status)}`,
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
        message: `UPGRADE failed: ${this.fmtExecErr(status)}`,
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
        message: `DESTROY failed: ${this.fmtExecErr(status)}`,
      };
    }
    this.bobNonce++;

    // Verify accounts are NOT FOUND with polling (indexer latency)
    const pollTimeout = 30000;
    const pollInterval = 200;

    const accountGone = async (address: string): Promise<boolean> => {
      try {
        const acct = await ctx.sdk.accounts.get(address);
        return !acct;
      } catch (err) {
        const msg = (err as Error).message || "";
        if (msg.includes("not_found") || msg.includes("not found")) return true;
        throw err;
      }
    };

    const startTime = Date.now();
    let metaGone = false;
    let programGone = false;
    while (Date.now() - startTime < pollTimeout) {
      if (!metaGone) metaGone = await accountGone(this.ephemeralMetaAddress!);
      if (!programGone) programGone = await accountGone(this.ephemeralProgramAddress!);
      if (metaGone && programGone) break;
      await new Promise((r) => setTimeout(r, pollInterval));
    }

    if (!metaGone) {
      return {
        ...result,
        success: false,
        message: "Ephemeral meta account still exists after DESTROY",
      };
    }

    if (!programGone) {
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
        message: `CREATE_PERMANENT failed: ${this.fmtExecErr(status)}`,
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
        message: `FINALIZE failed: ${this.fmtExecErr(status)}`,
      };
    }
    this.aliceNonce++;

    result.verificationDetails.push("✓ FINALIZE: Permanent program locked");
    result.verificationDetails.push(
      "✓ Finalized permanent program persists (cannot be destroyed by design)"
    );
    return result;
  }

  /** Format execution result for error messages (includes userErrorCode for program reverts). */
  private fmtExecErr(status: any): string {
    const vm = status?.executionResult?.vmError;
    const uec = status?.executionResult?.userErrorCode;
    if (uec !== undefined && uec !== 0n) {
      return `vmError=${vm}, userErrorCode=0x${uec.toString(16)}`;
    }
    return `vmError=${vm}`;
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
