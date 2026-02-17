/**
 * Test Uploader Program instruction builders
 * Program pubkey: 0x00...03 (NOOP_PROGRAM)
 */

import { TEST_UPLOADER_PROGRAM } from "./constants";

/**
 * Build CREATE instruction for Test Uploader Program
 * Discriminant: 0x00
 * Format: [discriminant:1][target_idx:2][is_ephemeral:1][account_size:4][seed_len:4][seed:variable][state_proof:variable]
 */
export function buildTestUploaderCreateInstruction(
  targetAccountIdx: number,
  accountSize: number,
  derivedSeed: Uint8Array,
  isEphemeral: boolean,
  stateProof: Uint8Array
): Uint8Array {
  const data = new Uint8Array(1 + 2 + 1 + 4 + 4 + derivedSeed.length + stateProof.length);
  const view = new DataView(data.buffer);

  data[0] = 0x00; // CREATE discriminant
  view.setUint16(1, targetAccountIdx, true);
  data[3] = isEphemeral ? 1 : 0;
  view.setUint32(4, accountSize, true);
  view.setUint32(8, derivedSeed.length, true);
  data.set(derivedSeed, 12);
  data.set(stateProof, 12 + derivedSeed.length);

  return data;
}

/**
 * Build WRITE instruction for Test Uploader Program
 * Discriminant: 0x01
 * Format: [discriminant:1][target_idx:2][offset:4][data_len:4][data:variable]
 */
export function buildTestUploaderWriteInstruction(
  targetAccountIdx: number,
  offset: number,
  writeData: Uint8Array
): Uint8Array {
  const data = new Uint8Array(1 + 2 + 4 + 4 + writeData.length);
  const view = new DataView(data.buffer);

  data[0] = 0x01; // WRITE discriminant
  view.setUint16(1, targetAccountIdx, true);
  view.setUint32(3, offset, true);
  view.setUint32(7, writeData.length, true);
  data.set(writeData, 11);

  return data;
}

/**
 * Build RESIZE instruction for Test Uploader Program
 * Discriminant: 0x02
 * Format: [discriminant:1][target_idx:2][new_size:4]
 */
export function buildTestUploaderResizeInstruction(
  targetAccountIdx: number,
  newSize: number
): Uint8Array {
  const data = new Uint8Array(1 + 2 + 4);
  const view = new DataView(data.buffer);

  data[0] = 0x02; // RESIZE discriminant
  view.setUint16(1, targetAccountIdx, true);
  view.setUint32(3, newSize, true);

  return data;
}

/**
 * Build FINALIZE instruction for Test Uploader Program
 * Discriminant: 0x03
 * Format: [discriminant:1][target_idx:2]
 */
export function buildTestUploaderFinalizeInstruction(
  targetAccountIdx: number
): Uint8Array {
  const data = new Uint8Array(1 + 2);
  const view = new DataView(data.buffer);

  data[0] = 0x03; // FINALIZE discriminant
  view.setUint16(1, targetAccountIdx, true);

  return data;
}

/**
 * Build DESTROY instruction for Test Uploader Program
 * Note: The Go code uses discriminant 0x02 for destroy, not 0x04
 * Actually looking at the Go constants:
 * - uploaderProgramDestroyDiscriminant  = uint32(0x02)
 * But wait, that conflicts with RESIZE. Let me check the actual usage...
 *
 * Looking at the Go code again:
 * - Test uploader uses: 0x00 create, 0x01 write, 0x02 resize, 0x03 finalize
 * - The uploader program (different) uses: 0x00 create, 0x01 write, 0x02 destroy, 0x03 finalize
 *
 * For test uploader (NOOP at 0x03), there's no explicit destroy in the Go transactions.go
 * The DESTROY is only for the uploader program at 0x02.
 */

export { TEST_UPLOADER_PROGRAM };
