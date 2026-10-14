import { BOOTSTRAP_PROGRAM_ADDRESSES } from "../bootstrap-addresses";

export const RATELIMIT_PROGRAM_ADDRESS = BOOTSTRAP_PROGRAM_ADDRESSES.ratelimit;

export * from "./constants";
export {
  deriveRatelimitAuthorityAddress,
  deriveRatelimitBucketAddress,
  deriveRatelimitPolicyAddress,
  RATELIMIT_GLOBAL_KEY,
} from "./derivation";
export type { RatelimitDerivedAddress } from "./derivation";
export {
  buildCreateRatelimitAuthorityInstruction,
  buildCreateRatelimitPolicyInstruction,
  buildRatelimitCallInstruction,
  buildSetRatelimitAdminInstruction,
  buildUpdateRatelimitPolicyInstruction,
  encodeRatelimitConfig,
} from "./instructions";
export type {
  CreateRatelimitPolicyOptions,
  RatelimitCallBucket,
  RatelimitCallOptions,
  RatelimitConstraintConfig,
  RatelimitPolicyConfig,
  RatelimitRuleConfig,
} from "./instructions";
export { parseRatelimitBucketAccount, parseRatelimitPolicyAccount } from "./accounts";
export type { RatelimitBucketAccount, RatelimitPolicyAccount } from "./accounts";
