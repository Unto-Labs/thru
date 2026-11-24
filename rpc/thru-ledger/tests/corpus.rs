//! Conformance against the shared signing corpus
//! (`contrib/test/vectors/signing/`).
//!
//! * `hd_vectors.json`: path policy (accept and reject), APDU path encoding,
//!   SLIP-10 keys and `ta…` addresses.
//! * `txn_vectors.json`: the emulated device (driven chunk by chunk, with no
//!   host-side checks) returns the vector's status word for every reject and
//!   device-reject vector, and the exact corpus signature for every valid
//!   vector; `LedgerSigner` pre-validates exactly like the node.
//! * `message_vectors.json`, `eoa_auth_vectors.json`: signatures, display mode,
//!   fingerprints and device-reject status words.
//!
//! The corpus is mandatory: a missing file fails the test.

use std::path::PathBuf;
use std::sync::Arc;

use serde_json::{Value, json};
use thru_base::signer::{EoaAuthKind, Signer, sign_transaction_body_with};
use thru_base::tn_public_address::tn_pubkey_to_address_string;
use thru_ledger::apdu::{self, Command};
use thru_ledger::consts::{APDU_MAX_DATA, THRU_COIN_TYPE, ins};
use thru_ledger::mock::{Review, SoftDevice, slip10_ed25519};
use thru_ledger::{
    ClearTransfer, DerivationPath, LedgerError, LedgerSigner, RequestReject, ThruLedger,
    TransferKind, Transport, decode_clear_transfer,
};

fn corpus_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../contrib/test/vectors/signing")
}

fn load(name: &str) -> Value {
    let path = corpus_dir().join(name);
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("signing corpus file {} is required: {e}", path.display()));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

fn s<'a>(v: &'a Value, k: &str) -> &'a str {
    v[k].as_str()
        .unwrap_or_else(|| panic!("field {k} missing in {}", v["name"]))
}

fn hexv(v: &Value, k: &str) -> Vec<u8> {
    hex::decode(s(v, k)).unwrap()
}

fn hex32(v: &Value, k: &str) -> [u8; 32] {
    hexv(v, k).try_into().unwrap()
}

fn sw_of(v: &Value) -> u16 {
    u16::from_str_radix(s(v, "sw").trim_start_matches("0x"), 16).unwrap()
}

fn signer_path(v: &Value) -> DerivationPath {
    s(v, "signer_path").parse().unwrap()
}

// ---------------------------------------------------------------------------
// HD vectors
// ---------------------------------------------------------------------------

#[test]
fn hd_derivations_accept_and_match() {
    let hd = load("hd_vectors.json");
    assert_eq!(hd["coin_type"].as_u64(), Some(THRU_COIN_TYPE as u64));
    let derivations = hd["derivations"].as_array().unwrap();
    assert!(derivations.len() >= 64);
    for v in derivations {
        let path: DerivationPath = s(v, "path")
            .parse()
            .unwrap_or_else(|e| panic!("{}: {e}", v["name"]));
        assert_eq!(
            hex::encode(path.to_apdu_bytes()),
            s(v, "path_apdu_hex"),
            "{}",
            v["name"]
        );
        let (decoded, used) = DerivationPath::from_apdu_bytes(&hexv(v, "path_apdu_hex")).unwrap();
        assert_eq!(decoded, path);
        assert_eq!(used, path.apdu_len());
        assert_eq!(path.account() as u64, v["account"].as_u64().unwrap());
        assert_eq!(path.depth() as u64, v["depth"].as_u64().unwrap());
        assert_eq!(DerivationPath::from_uri(&path.to_uri()).unwrap(), path);

        let k = slip10_ed25519(&hexv(v, "seed_hex"), path.components());
        assert_eq!(hex::encode(k), s(v, "private_seed_hex"), "{}", v["name"]);
        let dev = SoftDevice::new(&hexv(v, "seed_hex"));
        let pk = dev.pubkey(&path);
        assert_eq!(hex::encode(pk), s(v, "pubkey_hex"), "{}", v["name"]);
        assert_eq!(tn_pubkey_to_address_string(&pk), s(v, "address"));
    }
}

#[test]
fn hd_path_policy_rejects() {
    let hd = load("hd_vectors.json");
    let rejects = hd["path_policy"].as_array().unwrap();
    assert!(!rejects.is_empty());
    let dev = SoftDevice::abandon();
    let ledger = ThruLedger::new(&dev);
    for v in rejects {
        assert_eq!(s(v, "expect"), "reject");
        let name = s(v, "name");
        assert!(s(v, "path").parse::<DerivationPath>().is_err(), "{name}");
        let bytes = hexv(v, "path_apdu_hex");
        let err = DerivationPath::from_apdu_bytes(&bytes).unwrap_err();
        assert_ne!(err, thru_ledger::PathError::Truncated, "{name}");
        // The device returns PATH_REJECTED for a well-sized encoding.
        let cmd = Command::thru(ins::GET_PUBKEY, 0, 0, bytes);
        let e = ledger.exchange(&cmd).unwrap_err();
        assert!(matches!(e, LedgerError::PathRejected), "{name}: {e:?}");
    }
}

// ---------------------------------------------------------------------------
// Transaction vectors
// ---------------------------------------------------------------------------

/// Stream `body` to the device exactly as a host would (chunk 0 + 255-byte
/// chunks), without host-side size or validity checks, and return the final
/// status: `Ok(sig)` or the first error.
fn device_sign_raw(dev: &SoftDevice, path: &DerivationPath, body: &[u8]) -> Result<[u8; 64], u16> {
    let ledger = ThruLedger::new(dev);
    let code = |e: LedgerError| e.status_word().unwrap_or(0xFFFF);
    ledger
        .exchange(&Command::thru(ins::SIGN_TXN, 0, 0x80, path.to_apdu_bytes()))
        .map_err(code)?;
    let n = body.len().div_ceil(APDU_MAX_DATA);
    for (i, chunk) in body.chunks(APDU_MAX_DATA).enumerate() {
        let last = i + 1 == n;
        let cmd = Command::thru(
            ins::SIGN_TXN,
            (i + 1) as u8,
            if last { 0 } else { 0x80 },
            chunk.to_vec(),
        );
        let data = ledger.exchange(&cmd).map_err(code)?;
        if last {
            return Ok(data.try_into().unwrap());
        }
    }
    unreachable!("empty bodies are not streamed")
}

#[test]
fn txn_vectors_device_conformance() {
    let corpus = load("txn_vectors.json");
    let vectors = corpus.as_array().unwrap();
    assert!(vectors.len() >= 90);
    let dev = SoftDevice::abandon();
    let (mut valid, mut rejected) = (0, 0);
    for v in vectors {
        let name = s(v, "name");
        let body = hexv(v, "body_hex");
        let path = signer_path(v);
        if body.is_empty() {
            // A host cannot stream an empty body (data chunks carry 1..255
            // bytes); the host refuses it before the device is involved.
            assert_eq!(s(v, "category"), "reject");
            assert!(apdu::sign_txn(&path, &body).is_err());
            continue;
        }
        let got = device_sign_raw(&dev, &path, &body);
        match s(v, "category") {
            "valid" => {
                let sig = got.unwrap_or_else(|sw| panic!("{name}: device rejected 0x{sw:04X}"));
                assert_eq!(hex::encode(sig), s(v, "signature_hex"), "{name}");
                let Some(Review::Transaction {
                    hash_hex, chain_id, ..
                }) = dev.reviews().pop()
                else {
                    panic!("{name}: no transaction review")
                };
                assert_eq!(hash_hex, s(v, "body_sha256_hex"), "{name}");
                assert_eq!(chain_id as u64, v["envelope"]["chain_id"].as_u64().unwrap());
                valid += 1;
            }
            "reject" | "device_reject" => {
                let sw = got.expect_err(name);
                assert_eq!(sw, sw_of(v), "{name}: got 0x{sw:04X}, want {}", s(v, "sw"));
                rejected += 1;
            }
            other => panic!("{name}: unknown category {other}"),
        }
    }
    assert!(
        valid >= 20 && rejected >= 70,
        "valid={valid} rejected={rejected}"
    );
}

/// `clear_transfer` as the corpus writes it, for a decoded clear transfer.
fn clear_transfer_label(t: &ClearTransfer) -> Value {
    let kind = match (t.kind, t.checked) {
        (TransferKind::Native, _) => "native",
        (TransferKind::Token, None) => "token",
        (TransferKind::Token, Some(_)) => "token_checked",
        (TransferKind::Wallet, _) => "wallet",
    };
    let mut label = json!({
        "kind": kind,
        "source_hex": hex::encode(t.source),
        "recipient_hex": hex::encode(t.recipient),
        "amount": t.amount.to_string(),
    });
    if let Some(c) = t.checked {
        label["mint_hex"] = json!(hex::encode(c.mint));
        label["decimals"] = json!(c.decimals);
        label["ticker"] = json!(c.ticker());
    }
    if let Some(index) = t.authority_index {
        label["authority_index"] = json!(index);
    }
    label
}

/// The device's clear-transfer rule (§7.7, as `decode_clear_transfer` ports
/// it) gives every valid vector its corpus label: the transfer reviewed in
/// clear, or `null` for the blind-signing review.  The generator writes the
/// label without decoding, so this compares two independent statements.
#[test]
fn txn_vectors_clear_transfer_matches_the_corpus_label() {
    let corpus = load("txn_vectors.json");
    let (mut clear, mut checked, mut blind) = (0, 0, 0);
    for v in corpus.as_array().unwrap() {
        let name = s(v, "name");
        let label = &v["clear_transfer"];
        if s(v, "category") != "valid" {
            assert!(
                label.is_null(),
                "{name}: only a valid vector has a clear transfer"
            );
            continue;
        }
        let got = decode_clear_transfer(&hexv(v, "body_hex"));
        assert_eq!(
            got.as_ref()
                .map(clear_transfer_label)
                .unwrap_or(Value::Null),
            *label,
            "{name}"
        );
        match got {
            Some(t) if t.checked.is_some() => checked += 1,
            Some(_) => clear += 1,
            None => blind += 1,
        }
    }
    assert!(
        clear >= 2 && checked >= 5 && blind >= 14,
        "clear={clear} checked={checked} blind={blind}"
    );
}

#[test]
fn txn_vectors_ledger_signer() {
    let corpus = load("txn_vectors.json");
    let dev = Arc::new(SoftDevice::abandon());
    let path = DerivationPath::new(0).unwrap();
    let signer = LedgerSigner::connect(dev.clone(), path).unwrap();
    for v in corpus.as_array().unwrap() {
        let name = s(v, "name");
        let body = hexv(v, "body_hex");
        let before = dev.apdu_log().len();
        let res = signer.try_sign_transaction_body(&body);
        match (s(v, "category"), v["reject_reason"].as_str()) {
            ("valid", _) => {
                assert_eq!(hex::encode(res.unwrap()), s(v, "signature_hex"), "{name}");
                let wire = sign_transaction_body_with(&signer, &body).unwrap();
                assert_eq!(hex::encode(wire), s(v, "wire_hex"), "{name}");
            }
            ("reject", _) => {
                // Host pre-validation refuses with the corpus reason class
                // (typed, as the device would), and the device is never
                // contacted.
                match &res {
                    Err(LedgerError::InvalidTransaction(r)) => {
                        assert_eq!(r.class(), s(v, "sw_class"), "{name}");
                        assert_eq!(r.sw(), sw_of(v), "{name}");
                    }
                    other => panic!("{name}: {other:?}"),
                }
                assert_eq!(dev.apdu_log().len(), before, "{name}: device was contacted");
            }
            ("device_reject", Some("fee_payer_mismatch")) => {
                assert!(
                    matches!(res, Err(LedgerError::KeyMismatch { .. })),
                    "{name}: {res:?}"
                );
                assert_eq!(dev.apdu_log().len(), before);
            }
            ("device_reject", _) => {
                // Hosts accept these bodies; the device refuses with the vector's SW.
                let e = res.unwrap_err();
                assert_eq!(e.status_word(), Some(sw_of(v)), "{name}: {e:?}");
            }
            (c, _) => panic!("{name}: unknown category {c}"),
        }
    }
}

/// Consumer contract item 1 (contrib/test/vectors/signing/README.md): for every
/// `reject` vector the host must report the same `sw_class`, as a typed
/// `InvalidTransaction(reason)` (specs/ledger/app-thru-apdu.md §5.3).
#[test]
fn txn_reject_vectors_host_precheck_reports_sw_class() {
    let corpus = load("txn_vectors.json");
    let mut failures = Vec::new();
    let mut total = 0usize;
    for v in corpus.as_array().unwrap() {
        if s(v, "category") != "reject" {
            continue;
        }
        total += 1;
        let name = s(v, "name");
        let want = s(v, "sw_class");
        match thru_ledger::signer::precheck_body(&hexv(v, "body_hex")) {
            Err(LedgerError::InvalidTransaction(r)) if r.class() == want => {}
            other => failures.push(format!("{name}: want class {want}, got {other:?}")),
        }
    }
    assert!(
        failures.is_empty(),
        "{}/{total} reject vectors lose sw_class:\n{}",
        failures.len(),
        failures.join("\n")
    );
}

/// Preview parity (spec §11.3, corpus consumer item 1): for every vector with
/// a decoded `envelope`, the host preview built from the body has the
/// envelope's values, the B.2/B.3/B.5 strings, and `body_sha256_hex` as its
/// transaction hash; and the emulated device's review shows the same hash and
/// header values for every valid vector.
#[test]
fn txn_vectors_preview_matches_envelope_and_device() {
    use thru_ledger::preview::{format_thru_amount, known_program_label, network_label};
    let corpus = load("txn_vectors.json");
    let dev = Arc::new(SoftDevice::abandon());
    let signer = LedgerSigner::connect(dev.clone(), DerivationPath::new(0).unwrap()).unwrap();
    let mut checked = 0;
    for v in corpus.as_array().unwrap() {
        let env = &v["envelope"];
        if env.is_null() {
            continue;
        }
        let name = s(v, "name");
        let body = hexv(v, "body_hex");
        let p = thru_ledger::TransactionPreview::from_header_unchecked(&body).unwrap();
        let num = |k: &str| -> u64 {
            env[k]
                .as_u64()
                .or_else(|| env[k].as_str().map(|x| x.parse().unwrap()))
                .unwrap_or_else(|| panic!("{name}: envelope.{k}"))
        };
        assert_eq!(p.transaction_hash, s(v, "body_sha256_hex"), "{name}");
        assert_eq!(p.chain_id as u64, num("chain_id"), "{name}");
        assert_eq!(p.network, network_label(num("chain_id") as u16), "{name}");
        assert_eq!(p.fee_base_units, num("fee"), "{name}");
        assert_eq!(p.fee, format_thru_amount(num("fee")), "{name}");
        assert_eq!(p.nonce, num("nonce"), "{name}");
        // The corpus `expiry_slot` is tn_txn_get_expiry_slot, the first
        // expired slot; the review shows the last valid one (§7.7 row 6).
        assert_eq!(p.expiry_slot, num("expiry_slot"), "{name}");
        let want = if num("expiry_slot") > num("start_slot") {
            format!("{} to {}", num("start_slot"), num("expiry_slot") - 1)
        } else {
            "none".to_string()
        };
        assert_eq!(p.valid_slots, want, "{name}");
        assert_eq!(p.fee_payer, s(env, "fee_payer_addr"), "{name}");
        assert_eq!(p.program_address, s(env, "program_addr"), "{name}");
        assert_eq!(
            p.program_label,
            known_program_label(&hex32(env, "program_hex")),
            "{name}"
        );
        assert_eq!(
            p.accounts,
            format!("{} read-write, {} read-only", num("rw_cnt"), num("ro_cnt")),
            "{name}"
        );
        assert_eq!(
            p.instruction_data,
            format!("{} bytes", num("instr_sz")),
            "{name}"
        );

        if s(v, "category") == "valid" {
            // The signer's own preview (with host checks) is identical, it is
            // what the hook receives, and the device shows the same values.
            assert_eq!(signer.preview_transaction_body(&body).unwrap(), p, "{name}");
            signer.try_sign_transaction_body(&body).unwrap();
            assert_eq!(
                signer.last_preview(),
                Some(thru_ledger::Preview::Transaction(p.clone())),
                "{name}"
            );
            let Some(Review::Transaction {
                hash_hex,
                chain_id,
                fee,
                nonce,
                fee_payer,
                program,
                rw_cnt,
                ro_cnt,
                instr_sz,
                ..
            }) = dev.reviews().pop()
            else {
                panic!("{name}: no transaction review")
            };
            assert_eq!(hash_hex, p.transaction_hash, "{name}");
            assert_eq!(
                (chain_id, fee, nonce, rw_cnt, ro_cnt, instr_sz),
                (
                    p.chain_id,
                    p.fee_base_units,
                    p.nonce,
                    p.rw_cnt,
                    p.ro_cnt,
                    p.instr_sz
                ),
                "{name}"
            );
            assert_eq!(fee_payer, p.fee_payer, "{name}");
            assert_eq!(program, p.program_address, "{name}");
        }
        checked += 1;
    }
    assert!(checked >= 25, "checked={checked}");
}

// ---------------------------------------------------------------------------
// Message vectors
// ---------------------------------------------------------------------------

#[test]
fn message_vectors() {
    let corpus = load("message_vectors.json");
    let dev = Arc::new(SoftDevice::abandon());
    let path = DerivationPath::new(0).unwrap();
    let signer = LedgerSigner::connect(dev.clone(), path).unwrap();
    for v in corpus.as_array().unwrap() {
        let name = s(v, "name");
        let msg = hexv(v, "message_hex");
        assert_eq!(signer_path(v), path, "{name}");
        match s(v, "category") {
            "valid" => {
                let sig = signer
                    .try_sign_message(&msg)
                    .unwrap_or_else(|e| panic!("{name}: {e}"));
                assert_eq!(hex::encode(sig), s(v, "signature_hex"), "{name}");
                assert_eq!(
                    hex::encode(Signer::sign_message(&signer, &msg).unwrap()),
                    s(v, "signature_hex")
                );
                let Some(Review::Message {
                    text,
                    hash_hex,
                    len,
                    ..
                }) = dev.reviews().pop()
                else {
                    panic!("{name}: no message review")
                };
                assert_eq!(hash_hex, s(v, "message_sha256_hex"), "{name}");
                assert_eq!(len, msg.len());
                let mode = if text.is_some() { "text" } else { "hash" };
                assert_eq!(mode, s(v, "display"), "{name}");
                // Host preview parity (§11.3): same mode, same hash, and in
                // text mode exactly the text the device shows.
                let p = signer.preview_message(&msg).unwrap();
                assert_eq!(p.message_hash, s(v, "message_sha256_hex"), "{name}");
                assert_eq!(p.len, msg.len(), "{name}");
                match (&p.display, &text) {
                    (thru_ledger::MessageDisplay::Text(t), Some(shown)) => {
                        assert_eq!(t, shown, "{name}")
                    }
                    (thru_ledger::MessageDisplay::Hash, None) => {}
                    other => panic!("{name}: preview/device mode differ: {other:?}"),
                }
                assert_eq!(
                    signer.last_preview(),
                    Some(thru_ledger::Preview::Message(p)),
                    "{name}"
                );
            }
            "reject" | "device_reject" => {
                assert!(
                    matches!(
                        signer.try_sign_message(&msg),
                        Err(LedgerError::InvalidRequest(RequestReject::MessageLength))
                    ),
                    "{name}"
                );
                // Device-side: chunk 0 declaring this length is refused.
                let mut data = path.to_apdu_bytes();
                data.extend_from_slice(&(msg.len() as u32).to_be_bytes());
                let e = ThruLedger::new(&dev)
                    .exchange(&Command::thru(ins::SIGN_MESSAGE, 0, 0x80, data))
                    .unwrap_err();
                assert_eq!(e.status_word(), Some(sw_of(v)), "{name}");
            }
            c => panic!("{name}: unknown category {c}"),
        }
    }
}

// ---------------------------------------------------------------------------
// EOA authorization vectors
// ---------------------------------------------------------------------------

#[test]
fn eoa_auth_vectors() {
    let corpus = load("eoa_auth_vectors.json");
    let dev = Arc::new(SoftDevice::abandon());
    for v in corpus.as_array().unwrap() {
        let name = s(v, "name");
        let path = signer_path(v);
        let kind = match s(v, "kind") {
            "create" => EoaAuthKind::Create,
            "delete" => EoaAuthKind::Delete,
            k => panic!("{name}: kind {k}"),
        };
        let chain_id = v["chain_id"].as_u64().unwrap() as u16;
        let fee_payer = hex32(v, "fee_payer_hex");
        let account = hex32(v, "account_hex");
        let m = thru_base::signer::build_eoa_auth_message(kind, chain_id, &fee_payer, &account);
        assert_eq!(hex::encode(&m), s(v, "auth_message_hex"), "{name}");

        // Raw device behavior (no host checks).
        let raw = ThruLedger::new(&dev).sign_eoa_auth(&path, kind, chain_id, &fee_payer, &account);
        match s(v, "category") {
            "valid" => {
                assert_eq!(hex::encode(raw.unwrap()), s(v, "signature_hex"), "{name}");
                let signer = LedgerSigner::connect(dev.clone(), path).unwrap();
                let sig = signer
                    .try_sign_eoa_auth(kind, chain_id, &fee_payer, &account)
                    .unwrap();
                assert_eq!(hex::encode(sig), s(v, "signature_hex"), "{name}");
                let Some(Review::EoaAuth {
                    chain_id: c,
                    account: a,
                    ..
                }) = dev.reviews().pop()
                else {
                    panic!("{name}: no review")
                };
                assert_eq!(c, chain_id);
                assert_eq!(a, s(v, "account_addr"));
            }
            "device_reject" => {
                let e = raw.unwrap_err();
                assert_eq!(e.status_word(), Some(sw_of(v)), "{name}: {e:?}");
            }
            c => panic!("{name}: unknown category {c}"),
        }
    }
}

// ---------------------------------------------------------------------------
// Address vectors (the `ta…` strings the CLI and device display)
// ---------------------------------------------------------------------------

#[test]
fn address_vectors() {
    let corpus = load("address_vectors.json");
    let mut n = 0;
    for v in corpus.as_array().unwrap() {
        if s(v, "kind") == "address" {
            assert_eq!(
                tn_pubkey_to_address_string(&hex32(v, "bytes_hex")),
                s(v, "encoded")
            );
            n += 1;
        }
    }
    assert!(n > 0);
}

/// The SoftDevice also serves as a `Transport` for any `&T`.
#[allow(dead_code)]
fn _transport_is_object_safe(t: &dyn Transport) -> &dyn Transport {
    t
}
