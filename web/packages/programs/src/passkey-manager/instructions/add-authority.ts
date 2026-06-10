import type { AddAuthorityInstructionParams } from '../types';
import {
  AddAuthorityArgsBuilder,
  PasskeyInstructionBuilder,
} from '../abi/thru/program/passkey_manager/types';
import { buildAuthority } from './create';

export function encodeAddAuthorityInstruction(params: AddAuthorityInstructionParams): Uint8Array {
  const { walletAccountIdx } = params;
  if (walletAccountIdx < 0 || walletAccountIdx > 0xffff) {
    throw new Error('walletAccountIdx must be 0-65535');
  }

  const authorityBytes = buildAuthority(params.authority);

  const argsPayload = new AddAuthorityArgsBuilder()
    .set_wallet_account_idx(walletAccountIdx)
    .set_authority(authorityBytes)
    .build();

  return new PasskeyInstructionBuilder()
    .payload()
    .select('add_authority')
    .writePayload(argsPayload)
    .finish()
    .build();
}
