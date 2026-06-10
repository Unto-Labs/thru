import { encodeAddress } from '@thru/sdk/helpers';
import {
  InstructionData,
  InstructionDataBuilder,
} from './abi/thru/common/primitives/types';
import { MulticallArgs } from './abi/thru/program/multicall/types';

export {
  InstructionData,
  InstructionDataBuilder,
} from './abi/thru/common/primitives/types';
export {
  MulticallArgs,
  MulticallError,
} from './abi/thru/program/multicall/types';

export type MulticallCall = {
  programIdx: number;
  instructionData: Uint8Array;
};

export const MULTICALL_PROGRAM_PUBKEY = new Uint8Array([
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 9,
]);

export const MULTICALL_PROGRAM_ADDRESS = encodeAddress(MULTICALL_PROGRAM_PUBKEY);

function writeU16LE(target: Uint8Array, offset: number, value: number): void {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >> 8) & 0xff;
}

function assertProgramIdx(programIdx: number): void {
  if (!Number.isInteger(programIdx) || programIdx < 0 || programIdx > 0xffff) {
    throw new Error('programIdx must be 0-65535');
  }
}

function buildInstructionData(call: MulticallCall): Uint8Array {
  assertProgramIdx(call.programIdx);
  if (!(call.instructionData instanceof Uint8Array)) {
    throw new Error('instructionData must be a Uint8Array');
  }

  const builder = new InstructionDataBuilder();
  builder.set_program_idx(call.programIdx);
  builder.data().write(call.instructionData).finish();
  const buffer = builder.build();
  const view = InstructionData.from_array(buffer);
  if (!view) {
    throw new Error('generated InstructionData failed validation');
  }
  return buffer;
}

export function buildMulticallInstruction(calls: MulticallCall[]): Uint8Array {
  if (!Array.isArray(calls)) throw new Error('calls must be an array');
  if (calls.length > 0xffff) throw new Error('calls length must be 0-65535');

  const encodedCalls = calls.map(buildInstructionData);
  const totalLength = 2 + encodedCalls.reduce((sum, call) => sum + call.length, 0);

  const output = new Uint8Array(totalLength);
  let offset = 0;
  writeU16LE(output, offset, calls.length);
  offset += 2;

  for (const call of encodedCalls) {
    output.set(call, offset);
    offset += call.length;
  }

  const validation = MulticallArgs.validate(output);
  if (!validation.ok || validation.consumed !== output.length) {
    throw new Error(
      `generated MulticallArgs failed validation (code=${validation.code ?? 'unknown'})`
    );
  }

  return output;
}
