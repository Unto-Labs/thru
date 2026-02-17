/**
 * Manager Program instruction builders
 * Program pubkey: 0x00...04
 */

import { MANAGER_PROGRAM } from "./constants";

// Discriminants
const CREATE_PERMANENT_DISCRIMINANT = 0x00;
const CREATE_EPHEMERAL_DISCRIMINANT = 0x01;
const UPGRADE_DISCRIMINANT = 0x02;
const SET_PAUSE_DISCRIMINANT = 0x03;
const DESTROY_DISCRIMINANT = 0x04;
const FINALIZE_DISCRIMINANT = 0x05;
const SET_AUTHORITY_DISCRIMINANT = 0x06;
const CLAIM_AUTHORITY_DISCRIMINANT = 0x07;

// Constants
export const MANAGER_EXPIRY = 10_000;
export const MANAGER_STATE_UNITS = 10_000;
export const MANAGER_MEMORY_UNITS = 10_000;
export const MANAGER_COMPUTE_BASE = 100_000;
export const MANAGER_CREATE_COMPUTE = 500_000_000;

// Manager meta states
export const MANAGER_STATE_OPEN = 0;
export const MANAGER_STATE_PAUSED = 1;
export const MANAGER_STATE_FINALIZED = 2;

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
 * Sort accounts and assign indices for manager program.
 * RW accounts start at index 2 (after fee payer and program).
 * RO accounts come after RW accounts.
 */
export function managerSortAccounts(
  metaAccount: Uint8Array,
  programAccount: Uint8Array,
  srcbufAccount: Uint8Array | null
): {
  metaIdx: number;
  programIdx: number;
  srcbufIdx: number;
  rwAccounts: Uint8Array[];
  roAccounts: Uint8Array[];
} {
  // Sort RW accounts (meta and program)
  const rwNamed: Array<{ pk: Uint8Array; name: string }> = [
    { pk: metaAccount, name: "meta" },
    { pk: programAccount, name: "program" },
  ];
  rwNamed.sort((a, b) => compareBytes(a.pk, b.pk));

  // Build account lists and assign indices
  let metaIdx = 0;
  let programIdx = 0;
  let srcbufIdx = 0;
  const rwAccounts: Uint8Array[] = [];
  const roAccounts: Uint8Array[] = [];

  let idx = 2; // Start after fee payer and program
  for (const acc of rwNamed) {
    rwAccounts.push(acc.pk);
    if (acc.name === "meta") metaIdx = idx;
    if (acc.name === "program") programIdx = idx;
    idx++;
  }

  // RO accounts come after RW
  if (srcbufAccount) {
    roAccounts.push(srcbufAccount);
    srcbufIdx = idx;
  }

  return { metaIdx, programIdx, srcbufIdx, rwAccounts, roAccounts };
}

/**
 * Build CREATE_EPHEMERAL instruction for Manager Program
 * Discriminant: 0x01
 */
export function buildManagerCreateEphemeralInstruction(
  metaIdx: number,
  programIdx: number,
  srcbufIdx: number,
  srcbufOffset: number,
  srcbufSize: number,
  authorityIdx: number,
  seed: Uint8Array
): Uint8Array {
  const instrLen = 1 + 2 + 2 + 2 + 4 + 4 + 2 + 4 + seed.length;
  const data = new Uint8Array(instrLen);
  const view = new DataView(data.buffer);

  data[0] = CREATE_EPHEMERAL_DISCRIMINANT;
  view.setUint16(1, metaIdx, true);
  view.setUint16(3, programIdx, true);
  view.setUint16(5, srcbufIdx, true);
  view.setUint32(7, srcbufOffset, true);
  view.setUint32(11, srcbufSize, true);
  view.setUint16(15, authorityIdx, true);
  view.setUint32(17, seed.length, true);
  data.set(seed, 21);

  return data;
}

/**
 * Build CREATE_PERMANENT instruction for Manager Program
 * Discriminant: 0x00
 */
export function buildManagerCreatePermanentInstruction(
  metaIdx: number,
  programIdx: number,
  srcbufIdx: number,
  srcbufOffset: number,
  srcbufSize: number,
  authorityIdx: number,
  seed: Uint8Array,
  metaProof: Uint8Array,
  programProof: Uint8Array
): Uint8Array {
  const instrLen =
    1 + 2 + 2 + 2 + 4 + 4 + 2 + 4 + seed.length + metaProof.length + programProof.length;
  const data = new Uint8Array(instrLen);
  const view = new DataView(data.buffer);

  let offset = 0;
  data[offset] = CREATE_PERMANENT_DISCRIMINANT;
  offset++;
  view.setUint16(offset, metaIdx, true);
  offset += 2;
  view.setUint16(offset, programIdx, true);
  offset += 2;
  view.setUint16(offset, srcbufIdx, true);
  offset += 2;
  view.setUint32(offset, srcbufOffset, true);
  offset += 4;
  view.setUint32(offset, srcbufSize, true);
  offset += 4;
  view.setUint16(offset, authorityIdx, true);
  offset += 2;
  view.setUint32(offset, seed.length, true);
  offset += 4;
  data.set(seed, offset);
  offset += seed.length;
  data.set(metaProof, offset);
  offset += metaProof.length;
  data.set(programProof, offset);

  return data;
}

/**
 * Build UPGRADE instruction for Manager Program
 * Discriminant: 0x02
 */
export function buildManagerUpgradeInstruction(
  metaIdx: number,
  programIdx: number,
  srcbufIdx: number,
  srcbufOffset: number,
  srcbufSize: number
): Uint8Array {
  const data = new Uint8Array(1 + 2 + 2 + 2 + 4 + 4);
  const view = new DataView(data.buffer);

  data[0] = UPGRADE_DISCRIMINANT;
  view.setUint16(1, metaIdx, true);
  view.setUint16(3, programIdx, true);
  view.setUint16(5, srcbufIdx, true);
  view.setUint32(7, srcbufOffset, true);
  view.setUint32(11, srcbufSize, true);

  return data;
}

/**
 * Build SET_PAUSE instruction for Manager Program
 * Discriminant: 0x03
 */
export function buildManagerSetPauseInstruction(
  metaIdx: number,
  programIdx: number,
  isPaused: boolean
): Uint8Array {
  const data = new Uint8Array(1 + 2 + 2 + 1);
  const view = new DataView(data.buffer);

  data[0] = SET_PAUSE_DISCRIMINANT;
  view.setUint16(1, metaIdx, true);
  view.setUint16(3, programIdx, true);
  data[5] = isPaused ? 1 : 0;

  return data;
}

/**
 * Build DESTROY instruction for Manager Program
 * Discriminant: 0x04
 */
export function buildManagerDestroyInstruction(
  metaIdx: number,
  programIdx: number
): Uint8Array {
  const data = new Uint8Array(1 + 2 + 2);
  const view = new DataView(data.buffer);

  data[0] = DESTROY_DISCRIMINANT;
  view.setUint16(1, metaIdx, true);
  view.setUint16(3, programIdx, true);

  return data;
}

/**
 * Build FINALIZE instruction for Manager Program
 * Discriminant: 0x05
 */
export function buildManagerFinalizeInstruction(
  metaIdx: number,
  programIdx: number
): Uint8Array {
  const data = new Uint8Array(1 + 2 + 2);
  const view = new DataView(data.buffer);

  data[0] = FINALIZE_DISCRIMINANT;
  view.setUint16(1, metaIdx, true);
  view.setUint16(3, programIdx, true);

  return data;
}

/**
 * Build SET_AUTHORITY instruction for Manager Program
 * Discriminant: 0x06
 */
export function buildManagerSetAuthorityInstruction(
  metaIdx: number,
  programIdx: number,
  newAuthority: Uint8Array
): Uint8Array {
  const data = new Uint8Array(1 + 2 + 2 + 32);
  const view = new DataView(data.buffer);

  data[0] = SET_AUTHORITY_DISCRIMINANT;
  view.setUint16(1, metaIdx, true);
  view.setUint16(3, programIdx, true);
  data.set(newAuthority, 5);

  return data;
}

/**
 * Build CLAIM_AUTHORITY instruction for Manager Program
 * Discriminant: 0x07
 */
export function buildManagerClaimAuthorityInstruction(
  metaIdx: number,
  programIdx: number
): Uint8Array {
  const data = new Uint8Array(1 + 2 + 2);
  const view = new DataView(data.buffer);

  data[0] = CLAIM_AUTHORITY_DISCRIMINANT;
  view.setUint16(1, metaIdx, true);
  view.setUint16(3, programIdx, true);

  return data;
}

/**
 * Calculate compute units for UPGRADE operation
 */
export function computeUnitsForUpgrade(srcbufSize: number): number {
  return MANAGER_COMPUTE_BASE + 2 * srcbufSize;
}

export { MANAGER_PROGRAM };
