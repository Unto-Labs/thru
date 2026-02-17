/**
 * System Program instruction builders
 * Program pubkey: 0x00...01
 */

import { SYSTEM_PROGRAM } from "./constants";

/**
 * Build CREATE_EPHEMERAL instruction for System Program
 * Discriminant: 0x01
 * Format: [discriminant:1][target_idx:2][seed_len:8][seed:variable]
 */
export function buildCreateEphemeralInstruction(
  targetAccountIdx: number,
  derivedSeed: Uint8Array
): Uint8Array {
  const data = new Uint8Array(1 + 2 + 8 + derivedSeed.length);
  const view = new DataView(data.buffer);

  data[0] = 0x01; // CREATE_EPHEMERAL discriminant
  view.setUint16(1, targetAccountIdx, true);
  view.setBigUint64(3, BigInt(derivedSeed.length), true);
  data.set(derivedSeed, 11);

  return data;
}

/**
 * Build RESIZE instruction for System Program
 * Discriminant: 0x04
 * Format: [discriminant:1][target_idx:2][new_size:8]
 */
export function buildResizeInstruction(
  targetAccountIdx: number,
  newSize: bigint
): Uint8Array {
  const data = new Uint8Array(1 + 2 + 8);
  const view = new DataView(data.buffer);

  data[0] = 0x04; // RESIZE discriminant
  view.setUint16(1, targetAccountIdx, true);
  view.setBigUint64(3, newSize, true);

  return data;
}

/**
 * Build COMPRESS instruction for System Program
 * Discriminant: 0x05
 * Format: [discriminant:1][target_idx:2][state_proof:variable]
 */
export function buildCompressInstruction(
  targetAccountIdx: number,
  stateProof: Uint8Array
): Uint8Array {
  const data = new Uint8Array(1 + 2 + stateProof.length);

  data[0] = 0x05; // COMPRESS discriminant
  const view = new DataView(data.buffer);
  view.setUint16(1, targetAccountIdx, true);
  data.set(stateProof, 3);

  return data;
}

/**
 * Build DECOMPRESS2 instruction for System Program
 * Discriminant: 0x08
 * Format: [discriminant:1][target_idx:2][meta_idx:2][data_idx:2][data_offset:4][state_proof:variable]
 */
export function buildDecompress2Instruction(
  targetIdx: number,
  metaIdx: number,
  dataIdx: number,
  dataOffset: number,
  stateProof: Uint8Array
): Uint8Array {
  const data = new Uint8Array(1 + 2 + 2 + 2 + 4 + stateProof.length);
  const view = new DataView(data.buffer);

  data[0] = 0x08; // DECOMPRESS2 discriminant
  view.setUint16(1, targetIdx, true);
  view.setUint16(3, metaIdx, true);
  view.setUint16(5, dataIdx, true);
  view.setUint32(7, dataOffset, true);
  data.set(stateProof, 11);

  return data;
}

/**
 * Get sorted account indices for decompress operation
 * Returns [metaIdx, dataIdx, orderedAccounts] based on lexicographic ordering
 */
export function getDecompressAccountIndices(
  metaAccount: Uint8Array,
  dataAccount: Uint8Array
): { metaIdx: number; dataIdx: number; orderedAccounts: Uint8Array[] } {
  // If meta and data are the same account
  if (arraysEqual(metaAccount, dataAccount)) {
    return {
      metaIdx: 3,
      dataIdx: 3,
      orderedAccounts: [metaAccount],
    };
  }

  // Sort accounts lexicographically
  const cmp = compareBytes(metaAccount, dataAccount);
  if (cmp < 0) {
    // meta < data
    return {
      metaIdx: 3,
      dataIdx: 4,
      orderedAccounts: [metaAccount, dataAccount],
    };
  } else {
    // data < meta
    return {
      metaIdx: 4,
      dataIdx: 3,
      orderedAccounts: [dataAccount, metaAccount],
    };
  }
}

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const minLen = Math.min(a.length, b.length);
  for (let i = 0; i < minLen; i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return a.length - b.length;
}

function arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export { SYSTEM_PROGRAM };
