//! The older Trezor wire protocol ("codec v1") that every Trezor before the
//! Safe 7 speaks: framing of a message into 64-byte packets, and the
//! reassembly of the device's answers. Nothing in it is encrypted or
//! authenticated.
//!
//! A message is `type: u16, length: u32` (big endian) followed by the
//! payload. The first packet carries `?##` before that header, every later
//! packet `?` before the next part of the payload; the last packet is padded
//! with zeros.

use std::time::{Duration, Instant};

use crate::error::{Result, TrezorError};
use crate::transport::{PACKET_LEN, Transport};

/// The most bytes of payload this host accepts in one message from the
/// device. The length field has 32 bits and nothing in the framing limits it,
/// so a device (or whatever poses as one) could announce gigabytes. The
/// messages this host reads (`Features`, `Failure`, the button, passphrase
/// and app-loading requests, the Thru app's answers) are a few hundred
/// bytes; the device's own receive buffer holds 8192
/// (`core/src/trezor/wire/__init__.py`), and 16 KiB is twice that.
pub(crate) const MAX_MESSAGE_LEN: usize = 16 * 1024;

/// First byte of every packet.
const MARKER: u8 = b'?';
/// The two bytes after the marker that start a message.
const MAGIC: [u8; 2] = *b"##";
/// `?`, `##`, the type (2 bytes) and the length (4 bytes).
const HEADER_LEN: usize = 9;

/// The packets that carry `message_type` and `payload`.
pub(crate) fn encode(message_type: u16, payload: &[u8]) -> Result<Vec<[u8; PACKET_LEN]>> {
    let length = u32::try_from(payload.len())
        .map_err(|_| TrezorError::InvalidRequest("a message of more than 4 GiB".into()))?;
    let mut bytes = Vec::with_capacity(HEADER_LEN + payload.len());
    bytes.push(MARKER);
    bytes.extend_from_slice(&MAGIC);
    bytes.extend_from_slice(&message_type.to_be_bytes());
    bytes.extend_from_slice(&length.to_be_bytes());
    bytes.extend_from_slice(payload);

    let mut packets = Vec::new();
    let mut rest = bytes.as_slice();
    // The first packet is the start of `bytes` as it is; every later one
    // gets the marker in front of the next 63 bytes.
    let take = rest.len().min(PACKET_LEN);
    let mut first = [0u8; PACKET_LEN];
    first[..take].copy_from_slice(&rest[..take]);
    packets.push(first);
    rest = &rest[take..];
    while !rest.is_empty() {
        let take = rest.len().min(PACKET_LEN - 1);
        let mut packet = [0u8; PACKET_LEN];
        packet[0] = MARKER;
        packet[1..=take].copy_from_slice(&rest[..take]);
        packets.push(packet);
        rest = &rest[take..];
    }
    Ok(packets)
}

/// Sends one message.
pub(crate) fn write_message<T: Transport>(
    transport: &mut T,
    message_type: u16,
    payload: &[u8],
) -> Result<()> {
    for packet in encode(message_type, payload)? {
        transport.write_packet(&packet)?;
    }
    Ok(())
}

/// Waits up to `timeout` for the next whole message and returns its type and
/// payload; `waiting_for` says what was awaited if nothing came.
///
/// With `skip_stray`, packets that do not start a message (left over from an
/// earlier conversation, or in another protocol's framing) are ignored, as
/// trezorlib's probe does; without it they are a protocol error. A message
/// whose announced length is over [`MAX_MESSAGE_LEN`] is refused before any
/// of it is kept.
pub(crate) fn read_message<T: Transport>(
    transport: &mut T,
    timeout: Duration,
    waiting_for: &'static str,
    skip_stray: bool,
) -> Result<(u16, Vec<u8>)> {
    let deadline = Instant::now() + timeout;
    let next_packet = |transport: &mut T| -> Result<Vec<u8>> {
        loop {
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() {
                return Err(TrezorError::Timeout(waiting_for));
            }
            if let Some(packet) = transport.read_packet(left.min(Duration::from_secs(1)))? {
                return Ok(packet);
            }
        }
    };

    // The first packet of a message.
    let (message_type, length, mut payload) = loop {
        let packet = next_packet(transport)?;
        if packet.len() < HEADER_LEN || packet[0] != MARKER || packet[1..3] != MAGIC {
            if skip_stray {
                continue;
            }
            return Err(TrezorError::Protocol(
                "the device sent a packet that does not start a message".into(),
            ));
        }
        let message_type = u16::from_be_bytes([packet[3], packet[4]]);
        let announced = u32::from_be_bytes([packet[5], packet[6], packet[7], packet[8]]);
        let length = match usize::try_from(announced) {
            Ok(length) if length <= MAX_MESSAGE_LEN => length,
            _ => {
                return Err(TrezorError::Protocol(format!(
                    "the device announced a message of {announced} bytes; this host accepts at \
                     most {MAX_MESSAGE_LEN}"
                )));
            }
        };
        let mut payload = Vec::with_capacity(length);
        payload.extend_from_slice(&packet[HEADER_LEN..packet.len().min(HEADER_LEN + length)]);
        break (message_type, length, payload);
    };

    // The continuation packets.
    while payload.len() < length {
        let packet = next_packet(transport)?;
        if packet.first() != Some(&MARKER) {
            if skip_stray {
                continue;
            }
            return Err(TrezorError::Protocol(
                "the device sent a packet that does not continue the message".into(),
            ));
        }
        let wanted = length - payload.len();
        payload.extend_from_slice(&packet[1..packet.len().min(1 + wanted)]);
    }
    Ok((message_type, payload))
}

#[cfg(test)]
mod tests {
    use std::collections::VecDeque;

    use super::*;
    use crate::transport::TransportError;

    /// A transport that hands out the packets it was given and records what
    /// is written.
    pub(crate) struct Packets {
        pub incoming: VecDeque<Vec<u8>>,
        pub written: Vec<Vec<u8>>,
    }

    impl Packets {
        pub(crate) fn new(incoming: Vec<Vec<u8>>) -> Self {
            Packets {
                incoming: incoming.into(),
                written: Vec::new(),
            }
        }
    }

    impl Transport for Packets {
        fn write_packet(&mut self, packet: &[u8]) -> std::result::Result<(), TransportError> {
            assert_eq!(packet.len(), PACKET_LEN);
            self.written.push(packet.to_vec());
            Ok(())
        }

        fn read_packet(
            &mut self,
            _timeout: Duration,
        ) -> std::result::Result<Option<Vec<u8>>, TransportError> {
            Ok(self.incoming.pop_front())
        }
    }

    fn packets(message_type: u16, payload: &[u8]) -> Vec<Vec<u8>> {
        encode(message_type, payload)
            .expect("encodes")
            .iter()
            .map(|packet| packet.to_vec())
            .collect()
    }

    const SHORT: Duration = Duration::from_millis(50);

    #[test]
    fn a_short_message_is_one_padded_packet() {
        let packets = encode(20, &[]).expect("encodes");
        assert_eq!(packets.len(), 1);
        // `?##`, type 20, length 0, zeros.
        assert_eq!(hex::encode(&packets[0][..9]), "3f2323001400000000");
        assert!(packets[0][9..].iter().all(|b| *b == 0));
    }

    #[test]
    fn the_failure_a_thp_device_answers_a_probe_with_is_a_whole_message() {
        // `core`'s constant answer (trezor-thp, `CODEC_V1_RESPONSE`).
        let mut packet = b"?##\x00\x03\x00\x00\x00\x02\x08\x11".to_vec();
        packet.resize(PACKET_LEN, 0);
        let mut transport = Packets::new(vec![packet]);
        let (id, payload) = read_message(&mut transport, SHORT, "x", false).expect("read");
        assert_eq!((id, payload), (3, vec![0x08, 0x11]));
    }

    #[test]
    fn a_message_over_several_packets_comes_back_whole() {
        for length in [54, 55, 56, 117, 118, 119, 120, 1000, 8192, MAX_MESSAGE_LEN] {
            let payload: Vec<u8> = (0..length).map(|i| (i % 251) as u8).collect();
            let mut transport = Packets::new(packets(9201, &payload));
            let (id, got) = read_message(&mut transport, SHORT, "x", false).expect("read");
            assert_eq!(id, 9201);
            assert_eq!(got, payload, "length {length}");
            assert!(
                transport.incoming.is_empty(),
                "length {length}: all packets used"
            );
        }
    }

    #[test]
    fn continuation_packets_carry_the_marker_and_63_bytes() {
        let payload = vec![0xAB; 55 + 63 + 1];
        let packets = encode(1, &payload).expect("encodes");
        assert_eq!(packets.len(), 3);
        assert_eq!(&packets[0][..3], b"?##");
        assert_eq!(packets[1][0], b'?');
        assert!(packets[1][1..].iter().all(|b| *b == 0xAB));
        assert_eq!(packets[2][0], b'?');
        assert_eq!(packets[2][1], 0xAB);
        assert!(packets[2][2..].iter().all(|b| *b == 0));
    }

    #[test]
    fn a_declared_length_over_the_bound_is_refused_at_once() {
        for announced in [MAX_MESSAGE_LEN as u32 + 1, 0x00ff_ffff, u32::MAX] {
            let mut packet = b"?##\x00\x11".to_vec();
            packet.extend_from_slice(&announced.to_be_bytes());
            packet.resize(PACKET_LEN, 0);
            // Nothing follows: the host must not wait for the rest.
            let mut transport = Packets::new(vec![packet]);
            let error = read_message(&mut transport, SHORT, "x", false).expect_err("refused");
            let TrezorError::Protocol(text) = error else {
                panic!("wrong error: {error}");
            };
            assert!(text.contains(&announced.to_string()), "{text}");
            assert!(text.contains(&MAX_MESSAGE_LEN.to_string()), "{text}");
        }
        // The bound itself is fine (tested above); one more is not.
        assert_eq!(MAX_MESSAGE_LEN, 16384);
    }

    #[test]
    fn a_missing_continuation_times_out() {
        let mut packets = packets(1, &[7; 100]);
        packets.pop();
        let mut transport = Packets::new(packets);
        let error = read_message(&mut transport, SHORT, "the rest", false).expect_err("times out");
        assert!(matches!(error, TrezorError::Timeout("the rest")), "{error}");
    }

    #[test]
    fn stray_packets_are_a_protocol_error_unless_skipped() {
        let stray = vec![0x04; PACKET_LEN];
        let good = packets(2, &[1, 2, 3]);
        let mut input = vec![stray.clone()];
        input.extend(good.clone());

        let mut strict = Packets::new(input.clone());
        assert!(matches!(
            read_message(&mut strict, SHORT, "x", false),
            Err(TrezorError::Protocol(_))
        ));

        let mut lenient = Packets::new(input);
        let (id, payload) = read_message(&mut lenient, SHORT, "x", true).expect("skips");
        assert_eq!((id, payload), (2, vec![1, 2, 3]));

        // A continuation packet without the marker in the middle of a message.
        let mut broken = packets(1, &[7; 100]);
        broken[1][0] = 0x04;
        let mut transport = Packets::new(broken);
        assert!(matches!(
            read_message(&mut transport, SHORT, "x", false),
            Err(TrezorError::Protocol(_))
        ));
    }

    #[test]
    fn nothing_at_all_times_out() {
        let mut transport = Packets::new(Vec::new());
        let error = read_message(&mut transport, SHORT, "an answer", true).expect_err("silent");
        assert!(
            matches!(error, TrezorError::Timeout("an answer")),
            "{error}"
        );
    }
}
