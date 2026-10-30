import {
  InstructionData,
  InstructionDataBuilder,
} from './abi/thru/common/primitives/types';
import type { TargetInstructionParams } from './types';

export function buildTargetInstructionBytes({
  programIdx,
  instructionData,
}: TargetInstructionParams): Uint8Array {
  if (!Number.isInteger(programIdx) || programIdx < 0 || programIdx > 0xffff) {
    throw new Error('programIdx must be 0-65535');
  }
  if (!(instructionData instanceof Uint8Array)) {
    throw new Error('instructionData must be a Uint8Array');
  }

  const builder = new InstructionDataBuilder();
  builder.set_program_idx(programIdx);
  builder.data().write(instructionData).finish();

  const buffer = builder.build();
  const view = InstructionData.from_array(buffer);
  if (!view) {
    throw new Error('generated InstructionData failed validation');
  }

  return buffer;
}
