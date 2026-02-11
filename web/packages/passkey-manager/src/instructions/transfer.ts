import type { TransferInstructionParams } from '../types';
import {
  TransferArgsBuilder,
  PasskeyInstructionBuilder,
} from '../abi/thru/program/passkey_manager/types';

export function encodeTransferInstruction(params: TransferInstructionParams): Uint8Array {
  const { walletAccountIdx, toAccountIdx, amount } = params;

  if (walletAccountIdx < 0 || walletAccountIdx > 0xffff) {
    throw new Error('walletAccountIdx must be 0-65535');
  }
  if (toAccountIdx < 0 || toAccountIdx > 0xffff) {
    throw new Error('toAccountIdx must be 0-65535');
  }
  if (amount < 0n) throw new Error('amount must be non-negative');

  const argsPayload = new TransferArgsBuilder()
    .set_wallet_account_idx(walletAccountIdx)
    .set_to_account_idx(toAccountIdx)
    .set_amount(amount as unknown as number)
    .build();

  return new PasskeyInstructionBuilder()
    .payload()
    .select('transfer')
    .writePayload(argsPayload)
    .finish()
    .build();
}
