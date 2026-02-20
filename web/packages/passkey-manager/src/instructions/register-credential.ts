import type { RegisterCredentialInstructionParams } from '../types';
import {
  RegisterCredentialArgsBuilder,
  PasskeyInstructionBuilder,
} from '../abi/thru/program/passkey_manager/types';

export function encodeRegisterCredentialInstruction(
  params: RegisterCredentialInstructionParams
): Uint8Array {
  const { walletAccountIdx, lookupAccountIdx, seed, stateProof } = params;

  if (seed.length !== 32) throw new Error('seed must be 32 bytes');
  if (walletAccountIdx < 0 || walletAccountIdx > 0xffff) {
    throw new Error('walletAccountIdx must be 0-65535');
  }
  if (lookupAccountIdx < 0 || lookupAccountIdx > 0xffff) {
    throw new Error('lookupAccountIdx must be 0-65535');
  }

  const argsPayload = new RegisterCredentialArgsBuilder()
    .set_wallet_account_idx(walletAccountIdx)
    .set_lookup_account_idx(lookupAccountIdx)
    .set_seed(seed)
    .set_state_proof(stateProof)
    .build();

  return new PasskeyInstructionBuilder()
    .payload()
    .select('register_credential')
    .writePayload(argsPayload)
    .finish()
    .build();
}
