/**
 * EOA (externally-owned account) program instruction and authorization-message
 * builders.
 *
 * The EOA program is a built-in program whose address is all zeros
 * ({@link EOA_PROGRAM_ADDRESS}). Creating or deleting an EOA requires an
 * Ed25519 signature by the EOA's *own* key over a canonical, domain-separated
 * authorization message (see {@link buildEOACreateMessage} /
 * {@link buildEOADeleteMessage}). That message is signed **raw** with
 * PureEd25519 — it is short enough (82 bytes) that it is NOT pre-hashed, unlike
 * the outer transaction signature. The resulting 64-byte signature is embedded
 * in the instruction via {@link buildCreateEOAInstruction} /
 * {@link buildDeleteEOAInstruction}.
 *
 * The byte layouts here are byte-identical to what the runtime constructs
 * (tn_vm_syscall_account_create_eoa / tn_vm_syscall_account_delete) and to the
 * Rust/Go builders, so a signature produced against these messages is accepted
 * on chain. This makes them suitable for a bring-your-own-signer custody
 * partner that holds the EOA key in an HSM/MPC backend.
 */

import { SignatureDomain, signatureDomainDST } from "../transactions/domain-signing";

/** Ed25519 public-key width used by the EOA authorization layout. */
const EOA_PUBKEY_SIZE = 32;

/**
 * Assert `chainId` fits in `u16` (JS `setUint16` silently truncates otherwise)
 * and both pubkeys are exactly 32 bytes (`Uint8Array.set` silently zero-pads
 * a short source). Either footgun would produce a well-formed 82-byte message
 * that a stock Ed25519 signer will happily sign but the runtime rejects --
 * detect it at build time instead.
 */
function validateEOAMessageInputs(
  chainId: number,
  feePayer: Uint8Array,
  eoa: Uint8Array,
): void {
  if (!Number.isInteger(chainId) || chainId < 0 || chainId > 0xffff) {
    throw new RangeError(
      `chainId must be an integer in [0, 65535]; got ${chainId}`,
    );
  }
  if (feePayer.length !== EOA_PUBKEY_SIZE) {
    throw new Error(`feePayer must be ${EOA_PUBKEY_SIZE} bytes; got ${feePayer.length}`);
  }
  if (eoa.length !== EOA_PUBKEY_SIZE) {
    throw new Error(`eoa must be ${EOA_PUBKEY_SIZE} bytes; got ${eoa.length}`);
  }
}

/** EOA program address: all zeros (32 bytes). */
export const EOA_PROGRAM_ADDRESS: Uint8Array = new Uint8Array(32);

/** EOA program instruction discriminants (tn_eoa_program.h). */
export const EOA_INSTRUCTION_CREATE_ACCOUNT = 0;
export const EOA_INSTRUCTION_TRANSFER = 1;
export const EOA_INSTRUCTION_DELETE_ACCOUNT = 2;

/**
 * ASCII domain-separation tag for the EOA create authorization message.
 * Sourced from the shared DST table so this file and the C enum entry stay
 * lock-step.
 */
const EOA_CREATE_MSG_TAG = signatureDomainDST(SignatureDomain.EOA_CREATE);

/**
 * Total size of the EOA create authorization message:
 * tag(16) + chain_id(2) + fee_payer(32) + eoa(32) = 82 bytes.
 */
export const EOA_CREATE_MSG_SIZE = 16 + 2 + 32 + 32;

/**
 * Build the canonical domain-separated EOA create authorization message:
 * `"tn_eoa_create_v1" || chain_id || fee_payer || eoa`.
 *
 * chain_id is encoded little-endian. The result is byte-identical to what the
 * runtime constructs in tn_vm_syscall_account_create_eoa and to the Rust/Go
 * builders. The EOA's private key signs this message **raw** (PureEd25519, no
 * pre-hash); the resulting 64-byte signature is passed to
 * {@link buildCreateEOAInstruction}.
 */
export function buildEOACreateMessage(
  chainId: number,
  feePayer: Uint8Array,
  eoa: Uint8Array
): Uint8Array {
  validateEOAMessageInputs(chainId, feePayer, eoa);
  const msg = new Uint8Array(EOA_CREATE_MSG_SIZE);
  const view = new DataView(msg.buffer);
  msg.set(EOA_CREATE_MSG_TAG, 0);
  view.setUint16(16, chainId, true);
  msg.set(feePayer, 18);
  msg.set(eoa, 50);
  return msg;
}

/**
 * ASCII domain-separation tag for the EOA delete authorization message.
 * Sourced from the shared DST table so this file and the C enum entry stay
 * lock-step.
 */
const EOA_DELETE_MSG_TAG = signatureDomainDST(SignatureDomain.EOA_DELETE);

/**
 * Total size of the EOA delete authorization message:
 * tag(16) + chain_id(2) + fee_payer(32) + eoa(32) = 82 bytes.
 */
export const EOA_DELETE_MSG_SIZE = 16 + 2 + 32 + 32;

/**
 * Build the canonical domain-separated EOA delete authorization message:
 * `"tn_eoa_delete_v1" || chain_id || fee_payer || eoa`.
 *
 * chain_id is encoded little-endian. The result must be byte-identical to what
 * the runtime constructs in tn_vm_syscall_account_delete and to the Rust/Go
 * builders. The EOA's private key signs this message raw; the resulting
 * signature is passed to {@link buildDeleteEOAInstruction}.
 */
export function buildEOADeleteMessage(
  chainId: number,
  feePayer: Uint8Array,
  eoa: Uint8Array
): Uint8Array {
  validateEOAMessageInputs(chainId, feePayer, eoa);
  const msg = new Uint8Array(EOA_DELETE_MSG_SIZE);
  const view = new DataView(msg.buffer);
  msg.set(EOA_DELETE_MSG_TAG, 0);
  view.setUint16(16, chainId, true);
  msg.set(feePayer, 18);
  msg.set(eoa, 50);
  return msg;
}

/**
 * Build the CREATE_ACCOUNT instruction for the EOA program.
 *
 * Discriminant: 0. Wire format:
 * `[discriminant:4][proof_size:8][eoa_account_idx:2][signature:64][proof:variable]`
 *
 * `signature` is the EOA key's signature over the message from
 * {@link buildEOACreateMessage}. `eoaAccountIdx` is the index of the new EOA in
 * the transaction's account list (accounts are ordered
 * `[feePayer, program, ...readWrite, ...readOnly]`). When `proofData` is empty
 * the runtime re-creates a deleted (still-active) tombstone without a proof.
 */
export function buildCreateEOAInstruction(
  eoaAccountIdx: number,
  signature: Uint8Array,
  proofData: Uint8Array
): Uint8Array {
  const data = new Uint8Array(4 + 8 + 2 + 64 + proofData.length);
  const view = new DataView(data.buffer);

  // discriminant = 0 (CREATE_ACCOUNT)
  view.setUint32(0, EOA_INSTRUCTION_CREATE_ACCOUNT, true);
  // proof_size
  view.setBigUint64(4, BigInt(proofData.length), true);
  // eoa_account_idx
  view.setUint16(12, eoaAccountIdx, true);
  // signature (64 bytes)
  data.set(signature, 14);
  // proof data
  data.set(proofData, 78);

  return data;
}

/**
 * Build the DELETE_ACCOUNT instruction for the EOA program.
 *
 * Discriminant: 2. Wire format:
 * `[discriminant:4][eoa_account_idx:2][signature:64]`
 *
 * The runtime verifies `signature` over the message from
 * {@link buildEOADeleteMessage} before deleting the (unused) EOA at
 * `eoaAccountIdx`.
 */
export function buildDeleteEOAInstruction(
  eoaAccountIdx: number,
  signature: Uint8Array
): Uint8Array {
  const data = new Uint8Array(4 + 2 + 64);
  const view = new DataView(data.buffer);

  // discriminant = 2 (DELETE_ACCOUNT)
  view.setUint32(0, EOA_INSTRUCTION_DELETE_ACCOUNT, true);
  // eoa_account_idx
  view.setUint16(4, eoaAccountIdx, true);
  // signature (64 bytes)
  data.set(signature, 6);

  return data;
}
