import type { ValidateInstructionParams } from '../types';
import {
  ValidateArgsBuilder,
  PasskeyInstructionBuilder,
} from '../abi/thru/program/passkey_manager/types';

export function encodeValidateInstruction(params: ValidateInstructionParams): Uint8Array {
  const { walletAccountIdx, authIdx, signatureR, signatureS, authenticatorData, clientDataJSON } =
    params;

  if (walletAccountIdx < 0 || walletAccountIdx > 0xffff) {
    throw new Error('walletAccountIdx must be 0-65535');
  }
  if (authIdx < 0 || authIdx > 0xff) throw new Error('authIdx must be 0-255');
  if (signatureR.length !== 32) throw new Error('signatureR must be 32 bytes');
  if (signatureS.length !== 32) throw new Error('signatureS must be 32 bytes');

  const argsPayload = new ValidateArgsBuilder()
    .set_wallet_account_idx(walletAccountIdx)
    .set_auth_idx(authIdx)
    .set_signature_r(signatureR)
    .set_signature_s(signatureS)
    .authenticator_data().write(authenticatorData).finish()
    .client_data().write(clientDataJSON).finish()
    .build();

  return new PasskeyInstructionBuilder()
    .payload()
    .select('validate')
    .writePayload(argsPayload)
    .finish()
    .build();
}
