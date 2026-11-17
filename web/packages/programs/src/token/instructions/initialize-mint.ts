import { InitializeMintInstructionBuilder } from '../abi/thru/program/token/types';
import { ZERO_PUBKEY } from '../constants';
import type { AccountLookupContext, InitializeMintArgs, InstructionData } from '../types';
import { buildTokenInstructionBytes, encodeTickerField } from './shared';

export function hexToBytes(hex: string): Uint8Array {
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

export function createInitializeMintInstruction({
  mintAccountBytes,
  decimals,
  mintAuthorityBytes,
  freezeAuthorityBytes,
  ticker,
  seedHex,
  stateProof,
  creatorBytes,
}: InitializeMintArgs): InstructionData {
  const hasFreezeAuthority = freezeAuthorityBytes ? 1 : 0;
  const seedBytes = hexToBytes(seedHex);
  if (seedBytes.length !== 32) {
    throw new Error('Seed must be 32 bytes (64 hex characters)');
  }
  const tickerFieldBytes = encodeTickerField(ticker.trim().toUpperCase());
  const creator = creatorBytes ?? mintAuthorityBytes;

  return async (context: AccountLookupContext): Promise<Uint8Array> => {
    const mintAccountIndex = context.getAccountIndex(mintAccountBytes);
    const mintAuthority = mintAuthorityBytes;
    const freezeAuthority = freezeAuthorityBytes ?? ZERO_PUBKEY;

    const payload = new InitializeMintInstructionBuilder()
      .set_mint_account_index(mintAccountIndex)
      .set_decimals(decimals)
      .set_creator(creator)
      .set_mint_authority(mintAuthority)
      .set_freeze_authority(freezeAuthority)
      .set_has_freeze_authority(hasFreezeAuthority)
      .set_ticker(tickerFieldBytes)
      .set_seed(seedBytes)
      .set_state_proof(stateProof)
      .build();

    return buildTokenInstructionBytes('initialize_mint', payload);
  };
}
