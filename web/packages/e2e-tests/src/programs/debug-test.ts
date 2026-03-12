/**
 * Debug test program instruction builders.
 *
 * Two copies of the debug test program are deployed at:
 *   Program A: 0x00...EB
 *   Program B: 0x00...EC
 * A scratch account lives at 0x00...ED (owned by program A).
 *
 * Instruction layout (10 + message bytes):
 *   command(1) + invoke_idx(2) + return_idx(2) + depth(1) + error_code(4) + message(variable, max 48)
 */

// Program pubkeys
export const DEBUG_TEST_PROGRAM_A = (() => {
  const pk = new Uint8Array(32);
  pk[31] = 0xeb;
  return pk;
})();

export const DEBUG_TEST_PROGRAM_B = (() => {
  const pk = new Uint8Array(32);
  pk[31] = 0xec;
  return pk;
})();

export const DEBUG_TEST_SCRATCH = (() => {
  const pk = new Uint8Array(32);
  pk[31] = 0xed;
  return pk;
})();

// Command constants
const CMD_PRINT_AND_SUCCEED = 0;
const CMD_PRINT_AND_REVERT = 1;
const CMD_SEGFAULT = 2;
const CMD_EXHAUST_CU = 3;
const CMD_RECURSIVE_CPI = 4;
const CMD_EMIT_EVENTS_THEN_REVERT = 5;
const CMD_RECURSIVE_CPI_REVERT = 8;
const CMD_WRITE_SCRATCH = 9;

// Transaction constants
export const DEBUG_TEST_CU = 10_000_000;
export const DEBUG_TEST_SU = 10_000;
export const DEBUG_TEST_MU = 100;
export const DEBUG_TEST_EXPIRY = 100_000;

function buildDebugTestInstruction(
  command: number,
  invokeIdx: number,
  returnIdx: number,
  depth: number,
  errorCode: number,
  message: string
): Uint8Array {
  const msgBytes = new TextEncoder().encode(message).slice(0, 48);
  const instr = new Uint8Array(10 + msgBytes.length);
  const view = new DataView(instr.buffer);

  instr[0] = command;
  view.setUint16(1, invokeIdx, true);
  view.setUint16(3, returnIdx, true);
  instr[5] = depth;
  view.setUint32(6, errorCode, true);
  instr.set(msgBytes, 10);

  return instr;
}

/** Builds instruction for a transaction that prints a message and succeeds. */
export function buildDebugTestSuccessInstruction(message: string): Uint8Array {
  return buildDebugTestInstruction(CMD_PRINT_AND_SUCCEED, 0, 0, 0, 0, message);
}

/** Builds instruction for a transaction that reverts with the given error code. */
export function buildDebugTestRevertInstruction(errorCode: number): Uint8Array {
  return buildDebugTestInstruction(CMD_PRINT_AND_REVERT, 0, 0, 0, errorCode, "");
}

/** Builds instruction for a transaction that dereferences address 0xDEAD (segfault). */
export function buildDebugTestSegfaultInstruction(): Uint8Array {
  return buildDebugTestInstruction(CMD_SEGFAULT, 0, 0, 0, 0, "");
}

/** Builds instruction for a transaction that loops until CU exhaustion. */
export function buildDebugTestExhaustCUInstruction(): Uint8Array {
  return buildDebugTestInstruction(CMD_EXHAUST_CU, 0, 0, 0, 0, "");
}

/**
 * Builds instruction for recursive CPI.
 * invoke_idx=2 (program B at account index 2), return_idx=1 (program A at index 1).
 */
export function buildDebugTestRecursiveCPIInstruction(depth: number): Uint8Array {
  return buildDebugTestInstruction(CMD_RECURSIVE_CPI, 2, 1, depth, 0, "");
}

/**
 * Builds instruction for recursive CPI that reverts at the leaf.
 * invoke_idx=2 (program B at account index 2), return_idx=1 (program A at index 1).
 */
export function buildDebugTestRecursiveCPIRevertInstruction(depth: number, errorCode: number): Uint8Array {
  return buildDebugTestInstruction(CMD_RECURSIVE_CPI_REVERT, 2, 1, depth, errorCode, "");
}

/** Builds instruction for emitting N events then reverting. */
export function buildDebugTestEmitEventsThenRevertInstruction(eventCount: number, errorCode: number): Uint8Array {
  return buildDebugTestInstruction(CMD_EMIT_EVENTS_THEN_REVERT, 0, 0, eventCount, errorCode, "");
}

/** Builds instruction for writing a fill byte pattern to the scratch account (0xED). */
export function buildDebugTestWriteScratchInstruction(fillByte: number): Uint8Array {
  return buildDebugTestInstruction(CMD_WRITE_SCRATCH, 0, 0, fillByte, 0, "");
}
