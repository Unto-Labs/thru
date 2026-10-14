import { deriveProgramAddress } from "@thru/sdk";

import { hashBytes, pubkeyBytes } from "../utils/helpers.js";

/* This module must not import bootstrap-addresses (which imports it), so
   every function takes the rate limiter program address explicitly. */

type AddressInput = string | Uint8Array;

export interface RatelimitDerivedAddress {
  address: string;
  bytes: Uint8Array;
  seed: Uint8Array;
}

const encoder = new TextEncoder();
const POLICY_SEED_TAG = encoder.encode("tn_ratelimit_policy_v1");
const VERIFIED_POLICY_SEED_TAG = encoder.encode("tn_ratelimit_verified_policy_v1");
const BUCKET_SEED_TAG = encoder.encode("tn_ratelimit_bucket_v1");
const AUTHORITY_SEED_TAG = encoder.encode("tn_ratelimit_authority_v1");

/* setBigUint64 wraps out of range values, which would alias another
 * policy's address (2^64 would derive policy 0), so reject them. */
function u64le(value: bigint | number, label: string): Uint8Array {
  if (typeof value === "number" ? !Number.isSafeInteger(value) || value < 0
    : typeof value !== "bigint" || value < 0n || value >= 1n << 64n) {
    throw new Error(`${label} must be a u64`);
  }
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, BigInt(value), true);
  return out;
}

function pda(program: AddressInput, seed: Uint8Array): RatelimitDerivedAddress {
  const derived = deriveProgramAddress({
    programAddress: pubkeyBytes(program, "rate limiter program address"),
    seed,
  });
  return { address: derived.address, bytes: derived.bytes, seed };
}

/** Seed of a policy: sha256("tn_ratelimit_verified_policy_v1" || target ||
 * policy_id) when verified, else sha256("tn_ratelimit_policy_v1" || admin ||
 * target || policy_id). A VERIFIED policy is created with the target's
 * manager meta account and its address does not depend on the admin. */
function ratelimitPolicySeed(options: {
  target: AddressInput;
  policyId: bigint | number;
  verified: boolean;
  admin?: AddressInput;
}): Uint8Array {
  const target = pubkeyBytes(options.target, "target");
  const id = u64le(options.policyId, "policyId");
  if (options.verified) {
    return hashBytes(VERIFIED_POLICY_SEED_TAG, target, id);
  }
  if (options.admin === undefined) throw new Error("an unverified policy seed requires admin");
  return hashBytes(POLICY_SEED_TAG, pubkeyBytes(options.admin, "admin"), target, id);
}

export function deriveRatelimitPolicyAddress(
  programAddress: AddressInput,
  options: Parameters<typeof ratelimitPolicySeed>[0],
): RatelimitDerivedAddress {
  return pda(programAddress, ratelimitPolicySeed(options));
}

/** Bucket key for GLOBAL rules. */
export const RATELIMIT_GLOBAL_KEY: Uint8Array = new Uint8Array(32);

/** sha256("tn_ratelimit_bucket_v1" || policy || rule_idx(u8) || key). */
export function deriveRatelimitBucketAddress(
  programAddress: AddressInput,
  policy: AddressInput,
  ruleIdx: number,
  key: AddressInput,
): RatelimitDerivedAddress {
  if (!Number.isInteger(ruleIdx) || ruleIdx < 0 || ruleIdx > 0xff) throw new Error("ruleIdx must be a u8");
  return pda(programAddress, hashBytes(
    BUCKET_SEED_TAG,
    pubkeyBytes(policy, "policy"),
    Uint8Array.of(ruleIdx),
    pubkeyBytes(key, "bucket key"),
  ));
}

/** sha256("tn_ratelimit_authority_v1" || policy). */
export function deriveRatelimitAuthorityAddress(
  programAddress: AddressInput,
  policy: AddressInput,
): RatelimitDerivedAddress {
  return pda(programAddress, hashBytes(AUTHORITY_SEED_TAG, pubkeyBytes(policy, "policy")));
}
