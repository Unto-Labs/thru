import { deriveAddress, deriveProgramAddress, Pubkey } from '@thru/thru-sdk';
import { PUBKEY_LENGTH } from './constants';

const TOKEN_ACCOUNT_DEFAULT_SEED = new Uint8Array(PUBKEY_LENGTH);

export function deriveMintAddress(
  mintAuthorityAddress: string,
  seed: string,
  tokenProgramAddress: string
): { address: string; bytes: Uint8Array; derivedSeed: Uint8Array } {
  const mintAuthorityBytes = Pubkey.from(mintAuthorityAddress).toBytes();
  const seedBytes = hexToBytes(seed);
  if (seedBytes.length !== 32) throw new Error('Seed must be 32 bytes (64 hex characters)');

  const { bytes: derivedSeed } = deriveAddress([mintAuthorityBytes, seedBytes]);

  const result = deriveProgramAddress({
    programAddress: tokenProgramAddress,
    seed: derivedSeed,
    ephemeral: false,
  });

  return {
    address: result.address,
    bytes: result.bytes,
    derivedSeed,
  };
}

export function deriveTokenAccountAddress(
  ownerAddress: string,
  mintAddress: string,
  tokenProgramAddress: string,
  seed: Uint8Array = TOKEN_ACCOUNT_DEFAULT_SEED
): { address: string; bytes: Uint8Array; derivedSeed: Uint8Array } {
  if (seed.length !== PUBKEY_LENGTH) throw new Error('Token account seed must be 32 bytes');

  const ownerBytes = Pubkey.from(ownerAddress).toBytes();
  const mintBytes = Pubkey.from(mintAddress).toBytes();

  const { bytes: derivedSeed } = deriveAddress([ownerBytes, mintBytes, seed]);

  const result = deriveProgramAddress({
    programAddress: tokenProgramAddress,
    seed: derivedSeed,
    ephemeral: false,
  });

  return {
    address: result.address,
    bytes: result.bytes,
    derivedSeed,
  };
}

export function deriveWalletSeed(
  walletAddress: string,
  extraSeeds: Uint8Array[] = []
): Uint8Array {
  const walletBytes = Pubkey.from(walletAddress).toBytes();
  return deriveAddress([walletBytes, ...extraSeeds]).bytes;
}

function hexToBytes(hex: string): Uint8Array {
  const normalized = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (normalized.length % 2 !== 0) {
    throw new Error('Hex string must have even number of characters');
  }
  const bytes = new Uint8Array(normalized.length / 2);
  for (let i = 0; i < normalized.length; i += 2) {
    bytes[i / 2] = parseInt(normalized.substring(i, i + 2), 16);
  }
  return bytes;
}
