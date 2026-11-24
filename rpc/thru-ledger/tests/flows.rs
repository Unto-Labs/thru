//! Protocol flows over the scripted [`MockTransport`] (exact bytes on the
//! wire, every status-word mapping) and the [`SoftDevice`] emulator (session
//! rules, settings, approvals, the `Signer` trait).

use std::sync::{Arc, Mutex};
use std::time::Duration;

use thru_base::signer::{
    EoaAuthKind, SignError, Signer, build_transaction_signing_message, sign_eoa_auth_with,
    sign_message_with, sign_transaction_body_with, sign_with,
};
use thru_base::txn_lib::Transaction;
use thru_base::txn_tools::{EOA_PROGRAM, TransactionBuilder};
use thru_ledger::apdu::{self, Command};
use thru_ledger::consts::ins;
use thru_ledger::error::sw;
use thru_ledger::mock::{MockTransport, Review, SoftDevice, SoftDeviceSettings};
use thru_ledger::{
    BusyRetry, DerivationPath, LedgerError, LedgerSigner, Operation, Progress, RequestReject,
    ThruLedger, TxnReject,
};

const PK0: &str = "1d65dd4d10f4f8a392d9e17c4d8cdea7c68e2a3eadc35997bbb6738e39cc0e6e";
const PK1: &str = "546fdb52f2026f707260cf7c9c8ffdacd4c3c05624487893f6426168b5a1eb63";

fn h(s: &str) -> Vec<u8> {
    hex::decode(s.replace([' ', '\n'], "")).unwrap()
}

fn pk(s: &str) -> [u8; 32] {
    h(s).try_into().unwrap()
}

fn path0() -> DerivationPath {
    DerivationPath::new(0).unwrap()
}

fn ok(data: &[u8]) -> Vec<u8> {
    let mut v = data.to_vec();
    v.extend_from_slice(&[0x90, 0x00]);
    v
}

fn app_and_version(name: &str) -> Vec<u8> {
    let mut v = vec![1, name.len() as u8];
    v.extend_from_slice(name.as_bytes());
    v.extend_from_slice(&[5]);
    v.extend_from_slice(b"1.0.0");
    ok(&v)
}

/// Script the connect handshake: B0 01, GET_APP_CONFIG, GET_PUBKEY (silent).
fn script_connect(m: &MockTransport, pubkey: &[u8; 32]) {
    m.expect(h("B0 01 00 00 00"), app_and_version("Thru"));
    m.expect(h("E0 05 00 00 00"), ok(&h("01 01 00 00 01")));
    m.expect(
        apdu::get_pubkey(&path0(), false).encode().unwrap(),
        ok(pubkey),
    );
}

/// A valid transfer body whose fee payer is `fee_payer`.
fn transfer_body(fee_payer: [u8; 32]) -> Vec<u8> {
    TransactionBuilder::build_transfer(fee_payer, EOA_PROGRAM, [7u8; 32], 1_000, 1, 5, 100)
        .unwrap()
        .with_chain_id(1)
        .to_wire_for_signing()
}

/// A valid body of roughly `len` bytes (instruction data pads it).
fn big_body(fee_payer: [u8; 32], instr: usize) -> Vec<u8> {
    Transaction::new(fee_payer, EOA_PROGRAM, 1, 0)
        .with_chain_id(1)
        .with_instructions(vec![0x5Au8; instr])
        .to_wire_for_signing()
}

// ---------------------------------------------------------------------------
// MockTransport: exact wire sequences
// ---------------------------------------------------------------------------

#[test]
fn connect_handshake_bytes() {
    let m = Arc::new(MockTransport::new());
    script_connect(&m, &pk(PK0));
    let s = LedgerSigner::connect(m.clone(), path0()).unwrap();
    assert_eq!(s.pubkey(), pk(PK0));
    assert_eq!(
        s.address(),
        "taHWXdTRD0-KOS2eF8TYzep8aOKj6tw1mXu7ZzjjnMDm6A"
    );
    assert!(s.app_config().blind_signing_enabled);
    assert_eq!(m.remaining(), 0);
}

#[test]
fn oversized_apdu_is_rejected_before_transport() {
    let transport = Arc::new(MockTransport::new());
    let device = ThruLedger::new(transport.clone());
    let mut command = Command::thru(ins::GET_VERSION, 0, 0, vec![0x5a; 255]);
    let mut expected = vec![0xe0, ins::GET_VERSION, 0, 0, 255];
    expected.extend_from_slice(&command.data);
    transport.expect(expected.clone(), ok(&[]));
    assert_eq!(device.exchange(&command).unwrap(), Vec::<u8>::new());

    command.data.push(0x5a);
    assert!(matches!(
        command.encode(),
        Err(LedgerError::InvalidInput(_))
    ));
    assert!(matches!(
        device.exchange(&command),
        Err(LedgerError::InvalidInput(_))
    ));
    assert_eq!(transport.sent(), vec![expected]);
}

#[test]
fn connect_falls_back_to_get_app_name() {
    let m = Arc::new(MockTransport::new());
    m.expect(h("B0 01 00 00 00"), h("6E 00"));
    m.expect(h("E0 04 00 00 00"), ok(b"Thru"));
    m.expect(h("E0 05 00 00 00"), ok(&h("00 01 00 00 01")));
    m.respond(ok(&pk(PK0)));
    let s = LedgerSigner::connect(m.clone(), path0()).unwrap();
    assert!(!s.app_config().blind_signing_enabled);
}

#[test]
fn connect_errors() {
    // Dashboard open.
    let m = Arc::new(MockTransport::new());
    m.respond(app_and_version("BOLOS"));
    let e = LedgerSigner::connect(m.clone(), path0()).unwrap_err();
    assert!(matches!(e, LedgerError::WrongApp { .. }), "{e:?}");
    assert!(e.to_string().contains("open the Thru app"));

    // Locked.
    let m = Arc::new(MockTransport::new());
    m.respond(h("55 15"));
    let e = LedgerSigner::connect(m.clone(), path0()).unwrap_err();
    assert!(matches!(e, LedgerError::Locked), "{e:?}");
    assert!(e.to_string().contains("unlock"));

    // Wrong protocol version.
    let m = Arc::new(MockTransport::new());
    m.respond(app_and_version("Thru"));
    m.respond(ok(&h("01 02 00 00 02")));
    let e = LedgerSigner::connect(m.clone(), path0()).unwrap_err();
    assert!(
        matches!(e, LedgerError::UnsupportedAppVersion { device: 2, host: 1 }),
        "{e:?}"
    );

    // Wrong app answering a Thru INS with an OS code.
    for code in ["6E 01", "65 11", "6D 02"] {
        let m = Arc::new(MockTransport::new());
        m.respond(h("6E 00")); // B0 01 not answered
        m.respond(h(code));
        let e = LedgerSigner::connect(m.clone(), path0()).unwrap_err();
        assert!(matches!(e, LedgerError::WrongApp { .. }), "{code}: {e:?}");
    }

    // Device key differs from the expected (configured) key.
    let m = Arc::new(MockTransport::new());
    script_connect(&m, &pk(PK1));
    let e = LedgerSigner::connect_expecting(m.clone(), path0(), &pk(PK0)).unwrap_err();
    assert!(matches!(e, LedgerError::KeyMismatch { .. }), "{e:?}");

    // Transport failure.
    let m = Arc::new(MockTransport::new());
    let e = LedgerSigner::connect(m.clone(), path0()).unwrap_err();
    assert!(matches!(e, LedgerError::Transport(_)), "{e:?}");
}

/// A short 0x6901 policy so the tests stay fast.
fn fast_busy_retry(budget_ms: u64) -> BusyRetry {
    BusyRetry {
        budget: Duration::from_millis(budget_ms),
        initial_delay: Duration::from_millis(5),
        max_delay: Duration::from_millis(20),
    }
}

#[test]
fn busy_status_page_is_retried_with_the_same_apdu() {
    // The SDK answers 0x6901 while the status page of the previous review
    // is up; the client resends the identical APDU until the app answers.
    let m = Arc::new(MockTransport::new());
    m.expect(h("E0 05 00 00 00"), h("69 01"));
    m.expect(h("E0 05 00 00 00"), h("69 01"));
    m.expect(h("E0 05 00 00 00"), ok(&h("01 01 00 00 01")));
    let mut dev = ThruLedger::new(m.clone());
    dev.set_busy_retry(fast_busy_retry(2_000));
    let cfg = dev.get_app_config().unwrap();
    assert!(cfg.blind_signing_enabled);
    assert_eq!(m.remaining(), 0);
    assert_eq!(m.sent().len(), 3);
}

#[test]
fn busy_retry_covers_the_first_signing_chunk() {
    // A new SIGN_TXN started while the previous status page is shown: chunk
    // 0 bounces with 0x6901, is resent, and the stream continues.
    let dev_sw = SoftDevice::abandon();
    let body = transfer_body(dev_sw.pubkey(&path0()));
    let sig = dev_sign(&dev_sw, &body);
    let cmds = apdu::sign_txn(&path0(), &body).unwrap();
    let m = Arc::new(MockTransport::new());
    m.expect(cmds[0].encode().unwrap(), h("69 01"));
    m.expect(cmds[0].encode().unwrap(), ok(&[]));
    for (i, c) in cmds.iter().enumerate().skip(1) {
        let last = i + 1 == cmds.len();
        m.expect(c.encode().unwrap(), if last { ok(&sig) } else { ok(&[]) });
    }
    let mut dev = ThruLedger::new(m.clone());
    dev.set_busy_retry(fast_busy_retry(2_000));
    assert_eq!(dev.sign_txn(&path0(), &body).unwrap(), sig);
    assert_eq!(m.remaining(), 0);
}

#[test]
fn busy_retry_is_bounded() {
    let m = Arc::new(MockTransport::new());
    for _ in 0..200 {
        m.respond(h("69 01"));
    }
    let mut dev = ThruLedger::new(m.clone());
    dev.set_busy_retry(fast_busy_retry(60));
    let started = std::time::Instant::now();
    let err = dev.get_app_config().unwrap_err();
    assert!(matches!(err, LedgerError::Busy), "{err:?}");
    assert_eq!(err.status_word(), Some(sw::SDK_CMD_NOT_ACCEPTED));
    assert!(started.elapsed() < Duration::from_millis(1_000));
    let tries = m.sent().len();
    assert!((2..200).contains(&tries), "{tries} attempts");

    // BusyRetry::NONE: one attempt, then Busy.
    let m = Arc::new(MockTransport::new());
    m.respond(h("69 01"));
    let mut dev = ThruLedger::new(m.clone());
    dev.set_busy_retry(BusyRetry::NONE);
    assert!(matches!(dev.get_app_config(), Err(LedgerError::Busy)));
    assert_eq!(m.sent().len(), 1);
}

#[test]
fn busy_retry_default_is_about_five_seconds() {
    let d = BusyRetry::default();
    assert_eq!(d.budget, Duration::from_secs(5));
    assert!(d.initial_delay <= Duration::from_millis(200));
    assert!(d.max_delay <= Duration::from_secs(1));
}

#[test]
fn sdk_bad_len_is_a_protocol_error_not_retried() {
    let m = Arc::new(MockTransport::new());
    m.expect(h("E0 05 00 00 00"), h("6E 03"));
    let err = ThruLedger::new(m.clone()).get_app_config().unwrap_err();
    assert!(
        matches!(err, LedgerError::ProtocolError { sw: 0x6E03, .. }),
        "{err:?}"
    );
    assert_eq!(m.sent().len(), 1);
}

#[test]
fn sign_txn_chunk_sequence_on_the_wire() {
    let dev = SoftDevice::abandon();
    let body = big_body(dev.pubkey(&path0()), 600 - 112);
    assert_eq!(body.len(), 600);
    let sig = dev_sign(&dev, &body);

    let m = Arc::new(MockTransport::new());
    m.expect(
        h("E0 07 00 80 11 04 80 00 00 2C 80 00 21 1E 80 00 00 00 80 00 00 00"),
        ok(&[]),
    );
    let mut wire = h("E0 07 01 80 FF");
    wire.extend_from_slice(&body[..255]);
    m.expect(wire, ok(&[]));
    let mut wire = h("E0 07 02 80 FF");
    wire.extend_from_slice(&body[255..510]);
    m.expect(wire, ok(&[]));
    let mut wire = h("E0 07 03 00 5A");
    wire.extend_from_slice(&body[510..]);
    m.expect(wire, ok(&sig));
    let got = ThruLedger::new(m.clone())
        .sign_txn(&path0(), &body)
        .unwrap();
    assert_eq!(got, sig);
    assert_eq!(m.remaining(), 0);
}

fn dev_sign(dev: &SoftDevice, body: &[u8]) -> [u8; 64] {
    ThruLedger::new(dev).sign_txn(&path0(), body).unwrap()
}

/// Every device status word returned mid-stream maps to its typed error, and
/// nothing more is sent after it.
#[test]
fn every_status_word_maps_mid_stream() {
    use LedgerError as E;
    type Check = fn(&E) -> bool;
    let cases: Vec<(u16, Check)> = vec![
        (0x6700, |e| matches!(e, E::ProtocolError { sw: 0x6700, .. })),
        (0x6985, |e| matches!(e, E::UserRejected)),
        (0x6A86, |e| matches!(e, E::ProtocolError { sw: 0x6A86, .. })),
        (0x6D00, |e| matches!(e, E::Unsupported { sw: 0x6D00 })),
        (0x6E00, |e| matches!(e, E::WrongApp { .. })),
        (0x6F00, |e| matches!(e, E::DeviceError)),
        (0x6801, |e| {
            matches!(e, E::InvalidTransaction(TxnReject::InvalidFormat))
        }),
        (0x6802, |e| {
            matches!(e, E::InvalidTransaction(TxnReject::InvalidVersion))
        }),
        (0x6803, |e| {
            matches!(e, E::InvalidTransaction(TxnReject::InvalidFlags))
        }),
        (0x6804, |e| {
            matches!(e, E::InvalidTransaction(TxnReject::ChainIdZero))
        }),
        (0x6805, |e| {
            matches!(e, E::InvalidTransaction(TxnReject::InvalidProofType))
        }),
        (0x6806, |e| {
            matches!(e, E::InvalidTransaction(TxnReject::AccountLimit))
        }),
        (0x6807, |e| {
            matches!(e, E::InvalidTransaction(TxnReject::DuplicateAccount))
        }),
        (0x6808, |e| matches!(e, E::BlindSigningDisabled)),
        (0x6809, |e| {
            matches!(e, E::InvalidTransaction(TxnReject::UnsortedReadWrite))
        }),
        (0x680A, |e| {
            matches!(e, E::InvalidTransaction(TxnReject::UnsortedReadOnly))
        }),
        (0x6810, |e| matches!(e, E::FeePayerMismatch)),
        (0x6811, |e| {
            matches!(e, E::InvalidTransaction(TxnReject::PadNonzero))
        }),
        (0x6812, |e| {
            matches!(e, E::InvalidTransaction(TxnReject::RwCacheExceeded))
        }),
        (0x6820, |e| matches!(e, E::PathRejected)),
        (0x6830, |e| matches!(e, E::ProtocolError { sw: 0x6830, .. })),
        (0x6831, |e| matches!(e, E::ProtocolError { sw: 0x6831, .. })),
        (0x6840, |e| {
            matches!(e, E::InvalidRequest(RequestReject::MessageLength))
        }),
        (0x6841, |e| matches!(e, E::ProtocolError { sw: 0x6841, .. })),
        (0x6850, |e| matches!(e, E::EoaAccountMismatch)),
        (0x6851, |e| {
            matches!(e, E::InvalidRequest(RequestReject::EoaKind))
        }),
        (0x5515, |e| matches!(e, E::Locked)),
        (0x6E01, |e| matches!(e, E::WrongApp { .. })),
        (0x6511, |e| matches!(e, E::WrongApp { .. })),
        (0x6D02, |e| matches!(e, E::WrongApp { .. })),
        (0x6A80, |e| matches!(e, E::Unknown(0x6A80))),
    ];
    let body = big_body(pk(PK0), 600 - 112);
    for (code, check) in cases {
        let m = Arc::new(MockTransport::new());
        m.respond(ok(&[]));
        m.respond_sw(&[], code);
        m.respond(ok(&[])); // must not be consumed
        let e = ThruLedger::new(m.clone())
            .sign_txn(&path0(), &body)
            .unwrap_err();
        assert!(check(&e), "0x{code:04X} -> {e:?}");
        assert_eq!(
            m.sent().len(),
            2,
            "0x{code:04X}: kept streaming after an error"
        );
    }
}

#[test]
fn unexpected_response_shapes() {
    let m = Arc::new(MockTransport::new());
    m.respond(ok(&[1, 2, 3])); // intermediate chunk with data
    let e = ThruLedger::new(m.clone())
        .sign_txn(&path0(), &[1u8; 300])
        .unwrap_err();
    assert!(matches!(e, LedgerError::UnexpectedResponse(_)), "{e:?}");

    let m = Arc::new(MockTransport::new());
    m.respond(ok(&[0u8; 31]));
    let e = ThruLedger::new(m.clone())
        .get_pubkey(&path0(), false)
        .unwrap_err();
    assert!(matches!(e, LedgerError::UnexpectedResponse(_)));

    let m = Arc::new(MockTransport::new());
    m.respond(vec![0x90]);
    assert!(ThruLedger::new(m.clone()).get_version().is_err());
}

#[test]
fn message_two_pass_on_the_wire() {
    let msg: Vec<u8> = (0..600u32).map(|i| b'a' + (i % 26) as u8).collect();
    let dev = SoftDevice::abandon();
    let sig = ThruLedger::new(&dev).sign_message(&path0(), &msg).unwrap();

    let m = Arc::new(MockTransport::new());
    m.expect(
        h("E0 08 00 80 15 04 80 00 00 2C 80 00 21 1E 80 00 00 00 80 00 00 00 00 00 02 58"),
        ok(&[]),
    );
    for pass in 0..2 {
        for (i, (p2, range)) in [(0x80u8, 0..255), (0x80, 255..510), (0x00, 510..600)]
            .into_iter()
            .enumerate()
        {
            let mut wire = vec![0xE0, 0x08, (i + 1) as u8, p2, range.len() as u8];
            wire.extend_from_slice(&msg[range]);
            let last_of_pass2 = pass == 1 && i == 2;
            m.expect(wire, if last_of_pass2 { ok(&sig) } else { ok(&[]) });
        }
    }
    let got = ThruLedger::new(m.clone())
        .sign_message(&path0(), &msg)
        .unwrap();
    assert_eq!(got, sig);
    assert_eq!(m.remaining(), 0);
    assert_eq!(m.sent().len(), 7);
}

#[test]
fn message_rejected_after_pass1_sends_no_pass2() {
    let m = Arc::new(MockTransport::new());
    m.respond(ok(&[]));
    m.respond(h("69 85"));
    let e = ThruLedger::new(m.clone())
        .sign_message(&path0(), b"hello")
        .unwrap_err();
    assert!(matches!(e, LedgerError::UserRejected));
    assert_eq!(m.sent().len(), 2);
}

/// §5.3: `0x6804` is a transaction reason for SIGN_TXN but an invalid
/// request for SIGN_EOA_AUTH.
#[test]
fn chain_id_zero_maps_by_command() {
    let m = Arc::new(MockTransport::new());
    m.respond(h("68 04"));
    let e = ThruLedger::new(m.clone())
        .sign_eoa_auth(&path0(), EoaAuthKind::Create, 0, &pk(PK1), &pk(PK0))
        .unwrap_err();
    assert!(
        matches!(e, LedgerError::InvalidRequest(RequestReject::ChainIdZero)),
        "{e:?}"
    );
    let m = Arc::new(MockTransport::new());
    m.respond(ok(&[]));
    m.respond(h("68 04"));
    let e = ThruLedger::new(m.clone())
        .sign_txn(&path0(), &[1u8; 112])
        .unwrap_err();
    assert!(
        matches!(e, LedgerError::InvalidTransaction(TxnReject::ChainIdZero)),
        "{e:?}"
    );
}

/// INS 0x01 is reserved (§11.0) and never sent by any operation.
#[test]
fn reserved_ins_is_never_sent() {
    let dev = Arc::new(SoftDevice::abandon());
    let s = LedgerSigner::connect(dev.clone(), path0()).unwrap();
    s.verify_address_on_device().unwrap();
    s.try_sign_transaction_body(&transfer_body(s.pubkey()))
        .unwrap();
    s.try_sign_message(b"hi").unwrap();
    s.try_sign_eoa_auth(EoaAuthKind::Create, 1, &pk(PK1), &s.pubkey())
        .unwrap();
    s.refresh_app_config().unwrap();
    assert!(
        dev.apdu_log()
            .iter()
            .all(|a| !(a[0] == 0xE0 && a[1] == thru_ledger::consts::ins::RESERVED_01))
    );
}

#[test]
fn eoa_auth_on_the_wire() {
    let m = Arc::new(MockTransport::new());
    script_connect(&m, &pk(PK0));
    let dev = SoftDevice::abandon();
    let sig = ThruLedger::new(&dev)
        .sign_eoa_auth(&path0(), EoaAuthKind::Create, 1, &pk(PK1), &pk(PK0))
        .unwrap();
    m.expect(
        apdu::sign_eoa_auth(&path0(), EoaAuthKind::Create, 1, &pk(PK1), &pk(PK0))
            .encode()
            .unwrap(),
        ok(&sig),
    );
    let s = LedgerSigner::connect(m.clone(), path0()).unwrap();
    assert_eq!(
        sign_eoa_auth_with(&s, EoaAuthKind::Create, 1, &pk(PK1), &pk(PK0)).unwrap(),
        sig
    );
}

#[test]
fn garbage_signatures_are_rejected() {
    let body = transfer_body(pk(PK0));
    let m = Arc::new(MockTransport::new());
    script_connect(&m, &pk(PK0));
    m.respond(ok(&[]));
    m.respond(ok(&[0x11u8; 64]));
    let s = LedgerSigner::connect(m.clone(), path0()).unwrap();
    assert!(matches!(
        sign_transaction_body_with(&s, &body),
        Err(SignError::InvalidSignature)
    ));

    // A valid signature for a different message is also rejected.
    let dev = SoftDevice::abandon();
    let other = ThruLedger::new(&dev)
        .sign_message(&path0(), b"other")
        .unwrap();
    let m = Arc::new(MockTransport::new());
    script_connect(&m, &pk(PK0));
    m.respond(ok(&[]));
    m.respond(ok(&[]));
    m.respond(ok(&other));
    let s = LedgerSigner::connect(m.clone(), path0()).unwrap();
    assert!(matches!(
        s.try_sign_message(b"hello"),
        Err(LedgerError::InvalidSignature)
    ));
}

#[test]
fn progress_reports_chunks_and_user_wait() {
    let dev = Arc::new(SoftDevice::abandon());
    let events: Arc<Mutex<Vec<Progress>>> = Arc::default();
    let sink = events.clone();
    let s = LedgerSigner::connect(dev.clone(), path0())
        .unwrap()
        .with_progress(Some(Arc::new(move |p: &Progress| {
            sink.lock().unwrap().push(*p)
        })));
    let body = big_body(s.pubkey(), 2000);
    s.try_sign_transaction_body(&body).unwrap();
    let ev = events.lock().unwrap().clone();
    let total = 1 + body.len().div_ceil(255);
    assert_eq!(ev.len(), total);
    assert!(ev.iter().all(|p| p.operation == Operation::SignTransaction));
    assert!(
        ev.iter()
            .all(|p| p.chunks_total == total && p.bytes_total == body.len())
    );
    assert!(ev[..total - 1].iter().all(|p| !p.awaiting_user));
    assert!(ev[total - 1].awaiting_user);
    assert_eq!(ev[total - 1].bytes_sent, 255 * (total - 2));

    events.lock().unwrap().clear();
    s.try_sign_message(b"hello").unwrap();
    let ev = events.lock().unwrap().clone();
    assert_eq!(ev.len(), 2);
    assert_eq!(ev[0].operation, Operation::SignMessagePass1);
    assert!(ev[0].awaiting_user);
    assert_eq!(ev[1].operation, Operation::SignMessagePass2);
    assert!(!ev[1].awaiting_user);
}

// ---------------------------------------------------------------------------
// SoftDevice: Signer trait end to end
// ---------------------------------------------------------------------------

#[test]
fn signer_trait_end_to_end() {
    let dev = Arc::new(SoftDevice::abandon());
    let s = LedgerSigner::connect(dev.clone(), path0()).unwrap();
    assert!(!s.supports_legacy_scheme());
    assert_eq!(s.public_key(), pk(PK0));

    // Transaction via sign_transaction_body_with.
    let body = transfer_body(s.pubkey());
    let wire = sign_transaction_body_with(&s, &body).unwrap();
    assert_eq!(&wire[..body.len()], &body[..]);

    // Transaction via the opaque SigningMessage: the device gets the body.
    let msg = build_transaction_signing_message(&body).unwrap();
    assert_eq!(sign_with(&s, &msg).unwrap(), wire);
    let last_body_chunk = dev.apdu_log().last().unwrap().clone();
    assert_eq!(&last_body_chunk[5..], &body[..]);

    // Transaction::sign_with_signer (the CLI path).
    let mut tx =
        TransactionBuilder::build_transfer(s.pubkey(), EOA_PROGRAM, [9u8; 32], 5, 1, 0, 10)
            .unwrap()
            .with_chain_id(2);
    tx.sign_with_signer(&s).unwrap();
    assert!(tx.verify());

    // Messages, including hash mode and the 32 KiB maximum.
    for m in [&b"hello"[..], &[0u8, 1, 2][..], &vec![b'x'; 32_768][..]] {
        sign_message_with(&s, m).unwrap();
    }
    assert!(matches!(s.sign_message(&[]), Err(SignError::Backend(_))));

    // EOA create and delete.
    for kind in [EoaAuthKind::Create, EoaAuthKind::Delete] {
        sign_eoa_auth_with(&s, kind, 1, &pk(PK1), &s.pubkey()).unwrap();
    }

    // Wrong fee payer / wrong account: KeyMismatch before the device is used.
    let n = dev.apdu_log().len();
    assert!(matches!(
        sign_transaction_body_with(&s, &transfer_body(pk(PK1))),
        Err(SignError::KeyMismatch { .. })
    ));
    assert!(matches!(
        s.sign_transaction_body(&transfer_body(pk(PK1))),
        Err(SignError::KeyMismatch { .. })
    ));
    assert!(matches!(
        s.sign_eoa_auth(EoaAuthKind::Create, 1, &pk(PK0), &pk(PK1)),
        Err(SignError::KeyMismatch { .. })
    ));
    assert!(
        s.try_sign_eoa_auth(EoaAuthKind::Create, 0, &pk(PK1), &pk(PK0))
            .is_err()
    );
    assert_eq!(dev.apdu_log().len(), n);
}

#[test]
fn rejection_maps_to_sign_error_rejected() {
    let dev = Arc::new(SoftDevice::abandon());
    dev.set_approver(|_| false);
    let s = LedgerSigner::connect(dev.clone(), path0()).unwrap();
    let body = transfer_body(s.pubkey());
    assert!(matches!(
        sign_transaction_body_with(&s, &body),
        Err(SignError::Rejected)
    ));
    assert!(matches!(
        s.try_sign_message(b"hi"),
        Err(LedgerError::UserRejected)
    ));
    assert!(matches!(
        s.verify_address_on_device(),
        Err(LedgerError::UserRejected)
    ));
}

#[test]
fn verify_address_shows_address_and_path() {
    let dev = Arc::new(SoftDevice::abandon());
    let s = LedgerSigner::connect(dev.clone(), DerivationPath::new(1).unwrap()).unwrap();
    assert_eq!(s.verify_address_on_device().unwrap(), pk(PK1));
    assert_eq!(
        dev.reviews().last().unwrap(),
        &Review::Address {
            address: s.address(),
            path: "m/44'/8478'/1'/0'".into()
        }
    );
}

#[test]
fn blind_signing_off() {
    let dev = Arc::new(SoftDevice::abandon());
    dev.set_settings(SoftDeviceSettings {
        blind_signing: false,
        ..Default::default()
    });
    let s = LedgerSigner::connect(dev.clone(), path0()).unwrap();
    assert!(!s.app_config().blind_signing_enabled);
    // A native transfer is reviewed in clear (§7.7): no setting needed.
    s.try_sign_transaction_body(&transfer_body(s.pubkey()))
        .unwrap();
    // Any other instruction needs it.  The device decides once the whole body
    // has arrived (§7.6): chunk 0 and the one data chunk were both sent.
    let body = big_body(s.pubkey(), 20);
    let n = dev.apdu_log().len();
    let e = s.try_sign_transaction_body(&body).unwrap_err();
    assert!(matches!(e, LedgerError::BlindSigningDisabled), "{e:?}");
    assert_eq!(dev.apdu_log().len(), n + 2);
    // Text-mode messages do not need blind signing; hash mode does.
    s.try_sign_message(b"plain text\n").unwrap();
    assert!(matches!(
        s.try_sign_message(&[0xFF, 0x00]),
        Err(LedgerError::BlindSigningDisabled)
    ));
    assert!(matches!(
        s.try_sign_message(&vec![b'a'; 513]),
        Err(LedgerError::BlindSigningDisabled)
    ));
    // EOA authorization is clear-signed.
    s.try_sign_eoa_auth(EoaAuthKind::Create, 1, &pk(PK1), &s.pubkey())
        .unwrap();
}

#[test]
fn locked_and_wrong_app_via_softdevice() {
    let dev = Arc::new(SoftDevice::abandon());
    dev.set_settings(SoftDeviceSettings {
        locked: true,
        ..Default::default()
    });
    assert!(matches!(
        LedgerSigner::connect(dev.clone(), path0()),
        Err(LedgerError::Locked)
    ));
    dev.set_settings(SoftDeviceSettings {
        app_open: false,
        ..Default::default()
    });
    assert!(matches!(
        LedgerSigner::connect(dev.clone(), path0()),
        Err(LedgerError::WrongApp { .. })
    ));
}

// ---------------------------------------------------------------------------
// SoftDevice: session state machine (§10) and A.3 negative variants
// ---------------------------------------------------------------------------

fn raw(dev: &SoftDevice, cmd: &Command) -> u16 {
    let r = dev.process(&cmd.encode().unwrap());
    u16::from_be_bytes([r[r.len() - 2], r[r.len() - 1]])
}

#[test]
fn session_rules() {
    let dev = SoftDevice::abandon();
    let body = transfer_body(dev.pubkey(&path0()));
    let cmds = apdu::sign_txn(&path0(), &body).unwrap();

    // Continuation without a session.
    assert_eq!(raw(&dev, &cmds[1]), sw::CHUNK_OUT_OF_ORDER);
    // Wrong P1.
    assert_eq!(raw(&dev, &cmds[0]), sw::OK);
    let mut skip = cmds[1].clone();
    skip.p1 = 2;
    assert_eq!(raw(&dev, &skip), sw::CHUNK_OUT_OF_ORDER);
    // ...which cleared the session.
    assert_eq!(raw(&dev, &cmds[1]), sw::CHUNK_OUT_OF_ORDER);
    // Interleaving another INS aborts the session.
    assert_eq!(raw(&dev, &cmds[0]), sw::OK);
    assert_eq!(raw(&dev, &apdu::get_version()), sw::OK);
    assert_eq!(raw(&dev, &cmds[1]), sw::CHUNK_OUT_OF_ORDER);
    // An OS-level APDU (B0 01) is handled by the OS and does not abort it.
    assert_eq!(raw(&dev, &cmds[0]), sw::OK);
    assert_eq!(raw(&dev, &apdu::os_get_app_and_version()), sw::OK);
    assert_eq!(raw(&dev, &cmds[1]), sw::OK);
    // Chunk 0 with P2 = 0 and a bad P2 on a data chunk.
    let mut c0 = cmds[0].clone();
    c0.p2 = 0;
    assert_eq!(raw(&dev, &c0), sw::WRONG_P1P2);
    assert_eq!(raw(&dev, &cmds[0]), sw::OK);
    let mut bad = cmds[1].clone();
    bad.p2 = 0x40;
    assert_eq!(raw(&dev, &bad), sw::WRONG_P1P2);
    // Restart from chunk 0 works and P1 = 0 always resets.
    assert_eq!(raw(&dev, &cmds[0]), sw::OK);
    assert_eq!(raw(&dev, &cmds[0]), sw::OK);
    assert_eq!(raw(&dev, &cmds[1]), sw::OK);
    // A chunk after the session finished.
    assert_eq!(raw(&dev, &cmds[1]), sw::CHUNK_OUT_OF_ORDER);
    // Simple commands with data / bad P1.
    assert_eq!(
        raw(&dev, &Command::thru(ins::GET_VERSION, 0, 0, vec![1])),
        sw::WRONG_DATA_LENGTH
    );
    assert_eq!(
        raw(
            &dev,
            &Command::thru(ins::GET_PUBKEY, 2, 0, path0().to_apdu_bytes())
        ),
        sw::WRONG_P1P2
    );
    assert_eq!(
        raw(&dev, &Command::thru(0x42, 0, 0, vec![])),
        sw::INS_NOT_SUPPORTED
    );
    let mut cla = apdu::get_version();
    cla.cla = 0xE1;
    assert_eq!(raw(&dev, &cla), sw::CLA_NOT_SUPPORTED);
    // Path with extra bytes.
    let mut long = path0().to_apdu_bytes();
    long.push(0);
    assert_eq!(
        raw(&dev, &Command::thru(ins::GET_PUBKEY, 0, 0, long)),
        sw::WRONG_DATA_LENGTH
    );
}

#[test]
fn appendix_a3_negative_variants() {
    let dev = SoftDevice::abandon();
    let minimal = {
        let mut b = h("01 00 00 00 00 00 00 00 10 27 00 00 00 00 00 00
                       E8 03 00 00 00 00 00 00 00 00 00 00 00 00 00 00
                       64 00 00 00 00 00 00 00 64 00 00 00 01 00 00 00");
        b.extend_from_slice(&pk(PK0));
        b.extend_from_slice(&EOA_PROGRAM);
        b
    };
    assert_eq!(minimal.len(), 112);
    let ledger = ThruLedger::new(&dev);
    ledger.sign_txn(&path0(), &minimal).unwrap();

    let mutate = |f: &dyn Fn(&mut Vec<u8>)| {
        let mut b = minimal.clone();
        f(&mut b);
        b
    };
    let cases: Vec<(Vec<u8>, u16)> = vec![
        (mutate(&|b| b[0] = 2), 0x6802),
        (mutate(&|b| b[1] = 4), 0x6803),
        (mutate(&|b| b[44..46].copy_from_slice(&[0, 0])), 0x6804),
        (mutate(&|b| b[46] = 1), 0x6811),
        (mutate(&|b| b[48..80].copy_from_slice(&pk(PK1))), 0x6810),
        (mutate(&|b| b.truncate(111)), 0x6801),
        (mutate(&|b| b.push(0)), 0x6801),
    ];
    for (body, want) in cases {
        let e = ledger.sign_txn(&path0(), &body).unwrap_err();
        assert_eq!(e.status_word(), Some(want), "{e:?}");
    }

    // Message pass mismatch: pass 2 sends "hellp".
    let mut start = path0().to_apdu_bytes();
    start.extend_from_slice(&5u32.to_be_bytes());
    assert_eq!(
        raw(&dev, &Command::thru(ins::SIGN_MESSAGE, 0, 0x80, start)),
        sw::OK
    );
    assert_eq!(
        raw(
            &dev,
            &Command::thru(ins::SIGN_MESSAGE, 1, 0, b"hello".to_vec())
        ),
        sw::OK
    );
    assert_eq!(
        raw(
            &dev,
            &Command::thru(ins::SIGN_MESSAGE, 1, 0, b"hellp".to_vec())
        ),
        sw::MSG_PASS_MISMATCH
    );

    // Message length mismatches.
    let mut start = path0().to_apdu_bytes();
    start.extend_from_slice(&5u32.to_be_bytes());
    let c0 = Command::thru(ins::SIGN_MESSAGE, 0, 0x80, start);
    assert_eq!(raw(&dev, &c0), sw::OK);
    assert_eq!(
        raw(
            &dev,
            &Command::thru(ins::SIGN_MESSAGE, 1, 0, b"hell".to_vec())
        ),
        sw::LENGTH_MISMATCH
    );
    assert_eq!(raw(&dev, &c0), sw::OK);
    assert_eq!(
        raw(
            &dev,
            &Command::thru(ins::SIGN_MESSAGE, 1, 0x80, b"hello".to_vec())
        ),
        sw::LENGTH_MISMATCH
    );
    assert_eq!(raw(&dev, &c0), sw::OK);
    assert_eq!(
        raw(
            &dev,
            &Command::thru(ins::SIGN_MESSAGE, 1, 0, b"hello!".to_vec())
        ),
        sw::LENGTH_MISMATCH
    );

    // EOA: account of another path, bad kind, wrong length.
    let e = ledger
        .sign_eoa_auth(&path0(), EoaAuthKind::Create, 1, &pk(PK0), &pk(PK1))
        .unwrap_err();
    assert!(matches!(e, LedgerError::EoaAccountMismatch));
    let mut cmd = apdu::sign_eoa_auth(&path0(), EoaAuthKind::Create, 1, &pk(PK1), &pk(PK0));
    cmd.data[17] = 2;
    assert_eq!(raw(&dev, &cmd), sw::EOA_INVALID_KIND);
    cmd.data.pop();
    assert_eq!(raw(&dev, &cmd), sw::WRONG_DATA_LENGTH);
}

fn sign_apdu_count(dev: &SoftDevice) -> usize {
    dev.apdu_log()
        .iter()
        .filter(|a| a[1] == ins::SIGN_TXN || a[1] == ins::SIGN_MESSAGE)
        .count()
}

/// Spec §11.3 (audit A-002 / A-003): the preview hook receives the review
/// the device will show, computed from the exact body, before any SIGN_TXN
/// APDU is sent and before the "awaiting user" progress event; its hash is
/// the hash the device displays.  The same holds for hash-mode messages.
#[test]
fn preview_hook_fires_before_streaming() {
    #[derive(Debug)]
    enum Ev {
        Preview(Box<thru_ledger::Preview>, usize),
        AwaitingUser(Operation),
    }
    let dev = Arc::new(SoftDevice::abandon());
    let events: Arc<Mutex<Vec<Ev>>> = Arc::default();
    let (e1, e2, d1) = (events.clone(), events.clone(), dev.clone());
    let s = LedgerSigner::connect(dev.clone(), path0())
        .unwrap()
        .with_progress(Some(Arc::new(move |p: &Progress| {
            if p.awaiting_user {
                e1.lock().unwrap().push(Ev::AwaitingUser(p.operation));
            }
        })))
        .with_preview(Some(Arc::new(move |p: &thru_ledger::Preview| {
            e2.lock()
                .unwrap()
                .push(Ev::Preview(Box::new(p.clone()), sign_apdu_count(&d1)));
        })));

    let body = transfer_body(pk(PK0));
    s.try_sign_transaction_body(&body).unwrap();
    let Some(Review::Transaction { hash_hex, .. }) = dev.reviews().pop() else {
        panic!("no review")
    };
    {
        let ev = events.lock().unwrap();
        match &ev[..] {
            [
                Ev::Preview(p, 0),
                Ev::AwaitingUser(Operation::SignTransaction),
            ] => {
                let thru_ledger::Preview::Transaction(p) = &**p else {
                    panic!("{p:?}")
                };
                assert_eq!(p.transaction_hash, hash_hex);
                assert_eq!(p.fee_payer, s.address());
            }
            other => panic!("{other:?}"),
        }
    }

    // Hash-mode message (non-ASCII): the preview carries the message hash.
    events.lock().unwrap().clear();
    let before = sign_apdu_count(&dev);
    let msg = "caf\u{e9}".as_bytes();
    s.try_sign_message(msg).unwrap();
    let Some(Review::Message { hash_hex, text, .. }) = dev.reviews().pop() else {
        panic!("no review")
    };
    assert!(text.is_none());
    let ev = events.lock().unwrap();
    match &ev[..] {
        [
            Ev::Preview(p, n),
            Ev::AwaitingUser(Operation::SignMessagePass1),
        ] => {
            let thru_ledger::Preview::Message(p) = &**p else {
                panic!("{p:?}")
            };
            assert_eq!(*n, before, "message APDUs were sent before the preview");
            assert!(p.is_hash_mode());
            assert_eq!(p.message_hash, hash_hex);
        }
        other => panic!("{other:?}"),
    }
}

/// A body that fails the host checks produces no preview and no APDU.
#[test]
fn no_preview_for_refused_bodies() {
    let dev = Arc::new(SoftDevice::abandon());
    let seen = Arc::new(Mutex::new(0usize));
    let sink = seen.clone();
    let s = LedgerSigner::connect(dev.clone(), path0())
        .unwrap()
        .with_preview(Some(Arc::new(move |_: &thru_ledger::Preview| {
            *sink.lock().unwrap() += 1;
        })));
    let before = sign_apdu_count(&dev);
    // Wrong fee payer.
    let err = s
        .try_sign_transaction_body(&transfer_body(pk(PK1)))
        .unwrap_err();
    assert!(matches!(err, LedgerError::KeyMismatch { .. }), "{err:?}");
    // Malformed body.
    let mut bad = transfer_body(pk(PK0));
    bad[0] = 2;
    let err = s.try_sign_transaction_body(&bad).unwrap_err();
    assert!(
        matches!(
            err,
            LedgerError::InvalidTransaction(TxnReject::InvalidVersion)
        ),
        "{err:?}"
    );
    assert_eq!(*seen.lock().unwrap(), 0);
    assert_eq!(s.last_preview(), None);
    assert_eq!(sign_apdu_count(&dev), before);
}

/// Critic gap (U3/T8): the APDU protocol version is enforced on connect and
/// on every later GET_APP_CONFIG refresh.
#[test]
fn refresh_app_config_enforces_protocol_version() {
    let dev = Arc::new(SoftDevice::abandon());
    let s = LedgerSigner::connect(dev.clone(), path0()).unwrap();
    assert_eq!(s.refresh_app_config().unwrap().apdu_protocol_version, 1);
    dev.set_settings(SoftDeviceSettings {
        apdu_protocol_version: 2,
        ..Default::default()
    });
    assert!(matches!(
        s.refresh_app_config(),
        Err(LedgerError::UnsupportedAppVersion { device: 2, host: 1 })
    ));
    assert!(matches!(
        LedgerSigner::connect(dev.clone(), path0()),
        Err(LedgerError::UnsupportedAppVersion { device: 2, host: 1 })
    ));
}
