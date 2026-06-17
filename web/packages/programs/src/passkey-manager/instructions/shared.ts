export function concatenateInstructions(instructions: Uint8Array[]): Uint8Array {
  const totalLength = instructions.reduce(
    (sum, instruction) => sum + instruction.length,
    0,
  );
  const result = new Uint8Array(totalLength);

  let offset = 0;
  for (const instruction of instructions) {
    result.set(instruction, offset);
    offset += instruction.length;
  }

  return result;
}
