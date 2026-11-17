import { TransferCheckedInstructionBuilder } from '../abi/thru/program/token/types';
import type { AccountLookupContext, InstructionData, TransferCheckedArgs } from '../types';
import { buildTokenInstructionBytes, encodeTickerField } from './shared';

/**
 * Builds a TransferChecked instruction. The token program reverts unless the
 * mint account, decimals and ticker match the token being moved, so a signer
 * that reviews the instruction bytes can trust them.
 *
 * The program only reads the mint account. List it in the transaction's
 * read-only accounts so that transfers of one token do not serialize on it.
 */
export function createTransferCheckedInstruction(args: TransferCheckedArgs): InstructionData {
  const { decimals } = args;
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new Error('Decimals must be an integer between 0 and 255');
  }
  const tickerFieldBytes = encodeTickerField(args.ticker);

  return async (context: AccountLookupContext): Promise<Uint8Array> => {
    const payload = new TransferCheckedInstructionBuilder()
      .set_source_account_index(context.getAccountIndex(args.sourceAccountBytes))
      .set_dest_account_index(context.getAccountIndex(args.destinationAccountBytes))
      .set_mint_account_index(context.getAccountIndex(args.mintAccountBytes))
      .set_amount(args.amount)
      .set_decimals(decimals)
      .set_ticker(tickerFieldBytes)
      .build();

    return buildTokenInstructionBytes('transfer_checked', payload);
  };
}
