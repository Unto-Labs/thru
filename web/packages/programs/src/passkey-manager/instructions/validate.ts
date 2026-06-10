import type { ValidateInstructionParams } from '../types';
import { PasskeyInstructionBuilder } from '../abi/thru/program/passkey_manager/types';
import { buildTargetInstructionBytes } from '../target-instruction';

const U8_SIZE = Uint8Array.BYTES_PER_ELEMENT;
const U16_SIZE = Uint16Array.BYTES_PER_ELEMENT;
const P256_COORDINATE_SIZE = 32;
const VALIDATE_FIXED_PREFIX_SIZE =
  U16_SIZE +
  U8_SIZE +
  P256_COORDINATE_SIZE +
  P256_COORDINATE_SIZE +
  U16_SIZE +
  U16_SIZE;

function writeU16LE(target: Uint8Array, offset: number, value: number): void {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >> 8) & 0xff;
}

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

  const argsPayload = new Uint8Array(
    VALIDATE_FIXED_PREFIX_SIZE +
      authenticatorData.length +
      clientDataJSON.length +
      targetInstructionBytes.length
  );
  let offset = 0;

  writeU16LE(argsPayload, offset, walletAccountIdx);
  offset += 2;
  argsPayload[offset] = authIdx;
  offset += 1;
  argsPayload.set(signatureR, offset);
  offset += signatureR.length;
  argsPayload.set(signatureS, offset);
  offset += signatureS.length;
  writeU16LE(argsPayload, offset, authenticatorData.length);
  offset += 2;
  writeU16LE(argsPayload, offset, clientDataJSON.length);
  offset += 2;
  argsPayload.set(authenticatorData, offset);
  offset += authenticatorData.length;
  argsPayload.set(clientDataJSON, offset);
  offset += clientDataJSON.length;
  argsPayload.set(targetInstructionBytes, offset);

  return new PasskeyInstructionBuilder()
    .payload()
    .select('validate')
    .writePayload(argsPayload)
    .finish()
    .build();
}
