import { decodeAddress, encodeAddress } from '@thru/sdk/helpers';
import { BOOTSTRAP_PROGRAM_ADDRESSES } from '../bootstrap-addresses';
import { systemProgramPubkey } from '../utils/helpers';
import {
  InstructionData,
  InstructionDataBuilder,
} from './abi/thru/common/primitives/types';
import {
  MulticallArgs,
  MulticallArgsBuilder,
} from './abi/thru/program/multicall/types';

export {
  InstructionData,
  InstructionDataBuilder,
} from './abi/thru/common/primitives/types';
export {
  MulticallArgs,
  MulticallArgsBuilder,
  MulticallError,
} from './abi/thru/program/multicall/types';

export type MulticallCall = {
  programIdx: number;
  instructionData: Uint8Array;
};

/** Genesis Multicall remains available on networks that do not run bootstrap. */
export const GENESIS_MULTICALL_PROGRAM_PUBKEY = systemProgramPubkey(0x09);
export const GENESIS_MULTICALL_PROGRAM_ADDRESS = encodeAddress(
  GENESIS_MULTICALL_PROGRAM_PUBKEY,
);

export const MULTICALL_PROGRAM_ADDRESS = BOOTSTRAP_PROGRAM_ADDRESSES.multicall;
export const MULTICALL_PROGRAM_PUBKEY = decodeAddress(
  MULTICALL_PROGRAM_ADDRESS,
);

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
  const output = new MulticallArgsBuilder().set_calls(encodedCalls).build();

  const validation = MulticallArgs.validate(output);
  if (!validation.ok || validation.consumed !== output.length) {
    throw new Error(
      `generated MulticallArgs failed validation (code=${validation.code ?? 'unknown'})`
    );
  }

  return output;
}
