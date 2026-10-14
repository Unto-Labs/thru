//! Client helpers for the rate limiter program (`tn_ratelimit_program`).
//!
//! Mirrors `programs/c/examples/tn_ratelimit_program.h`: account seeds,
//! the packed policy/bucket layouts and the CALL instruction encoding.

use anyhow::{bail, Result};
use sha2::{Digest, Sha256};

use crate::tn_public_address::create_program_defined_account_address;

pub const INSTRUCTION_CREATE_POLICY: u32 = 0;
pub const INSTRUCTION_UPDATE_POLICY: u32 = 1;
pub const INSTRUCTION_SET_ADMIN: u32 = 2;
pub const INSTRUCTION_CREATE_AUTHORITY: u32 = 3;
pub const INSTRUCTION_CALL: u32 = 4;

/// Sentinel account index meaning "no account" (e.g. no authority PDA).
pub const NO_ACCOUNT: u16 = 0xFFFF;

pub const RULE_MAX: usize = 4;
pub const CONSTRAINT_MAX: usize = 4;

pub const POLICY_MAGIC: u64 = 0x7261746C706F6C31;
pub const BUCKET_MAGIC: u64 = 0x7261746C62636B31;

pub const POLICY_FLAG_PAUSED: u8 = 0x01;
pub const POLICY_FLAG_VERIFIED: u8 = 0x80;

const POLICY_SEED_TAG: &[u8] = b"tn_ratelimit_policy_v1";
const VERIFIED_POLICY_SEED_TAG: &[u8] = b"tn_ratelimit_verified_policy_v1";
const BUCKET_SEED_TAG: &[u8] = b"tn_ratelimit_bucket_v1";
const AUTHORITY_SEED_TAG: &[u8] = b"tn_ratelimit_authority_v1";

/// Packed sizes, checked against the C structs in the runtime test.
pub const RULE_SIZE: usize = 28;
pub const CONSTRAINT_SIZE: usize = 34;
pub const CONFIG_SIZE: usize = 309;
pub const POLICY_SIZE: usize = 390;
pub const BUCKET_SIZE: usize = 113;
pub const CALL_ARGS_SIZE: usize = 8;
pub const CALL_BUCKET_SIZE: usize = 36;

const POLICY_CONFIG_OFFSET: usize = 81;
const CONFIG_ATTESTER_OFFSET: usize = 29;
const CONFIG_RULES_OFFSET: usize = 197;

/// Rate limiter error codes (`TN_RATELIMIT_ERR_*`).
pub const ERR_INVALID_INSTRUCTION: u64 = 0x5201;
pub const ERR_INVALID_ACCOUNT: u64 = 0x5202;
pub const ERR_INVALID_CONFIG: u64 = 0x5203;
pub const ERR_UNAUTHORIZED: u64 = 0x5204;
pub const ERR_CREATE_FAILED: u64 = 0x5205;
pub const ERR_WRITE_FAILED: u64 = 0x5206;
pub const ERR_PAUSED: u64 = 0x5207;
pub const ERR_TARGET_MISMATCH: u64 = 0x5208;
pub const ERR_INSTRUCTION_REJECTED: u64 = 0x5209;
pub const ERR_AMOUNT_PER_CALL_EXCEEDED: u64 = 0x520A;
pub const ERR_BUCKET_MISMATCH: u64 = 0x520B;
pub const ERR_ATTESTER_REQUIRED: u64 = 0x520C;
pub const ERR_CALL_LIMIT_EXCEEDED: u64 = 0x520D;
pub const ERR_AMOUNT_LIMIT_EXCEEDED: u64 = 0x520E;
pub const ERR_TARGET_FAILED: u64 = 0x520F;
/// Gate error a rate limited target returns when not invoked through the
/// rate limiter (`TN_RATELIMIT_GATE_ERR_NOT_RATE_LIMITED`).
pub const GATE_ERR_NOT_RATE_LIMITED: u64 = 0x52A1;

/// How a rule derives its bucket key.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum KeyKind {
    /// One bucket shared by every caller.
    Global,
    /// The transaction fee payer.
    FeePayer,
    /// The account named by the u16 account index at `key_offset` in the
    /// forwarded instruction.
    InstrAccount,
    /// A 32-byte key supplied by the caller; requires the policy attester.
    Attested,
}

impl KeyKind {
    fn from_u8(v: u8) -> Result<Self> {
        Ok(match v {
            0 => KeyKind::Global,
            1 => KeyKind::FeePayer,
            2 => KeyKind::InstrAccount,
            3 => KeyKind::Attested,
            _ => bail!("unknown rate limit key kind {}", v),
        })
    }
}

/// Window clock of a rule.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Clock {
    Slot,
    UnixSeconds,
}

impl Clock {
    fn from_u8(v: u8) -> Result<Self> {
        Ok(match v {
            0 => Clock::Slot,
            1 => Clock::UnixSeconds,
            _ => bail!("unknown rate limit clock {}", v),
        })
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Rule {
    pub key_kind: KeyKind,
    pub clock: Clock,
    pub key_offset: u16,
    pub window: u64,
    pub max_calls: u64,
    pub max_amount: u64,
}

/// The parts of a policy account a client needs to build a CALL.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Policy {
    pub admin: [u8; 32],
    pub target: [u8; 32],
    pub policy_id: u64,
    pub state_flags: u8,
    pub config_flags: u8,
    pub attester: [u8; 32],
    pub rules: Vec<Rule>,
}

impl Policy {
    pub fn is_verified(&self) -> bool {
        self.state_flags & POLICY_FLAG_VERIFIED != 0
    }

    pub fn is_paused(&self) -> bool {
        self.config_flags & POLICY_FLAG_PAUSED != 0
    }

    /// Parses policy account data.
    pub fn parse(data: &[u8]) -> Result<Self> {
        if data.len() != POLICY_SIZE {
            bail!("rate limit policy has {} bytes, expected {}", data.len(), POLICY_SIZE);
        }
        if u64_at(data, 0) != POLICY_MAGIC {
            bail!("account is not a rate limit policy");
        }
        let cfg = &data[POLICY_CONFIG_OFFSET..];
        let rule_cnt = cfg[1] as usize;
        if rule_cnt == 0 || rule_cnt > RULE_MAX {
            bail!("rate limit policy has invalid rule count {}", rule_cnt);
        }
        let mut rules = Vec::with_capacity(rule_cnt);
        for i in 0..rule_cnt {
            let r = &cfg[CONFIG_RULES_OFFSET + i * RULE_SIZE..];
            rules.push(Rule {
                key_kind: KeyKind::from_u8(r[0])?,
                clock: Clock::from_u8(r[1])?,
                key_offset: u16::from_le_bytes([r[2], r[3]]),
                window: u64_at(r, 4),
                max_calls: u64_at(r, 12),
                max_amount: u64_at(r, 20),
            });
        }
        Ok(Policy {
            admin: data[8..40].try_into().unwrap(),
            target: data[40..72].try_into().unwrap(),
            policy_id: u64_at(data, 72),
            state_flags: data[80],
            config_flags: cfg[0],
            attester: cfg[CONFIG_ATTESTER_OFFSET..CONFIG_ATTESTER_OFFSET + 32].try_into().unwrap(),
            rules,
        })
    }
}

/// Counters of one bucket account.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Bucket {
    pub policy: [u8; 32],
    pub key: [u8; 32],
    pub rule_idx: u8,
    /// Start of the counted window, in the rule's clock.
    pub window_start: u64,
    pub calls: u64,
    pub amount: u64,
}

impl Bucket {
    pub fn parse(data: &[u8]) -> Result<Self> {
        if data.len() != BUCKET_SIZE || u64_at(data, 0) != BUCKET_MAGIC {
            bail!("account is not a rate limit bucket");
        }
        Ok(Bucket {
            policy: data[8..40].try_into().unwrap(),
            key: data[40..72].try_into().unwrap(),
            rule_idx: data[72],
            window_start: u64_at(data, 73),
            calls: u64_at(data, 81),
            amount: u64_at(data, 89),
        })
    }

    /// Calls and amount the program would count against `rule` at `now`
    /// (in the rule's clock): zero once the window has rolled forward, the
    /// stored counters otherwise. Mirrors `charge_bucket`.
    pub fn usage_at(&self, rule: &Rule, now: u64) -> (u64, u64) {
        if window_start(now, rule.window) > self.window_start || other_clock(rule, now, self.window_start) {
            (0, 0)
        } else {
            (self.calls, self.amount)
        }
    }
}

/// When (in `rule`'s clock) counters seen at `now` reset: the first window
/// boundary after both `now` and the bucket's stored window start (0 for a
/// bucket that doesn't exist yet).
pub fn resets_at(rule: &Rule, now: u64, stored_start: u64) -> u64 {
    let start = if other_clock(rule, now, stored_start) { now } else { now.max(stored_start) };
    window_start(start, rule.window).saturating_add(rule.window)
}

/// Whether a stored window start more than one window ahead of `now` was
/// written under the rule's other clock; `charge_bucket` restarts such a
/// bucket.
fn other_clock(rule: &Rule, now: u64, stored_start: u64) -> bool {
    stored_start > now && stored_start - now > rule.window
}

/// Start of the window of length `window` holding `now`.
pub fn window_start(now: u64, window: u64) -> u64 {
    now - now % window
}

fn u64_at(data: &[u8], off: usize) -> u64 {
    u64::from_le_bytes(data[off..off + 8].try_into().unwrap())
}

/// PDA of the rate limiter whose seed is sha256 over `parts`.
fn pda(ratelimit_program: &[u8; 32], parts: &[&[u8]]) -> [u8; 32] {
    let mut h = Sha256::new();
    for part in parts {
        h.update(part);
    }
    let seed: [u8; 32] = h.finalize().into();
    create_program_defined_account_address(ratelimit_program, false, &seed)
}

/// Address of the VERIFIED policy `policy_id` of `target`.
pub fn verified_policy_address(ratelimit_program: &[u8; 32], target: &[u8; 32], policy_id: u64) -> [u8; 32] {
    pda(ratelimit_program, &[VERIFIED_POLICY_SEED_TAG, target, &policy_id.to_le_bytes()])
}

/// Address of the unverified policy `policy_id` of `target` created by `admin`.
pub fn policy_address(ratelimit_program: &[u8; 32], admin: &[u8; 32], target: &[u8; 32], policy_id: u64) -> [u8; 32] {
    pda(ratelimit_program, &[POLICY_SEED_TAG, admin, target, &policy_id.to_le_bytes()])
}

/// Address of rule `rule_idx`'s bucket for `key` under `policy`.
pub fn bucket_address(ratelimit_program: &[u8; 32], policy: &[u8; 32], rule_idx: u8, key: &[u8; 32]) -> [u8; 32] {
    pda(ratelimit_program, &[BUCKET_SEED_TAG, policy, &[rule_idx], key])
}

/// Address of the authority PDA the rate limiter signs for under `policy`.
pub fn authority_address(ratelimit_program: &[u8; 32], policy: &[u8; 32]) -> [u8; 32] {
    pda(ratelimit_program, &[AUTHORITY_SEED_TAG, policy])
}

/// One rule's bucket in a CALL. `proof` is a creation state proof when the
/// bucket doesn't exist yet, empty otherwise. `key` is only non-zero for
/// ATTESTED rules.
#[derive(Clone, Debug)]
pub struct CallBucket {
    pub account_idx: u16,
    pub proof: Vec<u8>,
    pub key: [u8; 32],
}

/// Encodes a CALL instruction forwarding `inner` to the target.
pub fn build_call_instruction(
    policy_idx: u16,
    target_idx: u16,
    authority_idx: u16,
    buckets: &[CallBucket],
    inner: &[u8],
) -> Result<Vec<u8>> {
    if buckets.is_empty() || buckets.len() > RULE_MAX {
        bail!("rate limit CALL needs 1..={} buckets, got {}", RULE_MAX, buckets.len());
    }
    let inner_sz = u16::try_from(inner.len())?;
    let proofs_sz: usize = buckets.iter().map(|b| b.proof.len()).sum();
    let mut data =
        Vec::with_capacity(4 + CALL_ARGS_SIZE + buckets.len() * CALL_BUCKET_SIZE + proofs_sz + inner.len());
    data.extend_from_slice(&INSTRUCTION_CALL.to_le_bytes());
    data.extend_from_slice(&policy_idx.to_le_bytes());
    data.extend_from_slice(&target_idx.to_le_bytes());
    data.extend_from_slice(&authority_idx.to_le_bytes());
    data.extend_from_slice(&inner_sz.to_le_bytes());
    for b in buckets {
        data.extend_from_slice(&b.account_idx.to_le_bytes());
        data.extend_from_slice(&u16::try_from(b.proof.len())?.to_le_bytes());
        data.extend_from_slice(&b.key);
    }
    for b in buckets {
        data.extend_from_slice(&b.proof);
    }
    data.extend_from_slice(inner);
    Ok(data)
}

/// Human readable name of a rate limiter (or gate) error code.
pub fn error_name(code: u64) -> Option<&'static str> {
    Some(match code {
        ERR_INVALID_INSTRUCTION => "invalid instruction",
        ERR_INVALID_ACCOUNT => "invalid account",
        ERR_INVALID_CONFIG => "invalid policy config",
        ERR_UNAUTHORIZED => "unauthorized",
        ERR_CREATE_FAILED => "account creation failed",
        ERR_WRITE_FAILED => "account write failed",
        ERR_PAUSED => "policy paused",
        ERR_TARGET_MISMATCH => "target mismatch",
        ERR_INSTRUCTION_REJECTED => "instruction rejected by policy",
        ERR_AMOUNT_PER_CALL_EXCEEDED => "amount per call exceeded",
        ERR_BUCKET_MISMATCH => "bucket mismatch",
        ERR_ATTESTER_REQUIRED => "attester required",
        ERR_CALL_LIMIT_EXCEEDED => "call limit reached for this window",
        ERR_AMOUNT_LIMIT_EXCEEDED => "amount limit reached for this window",
        ERR_TARGET_FAILED => "target failed",
        GATE_ERR_NOT_RATE_LIMITED => "target requires the rate limiter",
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_policy() -> Vec<u8> {
        let mut d = vec![0u8; POLICY_SIZE];
        d[0..8].copy_from_slice(&POLICY_MAGIC.to_le_bytes());
        d[8..40].copy_from_slice(&[1u8; 32]);
        d[40..72].copy_from_slice(&[2u8; 32]);
        d[72..80].copy_from_slice(&7u64.to_le_bytes());
        d[80] = POLICY_FLAG_VERIFIED;
        let cfg = POLICY_CONFIG_OFFSET;
        d[cfg + 1] = 2;
        d[cfg + CONFIG_ATTESTER_OFFSET..cfg + CONFIG_ATTESTER_OFFSET + 32].copy_from_slice(&[3u8; 32]);
        let r1 = cfg + CONFIG_RULES_OFFSET + RULE_SIZE;
        d[r1] = 2;
        d[r1 + 1] = 1;
        d[r1 + 2..r1 + 4].copy_from_slice(&6u16.to_le_bytes());
        d[r1 + 4..r1 + 12].copy_from_slice(&86400u64.to_le_bytes());
        d[r1 + 12..r1 + 20].copy_from_slice(&5u64.to_le_bytes());
        d[r1 + 20..r1 + 28].copy_from_slice(&50000u64.to_le_bytes());
        d
    }

    #[test]
    fn layout_sizes_add_up() {
        assert_eq!(CONFIG_SIZE, 1 + 1 + 1 + 1 + 2 + 8 + 2 + 2 + 1 + 2 + 8 + 32 + CONSTRAINT_MAX * CONSTRAINT_SIZE + RULE_MAX * RULE_SIZE);
        assert_eq!(POLICY_SIZE, 8 + 32 + 32 + 8 + 1 + CONFIG_SIZE);
        assert_eq!(CONFIG_RULES_OFFSET, CONFIG_ATTESTER_OFFSET + 32 + CONSTRAINT_MAX * CONSTRAINT_SIZE);
        assert_eq!(BUCKET_SIZE, 8 + 32 + 32 + 1 + 8 * 5);
    }

    #[test]
    fn parses_policy() {
        let p = Policy::parse(&sample_policy()).unwrap();
        assert!(p.is_verified());
        assert!(!p.is_paused());
        assert_eq!(p.policy_id, 7);
        assert_eq!(p.attester, [3u8; 32]);
        assert_eq!(p.rules.len(), 2);
        assert_eq!(p.rules[0].key_kind, KeyKind::Global);
        assert_eq!(
            p.rules[1],
            Rule { key_kind: KeyKind::InstrAccount, clock: Clock::UnixSeconds, key_offset: 6, window: 86400, max_calls: 5, max_amount: 50000 }
        );
        assert!(Policy::parse(&sample_policy()[1..]).is_err());
    }

    #[test]
    fn encodes_call() {
        let buckets = [
            CallBucket { account_idx: 4, proof: vec![9, 9, 9], key: [0u8; 32] },
            CallBucket { account_idx: 5, proof: vec![], key: [8u8; 32] },
        ];
        let data = build_call_instruction(3, 6, NO_ACCOUNT, &buckets, &[1, 2]).unwrap();
        assert_eq!(data.len(), 4 + CALL_ARGS_SIZE + 2 * CALL_BUCKET_SIZE + 3 + 2);
        assert_eq!(&data[0..4], &INSTRUCTION_CALL.to_le_bytes());
        assert_eq!(&data[4..12], &[3, 0, 6, 0, 0xFF, 0xFF, 2, 0]);
        assert_eq!(&data[12..16], &[4, 0, 3, 0]);
        assert_eq!(&data[48 + 4..48 + 36], &[8u8; 32]);
        assert_eq!(&data[84..87], &[9, 9, 9]);
        assert_eq!(&data[87..], &[1, 2]);
    }

    /// Known answer shared with the C runtime test: the faucet's VERIFIED
    /// policy 0 and its global bucket under the bootstrap addresses.
    #[test]
    fn faucet_policy_known_answer() {
        use crate::bootstrap_addresses::{FAUCET_PROGRAM_BYTES, RATELIMIT_PROGRAM_BYTES};
        let policy = verified_policy_address(&RATELIMIT_PROGRAM_BYTES, &FAUCET_PROGRAM_BYTES, 0);
        assert_eq!(hex::encode(policy), "0ebbd33cb84c5ae46c0b20009f2366e69924ae599e82c1ebc18b094351a806f7");
        assert_eq!(policy, crate::bootstrap_addresses::FAUCET_RATE_LIMIT_POLICY_BYTES);
        let bucket = bucket_address(&RATELIMIT_PROGRAM_BYTES, &policy, 0, &[0u8; 32]);
        assert_eq!(hex::encode(bucket), "a9dc2788f1685f9f4f1b8b243b5cc1744c36971698280ea851628163055a69de");
    }

    fn bucket(window_start: u64) -> Bucket {
        Bucket { policy: [0u8; 32], key: [0u8; 32], rule_idx: 0, window_start, calls: 3, amount: 300 }
    }

    fn rule(clock: Clock, window: u64) -> Rule {
        Rule { key_kind: KeyKind::Global, clock, key_offset: 0, window, max_calls: 3, max_amount: 0 }
    }

    #[test]
    fn bucket_usage_follows_window_start() {
        let hourly = rule(Clock::UnixSeconds, 3_600);
        let now = 1_700_000_000;
        let hour = window_start(now, 3_600);
        assert_eq!(bucket(hour).usage_at(&hourly, now), (3, 300));
        assert_eq!(bucket(hour - 3_600).usage_at(&hourly, now), (0, 0));
        assert_eq!(resets_at(&hourly, now, hour), hour + 3_600);
        /* A clock slightly behind keeps the newest window. */
        assert_eq!(bucket(hour + 3_600).usage_at(&hourly, now), (3, 300));
        assert_eq!(resets_at(&hourly, now, hour + 3_600), hour + 7_200);
    }

    /// UPDATE_POLICY grew the window from an hour to a day: the counters
    /// last until the next day boundary rather than for 24x as many hours.
    #[test]
    fn bucket_usage_after_window_grows() {
        let daily = rule(Clock::UnixSeconds, 86_400);
        let now = 1_700_000_000;
        let stored = bucket(window_start(now, 3_600));
        let day_end = window_start(now, 86_400) + 86_400;
        assert_eq!(stored.usage_at(&daily, now), (3, 300));
        assert_eq!(resets_at(&daily, now, stored.window_start), day_end);
        assert_eq!(stored.usage_at(&daily, day_end), (0, 0));
    }

    /// UPDATE_POLICY switched the rule from seconds to slots: the stored
    /// block time start is far ahead of any slot, so the bucket restarts.
    #[test]
    fn bucket_usage_after_clock_switch() {
        let slots = rule(Clock::Slot, 1_000);
        let stored = bucket(window_start(1_700_000_000, 3_600));
        assert_eq!(stored.usage_at(&slots, 5_000), (0, 0));
        /* Retry estimates count from the slot window, not the old block time. */
        assert_eq!(resets_at(&slots, 5_000, stored.window_start), 6_000);
    }

    #[test]
    fn verified_and_admin_policies_differ() {
        let rl = [0x44u8; 32];
        let target = [0x14u8; 32];
        assert_ne!(verified_policy_address(&rl, &target, 0), policy_address(&rl, &[0u8; 32], &target, 0));
        assert_ne!(verified_policy_address(&rl, &target, 0), verified_policy_address(&rl, &target, 1));
    }
}
