import { bytesToHex, sha256 } from "../helpers/bytes";
import { normalizeSeed } from "../utils/helpers";
import { DeployError } from "./errors";

const TEXT_ENCODER = new TextEncoder();

export function seedBytes(seed: string): Uint8Array {
  const bytes = TEXT_ENCODER.encode(seed);
  try {
    return normalizeSeed(bytes);
  } catch (error) {
    throw new DeployError(
      "INVALID_INPUT",
      `seed must be 1-32 UTF-8 bytes, got ${bytes.length}`,
      { cause: error },
    );
  }
}

export async function temporarySeed(
  seed: string,
  suffix: string,
): Promise<string> {
  const combined = `${seed}_${suffix}`;
  const combinedBytes = TEXT_ENCODER.encode(combined);
  if (combinedBytes.length <= 32) return combined;
  const digest = await sha256(combinedBytes);
  return bytesToHex(digest.slice(0, 16));
}
