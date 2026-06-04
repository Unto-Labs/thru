import { InitializeAccountInstructionBuilder } from '../abi/thru/program/token/types';
import type { AccountLookupContext, InitializeAccountArgs, InstructionData } from '../types';
import { buildTokenInstructionBytes } from './shared';

export function createInitializeAccountInstruction(
  args: InitializeAccountArgs
): InstructionData {
  if (args.seedBytes.length !== 32) {
    throw new Error('Token account seed must be 32 bytes');
  }

  return async (context: AccountLookupContext): Promise<Uint8Array> => {
    const tokenAccountIndex = context.getAccountIndex(args.tokenAccountBytes);
    const mintAccountIndex = context.getAccountIndex(args.mintAccountBytes);
    const ownerAccountIndex = context.getAccountIndex(args.ownerAccountBytes);

    const payload = new InitializeAccountInstructionBuilder()
      .set_token_account_index(tokenAccountIndex)
      .set_mint_account_index(mintAccountIndex)
      .set_owner_account_index(ownerAccountIndex)
      .set_new_account_seed(args.seedBytes)
      .set_state_proof(args.stateProof)
      .build();

    return buildTokenInstructionBytes('initialize_account', payload);
  };
}
