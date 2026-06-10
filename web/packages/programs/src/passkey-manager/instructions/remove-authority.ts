import {
  RemoveAuthorityArgsBuilder,
  PasskeyInstructionBuilder,
} from '../abi/thru/program/passkey_manager/types';
import type { RemoveAuthorityInstructionParams } from '../types';

export function encodeRemoveAuthorityInstruction(
  params: RemoveAuthorityInstructionParams
): Uint8Array {
  const { walletAccountIdx, authIdx } = params;
  if (walletAccountIdx < 0 || walletAccountIdx > 0xffff) {
    throw new Error('walletAccountIdx must be 0-65535');
  }
  if (authIdx < 0 || authIdx > 0xff) throw new Error('authIdx must be 0-255');

  const argsPayload = new RemoveAuthorityArgsBuilder()
    .set_wallet_account_idx(walletAccountIdx)
    .set_auth_idx(authIdx)
    .build();

  return new PasskeyInstructionBuilder()
    .payload()
    .select('remove_authority')
    .writePayload(argsPayload)
    .finish()
    .build();
}
