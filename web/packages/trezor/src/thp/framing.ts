/**
 * Splitting a THP frame into 64-byte packets and putting packets back
 * together. `@trezor/protocol` has neither (it encodes and decodes a whole
 * frame); the layout is the one of `contrib/test/vectors/trezor/README.md`:
 *
 * - first packet: control byte, channel (2, big-endian), length (2,
 *   big-endian), then up to 59 bytes of payload;
 * - continuation packets: `0x80`, channel (2), then up to 61 bytes;
 * - `length` counts the payload and the 4 checksum bytes; the last packet is
 *   padded with zeros.
 */
import { PACKET_LEN } from '../transport';

const FIRST_HEADER = 5;
const CONTINUATION_HEADER = 3;
const CONTINUATION_BYTE = 0x80;
/** Length of the CRC-32 that ends every frame. */
export const CRC_LEN = 4;

/** The largest `length` field the host accepts from the device (payload and checksum). */
export const MAX_INBOUND_LENGTH = 8192;

/** Cuts a whole frame (header, length, payload, checksum) into packets. */
export function splitFrame(frame: Uint8Array): Uint8Array[] {
  const packets: Uint8Array[] = [];
  const first = new Uint8Array(PACKET_LEN);
  first.set(frame.subarray(0, Math.min(frame.length, PACKET_LEN)));
  packets.push(first);
  for (let offset = PACKET_LEN; offset < frame.length; offset += PACKET_LEN - CONTINUATION_HEADER) {
    const packet = new Uint8Array(PACKET_LEN);
    packet[0] = CONTINUATION_BYTE;
    packet[1] = frame[1];
    packet[2] = frame[2];
    packet.set(frame.subarray(offset, offset + PACKET_LEN - CONTINUATION_HEADER), CONTINUATION_HEADER);
    packets.push(packet);
  }
  return packets;
}

/** A whole frame as the device sent it. */
export type Frame = {
  /** The first byte, flags included. */
  control: number;
  channel: Uint8Array;
  /** The `length` field: payload and checksum. */
  length: number;
  /** Control byte and channel, as the library's decoder takes them. */
  header: Uint8Array;
  /** Payload and checksum, exactly `length` bytes. */
  body: Uint8Array;
};

/** Raised by {@link FrameAssembler} for a first packet that declares more than the bound. */
export class DeclaredLengthError extends Error {
  readonly declared: number;
  readonly bound: number;

  constructor(declared: number, bound: number) {
    super(`the device declared a message of ${declared} bytes, over the bound of ${bound}`);
    this.name = 'DeclaredLengthError';
    this.declared = declared;
    this.bound = bound;
  }
}

/**
 * Puts the packets of one channel back into frames. One frame is in
 * progress at a time: a first packet starts a new one and drops an unfinished
 * one; a continuation packet with no frame in progress, or of another
 * channel, is dropped. The declared length is checked before anything is
 * buffered.
 */
export class FrameAssembler {
  /** Packets that did not belong to a frame in progress. */
  dropped = 0;
  private current?: { control: number; channel: Uint8Array; length: number; body: Uint8Array; have: number };

  constructor(private readonly maxLength: number = MAX_INBOUND_LENGTH) {}

  /** Feeds one packet; returns the frame it completes, if any. */
  push(packet: Uint8Array): Frame | undefined {
    if (packet.length !== PACKET_LEN) {
      this.dropped++;
      return undefined;
    }
    if (packet[0] === CONTINUATION_BYTE) {
      const cur = this.current;
      if (!cur || packet[1] !== cur.channel[0] || packet[2] !== cur.channel[1]) {
        this.dropped++;
        return undefined;
      }
      const take = Math.min(PACKET_LEN - CONTINUATION_HEADER, cur.length - cur.have);
      cur.body.set(packet.subarray(CONTINUATION_HEADER, CONTINUATION_HEADER + take), cur.have);
      cur.have += take;
      return this.finish();
    }
    const length = (packet[3] << 8) | packet[4];
    if (length < CRC_LEN) {
      // Not a frame: even an acknowledgement carries its checksum.
      this.current = undefined;
      this.dropped++;
      return undefined;
    }
    if (length > this.maxLength) {
      this.current = undefined;
      throw new DeclaredLengthError(length, this.maxLength);
    }
    const body = new Uint8Array(length);
    const take = Math.min(PACKET_LEN - FIRST_HEADER, length);
    body.set(packet.subarray(FIRST_HEADER, FIRST_HEADER + take));
    this.current = { control: packet[0], channel: new Uint8Array(packet.subarray(1, 3)), length, body, have: take };
    return this.finish();
  }

  private finish(): Frame | undefined {
    const cur = this.current;
    if (!cur || cur.have < cur.length) return undefined;
    this.current = undefined;
    const header = new Uint8Array(3);
    header[0] = cur.control;
    header.set(cur.channel, 1);
    return { control: cur.control, channel: cur.channel, length: cur.length, header, body: cur.body };
  }
}
