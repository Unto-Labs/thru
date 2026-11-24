//! Speculos integration tests (feature `speculos`; `#[ignore]` by default).
//!
//! Run once the device app exists:
//!
//! ```bash
//! speculos --model nanosp --seed "abandon abandon abandon abandon abandon abandon \
//!   abandon abandon abandon abandon abandon about" --display headless \
//!   --apdu-port 9999 app-thru.elf &
//! SPECULOS_APDU_PORT=9999 cargo test -p thru-ledger --test speculos -- --ignored
//! ```
//!
//! * `SPECULOS_APDU_PORT` (required): the raw APDU port.  Unset: tests return
//!   early.
//! * `SPECULOS_SEED_NAME` (optional): the `hd_vectors.json` mnemonic name the
//!   emulator was started with (`bip39-abandon-about`, the default, or
//!   `speculos-default`).
//! * `SPECULOS_AUTO_APPROVE=1` (optional): Speculos runs with an automation
//!   rule that approves every review; enables the signing tests, which are
//!   checked bit-for-bit against the corpus (abandon seed only).

use std::path::PathBuf;

use serde_json::Value;
use thru_base::signer::{EoaAuthKind, sign_transaction_body_with};
use thru_ledger::speculos::{ENV_APDU_PORT, SpeculosTransport};
use thru_ledger::{DerivationPath, LedgerSigner, ThruLedger};

fn port() -> Option<u16> {
    std::env::var(ENV_APDU_PORT).ok()?.parse().ok()
}

fn corpus(name: &str) -> Value {
    let p = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../contrib/test/vectors/signing")
        .join(name);
    serde_json::from_str(&std::fs::read_to_string(p).unwrap()).unwrap()
}

fn seed_name() -> String {
    std::env::var("SPECULOS_SEED_NAME").unwrap_or_else(|_| "bip39-abandon-about".into())
}

fn auto_approve() -> bool {
    std::env::var("SPECULOS_AUTO_APPROVE").is_ok_and(|v| v == "1")
}

#[test]
#[ignore = "needs a running Speculos with the Thru app (SPECULOS_APDU_PORT)"]
fn speculos_app_and_pubkeys() {
    let Some(port) = port() else {
        eprintln!("{ENV_APDU_PORT} not set; skipping");
        return;
    };
    let dev = ThruLedger::new(SpeculosTransport::connect_local(port).unwrap());
    let cfg = dev.ensure_app().unwrap();
    assert_eq!(
        cfg.apdu_protocol_version,
        thru_ledger::consts::APDU_PROTOCOL_VERSION
    );
    assert_eq!(dev.get_app_name().unwrap(), "Thru");
    assert_eq!(dev.get_version().unwrap(), cfg.version);

    let hd = corpus("hd_vectors.json");
    let name = seed_name();
    let mut checked = 0;
    for v in hd["derivations"].as_array().unwrap() {
        if !v["name"]
            .as_str()
            .unwrap()
            .starts_with(&format!("{name}/no-passphrase/"))
        {
            continue;
        }
        let path: DerivationPath = v["path"].as_str().unwrap().parse().unwrap();
        let pk = dev.get_pubkey(&path, false).unwrap();
        assert_eq!(
            hex::encode(pk),
            v["pubkey_hex"].as_str().unwrap(),
            "{}",
            v["name"]
        );
        checked += 1;
    }
    assert!(checked > 0, "no derivations for seed name {name}");

    for v in hd["path_policy"].as_array().unwrap() {
        let bytes = hex::decode(v["path_apdu_hex"].as_str().unwrap()).unwrap();
        let cmd =
            thru_ledger::apdu::Command::thru(thru_ledger::consts::ins::GET_PUBKEY, 0, 0, bytes);
        let e = dev.exchange(&cmd).unwrap_err();
        assert_eq!(e.status_word(), Some(0x6820), "{}", v["name"]);
    }
}

#[test]
#[ignore = "needs Speculos with the abandon seed and an auto-approve automation rule"]
fn speculos_signs_corpus_vectors() {
    let Some(port) = port() else {
        eprintln!("{ENV_APDU_PORT} not set; skipping");
        return;
    };
    if !auto_approve() || seed_name() != "bip39-abandon-about" {
        eprintln!("needs SPECULOS_AUTO_APPROVE=1 and the abandon seed; skipping");
        return;
    }
    let path = DerivationPath::new(0).unwrap();
    let signer =
        LedgerSigner::connect(SpeculosTransport::connect_local(port).unwrap(), path).unwrap();
    let start = std::time::Instant::now();
    for v in corpus("txn_vectors.json").as_array().unwrap() {
        if v["category"] != "valid" {
            continue;
        }
        let body = hex::decode(v["body_hex"].as_str().unwrap()).unwrap();
        let wire = sign_transaction_body_with(&signer, &body).unwrap();
        assert_eq!(
            hex::encode(wire),
            v["wire_hex"].as_str().unwrap(),
            "{}",
            v["name"]
        );
    }
    eprintln!("valid txn vectors signed in {:?}", start.elapsed());
    for v in corpus("message_vectors.json").as_array().unwrap() {
        if v["category"] != "valid" {
            continue;
        }
        let msg = hex::decode(v["message_hex"].as_str().unwrap()).unwrap();
        let sig = signer.try_sign_message(&msg).unwrap();
        assert_eq!(
            hex::encode(sig),
            v["signature_hex"].as_str().unwrap(),
            "{}",
            v["name"]
        );
    }
    for v in corpus("eoa_auth_vectors.json").as_array().unwrap() {
        if v["category"] != "valid" || v["signer_path"] != "m/44'/8478'/0'/0'" {
            continue;
        }
        let kind = if v["kind"] == "create" {
            EoaAuthKind::Create
        } else {
            EoaAuthKind::Delete
        };
        let fp: [u8; 32] = hex::decode(v["fee_payer_hex"].as_str().unwrap())
            .unwrap()
            .try_into()
            .unwrap();
        let acct: [u8; 32] = hex::decode(v["account_hex"].as_str().unwrap())
            .unwrap()
            .try_into()
            .unwrap();
        let sig = signer
            .try_sign_eoa_auth(kind, v["chain_id"].as_u64().unwrap() as u16, &fp, &acct)
            .unwrap();
        assert_eq!(
            hex::encode(sig),
            v["signature_hex"].as_str().unwrap(),
            "{}",
            v["name"]
        );
    }
}

/// Token transfers between default token accounts, built as `thru token
/// transfer` builds them (TransferChecked, and the plain Transfer of
/// `--unchecked`), signed on the real app with the token hint (§7.2.1):
/// blind signing is not needed, the hint does not change the signature, and
/// the app itself refuses a wrong hint (`0x6814`) and an unknown hint kind
/// (`0x6813`) without a review.
#[test]
#[ignore = "needs Speculos with the abandon seed and something approving reviews"]
fn speculos_token_transfer_with_hint() {
    use thru_base::bootstrap_addresses::TOKEN_PROGRAM_BYTES;
    use thru_base::txn_tools::TransactionBuilder;
    use thru_ledger::apdu::Command;
    use thru_ledger::consts::{APDU_MAX_DATA, ins};
    use thru_ledger::{TokenHint, token_account_address};

    let Some(port) = port() else {
        eprintln!("{ENV_APDU_PORT} not set; skipping");
        return;
    };
    if !auto_approve() || seed_name() != "bip39-abandon-about" {
        eprintln!("needs SPECULOS_AUTO_APPROVE=1 and the abandon seed; skipping");
        return;
    }
    let path = DerivationPath::new(0).unwrap();
    let signer =
        LedgerSigner::connect(SpeculosTransport::connect_local(port).unwrap(), path).unwrap();
    let (mint, recipient) = ([0x33u8; 32], [0x22u8; 32]);
    let default_seed = [0u8; 32];
    let body = TransactionBuilder::build_token_transfer(
        signer.pubkey(),
        TOKEN_PROGRAM_BYTES,
        token_account_address(&signer.pubkey(), &mint, &default_seed),
        token_account_address(&recipient, &mint, &default_seed),
        signer.pubkey(),
        25,
        0,
        1,
        100,
    )
    .unwrap()
    .with_chain_id(1)
    .to_wire_for_signing();
    let checked_body = TransactionBuilder::build_token_transfer_checked(
        signer.pubkey(),
        TOKEN_PROGRAM_BYTES,
        token_account_address(&signer.pubkey(), &mint, &default_seed),
        token_account_address(&recipient, &mint, &default_seed),
        mint,
        25,
        6,
        b"USDC",
        0,
        1,
        100,
    )
    .unwrap()
    .with_chain_id(1)
    .to_wire_for_signing();
    let hint = TokenHint::new(mint, recipient);

    for (body, checked) in [(&checked_body, true), (&body, false)] {
        let hinted = signer
            .try_sign_transaction_body_with_token_hint(body, &hint)
            .unwrap();
        let Some(thru_ledger::Preview::Transaction(preview)) = signer.last_preview() else {
            panic!("no transaction preview")
        };
        assert!(preview.token_identity.is_some());
        assert!(!preview.requires_blind_signing);
        assert_eq!(preview.transfer.unwrap().checked.is_some(), checked);
        let plain = signer.try_sign_transaction_body(body).unwrap();
        assert_eq!(hinted, plain, "the hint is not signed");
    }

    // The app's own checks, with no host check in front (raw APDUs).
    let dev = ThruLedger::new(SpeculosTransport::connect_local(port).unwrap());
    let raw = |hint_bytes: &[u8]| -> u16 {
        let mut chunk0 = path.to_apdu_bytes();
        chunk0.extend_from_slice(hint_bytes);
        if let Err(e) = dev.exchange(&Command::thru(ins::SIGN_TXN, 0, 0x80, chunk0)) {
            return e.status_word().unwrap_or(0xFFFF);
        }
        let n = body.len().div_ceil(APDU_MAX_DATA);
        for (i, chunk) in body.chunks(APDU_MAX_DATA).enumerate() {
            let last = i + 1 == n;
            let cmd = Command::thru(
                ins::SIGN_TXN,
                (i + 1) as u8,
                if last { 0 } else { 0x80 },
                chunk.to_vec(),
            );
            if let Err(e) = dev.exchange(&cmd) {
                return e.status_word().unwrap_or(0xFFFF);
            }
        }
        0x9000
    };
    let wrong_mint = TokenHint {
        mint: [0x44; 32],
        ..hint
    };
    assert_eq!(raw(&wrong_mint.encode()), 0x6814);
    let mut unknown_kind = hint.encode();
    unknown_kind[0] = 0x02;
    assert_eq!(raw(&unknown_kind), 0x6813);
}
