import {
  RemoveAuthorityArgsBuilder,
  PasskeyInstructionBuilder,
} from '../abi/thru/program/passkey_manager/types';

export function encodeRemoveAuthorityInstruction(params: { authIdx: number }): Uint8Array {
  const { authIdx } = params;
  if (authIdx < 0 || authIdx > 0xff) throw new Error('authIdx must be 0-255');

  const argsPayload = new RemoveAuthorityArgsBuilder()
    .set_auth_idx(authIdx)
    .build();

  return new PasskeyInstructionBuilder()
    .payload()
    .select('remove_authority')
    .writePayload(argsPayload)
    .finish()
    .build();
}
