//! Turns a message of this crate into the JSON the vector file shows for its
//! fields, and finds a message by its wire id.
//!
//! Rules (also in the README): the keys are the protobuf field names; a field
//! that is absent (an optional one, or an empty repeated one) has no key; a
//! field that is present and empty (`""`, an empty byte string) has its key;
//! bytes are lowercase hex; 64-bit integers are decimal strings; a nested
//! message is an object.

use super::json::{Fields, J};
use crate::messages::*;

/// The fields of a message as JSON.
pub(super) trait Describe {
    fn fields(&self) -> J;
}

/// Field kinds: each turns a field into its JSON, or `None` when absent.
mod kind {
    use super::J;

    pub fn u32r(v: &u32) -> Option<J> {
        Some(J::num(*v))
    }
    pub fn u32o(v: &Option<u32>) -> Option<J> {
        v.map(J::num)
    }
    pub fn i32o(v: &Option<i32>) -> Option<J> {
        v.map(J::num)
    }
    pub fn i32r(v: &i32) -> Option<J> {
        Some(J::num(*v))
    }
    pub fn strr(v: &str) -> Option<J> {
        Some(J::str(v))
    }
    pub fn stro(v: &Option<String>) -> Option<J> {
        v.as_ref().map(|s| J::str(s.clone()))
    }
    pub fn bytesr(v: &Vec<u8>) -> Option<J> {
        Some(J::hex(v))
    }
    pub fn byteso(v: &Option<Vec<u8>>) -> Option<J> {
        v.as_ref().map(J::hex)
    }
    pub fn boolo(v: &Option<bool>) -> Option<J> {
        v.map(J::Bool)
    }
    pub fn u32rep(v: &[u32]) -> Option<J> {
        (!v.is_empty()).then(|| J::arr(v.iter().copied().map(J::num)))
    }
    pub fn i32rep(v: &[i32]) -> Option<J> {
        (!v.is_empty()).then(|| J::arr(v.iter().copied().map(J::num)))
    }
    pub fn sint64(v: &i64) -> Option<J> {
        Some(J::Str(v.to_string()))
    }
    pub fn version(v: &super::Version) -> Option<J> {
        Some(
            super::Fields::new()
                .put("major", J::num(v.major))
                .put("minor", J::num(v.minor))
                .pipe(|f| match v.patch {
                    Some(p) => f.put("patch", J::num(p)),
                    None => f,
                })
                .pipe(|f| match v.build {
                    Some(b) => f.put("build", J::num(b)),
                    None => f,
                })
                .done(),
        )
    }
}

impl Fields {
    fn pipe(self, f: impl FnOnce(Fields) -> Fields) -> Fields {
        f(self)
    }
}

macro_rules! describe {
    ($($ty:ident { $($field:ident : $kind:ident),* $(,)? })*) => {$(
        impl Describe for $ty {
            fn fields(&self) -> J {
                let f = Fields::new();
                $(let f = match kind::$kind(&self.$field) {
                    Some(value) => f.put(stringify!($field), value),
                    None => f,
                };)*
                f.done()
            }
        }
    )*};
}

describe! {
    Success { message: stro }
    Failure { code: i32o, message: stro }
    ButtonRequest { code: i32o, pages: u32o, name: stro }
    ButtonAck {}
    ThpDeviceProperties {
        internal_model: strr, model_variant: u32o, protocol_version_major: u32r,
        protocol_version_minor: u32r, pairing_methods: i32rep
    }
    ThpHandshakeCompletionReqNoisePayload { host_pairing_credential: byteso }
    ThpCreateNewSession { passphrase: stro, on_device: boolo, derive_cardano: boolo }
    ThpPairingRequest { host_name: strr, app_name: strr }
    ThpPairingRequestApproved {}
    ThpSelectMethod { selected_pairing_method: i32r }
    ThpCredentialRequest { host_static_public_key: bytesr, autoconnect: boolo, credential: byteso }
    ThpCredentialResponse { trezor_static_public_key: bytesr, credential: bytesr }
    ThpEndRequest {}
    ThpEndResponse {}
    ThpCodeEntryCommitment { commitment: bytesr }
    ThpCodeEntryChallenge { challenge: bytesr }
    ThpCodeEntryCpaceTrezor { cpace_trezor_public_key: bytesr }
    ThpCodeEntryCpaceHostTag { cpace_host_public_key: bytesr, tag: bytesr }
    ThpCodeEntrySecret { secret: bytesr }
    ExtAppLoad { id: strr, version: version, fingerprint: byteso }
    ExtAppLoaded { instance_id: u32r, version: version }
    ExtAppHeaderRequest {}
    ExtAppHeaderAck { header: bytesr, proof: bytesr, root_packet_timestamp: sint64 }
    ExtAppRootPacketRequest { app_ring: u32r }
    ExtAppRootPacketAck { root_packet: bytesr }
    ExtAppDataChunkRequest { index: u32r }
    ExtAppDataChunkAck { data: bytesr, hash: bytesr }
    ExtAppMessage { instance_id: u32r, message_id: u32r, data: bytesr }
    ExtAppResponse { message_id: u32r, data: bytesr }
    GetPublicKey { address_n: u32rep, show_display: boolo }
    PublicKey { public_key: bytesr, address: strr }
    SignTx { address_n: u32rep, body_size: u32r, token_hint: byteso }
    TxDataRequest { offset: u32r, length: u32r }
    TxDataAck { data: bytesr }
    TxSignature { signature: bytesr }
    SignMessage { address_n: u32rep, message: bytesr }
    MessageSignature { signature: bytesr }
    SignEoaAuth { address_n: u32rep, kind: u32r, chain_id: u32r, fee_payer: bytesr, account: bytesr }
    EoaAuthSignature { signature: bytesr }
}

/// A decoded message: its name, fields, and what it encodes back to.
pub(super) struct Decoded {
    pub name: &'static str,
    pub fields: J,
    pub reencoded: Vec<u8>,
}

fn decode_as<T: Describe + prost::Message + Default>(
    name: &'static str,
    payload: &[u8],
) -> Option<Decoded> {
    let message = T::decode(payload).ok()?;
    Some(Decoded {
        name,
        fields: message.fields(),
        reencoded: message.encode_to_vec(),
    })
}

macro_rules! registry {
    ($fn:ident, $id:ty, $trait:ident, [$($ty:ident),* $(,)?]) => {
        /// Decodes `payload` as the message with this id.
        pub(super) fn $fn(id: $id, payload: &[u8]) -> Option<Decoded> {
            $(if id == <$ty as $trait>::ID {
                return decode_as::<$ty>(<$ty as $trait>::NAME, payload);
            })*
            None
        }
    };
}

registry!(
    decode_wire,
    u16,
    Wire,
    [
        Success,
        Failure,
        ButtonRequest,
        ButtonAck,
        ThpCreateNewSession,
        ThpPairingRequest,
        ThpPairingRequestApproved,
        ThpSelectMethod,
        ThpCredentialRequest,
        ThpCredentialResponse,
        ThpEndRequest,
        ThpEndResponse,
        ThpCodeEntryCommitment,
        ThpCodeEntryChallenge,
        ThpCodeEntryCpaceTrezor,
        ThpCodeEntryCpaceHostTag,
        ThpCodeEntrySecret,
        ExtAppLoad,
        ExtAppLoaded,
        ExtAppHeaderRequest,
        ExtAppHeaderAck,
        ExtAppRootPacketRequest,
        ExtAppRootPacketAck,
        ExtAppDataChunkRequest,
        ExtAppDataChunkAck,
        ExtAppMessage,
        ExtAppResponse,
    ]
);

registry!(
    decode_app,
    u32,
    AppWire,
    [
        GetPublicKey,
        PublicKey,
        SignTx,
        TxDataRequest,
        TxDataAck,
        TxSignature,
        SignMessage,
        MessageSignature,
        SignEoaAuth,
        EoaAuthSignature,
    ]
);

/// Every message the vector file must show at least once, by name.
pub(super) const ALL_NAMES: &[&str] = &[
    "Success",
    "Failure",
    "ButtonRequest",
    "ButtonAck",
    "ThpCreateNewSession",
    "ThpPairingRequest",
    "ThpPairingRequestApproved",
    "ThpSelectMethod",
    "ThpCredentialRequest",
    "ThpCredentialResponse",
    "ThpEndRequest",
    "ThpEndResponse",
    "ThpCodeEntryCommitment",
    "ThpCodeEntryChallenge",
    "ThpCodeEntryCpaceTrezor",
    "ThpCodeEntryCpaceHostTag",
    "ThpCodeEntrySecret",
    "ExtAppLoad",
    "ExtAppLoaded",
    "ExtAppHeaderRequest",
    "ExtAppHeaderAck",
    "ExtAppRootPacketRequest",
    "ExtAppRootPacketAck",
    "ExtAppDataChunkRequest",
    "ExtAppDataChunkAck",
    "ExtAppMessage",
    "ExtAppResponse",
    "GetPublicKey",
    "PublicKey",
    "SignTx",
    "TxDataRequest",
    "TxDataAck",
    "TxSignature",
    "SignMessage",
    "MessageSignature",
    "SignEoaAuth",
    "EoaAuthSignature",
    "ThpDeviceProperties",
    "ThpHandshakeCompletionReqNoisePayload",
];

/// Who sends a message: the host or the device.
pub(super) fn sender(name: &str) -> &'static str {
    match name {
        "ButtonAck"
        | "ThpCreateNewSession"
        | "ThpPairingRequest"
        | "ThpSelectMethod"
        | "ThpCredentialRequest"
        | "ThpEndRequest"
        | "ThpCodeEntryChallenge"
        | "ThpCodeEntryCpaceHostTag"
        | "ExtAppLoad"
        | "ExtAppHeaderAck"
        | "ExtAppRootPacketAck"
        | "ExtAppDataChunkAck"
        | "ExtAppMessage"
        | "GetPublicKey"
        | "SignTx"
        | "TxDataAck"
        | "SignMessage"
        | "SignEoaAuth"
        | "ThpHandshakeCompletionReqNoisePayload" => "host",
        _ => "device",
    }
}
