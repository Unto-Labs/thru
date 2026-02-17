import { BaseScenario } from "../framework/scenario";
import type { TestContext } from "../framework/context";
import type { TestResult } from "../framework/result";
import { trackTransactionUntilFinalized } from "../utils/timing";
import { StateProofType } from "@thru/proto";
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
 * Build EOA create account instruction with fee payer proof
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
 * Corrupt a proof by flipping bits at multiple locations
 */
function corruptProof(validProof: Uint8Array): Uint8Array {
  if (validProof.length === 0) {
    return new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0xca, 0xfe, 0xba, 0xbe]);
  }

  const corrupted = new Uint8Array(validProof);

  // Flip first byte
  if (corrupted.length > 0) {
    corrupted[0] ^= 0xff;
  }

  // Flip middle byte
  if (corrupted.length > 1) {
    const mid = Math.floor(corrupted.length / 2);
    corrupted[mid] ^= 0xff;
  }

  // Flip last byte
  if (corrupted.length > 2) {
    corrupted[corrupted.length - 1] ^= 0xff;
  }

  return corrupted;
}

/**
 * AccountCreationFeePayerFailureScenario tests that account creation with an invalid
 * fee payer proof correctly fails and the account is not created.
 */
export class AccountCreationFeePayerFailureScenario extends BaseScenario {
  name = "Account Creation Fee Payer Failure";
  description =
    "Tests that account creation fails when provided with an invalid fee payer proof";

  private newAccountSeed: Uint8Array | null = null;
  private newAccountPubkey: Uint8Array | null = null;
  private newAccountAddress: string | null = null;

  async setup(ctx: TestContext): Promise<void> {
    // Generate a random seed for the new account
    this.newAccountSeed = new Uint8Array(32);
    crypto.getRandomValues(this.newAccountSeed);

    // Derive public key from seed
    this.newAccountPubkey = await getPublicKeyAsync(this.newAccountSeed);

    // Encode as ta-address
    const { encodeAddress } = await import("@thru/helpers");
    this.newAccountAddress = encodeAddress(this.newAccountPubkey);

    ctx.logInfo("Generated new account: %s", this.newAccountAddress);
  }

  async execute(ctx: TestContext): Promise<TestResult> {
    const result: TestResult = {
      success: true,
      message: "Account creation with invalid proof test passed",
      details: [],
      verificationDetails: [],
      executionTimeMs: 0,
    };

    ctx.logInfo("=== Account Creation Fee Payer Failure Test Starting ===");
    ctx.logInfo("Testing account creation with deliberately invalid proof");

    // Step 1: Generate a valid state proof
    ctx.logInfo("Step 1: Generating state proof for account %s", this.newAccountAddress);
    const stateProof = await ctx.sdk.proofs.generate({
      address: this.newAccountPubkey!,
      proofType: StateProofType.CREATING,
    });

    const validProof = stateProof.proof;
    if (!validProof || validProof.length === 0) {
      return {
        ...result,
        success: false,
        message: "Failed to generate state proof - empty proof returned",
      };
    }

    result.details.push(`Generated valid state proof (${validProof.length} bytes)`);

    // Step 2: Corrupt the proof to make it invalid
    ctx.logInfo("Step 2: Corrupting the state proof to make it invalid");
    const invalidProof = corruptProof(validProof);
    result.details.push("Corrupted state proof to test failure handling");

    // Step 3: Create the EOA signature (signing null owner)
    ctx.logInfo("Step 3: Creating EOA signature");
    const nullOwner = new Uint8Array(32);
    const eoaSignature = await signAsync(nullOwner, this.newAccountSeed!);

    // Step 4: Get current slot and fee payer nonce
    const height = await ctx.sdk.blocks.getBlockHeight();
    const startSlot = height.finalized + 1n;

    const feePayerAcct = await ctx.sdk.accounts.get(ctx.genesisAccount.publicKeyString);
    if (!feePayerAcct) {
      return {
        ...result,
        success: false,
        message: "Failed to get fee payer account",
      };
    }
    const feePayerNonce = feePayerAcct.meta?.nonce ?? 0n;

    // Step 5: Build transaction with invalid proof
    ctx.logInfo("Step 4: Building create account transaction with invalid proof");
    const newAccountIdx = 2;
    const instructionData = buildCreateEOAInstruction(newAccountIdx, eoaSignature, invalidProof);

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

    const signature = tx.signature.toThruFmt();
    ctx.logInfo("Built transaction with invalid proof: signature=%s", signature);
    result.details.push(`Transaction signature: ${signature}`);

    // Step 6: Submit transaction (should succeed in submission but fail in execution)
    ctx.logInfo("Step 5: Submitting transaction (expecting execution failure)");
    const trackPromise = trackTransactionUntilFinalized(ctx.sdk, signature);
    await ctx.sdk.transactions.send(tx.rawTransaction);

    result.verificationDetails.push("✓ Transaction submitted successfully");

    // Step 7: Wait for transaction via tracking and verify it failed
    ctx.logInfo("Step 6: Waiting for transaction execution (expecting failure)");
    const txStatus = (await trackPromise) as any;
    if (!txStatus) {
      return {
        ...result,
        success: false,
        message: "Failed to get transaction status",
      };
    }

    // Verify execution failed (vm_error != 0)
    const vmError = txStatus.executionResult?.vmError;
    if (vmError === 0) {
      return {
        ...result,
        success: false,
        message: "Transaction succeeded when it should have failed with invalid proof",
      };
    }

    ctx.logInfo("Transaction failed as expected: vm_error=%d", vmError);
    result.verificationDetails.push(`✓ Transaction failed as expected (vm_error=${vmError})`);

    // Step 8: Verify account was NOT created using GetAccount
    ctx.logInfo("Step 7: Verifying account was not created (GetAccount)");

    try {
      const newAccount = await ctx.sdk.accounts.get(this.newAccountAddress!);
      if (newAccount) {
        return {
          ...result,
          success: false,
          message: "GetAccount succeeded when account should not exist",
        };
      }
    } catch (err) {
      // Expected - account should not exist
      const errorMessage = (err as Error).message || String(err);
      if (!errorMessage.includes("not found") && !errorMessage.includes("NotFound")) {
        return {
          ...result,
          success: false,
          message: `GetAccount returned unexpected error: ${errorMessage}`,
        };
      }
      ctx.logInfo("GetAccount correctly returned NotFound error");
    }

    result.verificationDetails.push("✓ GetAccount returns NotFound (account not created)");

    // Step 9: Verify account was NOT created using GetRawAccount
    ctx.logInfo("Step 8: Verifying account was not created (GetRawAccount)");

    try {
      const rawAccount = await ctx.sdk.accounts.getRaw(this.newAccountAddress!);
      if (rawAccount) {
        return {
          ...result,
          success: false,
          message: "GetRawAccount succeeded when account should not exist",
        };
      }
    } catch (err) {
      // Expected - account should not exist
      const errorMessage = (err as Error).message || String(err);
      if (!errorMessage.includes("not found") && !errorMessage.includes("NotFound")) {
        return {
          ...result,
          success: false,
          message: `GetRawAccount returned unexpected error: ${errorMessage}`,
        };
      }
      ctx.logInfo("GetRawAccount correctly returned NotFound error");
    }

    result.verificationDetails.push("✓ GetRawAccount returns NotFound (account not created)");

    result.details.push("Transaction with invalid proof correctly failed");
    result.details.push("Account was not created in state");

    ctx.logInfo("=== Account Creation Fee Payer Failure Test Completed ===");

    return result;
  }

  async cleanup(_ctx: TestContext): Promise<void> {
    // No cleanup required - account was never created
  }
}

export function createAccountCreationFeePayerFailureScenario(): AccountCreationFeePayerFailureScenario {
  return new AccountCreationFeePayerFailureScenario();
}
