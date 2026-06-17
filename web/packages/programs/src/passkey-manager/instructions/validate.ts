import type { ValidateInstructionParams } from '../types';
import {
  PasskeyInstructionBuilder,
  ValidateArgsBuilder,
} from '../abi/thru/program/passkey_manager/types';
import { buildTargetInstructionBytes } from '../target-instruction';

export function encodeValidateInstruction(params: ValidateInstructionParams): Uint8Array {
  const {
    walletAccountIdx,
    authIdx,
    targetInstruction,
    signatureR,
    signatureS,
    authenticatorData,
    clientDataJSON,
  } = params;

  if (walletAccountIdx < 0 || walletAccountIdx > 0xffff) {
    throw new Error('walletAccountIdx must be 0-65535');
  }
  if (authIdx < 0 || authIdx > 0xff) throw new Error('authIdx must be 0-255');
  if (signatureR.length !== 32) throw new Error('signatureR must be 32 bytes');
  if (signatureS.length !== 32) throw new Error('signatureS must be 32 bytes');
  if (authenticatorData.length > 0xffff) {
    throw new Error('authenticatorData length must be 0-65535');
  }
  if (clientDataJSON.length > 0xffff) {
    throw new Error('clientDataJSON length must be 0-65535');
  }

  const targetInstructionBytes = buildTargetInstructionBytes(targetInstruction);

  const argsBuilder = new ValidateArgsBuilder()
    .set_wallet_account_idx(walletAccountIdx)
    .set_auth_idx(authIdx)
    .set_signature_r(signatureR)
    .set_signature_s(signatureS)
    .set_target_instruction(targetInstructionBytes);
  argsBuilder.authenticator_data().write(authenticatorData).finish();
  argsBuilder.client_data().write(clientDataJSON).finish();

  return new PasskeyInstructionBuilder()
    .payload()
    .select('validate')
    .writePayload(argsBuilder)
    .finish()
    .build();
}
