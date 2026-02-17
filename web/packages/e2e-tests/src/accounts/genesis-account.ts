import { getPublicKeyAsync } from "@noble/ed25519";
import { encodeAddress } from "@thru/helpers";

export const GENESIS_ACCOUNT_COUNT = 1024;

/**
 * GenesisAccount represents a pre-funded account from genesis.
 * The derivation matches the C implementation in tn_fund_initial_accounts:
 * - private_key[0] = (uchar)(i & 0xFFUL);
 * - private_key[1] = (uchar)((i >> 8) & 0xFFUL);
 * - private_key[2] = (uchar)((i >> 16) & 0xFFUL);
 * - private_key[3] = (uchar)((i >> 24) & 0xFFUL);
 * - rest is zeros
 */
export interface GenesisAccount {
  index: number;
  seed: Uint8Array;
  publicKey: Uint8Array;
  publicKeyString: string;
  inUse: boolean;
}

/**
 * Creates a genesis account from its index.
 * CRITICAL: This must match the Go/C implementation exactly.
 */
export async function createGenesisAccount(index: number): Promise<GenesisAccount> {
  if (index < 0 || index >= GENESIS_ACCOUNT_COUNT) {
    throw new Error(`Invalid genesis account index: ${index}`);
  }

  // Create private key seed matching C implementation:
  // First 4 bytes are the little-endian index, rest is zeros
  const seed = new Uint8Array(32);
  const view = new DataView(seed.buffer);
  view.setUint32(0, index, true); // little-endian

  // Generate public key from seed
  const publicKey = await getPublicKeyAsync(seed);
  const publicKeyString = encodeAddress(publicKey);

  return {
    index,
    seed,
    publicKey,
    publicKeyString,
    inUse: false,
  };
}

/**
 * Gets the Ed25519 private key (64 bytes) from a seed.
 * In Ed25519, the private key is the seed concatenated with the public key.
 */
export async function getPrivateKey(seed: Uint8Array): Promise<Uint8Array> {
  const publicKey = await getPublicKeyAsync(seed);
  const privateKey = new Uint8Array(64);
  privateKey.set(seed, 0);
  privateKey.set(publicKey, 32);
  return privateKey;
}
