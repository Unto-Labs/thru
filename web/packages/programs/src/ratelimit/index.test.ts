import { createHash } from "node:crypto";
import { Pubkey } from "@thru/sdk";
import { describe, expect, it } from "vitest";

import {
  buildCreateRatelimitPolicyInstruction,
  buildRatelimitCallInstruction,
  buildSetRatelimitAdminInstruction,
  deriveRatelimitAuthorityAddress,
  deriveRatelimitBucketAddress,
  deriveRatelimitPolicyAddress,
  encodeRatelimitConfig,
  parseRatelimitBucketAccount,
  parseRatelimitPolicyAccount,
  RATELIMIT_BUCKET_MAGIC,
  RATELIMIT_CALL_ARGS_SIZE,
  RATELIMIT_CALL_BUCKET_SIZE,
  RATELIMIT_CLOCK_SLOT,
  RATELIMIT_CONFIG_SIZE,
  RATELIMIT_GLOBAL_KEY,
  RATELIMIT_KEY_ATTESTED,
  RATELIMIT_KEY_GLOBAL,
  RATELIMIT_POLICY_FLAG_VERIFIED,
  RATELIMIT_POLICY_MAGIC,
  RATELIMIT_PROGRAM_ADDRESS,
  type RatelimitPolicyConfig,
} from "./index";
import { CallArgs, RatelimitCallBucket } from "./abi/thru/program/ratelimit/types";

const program = Pubkey.from(RATELIMIT_PROGRAM_ADDRESS).toBytes();
const admin = new Uint8Array(32).fill(0x11);
const target = new Uint8Array(32).fill(0x22);
const recipient = new Uint8Array(32).fill(0x33);

function sha(...parts: Uint8Array[]): Uint8Array {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part);
  return new Uint8Array(hash.digest());
}
const pda = (seed: Uint8Array) => sha(program, Uint8Array.of(0), seed);
const u64 = (value: bigint) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, value, true); return b; };
const text = (value: string) => new TextEncoder().encode(value);

const config: RatelimitPolicyConfig = {
  selectorSz: 4, selectorOffset: 0, selectorValue: 3n, instrSzMin: 18, instrSzMax: 18,
  amountSz: 8, amountOffset: 8, maxAmountPerCall: 10_000n,
  rules: [
    { keyKind: RATELIMIT_KEY_GLOBAL, clock: RATELIMIT_CLOCK_SLOT, window: 100n, maxCalls: 7n, maxAmount: 9n },
    { keyKind: RATELIMIT_KEY_ATTESTED, clock: 1, keyOffset: 6, window: 200n, maxCalls: 0n, maxAmount: 0n },
  ],
  constraints: [{ idxOffset: 4, expected: recipient }],
  attester: admin,
};

describe("rate limiter derivation", () => {
  it("matches the C seeds for verified and admin-scoped policies, buckets and authorities", () => {
    const verified = deriveRatelimitPolicyAddress(RATELIMIT_PROGRAM_ADDRESS, { target, policyId: 5n, verified: true });
    expect(verified.bytes).toEqual(pda(sha(text("tn_ratelimit_verified_policy_v1"), target, u64(5n))));
    const scoped = deriveRatelimitPolicyAddress(RATELIMIT_PROGRAM_ADDRESS, { target, policyId: 5n, verified: false, admin });
    expect(scoped.bytes).toEqual(pda(sha(text("tn_ratelimit_policy_v1"), admin, target, u64(5n))));
    expect(scoped.address).not.toBe(verified.address);
    expect(() => deriveRatelimitPolicyAddress(RATELIMIT_PROGRAM_ADDRESS, { target, policyId: 0n, verified: false })).toThrow("requires admin");
    /* An out of range id must not wrap onto another policy's address. */
    for (const policyId of [1n << 64n, -1n, 2 ** 64, 1.5]) {
      expect(() => deriveRatelimitPolicyAddress(RATELIMIT_PROGRAM_ADDRESS, { target, policyId, verified: true })).toThrow("policyId must be a u64");
    }

    const bucket = deriveRatelimitBucketAddress(RATELIMIT_PROGRAM_ADDRESS, verified.address, 1, recipient);
    expect(bucket.bytes).toEqual(pda(sha(text("tn_ratelimit_bucket_v1"), verified.bytes, Uint8Array.of(1), recipient)));
    const global = deriveRatelimitBucketAddress(RATELIMIT_PROGRAM_ADDRESS, verified.address, 0, RATELIMIT_GLOBAL_KEY);
    expect(global.bytes).toEqual(pda(sha(text("tn_ratelimit_bucket_v1"), verified.bytes, Uint8Array.of(0), new Uint8Array(32))));
    expect(deriveRatelimitAuthorityAddress(RATELIMIT_PROGRAM_ADDRESS, verified.address).bytes)
      .toEqual(pda(sha(text("tn_ratelimit_authority_v1"), verified.bytes)));
  });
});

describe("rate limiter instructions", () => {
  it("encodes the packed config", () => {
    const bytes = encodeRatelimitConfig(config);
    const view = new DataView(bytes.buffer);
    expect(bytes.length).toBe(RATELIMIT_CONFIG_SIZE);
    expect([view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3)]).toEqual([0, 2, 1, 4]);
    expect(view.getBigUint64(6, true)).toBe(3n);
    expect([view.getUint16(14, true), view.getUint16(16, true), view.getUint8(18), view.getUint16(19, true)]).toEqual([18, 18, 8, 8]);
    expect(view.getBigUint64(21, true)).toBe(10_000n);
    expect(bytes.slice(29, 61)).toEqual(admin);
    expect(view.getUint16(61, true)).toBe(4);
    expect(bytes.slice(63, 95)).toEqual(recipient);
    expect(bytes.slice(95, 197)).toEqual(new Uint8Array(102)); // unused constraints
    expect([view.getUint8(197 + 28), view.getUint8(198 + 28), view.getUint16(199 + 28, true)]).toEqual([3, 1, 6]);
    expect(view.getBigUint64(201, true)).toBe(100n);
    expect(view.getBigUint64(209, true)).toBe(7n);
    expect(view.getBigUint64(217, true)).toBe(9n);
    expect(bytes.slice(197 + 56)).toEqual(new Uint8Array(56)); // unused rules
    expect(() => encodeRatelimitConfig({ ...config, rules: [] })).toThrow("1..4 rules");
    expect(() => encodeRatelimitConfig({ ...config, amountSz: 3 })).toThrow("0, 1, 2, 4 or 8");
    const rule = config.rules[0]!;
    expect(() => encodeRatelimitConfig({ ...config, rules: [{ ...rule, maxCalls: 1n << 64n }] })).toThrow("rule 0 maxCalls must be a u64");
    expect(() => encodeRatelimitConfig({ ...config, rules: [{ ...rule, maxAmount: -1n }] })).toThrow("rule 0 maxAmount must be a u64");
    expect(() => encodeRatelimitConfig({ ...config, rules: [{ ...rule, window: (1n << 64n) + 5n }] })).toThrow("rule 0 window must be a u64");
    expect(() => encodeRatelimitConfig({ ...config, maxAmountPerCall: 1n << 64n })).toThrow("maxAmountPerCall must be a u64");
    expect(() => encodeRatelimitConfig({ ...config, selectorValue: -3n })).toThrow("selectorValue must be a u64");
    expect(encodeRatelimitConfig({ ...config, rules: [{ ...rule, maxCalls: (1n << 64n) - 1n }] })).toBeInstanceOf(Uint8Array);
  });

  it("encodes CREATE_POLICY with its trailing proof", () => {
    const bytes = buildCreateRatelimitPolicyInstruction({
      policyAccountIdx: 2, metaAccountIdx: 3, admin, target, policyId: 1n, config, proof: Uint8Array.of(9, 8, 7),
    });
    const view = new DataView(bytes.buffer);
    expect(bytes.length).toBe(4 + 387 + 3);
    expect([view.getUint32(0, true), view.getUint16(4, true), view.getUint16(6, true)]).toEqual([0, 2, 3]);
    expect(bytes.slice(8, 40)).toEqual(admin);
    expect(bytes.slice(40, 72)).toEqual(target);
    expect(view.getBigUint64(72, true)).toBe(1n);
    expect(bytes.slice(80, 389)).toEqual(encodeRatelimitConfig(config));
    expect(view.getUint16(389, true)).toBe(3);
    expect([...bytes.slice(391)]).toEqual([9, 8, 7]);
    const unverified = buildCreateRatelimitPolicyInstruction({
      policyAccountIdx: 2, admin, target, policyId: 1n, config, proof: Uint8Array.of(1),
    });
    expect(new DataView(unverified.buffer).getUint16(6, true)).toBe(0xffff);
  });

  it("encodes SET_ADMIN", () => {
    const bytes = buildSetRatelimitAdminInstruction(4, admin);
    expect(bytes.length).toBe(4 + 34);
    expect(new DataView(bytes.buffer).getUint32(0, true)).toBe(2);
    expect(bytes.slice(6)).toEqual(admin);
  });

  it("matches the program's CALL header and bucket entry sizes", () => {
    // The ABI does not describe the whole CALL instruction, so the builder
    // concatenates generated pieces; their sizes must match the C structs.
    expect(CallArgs.footprint()).toBe(RATELIMIT_CALL_ARGS_SIZE);
    expect(RatelimitCallBucket.footprint()).toBe(RATELIMIT_CALL_BUCKET_SIZE);
  });

  it("lays out CALL as header, bucket entries, proofs and the forwarded instruction", () => {
    const inner = Uint8Array.of(0xaa, 0xbb, 0xcc);
    const bytes = buildRatelimitCallInstruction({
      policyAccountIdx: 2, targetAccountIdx: 1, inner,
      buckets: [{ bucketAccountIdx: 5, proof: Uint8Array.of(1, 2) }, { bucketAccountIdx: 6, key: recipient }],
    });
    const view = new DataView(bytes.buffer);
    expect(bytes.length).toBe(4 + RATELIMIT_CALL_ARGS_SIZE + 2 * RATELIMIT_CALL_BUCKET_SIZE + 2 + 3);
    expect([0, 4, 6, 8, 10].map((o) => o === 0 ? view.getUint32(0, true) : view.getUint16(o, true)))
      .toEqual([4, 2, 1, 0xffff, 3]);
    expect([view.getUint16(12, true), view.getUint16(14, true)]).toEqual([5, 2]);
    expect(bytes.slice(16, 48)).toEqual(new Uint8Array(32));
    expect([view.getUint16(48, true), view.getUint16(50, true)]).toEqual([6, 0]);
    expect(bytes.slice(52, 84)).toEqual(recipient);
    expect([...bytes.slice(84, 86)]).toEqual([1, 2]);
    expect(bytes.slice(86)).toEqual(inner);
  });
});

describe("rate limiter accounts", () => {
  it("parses policy and bucket accounts", () => {
    const policy = new Uint8Array(390);
    const pv = new DataView(policy.buffer);
    pv.setBigUint64(0, RATELIMIT_POLICY_MAGIC, true);
    policy.set(admin, 8); policy.set(target, 40);
    pv.setBigUint64(72, 9n, true);
    policy[80] = RATELIMIT_POLICY_FLAG_VERIFIED;
    policy.set(encodeRatelimitConfig(config), 81);
    const parsed = parseRatelimitPolicyAccount(policy)!;
    expect(parsed.admin).toBe(Pubkey.from(admin).toThruFmt());
    expect(parsed.target).toBe(Pubkey.from(target).toThruFmt());
    expect([parsed.policyId, parsed.stateFlags]).toEqual([9n, RATELIMIT_POLICY_FLAG_VERIFIED]);
    expect(parsed.config.rules).toHaveLength(2);
    expect(parsed.config.rules[1]).toMatchObject({ keyKind: 3, keyOffset: 6, window: 200n });
    expect(encodeRatelimitConfig(parsed.config)).toEqual(parsed.configBytes);
    expect(parseRatelimitPolicyAccount(policy.slice(1))).toBeNull();

    const bucket = new Uint8Array(113);
    const bv = new DataView(bucket.buffer);
    bv.setBigUint64(0, RATELIMIT_BUCKET_MAGIC, true);
    bucket[72] = 1;
    bv.setBigUint64(73, 4n, true); bv.setBigUint64(81, 2n, true); bv.setBigUint64(89, 300n, true);
    expect(parseRatelimitBucketAccount(bucket)).toMatchObject({ ruleIdx: 1, windowStart: 4n, calls: 2n, amount: 300n });
    bv.setBigUint64(0, RATELIMIT_POLICY_MAGIC, true);
    expect(parseRatelimitBucketAccount(bucket)).toBeNull();
  });
});
