/**
 * Test support for the driver checks: virtual time, a transport the test
 * scripts, a replay of the recorded conversations, and a device that builds
 * its own frames from the keys of a recorded scenario. Like
 * `vector-checks.ts` it uses no Node API, so the same code runs under vitest
 * and in a page in Chromium.
 */
import type { Clock, Transport } from '../index';
import type { Api, CheckFailure, Frame as VFrame, Scenario, Vectors } from './vector-checks';

// ---- bytes that share memory ----

/**
 * A byte array whose `slice` shares memory, as Node's `Buffer` and the
 * package's `Buffer` do: for runs (the USB and IndexedDB checks) that have no
 * `Buffer` of the bundle at hand.
 */
export class SharedSlice extends Uint8Array {
  override slice(start?: number, end?: number): Uint8Array<ArrayBuffer> {
    return this.subarray(start, end) as Uint8Array<ArrayBuffer>;
  }
}

/** `bytes` copied into a {@link SharedSlice}. */
export function sharedSlice(bytes: Uint8Array): Uint8Array {
  const out = new SharedSlice(bytes.length);
  out.set(bytes);
  return out;
}

/** `bytes` as a `Buffer` of the bundle: what a caller holding one passes in. */
export function bufferOf(api: Api, bytes: Uint8Array): Uint8Array {
  return api.Buffer.from(bytes);
}

// ---- virtual time ----

type Timer = { id: number; at: number; callback: () => void };

/** A clock that only moves when the test lets it. */
export class FakeClock implements Clock {
  time = 0;
  private sequence = 0;
  private readonly timers = new Map<number, Timer>();

  now(): number {
    return this.time;
  }

  setTimeout(callback: () => void, ms: number): unknown {
    const id = ++this.sequence;
    this.timers.set(id, { id, at: this.time + Math.max(0, ms), callback });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.timers.delete(handle as number);
  }

  /** Moves time to the earliest timer and runs it; `false` when there is none. */
  fireNext(): boolean {
    let next: Timer | undefined;
    for (const timer of this.timers.values()) {
      if (!next || timer.at < next.at || (timer.at === next.at && timer.id < next.id)) next = timer;
    }
    if (!next) return false;
    this.timers.delete(next.id);
    this.time = Math.max(this.time, next.at);
    next.callback();
    return true;
  }
}

/** A turn of the event loop: every promise that can settle without time or I/O has settled after it. */
export function macrotask(): Promise<void> {
  return new Promise<void>((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(0);
  });
}

/**
 * Runs `promise` to its end on virtual time: whenever everything is waiting
 * on a timer, the earliest timer fires at once. Throws when nothing can happen.
 */
export async function runVirtual<T>(clock: FakeClock, promise: Promise<T>): Promise<T> {
  let settled = false;
  let value: T | undefined;
  let failure: { error: unknown } | undefined;
  promise.then(
    (v) => {
      settled = true;
      value = v;
    },
    (error: unknown) => {
      settled = true;
      failure = { error };
    },
  );
  for (let step = 0; step < 200_000; step++) {
    await macrotask();
    if (settled) break;
    if (!clock.fireNext()) {
      await macrotask();
      if (settled) break;
      throw new Error(`stalled at ${clock.time} ms: nothing is left that could happen`);
    }
  }
  if (!settled) throw new Error('did not finish');
  if (failure) throw failure.error;
  return value as T;
}

// ---- a transport the test scripts ----

export class ScriptedTransport implements Transport {
  isEmulator = false;
  /** Every packet the host wrote, copied at the time. */
  written: Uint8Array[] = [];
  /**
   * Called with the number of writes begun so far (this one not counted); a
   * promise it returns holds this write until it settles, as a pending USB
   * transfer does.
   */
  holdWrite: ((index: number) => Promise<void> | undefined) | undefined;
  writesBegun = 0;
  writeTimes: number[] = [];
  readCalls = 0;
  /** Reads started while another was outstanding: the contract allows none. */
  overlappingReads = 0;
  closeCalls = 0;
  delivered = 0;
  private queue: Uint8Array[] = [];
  private waiter?: { resolve: (packet: Uint8Array) => void; reject: (error: Error) => void };

  constructor(
    private readonly clock: FakeClock,
    public onWrite: (packet: Uint8Array) => void,
  ) {}

  async writePacket(packet: Uint8Array): Promise<void> {
    const held = this.holdWrite?.(this.writesBegun++);
    if (held) await held;
    if (this.closeCalls > 0) throw new Error('write after close');
    this.written.push(packet.slice());
    this.writeTimes.push(this.clock.now());
    this.onWrite(packet.slice());
  }

  readPacket(): Promise<Uint8Array> {
    this.readCalls++;
    if (this.waiter) this.overlappingReads++;
    const next = this.queue.shift();
    if (next) {
      this.delivered++;
      return Promise.resolve(next);
    }
    if (this.closeCalls > 0) return Promise.reject(new Error('read after close'));
    return new Promise<Uint8Array>((resolve, reject) => {
      this.waiter = { resolve, reject };
    });
  }

  /** The device sends these packets. */
  push(packets: readonly Uint8Array[]): void {
    for (const packet of packets) {
      const waiter = this.waiter;
      if (waiter) {
        this.waiter = undefined;
        this.delivered++;
        waiter.resolve(packet.slice());
      } else {
        this.queue.push(packet.slice());
      }
    }
  }

  get unread(): number {
    return this.queue.length;
  }

  async close(): Promise<void> {
    this.closeCalls++;
    if (this.waiter) {
      const { reject } = this.waiter;
      this.waiter = undefined;
      reject(new Error('closed'));
    }
  }
}

// ---- the recorded conversations ----

export type Step = { direction: 'host_to_device' | 'device_to_host'; packets: Uint8Array[]; frame: VFrame };

export function stepsOf(api: Api, frames: readonly VFrame[]): Step[] {
  return frames.map((frame) => ({
    direction: frame.direction,
    packets: frame.packets.map((p) => api.fromHex(p)),
    frame,
  }));
}

export function samePackets(a: readonly Uint8Array[], b: readonly Uint8Array[]): boolean {
  return a.length === b.length && a.every((p, i) => p.length === b[i].length && p.every((x, j) => x === b[i][j]));
}

export type ConversationOptions = {
  /**
   * Called for each device step as it is released. Returns the packets to
   * deliver in its place, `'drop'` to lose it, or `'hold'` to keep it until
   * {@link Conversation.release}.
   */
  device?: (step: Step, index: number, conversation: Conversation) => Uint8Array[] | 'drop' | 'hold';
  /** A host frame equal to the previous host frame is a retransmission: counted, not compared. */
  retransmits?: boolean;
  /** A host acknowledgement equal to the previous one answers a duplicate: counted, not compared. */
  repeatedAcks?: boolean;
  /** The host frames after the last step go here (the test takes over). */
  after?: (packets: Uint8Array[]) => void;
  /** Sees every host frame first; `true` means it was dealt with and the recording does not see it. */
  intercept?: (packets: Uint8Array[], conversation: Conversation) => boolean;
};

/**
 * Plays the device of a recorded conversation: compares every host packet with
 * the file's, and after each host frame releases the device frames that follow
 * it in the file.
 */
export class Conversation {
  mismatches: string[] = [];
  position = 0;
  hostFrames: Uint8Array[][] = [];
  retransmissions: Uint8Array[][] = [];
  repeatedAcks = 0;
  /** Packets of host frames the test's `intercept` dealt with. */
  interceptedPackets = 0;
  held: Step[] = [];
  private current: Uint8Array[] = [];
  private expectedPackets = 0;
  private lastFrame?: Uint8Array[];
  private lastAck?: Uint8Array[];
  transport!: ScriptedTransport;

  constructor(
    private readonly steps: readonly Step[],
    private readonly options: ConversationOptions = {},
  ) {}

  attach(transport: ScriptedTransport): void {
    this.transport = transport;
    transport.onWrite = (packet) => this.onWrite(packet);
    this.releaseDevice();
  }

  get finished(): boolean {
    return this.position >= this.steps.length;
  }

  get hostPacketCount(): number {
    return this.hostFrames.reduce((n, f) => n + f.length, 0);
  }

  /** Delivers the steps held back. */
  release(): void {
    const held = this.held;
    this.held = [];
    for (const step of held) this.transport.push(step.packets);
  }

  private onWrite(packet: Uint8Array): void {
    if (this.current.length === 0) {
      const length = (packet[3] << 8) | packet[4];
      this.expectedPackets = length + 5 <= 64 ? 1 : 1 + Math.ceil((length + 5 - 64) / 61);
    }
    this.current.push(packet);
    if (this.current.length < this.expectedPackets) return;
    const frame = this.current;
    this.current = [];
    this.onHostFrame(frame);
  }

  private onHostFrame(packets: Uint8Array[]): void {
    if (this.options.intercept?.(packets, this)) {
      this.interceptedPackets += packets.length;
      return;
    }
    const isAck = (packets[0][0] & 0xf7) === 0x20;
    if (this.options.repeatedAcks && isAck && this.lastAck && samePackets(this.lastAck, packets)) {
      this.repeatedAcks++;
      return;
    }
    if (this.options.retransmits && this.lastFrame && samePackets(this.lastFrame, packets)) {
      this.retransmissions.push(packets);
      this.release();
      return;
    }
    if (this.finished) {
      if (this.options.after) this.options.after(packets);
      else this.mismatches.push(`a host frame after the end of the recording (control ${packets[0][0].toString(16)})`);
      return;
    }
    const expected = this.steps[this.position];
    if (expected.direction !== 'host_to_device') {
      this.mismatches.push(`frame ${expected.frame.index}: the host wrote while the device was to speak`);
    } else if (!samePackets(expected.packets, packets)) {
      const at = packets.findIndex((p, i) => !expected.packets[i] || p.some((x, j) => x !== expected.packets[i][j]));
      this.mismatches.push(
        `frame ${expected.frame.index} (${expected.frame.kind}): packet ${at} differs; ` +
          `expected ${packets.length === expected.packets.length ? '' : `${expected.packets.length} packets, got ${packets.length}; `}` +
          `${hexOf(expected.packets[Math.max(0, at)])} got ${hexOf(packets[Math.max(0, at)])}`,
      );
    }
    this.hostFrames.push(packets);
    this.lastFrame = packets;
    if (isAck) this.lastAck = packets;
    this.position++;
    this.releaseDevice();
  }

  /** Delivers the device frames that follow the host frame just matched. */
  private releaseDevice(): void {
    while (this.position < this.steps.length && this.steps[this.position].direction === 'device_to_host') {
      const step = this.steps[this.position];
      const outcome = this.options.device?.(step, this.position, this) ?? step.packets;
      if (outcome === 'hold') this.held.push(step);
      else if (outcome !== 'drop') this.transport.push(outcome);
      this.position++;
    }
  }
}

function hexOf(packet: Uint8Array | undefined): string {
  if (!packet) return '(none)';
  let out = '';
  for (const b of packet.subarray(0, 16)) out += b.toString(16).padStart(2, '0');
  return `${out}...`;
}

// ---- a device with the keys of a recorded scenario ----

export type DeviceMessage = { session: number; type: number; payload: Uint8Array };

export type DeviceReaction = {
  /** Acknowledge the message (default). */
  ack?: boolean;
  /** Messages to send after the acknowledgement. */
  send?: DeviceMessage[];
};

/**
 * The device side after the handshake of a recorded scenario: it holds the two
 * transport keys and the channel, decrypts what the host sends, acknowledges
 * it, and answers as the test says.
 */
export class FreeDevice {
  received: DeviceMessage[] = [];
  receivedFrames: Uint8Array[][] = [];
  retransmittedFrames: Uint8Array[][] = [];
  acks: number[] = [];
  private hostSeq = 0;
  /** The counter of the host's next message; a test that moves the host's counter moves this too. */
  hostCounter = 0;
  private deviceSeq = 0;
  private deviceCounter = 1;
  private readonly assembler: InstanceType<Api['FrameAssembler']>;
  private readonly channel: Uint8Array;
  private readonly hostKey: Uint8Array;
  private readonly deviceKey: Uint8Array;

  constructor(
    private readonly api: Api,
    scenario: Scenario,
    private readonly transport: ScriptedTransport,
    private readonly handler: (message: DeviceMessage, index: number) => DeviceReaction,
  ) {
    this.assembler = new api.FrameAssembler();
    this.channel = api.fromHex(scenario.inputs.channel_id);
    this.hostKey = api.fromHex(scenario.noise.host_to_device_key);
    this.deviceKey = api.fromHex(scenario.noise.device_to_host_key);
  }

  /** Feeds the host's packets of one frame. */
  onHostFrame(packets: Uint8Array[]): void {
    let frame: ReturnType<InstanceType<Api['FrameAssembler']>['push']>;
    for (const packet of packets) frame = this.assembler.push(packet);
    if (!frame) return;
    const control = frame.control;
    if ((control & 0xf7) === 0x20) {
      this.acks.push((control >> 3) & 1);
      return;
    }
    if ((control & 0xe7) !== 0x04) return;
    const seq = (control >> 4) & 1;
    if (seq !== this.hostSeq) {
      this.retransmittedFrames.push(packets);
      this.sendAck(seq);
      return;
    }
    this.receivedFrames.push(packets);
    const tag = frame.length - 4 - 16;
    const aes = this.api.thpCrypto.aesgcm(
      this.api.Buffer.from(this.hostKey) as never,
      this.api.thpCrypto.getIvFromNonce(this.hostCounter),
    );
    aes.auth(this.api.Buffer.alloc(0) as never);
    const plain = aes.decrypt(
      this.api.Buffer.from(frame.body.subarray(0, tag)) as never,
      this.api.Buffer.from(frame.body.subarray(tag, tag + 16)) as never,
    );
    this.hostCounter++;
    this.hostSeq ^= 1;
    const message: DeviceMessage = { session: plain[0], type: (plain[1] << 8) | plain[2], payload: plain.slice(3) };
    this.received.push(message);
    const reaction = this.handler(message, this.received.length - 1);
    if (reaction.ack !== false) this.sendAck(seq);
    for (const out of reaction.send ?? []) this.send(out);
  }

  sendAck(bit: number): void {
    this.transport.push(this.api.splitFrame(this.frame(0x20 | (bit << 3), new Uint8Array(0))));
  }

  /** Sends one encrypted message; it carries the acknowledgement of the host's last message. */
  send(message: DeviceMessage): void {
    const aes = this.api.thpCrypto.aesgcm(
      this.api.Buffer.from(this.deviceKey) as never,
      this.api.thpCrypto.getIvFromNonce(this.deviceCounter),
    );
    aes.auth(this.api.Buffer.alloc(0) as never);
    const plain = new Uint8Array(3 + message.payload.length);
    plain[0] = message.session;
    plain[1] = message.type >> 8;
    plain[2] = message.type & 0xff;
    plain.set(message.payload, 3);
    const ciphertext = aes.encrypt(this.api.Buffer.from(plain) as never);
    const tag = aes.finish();
    const body = new Uint8Array(ciphertext.length + tag.length);
    body.set(ciphertext, 0);
    body.set(tag, ciphertext.length);
    const ackBit = this.hostSeq ^ 1;
    const control = 0x04 | (ackBit << 3) | (this.deviceSeq << 4);
    this.deviceCounter++;
    this.deviceSeq ^= 1;
    this.transport.push(this.api.splitFrame(this.frame(control, body)));
  }

  /** A frame of the channel: header, length, body, CRC-32. */
  frame(control: number, body: Uint8Array): Uint8Array {
    return buildFrame(this.api, control, this.channel, body);
  }
}

/** A whole frame: control byte, channel, length, body, CRC-32 over everything before it. */
export function buildFrame(api: Api, control: number, channel: Uint8Array, body: Uint8Array): Uint8Array {
  const length = body.length + 4;
  const frame = new Uint8Array(5 + body.length + 4);
  frame[0] = control;
  frame.set(channel, 1);
  frame[3] = length >> 8;
  frame[4] = length & 0xff;
  frame.set(body, 5);
  frame.set(api.thpCrypto.crc32(api.Buffer.from(frame.subarray(0, 5 + body.length)) as never), 5 + body.length);
  return frame;
}

/** The device's error frame (`0x42`) with the given code byte. */
export function errorFrame(api: Api, channel: Uint8Array, code: number): Uint8Array[] {
  return api.splitFrame(buildFrame(api, 0x42, channel, new Uint8Array([code])));
}

// ---- scripted randomness ----

/** The argument that `setRandomBytesSource` demands: it exists for tests only. */
export const TEST_ONLY = { forTests: true } as const;

/** The next calls of `randomBytes` answer these values. */
export function scriptRandom(api: Api, values: Uint8Array[]): { used: () => number; restore: () => void } {
  let n = 0;
  api.setRandomBytesSource((length) => {
    const value = values[n++];
    if (!value) throw new Error('unscripted randomBytes call');
    if (value.length !== length) throw new Error(`scripted ${value.length} bytes, asked ${length}`);
    return value;
  }, TEST_ONLY);
  return { used: () => n, restore: () => api.setRandomBytesSource(undefined, TEST_ONLY) };
}

/**
 * The scenario's random values in the order the TypeScript driver draws them:
 * the channel nonce, the ephemeral key, the static key (only without a stored
 * credential), the pairing challenge and the CPace key. The Rust host draws
 * the static key first, whether it uses it or not.
 */
export function randomValuesOf(api: Api, scenario: Scenario): Uint8Array[] {
  const requests = scenario.inputs.random_requests as { label: string; value: string }[];
  const order = [
    'channel_allocation_nonce',
    'host_ephemeral_privkey',
    'host_static_privkey',
    'pairing_challenge',
    'cpace_host_private_key',
  ];
  return order.flatMap((label) => {
    const found = requests.find((r) => r.label === label);
    return found ? [api.fromHex(found.value)] : [];
  });
}

// ---- checks ----

export type CaseResult = { group: string; name: string; checks: number; failures: CheckFailure[] };

export type Check = {
  eq(label: string, expected: unknown, actual: unknown): void;
  ok(label: string, condition: boolean, detail?: string): void;
  /** Awaits a promise that must reject; returns the error. */
  rejects(label: string, promise: Promise<unknown>): Promise<unknown>;
};

export type Ctx = { api: Api; v: Vectors; t: Check };
export type Case = { group: string; name: string; run: (ctx: Ctx) => Promise<void> };

const show = (v: unknown): string =>
  typeof v === 'bigint' ? v.toString() : typeof v === 'string' ? v : JSON.stringify(v);

export function newCheck(): { check: Check; failures: CheckFailure[]; count: () => number } {
  const failures: CheckFailure[] = [];
  let count = 0;
  const check: Check = {
    eq(label, expected, actual) {
      count++;
      const e = show(expected);
      const a = show(actual);
      if (e !== a) failures.push({ label, expected: e, actual: a });
    },
    ok(label, condition, detail = '') {
      count++;
      if (!condition) failures.push({ label, expected: 'true', actual: `false ${detail}`.trim() });
    },
    async rejects(label, promise) {
      count++;
      try {
        await promise;
      } catch (error) {
        return error;
      }
      failures.push({ label, expected: 'an error', actual: 'no error' });
      return undefined;
    },
  };
  return { check, failures, count: () => count };
}

