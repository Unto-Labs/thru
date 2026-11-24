//! Tests of the older-protocol backend and of the choice between backends,
//! against a simulated Core device (`Core`) that behaves as the firmware
//! does where it matters here: the session, the unlock step, the passphrase
//! settings and what each of them makes the device ask.

use std::cell::RefCell;
use std::collections::VecDeque;
use std::rc::Rc;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use prost::Message as _;

use crate::client::{ConnectOptions, Trezor, Ui};
use crate::codec_v1::encode;
use crate::credentials::{Credential, CredentialStorage};
use crate::error::{Result, TrezorError, failure_code};
use crate::extapp::AppImage;
use crate::messages::*;
use crate::probe::Protocol;
use crate::transport::{PACKET_LEN, Transport, TransportError};

const HEADER_LEN: usize = 9;

/// What happens when the person is asked for the PIN on the device.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Pin {
    /// The right PIN is entered.
    Enter,
    /// The person cancels.
    Cancel,
    /// The device says "done" but stays locked.
    StayLocked,
}

/// What the device waits for after it asked the person something.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Waiting {
    Nothing,
    /// A `ButtonAck` for the PIN screen.
    PinScreen,
    /// A `PassphraseAck`.
    PassphraseAck,
    /// A `ButtonAck` for the passphrase entry screen.
    PassphraseScreen,
    /// A `ButtonAck` for the screen of an app request that never ends.
    Endless,
}

/// A Core device of the older protocol.
struct Core {
    model: Option<&'static str>,
    initialized: bool,
    bootloader: bool,
    /// The device has a PIN: it starts locked and `pin` says how entering it
    /// goes.
    locked: bool,
    pin: Pin,
    protection: bool,
    always_on_device: bool,
    /// What the person types on the device; `None` cancels the entry.
    typed: Option<&'static str>,
    /// A request for the key never ends: every `ButtonAck` is answered with
    /// another `ButtonRequest`.
    endless: bool,
    /// Every message received, in order.
    log: Vec<(u16, Vec<u8>)>,
    sessions: u32,
    /// The passphrase of the wallet the current session derived, if it has.
    cached: Option<String>,
    waiting: Waiting,
    /// A message of the host being received: type, announced length, bytes.
    partial: Option<(u16, usize, Vec<u8>)>,
    out: VecDeque<Vec<u8>>,
}

impl Core {
    fn new() -> Rc<RefCell<Core>> {
        Rc::new(RefCell::new(Core {
            model: Some("T3T1"),
            initialized: true,
            bootloader: false,
            locked: false,
            pin: Pin::Enter,
            protection: false,
            always_on_device: false,
            typed: Some("TREZOR"),
            endless: false,
            log: Vec::new(),
            sessions: 0,
            cached: None,
            waiting: Waiting::Nothing,
            partial: None,
            out: VecDeque::new(),
        }))
    }

    fn features(&self, with_session: bool) -> Vec<u8> {
        let mut features = Features {
            initialized: Some(self.initialized),
            unlocked: Some(!self.locked),
            bootloader_mode: self.bootloader.then_some(true),
            internal_model: self.model.map(str::to_owned),
            ..Features::default()
        };
        if !self.locked {
            // The passphrase settings are private: a locked device leaves
            // them out.
            features.passphrase_protection = Some(self.protection);
            features.passphrase_always_on_device = Some(self.always_on_device);
        }
        if with_session {
            features.session_id = Some(vec![self.sessions as u8; 32]);
        }
        features.encode_to_vec()
    }

    fn failure(code: i32, message: &str) -> (u16, Vec<u8>) {
        (
            Failure::ID,
            Failure {
                code: Some(code),
                message: Some(message.into()),
            }
            .encode_to_vec(),
        )
    }

    fn button(code: i32) -> (u16, Vec<u8>) {
        (
            ButtonRequest::ID,
            ButtonRequest {
                code: Some(code),
                pages: None,
                name: None,
            }
            .encode_to_vec(),
        )
    }

    /// The app's answer to `GetPublicKey`: the wallet is in the address.
    fn key(wallet: &str) -> (u16, Vec<u8>) {
        let key = PublicKey {
            public_key: vec![wallet.len() as u8; 32],
            address: format!("wallet:{wallet}"),
        };
        (
            ExtAppResponse::ID,
            ExtAppResponse {
                message_id: PublicKey::ID,
                data: key.encode_to_vec(),
            }
            .encode_to_vec(),
        )
    }

    /// The device derives the key of the wallet for `passphrase` and caches
    /// the seed for the rest of the session.
    fn derived(&mut self, passphrase: String) -> (u16, Vec<u8>) {
        let answer = Core::key(&passphrase);
        self.cached = Some(passphrase);
        answer
    }

    /// The reply to one whole message of the host.
    fn respond(&mut self, id: u16, payload: &[u8]) -> Vec<(u16, Vec<u8>)> {
        self.log.push((id, payload.to_vec()));
        let waiting = std::mem::replace(&mut self.waiting, Waiting::Nothing);
        match (id, waiting) {
            (Initialize::ID, _) => {
                self.sessions += 1;
                self.cached = None;
                vec![(Features::ID, self.features(true))]
            }
            (GetFeatures::ID, _) => vec![(Features::ID, self.features(false))],
            (Cancel::ID, _) => vec![Core::failure(failure_code::ACTION_CANCELLED, "")],
            (ApplyFlags::ID, _) => {
                if !self.initialized {
                    return vec![Core::failure(
                        failure_code::NOT_INITIALIZED,
                        "Not initialized",
                    )];
                }
                if self.locked {
                    self.waiting = Waiting::PinScreen;
                    return vec![Core::button(20)];
                }
                vec![(Success::ID, Success { message: None }.encode_to_vec())]
            }
            (ButtonAck::ID, Waiting::PinScreen) => match self.pin {
                Pin::Enter => {
                    self.locked = false;
                    vec![(Success::ID, Success { message: None }.encode_to_vec())]
                }
                Pin::Cancel => vec![Core::failure(failure_code::PIN_CANCELLED, "PIN cancelled")],
                Pin::StayLocked => {
                    vec![(Success::ID, Success { message: None }.encode_to_vec())]
                }
            },
            (ButtonAck::ID, Waiting::PassphraseScreen) => match self.typed {
                Some(text) => vec![self.derived(text.into())],
                // What the Safe 5 does: the app's request for the seed fails,
                // and the app reports Core's generic service error.
                None => vec![Core::failure(failure_code::PROCESS_ERROR, "service error")],
            },
            (ButtonAck::ID, Waiting::Endless) => {
                self.waiting = Waiting::Endless;
                vec![Core::button(1)]
            }
            (PassphraseAck::ID, Waiting::PassphraseAck) => {
                let ack = PassphraseAck::decode(payload).expect("an ack");
                if ack.on_device == Some(true) {
                    self.waiting = Waiting::PassphraseScreen;
                    vec![Core::button(19)]
                } else if let Some(text) = ack.passphrase {
                    vec![self.derived(text)]
                } else {
                    vec![Core::failure(
                        failure_code::DATA_ERROR,
                        "Passphrase not provided and on_device is False.",
                    )]
                }
            }
            (ExtAppLoad::ID, _) => vec![(
                ExtAppLoaded::ID,
                ExtAppLoaded {
                    instance_id: 7,
                    version: Version {
                        major: 0,
                        minor: 1,
                        patch: Some(1),
                        build: Some(0),
                    },
                }
                .encode_to_vec(),
            )],
            (ExtAppMessage::ID, _) => {
                if self.endless {
                    self.waiting = Waiting::Endless;
                    return vec![Core::button(1)];
                }
                if let Some(wallet) = self.cached.clone() {
                    return vec![Core::key(&wallet)];
                }
                if !self.protection {
                    return vec![self.derived(String::new())];
                }
                if self.always_on_device {
                    self.waiting = Waiting::PassphraseScreen;
                    return vec![Core::button(19)];
                }
                self.waiting = Waiting::PassphraseAck;
                vec![(PassphraseRequest::ID, Vec::new())]
            }
            _ => vec![Core::failure(
                failure_code::UNEXPECTED_MESSAGE,
                "Unexpected message",
            )],
        }
    }

    fn write(&mut self, packet: &[u8]) {
        let (id, length, mut bytes, skip) = match self.partial.take() {
            None => {
                assert_eq!(&packet[..3], b"?##", "a host message starts with ?##");
                let id = u16::from_be_bytes([packet[3], packet[4]]);
                let length = u32::from_be_bytes([packet[5], packet[6], packet[7], packet[8]]);
                (id, length as usize, Vec::new(), HEADER_LEN)
            }
            Some((id, length, bytes)) => {
                assert_eq!(packet[0], b'?', "a continuation starts with ?");
                (id, length, bytes, 1)
            }
        };
        let wanted = length - bytes.len();
        bytes.extend_from_slice(&packet[skip..packet.len().min(skip + wanted)]);
        if bytes.len() < length {
            self.partial = Some((id, length, bytes));
            return;
        }
        for (reply_id, reply) in self.respond(id, &bytes) {
            for packet in encode(reply_id, &reply).expect("encodes") {
                self.out.push_back(packet.to_vec());
            }
        }
    }
}

/// The transport a connection gets: a line to a shared [`Core`].
struct Line(Rc<RefCell<Core>>);

impl Transport for Line {
    fn write_packet(&mut self, packet: &[u8]) -> std::result::Result<(), TransportError> {
        assert_eq!(packet.len(), PACKET_LEN);
        self.0.borrow_mut().write(packet);
        Ok(())
    }

    fn read_packet(
        &mut self,
        _timeout: Duration,
    ) -> std::result::Result<Option<Vec<u8>>, TransportError> {
        Ok(self.0.borrow_mut().out.pop_front())
    }

    fn is_emulator(&self) -> bool {
        true
    }
}

/// A credential store that must not be touched.
struct NoStorage;

impl CredentialStorage for NoStorage {
    fn load(&self) -> Result<Vec<Credential>> {
        panic!("the older protocol must not read the credential store");
    }

    fn store(&self, _credential: &Credential) -> Result<()> {
        panic!("the older protocol must not write the credential store");
    }
}

/// What the person at the terminal was asked to do.
#[derive(Clone, Default)]
struct Asked(Arc<Mutex<Vec<&'static str>>>);

impl Asked {
    fn calls(&self) -> Vec<&'static str> {
        self.0.lock().expect("lock").clone()
    }
}

impl Ui for Asked {
    fn confirm_on_device(&mut self) {
        self.0.lock().expect("lock").push("confirm");
    }

    fn enter_passphrase_on_device(&mut self) {
        self.0.lock().expect("lock").push("passphrase");
    }

    fn pairing_code(&mut self) -> Result<String> {
        panic!("there is no pairing on the older protocol");
    }
}

const QUICK: Duration = Duration::from_millis(200);

fn connect(core: &Rc<RefCell<Core>>, on_device: bool) -> (Result<Trezor<Line>>, Asked) {
    let asked = Asked::default();
    let options = ConnectOptions::default().passphrase_on_device(on_device);
    let trezor = Trezor::connect_probing(
        Line(core.clone()),
        &options,
        &NoStorage,
        Box::new(asked.clone()),
        QUICK,
    );
    (trezor, asked)
}

/// The wallet the app's key request reaches.
fn wallet_of(trezor: &mut Trezor<Line>) -> Result<String> {
    let response: ExtAppResponse = trezor.call(&ExtAppMessage {
        instance_id: 7,
        message_id: GetPublicKey::ID,
        data: GetPublicKey {
            address_n: vec![],
            show_display: None,
        }
        .encode_to_vec(),
    })?;
    let key = PublicKey::decode(response.data.as_slice()).expect("a key");
    Ok(key.address.trim_start_matches("wallet:").to_owned())
}

fn ids(core: &Rc<RefCell<Core>>) -> Vec<u16> {
    core.borrow().log.iter().map(|(id, _)| *id).collect()
}

fn sent_a_key_request(core: &Rc<RefCell<Core>>) -> bool {
    ids(core).contains(&ExtAppMessage::ID)
}

/* ---- every connection starts a session of its own ----------------------- */

#[test]
fn every_connection_sends_initialize_without_a_session_id() {
    let core = Core::new();
    for _ in 0..3 {
        let (trezor, _) = connect(&core, false);
        let mut trezor = trezor.expect("connects");
        assert_eq!(trezor.protocol(), Protocol::V1);
        wallet_of(&mut trezor).expect("a key");
    }
    let core = core.borrow();
    let initializes: Vec<&Vec<u8>> = core
        .log
        .iter()
        .filter(|(id, _)| *id == Initialize::ID)
        .map(|(_, payload)| payload)
        .collect();
    assert_eq!(initializes.len(), 3);
    for payload in initializes {
        // Not even an empty session id: the message is empty.
        assert!(payload.is_empty(), "Initialize carried {payload:02x?}");
    }
    // The session ids the device gave were not sent back.
    assert_eq!(core.sessions, 3);
}

#[test]
fn the_steps_of_a_connection_come_in_the_order_of_the_plan() {
    let core = Core::new();
    core.borrow_mut().protection = true;
    let (trezor, _) = connect(&core, false);
    let mut trezor = trezor.expect("connects");
    wallet_of(&mut trezor).expect("a key");
    // The probe's Cancel, a new session, the unlock step, the features again,
    // and only then a request that derives a key (which asks for the
    // passphrase and is answered).
    assert_eq!(
        ids(&core),
        [
            Cancel::ID,
            Initialize::ID,
            ApplyFlags::ID,
            GetFeatures::ID,
            ExtAppMessage::ID,
            PassphraseAck::ID
        ]
    );
    // The unlock step carries no flags.
    assert_eq!(hex::encode(&core.borrow().log[2].1), "0800");
}

/* ---- the wallet a key asks for (S5) ------------------------------------- */

/// How the device is set and what the key asks for, and what must come out.
#[derive(Debug)]
enum Outcome {
    /// The wallet with this passphrase; the person was (or was not) told to
    /// type on the device; the host sent a passphrase ack of this kind.
    Wallet {
        wallet: &'static str,
        ui: &'static [&'static str],
        ack: Option<&'static str>,
    },
    /// Refused before any request that derives a key.
    PassphraseOnDeviceOnly,
    PassphraseProtectionOff,
}

fn run_matrix_row(locked: bool, protection: bool, always: bool, on_device: bool, want: Outcome) {
    let core = Core::new();
    {
        let mut core = core.borrow_mut();
        core.locked = locked;
        core.protection = protection;
        core.always_on_device = always;
    }
    let what = format!(
        "locked={locked} protection={protection} always={always} passphrase_key={on_device}"
    );
    let (trezor, asked) = connect(&core, on_device);
    match want {
        Outcome::Wallet { wallet, ui, ack } => {
            let mut trezor = trezor.unwrap_or_else(|e| panic!("{what}: {e}"));
            assert_eq!(wallet_of(&mut trezor).expect("a key"), wallet, "{what}");
            let mut expected_ui: Vec<&str> = if locked { vec!["confirm"] } else { vec![] };
            expected_ui.extend(ui);
            assert_eq!(asked.calls(), expected_ui, "{what}");
            let ack_sent = core
                .borrow()
                .log
                .iter()
                .find(|(id, _)| *id == PassphraseAck::ID)
                .map(|(_, payload)| hex::encode(payload));
            assert_eq!(ack_sent.as_deref(), ack, "{what}");
        }
        refused => {
            let error = trezor.err().unwrap_or_else(|| panic!("{what}: connected"));
            match (refused, &error) {
                (Outcome::PassphraseOnDeviceOnly, TrezorError::PassphraseOnDeviceOnly) => {}
                (Outcome::PassphraseProtectionOff, TrezorError::PassphraseProtectionOff) => {}
                (want, got) => panic!("{what}: wanted {want:?}, got {got}"),
            }
            assert!(!sent_a_key_request(&core), "{what}: a key was derived");
            // The unlock step ran first: the settings were read when the
            // device was unlocked.
            assert!(ids(&core).contains(&ApplyFlags::ID), "{what}");
        }
    }
}

#[test]
fn the_wallet_table_from_an_unlocked_and_from_a_locked_start() {
    for locked in [false, true] {
        // Protection off: the standard wallet, nobody is asked.
        run_matrix_row(
            locked,
            false,
            false,
            false,
            Outcome::Wallet {
                wallet: "",
                ui: &[],
                ack: None,
            },
        );
        run_matrix_row(locked, false, false, true, Outcome::PassphraseProtectionOff);
        // Protection on, asked by the host: the empty passphrase for a
        // standard key, `on_device` for a passphrase key.
        run_matrix_row(
            locked,
            true,
            false,
            false,
            Outcome::Wallet {
                wallet: "",
                ui: &[],
                ack: Some("0a00"),
            },
        );
        run_matrix_row(
            locked,
            true,
            false,
            true,
            Outcome::Wallet {
                wallet: "TREZOR",
                ui: &["passphrase"],
                ack: Some("1801"),
            },
        );
        // Always on the device: a standard key is refused, a passphrase key
        // is typed on the device without a request to answer.
        run_matrix_row(locked, true, true, false, Outcome::PassphraseOnDeviceOnly);
        run_matrix_row(
            locked,
            true,
            true,
            true,
            Outcome::Wallet {
                wallet: "TREZOR",
                ui: &["passphrase"],
                ack: None,
            },
        );
    }
}

#[test]
fn a_device_that_stays_locked_is_an_error() {
    for on_device in [false, true] {
        let core = Core::new();
        {
            let mut core = core.borrow_mut();
            core.locked = true;
            core.pin = Pin::StayLocked;
            core.protection = true;
        }
        let (trezor, _) = connect(&core, on_device);
        assert!(
            matches!(trezor.err(), Some(TrezorError::DeviceLocked)),
            "passphrase_key={on_device}"
        );
        assert!(!sent_a_key_request(&core));
    }
}

#[test]
fn a_cancelled_pin_entry_is_a_cancellation() {
    let core = Core::new();
    {
        let mut core = core.borrow_mut();
        core.locked = true;
        core.pin = Pin::Cancel;
    }
    let (trezor, _) = connect(&core, false);
    assert!(matches!(trezor.err(), Some(TrezorError::Cancelled)));
    assert!(!sent_a_key_request(&core));
}

#[test]
fn a_cancelled_passphrase_entry_fails_the_request_and_the_connection_survives() {
    let core = Core::new();
    {
        let mut core = core.borrow_mut();
        core.protection = true;
        core.typed = None;
    }
    let (trezor, asked) = connect(&core, true);
    let mut trezor = trezor.expect("connects");
    // The Safe 5 asks for the passphrase inside the app's request for the
    // seed; when the entry is cancelled the app can only report Core's
    // service error, so that is what the host gets (not `Cancelled`).
    let error = wallet_of(&mut trezor).expect_err("cancelled");
    assert!(
        matches!(&error, TrezorError::Failure { code, message }
            if *code == failure_code::PROCESS_ERROR && message == "service error"),
        "{error}"
    );
    assert_eq!(asked.calls(), ["passphrase"]);
    // The person tries again and types the passphrase.
    core.borrow_mut().typed = Some("again");
    assert_eq!(wallet_of(&mut trezor).expect("a key"), "again");
}

#[test]
fn a_standard_key_after_a_passphrase_key_gets_the_standard_wallet() {
    let core = Core::new();
    core.borrow_mut().protection = true;
    let (hidden, _) = connect(&core, true);
    assert_eq!(
        wallet_of(&mut hidden.expect("connects")).expect("a key"),
        "TREZOR"
    );
    // The device still holds the hidden wallet's seed in the session it
    // started, but the next connection starts a session of its own.
    let (standard, asked) = connect(&core, false);
    let mut standard = standard.expect("connects");
    assert_eq!(wallet_of(&mut standard).expect("a key"), "");
    assert!(asked.calls().is_empty());
    // And back again.
    let (hidden, _) = connect(&core, true);
    assert_eq!(
        wallet_of(&mut hidden.expect("connects")).expect("a key"),
        "TREZOR"
    );
}

#[test]
fn an_empty_device_skips_the_unlock_step_and_leaves_the_failure_to_the_device() {
    let core = Core::new();
    core.borrow_mut().initialized = false;
    let (trezor, _) = connect(&core, false);
    let mut trezor = trezor.expect("connects");
    assert!(!ids(&core).contains(&ApplyFlags::ID));
    // Nothing here pretends a wallet exists; the first request that needs a
    // seed gets whatever the device says.
    core.borrow_mut().initialized = true;
    wallet_of(&mut trezor).expect("a key once it has one");
}

#[test]
fn a_device_in_bootloader_mode_is_refused() {
    let core = Core::new();
    core.borrow_mut().bootloader = true;
    let (trezor, _) = connect(&core, false);
    let error = trezor.err().expect("refused");
    assert!(matches!(&error, TrezorError::Unexpected(text) if text.contains("bootloader")));
    assert!(!ids(&core).contains(&ApplyFlags::ID));
}

/* ---- calls on the older protocol --------------------------------------- */

#[test]
fn button_requests_are_answered_through_the_ui_and_bounded() {
    let core = Core::new();
    let (trezor, asked) = connect(&core, false);
    let mut trezor = trezor.expect("connects");
    let before = asked.calls().len();
    core.borrow_mut().endless = true;
    let error = wallet_of(&mut trezor).expect_err("an endless request");
    assert!(
        matches!(&error, TrezorError::Unexpected(text) if text.contains("more than 64 confirmations")),
        "{error}"
    );
    // 64 were answered, the 65th gave up: the bound of the other protocol.
    let acks = ids(&core).iter().filter(|id| **id == ButtonAck::ID).count();
    assert_eq!(acks, 64);
    assert_eq!(asked.calls().len() - before, 64);
}

#[test]
fn failures_map_to_the_errors_of_the_other_protocol() {
    // The same function maps both backends' failures; the older one reaches
    // it through `call`.
    let core = Core::new();
    let (trezor, _) = connect(&core, false);
    let mut trezor = trezor.expect("connects");
    let error = trezor
        .call::<Cancel, Success>(&Cancel {})
        .expect_err("the device answers Cancel with a failure");
    assert!(matches!(error, TrezorError::Cancelled), "{error}");
    let error = trezor
        .call::<ApplyFlags, Features>(&ApplyFlags { flags: 0 })
        .expect_err("a success is not features");
    assert!(
        matches!(&error, TrezorError::Unexpected(text) if text.contains("expected Features")),
        "{error}"
    );
    // A failure the host has no name for keeps its code and text.
    let (id, payload) = (0xffff_u16, Vec::<u8>::new());
    let error = trezor.call_any(id, &payload).expect_err("unknown message");
    assert!(
        matches!(&error, TrezorError::Failure { code, message }
            if *code == failure_code::UNEXPECTED_MESSAGE && message == "Unexpected message"),
        "{error}"
    );
}

#[test]
fn a_message_in_several_packets_reaches_the_device_whole() {
    let core = Core::new();
    let (trezor, _) = connect(&core, false);
    let mut trezor = trezor.expect("connects");
    let image_message = ExtAppMessage {
        instance_id: 7,
        message_id: 99,
        data: vec![0x5a; 400],
    };
    let _ = trezor.call_any(ExtAppMessage::ID, &image_message.encode_to_vec());
    let log = core.borrow();
    let (id, payload) = log.log.last().expect("a message");
    assert_eq!(*id, ExtAppMessage::ID);
    assert_eq!(
        ExtAppMessage::decode(payload.as_slice()).expect("whole"),
        image_message
    );
}

#[test]
fn a_pin_matrix_request_is_cancelled_and_refused() {
    struct Matrix(Rc<RefCell<Core>>);
    impl Transport for Matrix {
        fn write_packet(&mut self, packet: &[u8]) -> std::result::Result<(), TransportError> {
            let mut core = self.0.borrow_mut();
            // ApplyFlags is answered with a PIN matrix request, everything
            // else as the simulated device does.
            if packet[3..5] == ApplyFlags::ID.to_be_bytes() {
                core.log.push((ApplyFlags::ID, Vec::new()));
                for packet in encode(PinMatrixRequest::ID, &[]).expect("encodes") {
                    core.out.push_back(packet.to_vec());
                }
            } else {
                core.write(packet);
            }
            Ok(())
        }

        fn read_packet(
            &mut self,
            _timeout: Duration,
        ) -> std::result::Result<Option<Vec<u8>>, TransportError> {
            Ok(self.0.borrow_mut().out.pop_front())
        }

        fn is_emulator(&self) -> bool {
            true
        }
    }
    let core = Core::new();
    let result = Trezor::connect_probing(
        Matrix(core.clone()),
        &ConnectOptions::default(),
        &NoStorage,
        Box::new(Asked::default()),
        QUICK,
    );
    let error = result.err().expect("refused");
    assert!(matches!(&error, TrezorError::Unexpected(text) if text.contains("PIN matrix")));
    // The device was told to cancel.
    assert_eq!(ids(&core).last(), Some(&Cancel::ID));
}

/* ---- the model check (S7) ----------------------------------------------- */

fn image_for(model: &str) -> AppImage {
    let mut header = vec![0u8; 512];
    header[0..4].copy_from_slice(b"TRZA");
    header[4..8].copy_from_slice(&512u32.to_le_bytes());
    header[104..104 + model.len()].copy_from_slice(model.as_bytes());
    AppImage {
        id: "thru.thru.org".into(),
        version: [0, 1, 1, 0],
        app_ring: 2,
        header,
        proof: Vec::new(),
        root_packet: Vec::new(),
        root_packet_timestamp: 0,
        chunks: Vec::new(),
    }
}

#[test]
fn the_image_model_is_read_from_its_header() {
    assert_eq!(image_for("T3T1").model().expect("model"), "T3T1");
    assert_eq!(image_for("T3W1").model().expect("model"), "T3W1");
    // Four characters fill the field with no terminator; a shorter name is
    // padded with zeros.
    assert_eq!(image_for("T2").model().expect("model"), "T2");
    for bad in [
        &b"\0\0\0\0"[..],
        &[0xff, 0xfe, 0x00, 0x00][..],
        &b"T\xc3\xa9"[..],
    ] {
        let mut image = image_for("T3T1");
        image.header[104..108].fill(0);
        image.header[104..104 + bad.len()].copy_from_slice(bad);
        assert!(
            matches!(image.model(), Err(TrezorError::AppImage(_))),
            "{bad:02x?}"
        );
    }
    let mut short = image_for("T3T1");
    short.header.truncate(100);
    assert!(matches!(short.model(), Err(TrezorError::AppImage(_))));
}

#[test]
fn an_image_for_the_device_loads_and_another_is_refused_naming_both() {
    let core = Core::new();
    let (trezor, _) = connect(&core, false);
    let mut trezor = trezor.expect("connects");
    assert_eq!(trezor.device_model().expect("model"), "T3T1");

    let error = crate::extapp::load(&mut trezor, &image_for("T3W1")).expect_err("wrong model");
    let TrezorError::AppImage(text) = error else {
        panic!("wrong error: {error}");
    };
    assert!(text.contains("T3W1") && text.contains("T3T1"), "{text}");
    // Refused before anything was sent for the load.
    assert!(!ids(&core).contains(&ExtAppLoad::ID));

    let instance = crate::extapp::load(&mut trezor, &image_for("T3T1")).expect("loads");
    assert_eq!(instance, 7);
    assert!(ids(&core).contains(&ExtAppLoad::ID));
}

#[test]
fn a_device_that_reports_no_model_loads_nothing() {
    let core = Core::new();
    core.borrow_mut().model = None;
    let (trezor, _) = connect(&core, false);
    let mut trezor = trezor.expect("connects");
    assert!(trezor.device_model().is_err());
    let error = crate::extapp::load(&mut trezor, &image_for("T3T1")).expect_err("no model");
    assert!(matches!(error, TrezorError::Unexpected(_)), "{error}");
    assert!(!ids(&core).contains(&ExtAppLoad::ID));
}

/* ---- the choice of backend (S6) ----------------------------------------- */

/// A device of the Trezor Host Protocol that answers the probe and then
/// breaks: every later write fails.
struct BrokenThp {
    probed: bool,
    out: VecDeque<Vec<u8>>,
    written: Rc<RefCell<Vec<Vec<u8>>>>,
}

impl Transport for BrokenThp {
    fn write_packet(&mut self, packet: &[u8]) -> std::result::Result<(), TransportError> {
        self.written.borrow_mut().push(packet.to_vec());
        if self.probed {
            return Err(TransportError::Io("the cable was pulled".into()));
        }
        self.probed = true;
        let mut answer = b"?##\x00\x03\x00\x00\x00\x02\x08\x11".to_vec();
        answer.resize(PACKET_LEN, 0);
        self.out.push_back(answer);
        Ok(())
    }

    fn read_packet(
        &mut self,
        _timeout: Duration,
    ) -> std::result::Result<Option<Vec<u8>>, TransportError> {
        Ok(self.out.pop_front())
    }
}

fn starts_a_v1_message(packet: &[u8]) -> bool {
    packet.starts_with(b"?##")
}

#[test]
fn a_thp_failure_is_never_retried_on_the_older_protocol() {
    let written = Rc::new(RefCell::new(Vec::new()));
    let device = BrokenThp {
        probed: false,
        out: VecDeque::new(),
        written: written.clone(),
    };
    let result = Trezor::connect_probing(
        device,
        &ConnectOptions::default(),
        &crate::credentials::MemoryCredentialStorage::new(),
        Box::new(Asked::default()),
        QUICK,
    );
    let error = result.err().expect("the handshake fails");
    assert!(matches!(error, TrezorError::Transport(_)), "{error}");
    let written = written.borrow();
    // The probe's Cancel, then the Trezor Host Protocol's own first packet:
    // no message of the older protocol was ever sent after the probe.
    assert!(starts_a_v1_message(&written[0]));
    assert_eq!(written[0][3..5], Cancel::ID.to_be_bytes());
    assert!(written.len() >= 2);
    assert!(
        written[1..]
            .iter()
            .all(|packet| !starts_a_v1_message(packet)),
        "an older-protocol message followed a Trezor Host Protocol failure"
    );
}

#[test]
fn an_older_protocol_failure_is_never_retried_on_the_trezor_host_protocol() {
    // A device of the older protocol that refuses Initialize.
    struct Refusing {
        out: VecDeque<Vec<u8>>,
        written: Rc<RefCell<Vec<Vec<u8>>>>,
    }
    impl Transport for Refusing {
        fn write_packet(&mut self, packet: &[u8]) -> std::result::Result<(), TransportError> {
            self.written.borrow_mut().push(packet.to_vec());
            let failure = Failure {
                code: Some(failure_code::FIRMWARE_ERROR),
                message: Some("no".into()),
            };
            for packet in encode(Failure::ID, &failure.encode_to_vec()).expect("encodes") {
                self.out.push_back(packet.to_vec());
            }
            Ok(())
        }

        fn read_packet(
            &mut self,
            _timeout: Duration,
        ) -> std::result::Result<Option<Vec<u8>>, TransportError> {
            Ok(self.out.pop_front())
        }

        fn is_emulator(&self) -> bool {
            true
        }
    }
    let written = Rc::new(RefCell::new(Vec::new()));
    let device = Refusing {
        out: VecDeque::new(),
        written: written.clone(),
    };
    let result = Trezor::connect_probing(
        device,
        &ConnectOptions::default(),
        &NoStorage,
        Box::new(Asked::default()),
        QUICK,
    );
    let error = result.err().expect("refused");
    assert!(matches!(error, TrezorError::Failure { .. }), "{error}");
    // Cancel (the probe), then Initialize: two messages, both older-protocol.
    let written = written.borrow();
    assert_eq!(written.len(), 2);
    assert!(written.iter().all(|packet| starts_a_v1_message(packet)));
}

#[test]
fn a_probe_that_gets_no_answer_decides_nothing() {
    struct Silent(Rc<RefCell<Vec<Vec<u8>>>>);
    impl Transport for Silent {
        fn write_packet(&mut self, packet: &[u8]) -> std::result::Result<(), TransportError> {
            self.0.borrow_mut().push(packet.to_vec());
            Ok(())
        }

        fn read_packet(
            &mut self,
            _timeout: Duration,
        ) -> std::result::Result<Option<Vec<u8>>, TransportError> {
            Ok(None)
        }
    }
    let written = Rc::new(RefCell::new(Vec::new()));
    let result = Trezor::connect_probing(
        Silent(written.clone()),
        &ConnectOptions::default(),
        &NoStorage,
        Box::new(Asked::default()),
        QUICK,
    );
    let error = result.err().expect("a timeout is an error");
    assert!(matches!(error, TrezorError::Timeout(_)), "{error}");
    // Only the probe's `Cancel` was sent: neither backend was started.
    assert_eq!(written.borrow().len(), 1);
}

/* ---- the older protocol is accepted from the emulator only -------------- */

/// A device that answers the probe's `Cancel` with `answer` and anything
/// written after that with a failure; it records every packet.
struct Probed {
    emulator: bool,
    answer: Vec<Vec<u8>>,
    out: VecDeque<Vec<u8>>,
    written: Rc<RefCell<Vec<Vec<u8>>>>,
}

impl Probed {
    fn new(emulator: bool, answer: Vec<Vec<u8>>) -> (Self, Rc<RefCell<Vec<Vec<u8>>>>) {
        let written = Rc::new(RefCell::new(Vec::new()));
        let device = Probed {
            emulator,
            answer,
            out: VecDeque::new(),
            written: written.clone(),
        };
        (device, written)
    }
}

impl Transport for Probed {
    fn write_packet(&mut self, packet: &[u8]) -> std::result::Result<(), TransportError> {
        let first = self.written.borrow().is_empty();
        self.written.borrow_mut().push(packet.to_vec());
        if first {
            self.out.extend(std::mem::take(&mut self.answer));
        } else {
            // What the device says to anything after the probe: a failure,
            // which ends the connection.
            let failure = Failure {
                code: Some(failure_code::FIRMWARE_ERROR),
                message: Some("no".into()),
            };
            self.out
                .extend(packets(Failure::ID, &failure.encode_to_vec()));
        }
        Ok(())
    }

    fn read_packet(
        &mut self,
        _timeout: Duration,
    ) -> std::result::Result<Option<Vec<u8>>, TransportError> {
        Ok(self.out.pop_front())
    }

    fn is_emulator(&self) -> bool {
        self.emulator
    }
}

fn packets(id: u16, payload: &[u8]) -> Vec<Vec<u8>> {
    encode(id, payload)
        .expect("encodes")
        .iter()
        .map(|p| p.to_vec())
        .collect()
}

/// The answers of a device of the older protocol to the probe's `Cancel`.
fn older_protocol_answers() -> Vec<(&'static str, Vec<Vec<u8>>)> {
    let failure = |code| {
        Failure {
            code: Some(code),
            message: None,
        }
        .encode_to_vec()
    };
    vec![
        (
            "Features",
            packets(Features::ID, &Features::default().encode_to_vec()),
        ),
        (
            "Failure(ActionCancelled)",
            packets(Failure::ID, &failure(failure_code::ACTION_CANCELLED)),
        ),
        (
            "Failure(UnexpectedMessage)",
            packets(Failure::ID, &failure(failure_code::UNEXPECTED_MESSAGE)),
        ),
    ]
}

fn connect_probed(device: Probed) -> Result<Trezor<Probed>> {
    Trezor::connect_probing(
        device,
        &ConnectOptions::default(),
        &NoStorage,
        Box::new(Asked::default()),
        QUICK,
    )
}

#[test]
fn the_older_protocol_is_refused_on_a_transport_that_is_not_the_emulator() {
    for (name, answer) in older_protocol_answers() {
        let (device, written) = Probed::new(false, answer);
        let error = connect_probed(device).err().expect(name);
        assert!(
            matches!(error, TrezorError::OlderProtocolRefused),
            "{name}: {error}"
        );
        // Only the probe's `Cancel` was sent: no `Initialize`, nothing of
        // either backend.
        let written = written.borrow();
        assert_eq!(written.len(), 1, "{name}");
        assert!(starts_a_v1_message(&written[0]), "{name}");
        assert_eq!(written[0][3..5], Cancel::ID.to_be_bytes(), "{name}");
    }
}

#[test]
fn the_older_protocol_is_taken_on_the_emulator() {
    for (name, answer) in older_protocol_answers() {
        // The device answers `Initialize` with a failure, so the connection
        // ends in an error: what matters is that the older backend sent its
        // `Initialize` after the probe.
        let (device, written) = Probed::new(true, answer);
        let error = connect_probed(device).err().expect(name);
        assert!(
            !matches!(error, TrezorError::OlderProtocolRefused),
            "{name}"
        );
        let written = written.borrow();
        assert_eq!(written.len(), 2, "{name}");
        assert_eq!(written[0][3..5], Cancel::ID.to_be_bytes(), "{name}");
        assert_eq!(written[1][3..5], Initialize::ID.to_be_bytes(), "{name}");
    }
}

#[test]
fn a_simulated_core_device_is_taken_on_the_emulator_and_refused_elsewhere() {
    // The whole simulated device, through the real backend.
    let core = Core::new();
    let (result, _) = connect(&core, false);
    let trezor = result.expect("connected");
    assert_eq!(trezor.protocol(), Protocol::V1);

    // The same device behind a transport that does not say it is the emulator.
    struct Device(Line);
    impl Transport for Device {
        fn write_packet(&mut self, packet: &[u8]) -> std::result::Result<(), TransportError> {
            self.0.write_packet(packet)
        }

        fn read_packet(
            &mut self,
            timeout: Duration,
        ) -> std::result::Result<Option<Vec<u8>>, TransportError> {
            self.0.read_packet(timeout)
        }
    }
    let core = Core::new();
    let result = Trezor::connect_probing(
        Device(Line(core.clone())),
        &ConnectOptions::default(),
        &NoStorage,
        Box::new(Asked::default()),
        QUICK,
    );
    let error = result.err().expect("refused");
    assert!(
        matches!(error, TrezorError::OlderProtocolRefused),
        "{error}"
    );
    assert_eq!(ids(&core), vec![Cancel::ID]);
}

#[test]
fn the_trezor_host_protocol_is_taken_on_a_transport_that_is_not_the_emulator() {
    // `BrokenThp` does not say it is the emulator and answers the probe with
    // `Failure(InvalidProtocol)`: the Trezor Host Protocol starts, and its
    // first packet is not an older-protocol message.
    let written = Rc::new(RefCell::new(Vec::new()));
    let device = BrokenThp {
        probed: false,
        out: VecDeque::new(),
        written: written.clone(),
    };
    assert!(!device.is_emulator());
    let error = Trezor::connect_probing(
        device,
        &ConnectOptions::default(),
        &crate::credentials::MemoryCredentialStorage::new(),
        Box::new(Asked::default()),
        QUICK,
    )
    .err()
    .expect("the handshake fails");
    assert!(
        !matches!(error, TrezorError::OlderProtocolRefused),
        "{error}"
    );
    assert!(matches!(error, TrezorError::Transport(_)), "{error}");
    assert!(written.borrow().len() >= 2);
}

#[test]
fn the_refusal_names_what_it_means() {
    let text = TrezorError::OlderProtocolRefused.to_string();
    assert!(text.contains("emulator only"), "{text}");
    assert!(text.contains("no encryption"), "{text}");
    assert!(text.contains("reconnect"), "{text}");
}
