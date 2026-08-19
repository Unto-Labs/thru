import { Pubkey } from "@thru/sdk";
import {
  buildLayoutIrWithManifest,
  OnchainFetcher,
  resolveImports,
} from "@thru/sdk/abi";
import type { Thru } from "@thru/sdk/client";
import { hexToBytes, isHexString } from "@thru/sdk/helpers";
import { bytesEqual } from "../helpers/bytes";
import { validateManagerProgramImage } from "../manager";
import {
  DEFAULT_CHUNK_SIZE,
  MAX_CHUNK_SIZE,
  MIN_CHUNK_SIZE,
} from "./constants";
import { DeployError, asDeployError } from "./errors";
import { seedBytes } from "./seeds";
import type { DeploymentBytes, DeploymentPrivateKey } from "./types";

export interface ResolvedSigner {
  address: string;
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

export function normalizeBytes(
  value: DeploymentBytes,
  field: string,
): Uint8Array {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(
      value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength),
    );
  }
  throw new DeployError("INVALID_INPUT", `${field} must be binary data`);
}

export function normalizePrivateKey(value: DeploymentPrivateKey): Uint8Array {
  let bytes: Uint8Array;
  if (value instanceof Uint8Array) {
    bytes = new Uint8Array(value);
  } else if (typeof value === "string" && isHexString(value)) {
    bytes = hexToBytes(value);
  } else {
    throw new DeployError(
      "INVALID_INPUT",
      "signer.privateKey must be 32-byte hex or Uint8Array",
    );
  }
  if (bytes.length !== 32) {
    throw new DeployError(
      "INVALID_INPUT",
      `signer.privateKey must be 32 bytes, got ${bytes.length}`,
    );
  }
  return bytes;
}

export function validateSeedAndChunkSize(
  seed: string,
  chunkSize?: number,
): number {
  seedBytes(seed);
  const resolved = chunkSize ?? DEFAULT_CHUNK_SIZE;
  if (
    !Number.isInteger(resolved) ||
    resolved < MIN_CHUNK_SIZE ||
    resolved > MAX_CHUNK_SIZE
  ) {
    throw new DeployError(
      "INVALID_INPUT",
      `chunkSize must be an integer from ${MIN_CHUNK_SIZE} to ${MAX_CHUNK_SIZE}`,
    );
  }
  return resolved;
}

export async function resolveSigner(
  client: Thru,
  address: string,
  privateKeyInput: DeploymentPrivateKey,
): Promise<ResolvedSigner> {
  let expected: Uint8Array;
  try {
    expected = Pubkey.from(address).toBytes();
  } catch (error) {
    throw asDeployError(
      error,
      "INVALID_INPUT",
      "signer.address is not a valid Thru address",
    );
  }
  const privateKey = normalizePrivateKey(privateKeyInput);
  let publicKey: Uint8Array;
  try {
    publicKey = await client.keys.fromPrivateKey(privateKey);
  } catch (error) {
    throw asDeployError(
      error,
      "INVALID_INPUT",
      "Unable to derive signer public key",
    );
  }
  if (!bytesEqual(publicKey, expected)) {
    throw new DeployError(
      "SIGNER_MISMATCH",
      "signer.privateKey does not match signer.address",
    );
  }
  return { address: Pubkey.from(expected).toThruFmt(), publicKey, privateKey };
}

export function validateProgramImage(program: Uint8Array): void {
  if (
    program.length >= 4 &&
    program[0] === 0x7f &&
    program[1] === 0x45 &&
    program[2] === 0x4c &&
    program[3] === 0x46
  ) {
    throw new DeployError(
      "INVALID_INPUT",
      "ELF file detected; supply the compiled ThruVM .bin program image",
    );
  }
  try {
    validateManagerProgramImage(program);
  } catch (error) {
    throw asDeployError(
      error,
      "INVALID_INPUT",
      error instanceof Error ? error.message : "Invalid program image",
    );
  }
}

export async function validateABI(
  abi: Uint8Array,
  client?: Thru,
): Promise<string> {
  let yaml: string;
  try {
    yaml = new TextDecoder("utf-8", { fatal: true }).decode(abi);
  } catch (error) {
    throw asDeployError(error, "INVALID_INPUT", "ABI must be valid UTF-8 YAML");
  }
  if (yaml.trim().length === 0) {
    throw new DeployError("INVALID_INPUT", "ABI cannot be empty");
  }
  if (/^\s*-\s*type:\s*path\s*$/im.test(yaml)) {
    throw new DeployError(
      "INVALID_INPUT",
      "ABI contains local path imports; flatten or prepare it for publishing first",
    );
  }
  try {
    const importClient = client
      ? {
          query: {
            getRawAccount: (request: {
              address: { value: Uint8Array };
              versionContext: Record<string, unknown>;
            }) =>
              client.accounts.getRaw(request.address.value, {
                versionContext: request.versionContext as never,
              }),
          },
        }
      : undefined;
    const resolved = await resolveImports(yaml, {
      onchainFetcher: new OnchainFetcher({ thruClient: importClient }),
    });
    await buildLayoutIrWithManifest(
      resolved.manifest,
      resolved.root.id.packageName,
    );
  } catch (error) {
    throw asDeployError(error, "INVALID_INPUT", "ABI analysis failed");
  }
  return yaml;
}
