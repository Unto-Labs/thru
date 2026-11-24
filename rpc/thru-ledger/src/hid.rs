//! USB HID transport for physical Ledger devices (feature `hid`).
//!
//! Uses `hidapi` directly and implements the Ledger HID framing here, because
//! `ledger-transport-hid` forces hidapi's `linux-static-hidraw` backend, which
//! needs libudev at build and run time.  The `linux-native-basic-udev` backend
//! used instead needs neither, so the release CLI can be cross-compiled and
//! stays free of a `libudev.so.1` dependency.  macOS and Windows use hidapi's
//! usual system backends.
//!
//! On Linux, users need the Ledger udev rules so the device node is accessible
//! without root.

use std::sync::Mutex;

use hidapi::{DeviceInfo, HidApi, HidDevice};

use crate::apdu::Command;
use crate::transport::{Transport, TransportError};

const LEDGER_VID: u16 = 0x2c97;
const LEDGER_USAGE_PAGE: u16 = 0xFFA0;

/// Logical channel of every frame.
const CHANNEL: u16 = 0x0101;
/// Frame tag for APDU traffic.
const TAG_APDU: u8 = 0x05;
/// An outgoing report: a zero report ID followed by a 64-byte frame.
const WRITE_REPORT_LEN: usize = 65;
/// An incoming report: a 64-byte frame.
const READ_REPORT_LEN: usize = 64;
/// Report ID, channel, tag and sequence index.
const WRITE_HEADER_LEN: usize = 6;
/// Channel, tag and sequence index.
const READ_HEADER_LEN: usize = 5;
/// Length prefix carried by the first frame of a message.
const LEN_PREFIX: usize = 2;
/// Read timeout in milliseconds, about 10 000 s, so on-device review is never
/// cut short.
const READ_TIMEOUT_MS: i32 = 10_000_000;

/// The report-level operations the framing needs from a HID device.
trait HidIo {
    /// Write one report, returning the number of bytes written.
    fn write_report(&self, report: &[u8]) -> Result<usize, TransportError>;
    /// Read one report, returning the number of bytes read (`0` on timeout).
    fn read_report(&self, report: &mut [u8]) -> Result<usize, TransportError>;
}

impl HidIo for HidDevice {
    fn write_report(&self, report: &[u8]) -> Result<usize, TransportError> {
        self.write(report).map_err(hid_error)
    }

    fn read_report(&self, report: &mut [u8]) -> Result<usize, TransportError> {
        self.read_timeout(report, READ_TIMEOUT_MS)
            .map_err(hid_error)
    }
}

fn hid_error(e: hidapi::HidError) -> TransportError {
    TransportError::Hid(e.to_string())
}

fn framing_error(message: &str) -> TransportError {
    TransportError::Framing(message.to_string())
}

/// Send a command APDU as a sequence of HID frames.
fn write_apdu(device: &impl HidIo, apdu: &[u8]) -> Result<(), TransportError> {
    let apdu_len = u16::try_from(apdu.len())
        .map_err(|_| TransportError::Other("command APDU too long for HID framing".into()))?;

    let mut message = Vec::with_capacity(LEN_PREFIX + apdu.len());
    message.extend_from_slice(&apdu_len.to_be_bytes());
    message.extend_from_slice(apdu);

    let chunks = message.chunks(WRITE_REPORT_LEN - WRITE_HEADER_LEN);
    for (sequence, chunk) in chunks.enumerate() {
        let sequence = u16::try_from(sequence)
            .map_err(|_| TransportError::Other("command APDU too long for HID framing".into()))?;

        let mut report = [0u8; WRITE_REPORT_LEN];
        report[1..3].copy_from_slice(&CHANNEL.to_be_bytes());
        report[3] = TAG_APDU;
        report[4..6].copy_from_slice(&sequence.to_be_bytes());
        report[WRITE_HEADER_LEN..WRITE_HEADER_LEN + chunk.len()].copy_from_slice(chunk);

        if device.write_report(&report)? < report.len() {
            return Err(TransportError::Hid(
                "USB write error: could not send the whole report".into(),
            ));
        }
    }
    Ok(())
}

/// Reassemble a response APDU (`data ‖ SW`) from HID frames.
fn read_apdu(device: &impl HidIo) -> Result<Vec<u8>, TransportError> {
    let mut answer = Vec::with_capacity(256);
    let mut expected_len = 0usize;
    let mut sequence = 0u16;

    loop {
        let mut report = [0u8; READ_REPORT_LEN];
        let received = device.read_report(&mut report)?;
        let frame = report
            .get(..received)
            .ok_or_else(|| framing_error("HID read overran the report"))?;

        let min_len = READ_HEADER_LEN + if sequence == 0 { LEN_PREFIX } else { 0 };
        if frame.len() < min_len {
            return Err(framing_error("incomplete HID frame header"));
        }
        if u16::from_be_bytes([frame[0], frame[1]]) != CHANNEL {
            return Err(framing_error("invalid HID channel"));
        }
        if frame[2] != TAG_APDU {
            return Err(framing_error("invalid HID tag"));
        }
        if u16::from_be_bytes([frame[3], frame[4]]) != sequence {
            return Err(framing_error("invalid HID sequence index"));
        }

        let mut payload = &frame[READ_HEADER_LEN..];
        if sequence == 0 {
            expected_len = usize::from(u16::from_be_bytes([payload[0], payload[1]]));
            payload = &payload[LEN_PREFIX..];
        } else if payload.is_empty() {
            // Every continuation frame must make progress, which also keeps
            // the sequence index from overflowing.
            return Err(framing_error("empty HID continuation frame"));
        }

        let take = payload.len().min(expected_len - answer.len());
        answer.extend_from_slice(&payload[..take]);

        if answer.len() >= expected_len {
            if answer.len() < 2 {
                return Err(framing_error("response too short for a status word"));
            }
            return Ok(answer);
        }
        sequence += 1;
    }
}

fn is_ledger(device: &DeviceInfo) -> bool {
    device.vendor_id() == LEDGER_VID && device.usage_page() == LEDGER_USAGE_PAGE
}

/// A connection to the first Ledger found on USB HID.
pub struct HidTransport {
    device: Mutex<HidDevice>,
    // Keep the hidapi context alive for the lifetime of the device handle.
    _api: Mutex<HidApi>,
}

impl HidTransport {
    /// Open the first connected Ledger.
    pub fn open() -> Result<Self, TransportError> {
        let api = HidApi::new().map_err(hid_error)?;
        let info = api
            .device_list()
            .find(|device| is_ledger(device))
            .ok_or(TransportError::NoDevice)?;
        let device = info.open_device(&api).map_err(hid_error)?;
        device.set_blocking_mode(true).map_err(hid_error)?;
        Ok(Self {
            device: Mutex::new(device),
            _api: Mutex::new(api),
        })
    }
}

impl Transport for HidTransport {
    fn exchange(&self, command: &[u8]) -> Result<Vec<u8>, TransportError> {
        Command::decode(command)
            .ok_or_else(|| TransportError::Other("malformed command APDU".into()))?;
        let device = self
            .device
            .lock()
            .map_err(|_| TransportError::Other("HID device lock poisoned".into()))?;
        write_apdu(&*device, command)?;
        read_apdu(&*device)
    }
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;
    use std::collections::VecDeque;

    use super::*;

    /// A HID device that records writes and replays scripted reads.
    #[derive(Default)]
    struct FakeDevice {
        written: RefCell<Vec<Vec<u8>>>,
        reads: RefCell<VecDeque<Vec<u8>>>,
        short_write: bool,
    }

    impl FakeDevice {
        fn with_reads(reads: Vec<Vec<u8>>) -> Self {
            Self {
                reads: RefCell::new(reads.into()),
                ..Self::default()
            }
        }
    }

    impl HidIo for FakeDevice {
        fn write_report(&self, report: &[u8]) -> Result<usize, TransportError> {
            self.written.borrow_mut().push(report.to_vec());
            Ok(report.len() - usize::from(self.short_write))
        }

        fn read_report(&self, report: &mut [u8]) -> Result<usize, TransportError> {
            match self.reads.borrow_mut().pop_front() {
                Some(frame) => {
                    report[..frame.len()].copy_from_slice(&frame);
                    Ok(frame.len())
                }
                None => Ok(0),
            }
        }
    }

    /// Build a 64-byte device frame with the given header and payload.
    fn frame(channel: u16, tag: u8, sequence: u16, payload: &[u8]) -> Vec<u8> {
        let mut out = vec![0u8; READ_REPORT_LEN];
        out[..2].copy_from_slice(&channel.to_be_bytes());
        out[2] = tag;
        out[3..5].copy_from_slice(&sequence.to_be_bytes());
        out[5..5 + payload.len()].copy_from_slice(payload);
        out
    }

    fn assert_framing_error(result: Result<Vec<u8>, TransportError>, expected: &str) {
        match result {
            Err(TransportError::Framing(message)) => {
                assert!(message.contains(expected), "unexpected message: {message}")
            }
            other => panic!("expected a framing error, got {other:?}"),
        }
    }

    #[test]
    fn short_command_fits_one_zero_padded_report() {
        let device = FakeDevice::default();
        write_apdu(&device, &[0xE0, 0x01, 0x00, 0x00, 0x00]).unwrap();

        let mut expected = vec![0u8; WRITE_REPORT_LEN];
        expected[..13].copy_from_slice(&[
            0x00, // report ID
            0x01, 0x01, // channel
            0x05, // tag
            0x00, 0x00, // sequence
            0x00, 0x05, // APDU length
            0xE0, 0x01, 0x00, 0x00, 0x00, // APDU
        ]);
        assert_eq!(*device.written.borrow(), vec![expected]);
    }

    #[test]
    fn long_command_is_split_with_increasing_sequence() {
        let apdu: Vec<u8> = (0..=255u8).chain(0..4).collect();
        let device = FakeDevice::default();
        write_apdu(&device, &apdu).unwrap();

        let written = device.written.borrow();
        // 262 message bytes at 59 bytes per report.
        assert_eq!(written.len(), 5);

        let mut reassembled = Vec::new();
        for (index, report) in written.iter().enumerate() {
            assert_eq!(report.len(), WRITE_REPORT_LEN);
            assert_eq!(&report[..4], &[0x00, 0x01, 0x01, 0x05]);
            assert_eq!(&report[4..6], &(index as u16).to_be_bytes());
            reassembled.extend_from_slice(&report[WRITE_HEADER_LEN..]);
        }
        assert_eq!(&reassembled[..2], &260u16.to_be_bytes());
        assert_eq!(&reassembled[2..262], apdu.as_slice());
        assert!(reassembled[262..].iter().all(|byte| *byte == 0));
    }

    #[test]
    fn partial_write_is_an_error() {
        let device = FakeDevice {
            short_write: true,
            ..FakeDevice::default()
        };
        let result = write_apdu(&device, &[0xE0, 0x01, 0x00, 0x00, 0x00]);
        assert!(matches!(result, Err(TransportError::Hid(_))));
    }

    #[test]
    fn single_frame_response() {
        let device =
            FakeDevice::with_reads(vec![frame(CHANNEL, TAG_APDU, 0, &[0, 3, 0xAA, 0x90, 0x00])]);
        assert_eq!(read_apdu(&device).unwrap(), vec![0xAA, 0x90, 0x00]);
    }

    #[test]
    fn multi_frame_response_stops_at_declared_length() {
        let body: Vec<u8> = (0..100u8).collect();
        let mut first = vec![0, 100];
        first.extend_from_slice(&body[..57]);
        let device = FakeDevice::with_reads(vec![
            frame(CHANNEL, TAG_APDU, 0, &first),
            frame(CHANNEL, TAG_APDU, 1, &body[57..]),
        ]);
        assert_eq!(read_apdu(&device).unwrap(), body);
    }

    #[test]
    fn short_frames_only_contribute_received_bytes() {
        let first = frame(CHANNEL, TAG_APDU, 0, &[0, 4, 0xAA])[..8].to_vec();
        let device = FakeDevice::with_reads(vec![
            first,
            frame(CHANNEL, TAG_APDU, 1, &[0xBB, 0x90, 0x00]),
        ]);
        assert_eq!(read_apdu(&device).unwrap(), vec![0xAA, 0xBB, 0x90, 0x00]);
    }

    #[test]
    fn rejects_malformed_frames() {
        let cases = [
            (frame(0x0202, TAG_APDU, 0, &[0, 2, 0x90, 0]), "channel"),
            (frame(CHANNEL, 0x06, 0, &[0, 2, 0x90, 0]), "tag"),
            (frame(CHANNEL, TAG_APDU, 1, &[0, 2, 0x90, 0]), "sequence"),
            (frame(CHANNEL, TAG_APDU, 0, &[0, 1, 0x90]), "too short"),
            (frame(CHANNEL, TAG_APDU, 0, &[0, 0]), "too short"),
            (vec![0x01, 0x01, 0x05], "header"),
        ];
        for (bad_frame, expected) in cases {
            let device = FakeDevice::with_reads(vec![bad_frame]);
            assert_framing_error(read_apdu(&device), expected);
        }
    }

    #[test]
    fn read_timeout_is_an_error() {
        assert_framing_error(read_apdu(&FakeDevice::default()), "header");
    }

    #[test]
    fn rejects_empty_continuation_frame() {
        let device = FakeDevice::with_reads(vec![
            frame(CHANNEL, TAG_APDU, 0, &[0x01, 0x00, 0xAA]),
            frame(CHANNEL, TAG_APDU, 1, &[])[..READ_HEADER_LEN].to_vec(),
        ]);
        // The first frame is padded to 64 bytes, so it carries 57 of the 256
        // bytes and the empty frame arrives while more data is still expected.
        assert_framing_error(read_apdu(&device), "continuation");
    }
}
