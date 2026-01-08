import { create } from "@bufbuild/protobuf";
import { sha256 } from "@noble/hashes/sha2";
import {
    encodeAddress,
    ensureBytes,
    hexToBytes,
    isHexString,
} from "@thru/helpers";

import { Pubkey, type PubkeyInput } from "../domain/primitives";
import { BlockHash, BlockHashSchema } from "@thru/proto";

export type BlockSelector =
  | { slot: number | bigint }
  | { blockHash: Uint8Array | string };

export function toBlockHash(value: Uint8Array | string): BlockHash {
  return create(BlockHashSchema, { value: ensureBytes(value, "blockHash") });
}

export interface DeriveProgramAddressOptions {
  programAddress: PubkeyInput;
  seed: Uint8Array | string;
  ephemeral?: boolean;
}

export interface DeriveProgramAddressResult {
  bytes: Uint8Array;
  address: string;
}

export function deriveProgramAddress(
  options: DeriveProgramAddressOptions
): DeriveProgramAddressResult {
  const programAddress = Pubkey.from(options.programAddress).toBytes();
  const seed = normalizeSeed(options.seed);
  const ephemeral = options.ephemeral === true;

  const derivationInput = new Uint8Array(
    programAddress.length + 1 + seed.length
  );
  derivationInput.set(programAddress, 0);
  derivationInput[programAddress.length] = ephemeral ? 1 : 0;
  derivationInput.set(seed, programAddress.length + 1);

  const hash = sha256(derivationInput);
  const derivedBytes = new Uint8Array(hash.slice(0, 32));

  return {
    bytes: derivedBytes,
    address: encodeAddress(derivedBytes),
  };
}

export type DeriveAddressInput = PubkeyInput | Uint8Array;

export interface DeriveAddressResult {
  bytes: Uint8Array;
  address: string;
}

/**
 * Derive an address by hashing an array of inputs.
 * Inputs can be pubkeys (as string, Uint8Array, or Pubkey) or raw Uint8Array data.
 *
 * @example
 * // Token account: SHA256(owner || mint || seed)
 * deriveAddress([ownerPubkey, mintPubkey, seed])
 *
 * // Mint account: SHA256(creator || seed)
 * deriveAddress([creatorPubkey, seed])
 */
export function deriveAddress(
  inputs: DeriveAddressInput[]
): DeriveAddressResult {
  if (inputs.length === 0) {
    throw new Error("At least one input is required");
  }

  const normalizedInputs = inputs.map((input) => normalizeToBytes(input));
  const totalLength = normalizedInputs.reduce(
    (sum, arr) => sum + arr.length,
    0
  );

  const derivationInput = new Uint8Array(totalLength);
  let offset = 0;
  for (const input of normalizedInputs) {
    derivationInput.set(input, offset);
    offset += input.length;
  }

  const hash = sha256(derivationInput);
  const derivedBytes = new Uint8Array(hash.slice(0, 32));

  return {
    bytes: derivedBytes,
    address: encodeAddress(derivedBytes),
  };
}

function normalizeToBytes(input: DeriveAddressInput): Uint8Array {
  if (input instanceof Uint8Array) {
    return input;
  }
  return Pubkey.from(input).toBytes();
}

function normalizeSeed(value: Uint8Array | string): Uint8Array {
  if (value instanceof Uint8Array) {
    if (value.length === 0) {
      throw new Error("Seed cannot be empty");
    }
    if (value.length > 32) {
      throw new Error("Seed cannot exceed 32 bytes");
    }
    const seed = new Uint8Array(32);
    seed.set(value);
    return seed;
  }
  if (typeof value === "string") {
    if (value.length === 0) {
      throw new Error("Seed cannot be empty");
    }
    if (isHexString(value)) {
      const bytes = hexToBytes(value);
      if (bytes.length !== 32) {
        throw new Error(
          `Hex seed must decode to 32 bytes, got ${bytes.length}`
        );
      }
      return bytes;
    }
    const encoder = new TextEncoder();
    const utf8 = encoder.encode(value);
    if (utf8.length > 32) {
      throw new Error(`UTF-8 seed too long: ${utf8.length} bytes (max 32)`);
    }
    const seed = new Uint8Array(32);
    seed.set(utf8);
    return seed;
  }
  throw new Error("Seed must be provided as Uint8Array or string");
}
