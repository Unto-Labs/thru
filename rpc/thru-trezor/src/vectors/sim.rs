//! A simulated Trezor for the vector run: the device half of the Trezor Host
//! Protocol (`trezor-thp`'s own device channel code), a scripted pairing and
//! a scripted Thru app on top. It is a [`Transport`], so the host code under
//! test (`Link`, `Trezor::connect`, `load`, `ThruApp`) runs unchanged against
//! it. It answers every packet at once and never times out.

use std::collections::VecDeque;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use prost::Message as _;
use trezor_thp::channel::buffered::Buffered;
use trezor_thp::channel::device::{ChannelOpen, Mux};
use trezor_thp::channel::{PacketInResult, PairingState};
use trezor_thp::credential::CredentialVerifier;

use crate::client::{code_entry_code, code_entry_commitment, code_entry_tag};
use crate::cpace::cpace_with_key;
use crate::messages::*;
use crate::testing::{Role, as_role};
use crate::thp::Crypto;
use crate::transport::{PACKET_LEN, Transport, TransportError};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Dir {
    HostToDevice,
    DeviceToHost,
}

/// A credential the simulated device already issued.
#[derive(Clone, Debug)]
pub(super) struct KnownCredential {
    pub host_static_pubkey: [u8; 32],
    pub blob: Vec<u8>,
}

/// What the simulated device is.
#[derive(Clone)]
pub(super) struct DeviceConfig {
    pub channel_id: u16,
    pub static_privkey: [u8; 32],
    /// The `ThpDeviceProperties` the device sends with the channel allocation.
    pub properties: Vec<u8>,
    /// The secret of the code-entry commitment.
    pub code_secret: [u8; 16],
    /// The device's CPace private scalar.
    pub cpace_private_key: [u8; 32],
    /// The credential the device hands out when asked.
    pub issue_blob: Vec<u8>,
    /// A credential it recognises in the handshake, if any.
    pub known: Option<KnownCredential>,
    /// The Thru app is already held (the load answers at once).
    pub app_held: bool,
    pub app_instance_id: u32,
    pub app_public_key: [u8; 32],
    pub app_signature: [u8; 64],
    /// Chunks of the app image the device will ask for.
    pub chunks: u32,
}

/// What the run observed, shared with the test.
#[derive(Default)]
pub(super) struct Shared {
    pub packets: Vec<(Dir, Vec<u8>)>,
    /// Decrypted messages, both directions, in order: (direction, session,
    /// message type, payload).
    pub messages: Vec<(Dir, u8, u16, Vec<u8>)>,
    pub handshake_hash: Option<[u8; 32]>,
    pub code: Option<String>,
    /// The credential blob and host key the device issued during pairing.
    pub issued: Option<KnownCredential>,
    /// What the credential verifier saw and answered, per handshake.
    pub verified: Vec<(Vec<u8>, Vec<u8>, u8)>,
    /// Index into `packets` where the handshake completion response was sent.
    pub handshake_done_at: Option<usize>,
}

pub(super) type SharedRef = Arc<Mutex<Shared>>;

pub(super) fn lock(shared: &SharedRef) -> MutexGuard<'_, Shared> {
    shared.lock().unwrap_or_else(|e| e.into_inner())
}

struct Verifier {
    known: Option<KnownCredential>,
    shared: SharedRef,
}

impl CredentialVerifier for Verifier {
    fn verify(&self, remote_static_pubkey: &[u8], credential: &[u8]) -> PairingState {
        let presented = ThpHandshakeCompletionReqNoisePayload::decode(credential)
            .ok()
            .and_then(|payload| payload.host_pairing_credential);
        let state = match (&self.known, presented.as_deref()) {
            (Some(known), Some(blob))
                if blob == known.blob.as_slice()
                    && remote_static_pubkey == known.host_static_pubkey =>
            {
                PairingState::Paired
            }
            _ => PairingState::Unpaired,
        };
        lock(&self.shared).verified.push((
            remote_static_pubkey.to_vec(),
            presented.unwrap_or_default(),
            state as u8,
        ));
        state
    }
}

type DChannel = trezor_thp::channel::device::Channel<Crypto>;

enum State {
    Mux(Buffered<Mux<Crypto>>),
    Open(Box<Buffered<ChannelOpen<Verifier, Crypto>>>),
    Channel(Buffered<DChannel>),
    Gone,
}

pub(super) struct SimDevice {
    config: DeviceConfig,
    shared: SharedRef,
    state: State,
    out: VecDeque<Vec<u8>>,
    /// A message to send after the host's next `ButtonAck`.
    after_ack: Option<(u8, u16, Vec<u8>)>,
    challenge: Vec<u8>,
    chunk_index: u32,
    /// Body of the transaction being signed: bytes still to ask for.
    sign_total: u32,
    sign_asked: u32,
    silent_reads: u32,
}

impl SimDevice {
    pub(super) fn new(config: DeviceConfig, shared: SharedRef) -> Self {
        let mux = Mux::<Crypto>::new(&config.properties).expect("device properties fit");
        let mut mux = Buffered::new(mux);
        mux.set_packet_len(PACKET_LEN);
        SimDevice {
            config,
            shared,
            state: State::Mux(mux),
            out: VecDeque::new(),
            after_ack: None,
            challenge: Vec::new(),
            chunk_index: 0,
            sign_total: 0,
            sign_asked: 0,
            silent_reads: 0,
        }
    }

    fn emit(&mut self, packets: Vec<Vec<u8>>) {
        let mut shared = lock(&self.shared);
        for packet in packets {
            shared.packets.push((Dir::DeviceToHost, packet.clone()));
            self.out.push_back(packet);
        }
    }

    fn handle(&mut self, packet: &[u8]) {
        let mut state = std::mem::replace(&mut self.state, State::Gone);
        let mut out = Vec::new();
        state = match state {
            State::Mux(mut mux) => {
                let result = mux.packet_in(packet);
                if matches!(result, PacketInResult::ChannelAllocation) {
                    let verifier = Verifier {
                        known: self.config.known.clone(),
                        shared: self.shared.clone(),
                    };
                    let open = mux
                        .channel_alloc(self.config.channel_id, verifier)
                        .expect("channel allocation");
                    let mut open = Buffered::new(open);
                    open.set_packet_len(PACKET_LEN);
                    drain(&mut open, &mut out);
                    State::Open(Box::new(open))
                } else {
                    drain(&mut mux, &mut out);
                    State::Mux(mux)
                }
            }
            State::Open(mut open) => {
                let result = open.packet_in(packet);
                if matches!(result, PacketInResult::HandshakeKeyRequired { .. }) {
                    open.set_static_key(&self.config.static_privkey)
                        .expect("static key");
                }
                if matches!(result, PacketInResult::Failed { .. }) {
                    panic!("the simulated device's handshake failed");
                }
                drain(&mut open, &mut out);
                if open.handshake_done() {
                    let mut shared = lock(&self.shared);
                    let done_at = shared.packets.len() + out.len();
                    shared.handshake_done_at = Some(done_at);
                    drop(shared);
                    let channel = (*open)
                        .map(|open| open.complete())
                        .expect("handshake complete");
                    lock(&self.shared).handshake_hash = Some(*channel.handshake_hash());
                    State::Channel(channel)
                } else {
                    State::Open(open)
                }
            }
            State::Channel(mut channel) => {
                let result = channel.packet_in(packet);
                if let PacketInResult::Failed { .. } = result {
                    panic!("the simulated device's channel failed");
                }
                drain(&mut channel, &mut out);
                if result.got_message() {
                    let (session, id, payload) = channel.message_out().expect("message");
                    lock(&self.shared).messages.push((
                        Dir::HostToDevice,
                        session,
                        id,
                        payload.clone(),
                    ));
                    // The acknowledgement of the message goes first.
                    drain(&mut channel, &mut out);
                    if let Some((reply_session, reply_id, reply)) =
                        self.respond(session, id, &payload)
                    {
                        if reply_id == ThpEndResponse::ID {
                            channel.end_pairing();
                        }
                        lock(&self.shared).messages.push((
                            Dir::DeviceToHost,
                            reply_session,
                            reply_id,
                            reply.clone(),
                        ));
                        channel
                            .message_in(reply_session, reply_id, &reply)
                            .expect("reply");
                        drain(&mut channel, &mut out);
                    }
                }
                State::Channel(channel)
            }
            State::Gone => panic!("the simulated device was left in no state"),
        };
        self.state = state;
        self.emit(out);
    }

    /// The device's answer to one message.
    fn respond(&mut self, session: u8, id: u16, payload: &[u8]) -> Option<(u8, u16, Vec<u8>)> {
        let cfg = self.config.clone();
        let hash = lock(&self.shared).handshake_hash.expect("handshake hash");
        let reply = |id: u16, body: Vec<u8>| Some((session, id, body));
        match id {
            ThpPairingRequest::ID => reply(
                ThpPairingRequestApproved::ID,
                ThpPairingRequestApproved {}.encode_to_vec(),
            ),
            ThpSelectMethod::ID => reply(
                ThpCodeEntryCommitment::ID,
                ThpCodeEntryCommitment {
                    commitment: code_entry_commitment(&cfg.code_secret).to_vec(),
                }
                .encode_to_vec(),
            ),
            ThpCodeEntryChallenge::ID => {
                let challenge = ThpCodeEntryChallenge::decode(payload).expect("challenge");
                self.challenge = challenge.challenge;
                let code = code_entry_code(&hash, &cfg.code_secret, &self.challenge);
                // The device's CPace public key is X25519 of its scalar with
                // the same generator the host derives; `cpace_with_key` returns
                // exactly that as its "host public key".
                let base = x25519_dalek::X25519_BASEPOINT_BYTES;
                let key = cpace_with_key(code.as_bytes(), &hash, &base, cfg.cpace_private_key)
                    .expect("device CPace");
                lock(&self.shared).code = Some(code);
                reply(
                    ThpCodeEntryCpaceTrezor::ID,
                    ThpCodeEntryCpaceTrezor {
                        cpace_trezor_public_key: key.host_public_key.to_vec(),
                    }
                    .encode_to_vec(),
                )
            }
            ThpCodeEntryCpaceHostTag::ID => {
                let tag = ThpCodeEntryCpaceHostTag::decode(payload).expect("host tag");
                let host_key: [u8; 32] = tag
                    .cpace_host_public_key
                    .as_slice()
                    .try_into()
                    .expect("host CPace key");
                let shared = x25519_dalek::x25519(cfg.cpace_private_key, host_key);
                if code_entry_tag(&shared) != tag.tag {
                    return reply(
                        Failure::ID,
                        Failure {
                            code: Some(3),
                            message: Some("Unexpected Code Entry Tag".into()),
                        }
                        .encode_to_vec(),
                    );
                }
                reply(
                    ThpCodeEntrySecret::ID,
                    ThpCodeEntrySecret {
                        secret: cfg.code_secret.to_vec(),
                    }
                    .encode_to_vec(),
                )
            }
            ThpCredentialRequest::ID => {
                let request = ThpCredentialRequest::decode(payload).expect("credential request");
                lock(&self.shared).issued = Some(KnownCredential {
                    host_static_pubkey: request
                        .host_static_public_key
                        .as_slice()
                        .try_into()
                        .expect("host key"),
                    blob: cfg.issue_blob.clone(),
                });
                let device_public =
                    x25519_dalek::x25519(cfg.static_privkey, x25519_dalek::X25519_BASEPOINT_BYTES);
                reply(
                    ThpCredentialResponse::ID,
                    ThpCredentialResponse {
                        trezor_static_public_key: device_public.to_vec(),
                        credential: cfg.issue_blob,
                    }
                    .encode_to_vec(),
                )
            }
            ThpEndRequest::ID => reply(ThpEndResponse::ID, ThpEndResponse {}.encode_to_vec()),
            ThpCreateNewSession::ID => {
                let request = ThpCreateNewSession::decode(payload).expect("session request");
                let success = (
                    session,
                    Success::ID,
                    Success { message: None }.encode_to_vec(),
                );
                if request.on_device == Some(true) {
                    self.after_ack = Some(success);
                    reply(
                        ButtonRequest::ID,
                        ButtonRequest {
                            code: Some(crate::messages::button_request_type::PASSPHRASE_ENTRY),
                            pages: None,
                            name: None,
                        }
                        .encode_to_vec(),
                    )
                } else {
                    Some(success)
                }
            }
            ButtonAck::ID => self.after_ack.take(),
            ExtAppLoad::ID => {
                if cfg.app_held {
                    reply(ExtAppLoaded::ID, self.loaded())
                } else {
                    self.chunk_index = 0;
                    reply(
                        ExtAppHeaderRequest::ID,
                        ExtAppHeaderRequest {}.encode_to_vec(),
                    )
                }
            }
            ExtAppHeaderAck::ID => reply(
                ExtAppRootPacketRequest::ID,
                ExtAppRootPacketRequest { app_ring: 2 }.encode_to_vec(),
            ),
            ExtAppRootPacketAck::ID => self.next_chunk(session),
            ExtAppDataChunkAck::ID => self.next_chunk(session),
            ExtAppMessage::ID => {
                let message = ExtAppMessage::decode(payload).expect("app message");
                match self.app(message.message_id, &message.data, session)? {
                    AppAnswer::Button(body) => reply(ButtonRequest::ID, body),
                    AppAnswer::App(answer_id, answer) => reply(
                        ExtAppResponse::ID,
                        ExtAppResponse {
                            message_id: answer_id,
                            data: answer,
                        }
                        .encode_to_vec(),
                    ),
                }
            }
            other => panic!("the simulated device does not know message {other}"),
        }
    }

    fn loaded(&self) -> Vec<u8> {
        ExtAppLoaded {
            instance_id: self.config.app_instance_id,
            version: Version {
                major: 0,
                minor: 1,
                patch: Some(1),
                build: Some(0),
            },
        }
        .encode_to_vec()
    }

    fn next_chunk(&mut self, session: u8) -> Option<(u8, u16, Vec<u8>)> {
        if self.chunk_index < self.config.chunks {
            let index = self.chunk_index;
            self.chunk_index += 1;
            Some((
                session,
                ExtAppDataChunkRequest::ID,
                ExtAppDataChunkRequest { index }.encode_to_vec(),
            ))
        } else {
            Some((session, ExtAppLoaded::ID, self.loaded()))
        }
    }

    /// The Thru app's answer. A request that needs a confirmation first
    /// answers with a `ButtonRequest` and keeps the real answer for the
    /// `ButtonAck`.
    fn app(&mut self, message_id: u32, data: &[u8], session: u8) -> Option<AppAnswer> {
        let cfg = &self.config;
        let signature = cfg.app_signature.to_vec();
        match message_id {
            GetPublicKey::ID => {
                let address =
                    thru_base::tn_public_address::tn_pubkey_to_address_string(&cfg.app_public_key);
                Some(AppAnswer::App(
                    PublicKey::ID,
                    PublicKey {
                        public_key: cfg.app_public_key.to_vec(),
                        address,
                    }
                    .encode_to_vec(),
                ))
            }
            SignTx::ID => {
                let request = SignTx::decode(data).expect("SignTx");
                self.sign_total = request.body_size;
                self.sign_asked = 0;
                Some(self.ask_body())
            }
            TxDataAck::ID => {
                let ack = TxDataAck::decode(data).expect("TxDataAck");
                self.sign_asked += u32::try_from(ack.data.len()).expect("length");
                if self.sign_asked < self.sign_total {
                    Some(self.ask_body())
                } else {
                    Some(AppAnswer::App(
                        TxSignature::ID,
                        TxSignature { signature }.encode_to_vec(),
                    ))
                }
            }
            SignMessage::ID => {
                // A confirmation first, as the real app does: the answer
                // waits for the host's `ButtonAck`.
                self.after_ack = Some((
                    session,
                    ExtAppResponse::ID,
                    ExtAppResponse {
                        message_id: MessageSignature::ID,
                        data: MessageSignature { signature }.encode_to_vec(),
                    }
                    .encode_to_vec(),
                ));
                Some(AppAnswer::Button(
                    ButtonRequest {
                        code: Some(1),
                        pages: Some(2),
                        name: Some("sign_message".into()),
                    }
                    .encode_to_vec(),
                ))
            }
            SignEoaAuth::ID => Some(AppAnswer::App(
                EoaAuthSignature::ID,
                EoaAuthSignature { signature }.encode_to_vec(),
            )),
            other => panic!("the simulated app does not know message {other}"),
        }
    }

    fn ask_body(&self) -> AppAnswer {
        let length = (self.sign_total - self.sign_asked).min(2048);
        AppAnswer::App(
            TxDataRequest::ID,
            TxDataRequest {
                offset: self.sign_asked,
                length,
            }
            .encode_to_vec(),
        )
    }
}

enum AppAnswer {
    App(u32, Vec<u8>),
    Button(Vec<u8>),
}

fn drain<C: trezor_thp::ChannelIO>(channel: &mut Buffered<C>, out: &mut Vec<Vec<u8>>) {
    while channel.packet_out_ready() {
        out.push(channel.packet_out().expect("packet"));
    }
}

impl Transport for SimDevice {
    fn write_packet(&mut self, packet: &[u8]) -> Result<(), TransportError> {
        assert_eq!(packet.len(), PACKET_LEN);
        lock(&self.shared)
            .packets
            .push((Dir::HostToDevice, packet.to_vec()));
        as_role(Role::Device, || self.handle(packet));
        Ok(())
    }

    fn read_packet(&mut self, _timeout: Duration) -> Result<Option<Vec<u8>>, TransportError> {
        let packet = self.out.pop_front();
        if packet.is_some() {
            self.silent_reads = 0;
        } else {
            self.silent_reads += 1;
            assert!(
                self.silent_reads < 50,
                "the host is waiting for a device that has nothing to say"
            );
        }
        Ok(packet)
    }
}
