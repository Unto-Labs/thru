//! Reads a log of 64-byte packets back into the frames the Trezor Host
//! Protocol sends: a first packet (control byte, channel id, length), its
//! continuation packets, and the CRC-32 that closes the payload.
//!
//! This only describes what the channel code put on the wire, and checks it
//! (length, zero padding, checksum); the packets themselves come from
//! `trezor-thp`.

use super::json::{J, obj};
use super::sim::Dir;

/// Bytes of a first packet before its payload: control byte, channel id and
/// length.
pub(super) const INIT_HEADER_LEN: usize = 5;
/// Bytes of a continuation packet before its payload: control byte and
/// channel id.
pub(super) const CONT_HEADER_LEN: usize = 3;
pub(super) const CHECKSUM_LEN: usize = 4;

/// CRC-32 (IEEE 802.3, reflected, initial value and final XOR 0xFFFFFFFF),
/// as four big-endian bytes.
pub(super) fn crc32(data: &[u8]) -> [u8; 4] {
    let mut crc = u32::MAX;
    for byte in data {
        crc ^= u32::from(*byte);
        for _ in 0..8 {
            crc = if crc & 1 == 1 {
                (crc >> 1) ^ 0xEDB8_8320
            } else {
                crc >> 1
            };
        }
    }
    (crc ^ u32::MAX).to_be_bytes()
}

#[derive(Clone, Debug)]
pub(super) struct Frame {
    pub dir: Dir,
    /// Index of the first packet in the log.
    pub first_packet: usize,
    pub packets: Vec<Vec<u8>>,
    pub control_byte: u8,
    pub channel_id: u16,
    /// The length field: payload plus the four checksum bytes.
    pub length: u16,
    /// The reassembled payload, without the checksum.
    pub payload: Vec<u8>,
    pub checksum: [u8; 4],
}

impl Frame {
    pub(super) fn kind(&self) -> &'static str {
        kind_of(self.control_byte)
    }

    pub(super) fn last_packet(&self) -> usize {
        self.first_packet + self.packets.len() - 1
    }
}

pub(super) fn kind_of(control_byte: u8) -> &'static str {
    match control_byte {
        0x40 => return "channel_allocation_request",
        0x41 => return "channel_allocation_response",
        0x42 => return "transport_error",
        0x43 => return "ping",
        0x44 => return "pong",
        _ => {}
    }
    if control_byte & 0xF7 == 0x20 {
        return "ack";
    }
    match control_byte & 0xE7 {
        0x00 => "handshake_initiation_request",
        0x01 => "handshake_initiation_response",
        0x02 => "handshake_completion_request",
        0x03 => "handshake_completion_response",
        0x04 => "encrypted_transport",
        _ => panic!("control byte {control_byte:#04x} is not one the vectors know"),
    }
}

pub(super) fn dir_name(dir: Dir) -> &'static str {
    match dir {
        Dir::HostToDevice => "host_to_device",
        Dir::DeviceToHost => "device_to_host",
    }
}

/// Groups a packet log into frames, in the order their first packets were
/// logged. Panics if the log is not well-formed: it was produced by the code
/// under test and any irregularity is a finding.
pub(super) fn parse(log: &[(Dir, Vec<u8>)]) -> Vec<Frame> {
    struct Open {
        slot: usize,
        data: Vec<u8>,
    }
    let mut frames: Vec<Option<Frame>> = Vec::new();
    let mut open: [Option<Open>; 2] = [None, None];
    for (index, (dir, packet)) in log.iter().enumerate() {
        assert_eq!(packet.len(), 64, "packet {index}");
        let side = usize::from(*dir == Dir::DeviceToHost);
        let control_byte = packet[0];
        let channel_id = u16::from_be_bytes([packet[1], packet[2]]);
        if control_byte & 0x80 != 0 {
            let current = open[side]
                .as_mut()
                .unwrap_or_else(|| panic!("continuation packet {index} without a frame"));
            let frame = frames[current.slot].as_mut().expect("open frame");
            assert_eq!(
                control_byte, 0x80,
                "continuation control byte, packet {index}"
            );
            assert_eq!(
                channel_id, frame.channel_id,
                "continuation channel, packet {index}"
            );
            current.data.extend_from_slice(&packet[CONT_HEADER_LEN..]);
            frame.packets.push(packet.clone());
        } else {
            assert!(
                open[side].is_none(),
                "a frame is unfinished at packet {index}"
            );
            let length = u16::from_be_bytes([packet[3], packet[4]]);
            let slot = frames.len();
            frames.push(Some(Frame {
                dir: *dir,
                first_packet: index,
                packets: vec![packet.clone()],
                control_byte,
                channel_id,
                length,
                payload: Vec::new(),
                checksum: [0; 4],
            }));
            open[side] = Some(Open {
                slot,
                data: packet[INIT_HEADER_LEN..].to_vec(),
            });
        }
        // Finished?
        let current = open[side].as_ref().expect("open frame");
        let frame = frames[current.slot].as_mut().expect("frame");
        let total = usize::from(frame.length);
        if current.data.len() >= total {
            assert!(
                current.data[total..].iter().all(|b| *b == 0),
                "padding of the frame at packet {} is not zero",
                frame.first_packet
            );
            let payload_len = total
                .checked_sub(CHECKSUM_LEN)
                .expect("length covers the checksum");
            frame.payload = current.data[..payload_len].to_vec();
            frame.checksum = current.data[payload_len..total]
                .try_into()
                .expect("4 bytes");
            let mut covered = frame.packets[0][..INIT_HEADER_LEN].to_vec();
            covered.extend_from_slice(&frame.payload);
            assert_eq!(
                crc32(&covered),
                frame.checksum,
                "checksum of the frame at packet {}",
                frame.first_packet
            );
            // The frame has exactly the packets it needs.
            let needed = if total <= 64 - INIT_HEADER_LEN {
                1
            } else {
                1 + (total - (64 - INIT_HEADER_LEN)).div_ceil(64 - CONT_HEADER_LEN)
            };
            assert_eq!(
                frame.packets.len(),
                needed,
                "packet count of frame at {}",
                frame.first_packet
            );
            open[side] = None;
        }
    }
    assert!(
        open.iter().all(Option::is_none),
        "a frame is unfinished at the end"
    );
    frames.into_iter().map(|f| f.expect("frame")).collect()
}

/// The JSON of the parts every frame has.
pub(super) fn frame_json(frame: &Frame) -> Vec<(String, J)> {
    let mut fields = vec![
        ("direction".to_owned(), J::str(dir_name(frame.dir))),
        ("kind".to_owned(), J::str(frame.kind())),
        ("control_byte".to_owned(), J::hex([frame.control_byte])),
        (
            "channel_id".to_owned(),
            J::hex(frame.channel_id.to_be_bytes()),
        ),
        ("length".to_owned(), J::num(frame.length)),
        ("payload".to_owned(), J::hex(&frame.payload)),
        ("checksum".to_owned(), J::hex(frame.checksum)),
        (
            "packets".to_owned(),
            J::arr(frame.packets.iter().map(J::hex)),
        ),
    ];
    if frame.channel_id != 0xFFFF {
        fields.insert(
            3,
            (
                "sync_bits".to_owned(),
                obj([
                    ("ack_bit", J::Bool(frame.control_byte & 0x08 != 0)),
                    ("seq_bit", J::Bool(frame.control_byte & 0x10 != 0)),
                ]),
            ),
        );
    }
    fields
}
