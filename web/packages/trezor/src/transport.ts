/**
 * The transport contract (plan B11): how 64-byte Trezor Host Protocol packets
 * reach the device.
 *
 * - `readPacket` is called by the link at most once at a time, and the link
 *   keeps the promise it got across its own timeouts: a timeout never abandons
 *   a read, so a packet that arrives later is the one the next wait receives.
 *   A transport therefore needs no cancellation of its own except `close`.
 * - A packet that arrives while no read is outstanding is kept and handed to
 *   the next `readPacket` (UDP datagrams and USB reports are not lost).
 * - Requests are serialized above the transport; it never sees two writes or
 *   two reads at once.
 * - `close` cancels the outstanding read (it rejects) and releases the device.
 */

/** Length of every packet on USB and UDP. */
export const PACKET_LEN = 64;

export interface Transport {
  /**
   * True only on a transport that cannot reach a device: the emulator's UDP
   * transport. Pairing may be skipped only on such a transport, and only when
   * the caller asks for it.
   */
  readonly isEmulator?: boolean;
  /** Sends one packet of {@link PACKET_LEN} bytes. */
  writePacket(packet: Uint8Array): Promise<void>;
  /** Resolves with the next packet; rejects when the transport fails or is closed. */
  readPacket(): Promise<Uint8Array>;
  /** Cancels the outstanding read and releases the device. Safe to call twice. */
  close(): Promise<void>;
}
