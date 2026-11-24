//! The Trezor Host Protocol link: one encrypted channel to one device.
//!
//! The protocol itself (packets, checksums, the Noise handshake, the
//! acknowledgement bit) is Trezor's `trezor-thp` crate, which does no I/O.
//! This module moves its packets over a [`Transport`], waits for
//! acknowledgements, retransmits, and reassembles answers.

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use prost::Message as _;
use trezor_thp::channel::buffered::Buffered;
use trezor_thp::channel::host::{Channel, Mux};
use trezor_thp::channel::{PacketInResult, PairingState, Phase, retransmit_after_ms};
use trezor_thp::error::TransportError as ThpTransportError;
use trezor_thp::{Backend, ChannelIO};

use crate::credentials::HandshakeKeys;
use crate::error::{Result, TrezorError};
use crate::messages::ThpDeviceProperties;
use crate::transport::{PACKET_LEN, Transport};

/// How long the device may take to acknowledge a message before the link is
/// declared dead, retransmissions included.
const ACK_BUDGET: Duration = Duration::from_secs(8);
/// How long the device may take to answer a channel request or a handshake
/// message. A locked device that unlocks for the connection waits for its
/// user here.
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(60);
const ALLOCATION_TIMEOUT: Duration = Duration::from_secs(3);

/// How the link answers `TRANSPORT_BUSY`, which the device sends while another
/// channel is still active (for example a previous run of the CLI that has
/// not yet been dropped): wait, retransmit the outstanding message, and ask
/// again, as trezorlib does. The device drops a channel that has been silent
/// for a second, so a busy answer normally clears within that.
#[derive(Clone, Copy, Debug)]
struct BusyPolicy {
    /// The wait before the first retransmission; it doubles each time.
    first_wait: Duration,
    /// The longest single wait.
    longest_wait: Duration,
    /// Total time spent waiting on busy answers for one exchange before
    /// giving up.
    budget: Duration,
}

impl BusyPolicy {
    const DEFAULT: BusyPolicy = BusyPolicy {
        first_wait: Duration::from_millis(100),
        longest_wait: Duration::from_secs(2),
        budget: Duration::from_secs(30),
    };
}

const BUSY_GIVE_UP: &str = "the Trezor is busy with another connection; close other Trezor \
                            programs (or the previous thru command) or reconnect the device";

/// Cryptography of the channel: X25519, AES-256-GCM, SHA-256 (RustCrypto).
pub(crate) struct Crypto;

impl Backend for Crypto {
    // Tests run the same primitives through wrappers that script the random
    // keys and record the encryptions (`testing.rs`).
    #[cfg(not(test))]
    type DH = trezor_noise_rust_crypto::X25519;
    #[cfg(test)]
    type DH = crate::testing::Dh;
    #[cfg(not(test))]
    type Cipher = trezor_noise_rust_crypto::Aes256Gcm;
    #[cfg(test)]
    type Cipher = crate::testing::Recording;
    type Hash = trezor_noise_rust_crypto::Sha256;

    fn random_bytes(dest: &mut [u8]) {
        crate::random::fill(dest).expect("the operating system's random source failed");
    }
}

/// `trezor_thp::Error` derives `Debug` only in debug builds.
fn thp_error(e: trezor_thp::Error) -> TrezorError {
    use trezor_thp::Error as E;
    let text = match e {
        E::UnexpectedInput => "unexpected input",
        E::NotReady => "channel not ready",
        E::MalformedData => "malformed data",
        E::InvalidChecksum => "invalid checksum",
        E::InsufficientBuffer => "buffer too small",
        E::CryptoError => "cryptographic failure",
    };
    TrezorError::Protocol(text.into())
}

fn device_transport_error(e: ThpTransportError) -> TrezorError {
    match e {
        ThpTransportError::DeviceLocked => TrezorError::DeviceLocked,
        other => TrezorError::Protocol(format!("the device reported {}", other.as_str())),
    }
}

/// What a packet did to the channel.
#[derive(Default)]
struct Ingested {
    acknowledged: bool,
    /// The device answered `TRANSPORT_BUSY`: it did not take the message.
    busy: bool,
}

/// A `trezor-thp` channel object (in any of its three phases) with the state
/// the I/O loop needs.
struct Pump<C> {
    channel: Buffered<C>,
    /// A complete message waits in the channel's receive buffer.
    message_ready: bool,
    /// The waiting "message" is the channel allocation, which is not
    /// acknowledged.
    allocation: bool,
    busy_policy: BusyPolicy,
    /// When the current run of busy answers began, and the next wait.
    busy_since: Option<Instant>,
    busy_wait: Duration,
}

impl<C: ChannelIO> Pump<C> {
    fn new(channel: C) -> Self {
        let mut channel = Buffered::new(channel);
        channel.set_packet_len(PACKET_LEN);
        Pump {
            channel,
            message_ready: false,
            allocation: false,
            busy_policy: BusyPolicy::DEFAULT,
            busy_since: None,
            busy_wait: BusyPolicy::DEFAULT.first_wait,
        }
    }

    fn map<D: ChannelIO>(
        self,
        func: impl FnOnce(C) -> std::result::Result<D, trezor_thp::Error>,
    ) -> Result<Pump<D>> {
        Ok(Pump {
            channel: self.channel.map(func).map_err(thp_error)?,
            message_ready: false,
            allocation: false,
            busy_policy: self.busy_policy,
            busy_since: None,
            busy_wait: self.busy_policy.first_wait,
        })
    }

    /// Sends every packet the channel has ready: fragments of the message
    /// being sent, and acknowledgements.
    fn flush<T: Transport>(&mut self, transport: &mut T) -> Result<()> {
        while self.channel.packet_out_ready() {
            let packet = self.channel.packet_out().map_err(thp_error)?;
            transport.write_packet(&packet)?;
        }
        Ok(())
    }

    fn ingest(&mut self, packet: &[u8]) -> Result<Ingested> {
        match self.channel.packet_in(packet) {
            PacketInResult::Accepted {
                ack_received,
                message_ready,
                ..
            } => {
                if message_ready {
                    self.message_ready = true;
                }
                Ok(Ingested {
                    acknowledged: ack_received,
                    busy: false,
                })
            }
            PacketInResult::ChannelAllocation => {
                self.message_ready = true;
                self.allocation = true;
                Ok(Ingested::default())
            }
            // Recoverable for `trezor-thp`: the channel stays as it was, the
            // message still outstanding. The caller waits and retransmits.
            PacketInResult::TransportError {
                error: ThpTransportError::TransportBusy,
            } => Ok(Ingested {
                acknowledged: false,
                busy: true,
            }),
            PacketInResult::TransportError { error } => Err(device_transport_error(error)),
            PacketInResult::Failed { error } => Err(thp_error(error)),
            // Damaged packets and packets of other channels (a previous
            // connection's leftovers) are not ours to act on.
            _ => Ok(Ingested::default()),
        }
    }

    /// The device said `TRANSPORT_BUSY`: waits (backing off) and sends the
    /// outstanding message again. After the channel's recoverable error its
    /// send state is untouched, so `message_retransmit` re-arms the fragments
    /// of the message the device refused, whatever phase the channel is in
    /// (the handshake messages count too, though the channel reports them as
    /// sent). Gives up with an error a user can act on once the total wait
    /// would pass the budget.
    fn back_off_busy<T: Transport>(&mut self, transport: &mut T) -> Result<()> {
        let policy = self.busy_policy;
        let since = *self.busy_since.get_or_insert_with(Instant::now);
        let wait = self.busy_wait;
        if since.elapsed() + wait > policy.budget {
            return Err(TrezorError::Timeout(BUSY_GIVE_UP));
        }
        log::debug!("the Trezor is busy; retransmitting in {wait:?}");
        std::thread::sleep(wait);
        self.busy_wait = (wait * 2).min(policy.longest_wait);
        self.channel.message_retransmit().map_err(thp_error)?;
        self.flush(transport)
    }

    /// The exchange moved on: the next busy answer starts a new budget.
    fn busy_over(&mut self) {
        self.busy_since = None;
        self.busy_wait = self.busy_policy.first_wait;
    }

    /// Hands a message to the channel and sends it, retransmitting until the
    /// device acknowledges it.
    fn send<T: Transport>(
        &mut self,
        transport: &mut T,
        session: u8,
        message_type: u16,
        payload: &[u8],
    ) -> Result<()> {
        self.channel
            .message_in(session, message_type, payload)
            .map_err(thp_error)?;
        let mut started = Instant::now();
        let mut retry: u8 = 0;
        loop {
            self.flush(transport)?;
            // True once nothing is in flight: at once for a broadcast (the
            // channel request), which is not acknowledged.
            if self.channel.message_in_ready() {
                return Ok(());
            }
            let mut wait_until =
                Instant::now() + Duration::from_millis(retransmit_after_ms(retry).into());
            loop {
                let left = wait_until.saturating_duration_since(Instant::now());
                if left.is_zero() {
                    break;
                }
                let Some(packet) = transport.read_packet(left)? else {
                    break;
                };
                let ingested = self.ingest(&packet)?;
                if ingested.busy {
                    // The message is already retransmitted: restart both
                    // clocks, the busy wait is not the device failing to
                    // acknowledge.
                    self.back_off_busy(transport)?;
                    started = Instant::now();
                    retry = 0;
                    wait_until =
                        Instant::now() + Duration::from_millis(retransmit_after_ms(retry).into());
                    continue;
                }
                if ingested.acknowledged || self.channel.message_in_ready() {
                    self.busy_over();
                    return Ok(());
                }
            }
            if started.elapsed() > ACK_BUDGET {
                return Err(TrezorError::Timeout("the device stopped acknowledging"));
            }
            retry = retry.saturating_add(1);
            self.channel.message_retransmit().map_err(thp_error)?;
        }
    }

    /// Waits for the next complete message and acknowledges it.
    fn receive<T: Transport>(
        &mut self,
        transport: &mut T,
        timeout: Duration,
        waiting_for: &'static str,
    ) -> Result<(u8, u16, Vec<u8>)> {
        let deadline = Instant::now() + timeout;
        while !self.message_ready {
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() {
                return Err(TrezorError::Timeout(waiting_for));
            }
            if let Some(packet) = transport.read_packet(left.min(Duration::from_secs(1)))? {
                if self.ingest(&packet)?.busy {
                    // The message the device is answering was refused (the
                    // handshake messages are not waited on in `send`).
                    self.back_off_busy(transport)?;
                    continue;
                }
                if !self.allocation {
                    // A repeated message (our acknowledgement was lost) asks
                    // for its acknowledgement again.
                    self.flush(transport)?;
                }
            }
        }
        self.message_ready = false;
        self.busy_over();
        let allocation = std::mem::take(&mut self.allocation);
        let message = self.channel.message_out().map_err(thp_error)?;
        if !allocation {
            self.flush(transport)?;
        }
        Ok(message)
    }
}

/// What the device says about itself before the channel is encrypted.
#[derive(Clone, Debug)]
pub struct DeviceProperties {
    /// Internal model name, `T3W1` for the Safe 7.
    pub internal_model: String,
    pub protocol_version: (u32, u32),
    /// `ThpPairingMethod` values the device offers.
    pub pairing_methods: Vec<i32>,
}

/// An open, encrypted channel.
pub struct Link<T: Transport> {
    transport: T,
    pump: Pump<Channel<Crypto>>,
    properties: DeviceProperties,
    pairing_state: PairingState,
    keys: Arc<Mutex<HandshakeKeys>>,
}

impl<T: Transport> Link<T> {
    /// Allocates a channel and runs the handshake. `keys` holds the stored
    /// pairing credentials; afterwards it says which one the device
    /// recognised, if any.
    pub(crate) fn open(mut transport: T, keys: HandshakeKeys) -> Result<Self> {
        let keys = Arc::new(Mutex::new(keys));

        let mut mux = Mux::<Crypto>::new();
        // "Try to unlock": a locked device asks its user to unlock it for the
        // handshake instead of refusing.
        mux.request_channel(true);
        let mut pump = Pump::new(mux);
        pump.send(&mut transport, 0, 0, &[])?;
        pump.receive(&mut transport, ALLOCATION_TIMEOUT, "channel allocation")?;
        if !pump.channel.channel_alloc_ready() {
            return Err(TrezorError::Protocol("no channel was allocated".into()));
        }

        let store = crate::credentials::HandshakeStore(keys.clone());
        let mut pump = pump.map(|mux| mux.complete(store))?;
        let raw_properties = pump.channel.device_properties().to_vec();
        let decoded = ThpDeviceProperties::decode(raw_properties.as_slice())
            .map_err(|e| TrezorError::Unexpected(format!("device properties: {e}")))?;
        let properties = DeviceProperties {
            internal_model: decoded.internal_model,
            protocol_version: (
                decoded.protocol_version_major,
                decoded.protocol_version_minor,
            ),
            pairing_methods: decoded.pairing_methods,
        };
        if let (Ok(major), Ok(minor)) = (
            u8::try_from(properties.protocol_version.0),
            u8::try_from(properties.protocol_version.1),
        ) {
            pump.channel.set_device_protocol_version(major, minor);
        }
        // The handshake is two request/response rounds the channel object
        // produces and consumes itself; the messages passed here are empty.
        for _ in 0..2 {
            pump.send(&mut transport, 0, 0, &[])?;
            pump.receive(&mut transport, HANDSHAKE_TIMEOUT, "handshake")?;
        }
        if !pump.channel.handshake_done() {
            return Err(TrezorError::Protocol("the handshake did not finish".into()));
        }

        let pump = pump.map(|open| open.complete())?;
        let Phase::PairingCredential {
            handshake_pairing_state: pairing_state,
        } = pump.channel.phase()
        else {
            return Err(TrezorError::Protocol("unexpected channel phase".into()));
        };
        Ok(Link {
            transport,
            pump,
            properties,
            pairing_state,
            keys,
        })
    }

    pub fn properties(&self) -> &DeviceProperties {
        &self.properties
    }

    /// What the device's handshake answer says: this host is paired. Taken
    /// alone it is a claim; see [`Link::credential_matched`].
    pub(crate) fn is_paired(&self) -> bool {
        self.pairing_state.is_paired()
    }

    /// Whether the handshake sent a stored credential, that is, whether this
    /// computer has a record of the device. The device's own pairing state
    /// means something only if so.
    pub(crate) fn credential_matched(&self) -> bool {
        crate::credentials::lock_keys(&self.keys).credential_matched()
    }

    pub(crate) fn handshake_hash(&self) -> [u8; 32] {
        *self.pump.channel.handshake_hash()
    }

    /// The host's static private key of this channel.
    pub(crate) fn host_static_privkey(&self) -> [u8; 32] {
        crate::credentials::lock_keys(&self.keys).chosen_privkey()
    }

    /// Marks the end of the pairing phase: from here on the channel carries
    /// application messages.
    pub(crate) fn end_pairing(&mut self) {
        self.pump.channel.end_pairing();
    }

    pub(crate) fn send(&mut self, session: u8, message_type: u16, payload: &[u8]) -> Result<()> {
        self.pump
            .send(&mut self.transport, session, message_type, payload)
    }

    pub(crate) fn receive(
        &mut self,
        timeout: Duration,
        waiting_for: &'static str,
    ) -> Result<(u8, u16, Vec<u8>)> {
        self.pump.receive(&mut self.transport, timeout, waiting_for)
    }
}

#[cfg(test)]
mod tests {
    use std::collections::VecDeque;

    use trezor_thp::error::Result as ThpResult;

    use super::*;
    use crate::transport::TransportError;

    /// Packets of the fake: the first byte says what it is.
    const PACKET_BUSY: u8 = 1;
    const PACKET_ACK: u8 = 2;
    const PACKET_MESSAGE: u8 = 3;

    /// A channel that holds one outgoing message until it is acknowledged,
    /// as a `trezor-thp` channel does, and counts its retransmissions.
    /// `acked_by_sending` makes `message_in_ready` true while the message is
    /// still outstanding, as the channel object does throughout the handshake.
    #[derive(Default)]
    struct FakeChannel {
        in_flight: bool,
        fragments_left: u32,
        retransmissions: u32,
        acked_by_sending: bool,
        message_waiting: bool,
    }

    impl ChannelIO for FakeChannel {
        fn packet_in(
            &mut self,
            packet_buffer: &[u8],
            _receive_buffer: &mut [u8],
        ) -> PacketInResult {
            match packet_buffer[0] {
                // The recoverable error of `trezor-thp`: nothing changes.
                PACKET_BUSY => PacketInResult::TransportError {
                    error: ThpTransportError::TransportBusy,
                },
                PACKET_ACK => {
                    self.in_flight = false;
                    PacketInResult::Accepted {
                        ack_received: true,
                        message_ready: false,
                        pong: false,
                        buffer_size: None,
                    }
                }
                PACKET_MESSAGE => {
                    self.in_flight = false;
                    self.message_waiting = true;
                    PacketInResult::Accepted {
                        ack_received: false,
                        message_ready: true,
                        pong: false,
                        buffer_size: None,
                    }
                }
                _ => PacketInResult::TransportError {
                    error: ThpTransportError::DecryptionFailed,
                },
            }
        }

        fn packet_out(&mut self, packet_buffer: &mut [u8], _send_buffer: &[u8]) -> ThpResult<()> {
            if self.fragments_left == 0 {
                return Err(trezor_thp::Error::NotReady);
            }
            self.fragments_left -= 1;
            packet_buffer.fill(0);
            Ok(())
        }

        fn packet_out_ready(&self) -> bool {
            self.fragments_left > 0
        }

        fn message_in(&mut self, _plaintext_len: usize, _send_buffer: &mut [u8]) -> ThpResult<()> {
            self.in_flight = true;
            self.fragments_left = 1;
            Ok(())
        }

        fn message_in_ready(&self) -> bool {
            self.acked_by_sending || !self.in_flight
        }

        fn message_out<'a>(
            &mut self,
            receive_buffer: &'a mut [u8],
        ) -> ThpResult<(u8, u16, &'a [u8])> {
            self.message_waiting = false;
            Ok((1, 7, &receive_buffer[..0]))
        }

        fn message_out_ready(&self) -> bool {
            self.message_waiting
        }

        fn message_retransmit(&mut self) -> ThpResult<()> {
            if self.in_flight {
                self.retransmissions += 1;
                self.fragments_left = 1;
            }
            Ok(())
        }

        fn channel_id(&self) -> u16 {
            1
        }
    }

    /// A transport that answers each packet written with the next scripted
    /// reply (`None`: silence).
    struct ScriptedTransport {
        replies: VecDeque<Option<u8>>,
        queued: VecDeque<u8>,
        writes: usize,
    }

    impl ScriptedTransport {
        fn new(replies: &[Option<u8>]) -> Self {
            ScriptedTransport {
                replies: replies.iter().copied().collect(),
                queued: VecDeque::new(),
                writes: 0,
            }
        }
    }

    impl Transport for ScriptedTransport {
        fn write_packet(&mut self, packet: &[u8]) -> std::result::Result<(), TransportError> {
            assert_eq!(packet.len(), PACKET_LEN);
            self.writes += 1;
            if let Some(Some(reply)) = self.replies.pop_front() {
                self.queued.push_back(reply);
            }
            Ok(())
        }

        fn read_packet(
            &mut self,
            _timeout: Duration,
        ) -> std::result::Result<Option<Vec<u8>>, TransportError> {
            Ok(self.queued.pop_front().map(|kind| {
                let mut packet = vec![0u8; PACKET_LEN];
                packet[0] = kind;
                packet
            }))
        }
    }

    fn quick(budget_ms: u64) -> BusyPolicy {
        BusyPolicy {
            first_wait: Duration::from_millis(1),
            longest_wait: Duration::from_millis(4),
            budget: Duration::from_millis(budget_ms),
        }
    }

    fn pump(channel: FakeChannel, policy: BusyPolicy) -> Pump<FakeChannel> {
        let mut pump = Pump::new(channel);
        pump.busy_policy = policy;
        pump.busy_wait = policy.first_wait;
        pump
    }

    #[test]
    fn busy_answers_are_waited_out_and_the_message_is_sent_again() {
        let mut pump = pump(FakeChannel::default(), quick(5_000));
        // Written, busy; written again, busy; written again, acknowledged.
        let mut transport =
            ScriptedTransport::new(&[Some(PACKET_BUSY), Some(PACKET_BUSY), Some(PACKET_ACK)]);
        pump.send(&mut transport, 1, 9, b"hello").expect("sent");
        assert_eq!(transport.writes, 3);
        assert_eq!(pump.channel.retransmissions, 2);
        assert!(!pump.channel.in_flight);
        // The next exchange starts with a fresh budget and wait.
        assert!(pump.busy_since.is_none());
        assert_eq!(pump.busy_wait, Duration::from_millis(1));
    }

    #[test]
    fn busy_for_ever_ends_in_an_error_that_says_what_to_do() {
        let mut pump = pump(FakeChannel::default(), quick(30));
        let mut transport = ScriptedTransport::new(&[Some(PACKET_BUSY); 1000]);
        let error = pump
            .send(&mut transport, 1, 9, b"hello")
            .expect_err("never accepted");
        let TrezorError::Timeout(text) = error else {
            panic!("wrong error: {error}");
        };
        assert!(text.contains("busy with another connection"), "{text}");
        assert!(text.contains("close other Trezor programs"), "{text}");
        assert!(text.contains("reconnect"), "{text}");
        // Bounded: it did not retry a thousand times.
        assert!(transport.writes < 100, "{} writes", transport.writes);
    }

    /// The handshake: the channel calls the message sent at once
    /// (`message_in_ready`), and the busy answer arrives while the link waits
    /// for the device's reply.
    #[test]
    fn busy_during_the_handshake_retransmits_the_message_the_device_refused() {
        let channel = FakeChannel {
            acked_by_sending: true,
            ..FakeChannel::default()
        };
        let mut pump = pump(channel, quick(5_000));
        // The first write is refused, the second is answered.
        let mut transport = ScriptedTransport::new(&[Some(PACKET_BUSY), Some(PACKET_MESSAGE)]);
        pump.send(&mut transport, 0, 0, &[]).expect("sent");
        assert_eq!(transport.writes, 1, "the handshake send does not wait");
        let (session, message_type, payload) = pump
            .receive(&mut transport, Duration::from_secs(5), "handshake")
            .expect("answered after the retransmission");
        assert_eq!((session, message_type, payload.len()), (1, 7, 0));
        assert_eq!(transport.writes, 2);
        assert_eq!(pump.channel.retransmissions, 1);
    }

    #[test]
    fn busy_while_receiving_for_ever_gives_up_too() {
        let channel = FakeChannel {
            acked_by_sending: true,
            ..FakeChannel::default()
        };
        let mut pump = pump(channel, quick(30));
        let mut transport = ScriptedTransport::new(&[Some(PACKET_BUSY); 1000]);
        pump.send(&mut transport, 0, 0, &[]).expect("sent");
        let error = pump
            .receive(&mut transport, Duration::from_secs(5), "handshake")
            .expect_err("never answered");
        assert!(matches!(error, TrezorError::Timeout(t) if t.contains("busy")));
    }

    #[test]
    fn other_transport_errors_stay_fatal() {
        let mut pump = pump(FakeChannel::default(), quick(5_000));
        let mut transport = ScriptedTransport::new(&[Some(0xEE)]);
        let error = pump.send(&mut transport, 1, 9, b"x").expect_err("fatal");
        assert!(matches!(error, TrezorError::Protocol(m) if m.contains("DECRYPTION_FAILED")));
    }
}
