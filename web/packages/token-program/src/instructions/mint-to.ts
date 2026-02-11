import { MintToInstructionBuilder } from '../abi/thru/program/token/types';
import type { AccountLookupContext, MintToArgs, InstructionData } from '../types';
import { buildTokenInstructionBytes } from './shared';

type MintToInstructionBuilderWithBigInt = MintToInstructionBuilder & {
  set_amount(value: number | bigint): MintToInstructionBuilder;
};

export function createMintToInstruction(args: MintToArgs): InstructionData {
  return async (context: AccountLookupContext): Promise<Uint8Array> => {
    const mintAccountIndex = context.getAccountIndex(args.mintAccountBytes);
    const destinationIndex = context.getAccountIndex(args.destinationAccountBytes);
    const authorityIndex = context.getAccountIndex(args.authorityAccountBytes);

    const payloadBuilder = new MintToInstructionBuilder()
      .set_mint_account_index(mintAccountIndex)
      .set_dest_account_index(destinationIndex)
      .set_authority_account_index(authorityIndex);

    (payloadBuilder as MintToInstructionBuilderWithBigInt).set_amount(args.amount);

    const payload = payloadBuilder.build();

    return buildTokenInstructionBytes('mint_to', payload);
  };
}
