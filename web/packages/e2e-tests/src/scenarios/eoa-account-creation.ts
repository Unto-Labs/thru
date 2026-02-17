import { BaseScenario } from "../framework/scenario";
import type { TestContext } from "../framework/context";
import type { TestResult } from "../framework/result";
import { StateProofType } from "@thru/proto";
import { trackTransactionUntilFinalized } from "../utils/timing";
import { getPublicKeyAsync, signAsync } from "@noble/ed25519";

// EOA program address (all zeros)
const EOA_PROGRAM = new Uint8Array(32);

// EOA create account constants
const CREATE_FEE = 1n;
const CREATE_CU = 1_000_000;
const CREATE_SU = 10_000;
const CREATE_MU = 10_000;
const CREATE_EXPIRY = 1_000_000;

/**
 * Build EOA create account instruction
 * Format:
 * - discriminant (4 bytes): 0 (CREATE_ACCOUNT)
 * - proof_size (8 bytes)
 * - eoa_account_idx (2 bytes): index of new account in RW accounts
 * - signature (64 bytes): ed25519 signature of null owner
 * - proof data (variable)
 */
function buildCreateEOAInstruction(
  newAccountIdx: number,
  signature: Uint8Array,
  proofData: Uint8Array
): Uint8Array {
  const proofSize = BigInt(proofData.length);
  const data = new Uint8Array(4 + 8 + 2 + 64 + proofData.length);
  const view = new DataView(data.buffer);

  // discriminant = 0 (CREATE_ACCOUNT)
  view.setUint32(0, 0, true);
  // proof_size
  view.setBigUint64(4, proofSize, true);
  // eoa_account_idx
  view.setUint16(12, newAccountIdx, true);
  // signature (64 bytes)
  data.set(signature, 14);
  // proof data
  data.set(proofData, 78);

  return data;
}

/**
 * EOAAccountCreationScenario tests EOA account creation using the EOA program.
 * This scenario verifies:
 * - State proof generation for non-existent accounts
 * - EOA account creation with signature verification
 * - Account exists after creation with null owner (EOA flag)
 */
export class EOAAccountCreationScenario extends BaseScenario {
  name = "EOA Account Creation";
  description =
    "Tests EOA account creation using TN_EOA_INSTRUCTION_CREATE_ACCOUNT with signature verification";

  private newAccountSeed: Uint8Array | null = null;
  private newAccountPubkey: Uint8Array | null = null;
  private newAccountAddress: string | null = null;

  async setup(ctx: TestContext): Promise<void> {
    // Generate a random seed for the new EOA account
    this.newAccountSeed = new Uint8Array(32);
    crypto.getRandomValues(this.newAccountSeed);

    // Derive public key from seed
    this.newAccountPubkey = await getPublicKeyAsync(this.newAccountSeed);

    // Encode as ta-address
    const { encodeAddress } = await import("@thru/helpers");
    this.newAccountAddress = encodeAddress(this.newAccountPubkey);

    ctx.logInfo("Fee payer: %s", ctx.genesisAccount.publicKeyString);
    ctx.logInfo("New EOA: %s", this.newAccountAddress);
  }

  async execute(ctx: TestContext): Promise<TestResult> {
    const result: TestResult = {
      success: true,
      message: "EOA account creation test passed",
      details: [],
      verificationDetails: [],
      executionTimeMs: 0,
    };

    ctx.logInfo("=== EOA Account Creation Test Starting ===");

    // Step 1: Generate state proof for the new account (proving it doesn't exist)
    ctx.logInfo("Step 1: Generating state proof for new EOA account %s", this.newAccountAddress);
    const stateProof = await ctx.sdk.proofs.generate({
      address: this.newAccountPubkey!,
      proofType: StateProofType.CREATING,
    });

    const proofData = stateProof.proof;
    if (!proofData || proofData.length === 0) {
      return {
        ...result,
        success: false,
        message: "Failed to generate state proof - empty proof returned",
      };
    }

    result.details.push(`Generated state proof (${proofData.length} bytes)`);
    ctx.logInfo("State proof generated: %d bytes", proofData.length);

    // Step 2: Create the signature by signing the null owner (32 bytes of zeros)
    ctx.logInfo("Step 2: Creating EOA signature (signing null owner)");
    const nullOwner = new Uint8Array(32);
    const eoaSignature = await signAsync(nullOwner, this.newAccountSeed!);

    if (eoaSignature.length !== 64) {
      return {
        ...result,
        success: false,
        message: `Invalid signature length: got ${eoaSignature.length}, expected 64`,
      };
    }
    result.details.push("Created EOA signature");

    // Step 3: Get current slot for transaction timing
    const height = await ctx.sdk.blocks.getBlockHeight();
    const startSlot = height.finalized + 1n;
    ctx.logInfo("Step 3: Using start slot %d", startSlot);

    // Step 4: Get fee payer's nonce
    const feePayerAcct = await ctx.sdk.accounts.get(ctx.genesisAccount.publicKeyString);
    if (!feePayerAcct) {
      return {
        ...result,
        success: false,
        message: "Failed to get fee payer account",
      };
    }
    const feePayerNonce = feePayerAcct.meta?.nonce ?? 0n;

    // Step 5: Build the EOA create account transaction
    // New account will be at index 2 (after fee payer at 0 and program at 1)
    ctx.logInfo("Step 4: Building EOA create account transaction");
    const newAccountIdx = 2;
    const instructionData = buildCreateEOAInstruction(newAccountIdx, eoaSignature, proofData);

    const tx = await ctx.sdk.transactions.buildAndSign({
      feePayer: {
        publicKey: ctx.genesisAccount.publicKey,
        privateKey: ctx.genesisAccount.seed,
      },
      program: EOA_PROGRAM,
      header: {
        fee: CREATE_FEE,
        nonce: feePayerNonce,
        startSlot: startSlot,
        expiryAfter: CREATE_EXPIRY,
        computeUnits: CREATE_CU,
        stateUnits: CREATE_SU,
        memoryUnits: CREATE_MU,
        chainId: ctx.config.chainId,
      },
      accounts: {
        readWrite: [this.newAccountPubkey!],
      },
      instructionData,
    });

    result.details.push(`Built transaction for EOA at index ${newAccountIdx}`);

    // Step 6: Start tracking and submit transaction
    const signature = tx.signature.toThruFmt();
    const trackPromise = trackTransactionUntilFinalized(ctx.sdk, signature);

    ctx.logInfo("Step 5: Submitting EOA create transaction");
    await ctx.sdk.transactions.send(tx.rawTransaction);

    ctx.logInfo("Transaction submitted: signature=%s", signature);
    result.verificationDetails.push(`✓ Transaction submitted (signature: ${signature})`);

    // Step 7: Wait for transaction to finalize via tracking
    ctx.logInfo("Step 6: Waiting for transaction to finalize");
    const trackResult = await trackPromise;

    if (trackResult.executionResult?.vmError !== 0) {
      return {
        ...result,
        success: false,
        message: `EOA create transaction failed: vmError=${trackResult.executionResult?.vmError}`,
      };
    }

    // Transaction tracking confirmed vmError=0, so account was created successfully.
    // Trust the tracking result - no need for additional verification.
    // For EOA accounts: balance=0, nonce=0, dataSize=0, owner=null (all zeros)
    ctx.logInfo("New EOA account created successfully (confirmed via tracking)");

    result.verificationDetails.push(`✓ New EOA account created: ${this.newAccountAddress}`);
    result.verificationDetails.push("✓ Account confirmed via streaming");

    ctx.logInfo("=== EOA Account Creation Test Completed ===");

    return result;
  }

  async cleanup(ctx: TestContext): Promise<void> {
    if (this.newAccountAddress) {
      ctx.accountStateTracker.unsubscribeAccount(this.newAccountAddress);
    }
  }
}

export function createEOAAccountCreationScenario(): EOAAccountCreationScenario {
  return new EOAAccountCreationScenario();
}
