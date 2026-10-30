import { FaucetInstructionBuilder, WithdrawArgsBuilder } from './abi/thru/program/faucet/types.js';
import { decodeAddress } from '@thru/sdk/helpers';
import type { InstructionData } from '../token/types.js';

export { BOOTSTRAP_FAUCET_VAULT_ADDRESS, BOOTSTRAP_PROGRAM_ADDRESSES } from '../bootstrap-addresses/index.js';

/** Native amounts are integer base units; the program caps each withdrawal. */
export function createFaucetWithdrawInstruction(args: {
  vault: string;
  recipient: string;
  amount: bigint;
}): InstructionData {
  if (args.amount <= 0n || args.amount > 10_000n) {
    throw new Error('Native faucet amount must be 1 to 10000 raw units');
  }
  return async ({ getAccountIndex }) => {
    const payload = new WithdrawArgsBuilder()
      .set_faucet_account_idx(getAccountIndex(decodeAddress(args.vault)))
      .set_recipient_account_idx(getAccountIndex(decodeAddress(args.recipient)))
      .set_amount(args.amount);
    const instruction = new FaucetInstructionBuilder();
    instruction.payload().select('withdraw').writePayload(payload.build());
    return instruction.build();
  };
}
