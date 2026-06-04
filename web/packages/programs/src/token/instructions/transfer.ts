import { TransferInstruction, TransferInstructionBuilder } from '../abi/thru/program/token/types';
import type { AccountLookupContext, TransferArgs, InstructionData } from '../types';
import { buildTokenInstructionBytes } from './shared';

type TransferInstructionBuilderWithBigInt = TransferInstructionBuilder & {
  set_amount(value: number | bigint): TransferInstructionBuilder;
};

export function createTransferInstruction(args: TransferArgs): InstructionData {
  return async (context: AccountLookupContext): Promise<Uint8Array> => {
    const sourceIndex = context.getAccountIndex(args.sourceAccountBytes);
    const destinationIndex = context.getAccountIndex(args.destinationAccountBytes);

    const payloadBuilder = TransferInstruction.builder()
      .set_source_account_index(sourceIndex)
      .set_dest_account_index(destinationIndex);

    (payloadBuilder as TransferInstructionBuilderWithBigInt).set_amount(args.amount);

    const payload = payloadBuilder.build();

    return buildTokenInstructionBytes('transfer', payload);
  };
}
