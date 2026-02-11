export function concatenateInstructions(instructions: Uint8Array[]): Uint8Array {
  const totalLength = instructions.reduce((sum, instr) => sum + instr.length, 0);
  const result = new Uint8Array(totalLength);

  let offset = 0;
  for (const instr of instructions) {
    result.set(instr, offset);
    offset += instr.length;
  }

  return result;
}
