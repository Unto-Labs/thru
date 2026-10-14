import { pubkeyAddress } from "../utils/helpers.js";
import {
  RatelimitBucket,
  RatelimitPolicy,
  type Pubkey,
  type RatelimitConfig,
} from "./abi/thru/program/ratelimit/types.js";
import {
  RATELIMIT_BUCKET_MAGIC,
  RATELIMIT_BUCKET_SIZE,
  RATELIMIT_CONFIG_SIZE,
  RATELIMIT_CONSTRAINT_MAX,
  RATELIMIT_POLICY_MAGIC,
  RATELIMIT_POLICY_SIZE,
  RATELIMIT_RULE_MAX,
} from "./constants.js";
import type { RatelimitPolicyConfig } from "./instructions.js";

export interface RatelimitPolicyAccount {
  admin: string;
  target: string;
  policyId: bigint;
  /** RATELIMIT_POLICY_FLAG_* */
  stateFlags: number;
  config: RatelimitPolicyConfig;
  /** Raw 309-byte config, for exact comparison with encodeRatelimitConfig. */
  configBytes: Uint8Array;
}

export interface RatelimitBucketAccount {
  policy: string;
  key: Uint8Array;
  ruleIdx: number;
  windowStart: bigint;
  calls: bigint;
  amount: bigint;
  totalCalls: bigint;
  totalAmount: bigint;
}

const bytes = (pubkey: Pubkey) => Uint8Array.from(pubkey.get_bytes());
const address = (pubkey: Pubkey) => pubkeyAddress(bytes(pubkey));

function decodeConfig(config: RatelimitConfig): RatelimitPolicyConfig {
  return {
    flags: config.get_flags(),
    selectorSz: config.get_selector_sz(),
    selectorOffset: config.get_selector_offset(),
    selectorValue: config.get_selector_value(),
    instrSzMin: config.get_instr_sz_min(),
    instrSzMax: config.get_instr_sz_max(),
    amountSz: config.get_amount_sz(),
    amountOffset: config.get_amount_offset(),
    maxAmountPerCall: config.get_max_amount_per_call(),
    attester: bytes(config.get_attester()),
    constraints: config.get_constraints()
      .slice(0, Math.min(config.get_constraint_cnt(), RATELIMIT_CONSTRAINT_MAX))
      .map((constraint) => ({
        idxOffset: constraint.get_idx_offset(),
        expected: address(constraint.get_expected()),
      })),
    rules: config.get_rules()
      .slice(0, Math.min(config.get_rule_cnt(), RATELIMIT_RULE_MAX))
      .map((rule) => ({
        keyKind: rule.get_key_kind(),
        clock: rule.get_clock(),
        keyOffset: rule.get_key_offset(),
        window: rule.get_window(),
        maxCalls: rule.get_max_calls(),
        maxAmount: rule.get_max_amount(),
      })),
  };
}

/** Parses policy account data; returns null on a size or magic mismatch. */
export function parseRatelimitPolicyAccount(data: Uint8Array): RatelimitPolicyAccount | null {
  if (data.length !== RATELIMIT_POLICY_SIZE) return null;
  const policy = RatelimitPolicy.from_array(data);
  if (!policy || policy.get_magic() !== RATELIMIT_POLICY_MAGIC) return null;
  return {
    admin: address(policy.get_admin()),
    target: address(policy.get_target()),
    policyId: policy.get_policy_id(),
    stateFlags: policy.get_state_flags(),
    config: decodeConfig(policy.get_config()),
    configBytes: data.slice(RATELIMIT_POLICY_SIZE - RATELIMIT_CONFIG_SIZE),
  };
}

/** Parses bucket account data; returns null on a size or magic mismatch. */
export function parseRatelimitBucketAccount(data: Uint8Array): RatelimitBucketAccount | null {
  if (data.length !== RATELIMIT_BUCKET_SIZE) return null;
  const bucket = RatelimitBucket.from_array(data);
  if (!bucket || bucket.get_magic() !== RATELIMIT_BUCKET_MAGIC) return null;
  return {
    policy: address(bucket.get_policy()),
    key: bytes(bucket.get_key()),
    ruleIdx: bucket.get_rule_idx(),
    windowStart: bucket.get_window_start(),
    calls: bucket.get_calls(),
    amount: bucket.get_amount(),
    totalCalls: bucket.get_total_calls(),
    totalAmount: bucket.get_total_amount(),
  };
}
