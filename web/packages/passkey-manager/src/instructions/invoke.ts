import {
  InvokeArgsBuilder,
  PasskeyInstructionBuilder,
} from '../abi/thru/program/passkey_manager/types';

export function encodeInvokeInstruction(
  programPubkey: Uint8Array,
  instruction: Uint8Array
): Uint8Array {
  if (programPubkey.length !== 32) {
    throw new Error('Program pubkey must be 32 bytes');
  }

  const argsPayload = new InvokeArgsBuilder()
    .set_program_pubkey(programPubkey)
    .instr().write(instruction).finish()
    .build();

  return new PasskeyInstructionBuilder()
    .payload()
    .select('invoke')
    .writePayload(argsPayload)
    .finish()
    .build();
}
