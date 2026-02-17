/**
 * Event Program instruction builders
 * Program pubkey: 0x00...FF
 */

import { EVENT_PROGRAM } from "./constants";

/**
 * Build COUNTER event instruction
 * Event type: 2 (TN_EVENT_TYPE_COUNTER)
 * Format: [event_count:8][event_type:8][unused:8][unused:8]
 */
export function buildCounterEventInstruction(count: number): Uint8Array {
  const data = new Uint8Array(8 + 8 + 8 + 8);
  const view = new DataView(data.buffer);

  view.setBigUint64(0, BigInt(count), true); // event_count
  view.setBigUint64(8, 2n, true); // event_type = COUNTER
  view.setBigUint64(16, 0n, true); // unused
  view.setBigUint64(24, 0n, true); // unused

  return data;
}

/**
 * Build MESSAGE event instruction
 * Event type: 1 (TN_EVENT_TYPE_MESSAGE)
 * Format: [event_count:8][event_type:8][message:64]
 */
export function buildMessageEventInstruction(
  count: number,
  message: string
): Uint8Array {
  const data = new Uint8Array(8 + 8 + 64);
  const view = new DataView(data.buffer);

  view.setBigUint64(0, BigInt(count), true); // event_count
  view.setBigUint64(8, 1n, true); // event_type = MESSAGE

  // Copy message (truncate to 64 bytes)
  const msgBytes = new TextEncoder().encode(message);
  data.set(msgBytes.slice(0, 64), 16);

  return data;
}

/**
 * Build PATTERN event instruction
 * Event type: 6 (TN_EVENT_TYPE_PATTERN)
 * Format: [event_count:8][event_type:8][events_num:4][repeat:4][pattern_sz:4][pattern:variable]
 */
export function buildPatternEventInstruction(
  eventsNum: number,
  repeat: number,
  pattern: Uint8Array
): Uint8Array {
  const data = new Uint8Array(8 + 8 + 4 + 4 + 4 + pattern.length);
  const view = new DataView(data.buffer);

  view.setBigUint64(0, BigInt(eventsNum), true); // event_count (unused for pattern)
  view.setBigUint64(8, 6n, true); // event_type = PATTERN
  view.setUint32(16, eventsNum, true); // events_num
  view.setUint32(20, repeat, true); // repeat
  view.setUint32(24, pattern.length, true); // pattern_sz
  data.set(pattern, 28);

  return data;
}

/**
 * Build CUSTOM event instruction
 * Event type: 7 (TN_EVENT_TYPE_CUSTOM)
 * Format: [event_count:8][event_type:8][event_size:8][padding:8]
 */
export function buildCustomEventInstruction(eventSize: bigint): Uint8Array {
  const data = new Uint8Array(8 + 8 + 8 + 8);
  const view = new DataView(data.buffer);

  view.setBigUint64(0, 1n, true); // event_count = 1
  view.setBigUint64(8, 7n, true); // event_type = CUSTOM
  view.setBigUint64(16, eventSize, true); // event_size
  view.setBigUint64(24, 0n, true); // padding

  return data;
}

/**
 * Build INVOKE2 event instruction
 * Event type: 4 (TN_EVENT_TYPE_INVOKE2)
 * Format: [event_count:8][event_type:8][program_idx:2][inner_count:8][inner_type:8][message:64]
 */
export function buildInvoke2EventInstruction(
  invokeCount: number,
  targetProgramIdx: number,
  message: string
): Uint8Array {
  const data = new Uint8Array(8 + 8 + 2 + 8 + 8 + 64);
  const view = new DataView(data.buffer);

  view.setBigUint64(0, BigInt(invokeCount), true); // event_count
  view.setBigUint64(8, 4n, true); // event_type = INVOKE2
  view.setUint16(16, targetProgramIdx, true); // program_idx
  view.setBigUint64(18, 1n, true); // inner event_count
  view.setBigUint64(26, 1n, true); // inner event_type = MESSAGE

  // Copy message (truncate to 64 bytes)
  const msgBytes = new TextEncoder().encode(message);
  data.set(msgBytes.slice(0, 64), 34);

  return data;
}

export { EVENT_PROGRAM };

// Event program constants
export const EVENT_COMPUTE_UNITS = 1_000_000;
export const EVENT_STATE_UNITS = 10_000;
export const EVENT_MEMORY_UNITS = 20;
export const EVENT_EXPIRY = 100_000;

// Target program for invoke events (0xEE)
export const EVENT_TARGET_PROGRAM = (() => {
  const pk = new Uint8Array(32);
  pk[31] = 0xee;
  return pk;
})();
