//! Consumer test for the shared signing conformance corpus
//! (`contrib/test/vectors/signing/`, see its README for the format and the
//! consumer contract).  The C node is ground truth; this file checks that
//! `thru-base` agrees with it on:
//!
//! * `txn_vectors.json`      -- wire parse / validation, signing message `M`,
//!   deterministic signatures, verify-before-attach, decoded header.
//! * `message_vectors.json`  -- off-chain `tn_msg_sign_v1__` signing, verify and
//!   the 32768-byte length limit.
//! * `eoa_auth_vectors.json` -- 82-byte EOA create/delete authorizations.
//! * `address_vectors.json`  -- `ta…` / `ts…` encode, decode and decode rejects.
//!
//! `hd_vectors.json` is not consumed: `thru-base` has no BIP-39 / SLIP-10
//! derivation.  The corpus provides the derived `signer_seed_hex` directly.
//!
//! # Known disagreements
//!
//! Every place where `thru-base` differs from C is listed in [`ALLOWED`] with
//! an explanation.  Each test collects the disagreements it observes and
//! requires the observed set to equal the allow-list for its corpus exactly:
//! a new disagreement fails the test, and so does an allow-list entry that no
//! longer reproduces (so a fix forces the entry to be removed).
//!
//! Disagreements this corpus found that were fixed in `thru-base` (Rust was
//! looser than C), so they have no entry:
//!
//! * `addr_reject_base64_std_char`: the ta/ts decoders never detected
//!   characters outside the base64url alphabet (a `u8` cast to `i32` is never
//!   negative), so a bad character only failed on the checksum, and some
//!   corrupted strings were accepted.  Now `-3`/`-4` (`bad_character`) as in C.
//! * `reject_32769`: `tn_signature::sign_message` signed, and
//!   `verify_wallet_message` verified, messages over 32768 bytes, which C
//!   refuses.  `tn_signature::{sign,verify}` now apply C's per-domain context
//!   caps.
//!
//! # Reject-reason mapping (txn)
//!
//! `validate_wire_transaction` takes `body ‖ sig`.  For reject vectors the test
//! appends a real Ed25519 signature by the vector's signer, as C does, so the
//! rejection never comes from the signature.  `thru-base` errors map to corpus
//! reason classes as follows:
//!
//! | `txn_lib::RpcError`               | corpus `reject_reason`(s)                         | `sw_class`          |
//! |-----------------------------------|---------------------------------------------------|---------------------|
//! | `InvalidTransactionSize`          | `oversize`                                        | `format`            |
//! | `InvalidFormat`                   | `truncated`                                       | `format`            |
//! | `TrailingBytes`                   | `trailing_bytes`                                  | `format`            |
//! | `InvalidVersion`                  | `bad_version`                                     | `version`           |
//! | `InvalidFlags`                    | `bad_flags`                                       | `flags`             |
//! | `InvalidChainId`                  | `bad_chain_id`                                    | `chain_id_zero`     |
//! | `InvalidFeePayerStateProofType`   | `proof_type_updating`, `proof_type_invalid`       | `proof_type`        |
//! | `TooManyAccounts`                 | `too_many_accounts` (reserved, no vector)         | `too_many_accounts` |
//! | `DuplicateAccount`                | `fee_payer_is_program`, `rw_duplicate`, `ro_duplicate`, `rw_ro_overlap`, `account_is_fee_payer`, `account_is_program` | `duplicate_account` |
//! | `UnsortedReadwriteAccounts`       | `rw_unsorted`                                     | `rw_unsorted`       |
//! | `UnsortedReadonlyAccounts`        | `ro_unsorted`                                     | `ro_unsorted`       |
//! | `InvalidTransactionSignature`     | none (never expected for a reject vector)         | --                  |
//!
//! `thru-base` distinguishes `oversize` / `truncated` / `trailing_bytes` (C
//! does not), so those are compared at the fine-grained level.  For
//! `truncated` vectors only accept/reject is compared (README note 1).

use std::collections::BTreeSet;
use std::path::PathBuf;

use serde_json::Value;
use thru_base::signer::{
    EoaAuthKind, LocalSigner, MAX_MESSAGE_SZ, SignError, Signer, attach_signature,
    build_eoa_auth_message, build_transaction_signing_message, sign_eoa_auth_with,
    sign_message_with, sign_transaction_body_with,
};
use thru_base::tn_public_address::{
    tn_pubkey_to_address_string, tn_public_address_decode, tn_public_address_encode,
};
use thru_base::tn_signature::{self, SignatureDomain};
use thru_base::tn_signature_encoding::{
    tn_signature_decode, tn_signature_encode, tn_signature_to_string,
};
use thru_base::tn_state_proof::StateProofType;
use thru_base::txn_lib::{RpcError, Transaction, validate_wire_transaction};
use thru_base::txn_tools::{build_eoa_create_message, build_eoa_delete_message};

/// One known C/Rust disagreement: `(corpus, vector name, check id, why)`.
type Allowed = (&'static str, &'static str, &'static str, &'static str);

/// Allow-list of known disagreements between `thru-base` and the C node.
const ALLOWED: &[Allowed] = &[
    // `Transaction` has no field for the header `pad` (bytes 46..47): its
    // serializers always write 0.  `from_wire` therefore drops a non-zero pad
    // and `to_wire_for_signing` does not reproduce `body_hex`.  The node
    // accepts any pad (README note 3) and `validate_wire_transaction` does too,
    // so signing the raw body bytes is unaffected; only the struct round trip
    // is lossy.  The decoded header cannot report `envelope.pad` either.
    (
        "txn",
        "ledger_txn_minimal_pad_nonzero",
        "struct_round_trip",
        "Transaction drops header pad",
    ),
    (
        "txn",
        "device_pad_nonzero",
        "struct_round_trip",
        "Transaction drops header pad",
    ),
    (
        "txn",
        "device_pad_high_bit",
        "struct_round_trip",
        "Transaction drops header pad",
    ),
];

fn allowed_for(corpus: &str) -> BTreeSet<(String, String)> {
    ALLOWED
        .iter()
        .filter(|(c, _, _, _)| *c == corpus)
        .map(|(_, n, k, _)| (n.to_string(), k.to_string()))
        .collect()
}

fn check_disagreements(corpus: &str, observed: &BTreeSet<(String, String)>) {
    let allowed = allowed_for(corpus);
    let unexpected: Vec<_> = observed.difference(&allowed).collect();
    let stale: Vec<_> = allowed.difference(observed).collect();
    assert!(
        unexpected.is_empty(),
        "{corpus}: new C/Rust disagreements (fix thru-base or add an ALLOWED entry): {unexpected:?}"
    );
    assert!(
        stale.is_empty(),
        "{corpus}: ALLOWED entries no longer reproduce (remove them): {stale:?}"
    );
}

// ---------------------------------------------------------------------------
// Corpus loading helpers
// ---------------------------------------------------------------------------

fn corpus_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../contrib/test/vectors/signing")
}

fn load(file: &str) -> Vec<Value> {
    let path = corpus_dir().join(file);
    let text =
        std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("read {}: {e}", path.display()));
    let v: Value =
        serde_json::from_str(&text).unwrap_or_else(|e| panic!("parse {}: {e}", path.display()));
    let arr = v.as_array().expect("corpus file is a JSON array").clone();
    assert!(!arr.is_empty(), "{file} is empty");
    arr
}

fn s<'a>(v: &'a Value, key: &str) -> &'a str {
    v[key]
        .as_str()
        .unwrap_or_else(|| panic!("{}: `{key}` is not a string", v["name"]))
}

fn opt_s<'a>(v: &'a Value, key: &str) -> Option<&'a str> {
    v[key].as_str()
}

fn n(v: &Value, key: &str) -> u64 {
    v[key]
        .as_u64()
        .unwrap_or_else(|| panic!("{}: `{key}` is not a number", v["name"]))
}

/// u64 header values are decimal strings in the corpus.
fn u64s(v: &Value, key: &str) -> u64 {
    s(v, key)
        .parse()
        .unwrap_or_else(|e| panic!("{}: `{key}`: {e}", v["name"]))
}

fn hexv(v: &Value, key: &str) -> Vec<u8> {
    hex::decode(s(v, key)).unwrap_or_else(|e| panic!("{}: `{key}`: {e}", v["name"]))
}

fn arr32(b: &[u8]) -> [u8; 32] {
    b.try_into().expect("32 bytes")
}

fn arr64(b: &[u8]) -> [u8; 64] {
    b.try_into().expect("64 bytes")
}

fn name(v: &Value) -> &str {
    s(v, "name")
}

// ---------------------------------------------------------------------------
// txn_vectors.json
// ---------------------------------------------------------------------------

/// Map a `thru-base` validation error to the corpus reason classes it covers
/// (see the module-level table).
fn rust_reasons(err: &RpcError) -> &'static [&'static str] {
    match err {
        RpcError::InvalidTransactionSize { .. } => &["oversize"],
        RpcError::InvalidFormat => &["truncated"],
        RpcError::TrailingBytes { .. } => &["trailing_bytes"],
        RpcError::InvalidVersion => &["bad_version"],
        RpcError::InvalidFlags => &["bad_flags"],
        RpcError::InvalidChainId => &["bad_chain_id"],
        RpcError::InvalidFeePayerStateProofType => &["proof_type_updating", "proof_type_invalid"],
        RpcError::TooManyAccounts { .. } => &["too_many_accounts"],
        RpcError::DuplicateAccount => &[
            "fee_payer_is_program",
            "rw_duplicate",
            "ro_duplicate",
            "rw_ro_overlap",
            "account_is_fee_payer",
            "account_is_program",
        ],
        RpcError::UnsortedReadwriteAccounts => &["rw_unsorted"],
        RpcError::UnsortedReadonlyAccounts => &["ro_unsorted"],
        RpcError::InvalidTransactionSignature | RpcError::InvalidParams(_) => &[],
    }
}

/// `sw_class` for a corpus reject reason (README reason table).
fn sw_class_of(reason: &str) -> &'static str {
    match reason {
        "oversize" | "truncated" | "trailing_bytes" => "format",
        "bad_version" => "version",
        "bad_flags" => "flags",
        "bad_chain_id" => "chain_id_zero",
        "proof_type_updating" | "proof_type_invalid" => "proof_type",
        "too_many_accounts" => "too_many_accounts",
        "fee_payer_is_program"
        | "rw_duplicate"
        | "ro_duplicate"
        | "rw_ro_overlap"
        | "account_is_fee_payer"
        | "account_is_program" => "duplicate_account",
        "rw_unsorted" => "rw_unsorted",
        "ro_unsorted" => "ro_unsorted",
        other => panic!("unknown reject_reason {other}"),
    }
}

/// Every `signer_seed_hex` in the corpus, keyed by its public key, so a vector
/// whose fee payer is not the asked signer can still be signed by the fee payer.
fn seeds_by_pubkey() -> Vec<([u8; 32], [u8; 32])> {
    let mut out = Vec::new();
    for file in [
        "txn_vectors.json",
        "message_vectors.json",
        "eoa_auth_vectors.json",
    ] {
        for v in load(file) {
            let pk = arr32(&hexv(&v, "signer_pubkey_hex"));
            let seed = arr32(&hexv(&v, "signer_seed_hex"));
            if !out.iter().any(|(p, _)| *p == pk) {
                out.push((pk, seed));
            }
        }
    }
    out
}

/// Compare the header `thru-base` decodes from `wire` with `envelope`.
fn check_envelope(v: &Value, wire: &[u8], tx: &Transaction) {
    let e = &v["envelope"];
    let nm = name(v);
    let version = Transaction::get_field_from_wire(wire, "transaction_version").unwrap();
    assert_eq!(version[0] as u64, n(e, "version"), "{nm}: version");
    assert_eq!(tx.flags as u64, n(e, "flags"), "{nm}: flags");
    assert_eq!(tx.chain_id as u64, n(e, "chain_id"), "{nm}: chain_id");
    assert_eq!(tx.fee, u64s(e, "fee"), "{nm}: fee");
    assert_eq!(tx.nonce, u64s(e, "nonce"), "{nm}: nonce");
    assert_eq!(tx.start_slot, u64s(e, "start_slot"), "{nm}: start_slot");
    assert_eq!(
        tx.expiry_after as u64,
        n(e, "expiry_after"),
        "{nm}: expiry_after"
    );
    // thru-base has no expiry-slot accessor on `txn_lib::Transaction`; this is
    // the C `tn_txn_get_expiry_slot` rule (saturating add).
    assert_eq!(
        tx.start_slot.saturating_add(tx.expiry_after as u64),
        u64s(e, "expiry_slot"),
        "{nm}: expiry_slot"
    );
    assert_eq!(tx.req_compute_units as u64, n(e, "cu"), "{nm}: cu");
    assert_eq!(tx.req_state_units as u64, n(e, "su"), "{nm}: su");
    assert_eq!(tx.req_memory_units as u64, n(e, "mu"), "{nm}: mu");
    assert_eq!(
        tx.fee_payer.to_vec(),
        hexv(e, "fee_payer_hex"),
        "{nm}: fee payer"
    );
    assert_eq!(tx.program.to_vec(), hexv(e, "program_hex"), "{nm}: program");
    assert_eq!(
        tn_pubkey_to_address_string(&tx.fee_payer),
        s(e, "fee_payer_addr"),
        "{nm}: fee_payer_addr"
    );
    assert_eq!(
        tn_pubkey_to_address_string(&tx.program),
        s(e, "program_addr"),
        "{nm}: program_addr"
    );
    let rw = tx.rw_accs.as_ref().map_or(0, |a| a.len()) as u64;
    let ro = tx.r_accs.as_ref().map_or(0, |a| a.len()) as u64;
    let instr = tx.instructions.as_ref().map_or(0, |a| a.len()) as u64;
    assert_eq!(rw, n(e, "rw_cnt"), "{nm}: rw_cnt");
    assert_eq!(ro, n(e, "ro_cnt"), "{nm}: ro_cnt");
    assert_eq!(instr, n(e, "instr_sz"), "{nm}: instr_sz");
    assert_eq!(
        tx.has_fee_payer_state_proof(),
        e["has_fee_payer_proof"].as_bool().unwrap(),
        "{nm}: has_fee_payer_proof"
    );
    assert_eq!(
        tx.may_compress_account(),
        e["may_compress"].as_bool().unwrap(),
        "{nm}: may_compress"
    );
    let (ptype, pslot) = match &tx.fee_payer_state_proof {
        None => (None, None),
        Some(p) => {
            let t = match p.header.proof_type {
                StateProofType::Existing => "existing",
                StateProofType::Creation => "creation",
                StateProofType::Updating => "updating",
            };
            (Some(t), Some(p.header.slot.to_string()))
        }
    };
    assert_eq!(ptype, opt_s(e, "proof_type"), "{nm}: proof_type");
    assert_eq!(pslot.as_deref(), opt_s(e, "proof_slot"), "{nm}: proof_slot");
    // `envelope.pad` has no counterpart in `Transaction` (see ALLOWED); it is
    // read straight from the body to keep the vector self-consistent.
    let pad = u16::from_le_bytes([wire[46], wire[47]]) as u64;
    assert_eq!(pad, n(e, "pad"), "{nm}: pad");
}

/// Checks for a body the node accepts and that `signer` (the fee payer) signs.
/// Records a `struct_round_trip` disagreement instead of failing when the
/// `Transaction` struct does not reproduce the body.
fn check_signed_body(
    v: &Value,
    body: &[u8],
    seed: [u8; 32],
    observed: &mut BTreeSet<(String, String)>,
) {
    let nm = name(v);
    let pk = arr32(&hexv(v, "signer_pubkey_hex"));
    let m = hexv(v, "signing_message_hex");
    let sig = arr64(&hexv(v, "signature_hex"));
    let wire = hexv(v, "wire_hex");

    // Signing message M = "tn_txn_sign_v1__" ‖ SHA-256(body).
    let msg = build_transaction_signing_message(body).expect("build M");
    assert_eq!(msg.as_bytes(), &m[..], "{nm}: signing message");
    assert_eq!(msg.body(), body, "{nm}: M body snapshot");
    assert_eq!(
        tn_signature::signing_message(SignatureDomain::Transaction, body),
        m,
        "{nm}: tn_signature::signing_message"
    );

    // Deterministic RFC 8032 signature from the corpus seed.
    let signer = LocalSigner::from_seed(seed);
    assert_eq!(signer.public_key(), pk, "{nm}: seed -> pubkey");
    assert_eq!(signer.sign(&msg).unwrap(), sig, "{nm}: LocalSigner::sign");
    assert_eq!(
        signer.sign_transaction_body(body).unwrap(),
        sig,
        "{nm}: sign_transaction_body"
    );
    assert_eq!(
        tn_signature::sign_transaction(body, &pk, &seed).unwrap(),
        sig,
        "{nm}: tn_signature::sign_transaction"
    );

    // Verify-before-attach (strict) produces wire_hex; a tampered signature
    // is refused.
    assert_eq!(attach_signature(&msg, sig).unwrap(), wire, "{nm}: attach");
    assert_eq!(
        sign_transaction_body_with(&signer, body).unwrap(),
        wire,
        "{nm}: sign_transaction_body_with"
    );
    let mut bad = sig;
    bad[0] ^= 1;
    assert!(
        matches!(
            attach_signature(&msg, bad),
            Err(SignError::InvalidSignature)
        ),
        "{nm}: tampered signature attached"
    );
    assert!(
        tn_signature::verify_transaction(body, &sig, &pk).is_ok(),
        "{nm}: verify_transaction"
    );

    // ts… encoding of the signature.
    assert_eq!(
        tn_signature_to_string(&sig),
        s(v, "signature_ts"),
        "{nm}: signature_ts"
    );

    // Full node-side validation of body ‖ sig.
    assert_eq!(
        validate_wire_transaction(&wire),
        Ok(()),
        "{nm}: validate_wire_transaction"
    );

    // Struct parse, layout validation, decoded header and round trip.
    let tx = Transaction::from_wire(&wire).unwrap_or_else(|| panic!("{nm}: from_wire"));
    assert_eq!(tx.validate(), Ok(()), "{nm}: validate_account_layout");
    assert_eq!(tx.signature, Some(sig), "{nm}: parsed signature");
    check_envelope(v, &wire, &tx);
    if tx.to_wire_for_signing() != body || tx.to_wire() != wire {
        observed.insert((nm.to_string(), "struct_round_trip".to_string()));
    } else {
        assert!(tx.verify(), "{nm}: Transaction::verify");
    }
}

#[test]
fn txn_vectors() {
    let vectors = load("txn_vectors.json");
    let seeds = seeds_by_pubkey();
    let mut observed = BTreeSet::new();
    let (mut n_valid, mut n_reject, mut n_device) = (0, 0, 0);

    for v in &vectors {
        let nm = name(v);
        let body = hexv(v, "body_hex");
        assert_eq!(body.len() as u64, n(v, "body_len"), "{nm}: body_len");
        let seed = arr32(&hexv(v, "signer_seed_hex"));
        let pk = arr32(&hexv(v, "signer_pubkey_hex"));
        assert_eq!(
            tn_pubkey_to_address_string(&pk),
            s(v, "signer_addr"),
            "{nm}: signer_addr"
        );

        match s(v, "category") {
            "valid" => {
                n_valid += 1;
                assert!(v["node_error"].is_null(), "{nm}: valid with node_error");
                check_signed_body(v, &body, seed, &mut observed);
            }
            "reject" => {
                n_reject += 1;
                let reason = s(v, "reject_reason");
                assert_eq!(s(v, "sw_class"), sw_class_of(reason), "{nm}: sw_class");
                assert!(v["signature_hex"].is_null(), "{nm}: reject has signature");
                // body ‖ real signature by the asked signer, as C checks it.
                let sig = tn_signature::sign_transaction(&body, &pk, &seed).unwrap();
                let mut wire = body.clone();
                wire.extend_from_slice(&sig);
                let err = match validate_wire_transaction(&wire) {
                    Ok(()) => {
                        observed.insert((nm.to_string(), "accepts_reject".to_string()));
                        continue;
                    }
                    Err(e) => e,
                };
                if reason == "truncated" {
                    // Accept/reject only (README note 1).
                    continue;
                }
                // The contract requires the same sw_class; matching the
                // fine-grained reason is recommended.  Both kinds of
                // mismatch are recorded separately.
                let classes = rust_reasons(&err);
                if !classes.contains(&reason) {
                    let same_sw = classes
                        .first()
                        .is_some_and(|c| sw_class_of(c) == sw_class_of(reason));
                    let kind = if same_sw { "reason" } else { "sw_class" };
                    observed.insert((nm.to_string(), format!("{kind}:{err:?}")));
                }
            }
            "device_reject" => {
                n_device += 1;
                // Hosts and SDKs treat device_reject bodies as node-valid.
                assert!(
                    v["node_error"].is_null(),
                    "{nm}: device_reject with node_error"
                );
                let fee_payer = arr32(&body[48..80]);
                if v["signature_hex"].is_null() {
                    // fee_payer_mismatch: the asked signer is not the fee
                    // payer.  thru-base refuses to sign (KeyMismatch, the host
                    // analogue of the device's 0x6810), the body is
                    // structurally valid, and it is node-valid once signed by
                    // the actual fee payer.
                    assert_eq!(s(v, "reject_reason"), "fee_payer_mismatch", "{nm}");
                    assert_ne!(
                        fee_payer, pk,
                        "{nm}: mismatch vector has signer == fee payer"
                    );
                    let signer = LocalSigner::from_seed(seed);
                    assert!(
                        matches!(
                            sign_transaction_body_with(&signer, &body),
                            Err(SignError::KeyMismatch { .. })
                        ),
                        "{nm}: thru-base signed for a foreign fee payer"
                    );
                    let msg = build_transaction_signing_message(&body).unwrap();
                    assert_eq!(msg.expected_pubkey(), &fee_payer, "{nm}: expected key");
                    let sig_a = tn_signature::sign_transaction(&body, &pk, &seed).unwrap();
                    let mut wire_a = body.clone();
                    wire_a.extend_from_slice(&sig_a);
                    assert_eq!(
                        validate_wire_transaction(&wire_a),
                        Err(RpcError::InvalidTransactionSignature),
                        "{nm}: only the signature check should fail"
                    );
                    let tx = Transaction::from_wire(&wire_a).expect("from_wire");
                    assert_eq!(tx.validate(), Ok(()), "{nm}: layout");
                    check_envelope(v, &wire_a, &tx);
                    let (_, fp_seed) = seeds
                        .iter()
                        .find(|(p, _)| *p == fee_payer)
                        .unwrap_or_else(|| panic!("{nm}: fee payer seed not in corpus"));
                    let wire = sign_transaction_body_with(&LocalSigner::from_seed(*fp_seed), &body)
                        .expect("fee payer signs");
                    assert_eq!(validate_wire_transaction(&wire), Ok(()), "{nm}: node-valid");
                } else {
                    // pad_nonzero / rw_cache_exceeded: signer is the fee payer.
                    assert_eq!(fee_payer, pk, "{nm}: signer is fee payer");
                    check_signed_body(v, &body, seed, &mut observed);
                }
            }
            other => panic!("{nm}: unknown category {other}"),
        }
    }

    assert!(n_valid >= 20 && n_reject >= 70 && n_device >= 7);
    eprintln!(
        "txn corpus: {} vectors ({n_valid} valid, {n_reject} reject, {n_device} device_reject)",
        vectors.len()
    );
    check_disagreements("txn", &observed);
}

// ---------------------------------------------------------------------------
// message_vectors.json
// ---------------------------------------------------------------------------

#[test]
fn message_vectors() {
    let vectors = load("message_vectors.json");
    let mut observed = BTreeSet::new();
    assert_eq!(MAX_MESSAGE_SZ, 32768, "message limit");

    for v in &vectors {
        let nm = name(v);
        let msg = hexv(v, "message_hex");
        assert_eq!(msg.len() as u64, n(v, "message_len"), "{nm}: message_len");
        let seed = arr32(&hexv(v, "signer_seed_hex"));
        let pk = arr32(&hexv(v, "signer_pubkey_hex"));
        let signer = LocalSigner::from_seed(seed);
        assert_eq!(signer.public_key(), pk, "{nm}: seed -> pubkey");

        match s(v, "category") {
            // `empty` is device_reject (msg_len >= 1 on the device only); C
            // and hosts sign it, so it gets the same checks as valid.
            "valid" | "device_reject" => {
                if s(v, "category") == "device_reject" {
                    assert_eq!(s(v, "reject_reason"), "message_empty", "{nm}");
                }
                let m = hexv(v, "signing_message_hex");
                let sig = arr64(&hexv(v, "signature_hex"));
                assert_eq!(
                    tn_signature::signing_message(SignatureDomain::Msg, &msg),
                    m,
                    "{nm}: signing message"
                );
                assert_eq!(
                    signer.sign_message(&msg).unwrap(),
                    sig,
                    "{nm}: LocalSigner::sign_message"
                );
                assert_eq!(
                    sign_message_with(&signer, &msg).unwrap(),
                    sig,
                    "{nm}: sign_message_with"
                );
                assert_eq!(
                    tn_signature::sign_message(&msg, &pk, &seed).unwrap(),
                    sig,
                    "{nm}: tn_signature::sign_message"
                );
                assert!(
                    tn_signature::verify_wallet_message(&msg, &sig, &pk).is_ok(),
                    "{nm}: verify_wallet_message"
                );
                let mut bad = sig;
                bad[63] ^= 0x01;
                assert!(
                    tn_signature::verify_wallet_message(&msg, &bad, &pk).is_err(),
                    "{nm}: tampered signature verified"
                );
                // Domain separation: a message signature never verifies as
                // a transaction signature (the generator asserts this for
                // `txn_signing_message_as_message`, whose message is a 48-byte
                // transaction M).
                assert!(
                    tn_signature::verify_message(&msg, &sig, &pk).is_err(),
                    "{nm}: message signature verifies over the raw message"
                );
                assert!(
                    tn_signature::verify_transaction(&msg, &sig, &pk).is_err(),
                    "{nm}: message signature verifies as a transaction"
                );
            }
            "reject" => {
                assert_eq!(s(v, "reject_reason"), "message_too_long", "{nm}");
                assert!(msg.len() > MAX_MESSAGE_SZ, "{nm}: not over the limit");
                // C refuses to sign ...
                if sign_message_with(&signer, &msg).is_ok() {
                    observed.insert((nm.to_string(), "sign_message_with".to_string()));
                }
                if tn_signature::sign_message(&msg, &pk, &seed).is_ok() {
                    observed.insert((nm.to_string(), "tn_signature::sign_message".to_string()));
                }
                // ... and refuses to verify even a correct raw Ed25519
                // signature over DST ‖ message (LocalSigner signs M as-is).
                let raw = signer.sign_message(&msg).unwrap();
                let m = tn_signature::signing_message(SignatureDomain::Msg, &msg);
                assert!(
                    tn_signature::verify_message(&m, &raw, &pk).is_ok(),
                    "{nm}: raw signature over M should be cryptographically valid"
                );
                if tn_signature::verify_wallet_message(&msg, &raw, &pk).is_ok() {
                    observed.insert((nm.to_string(), "verify_wallet_message".to_string()));
                }
            }
            other => panic!("{nm}: unknown category {other}"),
        }
    }
    eprintln!("message corpus: {} vectors", vectors.len());
    check_disagreements("message", &observed);
}

// ---------------------------------------------------------------------------
// eoa_auth_vectors.json
// ---------------------------------------------------------------------------

#[test]
fn eoa_auth_vectors() {
    let vectors = load("eoa_auth_vectors.json");
    let observed = BTreeSet::new();

    for v in &vectors {
        let nm = name(v);
        let kind = match s(v, "kind") {
            "create" => EoaAuthKind::Create,
            "delete" => EoaAuthKind::Delete,
            other => panic!("{nm}: unknown kind {other}"),
        };
        let chain_id = u16::try_from(n(v, "chain_id")).expect("chain_id u16");
        let fee_payer = arr32(&hexv(v, "fee_payer_hex"));
        let account = arr32(&hexv(v, "account_hex"));
        let seed = arr32(&hexv(v, "signer_seed_hex"));
        let pk = arr32(&hexv(v, "signer_pubkey_hex"));
        let auth = hexv(v, "auth_message_hex");
        assert_eq!(
            tn_pubkey_to_address_string(&fee_payer),
            s(v, "fee_payer_addr"),
            "{nm}: fee_payer_addr"
        );
        assert_eq!(
            tn_pubkey_to_address_string(&account),
            s(v, "account_addr"),
            "{nm}: account_addr"
        );

        // The 82-byte message, through both builders.
        assert_eq!(auth.len(), 82, "{nm}: auth length");
        assert_eq!(
            build_eoa_auth_message(kind, chain_id, &fee_payer, &account),
            auth,
            "{nm}: build_eoa_auth_message"
        );
        let legacy = match kind {
            EoaAuthKind::Create => build_eoa_create_message(chain_id, &fee_payer, &account),
            EoaAuthKind::Delete => build_eoa_delete_message(chain_id, &fee_payer, &account),
        };
        assert_eq!(legacy.to_vec(), auth, "{nm}: build_eoa_*_message");

        let signer = LocalSigner::from_seed(seed);
        assert_eq!(signer.public_key(), pk, "{nm}: seed -> pubkey");

        match (s(v, "category"), opt_s(v, "reject_reason")) {
            ("valid", None) | ("device_reject", Some("bad_chain_id")) => {
                // chain 0 is device-only: it verifies cryptographically and
                // C signs it, so the host signs it too.  The generator emits
                // no signature_hex for it; check sign+verify consistency.
                let got = sign_eoa_auth_with(&signer, kind, chain_id, &fee_payer, &account)
                    .unwrap_or_else(|e| panic!("{nm}: sign_eoa_auth_with: {e}"));
                assert_eq!(
                    signer
                        .sign_eoa_auth(kind, chain_id, &fee_payer, &account)
                        .unwrap(),
                    got,
                    "{nm}: sign_eoa_auth"
                );
                if let Some(sig_hex) = opt_s(v, "signature_hex") {
                    assert_eq!(hex::encode(got), sig_hex, "{nm}: signature");
                }
                // Exactly what the runtime does: strict verify over the 82
                // bytes under `account`, via both the raw and domain APIs.
                assert!(
                    tn_signature::verify_message(&auth, &got, &account).is_ok(),
                    "{nm}: verify_message"
                );
                assert!(
                    tn_signature::verify(kind.domain(), &auth[16..], &got, &account).is_ok(),
                    "{nm}: tn_signature::verify"
                );
                // Create and delete signatures never cross-verify.
                let other = match kind {
                    EoaAuthKind::Create => SignatureDomain::EoaDelete,
                    EoaAuthKind::Delete => SignatureDomain::EoaCreate,
                };
                assert!(
                    tn_signature::verify(other, &auth[16..], &got, &account).is_err(),
                    "{nm}: create/delete cross-verify"
                );
            }
            ("device_reject", Some("account_mismatch")) => {
                // The runtime verifies under `account`, so a signature by any
                // other key is useless.  thru-base refuses before signing
                // (the host analogue of the device's 0x6850).
                assert_ne!(account, pk, "{nm}");
                assert!(v["signature_hex"].is_null(), "{nm}");
                assert!(
                    matches!(
                        sign_eoa_auth_with(&signer, kind, chain_id, &fee_payer, &account),
                        Err(SignError::KeyMismatch { .. })
                    ),
                    "{nm}: thru-base signed an authorization for a foreign account"
                );
            }
            (cat, reason) => panic!("{nm}: unexpected category {cat} / {reason:?}"),
        }
    }
    eprintln!("eoa_auth corpus: {} vectors", vectors.len());
    check_disagreements("eoa_auth", &observed);
}

// ---------------------------------------------------------------------------
// address_vectors.json
// ---------------------------------------------------------------------------

/// Map a `thru-base` decode error code to the corpus `decode_error` class.
/// The codes are the same as C's `tn_public_address_decode` /
/// `tn_signature_decode`.
fn decode_class(code: i32) -> &'static str {
    match code {
        -1 => "bad_length",
        -2 => "bad_prefix",
        -3 | -4 => "bad_character",
        -5 => "bad_checksum",
        _ => "unknown",
    }
}

#[test]
fn address_vectors() {
    let vectors = load("address_vectors.json");
    let mut observed = BTreeSet::new();

    for v in &vectors {
        let nm = name(v);
        let encoded = s(v, "encoded");
        match s(v, "kind") {
            "address" => {
                let bytes = arr32(&hexv(v, "bytes_hex"));
                let sum = bytes.iter().map(|&b| b as u64).sum::<u64>() % 256;
                assert_eq!(sum, n(v, "checksum"), "{nm}: checksum");
                let mut out = [0u8; 46];
                tn_public_address_encode(&mut out, &bytes);
                assert_eq!(&out[..], encoded.as_bytes(), "{nm}: encode");
                assert_eq!(tn_pubkey_to_address_string(&bytes), encoded, "{nm}");
                let mut dec = [0u8; 32];
                assert_eq!(
                    tn_public_address_decode(&mut dec, encoded.as_bytes()),
                    Ok(()),
                    "{nm}: decode"
                );
                assert_eq!(dec, bytes, "{nm}: decode bytes");
            }
            "signature" => {
                let bytes = arr64(&hexv(v, "bytes_hex"));
                let sum = bytes.iter().map(|&b| b as u64).sum::<u64>() % 65536;
                assert_eq!(sum, n(v, "checksum"), "{nm}: checksum");
                let mut out = [0u8; 90];
                tn_signature_encode(&mut out, &bytes);
                assert_eq!(&out[..], encoded.as_bytes(), "{nm}: encode");
                assert_eq!(tn_signature_to_string(&bytes), encoded, "{nm}");
                let mut dec = [0u8; 64];
                assert_eq!(
                    tn_signature_decode(&mut dec, encoded.as_bytes()),
                    Ok(()),
                    "{nm}: decode"
                );
                assert_eq!(dec, bytes, "{nm}: decode bytes");
            }
            kind @ ("address_reject" | "signature_reject") => {
                let want = s(v, "decode_error");
                let res = if kind == "address_reject" {
                    tn_public_address_decode(&mut [0u8; 32], encoded.as_bytes())
                } else {
                    tn_signature_decode(&mut [0u8; 64], encoded.as_bytes())
                };
                match res {
                    Ok(()) => {
                        observed.insert((nm.to_string(), "accepts_reject".to_string()));
                    }
                    Err(code) if decode_class(code) != want => {
                        observed.insert((nm.to_string(), format!("decode_error:{code}")));
                    }
                    Err(_) => {}
                }
            }
            other => panic!("{nm}: unknown kind {other}"),
        }
    }
    eprintln!("address corpus: {} vectors", vectors.len());
    check_disagreements("address", &observed);
}
