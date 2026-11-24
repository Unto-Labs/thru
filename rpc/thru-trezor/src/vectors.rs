//! The vector file for a second host implementation
//! (`contrib/test/vectors/trezor/host_vectors.json`, format in the README
//! beside it).
//!
//! Every value in the file is produced by this crate's own code: the
//! message structs, CPace, the credential lookup and the channel
//! (`Link`, `Trezor::connect`, `load`, `ThruApp`) run against a simulated
//! device (`sim.rs`) whose keys, nonces and challenges are scripted. With
//! `THRU_TREZOR_WRITE_VECTORS=1` the test writes the file; without it, it
//! compares what it would write with the file on disk.

mod describe;
mod frames;
mod json;
mod sim;

use std::sync::{Arc, Mutex};

use sha2::{Digest, Sha256};

use crate::app::ThruApp;
use crate::client::{ConnectOptions, Trezor, Ui};
use crate::credentials::{Credential, CredentialStorage, MemoryCredentialStorage};
use crate::error::Result;
use crate::extapp::{AppImage, Chunk, load_unchecked as load};
use crate::messages::*;
use crate::testing::{self, Encryption, Role};

use describe::{ALL_NAMES, Describe, decode_app, decode_wire, sender};
use frames::{Frame, dir_name, frame_json};
use json::{Fields, J, obj};
use sim::{DeviceConfig, Dir, Shared, SharedRef, SimDevice, lock};

const HARDENED: u32 = 0x8000_0000;
const PATH: [u32; 4] = [44 | HARDENED, 8478 | HARDENED, HARDENED, HARDENED];

/// A fixed 32-byte value that is obviously not a secret: SHA-256 of a label.
fn seed(label: &str) -> [u8; 32] {
    Sha256::digest(format!("thru-trezor host vectors v1/{label}")).into()
}

fn public_of(private: &[u8; 32]) -> [u8; 32] {
    x25519_dalek::x25519(*private, x25519_dalek::X25519_BASEPOINT_BYTES)
}

/// The device's `ThpDeviceProperties`, as the firmware sends them.
fn device_properties() -> Vec<u8> {
    use prost::Message as _;
    ThpDeviceProperties {
        internal_model: "T3W1".into(),
        model_variant: Some(0),
        protocol_version_major: 2,
        protocol_version_minor: 1,
        pairing_methods: vec![pairing_method::CODE_ENTRY],
    }
    .encode_to_vec()
}

fn device_config(tag: &str) -> DeviceConfig {
    DeviceConfig {
        channel_id: 0x1234,
        static_privkey: seed("device static private key"),
        properties: device_properties(),
        code_secret: seed("code entry secret")[..16]
            .try_into()
            .expect("16 bytes"),
        cpace_private_key: seed("device cpace private key"),
        issue_blob: seed("credential blob")
            .iter()
            .chain(seed("credential blob 2").iter().take(8))
            .copied()
            .collect(),
        known: None,
        app_held: false,
        app_instance_id: 3,
        app_public_key: seed(&format!("{tag}/app public key")),
        app_signature: {
            let mut signature = [0u8; 64];
            signature[..32].copy_from_slice(&seed(&format!("{tag}/signature r")));
            signature[32..].copy_from_slice(&seed(&format!("{tag}/signature s")));
            signature
        },
        chunks: 2,
    }
}

/// The app image the simulated device is offered: a made-up one with the
/// shape of a real image (a header, a proof, a root packet, chunks).
fn test_image() -> AppImage {
    let mut header: Vec<u8> = (0..512usize).map(|i| ((i * 7 + 3) % 256) as u8).collect();
    header[0..4].copy_from_slice(b"TRZA");
    header[4..8].copy_from_slice(&400u32.to_le_bytes());
    AppImage {
        id: "thru.thru.org".into(),
        version: [0, 1, 1, 0],
        app_ring: 2,
        header,
        proof: vec![0x11; 32],
        root_packet: vec![0x22; 16],
        root_packet_timestamp: -5,
        chunks: vec![
            Chunk {
                hash: vec![0x33; 32],
                data: vec![1, 2, 3],
            },
            Chunk {
                hash: vec![0x44; 32],
                data: vec![4; 100],
            },
        ],
    }
}

/// Types the code the simulated device showed.
struct CodeUi(SharedRef);

impl Ui for CodeUi {
    fn pairing_code(&mut self) -> Result<String> {
        Ok(lock(&self.0)
            .code
            .clone()
            .expect("the device showed a code"))
    }
}

/// One conversation of the host with the simulated device.
struct Run {
    shared: SharedRef,
    /// The scripted random inputs, in the order the code asked for them.
    random: Vec<(&'static str, Vec<u8>)>,
    encryptions: Vec<Encryption>,
    host_handshake_hash: [u8; 32],
    host_static_privkey: [u8; 32],
    config: DeviceConfig,
    /// What the device presented to the host's credential lookup:
    /// (ephemeral key, masked static key).
    lookups: Vec<(Vec<u8>, Vec<u8>)>,
}

fn random_script(tag: &str) -> Vec<(&'static str, Vec<u8>)> {
    // On a reconnect the stored credential's key is used and this one is not.
    let host_static_label = if tag == "pair" {
        "host_static_privkey"
    } else {
        "fresh_host_static_privkey_unused"
    };
    let mut items = vec![
        (
            host_static_label,
            seed(&format!("{tag}/host static")).to_vec(),
        ),
        (
            "channel_allocation_nonce",
            seed(&format!("{tag}/nonce"))[..8].to_vec(),
        ),
        (
            "host_ephemeral_privkey",
            seed(&format!("{tag}/host ephemeral")).to_vec(),
        ),
        (
            "device_ephemeral_privkey",
            seed(&format!("{tag}/device ephemeral")).to_vec(),
        ),
    ];
    if tag == "pair" {
        items.push(("pairing_challenge", seed("pair/challenge").to_vec()));
        items.push(("cpace_host_private_key", seed("pair/cpace host").to_vec()));
    }
    items
}

fn run_pairing(storage: &MemoryCredentialStorage) -> Run {
    testing::clear_encryptions();
    testing::clear_lookups();
    testing::script_random(random_script("pair"));
    let shared: SharedRef = Arc::new(Mutex::new(Shared::default()));
    let config = device_config("pair");
    let sim = SimDevice::new(config.clone(), shared.clone());
    let options = ConnectOptions::new("vector-host", "thru");
    let mut trezor = Trezor::connect_thp(sim, &options, storage, Box::new(CodeUi(shared.clone())))
        .expect("pairs");
    let host_handshake_hash = trezor.handshake_hash();
    let instance = load(&mut trezor, &test_image()).expect("loads the app");
    let mut app = ThruApp::new(trezor, instance);
    app.public_key(&PATH, true).expect("public key");
    app.sign_message(&PATH, b"hello from the vectors")
        .expect("message");
    app.sign_eoa_auth(
        &PATH,
        thru_base::signer::EoaAuthKind::Create,
        0xffff,
        &[0x11; 32],
        &[0x22; 32],
    )
    .expect("eoa");
    app.sign_transaction(&PATH, &vec![0x5a; 3000], Some(&[0xab; 129]))
        .expect("signs with a hint");
    app.sign_transaction(&PATH, &[0x77; 100], None)
        .expect("signs without a hint");
    drop(app);
    let random = testing::finish_random_script();
    let stored = storage.load().expect("stored");
    assert_eq!(stored.len(), 1, "pairing stored one credential");
    Run {
        shared,
        random,
        encryptions: testing::encryptions(),
        host_handshake_hash,
        host_static_privkey: stored[0].host_static_privkey,
        config,
        lookups: testing::lookups(),
    }
}

fn run_reconnect(storage: &MemoryCredentialStorage, first: &Run) -> Run {
    testing::clear_encryptions();
    testing::clear_lookups();
    testing::script_random(random_script("reconnect"));
    let shared: SharedRef = Arc::new(Mutex::new(Shared::default()));
    let issued = lock(&first.shared).issued.clone().expect("issued");
    let mut config = device_config("reconnect");
    config.known = Some(issued);
    config.app_held = true;
    let sim = SimDevice::new(config.clone(), shared.clone());
    let options = ConnectOptions::new("vector-host", "thru").passphrase_on_device(true);
    let mut trezor = Trezor::connect_thp(sim, &options, storage, Box::new(CodeUi(shared.clone())))
        .expect("reconnects");
    let host_handshake_hash = trezor.handshake_hash();
    let instance = load(&mut trezor, &test_image()).expect("the app is held");
    let mut app = ThruApp::new(trezor, instance);
    app.public_key(&PATH, false).expect("public key");
    drop(app);
    let random = testing::finish_random_script();
    let stored = storage.load().expect("stored");
    Run {
        shared,
        random,
        encryptions: testing::encryptions(),
        host_handshake_hash,
        host_static_privkey: stored[0].host_static_privkey,
        config,
        lookups: testing::lookups(),
    }
}

/* ---- group: messages --------------------------------------------------- */

/// One message: where it travels, its fields, its encoding.
struct Case {
    layer: &'static str,
    id: u32,
    name: &'static str,
    bytes: Vec<u8>,
    note: String,
}

fn decode_case(layer: &str, id: u32, bytes: &[u8]) -> describe::Decoded {
    let decoded = match layer {
        "wire" => decode_wire(u16::try_from(id).expect("wire id"), bytes),
        "app" => decode_app(id, bytes),
        other => panic!("layer {other}"),
    };
    let decoded = decoded.unwrap_or_else(|| panic!("no {layer} message {id} decodes {bytes:02x?}"));
    assert_eq!(
        decoded.reencoded, bytes,
        "{} does not encode back to itself",
        decoded.name
    );
    decoded
}

fn case_json(case: &Case) -> J {
    let decoded = decode_case(case.layer, case.id, &case.bytes);
    assert_eq!(decoded.name, case.name);
    let mut fields = Fields::new()
        .put("name", J::str(case.name))
        .put("layer", J::str(case.layer))
        .put(
            if case.layer == "wire" {
                "wire_id"
            } else {
                "app_message_id"
            },
            J::num(case.id),
        )
        .put("sender", J::str(sender(case.name)));
    if case.layer == "app" {
        fields = fields.put(
            "carried_in",
            J::str(if sender(case.name) == "host" {
                "ExtAppMessage.data"
            } else {
                "ExtAppResponse.data"
            }),
        );
    }
    fields
        .put("note", J::str(case.note.clone()))
        .put("fields", decoded.fields)
        .put("hex", J::hex(&case.bytes))
        .done()
}

fn wire<T: Wire + Describe>(out: &mut Vec<Case>, message: &T, note: &str) {
    out.push(Case {
        layer: "wire",
        id: u32::from(T::ID),
        name: T::NAME,
        bytes: message.encode_to_vec(),
        note: note.to_owned(),
    });
}

fn app<T: AppWire + Describe>(out: &mut Vec<Case>, message: &T, note: &str) {
    out.push(Case {
        layer: "app",
        id: T::ID,
        name: T::NAME,
        bytes: message.encode_to_vec(),
        note: note.to_owned(),
    });
}

/// A message that is not a wire message (it travels inside another
/// message or in clear): its id is 0 and the layer says which.
fn embedded<T: prost::Message + Describe + Default>(
    out: &mut Vec<J>,
    name: &str,
    message: &T,
    note: &str,
) {
    let bytes = message.encode_to_vec();
    assert_eq!(
        T::decode(bytes.as_slice())
            .expect("decodes")
            .encode_to_vec(),
        bytes
    );
    out.push(
        Fields::new()
            .put("name", J::str(name))
            .put("layer", J::str("embedded"))
            .put("sender", J::str(sender(name)))
            .put("note", J::str(note))
            .put("fields", message.fields())
            .put("hex", J::hex(&bytes))
            .done(),
    );
}

fn pattern_path() -> Vec<u32> {
    PATH.to_vec()
}

/// Every case of the `messages.cases` list, in the order of the file.
fn message_cases() -> Vec<J> {
    let mut c: Vec<Case> = Vec::new();
    let key32 = |label: &str| seed(label).to_vec();

    wire(&mut c, &Success { message: None }, "no text");
    wire(
        &mut c,
        &Success {
            message: Some(String::new()),
        },
        "present but empty",
    );
    wire(
        &mut c,
        &Success {
            message: Some("Session created".into()),
        },
        "with text",
    );
    wire(
        &mut c,
        &Failure {
            code: Some(3),
            message: Some("Unexpected Code Entry Tag".into()),
        },
        "the answer to a wrong pairing code",
    );
    wire(
        &mut c,
        &Failure {
            code: None,
            message: None,
        },
        "neither field",
    );
    wire(
        &mut c,
        &ButtonRequest {
            code: Some(19),
            pages: None,
            name: None,
        },
        "passphrase entry on the device",
    );
    wire(
        &mut c,
        &ButtonRequest {
            code: Some(8),
            pages: Some(3),
            name: Some("sign_tx".into()),
        },
        "every field",
    );
    wire(
        &mut c,
        &ButtonRequest {
            code: None,
            pages: None,
            name: None,
        },
        "no field",
    );
    wire(&mut c, &ButtonAck {}, "empty message: zero bytes");

    wire(
        &mut c,
        &ThpCreateNewSession {
            passphrase: Some(String::new()),
            on_device: None,
            derive_cardano: None,
        },
        "the standard wallet: the empty passphrase",
    );
    wire(
        &mut c,
        &ThpCreateNewSession {
            passphrase: None,
            on_device: Some(true),
            derive_cardano: None,
        },
        "passphrase typed on the device: on_device and no passphrase",
    );
    wire(
        &mut c,
        &ThpCreateNewSession {
            passphrase: Some("secret".into()),
            on_device: Some(false),
            derive_cardano: Some(false),
        },
        "every field (the host never sends this)",
    );
    wire(
        &mut c,
        &ThpPairingRequest {
            host_name: "localhost".into(),
            app_name: "trezor_check".into(),
        },
        "what the device shows when it asks to allow the connection",
    );
    wire(&mut c, &ThpPairingRequestApproved {}, "empty message");
    wire(
        &mut c,
        &ThpSelectMethod {
            selected_pairing_method: pairing_method::CODE_ENTRY,
        },
        "code entry",
    );
    wire(
        &mut c,
        &ThpSelectMethod {
            selected_pairing_method: pairing_method::SKIP_PAIRING,
        },
        "skip pairing (emulator only)",
    );
    wire(
        &mut c,
        &ThpCredentialRequest {
            host_static_public_key: key32("cred/host key"),
            autoconnect: Some(false),
            credential: None,
        },
        "what the host sends: autoconnect false, no earlier credential",
    );
    wire(
        &mut c,
        &ThpCredentialRequest {
            host_static_public_key: key32("cred/host key"),
            autoconnect: Some(true),
            credential: Some(vec![1, 2, 3]),
        },
        "every field (the host never sends this)",
    );
    wire(
        &mut c,
        &ThpCredentialRequest {
            host_static_public_key: vec![1, 2],
            autoconnect: None,
            credential: None,
        },
        "required field only",
    );
    wire(
        &mut c,
        &ThpCredentialResponse {
            trezor_static_public_key: key32("cred/device key"),
            credential: seed("credential blob").to_vec(),
        },
        "the device's static key and the credential it issued",
    );
    wire(&mut c, &ThpEndRequest {}, "empty message");
    wire(&mut c, &ThpEndResponse {}, "empty message");
    wire(
        &mut c,
        &ThpCodeEntryCommitment {
            commitment: key32("cm"),
        },
        "SHA-256 of the device's secret",
    );
    wire(
        &mut c,
        &ThpCodeEntryChallenge {
            challenge: key32("ch"),
        },
        "32 random bytes from the host",
    );
    wire(
        &mut c,
        &ThpCodeEntryCpaceTrezor {
            cpace_trezor_public_key: key32("cpace trezor"),
        },
        "device's CPace public key",
    );
    wire(
        &mut c,
        &ThpCodeEntryCpaceHostTag {
            cpace_host_public_key: key32("cpace host"),
            tag: key32("tag"),
        },
        "host's CPace public key and tag",
    );
    wire(
        &mut c,
        &ThpCodeEntrySecret {
            secret: seed("code entry secret")[..16].to_vec(),
        },
        "device's 16-byte secret",
    );
    // The short values the unit tests of `messages.rs` pin.
    let pinned = "same value as the pinned unit test of messages.rs";
    wire(
        &mut c,
        &ThpCodeEntryCommitment {
            commitment: vec![0x11; 4],
        },
        pinned,
    );
    wire(
        &mut c,
        &ThpCodeEntryChallenge {
            challenge: vec![0x22; 3],
        },
        pinned,
    );
    wire(
        &mut c,
        &ThpCodeEntryCpaceTrezor {
            cpace_trezor_public_key: vec![1, 2],
        },
        pinned,
    );
    wire(
        &mut c,
        &ThpCodeEntryCpaceHostTag {
            cpace_host_public_key: vec![1, 2],
            tag: vec![3],
        },
        pinned,
    );
    wire(&mut c, &ThpCodeEntrySecret { secret: vec![9] }, pinned);
    wire(
        &mut c,
        &ThpCredentialRequest {
            host_static_public_key: vec![1, 2],
            autoconnect: Some(false),
            credential: None,
        },
        pinned,
    );
    wire(
        &mut c,
        &ThpCredentialResponse {
            trezor_static_public_key: vec![1],
            credential: vec![2, 3],
        },
        pinned,
    );

    wire(
        &mut c,
        &ExtAppLoad {
            id: "thru.thru.org".into(),
            version: Version {
                major: 0,
                minor: 1,
                patch: Some(0),
                build: Some(0),
            },
            fingerprint: None,
        },
        pinned,
    );
    wire(
        &mut c,
        &ExtAppLoad {
            id: "thru.thru.org".into(),
            version: Version {
                major: 0,
                minor: 1,
                patch: Some(1),
                build: Some(0),
            },
            fingerprint: None,
        },
        "without a fingerprint",
    );
    wire(
        &mut c,
        &ExtAppLoad {
            id: "thru.thru.org".into(),
            version: Version {
                major: 0,
                minor: 1,
                patch: Some(1),
                build: Some(0),
            },
            fingerprint: Some(key32("fingerprint")),
        },
        "with the SHA-256 of the image header",
    );
    wire(
        &mut c,
        &ExtAppLoad {
            id: "thru.thru.org".into(),
            version: Version {
                major: 0,
                minor: 1,
                patch: None,
                build: None,
            },
            fingerprint: None,
        },
        "version without patch and build",
    );
    wire(
        &mut c,
        &ExtAppLoaded {
            instance_id: 3,
            version: Version {
                major: 0,
                minor: 1,
                patch: Some(1),
                build: Some(0),
            },
        },
        "the app that runs",
    );
    wire(&mut c, &ExtAppHeaderRequest {}, "empty message");
    wire(
        &mut c,
        &ExtAppHeaderAck {
            header: vec![1, 2, 3],
            proof: vec![0xAA; 4],
            root_packet_timestamp: -5,
        },
        "sint64 -5 is zigzag 9",
    );
    wire(
        &mut c,
        &ExtAppHeaderAck {
            header: vec![],
            proof: vec![],
            root_packet_timestamp: 1_700_000_000_123,
        },
        "empty byte strings are present; a large timestamp",
    );
    wire(
        &mut c,
        &ExtAppHeaderAck {
            header: vec![9],
            proof: vec![8],
            root_packet_timestamp: i64::MIN,
        },
        "the smallest sint64",
    );
    wire(
        &mut c,
        &ExtAppRootPacketRequest { app_ring: 2 },
        "app ring 2",
    );
    wire(
        &mut c,
        &ExtAppRootPacketAck {
            root_packet: vec![0x22; 16],
        },
        "root packet",
    );
    wire(&mut c, &ExtAppDataChunkRequest { index: 1 }, "chunk 1");
    wire(
        &mut c,
        &ExtAppDataChunkAck {
            data: b"abc".to_vec(),
            hash: vec![0; 32],
        },
        "a chunk and its hash",
    );
    wire(
        &mut c,
        &ExtAppMessage {
            instance_id: 3,
            message_id: 2,
            data: vec![8, 1],
        },
        "an app message in an envelope",
    );
    wire(
        &mut c,
        &ExtAppResponse {
            message_id: 5,
            data: vec![0x0a, 0x01, 0x55],
        },
        "an app answer in an envelope",
    );

    app(
        &mut c,
        &GetPublicKey {
            address_n: pattern_path(),
            show_display: Some(true),
        },
        "show on the device",
    );
    app(
        &mut c,
        &GetPublicKey {
            address_n: pattern_path(),
            show_display: Some(false),
        },
        "do not show",
    );
    app(
        &mut c,
        &GetPublicKey {
            address_n: pattern_path(),
            show_display: None,
        },
        "show_display absent",
    );
    app(
        &mut c,
        &PublicKey {
            public_key: seed("app public key").to_vec(),
            address: "ta-example".into(),
        },
        "public key and address",
    );
    app(
        &mut c,
        &SignTx {
            address_n: pattern_path(),
            body_size: 300,
            token_hint: None,
        },
        "no token hint: the field is absent",
    );
    app(
        &mut c,
        &SignTx {
            address_n: pattern_path(),
            body_size: 300,
            token_hint: Some(vec![0xAB; 129]),
        },
        "a 129-byte token hint: field 3, length 0x81 0x01",
    );
    app(
        &mut c,
        &SignTx {
            address_n: pattern_path(),
            body_size: 300,
            token_hint: Some(Vec::new()),
        },
        "a present but empty hint is on the wire",
    );
    app(
        &mut c,
        &SignTx {
            address_n: pattern_path(),
            body_size: 0,
            token_hint: None,
        },
        "body_size 0 is still present",
    );
    app(
        &mut c,
        &TxDataRequest {
            offset: 2048,
            length: 952,
        },
        "the device asks for a piece of the body",
    );
    app(
        &mut c,
        &TxDataAck {
            data: b"xyz".to_vec(),
        },
        "a piece of the body",
    );
    app(
        &mut c,
        &TxSignature {
            signature: vec![0x5A; 64],
        },
        "the signature",
    );
    app(
        &mut c,
        &SignMessage {
            address_n: pattern_path(),
            message: b"hello".to_vec(),
        },
        "text to sign",
    );
    app(
        &mut c,
        &MessageSignature {
            signature: vec![0x5A; 64],
        },
        "the signature",
    );
    app(
        &mut c,
        &SignEoaAuth {
            address_n: pattern_path(),
            kind: 1,
            chain_id: 0xffff,
            fee_payer: vec![0x11; 32],
            account: vec![0x22; 32],
        },
        "delete authorization, chain id 65535",
    );
    app(
        &mut c,
        &SignEoaAuth {
            address_n: pattern_path(),
            kind: 0,
            chain_id: 1,
            fee_payer: vec![0x33; 32],
            account: vec![0x44; 32],
        },
        "create authorization, chain id 1",
    );
    app(
        &mut c,
        &EoaAuthSignature {
            signature: vec![0x5A; 64],
        },
        "the signature",
    );

    let mut out: Vec<J> = c.iter().map(case_json).collect();
    embedded(
        &mut out,
        "ThpDeviceProperties",
        &ThpDeviceProperties {
            internal_model: "T3W1".into(),
            model_variant: Some(0),
            protocol_version_major: 2,
            protocol_version_minor: 1,
            pairing_methods: vec![pairing_method::CODE_ENTRY],
        },
        "sent by the device in clear inside the channel allocation response; also the Noise prologue",
    );
    embedded(
        &mut out,
        "ThpDeviceProperties",
        &ThpDeviceProperties {
            internal_model: "T3W1".into(),
            model_variant: None,
            protocol_version_major: 2,
            protocol_version_minor: 0,
            pairing_methods: vec![pairing_method::SKIP_PAIRING, pairing_method::CODE_ENTRY],
        },
        "no model variant; two pairing methods (repeated field, not packed)",
    );
    embedded(
        &mut out,
        "ThpHandshakeCompletionReqNoisePayload",
        &ThpHandshakeCompletionReqNoisePayload {
            host_pairing_credential: Some(vec![1, 2, 3]),
        },
        "the Noise payload of the host's completion message, with a stored credential",
    );
    embedded(
        &mut out,
        "ThpHandshakeCompletionReqNoisePayload",
        &ThpHandshakeCompletionReqNoisePayload {
            host_pairing_credential: None,
        },
        "no credential: the payload is empty (zero bytes)",
    );
    out
}

/// Messages of one conversation, each decrypted, with the app messages
/// inside the envelopes shown too.
fn captured_messages(name: &str, run: &Run) -> Vec<J> {
    let shared = lock(&run.shared);
    let mut out = Vec::new();
    for (index, (dir, session, id, payload)) in shared.messages.iter().enumerate() {
        let wire_decoded = decode_case("wire", u32::from(*id), payload);
        out.push(
            Fields::new()
                .put("scenario", J::str(name))
                .put("index", J::num(index))
                .put("direction", J::str(dir_name(*dir)))
                .put("session", J::num(*session))
                .put("name", J::str(wire_decoded.name))
                .put("wire_id", J::num(*id))
                .put("fields", wire_decoded.fields)
                .put("hex", J::hex(payload))
                .done(),
        );
        if let Some((app_id, data)) = envelope(*id, payload) {
            let inner = decode_case("app", app_id, &data);
            out.push(
                Fields::new()
                    .put("scenario", J::str(name))
                    .put("index", J::num(index))
                    .put("direction", J::str(dir_name(*dir)))
                    .put("session", J::num(*session))
                    .put("name", J::str(inner.name))
                    .put("app_message_id", J::num(app_id))
                    .put(
                        "carried_in",
                        J::str(if *id == ExtAppMessage::ID {
                            "ExtAppMessage.data"
                        } else {
                            "ExtAppResponse.data"
                        }),
                    )
                    .put("fields", inner.fields)
                    .put("hex", J::hex(&data))
                    .done(),
            );
        }
    }
    out
}

/// The app message inside an `ExtAppMessage` or `ExtAppResponse`.
fn envelope(id: u16, payload: &[u8]) -> Option<(u32, Vec<u8>)> {
    use prost::Message as _;
    if id == ExtAppMessage::ID {
        let m = ExtAppMessage::decode(payload).ok()?;
        Some((m.message_id, m.data))
    } else if id == ExtAppResponse::ID {
        let m = ExtAppResponse::decode(payload).ok()?;
        Some((m.message_id, m.data))
    } else {
        None
    }
}

/* ---- group: cpace ------------------------------------------------------- */

fn h32(text: &str) -> [u8; 32] {
    hex::decode(text)
        .expect("hex")
        .try_into()
        .expect("32 bytes")
}

fn cpace_json() -> J {
    use crate::cpace::tests::{ELLIGATOR_VECTORS, EXCHANGE_VECTORS, GENERATOR_STRING_HEX};
    use crate::cpace::{CpaceError, cpace_with_key, elligator2, generator_steps, generator_string};

    let elligator: Vec<J> = ELLIGATOR_VECTORS
        .iter()
        .map(|(input, reduced, expected)| {
            let out = elligator2(&h32(input));
            assert_eq!(hex::encode(out), *expected, "elligator2 of {input}");
            obj([
                ("input", J::str(*input)),
                ("reduced_input", J::str(*reduced)),
                ("output", J::hex(out)),
            ])
        })
        .collect();

    let exchange_json = |code: &str, hh: &[u8], device_public: &[u8; 32], scalar: [u8; 32]| {
        let string = generator_string(code.as_bytes(), hh).expect("generator string");
        let (hashed, generator) = generator_steps(code.as_bytes(), hh).expect("generator");
        let result = cpace_with_key(code.as_bytes(), hh, device_public, scalar).expect("exchange");
        let tag = crate::client::code_entry_tag(&result.shared_secret);
        Fields::new()
            .put("code", J::str(code))
            .put("handshake_hash", J::hex(hh))
            .put("host_private_key", J::hex(scalar))
            .put("device_public_key", J::hex(device_public))
            .put("generator_string", J::hex(&string))
            .put("generator_hash", J::hex(hashed))
            .put("generator", J::hex(generator))
            .put("host_public_key", J::hex(result.host_public_key))
            .put("shared_secret", J::hex(result.shared_secret))
            .put("tag", J::hex(&tag))
            .done()
    };

    let mut exchanges = Vec::new();
    for v in EXCHANGE_VECTORS {
        let hh = hex::decode(v.handshake_hash).expect("hex");
        let json = exchange_json(
            v.code,
            &hh,
            &h32(v.trezor_public_key),
            h32(v.host_private_key),
        );
        // The reference values (from trezorlib) must be what this code gives.
        let J::Obj(entries) = &json else {
            unreachable!()
        };
        let get = |key: &str| match &entries.iter().find(|(k, _)| k == key).expect("key").1 {
            J::Str(s) => s.clone(),
            _ => unreachable!(),
        };
        assert_eq!(get("host_public_key"), v.host_public_key);
        assert_eq!(get("shared_secret"), v.shared_secret);
        exchanges.push(
            Fields::new()
                .put(
                    "source",
                    J::str("reference values from trezorlib, reproduced by the Rust host"),
                )
                .put("exchange", json)
                .done(),
        );
    }

    // The generator string of the reference, byte for byte.
    let ci: Vec<u8> = (0..32).collect();
    let string = generator_string(b"000042", &ci).expect("string");
    assert_eq!(hex::encode(&string), GENERATOR_STRING_HEX);

    // The exchange of the pairing conversation, with the values the host
    // really sent: checked against the captured messages by the caller.
    let errors = {
        let mut one = [0u8; 32];
        one[0] = 1;
        let low_order: Vec<J> = [[0u8; 32], one]
            .iter()
            .map(|point| {
                let err = cpace_with_key(b"123456", &[7u8; 32], point, [9u8; 32])
                    .expect_err("low-order point");
                assert_eq!(err, CpaceError::LowOrderPoint);
                obj([
                    ("code", J::str("123456")),
                    ("handshake_hash", J::hex([7u8; 32])),
                    ("host_private_key", J::hex([9u8; 32])),
                    ("device_public_key", J::hex(point)),
                    ("error", J::str("low_order_point")),
                ])
            })
            .collect();
        let long_code = generator_string(&[b'1'; 128], &[0; 32]).expect_err("too long");
        let long_hash = generator_string(b"000042", &[0; 128]).expect_err("too long");
        assert_eq!(
            (long_code, long_hash),
            (CpaceError::InputTooLong, CpaceError::InputTooLong)
        );
        (
            low_order,
            vec![
                obj([
                    ("code_length", J::num(128)),
                    ("handshake_hash_length", J::num(32)),
                    ("error", J::str("input_too_long")),
                ]),
                obj([
                    ("code_length", J::num(6)),
                    ("handshake_hash_length", J::num(128)),
                    ("error", J::str("input_too_long")),
                ]),
            ],
        )
    };

    Fields::new()
        .put("elligator2", J::arr(elligator))
        .put("exchanges", J::arr(exchanges))
        .put("low_order_device_keys", J::arr(errors.0))
        .put("generator_string_too_long", J::arr(errors.1))
        .done()
}

/// The code the device shows and the commitment it sends before.
fn code_entry_json() -> J {
    use crate::client::{code_entry_code, code_entry_commitment};
    let cases: Vec<J> = [
        (
            "reference values computed with Python's hashlib",
            (0..32).collect::<Vec<u8>>(),
            (100..116).collect::<Vec<u8>>(),
            vec![0xA5; 32],
        ),
        (
            "the code is 742: the digits need zero padding",
            (0..32).collect(),
            (100..116).collect(),
            [0x04, 0x36].repeat(16),
        ),
        (
            "seeded values of these vectors",
            seed("code entry/handshake hash").to_vec(),
            seed("code entry secret")[..16].to_vec(),
            seed("code entry/challenge").to_vec(),
        ),
    ]
    .into_iter()
    .map(|(note, hh, secret, challenge)| {
        obj([
            ("note", J::str(note)),
            ("handshake_hash", J::hex(&hh)),
            ("secret", J::hex(&secret)),
            ("challenge", J::hex(&challenge)),
            ("commitment", J::hex(code_entry_commitment(&secret))),
            ("code", J::str(code_entry_code(&hh, &secret, &challenge))),
        ])
    })
    .collect();
    J::arr(cases)
}

/* ---- group: credentials ------------------------------------------------- */

/// What a device sends for its static key and ephemeral key (the rule of
/// `trezorlib/thp/credentials.py`); used to make inputs.
fn masked_static(static_pubkey: [u8; 32], ephemeral: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(static_pubkey);
    hasher.update(ephemeral);
    let key: [u8; 32] = hasher.finalize().into();
    x25519_dalek::x25519(key, static_pubkey)
}

fn credential_of(device: &str, blob: Vec<u8>) -> Credential {
    Credential {
        trezor_static_pubkey: public_of(&seed(&format!("credentials/{device} static"))),
        host_static_privkey: seed(&format!("credentials/{device} host key")),
        credential: blob,
    }
}

fn credential_json(c: &Credential) -> J {
    obj([
        ("trezor_static_pubkey", J::hex(c.trezor_static_pubkey)),
        ("host_static_privkey", J::hex(c.host_static_privkey)),
        ("credential", J::hex(&c.credential)),
    ])
}

fn lookup_json(
    name: &str,
    note: &str,
    stored: &[Credential],
    fresh: [u8; 32],
    ephemeral: &[u8],
    masked: &[u8],
    expect_match: bool,
) -> J {
    use crate::credentials::{HandshakeKeys, HandshakeStore, lock_keys};
    use trezor_thp::credential::CredentialStore as _;

    let keys = Arc::new(Mutex::new(HandshakeKeys::with_fresh_key(
        stored.to_vec(),
        fresh,
    )));
    let store = HandshakeStore(keys.clone());
    let mut buffer = vec![0u8; 32 + trezor_thp::channel::MAX_CREDENTIAL_LEN];
    let found = store
        .lookup(ephemeral, masked, &mut buffer)
        .expect("always answers");
    let (privkey, payload) = (
        found.local_static_privkey.to_vec(),
        found.auth_credential.to_vec(),
    );
    let matched = lock_keys(&keys).credential_matched();
    assert_eq!(matched, expect_match, "{name}");
    assert_eq!(lock_keys(&keys).chosen_privkey().to_vec(), privkey);
    Fields::new()
        .put("name", J::str(name))
        .put("note", J::str(note))
        .put(
            "stored_credentials",
            J::arr(stored.iter().map(credential_json)),
        )
        .put("fresh_host_static_privkey", J::hex(fresh))
        .put("ephemeral_pubkey", J::hex(ephemeral))
        .put("masked_static_pubkey", J::hex(masked))
        .put("matched", J::Bool(matched))
        .put("host_static_privkey", J::hex(&privkey))
        .put("noise_payload", J::hex(&payload))
        .done()
}

fn credentials_json(first: &Run, second: &Run) -> J {
    use crate::credentials::MAX_CREDENTIAL_LEN;
    let fresh = seed("credentials/fresh host key");
    let eph = seed("credentials/device ephemeral");
    let eph_pub = public_of(&eph);
    let a = credential_of("device A", b"credential-of-device-A".to_vec());
    let b = credential_of("device B", b"credential-of-device-B".to_vec());
    let masked_a = masked_static(a.trezor_static_pubkey, &eph_pub);
    let masked_b = masked_static(b.trezor_static_pubkey, &eph_pub);
    let mut cases = vec![
        lookup_json(
            "match_second_of_two",
            "device B presents itself; the store holds A and B",
            &[a.clone(), b.clone()],
            fresh,
            &eph_pub,
            &masked_b,
            true,
        ),
        lookup_json(
            "match_first_of_two",
            "device A presents itself",
            &[a.clone(), b.clone()],
            fresh,
            &eph_pub,
            &masked_a,
            true,
        ),
        lookup_json(
            "unknown_device",
            "the store holds A only; B presents itself: the fresh key and an empty payload",
            std::slice::from_ref(&a),
            fresh,
            &eph_pub,
            &masked_b,
            false,
        ),
        lookup_json(
            "empty_store",
            "nothing stored",
            &[],
            fresh,
            &eph_pub,
            &masked_a,
            false,
        ),
        lookup_json(
            "wrong_ephemeral_key",
            "A's masked key was made with another ephemeral key",
            std::slice::from_ref(&a),
            fresh,
            &public_of(&seed("credentials/other ephemeral")),
            &masked_a,
            false,
        ),
        lookup_json(
            "unmasked_static_key",
            "the device's plain static key is not its masked key",
            std::slice::from_ref(&a),
            fresh,
            &eph_pub,
            &a.trezor_static_pubkey,
            false,
        ),
    ];
    for (len, matched, note) in [
        (1, true, "shortest credential"),
        (64, true, "a credential of 64 bytes"),
        (
            MAX_CREDENTIAL_LEN,
            true,
            "the longest credential that still fits the handshake payload",
        ),
        (
            MAX_CREDENTIAL_LEN + 1,
            false,
            "one byte too long for the handshake payload: not used, the fresh key is sent",
        ),
    ] {
        let c = credential_of("device A", vec![0x5a; len]);
        cases.push(lookup_json(
            &format!("credential_of_{len}_bytes"),
            note,
            std::slice::from_ref(&c),
            fresh,
            &eph_pub,
            &masked_static(c.trezor_static_pubkey, &eph_pub),
            matched,
        ));
    }
    // What a real device presented in the handshake of the pairing
    // conversation (made by trezor-thp's device code), against a credential
    // for that device: the rule matches what the device really sends.
    let stored = Credential {
        trezor_static_pubkey: public_of(&first.config.static_privkey),
        host_static_privkey: first.host_static_privkey,
        credential: first.config.issue_blob.clone(),
    };
    for (run, scenario) in [
        (first, "pair_by_code_entry"),
        (second, "reconnect_with_credential"),
    ] {
        assert_eq!(run.lookups.len(), 1, "one lookup per handshake");
        let (observed_eph, observed_masked) = &run.lookups[0];
        cases.push(lookup_json(
            &format!("presented_in_{scenario}"),
            "the ephemeral key and the masked static key the simulated device (trezor-thp's device \
             code) presented in the handshake of that scenario, against the credential the device \
             issued for this host",
            std::slice::from_ref(&stored),
            fresh,
            observed_eph,
            observed_masked,
            true,
        ));
    }
    J::arr(cases)
}

/* ---- scenarios: handshake, conversation, aead, packets ------------------ */

const NOISE_PROTOCOL_NAME: &str = "Noise_XX_25519_AESGCM_SHA256";

/// The nonce the AES-GCM of the Noise backend builds from a counter: four
/// zero bytes, then the counter as a big-endian 64-bit integer
/// (`trezor-noise-rust-crypto`, `Aes256Gcm::encrypt`).
fn nonce_bytes(counter: u64) -> [u8; 12] {
    let mut nonce = [0u8; 12];
    nonce[4..].copy_from_slice(&counter.to_be_bytes());
    nonce
}

fn is_transport(e: &Encryption) -> bool {
    e.ad.is_empty()
}

fn role_name(role: Role) -> &'static str {
    match role {
        Role::Host => "host",
        Role::Device => "device",
    }
}

fn encryption_json(e: &Encryption) -> J {
    let split = e.ciphertext.len() - 16;
    Fields::new()
        .put("sender", J::str(role_name(e.role)))
        .put("key", J::hex(e.key))
        .put("counter", J::num(e.counter))
        .put("nonce", J::hex(nonce_bytes(e.counter)))
        .put("associated_data", J::hex(&e.ad))
        .put("plaintext", J::hex(&e.plaintext))
        .put("ciphertext", J::hex(&e.ciphertext[..split]))
        .put("tag", J::hex(&e.ciphertext[split..]))
        .done()
}

/// The frame of a run as JSON, with what is known about its content.
fn frame_with_content(frame: &Frame, run: &Run, index: usize) -> J {
    let mut fields = frame_json(frame);
    fields.insert(0, ("index".to_owned(), J::num(index)));
    if frame.kind() == "encrypted_transport" || frame.kind() == "handshake_completion_response" {
        let event = run
            .encryptions
            .iter()
            .find(|e| is_transport(e) && e.ciphertext == frame.payload)
            .expect("an encryption produced this frame");
        fields.push(("counter".to_owned(), J::num(event.counter)));
        if frame.kind() == "handshake_completion_response" {
            fields.push((
                "pairing_state".to_owned(),
                J::str(match event.plaintext.as_slice() {
                    [0] => "unpaired",
                    [1] => "paired",
                    [2] => "paired_autoconnect",
                    other => panic!("pairing state {other:?}"),
                }),
            ));
        } else {
            let (session, rest) = event.plaintext.split_first().expect("session byte");
            let message_type = u16::from_be_bytes([rest[0], rest[1]]);
            let payload = &rest[2..];
            let name = decode_wire(message_type, payload).map(|d| d.name);
            fields.push((
                "message".to_owned(),
                obj([
                    ("session", J::num(*session)),
                    ("message_type", J::num(message_type)),
                    ("name", name.map_or_else(|| J::str("unknown"), J::str)),
                    ("payload", J::hex(payload)),
                ]),
            ));
        }
    }
    J::Obj(fields)
}

fn handshake_phase_frames(frames: &[Frame], done_at: usize) -> usize {
    frames
        .iter()
        .take_while(|f| f.last_packet() < done_at)
        .count()
}

fn scenario_json(name: &str, description: &str, run: &Run) -> J {
    let shared = lock(&run.shared);
    let frames = frames::parse(&shared.packets);
    let done_at = shared.handshake_done_at.expect("handshake done");
    let n_handshake = handshake_phase_frames(&frames, done_at);
    let handshake_frames = &frames[..n_handshake];

    // The Noise messages, cut apart.
    let find = |kind: &str| {
        handshake_frames
            .iter()
            .find(|f| f.kind() == kind)
            .unwrap_or_else(|| panic!("no {kind} frame"))
    };
    let allocation_request = find("channel_allocation_request");
    let allocation_response = find("channel_allocation_response");
    let init_request = find("handshake_initiation_request");
    let init_response = find("handshake_initiation_response");
    let completion_request = find("handshake_completion_request");
    let completion_response = find("handshake_completion_response");

    let random_value = |label: &str| {
        run.random
            .iter()
            .find(|(l, _)| *l == label)
            .map(|(_, v)| <[u8; 32]>::try_from(v.as_slice()).expect("32 bytes"))
            .unwrap_or_else(|| panic!("random item {label}"))
    };
    let host_e = random_value("host_ephemeral_privkey");
    let device_e = random_value("device_ephemeral_privkey");
    let device_static = run.config.static_privkey;
    let host_static = run.host_static_privkey;
    assert_eq!(init_request.payload[..32], public_of(&host_e));
    assert_eq!(init_response.payload[..32], public_of(&device_e));

    let handshake_encryptions: Vec<&Encryption> = run
        .encryptions
        .iter()
        .filter(|e| !is_transport(e))
        .collect();
    assert_eq!(
        handshake_encryptions.len(),
        4,
        "the four AEAD calls of Noise XX"
    );
    let names = [
        "initiation_response_static_key",
        "initiation_response_payload",
        "completion_request_static_key",
        "completion_request_payload",
    ];
    // The ciphertexts are the tails of the frames' payloads.
    assert_eq!(
        handshake_encryptions[0].ciphertext,
        init_response.payload[32..80]
    );
    assert_eq!(
        handshake_encryptions[1].ciphertext,
        init_response.payload[80..]
    );
    assert_eq!(
        handshake_encryptions[2].ciphertext,
        completion_request.payload[..48]
    );
    assert_eq!(
        handshake_encryptions[3].ciphertext,
        completion_request.payload[48..]
    );
    // The static key the device sends is its masked key.
    let masked = masked_static(public_of(&device_static), &public_of(&device_e));
    assert_eq!(handshake_encryptions[0].plaintext, masked);
    assert_eq!(
        run.lookups,
        vec![(public_of(&device_e).to_vec(), masked.to_vec())]
    );
    assert_eq!(handshake_encryptions[2].plaintext, public_of(&host_static));

    // Transport keys: the first encryption of each side after the handshake.
    let transport: Vec<&Encryption> = run.encryptions.iter().filter(|e| is_transport(e)).collect();
    let host_key = transport
        .iter()
        .find(|e| e.role == Role::Host)
        .expect("host encrypted")
        .key;
    let device_key = transport
        .iter()
        .find(|e| e.role == Role::Device)
        .expect("device encrypted")
        .key;
    for e in &transport {
        assert_eq!(
            e.key,
            if e.role == Role::Host {
                host_key
            } else {
                device_key
            }
        );
    }
    assert_eq!(shared.handshake_hash, Some(run.host_handshake_hash));

    let properties = &allocation_response.payload[8 + 2..];
    assert_eq!(properties, run.config.properties.as_slice());
    assert_eq!(
        allocation_response.payload[8..10],
        run.config.channel_id.to_be_bytes()
    );

    // The decrypted messages of the run are the encrypted frames of the
    // conversation, in order.
    let encrypted: Vec<(&Frame, &Encryption)> = frames[n_handshake..]
        .iter()
        .filter(|f| f.kind() == "encrypted_transport")
        .map(|f| {
            let event = transport
                .iter()
                .find(|e| e.ciphertext == f.payload)
                .expect("an encryption produced this frame");
            (f, *event)
        })
        .collect();
    assert_eq!(encrypted.len(), shared.messages.len());
    for ((frame, event), (dir, session, id, payload)) in encrypted.iter().zip(&shared.messages) {
        assert_eq!(frame.dir, *dir);
        let mut plaintext = vec![*session];
        plaintext.extend_from_slice(&id.to_be_bytes());
        plaintext.extend_from_slice(payload);
        assert_eq!(event.plaintext, plaintext);
    }

    let noise = Fields::new()
        .put("protocol_name", J::str(NOISE_PROTOCOL_NAME))
        .put("prologue", J::hex(properties))
        .put(
            "messages",
            J::arr([
                obj([
                    ("name", J::str("initiation_request")),
                    ("frame", J::num(init_request.first_packet_index(&frames))),
                    ("ephemeral_pubkey", J::hex(&init_request.payload[..32])),
                    ("payload_clear", J::hex(&init_request.payload[32..])),
                ]),
                obj([
                    ("name", J::str("initiation_response")),
                    ("frame", J::num(init_response.first_packet_index(&frames))),
                    ("ephemeral_pubkey", J::hex(&init_response.payload[..32])),
                    (
                        "encrypted_static_pubkey",
                        J::hex(&init_response.payload[32..80]),
                    ),
                    ("encrypted_payload", J::hex(&init_response.payload[80..])),
                ]),
                obj([
                    ("name", J::str("completion_request")),
                    (
                        "frame",
                        J::num(completion_request.first_packet_index(&frames)),
                    ),
                    (
                        "encrypted_static_pubkey",
                        J::hex(&completion_request.payload[..48]),
                    ),
                    (
                        "encrypted_payload",
                        J::hex(&completion_request.payload[48..]),
                    ),
                ]),
                obj([
                    ("name", J::str("completion_response")),
                    (
                        "frame",
                        J::num(completion_response.first_packet_index(&frames)),
                    ),
                    (
                        "encrypted_pairing_state",
                        J::hex(&completion_response.payload),
                    ),
                ]),
            ]),
        )
        .put(
            "handshake_encryptions",
            J::arr(handshake_encryptions.iter().zip(names).map(|(e, n)| {
                let J::Obj(mut fields) = encryption_json(e) else {
                    unreachable!()
                };
                fields.insert(0, ("name".to_owned(), J::str(n)));
                J::Obj(fields)
            })),
        )
        .put("handshake_hash", J::hex(run.host_handshake_hash))
        .put("host_to_device_key", J::hex(host_key))
        .put("device_to_host_key", J::hex(device_key))
        .done();

    let inputs =
        Fields::new()
            .put(
                "channel_allocation_nonce",
                J::hex(&allocation_request.payload),
            )
            .put("channel_id", J::hex(run.config.channel_id.to_be_bytes()))
            .put("device_properties", J::hex(properties))
            .put("device_static_privkey", J::hex(device_static))
            .put("device_static_pubkey", J::hex(public_of(&device_static)))
            .put("device_static_pubkey_masked", J::hex(masked))
            .put("device_ephemeral_privkey", J::hex(device_e))
            .put("device_ephemeral_pubkey", J::hex(public_of(&device_e)))
            .put("host_static_privkey", J::hex(host_static))
            .put("host_static_pubkey", J::hex(public_of(&host_static)))
            .put("host_ephemeral_privkey", J::hex(host_e))
            .put("host_ephemeral_pubkey", J::hex(public_of(&host_e)))
            .put(
                "random_requests",
                J::arr(run.random.iter().map(|(label, bytes)| {
                    obj([("label", J::str(*label)), ("value", J::hex(bytes))])
                })),
            )
            .done();

    // The device's side of pairing, and the credential a reconnecting host
    // holds, so that a replay has everything it needs.
    let mut inputs_fields = match inputs {
        J::Obj(fields) => fields,
        _ => unreachable!(),
    };
    if let Some(code) = &shared.code {
        inputs_fields.push((
            "pairing".to_owned(),
            obj([
                ("code", J::str(code.clone())),
                ("code_entry_secret", J::hex(run.config.code_secret)),
                (
                    "device_cpace_private_key",
                    J::hex(run.config.cpace_private_key),
                ),
                ("issued_credential", J::hex(&run.config.issue_blob)),
            ]),
        ));
    }
    if let Some(known) = &run.config.known {
        inputs_fields.push((
            "stored_credential".to_owned(),
            credential_json(&Credential {
                trezor_static_pubkey: public_of(&device_static),
                host_static_privkey: host_static,
                credential: known.blob.clone(),
            }),
        ));
    }
    let inputs = J::Obj(inputs_fields);

    Fields::new()
        .put("name", J::str(name))
        .put("description", J::str(description))
        .put("inputs", inputs)
        .put("noise", noise)
        .put(
            "handshake_frames",
            J::arr(
                handshake_frames
                    .iter()
                    .enumerate()
                    .map(|(i, f)| frame_with_content(f, run, i)),
            ),
        )
        .put(
            "conversation_frames",
            J::arr(
                frames[n_handshake..]
                    .iter()
                    .enumerate()
                    .map(|(i, f)| frame_with_content(f, run, n_handshake + i)),
            ),
        )
        .done()
}

impl Frame {
    /// The index of this frame in `frames` (frames are in packet order).
    fn first_packet_index(&self, frames: &[Frame]) -> usize {
        frames
            .iter()
            .position(|f| f.first_packet == self.first_packet)
            .expect("frame in list")
    }
}

/// The first `count` transport encryptions of each side of a run.
fn aead_json(runs: [(&str, &Run); 2]) -> J {
    let mut cases = Vec::new();
    for (name, run) in runs {
        for role in [Role::Host, Role::Device] {
            for e in run
                .encryptions
                .iter()
                .filter(|e| is_transport(e) && e.role == role)
                .take(4)
            {
                let J::Obj(mut fields) = encryption_json(e) else {
                    unreachable!()
                };
                fields.insert(0, ("scenario".to_owned(), J::str(name)));
                cases.push(J::Obj(fields));
            }
        }
    }
    // The same cipher the channel uses, at counters that cross byte
    // boundaries, with and without associated data.
    use trezor_thp::channel::{Cipher as _, U8Array as _};
    type C = <crate::thp::Crypto as trezor_thp::Backend>::Cipher;
    let key = <C as trezor_thp::channel::Cipher>::Key::from_slice(&seed("aead/key"));
    let mut synthetic = Vec::new();
    for (counter, ad, plaintext) in [
        (0u64, Vec::new(), vec![]),
        (1, Vec::new(), b"thru".to_vec()),
        (255, Vec::new(), seed("aead/plaintext 255").to_vec()),
        (256, Vec::new(), seed("aead/plaintext 256").to_vec()),
        (65_536, Vec::new(), vec![0u8; 100]),
        (
            u64::from(u32::MAX),
            seed("aead/ad").to_vec(),
            vec![0x5a; 17],
        ),
        (1 << 32, seed("aead/ad").to_vec(), vec![0x5a; 17]),
        (u64::MAX - 1, seed("aead/ad").to_vec(), vec![1, 2, 3]),
    ] {
        let mut out = vec![0u8; plaintext.len() + 16];
        C::encrypt(&key, counter, &ad, &plaintext, &mut out);
        let mut back = vec![0u8; plaintext.len()];
        C::decrypt(&key, counter, &ad, &out, &mut back).expect("decrypts");
        assert_eq!(back, plaintext);
        let split = out.len() - 16;
        synthetic.push(obj([
            ("key", J::hex(seed("aead/key"))),
            ("counter", J::str(counter.to_string())),
            ("nonce", J::hex(nonce_bytes(counter))),
            ("associated_data", J::hex(&ad)),
            ("plaintext", J::hex(&plaintext)),
            ("ciphertext", J::hex(&out[..split])),
            ("tag", J::hex(&out[split..])),
        ]));
    }
    Fields::new()
        .put("channel", J::arr(cases))
        .put("synthetic", J::arr(synthetic))
        .done()
}

/// Frames chosen to show framing: by kind and by size.
fn packets_json(runs: [(&str, &Run); 2]) -> J {
    let mut cases = Vec::new();
    let mut taken: Vec<(String, usize)> = Vec::new();
    let mut add = |label: &str, scenario: &str, run: &Run, frame: &Frame, index: usize| {
        if taken.iter().any(|(s, i)| s == scenario && *i == index) {
            return;
        }
        taken.push((scenario.to_owned(), index));
        let J::Obj(mut fields) = frame_with_content(frame, run, index) else {
            unreachable!()
        };
        fields.insert(0, ("scenario".to_owned(), J::str(scenario)));
        fields.insert(0, ("name".to_owned(), J::str(label)));
        cases.push(J::Obj(fields));
    };
    for (scenario, run) in runs {
        let shared = lock(&run.shared);
        let frames = frames::parse(&shared.packets);
        let pick = |f: &dyn Fn(&Frame) -> bool| frames.iter().enumerate().find(|(_, fr)| f(fr));
        let encrypted = |dir: Dir, count: Option<usize>| {
            move |f: &Frame| {
                f.dir == dir
                    && f.kind() == "encrypted_transport"
                    && count.is_none_or(|n| f.packets.len() == n)
            }
        };
        for kind in [
            "channel_allocation_request",
            "channel_allocation_response",
            "handshake_initiation_request",
            "handshake_initiation_response",
            "handshake_completion_request",
            "handshake_completion_response",
        ] {
            if let Some((i, f)) = pick(&|f| f.kind() == kind) {
                add(kind, scenario, run, f, i);
            }
        }
        for dir in [Dir::HostToDevice, Dir::DeviceToHost] {
            if let Some((i, f)) = pick(&|f| f.dir == dir && f.kind() == "ack") {
                add(&format!("ack_{}", dir_name(dir)), scenario, run, f, i);
            }
            for (label, count) in [("one_packet", Some(1)), ("two_packets", Some(2))] {
                if let Some((i, f)) = pick(&encrypted(dir, count)) {
                    add(
                        &format!("encrypted_{label}_{}", dir_name(dir)),
                        scenario,
                        run,
                        f,
                        i,
                    );
                }
            }
            let longest = frames
                .iter()
                .enumerate()
                .filter(|(_, f)| f.dir == dir && f.kind() == "encrypted_transport")
                .max_by_key(|(_, f)| f.packets.len());
            if let Some((i, f)) = longest
                && f.packets.len() > 2
            {
                add(
                    &format!("encrypted_many_packets_{}", dir_name(dir)),
                    scenario,
                    run,
                    f,
                    i,
                );
            }
        }
    }
    J::arr(cases)
}

/* ---- the document ------------------------------------------------------- */

fn build() -> J {
    let storage = MemoryCredentialStorage::new();
    let first = run_pairing(&storage);
    let second = run_reconnect(&storage, &first);

    // The pairing messages the real client sent must be what the CPace code
    // gives for the same inputs (the client ran `cpace` with the scripted
    // scalar and the code the device showed).
    check_pairing_against_cpace(&first);

    let all_messages = message_cases();
    let message_names: Vec<String> = all_messages
        .iter()
        .map(|case| match case {
            J::Obj(entries) => match &entries[0].1 {
                J::Str(s) => s.clone(),
                _ => unreachable!(),
            },
            _ => unreachable!(),
        })
        .collect();
    for name in ALL_NAMES {
        assert!(
            message_names.iter().any(|n| n == name),
            "no case for message {name}"
        );
    }

    let scenarios = [
        (
            "pair_by_code_entry",
            "Fresh host: no stored credential. Allocates a channel, runs the handshake, pairs by \
             code entry, creates the session, loads the Thru app (header, root packet, two chunks), \
             then public key, message signature (with a button request), EOA authorization and \
             two transaction signatures (3000 bytes with a token hint, 100 bytes without).",
            &first,
        ),
        (
            "reconnect_with_credential",
            "The stored credential from the first scenario: the device recognises it, pairing is \
             skipped, a session with the passphrase typed on the device (with its button request), \
             the app is already held, public key.",
            &second,
        ),
    ];

    let handshake: Vec<J> = scenarios
        .iter()
        .map(|(name, description, run)| scenario_json(name, description, run))
        .collect();
    let runs = [
        ("pair_by_code_entry", &first),
        ("reconnect_with_credential", &second),
    ];

    let mut captured = Vec::new();
    for (name, run) in runs {
        captured.extend(captured_messages(name, run));
    }

    Fields::new()
        .put("format", J::str("thru-trezor-host-vectors"))
        .put("version", J::num(1))
        .put(
            "messages",
            Fields::new()
                .put("cases", J::arr(all_messages))
                .put("captured", J::arr(captured))
                .done(),
        )
        .put(
            "cpace",
            Fields::new()
                .put("crypto", cpace_json())
                .put("code_entry", code_entry_json())
                .done(),
        )
        .put("credentials", credentials_json(&first, &second))
        .put("aead", aead_json(runs))
        .put("packets", packets_json(runs))
        .put(
            "handshake",
            Fields::new()
                .put("protocol_name", J::str(NOISE_PROTOCOL_NAME))
                .put("scenarios", J::arr(handshake))
                .done(),
        )
        .done()
}

/// Checks the pairing messages of the first run against a direct call of
/// the CPace code.
fn check_pairing_against_cpace(run: &Run) {
    use crate::cpace::cpace_with_key;
    use prost::Message as _;
    let shared = lock(&run.shared);
    let find = |id: u16| {
        shared
            .messages
            .iter()
            .find(|(_, _, i, _)| *i == id)
            .unwrap_or_else(|| panic!("message {id}"))
            .3
            .clone()
    };
    let challenge = ThpCodeEntryChallenge::decode(find(ThpCodeEntryChallenge::ID).as_slice())
        .expect("challenge");
    let device_key =
        ThpCodeEntryCpaceTrezor::decode(find(ThpCodeEntryCpaceTrezor::ID).as_slice()).expect("key");
    let sent = ThpCodeEntryCpaceHostTag::decode(find(ThpCodeEntryCpaceHostTag::ID).as_slice())
        .expect("tag");
    let code = shared.code.clone().expect("code");
    assert_eq!(
        code,
        crate::client::code_entry_code(
            &run.host_handshake_hash,
            &run.config.code_secret,
            &challenge.challenge
        )
    );
    let scalar: [u8; 32] = run
        .random
        .iter()
        .find(|(l, _)| *l == "cpace_host_private_key")
        .map(|(_, v)| v.as_slice().try_into().expect("32 bytes"))
        .expect("scalar");
    let direct = cpace_with_key(
        code.as_bytes(),
        &run.host_handshake_hash,
        &device_key
            .cpace_trezor_public_key
            .as_slice()
            .try_into()
            .expect("32 bytes"),
        scalar,
    )
    .expect("direct CPace");
    assert_eq!(sent.cpace_host_public_key, direct.host_public_key);
    assert_eq!(
        sent.tag,
        crate::client::code_entry_tag(&direct.shared_secret)
    );
}

fn vector_path() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../contrib/test/vectors/trezor/host_vectors.json")
}

/// Writes the vector file (`THRU_TREZOR_WRITE_VECTORS=1`) or checks that the
/// file on disk is what the host code produces now.
#[test]
fn vector_file_matches_the_host() {
    let text = build().to_text();
    // The same code twice gives the same file: nothing in it is random or
    // time dependent.
    assert!(
        text == build().to_text(),
        "the vector file is not deterministic"
    );
    let path = vector_path();
    if std::env::var("THRU_TREZOR_WRITE_VECTORS").is_ok_and(|v| v == "1") {
        std::fs::create_dir_all(path.parent().expect("parent")).expect("create directory");
        std::fs::write(&path, &text).expect("write the vector file");
        return;
    }
    let on_disk = std::fs::read_to_string(&path).unwrap_or_else(|e| {
        panic!(
            "{}: {e}; write it with THRU_TREZOR_WRITE_VECTORS=1 cargo test -p thru-trezor vectors",
            path.display()
        )
    });
    if on_disk != text {
        let line = on_disk
            .lines()
            .zip(text.lines())
            .position(|(a, b)| a != b)
            .unwrap_or_else(|| on_disk.lines().count().min(text.lines().count()));
        panic!(
            "{} differs from what the host code produces (first difference at line {}); \
             if the change is intended, rewrite it with \
             THRU_TREZOR_WRITE_VECTORS=1 cargo test -p thru-trezor vectors and tell the TypeScript \
             host's owner",
            path.display(),
            line + 1
        );
    }
}

/* ---- not in the vector file: the probe and the model check -------------- */

/// `Trezor::connect` probes before it opens a channel. The simulated device
/// answers it with the device half of `trezor-thp`, the code a Safe 7 runs.
#[test]
fn connect_probes_and_finds_the_trezor_host_protocol() {
    let shared: SharedRef = Arc::new(Mutex::new(Shared::default()));
    let sim = SimDevice::new(device_config("probe"), shared.clone());
    let storage = MemoryCredentialStorage::new();
    let options = ConnectOptions::new("probe-host", "thru");
    let trezor =
        Trezor::connect(sim, &options, &storage, Box::new(CodeUi(shared.clone()))).expect("pairs");
    assert_eq!(trezor.protocol(), crate::Protocol::Thp);
    assert_eq!(trezor.device_model().expect("a model"), "T3W1");
    assert!(trezor.properties().is_some());
    // The first packet the device saw is the older protocol's `Cancel`, and it
    // answered with `Failure(InvalidProtocol)` in that framing.
    let shared = lock(&shared);
    assert_eq!(shared.packets[0].0, Dir::HostToDevice);
    assert_eq!(&shared.packets[0].1[..9], b"?##\x00\x14\x00\x00\x00\x00");
    assert_eq!(shared.packets[1].0, Dir::DeviceToHost);
    assert_eq!(
        &shared.packets[1].1[..11],
        b"?##\x00\x03\x00\x00\x00\x02\x08\x11"
    );
    // The channel was opened and paired as ever: a credential was stored.
    assert_eq!(storage.load().expect("stored").len(), 1);
}

/// The model of the image against the model in the device properties.
#[test]
fn the_model_check_on_the_trezor_host_protocol() {
    let shared: SharedRef = Arc::new(Mutex::new(Shared::default()));
    let mut config = device_config("model");
    config.app_held = true;
    let sim = SimDevice::new(config, shared.clone());
    let storage = MemoryCredentialStorage::new();
    let options = ConnectOptions::new("model-host", "thru");
    let mut trezor =
        Trezor::connect(sim, &options, &storage, Box::new(CodeUi(shared.clone()))).expect("pairs");

    let mut image = test_image();
    image.header[104..108].copy_from_slice(b"T3T1");
    let error = crate::extapp::load(&mut trezor, &image).expect_err("a Safe 5 image");
    let crate::error::TrezorError::AppImage(text) = error else {
        panic!("wrong error: {error}");
    };
    assert!(text.contains("T3T1") && text.contains("T3W1"), "{text}");
    assert!(
        !lock(&shared)
            .messages
            .iter()
            .any(|(_, _, id, _)| *id == ExtAppLoad::ID),
        "nothing was sent for the load"
    );

    image.header[104..108].copy_from_slice(b"T3W1");
    assert_eq!(
        crate::extapp::load(&mut trezor, &image).expect("a Safe 7 image"),
        3
    );
}
