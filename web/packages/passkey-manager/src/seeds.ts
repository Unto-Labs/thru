import { decodeAddress } from '@thru/helpers';

/**
 * Create a 32-byte seed from wallet name and passkey coordinates.
 * SHA-256(walletName || pubkey_x || pubkey_y)
 */
export async function createWalletSeed(
  walletName: string,
  pubkeyX: Uint8Array,
  pubkeyY: Uint8Array
): Promise<Uint8Array> {
  if (pubkeyX.length !== 32) throw new Error('pubkeyX must be 32 bytes');
  if (pubkeyY.length !== 32) throw new Error('pubkeyY must be 32 bytes');

  const nameBytes = new TextEncoder().encode(walletName);
  const data = new Uint8Array(nameBytes.length + 32 + 32);
  data.set(nameBytes, 0);
  data.set(pubkeyX, nameBytes.length);
  data.set(pubkeyY, nameBytes.length + 32);

  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return new Uint8Array(hashBuffer);
}

/**
 * Derive wallet account address from seed using proper PDA derivation.
 * SHA256(program_address || is_ephemeral || seed)
 */
export async function deriveWalletAddress(
  seed: Uint8Array,
  programAddress: string
): Promise<Uint8Array> {
  if (seed.length !== 32) {
    throw new Error('seed must be 32 bytes');
  }

  const programBytes = decodeAddress(programAddress);
  const isEphemeral = new Uint8Array([0]);

  const preimage = new Uint8Array(32 + 1 + 32);
  preimage.set(programBytes, 0);
  preimage.set(isEphemeral, 32);
  preimage.set(seed, 33);

  const hashBuffer = await crypto.subtle.digest('SHA-256', preimage);
  return new Uint8Array(hashBuffer);
}
