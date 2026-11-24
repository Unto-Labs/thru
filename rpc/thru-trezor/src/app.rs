//! The Thru app on the device: its public keys and its signatures.
//!
//! Every message of the app travels inside `ExtAppMessage` (host to app) and
//! `ExtAppResponse` (app to host); see `trezor/app-thru/protob/thru.proto`.

use thru_base::signer::EoaAuthKind;

use crate::client::Trezor;
use crate::error::{Result, TrezorError};
use crate::messages::{
    AppWire, EoaAuthSignature, ExtAppMessage, ExtAppResponse, GetPublicKey, MessageSignature,
    PublicKey, SignEoaAuth, SignMessage, SignTx, TxDataAck, TxDataRequest, TxSignature,
};
use crate::transport::Transport;

/// The most the app asks for in one piece (`CHUNK_MAX` in the app).
const CHUNK_MAX: u32 = 2048;
/// Length of an Ed25519 signature.
const SIGNATURE_LEN: usize = 64;
/// Length of a token hint.
pub const TOKEN_HINT_LEN: usize = 129;
/// Length of an Ed25519 public key.
const PUBLIC_KEY_LEN: usize = 32;

/// The Thru app loaded on a connected device.
pub struct ThruApp<T: Transport> {
    trezor: Trezor<T>,
    instance_id: u32,
}

impl<T: Transport> ThruApp<T> {
    /// Addresses the app loaded as `instance_id` (see [`crate::extapp::load`]).
    pub fn new(trezor: Trezor<T>, instance_id: u32) -> Self {
        ThruApp {
            trezor,
            instance_id,
        }
    }

    /// The connection, for calls outside the app.
    pub fn trezor_mut(&mut self) -> &mut Trezor<T> {
        &mut self.trezor
    }

    /// Sends one app message and returns the app's answer: its message id and
    /// payload.
    fn call_raw(&mut self, id: u32, data: Vec<u8>) -> Result<(u32, Vec<u8>)> {
        let request = ExtAppMessage {
            instance_id: self.instance_id,
            message_id: id,
            data,
        };
        // A `Failure` here is the app's (or Core's) answer to this request.
        let response: ExtAppResponse = self
            .trezor
            .call(&request)
            .map_err(TrezorError::into_app_refusal)?;
        Ok((response.message_id, response.data))
    }

    fn send<Q: AppWire>(&mut self, request: &Q) -> Result<(u32, Vec<u8>)> {
        self.call_raw(Q::ID, request.encode_to_vec())
    }

    /// The public key and the address at `path`. With `show_on_device` the
    /// device shows the address and waits for the user.
    pub fn public_key(
        &mut self,
        path: &[u32],
        show_on_device: bool,
    ) -> Result<([u8; PUBLIC_KEY_LEN], String)> {
        let (id, data) = self.send(&GetPublicKey {
            address_n: path.to_vec(),
            show_display: Some(show_on_device),
        })?;
        let answer: PublicKey = decode(id, &data)?;
        let key = <[u8; PUBLIC_KEY_LEN]>::try_from(answer.public_key.as_slice()).map_err(|_| {
            TrezorError::App(format!(
                "public key has {} bytes, not {PUBLIC_KEY_LEN}",
                answer.public_key.len()
            ))
        })?;
        Ok((key, answer.address))
    }

    /// Has the app sign the transaction `body` (the wire transaction without
    /// its trailing signature) with the key at `path`. The user reviews the
    /// transaction on the device first.
    ///
    /// `token_hint` is the 129-byte token hint the device checks against the
    /// transaction; it is passed on as it is.
    pub fn sign_transaction(
        &mut self,
        path: &[u32],
        body: &[u8],
        token_hint: Option<&[u8; TOKEN_HINT_LEN]>,
    ) -> Result<[u8; SIGNATURE_LEN]> {
        let body_size = u32::try_from(body.len())
            .map_err(|_| TrezorError::App("the transaction body is too long".into()))?;
        let first = self.send(&SignTx {
            address_n: path.to_vec(),
            body_size,
            token_hint: token_hint.map(|hint| hint.to_vec()),
        })?;
        stream_body(body, first, |ack| self.send(&ack))
    }

    /// Has the app sign the text `message` (`tn_msg_sign_v1__` domain) with
    /// the key at `path`. The user reviews it on the device first. The caller
    /// checks the length; the app accepts 1 to 512 bytes of text.
    pub fn sign_message(&mut self, path: &[u32], message: &[u8]) -> Result<[u8; SIGNATURE_LEN]> {
        let (id, data) = self.send(&SignMessage {
            address_n: path.to_vec(),
            message: message.to_vec(),
        })?;
        parse_message_signature(id, &data)
    }

    /// Has the app sign an EOA authorization of `kind` for `account` with the
    /// key at `path`. The user reviews it on the device first. The app
    /// refuses an `account` that is not the key at `path` and a zero chain id;
    /// the caller checks both first.
    pub fn sign_eoa_auth(
        &mut self,
        path: &[u32],
        kind: EoaAuthKind,
        chain_id: u16,
        fee_payer: &[u8; PUBLIC_KEY_LEN],
        account: &[u8; PUBLIC_KEY_LEN],
    ) -> Result<[u8; SIGNATURE_LEN]> {
        let (id, data) = self.send(&SignEoaAuth {
            address_n: path.to_vec(),
            kind: eoa_kind_code(kind),
            chain_id: u32::from(chain_id),
            fee_payer: fee_payer.to_vec(),
            account: account.to_vec(),
        })?;
        parse_eoa_auth_signature(id, &data)
    }
}

/// The app's number for an authorization kind.
fn eoa_kind_code(kind: EoaAuthKind) -> u32 {
    match kind {
        EoaAuthKind::Create => 0,
        EoaAuthKind::Delete => 1,
    }
}

/// Reads the app's answer to `SignMessage`.
fn parse_message_signature(id: u32, data: &[u8]) -> Result<[u8; SIGNATURE_LEN]> {
    let answer: MessageSignature = decode(id, data)?;
    <[u8; SIGNATURE_LEN]>::try_from(answer.signature.as_slice()).map_err(|_| {
        TrezorError::App(format!(
            "signature has {} bytes, not {SIGNATURE_LEN}",
            answer.signature.len()
        ))
    })
}

/// Reads the app's answer to `SignEoaAuth`.
fn parse_eoa_auth_signature(id: u32, data: &[u8]) -> Result<[u8; SIGNATURE_LEN]> {
    let answer: EoaAuthSignature = decode(id, data)?;
    <[u8; SIGNATURE_LEN]>::try_from(answer.signature.as_slice()).map_err(|_| {
        TrezorError::App(format!(
            "signature has {} bytes, not {SIGNATURE_LEN}",
            answer.signature.len()
        ))
    })
}

/// Answers the app's requests for pieces of `body` until it signs.
///
/// `first` is the app's answer to `SignTx`; `send_ack` sends one `TxDataAck`
/// and returns the app's next answer. Pieces are asked for in order, without
/// gaps, each at most [`CHUNK_MAX`], and the signature must come only after
/// the whole body was asked for.
fn stream_body(
    body: &[u8],
    first: (u32, Vec<u8>),
    mut send_ack: impl FnMut(TxDataAck) -> Result<(u32, Vec<u8>)>,
) -> Result<[u8; SIGNATURE_LEN]> {
    let body_size = u32::try_from(body.len())
        .map_err(|_| TrezorError::App("the transaction body is too long".into()))?;
    let mut next_offset: u32 = 0;
    let mut answer = first;
    loop {
        let (id, data) = answer;
        if id == TxSignature::ID {
            // A signature before the device asked for the whole body means it
            // signed (or claims to have signed) something it did not see in
            // full.
            if next_offset != body_size {
                return Err(TrezorError::App(format!(
                    "the device signed after asking for {next_offset} of {body_size} bytes"
                )));
            }
            let signature: TxSignature = decode(id, &data)?;
            return <[u8; SIGNATURE_LEN]>::try_from(signature.signature.as_slice()).map_err(|_| {
                TrezorError::App(format!(
                    "signature has {} bytes, not {SIGNATURE_LEN}",
                    signature.signature.len()
                ))
            });
        }
        let request: TxDataRequest = decode(id, &data)?;
        if request.offset != next_offset {
            return Err(TrezorError::App(format!(
                "asked for offset {} when {next_offset} is next",
                request.offset
            )));
        }
        if request.length == 0 || request.length > CHUNK_MAX {
            return Err(TrezorError::App(format!(
                "asked for a piece of {} bytes",
                request.length
            )));
        }
        let end = request
            .offset
            .checked_add(request.length)
            .filter(|end| *end <= body_size)
            .ok_or_else(|| {
                TrezorError::App(format!(
                    "asked for bytes {}..+{} of a body of {body_size}",
                    request.offset, request.length
                ))
            })?;
        // `end <= body_size == body.len()`, so the range is in bounds.
        let piece = &body[request.offset as usize..end as usize];
        next_offset = end;
        answer = send_ack(TxDataAck {
            data: piece.to_vec(),
        })?;
    }
}

/// Decodes the app's answer, which must be message `A`.
fn decode<A: AppWire>(id: u32, data: &[u8]) -> Result<A> {
    if id != A::ID {
        return Err(TrezorError::App(format!(
            "answered message {id}, expected {} ({})",
            A::NAME,
            A::ID
        )));
    }
    A::decode(data).map_err(|e| TrezorError::App(format!("{} could not be decoded: {e}", A::NAME)))
}

#[cfg(test)]
mod tests {
    use super::*;

    use prost::Message as _;

    fn request(offset: u32, length: u32) -> (u32, Vec<u8>) {
        (
            TxDataRequest::ID,
            TxDataRequest { offset, length }.encode_to_vec(),
        )
    }

    fn signature(bytes: usize) -> (u32, Vec<u8>) {
        (
            TxSignature::ID,
            TxSignature {
                signature: vec![7; bytes],
            }
            .encode_to_vec(),
        )
    }

    /// Plays the device's side from a script of answers, and records what the
    /// host sent.
    fn stream(
        body: &[u8],
        first: (u32, Vec<u8>),
        script: Vec<(u32, Vec<u8>)>,
    ) -> (Result<[u8; SIGNATURE_LEN]>, Vec<Vec<u8>>) {
        let mut script = script.into_iter();
        let mut sent = Vec::new();
        let result = stream_body(body, first, |ack| {
            sent.push(ack.data);
            script
                .next()
                .ok_or_else(|| TrezorError::App("script ended".into()))
        });
        (result, sent)
    }

    #[test]
    fn whole_body_then_signature() {
        let body: Vec<u8> = (0..10).collect();
        let (result, sent) = stream(
            &body,
            request(0, 4),
            vec![request(4, 4), request(8, 2), signature(64)],
        );
        assert_eq!(result.expect("signed"), [7; 64]);
        assert_eq!(
            sent,
            vec![
                body[0..4].to_vec(),
                body[4..8].to_vec(),
                body[8..10].to_vec()
            ]
        );
    }

    #[test]
    fn signature_before_the_whole_body_is_refused() {
        let body = vec![1u8; 10];
        // Straight away.
        let (result, sent) = stream(&body, signature(64), vec![]);
        assert!(matches!(result, Err(TrezorError::App(m)) if m.contains("0 of 10")));
        assert!(sent.is_empty());
        // After a part.
        let (result, _) = stream(&body, request(0, 4), vec![signature(64)]);
        assert!(matches!(result, Err(TrezorError::App(m)) if m.contains("4 of 10")));
    }

    #[test]
    fn out_of_order_oversized_and_overlong_requests_are_refused() {
        let body = vec![1u8; 10];
        for first in [
            request(2, 4),
            request(0, 0),
            request(0, CHUNK_MAX + 1),
            request(0, 11),
        ] {
            let (result, sent) = stream(&body, first, vec![]);
            assert!(matches!(result, Err(TrezorError::App(_))));
            assert!(sent.is_empty());
        }
    }

    #[test]
    fn short_signature_is_refused() {
        let (result, _) = stream(&[], signature(63), vec![]);
        assert!(matches!(result, Err(TrezorError::App(m)) if m.contains("63")));
    }

    #[test]
    fn empty_body_may_be_signed_at_once() {
        let (result, _) = stream(&[], signature(64), vec![]);
        assert_eq!(result.expect("signed"), [7; 64]);
    }

    #[test]
    fn message_signature_is_read() {
        let answer = |id, bytes| {
            parse_message_signature(
                id,
                &MessageSignature {
                    signature: vec![7; bytes],
                }
                .encode_to_vec(),
            )
        };
        assert_eq!(answer(MessageSignature::ID, 64).expect("ok"), [7; 64]);
        assert!(matches!(
            answer(MessageSignature::ID, 63),
            Err(TrezorError::App(m)) if m.contains("63")
        ));
        // A transaction signature is not an answer to SignMessage.
        assert!(matches!(
            answer(TxSignature::ID, 64),
            Err(TrezorError::App(m)) if m.contains("MessageSignature")
        ));
    }

    #[test]
    fn eoa_auth_signature_is_read() {
        let answer = |id, bytes| {
            parse_eoa_auth_signature(
                id,
                &EoaAuthSignature {
                    signature: vec![7; bytes],
                }
                .encode_to_vec(),
            )
        };
        assert_eq!(answer(EoaAuthSignature::ID, 64).expect("ok"), [7; 64]);
        assert!(matches!(
            answer(EoaAuthSignature::ID, 65),
            Err(TrezorError::App(m)) if m.contains("65")
        ));
        // A message signature is not an answer to SignEoaAuth.
        assert!(matches!(
            answer(MessageSignature::ID, 64),
            Err(TrezorError::App(m)) if m.contains("EoaAuthSignature")
        ));
    }

    #[test]
    fn kinds_have_the_apps_numbers() {
        assert_eq!(eoa_kind_code(EoaAuthKind::Create), 0);
        assert_eq!(eoa_kind_code(EoaAuthKind::Delete), 1);
    }

    #[test]
    fn wrong_answer_id_is_named() {
        let error = decode::<PublicKey>(5, &[]).expect_err("must fail");
        assert!(matches!(error, TrezorError::App(m) if m.contains("PublicKey")));
    }
}
