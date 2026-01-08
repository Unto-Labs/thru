import { decodeAddress, encodeAddress } from "@thru/helpers";

/**
 * Suffix appended to program account bytes for ABI seed derivation
 */
const ABI_SEED_SUFFIX = "_abi_account";

/**
 * Derives the ABI seed bytes from a program account pubkey.
 *
 * Algorithm:
 * 1. Get program account bytes (32 bytes)
 * 2. Append "_abi_account" suffix (12 bytes)
 * 3. SHA256 hash the combined 44 bytes
 * 4. Return the 32-byte hash as the seed
 *
 * @param programAccountBytes - The 32-byte program account public key
 * @returns 32-byte seed for PDA derivation
 */
export async function deriveAbiSeed(programAccountBytes: Uint8Array): Promise<Uint8Array> {
  if (programAccountBytes.length !== 32) {
    throw new Error(`Expected 32-byte program account, got ${programAccountBytes.length} bytes`);
  }

  // Combine program account bytes with suffix
  const suffixBytes = new TextEncoder().encode(ABI_SEED_SUFFIX);
  const combined = new Uint8Array(programAccountBytes.length + suffixBytes.length);
  combined.set(programAccountBytes, 0);
  combined.set(suffixBytes, programAccountBytes.length);

  // SHA256 hash
  const hashBuffer = await crypto.subtle.digest("SHA-256", combined);
  return new Uint8Array(hashBuffer);
}

/**
 * Derives a program address (PDA) from a seed and program ID.
 *
 * This implements the Thru PDA derivation algorithm:
 * 1. Combine seed + program ID bytes
 * 2. SHA256 hash the combined bytes
 * 3. Return as the derived address
 *
 * @param seed - The 32-byte seed
 * @param programId - The program ID bytes (32 bytes)
 * @param ephemeral - Whether to derive an ephemeral address (affects prefix byte)
 * @returns The derived 32-byte address
 */
export async function deriveProgramAddress(
  seed: Uint8Array,
  programId: Uint8Array,
  ephemeral: boolean = false
): Promise<Uint8Array> {
  if (seed.length !== 32) {
    throw new Error(`Expected 32-byte seed, got ${seed.length} bytes`);
  }
  if (programId.length !== 32) {
    throw new Error(`Expected 32-byte program ID, got ${programId.length} bytes`);
  }

  // Combine seed + program ID
  const combined = new Uint8Array(seed.length + programId.length);
  combined.set(seed, 0);
  combined.set(programId, seed.length);

  // SHA256 hash
  const hashBuffer = await crypto.subtle.digest("SHA-256", combined);
  const result = new Uint8Array(hashBuffer);

  // Set the ephemeral bit in the first byte if needed
  // Ephemeral addresses have bit 0x80 set in the first byte
  if (ephemeral) {
    result[0] = result[0] | 0x80;
  } else {
    result[0] = result[0] & 0x7f;
  }

  return result;
}

/**
 * Derives the ABI account address for a given program account.
 *
 * @param programAccount - The program account address (ta-prefixed string or 32-byte array)
 * @param abiManagerProgramId - The ABI manager program ID (ta-prefixed string or 32-byte array)
 * @param ephemeral - Whether to derive an ephemeral address
 * @returns The derived ABI account address as a ta-prefixed string
 */
export async function deriveAbiAddress(
  programAccount: string | Uint8Array,
  abiManagerProgramId: string | Uint8Array,
  ephemeral: boolean = false
): Promise<string> {
  // Convert string addresses to bytes
  const programAccountBytes = typeof programAccount === "string"
    ? decodeAddress(programAccount)
    : programAccount;

  const abiManagerBytes = typeof abiManagerProgramId === "string"
    ? decodeAddress(abiManagerProgramId)
    : abiManagerProgramId;

  // Derive the seed
  const seed = await deriveAbiSeed(programAccountBytes);

  // Derive the PDA
  const abiAccountBytes = await deriveProgramAddress(seed, abiManagerBytes, ephemeral);

  // Encode as ta-prefixed address
  return encodeAddress(abiAccountBytes);
}
