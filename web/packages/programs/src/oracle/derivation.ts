import type { Thru } from "@thru/sdk/client";
import { ORACLE_FEED_SEED_LENGTH } from "./constants";

const TEXT_ENCODER = new TextEncoder();

export function normalizeOracleFeedSeed(seed: string | Uint8Array): Uint8Array {
  const source = typeof seed === "string" ? TEXT_ENCODER.encode(seed) : seed;
  const normalized = new Uint8Array(ORACLE_FEED_SEED_LENGTH);
  normalized.set(source.subarray(0, ORACLE_FEED_SEED_LENGTH));
  return normalized;
}

export function deriveOracleFeedAddress(
  thru: Thru,
  oracleProgramAddress: string,
  seed: string | Uint8Array,
): { address: string; bytes: Uint8Array; seed: Uint8Array } {
  const normalizedSeed = normalizeOracleFeedSeed(seed);
  const address = thru.helpers.deriveProgramAddress({
    programAddress: oracleProgramAddress,
    seed: normalizedSeed,
    ephemeral: false,
  });
  return { ...address, seed: normalizedSeed };
}
