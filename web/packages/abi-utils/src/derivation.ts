import { decodeAddress, encodeAddress } from "@thru/helpers";

const ABI_META_BODY_SIZE = 96;
const ABI_ACCOUNT_SUFFIX = "_abi_account";
const ABI_ACCOUNT_SUFFIX_BYTES = new TextEncoder().encode(ABI_ACCOUNT_SUFFIX);

function concatBytes(...chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

async function sha256Bytes(data: Uint8Array): Promise<Uint8Array> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", data as BufferSource);
  return new Uint8Array(hashBuffer);
}

/**
 * Builds the ABI meta body for an official ABI (program account).
 */
export function abiMetaBodyForProgram(programBytes: Uint8Array): Uint8Array {
  if (programBytes.length !== 32) {
    throw new Error(`Expected 32-byte program account, got ${programBytes.length} bytes`);
  }
  const body = new Uint8Array(ABI_META_BODY_SIZE);
  body.set(programBytes, 0);
  return body;
}

/**
 * Derives the ABI meta seed from ABI meta kind + body.
 */
export async function deriveAbiMetaSeed(kind: number, body: Uint8Array): Promise<Uint8Array> {
  if (body.length !== ABI_META_BODY_SIZE) {
    throw new Error(`Expected ${ABI_META_BODY_SIZE}-byte ABI meta body, got ${body.length} bytes`);
  }
  return sha256Bytes(concatBytes(new Uint8Array([kind]), body));
}

/**
 * Derives the ABI account seed from ABI meta kind + body.
 */
export async function deriveAbiAccountSeed(kind: number, body: Uint8Array): Promise<Uint8Array> {
  if (body.length !== ABI_META_BODY_SIZE) {
    throw new Error(`Expected ${ABI_META_BODY_SIZE}-byte ABI meta body, got ${body.length} bytes`);
  }
  return sha256Bytes(concatBytes(new Uint8Array([kind]), body, ABI_ACCOUNT_SUFFIX_BYTES));
}

/**
 * Derives a program-defined account address (owner || ephemeral || seed).
 */
export async function deriveProgramAddress(
  seed: Uint8Array,
  programId: Uint8Array,
  ephemeral: boolean = false
): Promise<Uint8Array> {
  if (seed.length !== 32) {
    throw new Error(`Expected 32-byte seed, got ${seed.length} bytes`);
  }
  if (programId.length !== 32) {
    throw new Error(`Expected 32-byte program ID, got ${programId.length} bytes`);
  }

  const flag = new Uint8Array([ephemeral ? 1 : 0]);
  return sha256Bytes(concatBytes(programId, flag, seed));
}

/**
 * Derives the ABI meta account address (as a ta-prefixed string).
 */
export async function deriveAbiMetaAddress(
  kind: number,
  body: Uint8Array,
  abiManagerProgramId: string | Uint8Array,
  ephemeral: boolean = false
): Promise<string> {
  const abiManagerBytes = typeof abiManagerProgramId === "string"
    ? decodeAddress(abiManagerProgramId)
    : abiManagerProgramId;
  const seed = await deriveAbiMetaSeed(kind, body);
  const addressBytes = await deriveProgramAddress(seed, abiManagerBytes, ephemeral);
  return encodeAddress(addressBytes);
}

/**
 * Derives the ABI account address (as a ta-prefixed string).
 */
export async function deriveAbiAddress(
  kind: number,
  body: Uint8Array,
  abiManagerProgramId: string | Uint8Array,
  ephemeral: boolean = false
): Promise<string> {
  const abiManagerBytes = typeof abiManagerProgramId === "string"
    ? decodeAddress(abiManagerProgramId)
    : abiManagerProgramId;
  const seed = await deriveAbiAccountSeed(kind, body);
  const addressBytes = await deriveProgramAddress(seed, abiManagerBytes, ephemeral);
  return encodeAddress(addressBytes);
}
