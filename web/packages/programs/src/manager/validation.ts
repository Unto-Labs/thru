import {
  MANAGER_PROGRAM_IMAGE_HEADER_SIZE,
  MANAGER_PROGRAM_IMAGE_MIN_TEXT_SIZE,
  MANAGER_PROGRAM_IMAGE_TRAILER_SIZE,
  MANAGER_PROGRAM_IMAGE_VERSION,
} from './constants';

export function validateManagerProgramImage(program: Uint8Array): void {
  if (!(program instanceof Uint8Array)) {
    throw new Error('program must be a Uint8Array');
  }
  const minimumSize =
    MANAGER_PROGRAM_IMAGE_HEADER_SIZE +
    MANAGER_PROGRAM_IMAGE_MIN_TEXT_SIZE +
    MANAGER_PROGRAM_IMAGE_TRAILER_SIZE;
  if (program.length < minimumSize) {
    throw new Error(
      `program image must be at least ${minimumSize} bytes, got ${program.length}`
    );
  }
  if (program[0] !== MANAGER_PROGRAM_IMAGE_VERSION) {
    throw new Error(
      `program image version must be ${MANAGER_PROGRAM_IMAGE_VERSION}`
    );
  }
  for (
    let index = program.length - MANAGER_PROGRAM_IMAGE_TRAILER_SIZE;
    index < program.length;
    index++
  ) {
    if (program[index] !== 0) {
      throw new Error('program image must end in an eight-byte zero trailer');
    }
  }
}
