//! Clear transfers and the token hint (`specs/ledger/app-thru-apdu.md`
//! §7.2.1, §7.6, §7.7).
//!
//! `fixtures/device-review-cases.json` is shared with the TypeScript signer.
//! It is generated from the device app's functional-test builders; the device
//! app's Ragger tests assert the same clear/blind verdicts and transfer fields
//! on the real app, and its hinted review is transcribed from the device
//! snapshots.

use std::sync::Arc;

use serde_json::Value;
use thru_ledger::apdu::{self, Command};
use thru_ledger::consts::{APDU_MAX_DATA, ins};
use thru_ledger::error::sw;
use thru_ledger::mock::{Review, SoftDevice, SoftDeviceSettings};
use thru_ledger::{
    DerivationPath, LedgerError, LedgerSigner, RequestReject, ThruLedger, TokenHint,
    TransactionPreview,
};

struct Case {
    name: String,
    body: Vec<u8>,
    clear: bool,
    hint: Option<TokenHint>,
    transfer_fields: Option<Vec<(String, String)>>,
    fields: Option<Vec<(String, String)>>,
}

fn key(v: &Value) -> [u8; 32] {
    hex::decode(v.as_str().unwrap())
        .unwrap()
        .try_into()
        .unwrap()
}

fn pairs(v: &Value) -> Vec<(String, String)> {
    v.as_array()
        .unwrap()
        .iter()
        .map(|p| {
            (
                p[0].as_str().unwrap().to_string(),
                p[1].as_str().unwrap().to_string(),
            )
        })
        .collect()
}

fn cases() -> (Vec<Case>, [u8; 32]) {
    let text = include_str!("fixtures/device-review-cases.json");
    let fixture: Value = serde_json::from_str(text).unwrap();
    let cases = fixture["cases"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| Case {
            name: c["name"].as_str().unwrap().to_string(),
            body: hex::decode(c["body_hex"].as_str().unwrap()).unwrap(),
            clear: c["clear"].as_bool().unwrap(),
            hint: c.get("hint").map(|h| TokenHint {
                mint: key(&h["mint"]),
                recipient_owner: key(&h["recipient_owner"]),
                recipient_seed: key(&h["recipient_seed"]),
                source_seed: key(&h["source_seed"]),
            }),
            transfer_fields: c.get("transfer_fields").map(pairs),
            fields: c.get("fields").map(pairs),
        })
        .collect();
    (cases, key(&fixture["signer_pubkey_hex"]))
}

fn shown(p: &TransactionPreview) -> Vec<(String, String)> {
    p.fields()
        .into_iter()
        .map(|(label, value)| (label.into_owned(), value))
        .collect()
}

#[test]
fn preview_matches_the_device_review() {
    let (cases, _) = cases();
    let mut kinds = std::collections::BTreeSet::new();
    for c in &cases {
        let p = TransactionPreview::from_body_with_hint(&c.body, c.hint.as_ref())
            .unwrap_or_else(|e| panic!("{}: {e}", c.name));
        assert_eq!(p.requires_blind_signing, !c.clear, "{}", c.name);
        assert_eq!(p.transfer.is_some(), c.clear, "{}", c.name);
        let fields = shown(&p);
        if let Some(expected) = &c.fields {
            assert_eq!(&fields, expected, "{}", c.name);
        } else if let Some(expected) = &c.transfer_fields {
            assert_eq!(&fields[..expected.len()], &expected[..], "{}", c.name);
            assert_eq!(fields[expected.len()].0, "Network", "{}", c.name);
            assert_eq!(fields.len(), expected.len() + 9, "{}", c.name);
        } else {
            assert_eq!(fields[0].0, "Network", "{}", c.name);
            assert_eq!(fields.len(), 9, "{}", c.name);
        }
        kinds.insert(match (&p.transfer, &p.token_identity) {
            (None, _) => "blind".to_string(),
            (Some(_), Some(_)) => "hinted".to_string(),
            (Some(t), None) => format!("{:?}", t.kind),
        });
    }
    assert_eq!(
        kinds.into_iter().collect::<Vec<_>>(),
        ["Native", "Token", "Wallet", "blind", "hinted"]
    );
}

#[test]
fn hinted_transfer_without_its_hint_shows_the_token_accounts() {
    let (cases, _) = cases();
    let c = cases.iter().find(|c| c.hint.is_some()).unwrap();
    let fields = shown(&TransactionPreview::from_body(&c.body).unwrap());
    assert_eq!(fields[4], ("Address type".into(), "Token accounts".into()));
    assert_eq!(
        fields[5],
        (
            "Token identity".into(),
            "Not provided by transaction".into()
        )
    );
}

#[test]
fn soft_device_signs_clear_transfers_with_blind_signing_off() {
    let (cases, signer) = cases();
    let dev = Arc::new(SoftDevice::abandon());
    dev.set_settings(SoftDeviceSettings {
        blind_signing: false,
        ..Default::default()
    });
    let s = LedgerSigner::connect(dev.clone(), DerivationPath::new(0).unwrap()).unwrap();
    assert_eq!(s.pubkey(), signer);
    for c in &cases {
        let result = match &c.hint {
            Some(hint) => s.try_sign_transaction_body_with_token_hint(&c.body, hint),
            None => s.try_sign_transaction_body(&c.body),
        };
        if !c.clear {
            assert!(
                matches!(result, Err(LedgerError::BlindSigningDisabled)),
                "{}: {result:?}",
                c.name
            );
            continue;
        }
        result.unwrap_or_else(|e| panic!("{}: {e}", c.name));
        let Some(Review::Transaction {
            action, token_mint, ..
        }) = dev.reviews().pop()
        else {
            panic!("{}: no transaction review", c.name)
        };
        assert!(action.is_some(), "{}", c.name);
        // A mint is shown from a verified hint or a checked transfer.
        let want_mint = c
            .fields
            .as_ref()
            .or(c.transfer_fields.as_ref())
            .and_then(|f| f.iter().find(|(label, _)| label == "Token mint"))
            .map(|(_, value)| value.clone());
        assert_eq!(token_mint, want_mint, "{}", c.name);
    }
}

/// A checked token transfer names its mint, so the hint must name the same
/// mint (§7.2.1): a hint that proves both token accounts but names another
/// mint is refused by the host and by the device.
#[test]
fn checked_transfer_hint_must_name_the_instruction_mint() {
    let (cases, _) = cases();
    let c = cases
        .iter()
        .find(|c| c.name == "token_transfer_checked_hinted")
        .unwrap();
    let hint = c.hint.unwrap();
    // The same token accounts (derived from the hint's mint); another mint,
    // the only read-only account, in the instruction.
    let mut body = c.body.clone();
    let ro = 112 + 2 * 32;
    body[ro..ro + 32].copy_from_slice(&[0xEE; 32]);
    let other = TransactionPreview::from_body(&body).unwrap();
    assert_eq!(other.transfer.unwrap().checked.unwrap().mint, [0xEE; 32]);
    assert!(matches!(
        TransactionPreview::from_body_with_hint(&body, Some(&hint)),
        Err(LedgerError::InvalidRequest(RequestReject::TokenHint))
    ));
    let dev = SoftDevice::abandon();
    let chunk0 = [
        DerivationPath::new(0).unwrap().to_apdu_bytes(),
        hint.encode().to_vec(),
    ]
    .concat();
    assert_eq!(
        raw_sign(&dev, chunk0.clone(), &body),
        sw::TOKEN_HINT_MISMATCH
    );
    assert_eq!(raw_sign(&dev, chunk0, &c.body), sw::OK);
}

#[test]
fn hint_goes_after_the_path_and_does_not_change_the_signature() {
    let (cases, _) = cases();
    let c = cases.iter().find(|c| c.hint.is_some()).unwrap();
    let hint = c.hint.unwrap();
    let path = DerivationPath::new(0).unwrap();
    let plain = apdu::sign_txn(&path, &c.body).unwrap();
    let hinted = apdu::sign_txn_with_hint(&path, &c.body, Some(&hint)).unwrap();
    let mut chunk0 = path.to_apdu_bytes();
    chunk0.extend_from_slice(&hint.encode());
    assert_eq!(hinted[0].data, chunk0);
    assert_eq!(hinted[1..], plain[1..]);

    let dev = Arc::new(SoftDevice::abandon());
    let s = LedgerSigner::connect(dev, path).unwrap();
    assert_eq!(
        s.try_sign_transaction_body_with_token_hint(&c.body, &hint)
            .unwrap(),
        s.try_sign_transaction_body(&c.body).unwrap()
    );
}

#[test]
fn host_refuses_a_wrong_hint_before_the_device() {
    let (cases, _) = cases();
    let c = cases.iter().find(|c| c.hint.is_some()).unwrap();
    let dev = Arc::new(SoftDevice::abandon());
    let s = LedgerSigner::connect(dev.clone(), DerivationPath::new(0).unwrap()).unwrap();
    let n = dev.apdu_log().len();
    for hint in [
        TokenHint {
            mint: [0x44; 32],
            ..c.hint.unwrap()
        },
        TokenHint {
            recipient_owner: s.pubkey(),
            ..c.hint.unwrap()
        },
        TokenHint {
            source_seed: [0x01; 32],
            ..c.hint.unwrap()
        },
    ] {
        let e = s
            .try_sign_transaction_body_with_token_hint(&c.body, &hint)
            .unwrap_err();
        assert!(
            matches!(e, LedgerError::InvalidRequest(RequestReject::TokenHint)),
            "{e:?}"
        );
    }
    // A hint on a transaction that is not a token transfer.
    let native = &cases
        .iter()
        .find(|c| c.name == "eoa_transfer")
        .unwrap()
        .body;
    assert!(matches!(
        s.try_sign_transaction_body_with_token_hint(native, &c.hint.unwrap()),
        Err(LedgerError::InvalidRequest(RequestReject::TokenHint))
    ));
    assert_eq!(dev.apdu_log().len(), n, "nothing was sent to the device");
}

/// Stream `body` after `chunk0` as raw SIGN_TXN APDUs; the status word of the
/// first refusal, or `0x9000`.
fn raw_sign(dev: &SoftDevice, chunk0: Vec<u8>, body: &[u8]) -> u16 {
    let ledger = ThruLedger::new(dev);
    let code = |e: LedgerError| e.status_word().unwrap_or(0xFFFF);
    if let Err(e) = ledger.exchange(&Command::thru(ins::SIGN_TXN, 0, 0x80, chunk0)) {
        return code(e);
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
        if let Err(e) = ledger.exchange(&cmd) {
            return code(e);
        }
    }
    sw::OK
}

#[test]
fn soft_device_applies_the_chunk0_and_last_chunk_rules() {
    let (cases, _) = cases();
    let c = cases.iter().find(|c| c.hint.is_some()).unwrap();
    let hint = c.hint.unwrap();
    let dev = SoftDevice::abandon();
    let path = DerivationPath::new(0).unwrap().to_apdu_bytes();
    let with = |extra: &[u8]| [path.as_slice(), extra].concat();

    let mut wrong_kind = hint.encode();
    wrong_kind[0] = 0x02;
    assert_eq!(
        raw_sign(&dev, with(&wrong_kind), &c.body),
        sw::TXN_HINT_INVALID
    );
    assert_eq!(
        raw_sign(&dev, with(&hint.encode()[..128]), &c.body),
        sw::WRONG_DATA_LENGTH
    );
    // A well-formed hint that does not prove the accounts: refused at the end.
    let wrong_mint = TokenHint {
        mint: [0x44; 32],
        ..hint
    };
    assert_eq!(
        raw_sign(&dev, with(&wrong_mint.encode()), &c.body),
        sw::TOKEN_HINT_MISMATCH
    );
    assert_eq!(raw_sign(&dev, with(&hint.encode()), &c.body), sw::OK);
}

#[test]
fn hint_status_words_map_to_typed_errors() {
    assert!(matches!(
        LedgerError::from_sw(sw::TOKEN_HINT_MISMATCH),
        LedgerError::InvalidRequest(RequestReject::TokenHint)
    ));
    let e = LedgerError::from_sw(sw::TXN_HINT_INVALID);
    assert!(
        matches!(e, LedgerError::Unsupported { sw: 0x6813 }),
        "{e:?}"
    );
    assert_eq!(e.status_word(), Some(0x6813));
    assert_eq!(RequestReject::TokenHint.sw(), 0x6814);
    assert_eq!(RequestReject::TokenHint.class(), "token_hint");
}
