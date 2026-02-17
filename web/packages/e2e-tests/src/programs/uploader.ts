/**
 * Uploader Program instruction builders
 * Program pubkey: 0x00...02
 */

import { UPLOADER_PROGRAM } from "./constants";

export { UPLOADER_PROGRAM };

// Constants
export const UPLOADER_EXPIRY = 10_000;
export const UPLOADER_STATE_UNITS = 10_000;
export const UPLOADER_MEMORY_UNITS = 10_000;
export const UPLOADER_COMPUTE_BASE = 50_000;
export const UPLOADER_WRITE_COMPUTE = 500_000_000;

/**
 * Compare two Uint8Arrays lexicographically
 */
function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const minLen = Math.min(a.length, b.length);
  for (let i = 0; i < minLen; i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return a.length - b.length;
}

/**
 * Get ordered account indices for meta and buffer accounts.
 * Returns [metaIdx, bufferIdx, orderedAccounts]
 */
export function getOrderedAccountIndices(
  metaAccount: Uint8Array,
  bufferAccount: Uint8Array
): { metaIdx: number; bufferIdx: number; orderedAccounts: Uint8Array[] } {
  if (compareBytes(metaAccount, bufferAccount) < 0) {
    // meta < buffer: add meta first
    return {
      metaIdx: 2,
      bufferIdx: 3,
      orderedAccounts: [metaAccount, bufferAccount],
    };
  } else {
    // buffer < meta: add buffer first
    return {
      metaIdx: 3,
      bufferIdx: 2,
      orderedAccounts: [bufferAccount, metaAccount],
    };
  }
}

/**
 * Build CREATE instruction for Uploader Program
 * Discriminant: 0x00
 * Format: [discriminant:4][buffer_idx:2][meta_idx:2][authority_idx:2][buffer_size:4][expected_hash:32][seed_len:4][seed:variable]
 */
export function buildUploaderCreateInstruction(
  bufferIdx: number,
  metaIdx: number,
  authorityIdx: number,
  bufferSize: number,
  expectedHash: Uint8Array,
  seed: Uint8Array
): Uint8Array {
  const instrLen = 4 + 2 + 2 + 2 + 4 + 32 + 4 + seed.length;
  const data = new Uint8Array(instrLen);
  const view = new DataView(data.buffer);

  view.setUint32(0, 0x00, true); // CREATE discriminant
  view.setUint16(4, bufferIdx, true);
  view.setUint16(6, metaIdx, true);
  view.setUint16(8, authorityIdx, true);
  view.setUint32(10, bufferSize, true);
  data.set(expectedHash, 14);
  view.setUint32(46, seed.length, true);
  data.set(seed, 50);

  return data;
}

/**
 * Build WRITE instruction for Uploader Program
 * Discriminant: 0x01
 * Format: [discriminant:4][buffer_idx:2][meta_idx:2][data_len:4][data_offset:4][data:variable]
 */
export function buildUploaderWriteInstruction(
  bufferIdx: number,
  metaIdx: number,
  offset: number,
  writeData: Uint8Array
): Uint8Array {
  const instrLen = 4 + 2 + 2 + 4 + 4 + writeData.length;
  const data = new Uint8Array(instrLen);
  const view = new DataView(data.buffer);

  view.setUint32(0, 0x01, true); // WRITE discriminant
  view.setUint16(4, bufferIdx, true);
  view.setUint16(6, metaIdx, true);
  view.setUint32(8, writeData.length, true);
  view.setUint32(12, offset, true);
  data.set(writeData, 16);

  return data;
}

/**
 * Build DESTROY instruction for Uploader Program
 * Discriminant: 0x02
 * Format: [discriminant:4][buffer_idx:2][meta_idx:2]
 */
export function buildUploaderDestroyInstruction(
  bufferIdx: number,
  metaIdx: number
): Uint8Array {
  const data = new Uint8Array(4 + 2 + 2);
  const view = new DataView(data.buffer);

  view.setUint32(0, 0x02, true); // DESTROY discriminant
  view.setUint16(4, bufferIdx, true);
  view.setUint16(6, metaIdx, true);

  return data;
}

/**
 * Build FINALIZE instruction for Uploader Program
 * Discriminant: 0x03
 * Format: [discriminant:4][buffer_idx:2][meta_idx:2][expected_hash:32]
 */
export function buildUploaderFinalizeInstruction(
  bufferIdx: number,
  metaIdx: number,
  expectedHash: Uint8Array
): Uint8Array {
  const data = new Uint8Array(4 + 2 + 2 + 32);
  const view = new DataView(data.buffer);

  view.setUint32(0, 0x03, true); // FINALIZE discriminant
  view.setUint16(4, bufferIdx, true);
  view.setUint16(6, metaIdx, true);
  data.set(expectedHash, 8);

  return data;
}

/**
 * Calculate compute units for CREATE operation
 */
export function computeUnitsForCreate(bufferSize: number): number {
  return UPLOADER_COMPUTE_BASE + 2 * bufferSize;
}

/**
 * Calculate compute units for FINALIZE operation
 */
export function computeUnitsForFinalize(bufferSize: number): number {
  return UPLOADER_COMPUTE_BASE + 200 * bufferSize;
}
