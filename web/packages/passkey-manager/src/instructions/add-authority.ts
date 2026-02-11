import type { Authority } from '../types';
import {
  AddAuthorityArgsBuilder,
  PasskeyInstructionBuilder,
} from '../abi/thru/program/passkey_manager/types';
import { buildAuthority } from './create';

export function encodeAddAuthorityInstruction(params: { authority: Authority }): Uint8Array {
  const authorityBytes = buildAuthority(params.authority);

  const argsPayload = new AddAuthorityArgsBuilder()
    .set_authority(authorityBytes)
    .build();

  return new PasskeyInstructionBuilder()
    .payload()
    .select('add_authority')
    .writePayload(argsPayload)
    .finish()
    .build();
}
