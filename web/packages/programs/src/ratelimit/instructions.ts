import { concatBytes, pubkeyBytes } from "../utils/helpers.js";
import {
  CallArgsBuilder,
  CreateAuthorityArgsBuilder,
  CreatePolicyArgsBuilder,
  RatelimitCallBucketBuilder,
  RatelimitConfigBuilder,
  RatelimitConstraintBuilder,
  RatelimitInstructionBuilder,
  RatelimitRuleBuilder,
  SetAdminArgsBuilder,
  UpdatePolicyArgsBuilder,
} from "./abi/thru/program/ratelimit/types.js";
import {
  RATELIMIT_CONSTRAINT_MAX,
  RATELIMIT_INSTRUCTION_CALL,
  RATELIMIT_NO_ACCOUNT,
  RATELIMIT_RULE_MAX,
} from "./constants.js";

type AddressInput = string | Uint8Array;

export interface RatelimitRuleConfig {
  /** RATELIMIT_KEY_* */
  keyKind: number;
  /** RATELIMIT_CLOCK_* */
  clock: number;
  /** INSTR_ACCOUNT only: offset of a u16 account index in the forwarded instruction. */
  keyOffset?: number;
  window: bigint;
  /** 0 = unlimited */
  maxCalls: bigint;
  /** 0 = unlimited */
  maxAmount: bigint;
}

export interface RatelimitConstraintConfig {
  idxOffset: number;
  expected: AddressInput;
}

/** The admin-controlled policy configuration (tn_ratelimit_config_t).
 * rule_cnt and constraint_cnt are the array lengths. */
export interface RatelimitPolicyConfig {
  /** Only RATELIMIT_POLICY_FLAG_PAUSED may be set. */
  flags?: number;
  selectorSz: number;
  selectorOffset: number;
  selectorValue: bigint;
  instrSzMin: number;
  instrSzMax: number;
  amountSz: number;
  amountOffset: number;
  /** 0 = unlimited */
  maxAmountPerCall: bigint;
  attester?: AddressInput;
  constraints?: readonly RatelimitConstraintConfig[];
  rules: readonly RatelimitRuleConfig[];
}

const INT_SIZES = new Set([0, 1, 2, 4, 8]);

function u16(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) throw new Error(`${label} must be a u16`);
  return value;
}

const U64_MAX = (1n << 64n) - 1n;

/* The generated setters write bigints with setBigUint64, which wraps out of
 * range values (2^64 would become 0, i.e. "unlimited"), so reject them. */
function u64(value: bigint, label: string): bigint {
  if (typeof value !== "bigint" || value < 0n || value > U64_MAX) throw new Error(`${label} must be a u64`);
  return value;
}

function u8(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 0xff) throw new Error(`${label} must be a u8`);
  return value;
}

/* A trailing creation proof is u16-length-prefixed and nonempty. */
function assertCreationProof(proof: Uint8Array, label: string): void {
  if (!proof.length || proof.length > 0xffff) throw new Error(`${label} creation proof must be 1..65535 bytes`);
}

/** Encodes the 309-byte packed tn_ratelimit_config_t. Unused rule and
 * constraint slots are zero. */
export function encodeRatelimitConfig(config: RatelimitPolicyConfig): Uint8Array {
  const constraints = config.constraints ?? [];
  if (config.rules.length < 1 || config.rules.length > RATELIMIT_RULE_MAX) {
    throw new Error(`a policy needs 1..${RATELIMIT_RULE_MAX} rules`);
  }
  if (constraints.length > RATELIMIT_CONSTRAINT_MAX) {
    throw new Error(`a policy allows at most ${RATELIMIT_CONSTRAINT_MAX} constraints`);
  }
  if (!INT_SIZES.has(config.selectorSz) || !INT_SIZES.has(config.amountSz)) {
    throw new Error("selectorSz and amountSz must be 0, 1, 2, 4 or 8");
  }
  const rules = Array.from({ length: RATELIMIT_RULE_MAX }, (_, i) => {
    const rule = config.rules[i];
    const builder = new RatelimitRuleBuilder();
    if (rule) {
      if (u64(rule.window, `rule ${i} window`) === 0n) throw new Error(`rule ${i} window must be positive`);
      builder.set_key_kind(u8(rule.keyKind, "keyKind")).set_clock(u8(rule.clock, "clock"))
        .set_key_offset(u16(rule.keyOffset ?? 0, "keyOffset"))
        .set_window(rule.window)
        .set_max_calls(u64(rule.maxCalls, `rule ${i} maxCalls`))
        .set_max_amount(u64(rule.maxAmount, `rule ${i} maxAmount`));
    }
    return builder.finish();
  });
  const constraintViews = Array.from({ length: RATELIMIT_CONSTRAINT_MAX }, (_, i) => {
    const constraint = constraints[i];
    const builder = new RatelimitConstraintBuilder();
    if (constraint) {
      builder.set_idx_offset(u16(constraint.idxOffset, "idxOffset"))
        .set_expected(pubkeyBytes(constraint.expected, "constraint address"));
    }
    return builder.finish();
  });
  return new RatelimitConfigBuilder()
    .set_flags(u8(config.flags ?? 0, "flags"))
    .set_rule_cnt(config.rules.length)
    .set_constraint_cnt(constraints.length)
    .set_selector_sz(config.selectorSz)
    .set_selector_offset(u16(config.selectorOffset, "selectorOffset"))
    .set_selector_value(u64(config.selectorValue, "selectorValue"))
    .set_instr_sz_min(u16(config.instrSzMin, "instrSzMin"))
    .set_instr_sz_max(u16(config.instrSzMax, "instrSzMax"))
    .set_amount_sz(config.amountSz)
    .set_amount_offset(u16(config.amountOffset, "amountOffset"))
    .set_max_amount_per_call(u64(config.maxAmountPerCall, "maxAmountPerCall"))
    .set_attester(config.attester === undefined ? new Uint8Array(32) : pubkeyBytes(config.attester, "attester"))
    .set_constraints(constraintViews)
    .set_rules(rules)
    .build();
}

function instruction(variant: string, payload: Uint8Array): Uint8Array {
  const builder = new RatelimitInstructionBuilder();
  builder.payload().select(variant).writePayload(payload);
  return builder.build();
}

export interface CreateRatelimitPolicyOptions {
  policyAccountIdx: number;
  /** The target's manager meta account index for a VERIFIED policy, or
   * omitted (NO_ACCOUNT) for an unverified policy. */
  metaAccountIdx?: number;
  admin: AddressInput;
  target: AddressInput;
  policyId: bigint;
  config: RatelimitPolicyConfig;
  /** Creation state proof of the policy account. */
  proof: Uint8Array;
}

/** CREATE_POLICY (0): u32 tag || CreatePolicyArgs || proof. */
export function buildCreateRatelimitPolicyInstruction(options: CreateRatelimitPolicyOptions): Uint8Array {
  assertCreationProof(options.proof, "policy");
  const args = new CreatePolicyArgsBuilder()
    .set_policy_account_idx(u16(options.policyAccountIdx, "policyAccountIdx"))
    .set_meta_account_idx(u16(options.metaAccountIdx ?? RATELIMIT_NO_ACCOUNT, "metaAccountIdx"))
    .set_admin(pubkeyBytes(options.admin, "admin"))
    .set_target(pubkeyBytes(options.target, "target"))
    .set_policy_id(u64(options.policyId, "policyId"))
    .set_config(encodeRatelimitConfig(options.config));
  args.proof().write(options.proof);
  return instruction("create_policy", args.build());
}

/** UPDATE_POLICY (1): replaces the config. */
export function buildUpdateRatelimitPolicyInstruction(policyAccountIdx: number, config: RatelimitPolicyConfig): Uint8Array {
  return instruction("update_policy", new UpdatePolicyArgsBuilder()
    .set_policy_account_idx(u16(policyAccountIdx, "policyAccountIdx"))
    .set_config(encodeRatelimitConfig(config))
    .build());
}

/** SET_ADMIN (2). */
export function buildSetRatelimitAdminInstruction(policyAccountIdx: number, newAdmin: AddressInput): Uint8Array {
  return instruction("set_admin", new SetAdminArgsBuilder()
    .set_policy_account_idx(u16(policyAccountIdx, "policyAccountIdx"))
    .set_new_admin(pubkeyBytes(newAdmin, "new admin"))
    .build());
}

/** CREATE_AUTHORITY (3): u32 tag || CreateAuthorityArgs || proof. */
export function buildCreateRatelimitAuthorityInstruction(
  policyAccountIdx: number,
  authorityAccountIdx: number,
  proof: Uint8Array,
): Uint8Array {
  assertCreationProof(proof, "authority");
  const args = new CreateAuthorityArgsBuilder()
    .set_policy_account_idx(u16(policyAccountIdx, "policyAccountIdx"))
    .set_authority_account_idx(u16(authorityAccountIdx, "authorityAccountIdx"));
  args.proof().write(proof);
  return instruction("create_authority", args.build());
}

export interface RatelimitCallBucket {
  bucketAccountIdx: number;
  /** Creation proof when the bucket does not exist yet. */
  proof?: Uint8Array;
  /** ATTESTED rules only; must be omitted (zero) for every other key kind. */
  key?: AddressInput;
}

export interface RatelimitCallOptions {
  policyAccountIdx: number;
  targetAccountIdx: number;
  /** The policy's authority PDA to sign for, or omitted. */
  authorityAccountIdx?: number;
  /** One entry per policy rule, in rule order. */
  buckets: readonly RatelimitCallBucket[];
  /** The instruction forwarded to the target. */
  inner: Uint8Array;
}

/** CALL (4): u32 tag || CallArgs || CallBucket[rule_cnt] || proofs of the
 * buckets with a proof, in rule order || inner. The ABI only describes the
 * fixed CallArgs header, because rule_cnt lives in the policy account. */
export function buildRatelimitCallInstruction(options: RatelimitCallOptions): Uint8Array {
  if (options.buckets.length < 1 || options.buckets.length > RATELIMIT_RULE_MAX) {
    throw new Error(`CALL needs one bucket per policy rule (1..${RATELIMIT_RULE_MAX})`);
  }
  const header = new CallArgsBuilder()
    .set_policy_account_idx(u16(options.policyAccountIdx, "policyAccountIdx"))
    .set_target_account_idx(u16(options.targetAccountIdx, "targetAccountIdx"))
    .set_authority_account_idx(u16(options.authorityAccountIdx ?? RATELIMIT_NO_ACCOUNT, "authorityAccountIdx"))
    .set_inner_sz(u16(options.inner.length, "inner instruction size"))
    .build();
  const entries = options.buckets.map((bucket) => new RatelimitCallBucketBuilder()
    .set_bucket_account_idx(u16(bucket.bucketAccountIdx, "bucketAccountIdx"))
    .set_proof_sz(u16(bucket.proof?.length ?? 0, "bucket proof size"))
    .set_key(bucket.key === undefined ? new Uint8Array(32) : pubkeyBytes(bucket.key, "bucket key"))
    .build());
  const proofs = options.buckets.flatMap((bucket) => bucket.proof?.length ? [bucket.proof] : []);
  const tag = new Uint8Array(4);
  new DataView(tag.buffer).setUint32(0, RATELIMIT_INSTRUCTION_CALL, true);
  return concatBytes(tag, header, ...entries, ...proofs, options.inner);
}
