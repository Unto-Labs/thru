//! Client-side support for the on-chain multisig program
//! (`programs/c/examples/tn_multisig_program.{c,h}`).
//!
//! Encoders and decoders mirror the packed structs in
//! `tn_multisig_program.h` byte for byte. `MultisigLayout` builds the sorted
//! transaction account list that both `CREATE_REQUEST` and `EXECUTE_REQUEST`
//! must share: the program stores the account indices of an `INVOKE` request
//! when it is proposed and requires the same pubkeys at the same indices when
//! it is executed.

use crate::txn_lib::{TnPubkey, Transaction};
use crate::txn_tools::account_state_units;
use anyhow::{Result, anyhow, bail, ensure};
use sha2::{Digest, Sha256};

/// Account discriminators: byte 0 of every account the multisig program owns
/// (`TN_MULTISIG_ACCOUNT_TYPE_*_V1`). Values are never reused.
pub const ACCOUNT_TYPE_MULTISIG_V1: u8 = 1;
pub const ACCOUNT_TYPE_REQUEST_V1: u8 = 2;
pub const MAX_MEMBERS: usize = 32;
pub const MIN_MEMBERS: usize = 2;
pub const MAX_REQUEST_DATA_SZ: usize = 4096;
pub const MAX_LIVE_REQUESTS: u16 = 65535;

pub const INSTR_CREATE_MULTISIG: u32 = 0;
pub const INSTR_CREATE_REQUEST: u32 = 1;
pub const INSTR_APPROVE_REQUEST: u32 = 2;
pub const INSTR_EXECUTE_REQUEST: u32 = 3;
pub const INSTR_DELETE_REQUEST: u32 = 4;

pub const KIND_INVOKE: u8 = 0;
pub const KIND_UPDATE_THRESHOLD: u8 = 1;
pub const KIND_UPDATE_MEMBERSHIP: u8 = 2;
pub const KIND_DELETE_MULTISIG: u8 = 3;

pub const REQUEST_STATUS_OPEN: u8 = 0;

/// Size of the packed `tn_multisig_account_t`.
pub const MULTISIG_ACCOUNT_SZ: usize = 24 + 32 * MAX_MEMBERS;
/// Size of the packed `tn_multisig_request_header_t`.
pub const REQUEST_HEADER_SZ: usize = 40 + 32 + 32;
/// Size of the packed `tn_multisig_invoke_request_t` (without trailing data).
const INVOKE_HEADER_SZ: usize = 2 + 2 + 8 + 32;

/// Program error codes (`TN_MULTISIG_ERR_*`), as (code, name, message).
pub const ERRORS: &[(u64, &str, &str)] = &[
    (
        0x01,
        "INVALID_INSTRUCTION",
        "malformed multisig instruction",
    ),
    (
        0x02,
        "INVALID_ACCOUNT",
        "account is not a multisig/request of this program",
    ),
    (
        0x03,
        "INVALID_STATE",
        "multisig or request account is in an invalid state",
    ),
    (
        0x04,
        "UNAUTHORIZED",
        "signer is not authorized for this action",
    ),
    (
        0x05,
        "ACCOUNT_CREATE_FAILED",
        "could not create the account (already exists or bad proof)",
    ),
    (
        0x06,
        "ACCOUNT_RESIZE_FAILED",
        "could not resize the account",
    ),
    (0x07, "ACCOUNT_WRITE_FAILED", "could not write the account"),
    (
        0x08,
        "INVALID_MEMBER_COUNT",
        "member count must be between 2 and 32",
    ),
    (
        0x09,
        "INVALID_THRESHOLD",
        "threshold must be between 1 and the member count",
    ),
    (0x0A, "DUPLICATE_MEMBER", "member list contains a duplicate"),
    (
        0x0B,
        "NOT_A_MEMBER",
        "signer is not a member of this multisig",
    ),
    (
        0x0C,
        "DUPLICATE_APPROVAL",
        "this member already approved the request",
    ),
    (
        0x0D,
        "REQUEST_STALE",
        "the multisig changed after this request was proposed",
    ),
    (0x0E, "REQUEST_NOT_OPEN", "the request is not open"),
    (
        0x0F,
        "REQUEST_NOT_APPROVED",
        "the request does not have enough approvals yet",
    ),
    (0x10, "INVALID_REQUEST_KIND", "unknown request kind"),
    (
        0x11,
        "INVALID_REQUEST_DATA",
        "request data is malformed or accounts do not match",
    ),
    (0x12, "REQUEST_TOO_LARGE", "request data exceeds 4096 bytes"),
    (0x13, "CPI_FAILED", "the invoked program failed"),
    (
        0x14,
        "REQUEST_NOT_DELETABLE",
        "only the proposer can cancel before approvals; anyone once stale",
    ),
    (
        0x15,
        "OUTSTANDING_REQUESTS",
        "other requests are still live; cancel or execute them first",
    ),
    (0x16, "TOO_MANY_REQUESTS", "too many live requests"),
];

/// Looks up a multisig program error code.
pub fn error_info(code: u64) -> Option<(&'static str, &'static str)> {
    ERRORS
        .iter()
        .find(|(c, _, _)| *c == code)
        .map(|(_, name, msg)| (*name, *msg))
}

pub fn kind_name(kind: u8) -> &'static str {
    match kind {
        KIND_INVOKE => "invoke",
        KIND_UPDATE_THRESHOLD => "set-threshold",
        KIND_UPDATE_MEMBERSHIP => "set-members",
        KIND_DELETE_MULTISIG => "delete-multisig",
        _ => "unknown",
    }
}

/// Approvals a request of `kind` needs: config changes need a strict
/// majority of all members, invokes need the threshold.
pub fn required_approvals(kind: u8, member_cnt: u16, threshold: u16) -> u16 {
    if kind == KIND_INVOKE {
        threshold
    } else {
        member_cnt / 2 + 1
    }
}

/* ---------- address derivation ---------- */

/// Address of a non-ephemeral account created by `program` with `seed`
/// (matches `tsys_account_create`).
pub fn derive_account(program: &TnPubkey, seed: &[u8; 32]) -> TnPubkey {
    let mut h = Sha256::new();
    h.update(program);
    h.update([0u8]);
    h.update(seed);
    let out = h.finalize();
    let mut addr = [0u8; 32];
    addr.copy_from_slice(&out[..32]);
    addr
}

/// Turns a user-supplied seed string into 32 seed bytes. A 64-char hex
/// string is used as is; anything else is hashed so any label works.
pub fn seed_from_str(seed: &str) -> [u8; 32] {
    if seed.len() == 64 {
        if let Ok(bytes) = hex::decode(seed) {
            let mut out = [0u8; 32];
            out.copy_from_slice(&bytes);
            return out;
        }
    }
    let mut h = Sha256::new();
    h.update(b"tn_multisig_seed");
    h.update(seed.as_bytes());
    let out = h.finalize();
    let mut s = [0u8; 32];
    s.copy_from_slice(&out[..32]);
    s
}

/// Deterministic seed for the request with id `request_id` of `multisig`.
pub fn request_seed(multisig: &TnPubkey, request_id: u64, attempt: u32) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(b"tn_multisig_request");
    h.update(multisig);
    h.update(request_id.to_le_bytes());
    if attempt != 0 {
        h.update(attempt.to_le_bytes());
    }
    let out = h.finalize();
    let mut s = [0u8; 32];
    s.copy_from_slice(&out[..32]);
    s
}

/* ---------- instruction encoders ---------- */

pub fn encode_create_multisig(
    multisig_idx: u16,
    creator_idx: u16,
    members: &[TnPubkey],
    threshold: u16,
    seed: &[u8; 32],
    proof: &[u8],
) -> Vec<u8> {
    let mut d = Vec::with_capacity(52 + members.len() * 32 + proof.len());
    d.extend_from_slice(&INSTR_CREATE_MULTISIG.to_le_bytes());
    d.extend_from_slice(&multisig_idx.to_le_bytes());
    d.extend_from_slice(&creator_idx.to_le_bytes());
    d.extend_from_slice(&(members.len() as u16).to_le_bytes());
    d.extend_from_slice(&threshold.to_le_bytes());
    d.extend_from_slice(seed);
    d.extend_from_slice(&(proof.len() as u64).to_le_bytes());
    for m in members {
        d.extend_from_slice(m);
    }
    d.extend_from_slice(proof);
    d
}

pub fn encode_create_request(
    multisig_idx: u16,
    request_idx: u16,
    proposer_idx: u16,
    kind: u8,
    seed: &[u8; 32],
    request_data: &[u8],
    proof: &[u8],
) -> Vec<u8> {
    let mut d = Vec::with_capacity(60 + request_data.len() + proof.len());
    d.extend_from_slice(&INSTR_CREATE_REQUEST.to_le_bytes());
    d.extend_from_slice(&multisig_idx.to_le_bytes());
    d.extend_from_slice(&request_idx.to_le_bytes());
    d.extend_from_slice(&proposer_idx.to_le_bytes());
    d.push(kind);
    d.push(0);
    d.extend_from_slice(seed);
    d.extend_from_slice(&(request_data.len() as u64).to_le_bytes());
    d.extend_from_slice(&(proof.len() as u64).to_le_bytes());
    d.extend_from_slice(request_data);
    d.extend_from_slice(proof);
    d
}

/// `APPROVE_REQUEST`. The program only counts the approval for the request
/// whose `request_id` and `sha256(request data)` match, so an approval can't
/// land on a request recreated at the same address after it was reviewed.
pub fn encode_approve_request(
    multisig_idx: u16,
    request_idx: u16,
    approver_idx: u16,
    expected_request_id: u64,
    expected_request_hash: &[u8; 32],
) -> Vec<u8> {
    let mut d = Vec::with_capacity(50);
    d.extend_from_slice(&INSTR_APPROVE_REQUEST.to_le_bytes());
    d.extend_from_slice(&multisig_idx.to_le_bytes());
    d.extend_from_slice(&request_idx.to_le_bytes());
    d.extend_from_slice(&approver_idx.to_le_bytes());
    d.extend_from_slice(&expected_request_id.to_le_bytes());
    d.extend_from_slice(expected_request_hash);
    d
}

/// The hash an approval names: `sha256(request data)` as stored on chain.
pub fn request_data_hash(request_data: &[u8]) -> [u8; 32] {
    let out = Sha256::digest(request_data);
    let mut h = [0u8; 32];
    h.copy_from_slice(&out[..32]);
    h
}

pub fn encode_execute_request(multisig_idx: u16, request_idx: u16) -> Vec<u8> {
    let mut d = Vec::with_capacity(8);
    d.extend_from_slice(&INSTR_EXECUTE_REQUEST.to_le_bytes());
    d.extend_from_slice(&multisig_idx.to_le_bytes());
    d.extend_from_slice(&request_idx.to_le_bytes());
    d
}

pub fn encode_delete_request(multisig_idx: u16, request_idx: u16, requester_idx: u16) -> Vec<u8> {
    let mut d = Vec::with_capacity(10);
    d.extend_from_slice(&INSTR_DELETE_REQUEST.to_le_bytes());
    d.extend_from_slice(&multisig_idx.to_le_bytes());
    d.extend_from_slice(&request_idx.to_le_bytes());
    d.extend_from_slice(&requester_idx.to_le_bytes());
    d
}

/* ---------- request payloads ---------- */

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InvokePayload {
    pub target_program_idx: u16,
    pub target_program: TnPubkey,
    /// (account index, pubkey) for every account the child instruction uses.
    pub refs: Vec<(u16, TnPubkey)>,
    pub instr_data: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RequestPayload {
    Invoke(InvokePayload),
    UpdateThreshold { new_threshold: u16 },
    UpdateMembership { members: Vec<TnPubkey> },
    DeleteMultisig,
}

impl RequestPayload {
    pub fn kind(&self) -> u8 {
        match self {
            RequestPayload::Invoke(_) => KIND_INVOKE,
            RequestPayload::UpdateThreshold { .. } => KIND_UPDATE_THRESHOLD,
            RequestPayload::UpdateMembership { .. } => KIND_UPDATE_MEMBERSHIP,
            RequestPayload::DeleteMultisig => KIND_DELETE_MULTISIG,
        }
    }

    pub fn encode(&self) -> Vec<u8> {
        match self {
            RequestPayload::Invoke(p) => {
                let mut d = Vec::new();
                d.extend_from_slice(&p.target_program_idx.to_le_bytes());
                d.extend_from_slice(&(p.refs.len() as u16).to_le_bytes());
                d.extend_from_slice(&(p.instr_data.len() as u64).to_le_bytes());
                d.extend_from_slice(&p.target_program);
                for (idx, _) in &p.refs {
                    d.extend_from_slice(&idx.to_le_bytes());
                }
                for (_, key) in &p.refs {
                    d.extend_from_slice(key);
                }
                d.extend_from_slice(&p.instr_data);
                d
            }
            RequestPayload::UpdateThreshold { new_threshold } => {
                let mut d = new_threshold.to_le_bytes().to_vec();
                d.extend_from_slice(&0u16.to_le_bytes());
                d
            }
            RequestPayload::UpdateMembership { members } => {
                let mut d = (members.len() as u16).to_le_bytes().to_vec();
                d.extend_from_slice(&0u16.to_le_bytes());
                for m in members {
                    d.extend_from_slice(m);
                }
                d
            }
            RequestPayload::DeleteMultisig => Vec::new(),
        }
    }

    pub fn decode(kind: u8, data: &[u8]) -> Result<Self> {
        match kind {
            KIND_INVOKE => {
                ensure!(data.len() >= INVOKE_HEADER_SZ, "invoke payload too short");
                let target_program_idx = u16_at(data, 0);
                let ref_cnt = u16_at(data, 2) as usize;
                let instr_sz = u64_at(data, 4) as usize;
                let target_program = key_at(data, 12);
                let idxs_off = INVOKE_HEADER_SZ;
                let keys_off = idxs_off + ref_cnt * 2;
                let data_off = keys_off + ref_cnt * 32;
                ensure!(
                    data.len() == data_off + instr_sz,
                    "invoke payload size mismatch ({} != {})",
                    data.len(),
                    data_off + instr_sz
                );
                let refs = (0..ref_cnt)
                    .map(|i| {
                        (
                            u16_at(data, idxs_off + i * 2),
                            key_at(data, keys_off + i * 32),
                        )
                    })
                    .collect();
                Ok(RequestPayload::Invoke(InvokePayload {
                    target_program_idx,
                    target_program,
                    refs,
                    instr_data: data[data_off..].to_vec(),
                }))
            }
            KIND_UPDATE_THRESHOLD => {
                ensure!(data.len() == 4, "set-threshold payload must be 4 bytes");
                Ok(RequestPayload::UpdateThreshold {
                    new_threshold: u16_at(data, 0),
                })
            }
            KIND_UPDATE_MEMBERSHIP => {
                ensure!(data.len() >= 4, "set-members payload too short");
                let cnt = u16_at(data, 0) as usize;
                ensure!(
                    data.len() == 4 + cnt * 32,
                    "set-members payload size mismatch"
                );
                Ok(RequestPayload::UpdateMembership {
                    members: (0..cnt).map(|i| key_at(data, 4 + i * 32)).collect(),
                })
            }
            KIND_DELETE_MULTISIG => Ok(RequestPayload::DeleteMultisig),
            other => bail!("unknown request kind {}", other),
        }
    }
}

/* ---------- account decoders ---------- */

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MultisigAccount {
    pub account_type: u8,
    pub flags: u8,
    pub threshold: u16,
    pub live_request_cnt: u16,
    pub config_epoch: u64,
    pub next_request_id: u64,
    /// Sorted, as stored on chain. Bit `i` of a request's approval bitmap is
    /// `members[i]`.
    pub members: Vec<TnPubkey>,
}

impl MultisigAccount {
    pub fn decode(data: &[u8]) -> Result<Self> {
        ensure!(
            data.len() >= 24,
            "multisig account data too short ({} bytes)",
            data.len()
        );
        let account_type = data[0];
        ensure!(
            account_type == ACCOUNT_TYPE_MULTISIG_V1,
            "account type {} is not a multisig account (expected {})",
            account_type,
            ACCOUNT_TYPE_MULTISIG_V1
        );
        let member_cnt = u16_at(data, 2) as usize;
        ensure!(
            member_cnt <= MAX_MEMBERS,
            "invalid member count {}",
            member_cnt
        );
        ensure!(
            data.len() >= 24 + member_cnt * 32,
            "multisig account data truncated"
        );
        Ok(MultisigAccount {
            account_type,
            flags: data[1],
            threshold: u16_at(data, 4),
            live_request_cnt: u16_at(data, 6),
            config_epoch: u64_at(data, 8),
            next_request_id: u64_at(data, 16),
            members: (0..member_cnt).map(|i| key_at(data, 24 + i * 32)).collect(),
        })
    }

    pub fn member_index(&self, key: &TnPubkey) -> Option<usize> {
        self.members.iter().position(|m| m == key)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RequestAccount {
    pub account_type: u8,
    pub kind: u8,
    pub status: u8,
    pub member_cnt_snapshot: u16,
    pub required_approvals: u16,
    pub request_id: u64,
    pub config_epoch_snapshot: u64,
    pub approval_bitmap: u64,
    pub multisig: TnPubkey,
    pub proposer: TnPubkey,
    pub payload: RequestPayload,
    /// The request data exactly as stored (what approvals hash).
    pub raw_payload: Vec<u8>,
}

impl RequestAccount {
    pub fn decode(data: &[u8]) -> Result<Self> {
        ensure!(
            data.len() >= REQUEST_HEADER_SZ,
            "request account data too short ({} bytes)",
            data.len()
        );
        let account_type = data[0];
        ensure!(
            account_type == ACCOUNT_TYPE_REQUEST_V1,
            "account type {} is not a multisig request account (expected {})",
            account_type,
            ACCOUNT_TYPE_REQUEST_V1
        );
        let kind = data[1];
        let data_sz = u64_at(data, 32) as usize;
        ensure!(
            data.len() >= REQUEST_HEADER_SZ + data_sz,
            "request account data truncated"
        );
        let raw_payload = data[REQUEST_HEADER_SZ..REQUEST_HEADER_SZ + data_sz].to_vec();
        let payload = RequestPayload::decode(kind, &raw_payload)?;
        Ok(RequestAccount {
            account_type,
            kind,
            status: data[2],
            member_cnt_snapshot: u16_at(data, 4),
            required_approvals: u16_at(data, 6),
            request_id: u64_at(data, 8),
            config_epoch_snapshot: u64_at(data, 16),
            approval_bitmap: u64_at(data, 24),
            multisig: key_at(data, 40),
            proposer: key_at(data, 72),
            payload,
            raw_payload,
        })
    }

    /// `sha256` of the stored request data, as an approval must name it.
    pub fn data_hash(&self) -> [u8; 32] {
        request_data_hash(&self.raw_payload)
    }

    pub fn approval_count(&self) -> u32 {
        self.approval_bitmap.count_ones()
    }

    pub fn has_approved(&self, member_idx: usize) -> bool {
        member_idx < 64 && (self.approval_bitmap >> member_idx) & 1 == 1
    }

    pub fn is_stale(&self, multisig: &MultisigAccount) -> bool {
        self.config_epoch_snapshot != multisig.config_epoch
    }

    /// Members (from the current multisig state) who approved.
    pub fn approvers(&self, multisig: &MultisigAccount) -> Vec<TnPubkey> {
        multisig
            .members
            .iter()
            .enumerate()
            .filter(|(i, _)| self.has_approved(*i))
            .map(|(_, k)| *k)
            .collect()
    }
}

/* ---------- transaction layout ---------- */

/// The account list of a multisig program transaction: fee payer at 0, the
/// multisig program at 1, then read-write accounts sorted, then read-only
/// accounts sorted.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MultisigLayout {
    pub fee_payer: TnPubkey,
    pub program: TnPubkey,
    pub rw: Vec<TnPubkey>,
    pub ro: Vec<TnPubkey>,
}

impl MultisigLayout {
    /// Builds a layout. Duplicates are merged (read-write wins), and the fee
    /// payer and program are dropped from the lists since they have fixed
    /// slots.
    pub fn new(fee_payer: TnPubkey, program: TnPubkey, rw: &[TnPubkey], ro: &[TnPubkey]) -> Self {
        let keep = |k: &TnPubkey| *k != fee_payer && *k != program;
        let mut rw_v: Vec<TnPubkey> = rw.iter().copied().filter(keep).collect();
        rw_v.sort();
        rw_v.dedup();
        let mut ro_v: Vec<TnPubkey> = ro
            .iter()
            .copied()
            .filter(keep)
            .filter(|k| rw_v.binary_search(k).is_err())
            .collect();
        ro_v.sort();
        ro_v.dedup();
        MultisigLayout {
            fee_payer,
            program,
            rw: rw_v,
            ro: ro_v,
        }
    }

    pub fn index_of(&self, key: &TnPubkey) -> Option<u16> {
        if *key == self.fee_payer {
            return Some(0);
        }
        if *key == self.program {
            return Some(1);
        }
        if let Ok(i) = self.rw.binary_search(key) {
            return Some(2 + i as u16);
        }
        if let Ok(i) = self.ro.binary_search(key) {
            return Some(2 + self.rw.len() as u16 + i as u16);
        }
        None
    }

    pub fn idx(&self, key: &TnPubkey) -> Result<u16> {
        self.index_of(key)
            .ok_or_else(|| anyhow!("account {} is not in the transaction", short_hex(key)))
    }

    pub fn is_writable(&self, key: &TnPubkey) -> bool {
        *key == self.fee_payer || self.rw.binary_search(key).is_ok()
    }

    /// Adds the layout's accounts to a transaction built with
    /// `Transaction::new(fee_payer, program, ..)`.
    pub fn apply(&self, mut tx: Transaction) -> Transaction {
        for k in &self.rw {
            tx = tx.add_rw_account(*k);
        }
        for k in &self.ro {
            tx = tx.add_r_account(*k);
        }
        tx
    }

    /// The layout `CREATE_REQUEST` and `EXECUTE_REQUEST` share: the multisig
    /// and request accounts are read-write, plus the child call's accounts.
    pub fn for_request(
        fee_payer: TnPubkey,
        program: TnPubkey,
        multisig: TnPubkey,
        request: TnPubkey,
        child_rw: &[TnPubkey],
        child_ro: &[TnPubkey],
    ) -> Self {
        let mut rw = vec![multisig, request];
        rw.extend_from_slice(child_rw);
        Self::new(fee_payer, program, &rw, child_ro)
    }

    /// Rebuilds the execute-time layout from a stored request. Stored
    /// (index, pubkey) pairs pin each referenced account's position. The
    /// request does not record which accounts were writable, so the
    /// read-write/read-only split must be the only one that satisfies every
    /// stored index; an ambiguous request is refused rather than guessed.
    /// `propose` only submits requests that `reproduces` accepts.
    pub fn from_request(
        executor: TnPubkey,
        program: TnPubkey,
        multisig: TnPubkey,
        request: TnPubkey,
        req: &RequestAccount,
    ) -> Result<Self> {
        Self::from_payload(executor, program, multisig, request, &req.payload)
    }

    pub fn from_payload(
        executor: TnPubkey,
        program: TnPubkey,
        multisig: TnPubkey,
        request: TnPubkey,
        payload: &RequestPayload,
    ) -> Result<Self> {
        let invoke = match payload {
            RequestPayload::Invoke(p) => p,
            _ => {
                return Ok(Self::for_request(
                    executor,
                    program,
                    multisig,
                    request,
                    &[],
                    &[],
                ));
            }
        };

        let mut pinned: Vec<(u16, TnPubkey)> = invoke.refs.clone();
        pinned.push((invoke.target_program_idx, invoke.target_program));
        pinned.sort();
        pinned.dedup();

        for (idx, key) in &pinned {
            if *idx == 0 && *key != executor {
                bail!(
                    "this request references {} as the fee payer (index 0); execute it with that key as --fee-payer",
                    short_hex(key)
                );
            }
            if *idx == 1 && *key != program {
                bail!(
                    "request pins index 1 to {}, which is not the multisig program",
                    short_hex(key)
                );
            }
            if *key == executor && *idx != 0 {
                bail!(
                    "the executing key {} is referenced by this request; execute with a different --fee-payer",
                    short_hex(key)
                );
            }
        }

        let movable: Vec<(u16, TnPubkey)> =
            pinned.iter().copied().filter(|(i, _)| *i >= 2).collect();
        let mut all: Vec<TnPubkey> = movable.iter().map(|(_, k)| *k).collect();
        for k in [multisig, request] {
            if !all.contains(&k) {
                all.push(k);
            }
        }
        all.sort();
        all.dedup();
        let total = all.len();

        let mut found: Vec<Self> = Vec::new();
        for rw_cnt in 2..=total {
            let boundary = 2 + rw_cnt as u16;
            let mut rw: Vec<TnPubkey> = vec![multisig, request];
            let mut ro: Vec<TnPubkey> = Vec::new();
            for (idx, key) in &movable {
                if *key == multisig || *key == request {
                    continue;
                }
                if *idx < boundary {
                    rw.push(*key);
                } else {
                    ro.push(*key);
                }
            }
            if rw.iter().any(|k| *k == invoke.target_program) {
                continue;
            }
            let layout = Self::new(executor, program, &rw, &ro);
            if layout.rw.len() != rw_cnt || layout.rw.len() + layout.ro.len() != total {
                continue;
            }
            if pinned
                .iter()
                .all(|(idx, key)| layout.index_of(key) == Some(*idx))
            {
                found.push(layout);
            }
        }
        match found.len() {
            1 => Ok(found.remove(0)),
            0 => bail!("could not rebuild the account layout this request was proposed with"),
            _ => bail!(
                "this request's writable/read-only accounts are ambiguous; it can't be executed safely"
            ),
        }
    }

    /// True if executing `payload` (from any other fee payer) rebuilds
    /// exactly this layout's writable and read-only accounts.
    pub fn reproduces(
        &self,
        multisig: TnPubkey,
        request: TnPubkey,
        payload: &RequestPayload,
    ) -> bool {
        let probe_executor = [0xEEu8; 32];
        match Self::from_payload(probe_executor, self.program, multisig, request, payload) {
            Ok(l) => l.rw == self.rw && l.ro == self.ro,
            Err(_) => false,
        }
    }
}

/* ---------- transactions ---------- */

pub const CREATE_COMPUTE_UNITS: u32 = 500_000;
pub const SIMPLE_COMPUTE_UNITS: u32 = 300_000;
pub const EXECUTE_COMPUTE_UNITS: u32 = 1_000_000;
pub const MEMORY_UNITS: u16 = 10_000;
pub const EXPIRY_AFTER: u32 = 100;

pub struct TxParams {
    pub fee: u64,
    pub nonce: u64,
    pub start_slot: u64,
    pub chain_id: u16,
}

fn base_tx(fee_payer: TnPubkey, program: TnPubkey, p: &TxParams, cu: u32, su: u16) -> Transaction {
    Transaction::new(fee_payer, program, p.fee, p.nonce)
        .with_start_slot(p.start_slot)
        .with_chain_id(p.chain_id)
        .with_expiry_after(EXPIRY_AFTER)
        .with_compute_units(cu)
        .with_state_units(su)
        .with_memory_units(MEMORY_UNITS)
}

pub fn build_create_multisig_tx(
    creator: TnPubkey,
    program: TnPubkey,
    seed: &[u8; 32],
    members: &[TnPubkey],
    threshold: u16,
    proof: &[u8],
    p: &TxParams,
) -> Result<(Transaction, TnPubkey)> {
    let multisig = derive_account(&program, seed);
    let layout = MultisigLayout::new(creator, program, &[multisig], &[]);
    let data = encode_create_multisig(layout.idx(&multisig)?, 0, members, threshold, seed, proof);
    let state_units = account_state_units(MULTISIG_ACCOUNT_SZ as u64)?;
    let tx = layout.apply(base_tx(
        creator,
        program,
        p,
        CREATE_COMPUTE_UNITS,
        state_units,
    ));
    Ok((tx.with_instructions(data), multisig))
}

/// Builds `CREATE_REQUEST`. For an invoke, `payload` must have been encoded
/// against `layout` (see `MultisigLayout::for_request`).
pub fn build_create_request_tx(
    layout: &MultisigLayout,
    multisig: TnPubkey,
    request: TnPubkey,
    seed: &[u8; 32],
    payload: &RequestPayload,
    proof: &[u8],
    p: &TxParams,
) -> Result<Transaction> {
    let req_data = payload.encode();
    ensure!(
        req_data.len() <= MAX_REQUEST_DATA_SZ,
        "request data is {} bytes; max is {}",
        req_data.len(),
        MAX_REQUEST_DATA_SZ
    );
    let data = encode_create_request(
        layout.idx(&multisig)?,
        layout.idx(&request)?,
        0,
        payload.kind(),
        seed,
        &req_data,
        proof,
    );
    let state_units = account_state_units((REQUEST_HEADER_SZ + req_data.len()) as u64)?;
    let tx = layout.apply(base_tx(
        layout.fee_payer,
        layout.program,
        p,
        CREATE_COMPUTE_UNITS,
        state_units,
    ));
    Ok(tx.with_instructions(data))
}

pub fn build_approve_tx(
    approver: TnPubkey,
    program: TnPubkey,
    multisig: TnPubkey,
    request: TnPubkey,
    request_id: u64,
    request_hash: &[u8; 32],
    p: &TxParams,
) -> Result<Transaction> {
    let layout = MultisigLayout::new(approver, program, &[request], &[multisig]);
    let data = encode_approve_request(
        layout.idx(&multisig)?,
        layout.idx(&request)?,
        0,
        request_id,
        request_hash,
    );
    let tx = layout.apply(base_tx(approver, program, p, SIMPLE_COMPUTE_UNITS, 0));
    Ok(tx.with_instructions(data))
}

pub fn build_execute_tx(
    layout: &MultisigLayout,
    multisig: TnPubkey,
    request: TnPubkey,
    compute_units: u32,
    state_units: u16,
    p: &TxParams,
) -> Result<Transaction> {
    let data = encode_execute_request(layout.idx(&multisig)?, layout.idx(&request)?);
    let tx = layout.apply(base_tx(
        layout.fee_payer,
        layout.program,
        p,
        compute_units,
        state_units,
    ));
    Ok(tx.with_instructions(data))
}

pub fn build_delete_tx(
    requester: TnPubkey,
    program: TnPubkey,
    multisig: TnPubkey,
    request: TnPubkey,
    p: &TxParams,
) -> Result<Transaction> {
    let layout = MultisigLayout::new(requester, program, &[multisig, request], &[]);
    let data = encode_delete_request(layout.idx(&multisig)?, layout.idx(&request)?, 0);
    let tx = layout.apply(base_tx(requester, program, p, SIMPLE_COMPUTE_UNITS, 0));
    Ok(tx.with_instructions(data))
}

/* ---------- helpers ---------- */

fn u16_at(d: &[u8], o: usize) -> u16 {
    u16::from_le_bytes([d[o], d[o + 1]])
}

fn u64_at(d: &[u8], o: usize) -> u64 {
    let mut b = [0u8; 8];
    b.copy_from_slice(&d[o..o + 8]);
    u64::from_le_bytes(b)
}

fn key_at(d: &[u8], o: usize) -> TnPubkey {
    let mut k = [0u8; 32];
    k.copy_from_slice(&d[o..o + 32]);
    k
}

fn short_hex(k: &TnPubkey) -> String {
    hex::encode(&k[..6])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn k(b: u8) -> TnPubkey {
        [b; 32]
    }

    #[test]
    fn approve_execute_delete_golden() {
        // Same bytes as the Python builders in multisig_fullnode.py.
        let approve = hex::encode(encode_approve_request(3, 2, 0, 7, &[0xAB; 32]));
        assert_eq!(approve.len(), 2 * 50);
        assert_eq!(&approve[..36], "020000000300020000000700000000000000");
        assert_eq!(&approve[36..], "ab".repeat(32));
        assert_eq!(
            hex::encode(encode_execute_request(2, 4)),
            "0300000002000400"
        );
        assert_eq!(
            hex::encode(encode_delete_request(2, 3, 0)),
            "04000000020003000000"
        );
    }

    #[test]
    fn create_multisig_layout_matches_header() {
        let d = encode_create_multisig(2, 0, &[k(1), k(2)], 2, &k(9), &[0xAA, 0xBB]);
        // u32 + 4*u16 + seed + u64 = 52 bytes of fixed args.
        assert_eq!(&d[0..4], &[0, 0, 0, 0]);
        assert_eq!(u16_at(&d, 8), 2);
        assert_eq!(u16_at(&d, 10), 2);
        assert_eq!(&d[12..44], &k(9));
        assert_eq!(u64_at(&d, 44), 2);
        assert_eq!(&d[52..84], &k(1));
        assert_eq!(&d[116..], &[0xAA, 0xBB]);
    }

    #[test]
    fn create_request_layout_matches_header() {
        let payload = RequestPayload::UpdateThreshold { new_threshold: 3 };
        let d = encode_create_request(
            2,
            3,
            0,
            payload.kind(),
            &k(7),
            &payload.encode(),
            &[1, 2, 3],
        );
        assert_eq!(
            u32::from_le_bytes([d[0], d[1], d[2], d[3]]),
            INSTR_CREATE_REQUEST
        );
        assert_eq!(d[10], KIND_UPDATE_THRESHOLD);
        assert_eq!(&d[12..44], &k(7));
        assert_eq!(u64_at(&d, 44), 4);
        assert_eq!(u64_at(&d, 52), 3);
        assert_eq!(&d[60..64], &[3, 0, 0, 0]);
        assert_eq!(&d[64..], &[1, 2, 3]);
    }

    #[test]
    fn payload_round_trip() {
        let payloads = vec![
            RequestPayload::Invoke(InvokePayload {
                target_program_idx: 6,
                target_program: k(0xEE),
                refs: vec![(2, k(3)), (5, k(4))],
                instr_data: vec![9, 8, 7],
            }),
            RequestPayload::UpdateThreshold { new_threshold: 2 },
            RequestPayload::UpdateMembership {
                members: vec![k(1), k(2), k(3)],
            },
            RequestPayload::DeleteMultisig,
        ];
        for p in payloads {
            assert_eq!(RequestPayload::decode(p.kind(), &p.encode()).unwrap(), p);
        }
    }

    fn request_account(payload: RequestPayload, bitmap: u64) -> Vec<u8> {
        let body = payload.encode();
        let mut d = vec![ACCOUNT_TYPE_REQUEST_V1, payload.kind(), 0, 0];
        d.extend_from_slice(&3u16.to_le_bytes());
        d.extend_from_slice(&2u16.to_le_bytes());
        d.extend_from_slice(&7u64.to_le_bytes());
        d.extend_from_slice(&1u64.to_le_bytes());
        d.extend_from_slice(&bitmap.to_le_bytes());
        d.extend_from_slice(&(body.len() as u64).to_le_bytes());
        d.extend_from_slice(&k(0x11));
        d.extend_from_slice(&k(0x22));
        d.extend_from_slice(&body);
        d
    }

    #[test]
    fn decode_accounts() {
        let mut ms = vec![ACCOUNT_TYPE_MULTISIG_V1, 0];
        ms.extend_from_slice(&3u16.to_le_bytes());
        ms.extend_from_slice(&2u16.to_le_bytes());
        ms.extend_from_slice(&1u16.to_le_bytes());
        ms.extend_from_slice(&1u64.to_le_bytes());
        ms.extend_from_slice(&8u64.to_le_bytes());
        for b in [1u8, 2, 3] {
            ms.extend_from_slice(&k(b));
        }
        ms.resize(MULTISIG_ACCOUNT_SZ, 0);
        let m = MultisigAccount::decode(&ms).unwrap();
        assert_eq!(m.members, vec![k(1), k(2), k(3)]);
        assert_eq!(
            (
                m.threshold,
                m.live_request_cnt,
                m.config_epoch,
                m.next_request_id
            ),
            (2, 1, 1, 8)
        );

        let r = RequestAccount::decode(&request_account(RequestPayload::DeleteMultisig, 0b101))
            .unwrap();
        assert_eq!(r.request_id, 7);
        assert_eq!(r.multisig, k(0x11));
        assert_eq!(r.proposer, k(0x22));
        assert_eq!(r.approval_count(), 2);
        assert_eq!(r.approvers(&m), vec![k(1), k(3)]);
        assert_eq!(
            r.data_hash(),
            request_data_hash(&RequestPayload::DeleteMultisig.encode())
        );
        assert!(!r.is_stale(&m));

        /* Each decoder accepts only its own account type. */
        assert!(RequestAccount::decode(&ms).is_err());
        let mut request = request_account(RequestPayload::DeleteMultisig, 0b101);
        assert!(MultisigAccount::decode(&request).is_err());
        request[0] = 0;
        assert!(RequestAccount::decode(&request).is_err());
    }

    /// Propose with one fee payer, execute with another: the rebuilt layout
    /// must put every referenced account at its stored index.
    fn invoke_for(
        create: &MultisigLayout,
        ms: TnPubkey,
        child: &[TnPubkey],
        target: TnPubkey,
    ) -> RequestPayload {
        let mut refs: Vec<(u16, TnPubkey)> = child
            .iter()
            .chain([ms].iter())
            .map(|key| (create.index_of(key).unwrap(), *key))
            .collect();
        refs.sort();
        refs.dedup();
        RequestPayload::Invoke(InvokePayload {
            target_program_idx: create.index_of(&target).unwrap(),
            target_program: target,
            refs,
            instr_data: vec![1],
        })
    }

    /// Propose with one fee payer, execute with another: picks a request
    /// address the proposal reproduces with (as `propose` does), then checks
    /// the rebuilt layout has the same indices and the same access modes.
    fn round_trip(child_rw: &[TnPubkey], child_ro: &[TnPubkey], target: TnPubkey) {
        let program = k(0x01);
        let ms = k(0x50);
        let (proposer, executor) = (k(0xA0), k(0xB0));
        let mut ro = child_ro.to_vec();
        ro.push(target);
        let child: Vec<TnPubkey> = child_rw.iter().chain(child_ro).copied().collect();
        let (req, create, payload) = (0x02u8..=0xFE)
            .map(|b| {
                let mut req = [b; 32];
                req[31] = 0x77;
                let create = MultisigLayout::for_request(proposer, program, ms, req, child_rw, &ro);
                let payload = invoke_for(&create, ms, &child, target);
                (req, create, payload)
            })
            .find(|(req, create, payload)| create.reproduces(ms, *req, payload))
            .expect("some request address reproduces");
        let stored = RequestAccount::decode(&request_account(payload, 0)).unwrap();
        let exec = MultisigLayout::from_request(executor, program, ms, req, &stored).unwrap();
        assert_eq!(
            (exec.rw.clone(), exec.ro.clone()),
            (create.rw.clone(), create.ro.clone())
        );
        for key in child.iter().chain([target, ms].iter()) {
            assert_eq!(exec.index_of(key), create.index_of(key));
        }
        assert!(!exec.is_writable(&target));
    }

    #[test]
    fn ambiguous_access_modes_are_refused() {
        // rw {ms 0x50, req 0x60} all sort before ro {0x70, target 0x90}: 0x70
        // could be read-only or writable with the same indices.
        let (program, ms, target, ro_acct) = (k(1), k(0x50), k(0x90), k(0x70));
        let create =
            MultisigLayout::for_request(k(0xA0), program, ms, k(0x60), &[], &[ro_acct, target]);
        let payload = invoke_for(&create, ms, &[ro_acct], target);
        assert!(!create.reproduces(ms, k(0x60), &payload));
        assert!(MultisigLayout::from_payload(k(0xB0), program, ms, k(0x60), &payload).is_err());
        // A request address sorting after 0x70 removes the ambiguity.
        let create =
            MultisigLayout::for_request(k(0xA0), program, ms, k(0x80), &[], &[ro_acct, target]);
        let payload = invoke_for(&create, ms, &[ro_acct], target);
        assert!(create.reproduces(ms, k(0x80), &payload));
    }

    #[test]
    fn layout_round_trips() {
        round_trip(&[k(0x30), k(0x70)], &[], k(0x90)); // token mint-to style
        round_trip(&[], &[k(0x20)], k(0x10)); // read-only child accounts
        round_trip(&[k(0x05)], &[k(0x99)], k(0x02)); // interleaved order
        round_trip(&[], &[], k(0x40)); // only the multisig
        round_trip(&[k(0x55), k(0x56), k(0x57)], &[k(0x58)], k(0xFF));
    }

    #[test]
    fn executor_referenced_is_rejected() {
        let program = k(1);
        let (ms, req) = (k(0x50), k(0x60));
        let payload = RequestPayload::Invoke(InvokePayload {
            target_program_idx: 4,
            target_program: k(0x90),
            refs: vec![(2, ms), (3, k(0xB0))],
            instr_data: vec![],
        });
        let stored = RequestAccount::decode(&request_account(payload, 0)).unwrap();
        assert!(MultisigLayout::from_request(k(0xB0), program, ms, req, &stored).is_err());
    }

    #[test]
    fn create_request_reserves_state_for_full_account() {
        let layout = MultisigLayout::for_request(k(0xA0), k(1), k(0x50), k(0x60), &[], &[k(0x90)]);
        let p = TxParams {
            fee: 1,
            nonce: 0,
            start_slot: 0,
            chain_id: 1,
        };
        let build = |data_len: usize| {
            let payload = RequestPayload::Invoke(InvokePayload {
                target_program_idx: layout.idx(&k(0x90)).unwrap(),
                target_program: k(0x90),
                refs: vec![(layout.idx(&k(0x50)).unwrap(), k(0x50))],
                instr_data: vec![0; data_len],
            });
            build_create_request_tx(&layout, k(0x50), k(0x60), &k(7), &payload, &[], &p)
                .unwrap()
                .req_state_units
        };
        // Header (104) + invoke overhead (78) + data + 64 bytes of account metadata.
        assert_eq!(build(16), 1);
        assert_eq!(build(4096 - 78), 2);
    }

    #[test]
    fn derive_matches_wthru_style() {
        // sha256(program || 0 || seed)
        let a = derive_account(&k(1), &k(2));
        let mut h = Sha256::new();
        h.update(k(1));
        h.update([0u8]);
        h.update(k(2));
        assert_eq!(&a[..], &h.finalize()[..32]);
    }
}
