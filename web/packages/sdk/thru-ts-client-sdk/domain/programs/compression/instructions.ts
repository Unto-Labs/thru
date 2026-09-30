import { CompressArgsBuilder, DecompressArgsBuilder, CompressFromPointerArgsBuilder,
  DecompressFromPointerArgsBuilder, CompressionInstructionBuilder } from "./abi/thru/program/compression/types";
import { StateProof } from "./abi/thru/blockchain/state_proof/types";
export { CompressionInstruction } from "./abi/thru/program/compression/types";

export const COMPRESSION_ERRORS = { INVALID_INSTRUCTION: 1n, INVALID_INSTRUCTION_DATA_SIZE: 2n } as const;

function u16(value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) throw new RangeError("account index must be a u16");
}
function u64(value: bigint): bigint {
  if (value < 0n || value > 0xffffffffffffffffn) throw new RangeError("value must be a u64");
  return value;
}
function envelope(variant: "compress" | "decompress" | "compress_from_pointer" | "decompress_from_pointer", payload: Uint8Array): Uint8Array {
  return new CompressionInstructionBuilder().payload().select(variant).writePayload(payload).finish().build();
}

/** Validate the exact state-proof footprint encoded in its type and path bitmap. */
export function validateCompressionProof(proof: Uint8Array): void {
  if (proof.length < 40 || (proof[7]! >>> 6) === 3)
    throw new RangeError("state proof has an invalid type or byte length");
  // The generated dynamic enum validator treats its payload as opaque. Check
  // the state-proof contract too, rather than accepting a truncated payload.
  let siblings = 0;
  for (let i = 8; i < 40; i++) {
    for (let bits = proof[i]!; bits; bits &= bits - 1) siblings++;
  }
  if (proof.length !== 40 + 32 * ((proof[7]! >>> 6) + siblings))
    throw new RangeError("state proof has an invalid type or byte length");
  const validation = StateProof.validate(proof);
  if (!validation.ok || validation.consumed !== proof.length)
    throw new RangeError("state proof has an invalid type or byte length");
}

export function buildCompressInstruction(accountIndex: number, proof: Uint8Array): Uint8Array {
  validateCompressionProof(proof);
  u16(accountIndex);
  return envelope("compress", new CompressArgsBuilder().set_account_idx(accountIndex).set_proof(proof).build());
}

export function buildDecompressInstruction(accountIndex: number, meta: Uint8Array,
  data: Uint8Array, proof: Uint8Array): Uint8Array {
  validateCompressionProof(proof);
  if (meta.length !== 64 || data.length > 16 * 1024 * 1024 ||
      new DataView(meta.buffer, meta.byteOffset, meta.byteLength).getUint32(4, true) !== data.length)
    throw new RangeError("account image must contain runtime metadata and the declared data bytes");
  u16(accountIndex);
  const builder = new DecompressArgsBuilder().set_account_idx(accountIndex).set_account_meta(Array.from(meta));
  builder.account_data().write(data).finish();
  builder.set_proof(proof);
  return envelope("decompress", builder.build());
}

export function buildCompressFromPointerInstruction(accountIndex: number, proofAddress: bigint, proofSize: bigint): Uint8Array {
  u16(accountIndex);
  return envelope("compress_from_pointer", new CompressFromPointerArgsBuilder().set_account_idx(accountIndex)
    .set_proof_address(u64(proofAddress)).set_proof_sz(u64(proofSize)).build());
}

export function buildDecompressFromPointerInstruction(args: {
  accountIndex: number; dataSize: bigint; metaAddress: bigint; dataAddress: bigint;
  proofAddress: bigint; proofSize: bigint;
}): Uint8Array {
  u16(args.accountIndex);
  return envelope("decompress_from_pointer", new DecompressFromPointerArgsBuilder().set_account_idx(args.accountIndex)
    .set_account_data_sz(u64(args.dataSize)).set_account_meta_address(u64(args.metaAddress))
    .set_account_data_address(u64(args.dataAddress)).set_proof_address(u64(args.proofAddress))
    .set_proof_sz(u64(args.proofSize)).build());
}
