//! Which wire protocol a device speaks, found as trezorlib finds it
//! (`protocol_v1.probe`): on a connection that was just opened, drain what
//! is left on it, send the older protocol's `Cancel`, and read the answer. A
//! device that speaks the Trezor Host Protocol answers every older-protocol
//! message with the same `Failure(InvalidProtocol)` before it looks at
//! channels (`trezor-thp`, `CODEC_V1_RESPONSE`); any other answer is a device
//! of the older protocol. The answer is not authenticated: the probe only
//! reports it, and the older protocol is accepted from the emulator only,
//! which is enforced where the backend is chosen (`Trezor::connect_probing`).
//!
//! `Cancel` ends a workflow that is running on a device of the older
//! protocol, so the probe belongs on a connection that is idle, once, as the
//! first thing. It decides nothing when the device does not answer: that is
//! an error.

use std::time::Duration;

use prost::Message as _;

use crate::codec_v1::{read_message, write_message};
use crate::error::{Result, TrezorError, failure_code};
use crate::messages::{Cancel, Failure, Wire};
use crate::transport::Transport;

/// The wire protocol of a device.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Protocol {
    /// The Trezor Host Protocol: an encrypted channel, pairing, sessions
    /// (the Safe 7).
    Thp,
    /// The older protocol: no encryption, no pairing (every Trezor before
    /// the Safe 7, the Safe 5 among them).
    V1,
}

impl std::fmt::Display for Protocol {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Protocol::Thp => "the Trezor Host Protocol",
            Protocol::V1 => "the older Trezor protocol",
        })
    }
}

/// How long the device may take to answer the probe. A device of either
/// protocol answers at once; one that does not is busy with something else or
/// not a Trezor.
pub(crate) const PROBE_TIMEOUT: Duration = Duration::from_secs(10);
/// How long the drain waits for stale input before it decides there is none.
const DRAIN_TIMEOUT: Duration = Duration::from_millis(100);
/// How many stale packets the drain discards at most (more than the longest
/// message this host accepts, so one whole stale message goes).
const DRAIN_MAX_PACKETS: usize = 512;

/// The probe's wait for an answer, in the text of the timeout error.
const PROBE_WAITING_FOR: &str = "an answer to the protocol probe (is another program using the \
                                 Trezor? close it, or reconnect the device)";

/// Finds the protocol of the device behind `transport`, which must be freshly
/// opened and idle.
pub(crate) fn probe<T: Transport>(transport: &mut T, timeout: Duration) -> Result<Protocol> {
    // Stale answers first, so that the device does not block sending them
    // and the answer read below is the answer to the `Cancel`. Packets, not
    // messages: nothing stale is worth parsing, whatever framing it is in.
    for _ in 0..DRAIN_MAX_PACKETS {
        if transport.read_packet(DRAIN_TIMEOUT)?.is_none() {
            break;
        }
    }
    write_message(transport, Cancel::ID, &[])?;
    let (id, payload) = read_message(transport, timeout, PROBE_WAITING_FOR, true)?;
    if id != Failure::ID {
        return Ok(Protocol::V1);
    }
    let failure = Failure::decode(payload.as_slice())
        .map_err(|e| TrezorError::Unexpected(format!("the answer to the probe: {e}")))?;
    if failure.code == Some(failure_code::INVALID_PROTOCOL) {
        Ok(Protocol::Thp)
    } else {
        Ok(Protocol::V1)
    }
}

#[cfg(test)]
mod tests {
    use std::collections::VecDeque;

    use super::*;
    use crate::codec_v1::encode;
    use crate::transport::{PACKET_LEN, TransportError};

    /// A device that answers the first packet it is written with the scripted
    /// reply; `stale` is what it has to say before anyone asks.
    struct Scripted {
        reply: Vec<Vec<u8>>,
        out: VecDeque<Vec<u8>>,
        written: Vec<Vec<u8>>,
    }

    impl Scripted {
        fn new(stale: Vec<Vec<u8>>, reply: Vec<Vec<u8>>) -> Self {
            Scripted {
                out: stale.into(),
                reply,
                written: Vec::new(),
            }
        }
    }

    impl Transport for Scripted {
        fn write_packet(&mut self, packet: &[u8]) -> std::result::Result<(), TransportError> {
            self.written.push(packet.to_vec());
            self.out.extend(std::mem::take(&mut self.reply));
            Ok(())
        }

        fn read_packet(
            &mut self,
            _timeout: Duration,
        ) -> std::result::Result<Option<Vec<u8>>, TransportError> {
            Ok(self.out.pop_front())
        }
    }

    fn message(id: u16, payload: &[u8]) -> Vec<Vec<u8>> {
        encode(id, payload)
            .expect("encodes")
            .iter()
            .map(|p| p.to_vec())
            .collect()
    }

    fn failure(code: i32) -> Vec<Vec<u8>> {
        message(
            Failure::ID,
            &Failure {
                code: Some(code),
                message: None,
            }
            .encode_to_vec(),
        )
    }

    const QUICK: Duration = Duration::from_millis(100);

    #[test]
    fn invalid_protocol_means_thp() {
        // The bytes a THP device sends, not our own encoding of them.
        let mut constant = b"?##\x00\x03\x00\x00\x00\x02\x08\x11".to_vec();
        constant.resize(PACKET_LEN, 0);
        let mut device = Scripted::new(vec![], vec![constant]);
        assert_eq!(probe(&mut device, QUICK).expect("probed"), Protocol::Thp);
        // One packet was sent: the older protocol's `Cancel`.
        assert_eq!(device.written.len(), 1);
        assert_eq!(&device.written[0][..9], b"?##\x00\x14\x00\x00\x00\x00");
    }

    #[test]
    fn any_other_answer_means_the_older_protocol() {
        // What a Core device answers `Cancel` with when it is idle.
        let mut device = Scripted::new(vec![], failure(failure_code::ACTION_CANCELLED));
        assert_eq!(probe(&mut device, QUICK).expect("probed"), Protocol::V1);
        // Not a Failure at all.
        let mut device = Scripted::new(vec![], message(2, &[]));
        assert_eq!(probe(&mut device, QUICK).expect("probed"), Protocol::V1);
        // A Failure without a code.
        let mut device = Scripted::new(vec![], message(Failure::ID, &[]));
        assert_eq!(probe(&mut device, QUICK).expect("probed"), Protocol::V1);
    }

    #[test]
    fn stale_input_is_drained_and_does_not_decide() {
        // A stale THP-looking Failure before the probe, and a stale packet in
        // another framing; the answer to the `Cancel` is what counts.
        let mut stale = failure(failure_code::INVALID_PROTOCOL);
        stale.insert(0, vec![0x04; PACKET_LEN]);
        let mut device = Scripted::new(stale, failure(failure_code::ACTION_CANCELLED));
        assert_eq!(probe(&mut device, QUICK).expect("probed"), Protocol::V1);
    }

    #[test]
    fn no_answer_is_an_error_and_nothing_else_is_sent() {
        let mut device = Scripted::new(vec![], vec![]);
        let error = probe(&mut device, QUICK).expect_err("no answer");
        let TrezorError::Timeout(text) = error else {
            panic!("wrong error: {error}");
        };
        assert!(text.contains("protocol probe"), "{text}");
        assert_eq!(device.written.len(), 1, "only the Cancel was sent");
    }

    #[test]
    fn a_failure_that_cannot_be_read_is_an_error() {
        let mut device = Scripted::new(vec![], message(Failure::ID, &[0xff, 0xff]));
        assert!(matches!(
            probe(&mut device, QUICK),
            Err(TrezorError::Unexpected(_))
        ));
    }
}
