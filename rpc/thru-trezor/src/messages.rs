//! The protobuf messages this crate exchanges with the device, written by
//! hand for `prost`.
//!
//! Field numbers and wire ids are copied from Trezor's `common/protob`
//! (`messages.proto`, `messages-common.proto`, `messages-thp.proto`,
//! `messages-extapp.proto`) and, for the Thru app, from
//! `trezor/app-thru/protob/thru.proto`. Only the messages used are here; the
//! tests at the end pin their encodings.

/// A message with its wire id.
pub trait Wire: prost::Message + Default {
    /// `MessageType` (or `ThpMessageType`) value of the message.
    const ID: u16;
    /// Name used in errors.
    const NAME: &'static str;
}

macro_rules! wire {
    ($ty:ident, $id:expr) => {
        impl Wire for $ty {
            const ID: u16 = $id;
            const NAME: &'static str = stringify!($ty);
        }
    };
}

/* ---- common ---------------------------------------------------------- */

#[derive(Clone, PartialEq, prost::Message)]
pub struct Success {
    #[prost(string, optional, tag = "1")]
    pub message: Option<String>,
}
wire!(Success, 2);

#[derive(Clone, PartialEq, prost::Message)]
pub struct Failure {
    #[prost(int32, optional, tag = "1")]
    pub code: Option<i32>,
    #[prost(string, optional, tag = "2")]
    pub message: Option<String>,
}
wire!(Failure, 3);

#[derive(Clone, PartialEq, prost::Message)]
pub struct ButtonRequest {
    #[prost(int32, optional, tag = "1")]
    pub code: Option<i32>,
    #[prost(uint32, optional, tag = "2")]
    pub pages: Option<u32>,
    #[prost(string, optional, tag = "4")]
    pub name: Option<String>,
}
wire!(ButtonRequest, 26);

#[derive(Clone, PartialEq, prost::Message)]
pub struct ButtonAck {}
wire!(ButtonAck, 27);

#[derive(Clone, PartialEq, prost::Message)]
pub struct Version {
    #[prost(uint32, required, tag = "1")]
    pub major: u32,
    #[prost(uint32, required, tag = "2")]
    pub minor: u32,
    #[prost(uint32, optional, tag = "3")]
    pub patch: Option<u32>,
    #[prost(uint32, optional, tag = "4")]
    pub build: Option<u32>,
}

/// `ButtonRequestType` values this crate acts on.
pub mod button_request_type {
    /// The person is typing the passphrase on the device.
    pub const PASSPHRASE_ENTRY: i32 = 19;
}

/* ---- Trezor Host Protocol: handshake, pairing, sessions ---------------- */

/// `ThpPairingMethod` values.
pub mod pairing_method {
    pub const SKIP_PAIRING: i32 = 1;
    pub const CODE_ENTRY: i32 = 2;
}

/// Sent by the device in clear with the channel allocation; not a wire message.
#[derive(Clone, PartialEq, prost::Message)]
pub struct ThpDeviceProperties {
    #[prost(string, required, tag = "1")]
    pub internal_model: String,
    #[prost(uint32, optional, tag = "2")]
    pub model_variant: Option<u32>,
    #[prost(uint32, required, tag = "3")]
    pub protocol_version_major: u32,
    #[prost(uint32, required, tag = "4")]
    pub protocol_version_minor: u32,
    #[prost(int32, repeated, packed = "false", tag = "5")]
    pub pairing_methods: Vec<i32>,
}

/// The payload of the host's handshake completion message (`@embed`: it
/// travels inside the Noise message, not as a wire message). It carries the
/// credential the device issued earlier, or nothing.
#[derive(Clone, PartialEq, prost::Message)]
pub struct ThpHandshakeCompletionReqNoisePayload {
    #[prost(bytes = "vec", optional, tag = "1")]
    pub host_pairing_credential: Option<Vec<u8>>,
}

#[derive(Clone, PartialEq, prost::Message)]
pub struct ThpCreateNewSession {
    #[prost(string, optional, tag = "1")]
    pub passphrase: Option<String>,
    #[prost(bool, optional, tag = "2")]
    pub on_device: Option<bool>,
    #[prost(bool, optional, tag = "3")]
    pub derive_cardano: Option<bool>,
}
wire!(ThpCreateNewSession, 1000);

#[derive(Clone, PartialEq, prost::Message)]
pub struct ThpPairingRequest {
    #[prost(string, required, tag = "1")]
    pub host_name: String,
    #[prost(string, required, tag = "2")]
    pub app_name: String,
}
wire!(ThpPairingRequest, 1008);

#[derive(Clone, PartialEq, prost::Message)]
pub struct ThpPairingRequestApproved {}
wire!(ThpPairingRequestApproved, 1009);

#[derive(Clone, PartialEq, prost::Message)]
pub struct ThpSelectMethod {
    #[prost(int32, required, tag = "1")]
    pub selected_pairing_method: i32,
}
wire!(ThpSelectMethod, 1010);

#[derive(Clone, PartialEq, prost::Message)]
pub struct ThpCredentialRequest {
    #[prost(bytes = "vec", required, tag = "1")]
    pub host_static_public_key: Vec<u8>,
    #[prost(bool, optional, tag = "2")]
    pub autoconnect: Option<bool>,
    #[prost(bytes = "vec", optional, tag = "3")]
    pub credential: Option<Vec<u8>>,
}
wire!(ThpCredentialRequest, 1016);

#[derive(Clone, PartialEq, prost::Message)]
pub struct ThpCredentialResponse {
    #[prost(bytes = "vec", required, tag = "1")]
    pub trezor_static_public_key: Vec<u8>,
    #[prost(bytes = "vec", required, tag = "2")]
    pub credential: Vec<u8>,
}
wire!(ThpCredentialResponse, 1017);

#[derive(Clone, PartialEq, prost::Message)]
pub struct ThpEndRequest {}
wire!(ThpEndRequest, 1018);

#[derive(Clone, PartialEq, prost::Message)]
pub struct ThpEndResponse {}
wire!(ThpEndResponse, 1019);

#[derive(Clone, PartialEq, prost::Message)]
pub struct ThpCodeEntryCommitment {
    #[prost(bytes = "vec", required, tag = "1")]
    pub commitment: Vec<u8>,
}
wire!(ThpCodeEntryCommitment, 1024);

#[derive(Clone, PartialEq, prost::Message)]
pub struct ThpCodeEntryChallenge {
    #[prost(bytes = "vec", required, tag = "1")]
    pub challenge: Vec<u8>,
}
wire!(ThpCodeEntryChallenge, 1025);

#[derive(Clone, PartialEq, prost::Message)]
pub struct ThpCodeEntryCpaceTrezor {
    #[prost(bytes = "vec", required, tag = "1")]
    pub cpace_trezor_public_key: Vec<u8>,
}
wire!(ThpCodeEntryCpaceTrezor, 1026);

#[derive(Clone, PartialEq, prost::Message)]
pub struct ThpCodeEntryCpaceHostTag {
    #[prost(bytes = "vec", required, tag = "1")]
    pub cpace_host_public_key: Vec<u8>,
    #[prost(bytes = "vec", required, tag = "2")]
    pub tag: Vec<u8>,
}
wire!(ThpCodeEntryCpaceHostTag, 1027);

#[derive(Clone, PartialEq, prost::Message)]
pub struct ThpCodeEntrySecret {
    #[prost(bytes = "vec", required, tag = "1")]
    pub secret: Vec<u8>,
}
wire!(ThpCodeEntrySecret, 1028);

/* ---- app loading ------------------------------------------------------- */

#[derive(Clone, PartialEq, prost::Message)]
pub struct ExtAppLoad {
    #[prost(string, required, tag = "1")]
    pub id: String,
    #[prost(message, required, tag = "2")]
    pub version: Version,
    #[prost(bytes = "vec", optional, tag = "3")]
    pub fingerprint: Option<Vec<u8>>,
}
wire!(ExtAppLoad, 9200);

#[derive(Clone, PartialEq, prost::Message)]
pub struct ExtAppLoaded {
    #[prost(uint32, required, tag = "1")]
    pub instance_id: u32,
    #[prost(message, required, tag = "2")]
    pub version: Version,
}
wire!(ExtAppLoaded, 9201);

#[derive(Clone, PartialEq, prost::Message)]
pub struct ExtAppHeaderRequest {}
wire!(ExtAppHeaderRequest, 9202);

#[derive(Clone, PartialEq, prost::Message)]
pub struct ExtAppHeaderAck {
    #[prost(bytes = "vec", required, tag = "1")]
    pub header: Vec<u8>,
    #[prost(bytes = "vec", required, tag = "2")]
    pub proof: Vec<u8>,
    #[prost(sint64, required, tag = "3")]
    pub root_packet_timestamp: i64,
}
wire!(ExtAppHeaderAck, 9203);

#[derive(Clone, PartialEq, prost::Message)]
pub struct ExtAppRootPacketRequest {
    #[prost(uint32, required, tag = "1")]
    pub app_ring: u32,
}
wire!(ExtAppRootPacketRequest, 9204);

#[derive(Clone, PartialEq, prost::Message)]
pub struct ExtAppRootPacketAck {
    #[prost(bytes = "vec", required, tag = "1")]
    pub root_packet: Vec<u8>,
}
wire!(ExtAppRootPacketAck, 9205);

#[derive(Clone, PartialEq, prost::Message)]
pub struct ExtAppDataChunkRequest {
    #[prost(uint32, required, tag = "1")]
    pub index: u32,
}
wire!(ExtAppDataChunkRequest, 9206);

#[derive(Clone, PartialEq, prost::Message)]
pub struct ExtAppDataChunkAck {
    #[prost(bytes = "vec", required, tag = "1")]
    pub data: Vec<u8>,
    #[prost(bytes = "vec", required, tag = "2")]
    pub hash: Vec<u8>,
}
wire!(ExtAppDataChunkAck, 9207);

#[derive(Clone, PartialEq, prost::Message)]
pub struct ExtAppMessage {
    #[prost(uint32, required, tag = "1")]
    pub instance_id: u32,
    #[prost(uint32, required, tag = "2")]
    pub message_id: u32,
    #[prost(bytes = "vec", required, tag = "3")]
    pub data: Vec<u8>,
}
wire!(ExtAppMessage, 9208);

#[derive(Clone, PartialEq, prost::Message)]
pub struct ExtAppResponse {
    #[prost(uint32, required, tag = "1")]
    pub message_id: u32,
    #[prost(bytes = "vec", required, tag = "2")]
    pub data: Vec<u8>,
}
wire!(ExtAppResponse, 9209);

/* ---- the Thru app (ids are the app's own, inside ExtAppMessage) -------- */

/// A message of the Thru app with its `message_id`.
pub trait AppWire: prost::Message + Default {
    const ID: u32;
    const NAME: &'static str;
}

macro_rules! app_wire {
    ($ty:ident, $id:expr) => {
        impl AppWire for $ty {
            const ID: u32 = $id;
            const NAME: &'static str = stringify!($ty);
        }
    };
}

#[derive(Clone, PartialEq, prost::Message)]
pub struct GetPublicKey {
    #[prost(uint32, repeated, packed = "false", tag = "1")]
    pub address_n: Vec<u32>,
    #[prost(bool, optional, tag = "2")]
    pub show_display: Option<bool>,
}
app_wire!(GetPublicKey, 0);

#[derive(Clone, PartialEq, prost::Message)]
pub struct PublicKey {
    #[prost(bytes = "vec", required, tag = "1")]
    pub public_key: Vec<u8>,
    #[prost(string, required, tag = "2")]
    pub address: String,
}
app_wire!(PublicKey, 1);

#[derive(Clone, PartialEq, prost::Message)]
pub struct SignTx {
    #[prost(uint32, repeated, packed = "false", tag = "1")]
    pub address_n: Vec<u32>,
    #[prost(uint32, required, tag = "2")]
    pub body_size: u32,
    /// The token hint (129 opaque bytes; the device checks it), if any.
    #[prost(bytes = "vec", optional, tag = "3")]
    pub token_hint: Option<Vec<u8>>,
}
app_wire!(SignTx, 2);

#[derive(Clone, PartialEq, prost::Message)]
pub struct TxDataRequest {
    #[prost(uint32, required, tag = "1")]
    pub offset: u32,
    #[prost(uint32, required, tag = "2")]
    pub length: u32,
}
app_wire!(TxDataRequest, 3);

#[derive(Clone, PartialEq, prost::Message)]
pub struct TxDataAck {
    #[prost(bytes = "vec", required, tag = "1")]
    pub data: Vec<u8>,
}
app_wire!(TxDataAck, 4);

#[derive(Clone, PartialEq, prost::Message)]
pub struct TxSignature {
    #[prost(bytes = "vec", required, tag = "1")]
    pub signature: Vec<u8>,
}
app_wire!(TxSignature, 5);

#[derive(Clone, PartialEq, prost::Message)]
pub struct SignMessage {
    #[prost(uint32, repeated, packed = "false", tag = "1")]
    pub address_n: Vec<u32>,
    #[prost(bytes = "vec", required, tag = "2")]
    pub message: Vec<u8>,
}
app_wire!(SignMessage, 6);

#[derive(Clone, PartialEq, prost::Message)]
pub struct MessageSignature {
    #[prost(bytes = "vec", required, tag = "1")]
    pub signature: Vec<u8>,
}
app_wire!(MessageSignature, 7);

#[derive(Clone, PartialEq, prost::Message)]
pub struct SignEoaAuth {
    #[prost(uint32, repeated, packed = "false", tag = "1")]
    pub address_n: Vec<u32>,
    /// 0 create, 1 delete.
    #[prost(uint32, required, tag = "2")]
    pub kind: u32,
    #[prost(uint32, required, tag = "3")]
    pub chain_id: u32,
    #[prost(bytes = "vec", required, tag = "4")]
    pub fee_payer: Vec<u8>,
    #[prost(bytes = "vec", required, tag = "5")]
    pub account: Vec<u8>,
}
app_wire!(SignEoaAuth, 8);

#[derive(Clone, PartialEq, prost::Message)]
pub struct EoaAuthSignature {
    #[prost(bytes = "vec", required, tag = "1")]
    pub signature: Vec<u8>,
}
app_wire!(EoaAuthSignature, 9);

/* ---- the older protocol: sessions, features, unlocking, passphrases ----- */

/// Starts a session. Without a `session_id` the device starts a new one and
/// forgets what the least recently used session held.
#[derive(Clone, PartialEq, prost::Message)]
pub struct Initialize {
    #[prost(bytes = "vec", optional, tag = "1")]
    pub session_id: Option<Vec<u8>>,
    #[prost(bool, optional, tag = "3")]
    pub derive_cardano: Option<bool>,
}
wire!(Initialize, 0);

#[derive(Clone, PartialEq, prost::Message)]
pub struct GetFeatures {}
wire!(GetFeatures, 55);

/// The fields of `Features` this crate reads. The passphrase settings and
/// `unlocked` are private: a locked device leaves them out.
#[derive(Clone, PartialEq, prost::Message)]
pub struct Features {
    #[prost(bool, optional, tag = "5")]
    pub bootloader_mode: Option<bool>,
    #[prost(bool, optional, tag = "8")]
    pub passphrase_protection: Option<bool>,
    #[prost(bool, optional, tag = "12")]
    pub initialized: Option<bool>,
    #[prost(bool, optional, tag = "16")]
    pub unlocked: Option<bool>,
    #[prost(bytes = "vec", optional, tag = "35")]
    pub session_id: Option<Vec<u8>>,
    #[prost(bool, optional, tag = "36")]
    pub passphrase_always_on_device: Option<bool>,
    /// The internal model name, `T3T1` for the Safe 5 and `T3W1` for the
    /// Safe 7: what the app image header names.
    #[prost(string, optional, tag = "44")]
    pub internal_model: Option<String>,
}
wire!(Features, 17);

#[derive(Clone, PartialEq, prost::Message)]
pub struct Cancel {}
wire!(Cancel, 20);

/// With no flags it changes nothing; the device needs it unlocked, so it
/// unlocks the device without deriving anything.
#[derive(Clone, PartialEq, prost::Message)]
pub struct ApplyFlags {
    #[prost(uint32, required, tag = "1")]
    pub flags: u32,
}
wire!(ApplyFlags, 28);

/// The device asks for the PIN as a scrambled matrix the computer shows. This
/// crate answers it with an error: the Safe 5 takes the PIN on the device.
#[derive(Clone, PartialEq, prost::Message)]
pub struct PinMatrixRequest {}
wire!(PinMatrixRequest, 18);

#[derive(Clone, PartialEq, prost::Message)]
pub struct PassphraseRequest {}
wire!(PassphraseRequest, 41);

#[derive(Clone, PartialEq, prost::Message)]
pub struct PassphraseAck {
    #[prost(string, optional, tag = "1")]
    pub passphrase: Option<String>,
    #[prost(bool, optional, tag = "3")]
    pub on_device: Option<bool>,
}
wire!(PassphraseAck, 42);

/* ---- tests ------------------------------------------------------------- */

/// The expected bytes were produced by Python `trezorlib.protobuf.dump_message`
/// (the Thru app's from the generated classes of `trezor/app-thru/tests`).
#[cfg(test)]
mod tests {
    use super::*;

    const HARDENED: u32 = 0x8000_0000;
    const PATH: [u32; 4] = [44 | HARDENED, 8478 | HARDENED, HARDENED, HARDENED];

    fn check<M: prost::Message + Default + PartialEq + std::fmt::Debug>(
        message: M,
        expected: &str,
    ) {
        assert_eq!(hex::encode(message.encode_to_vec()), expected);
        let decoded = M::decode(hex::decode(expected).expect("hex").as_slice()).expect("decode");
        assert_eq!(decoded, message);
    }

    #[test]
    fn pairing_messages() {
        check(
            ThpPairingRequest {
                host_name: "localhost".into(),
                app_name: "trezor_check".into(),
            },
            "0a096c6f63616c686f7374120c7472657a6f725f636865636b",
        );
        check(
            ThpSelectMethod {
                selected_pairing_method: pairing_method::SKIP_PAIRING,
            },
            "0801",
        );
        check(
            ThpCreateNewSession {
                passphrase: Some(String::new()),
                on_device: None,
                derive_cardano: None,
            },
            "0a00",
        );
        check(ButtonAck {}, "");
    }

    #[test]
    fn session_requests() {
        // The standard wallet: the empty passphrase from the host.
        check(
            ThpCreateNewSession {
                passphrase: Some(String::new()),
                on_device: None,
                derive_cardano: None,
            },
            "0a00",
        );
        // A passphrase typed on the device: `on_device` and no passphrase (the
        // device refuses both together).
        check(
            ThpCreateNewSession {
                passphrase: None,
                on_device: Some(true),
                derive_cardano: None,
            },
            "1001",
        );
    }

    #[test]
    fn code_entry_and_credential_messages() {
        check(
            ThpCodeEntryCommitment {
                commitment: vec![0x11; 4],
            },
            "0a0411111111",
        );
        check(
            ThpCodeEntryChallenge {
                challenge: vec![0x22; 3],
            },
            "0a03222222",
        );
        check(
            ThpCodeEntryCpaceTrezor {
                cpace_trezor_public_key: vec![1, 2],
            },
            "0a020102",
        );
        check(
            ThpCodeEntryCpaceHostTag {
                cpace_host_public_key: vec![1, 2],
                tag: vec![3],
            },
            "0a020102120103",
        );
        check(ThpCodeEntrySecret { secret: vec![9] }, "0a0109");
        check(
            ThpCredentialRequest {
                host_static_public_key: vec![1, 2],
                autoconnect: Some(false),
                credential: None,
            },
            "0a0201021000",
        );
        check(
            ThpCredentialResponse {
                trezor_static_public_key: vec![1],
                credential: vec![2, 3],
            },
            "0a010112020203",
        );
        check(ThpEndRequest {}, "");
        check(
            ThpHandshakeCompletionReqNoisePayload {
                host_pairing_credential: Some(vec![1, 2, 3]),
            },
            "0a03010203",
        );
        // No credential: the payload is empty, as trezorlib sends it.
        check(
            ThpHandshakeCompletionReqNoisePayload {
                host_pairing_credential: None,
            },
            "",
        );
    }

    #[test]
    fn app_loading_messages() {
        check(
            ExtAppLoad {
                id: "thru.thru.org".into(),
                version: Version {
                    major: 0,
                    minor: 1,
                    patch: Some(0),
                    build: Some(0),
                },
                fingerprint: None,
            },
            "0a0d746872752e746872752e6f726712080800100118002000",
        );
        // The timestamp is a sint64: -5 is zigzag 9.
        check(
            ExtAppHeaderAck {
                header: vec![1, 2, 3],
                proof: vec![0xAA; 4],
                root_packet_timestamp: -5,
            },
            "0a030102031204aaaaaaaa1809",
        );
        check(
            ExtAppDataChunkAck {
                data: b"abc".to_vec(),
                hash: vec![0; 32],
            },
            "0a0361626312200000000000000000000000000000000000000000000000000000000000000000",
        );
        check(
            ExtAppMessage {
                instance_id: 3,
                message_id: 2,
                data: vec![8, 1],
            },
            "080310021a020801",
        );
    }

    #[test]
    fn thru_app_messages() {
        check(
            GetPublicKey {
                address_n: PATH.to_vec(),
                show_display: Some(true),
            },
            "08ac80808008089ec28080080880808080080880808080081001",
        );
        check(
            SignTx {
                address_n: PATH.to_vec(),
                body_size: 300,
                token_hint: None,
            },
            "08ac80808008089ec280800808808080800808808080800810ac02",
        );
        // A 129-byte hint: field 3, length 0x81 0x01.
        check(
            SignTx {
                address_n: PATH.to_vec(),
                body_size: 300,
                token_hint: Some(vec![0xAB; 129]),
            },
            &format!(
                "08ac80808008089ec280800808808080800808808080800810ac021a8101{}",
                "ab".repeat(129)
            ),
        );
        // Present but empty is not absent: the field is on the wire.
        check(
            SignTx {
                address_n: PATH.to_vec(),
                body_size: 300,
                token_hint: Some(Vec::new()),
            },
            "08ac80808008089ec280800808808080800808808080800810ac021a00",
        );
        check(
            SignMessage {
                address_n: PATH.to_vec(),
                message: b"hello".to_vec(),
            },
            "08ac80808008089ec2808008088080808008088080808008120568656c6c6f",
        );
        check(
            MessageSignature {
                signature: vec![0x5A; 64],
            },
            &format!("0a40{}", "5a".repeat(64)),
        );
        check(
            SignEoaAuth {
                address_n: PATH.to_vec(),
                kind: 1,
                chain_id: 0xffff,
                fee_payer: vec![0x11; 32],
                account: vec![0x22; 32],
            },
            &format!(
                "08ac80808008089ec2808008088080808008088080808008100118ffff03\
                 2220{}2a20{}",
                "11".repeat(32),
                "22".repeat(32)
            ),
        );
        check(
            EoaAuthSignature {
                signature: vec![0x5A; 64],
            },
            &format!("0a40{}", "5a".repeat(64)),
        );
        check(
            TxDataAck {
                data: b"xyz".to_vec(),
            },
            "0a0378797a",
        );
    }

    #[test]
    fn wire_ids_are_the_protocol_ones() {
        assert_eq!(
            [
                ThpPairingRequest::ID,
                ThpSelectMethod::ID,
                ThpEndRequest::ID,
                ThpEndResponse::ID
            ],
            [1008, 1010, 1018, 1019]
        );
        assert_eq!(
            [
                ExtAppLoad::ID,
                ExtAppLoaded::ID,
                ExtAppMessage::ID,
                ExtAppResponse::ID
            ],
            [9200, 9201, 9208, 9209]
        );
        assert_eq!(
            [GetPublicKey::ID, PublicKey::ID, SignTx::ID, TxSignature::ID],
            [0, 1, 2, 5]
        );
        assert_eq!([SignMessage::ID, MessageSignature::ID], [6, 7]);
        assert_eq!([SignEoaAuth::ID, EoaAuthSignature::ID], [8, 9]);
    }
}
