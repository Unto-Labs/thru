/**
 * The Trezor Host Protocol link: one encrypted channel to one device, over a
 * {@link Transport}. Ported from `rpc/thru-trezor/src/thp.rs`.
 *
 * The packet encodings, the handshake and its crypto, and the sequence, the
 * acknowledgement bits and the nonces of `ThpState` are `@trezor/protocol`.
 * What the library does not do is here: allocating a channel and matching its
 * nonce, cutting frames into packets and putting them together (bounded),
 * keeping one read outstanding across timeouts, waiting for acknowledgements
 * and retransmitting the same ciphertext, answering `TRANSPORT_BUSY` with a
 * bounded back-off, ignoring duplicates and other channels' packets, reading
 * the session byte of an incoming message (the library's decoder drops it),
 * and refusing a message counter the library's nonce cannot express.
 *
 * Exactly one operation (`open`, `send`, `receive`) runs at a time; the client
 * above serializes its calls. Any error ends the link: the state after a lost
 * answer or an abort cannot be told from the device's.
 */
import { Buffer, randomBytes } from './node-shims';
import { thp, thpCrypto, v2 } from './library';
import { protobufDecoder, protobufEncoder } from './codec-adapter';
import { abortable, type Clock, sleep, waitFor } from '../clock';
import { copyRecord, MAX_CREDENTIAL_LEN, type CredentialRecord } from '../credentials';
import {
  TrezorAbortedError,
  TrezorClosedError,
  TrezorDeviceLockedError,
  TrezorError,
  TrezorProtocolError,
  TrezorTimeoutError,
  TrezorTransportError,
  transportKindOf,
} from '../errors';
import { copyBytes, equalBytes, toHex } from '../bytes';
import { PACKET_LEN, type Transport } from '../transport';
import { CRC_LEN, DeclaredLengthError, FrameAssembler, MAX_INBOUND_LENGTH, splitFrame, type Frame } from './framing';

/** How long the device may take to acknowledge a message before the link is declared dead. */
export const ACK_BUDGET_MS = 8_000;
/** The most retransmissions of one message, whatever the clock says. */
export const MAX_RETRANSMISSIONS = 50;
/** A locked device that unlocks for the connection waits for its user here. */
export const HANDSHAKE_TIMEOUT_MS = 60_000;
export const ALLOCATION_TIMEOUT_MS = 3_000;
/**
 * The device refuses a message with `TRANSPORT_BUSY` while another channel is
 * active (for example a previous run that has not been dropped yet): wait,
 * send the message again, and ask again. The wait starts at `firstWaitMs`,
 * doubles each time up to `longestWaitMs`, and the total is bounded.
 */
export const BUSY_POLICY = { firstWaitMs: 100, longestWaitMs: 2_000, budgetMs: 30_000 } as const;
/** The library's nonce is wrong from this counter on (it shifts a number with `>>`). */
export const COUNTER_LIMIT = 2 ** 31;
/**
 * What the Noise handshake's two answers hold exactly, before their checksum:
 * the initiation response is the device's ephemeral key (32 bytes), its
 * encrypted static key (32 bytes and a 16-byte tag) and an empty payload's tag
 * (16 bytes); the completion response is the encrypted pairing state (1 byte)
 * and its 16-byte tag. The Rust host's channel requires exactly these lengths;
 * the library here reads the fields it knows and ignores what follows them, so
 * the lengths are checked before it decodes.
 */
export const HANDSHAKE_INIT_RESPONSE_LEN = 32 + 48 + 16;
export const HANDSHAKE_COMPLETION_RESPONSE_LEN = 1 + 16;
/** Largest plaintext of one message: the `length` field is 16 bits. */
const MAX_PLAINTEXT = 0xffff - CRC_LEN - 16 - 1 - 2;

type NodeBuffer = globalThis.Buffer;

/** The library's types are Node's `Buffer`; the bundle supplies its own class of the same shape (`node-shims.ts`). */
const nb = (bytes: Uint8Array | number[]): NodeBuffer =>
  Buffer.from(bytes as Uint8Array) as unknown as NodeBuffer;

const BUSY_GIVE_UP =
  'the Trezor is busy with another connection; close other Trezor programs (or the previous run) or reconnect the device';

const CONTROL = {
  initResponse: 0x01,
  completionResponse: 0x03,
  encrypted: 0x04,
  ack: 0x20,
  allocationResponse: 0x41,
  error: 0x42,
} as const;

/** After 0, 1, 2, ... retransmissions: 200 ms rising to about 3.5 s (the library's schedule is not exported; Core's is this). */
export function retransmitAfterMs(retry: number): number {
  const r = Math.min(Math.max(retry, 0), MAX_RETRANSMISSIONS - 1);
  return 10_300 - Math.floor(1_010_000 / (r + 100));
}

export type PairingState = 'unpaired' | 'paired' | 'paired_autoconnect';

/** What the device says about itself before the channel is encrypted. */
export type DeviceProperties = {
  internalModel: string;
  protocolVersion: readonly [number, number];
  /** `ThpPairingMethod` values the device offers. */
  pairingMethods: readonly number[];
};

/** A decrypted message of the device. */
export type DeviceMessage = { session: number; messageType: number; payload: Uint8Array };

/** What the link ignored or did, for tests and diagnostics. */
export type LinkStats = {
  retransmissions: number;
  busyBackoffs: number;
  duplicates: number;
  otherChannel: number;
  strayAcks: number;
  badChecksum: number;
  droppedPackets: number;
};

export type LinkOptions = {
  clock: Clock;
  /** Credentials stored on this computer, read before the handshake. */
  knownCredentials: readonly CredentialRecord[];
  signal?: AbortSignal;
};

type Outstanding = { packets: Uint8Array[]; ackBit?: number };

/**
 * Holds the one read the transport has outstanding. A wait that times out
 * leaves the read in place and the next wait takes up the same promise
 * (plan B11): a browser timeout does not cancel a USB transfer, so a second
 * read would steal the first one's packet.
 */
class PacketReader {
  private pending?: Promise<{ packet: Uint8Array } | { error: unknown }>;
  private closed = false;

  constructor(
    private readonly transport: Transport,
    private readonly clock: Clock,
  ) {}

  /** The next packet, or `undefined` once `timeoutMs` has passed. */
  async next(timeoutMs: number, signal?: AbortSignal): Promise<Uint8Array | undefined> {
    if (this.closed) throw new TrezorClosedError();
    if (signal?.aborted) throw new TrezorAbortedError();
    // The packet is copied as soon as the read settles: it may wait here until the next wait takes it, and a transport may reuse the array it returned.
    this.pending ??= this.transport.readPacket().then(
      (packet) => {
        try {
          return { packet: copyBytes(packet) };
        } catch (error) {
          return { error };
        }
      },
      (error: unknown) => ({ error }),
    );
    const waited = await waitFor(this.clock, this.pending, timeoutMs, signal);
    if (waited.kind === 'aborted') throw new TrezorAbortedError();
    if (waited.kind === 'timeout') return undefined;
    this.pending = undefined;
    if (this.closed) throw new TrezorClosedError();
    if ('error' in waited.value) {
      const cause = waited.value.error;
      if (cause instanceof TrezorError) throw cause;
      throw new TrezorTransportError(cause instanceof Error ? cause.message : String(cause), { cause, kind: transportKindOf(cause) });
    }
    return waited.value.packet;
  }

  markClosed(): void {
    this.closed = true;
  }
}

type LibraryError = { type: 'ThpError'; message: { code: string } };

export class Link {
  readonly stats: LinkStats = {
    retransmissions: 0,
    busyBackoffs: 0,
    duplicates: 0,
    otherChannel: 0,
    strayAcks: 0,
    badChecksum: 0,
    droppedPackets: 0,
  };

  private readonly clock: Clock;
  private readonly reader: PacketReader;
  private readonly assembler = new FrameAssembler(MAX_INBOUND_LENGTH);
  private readonly state = new thp.ThpState();
  private readonly inbox: DeviceMessage[] = [];
  private phase: 'allocation' | 'handshake' | 'transport' = 'allocation';
  private channelId = 0xffff;
  private outstanding?: Outstanding;
  private busySince?: number;
  private busyWait: number = BUSY_POLICY.firstWaitMs;
  private closed = false;
  private writesBegun = 0;

  private deviceProperties?: DeviceProperties;
  private devicePairingState: PairingState = 'unpaired';
  private matched = false;
  private hostPrivate = new Uint8Array(32);
  private hostPublic = new Uint8Array(32);
  private hash = new Uint8Array(32);

  private constructor(
    private readonly transport: Transport,
    options: LinkOptions,
  ) {
    this.clock = options.clock;
    this.reader = new PacketReader(transport, options.clock);
  }

  /**
   * Allocates a channel and runs the handshake. The credentials (the array and
   * every field of every record) and the signal are copied or read here, once:
   * the channel allocation and the handshake wait for the device.
   */
  static async open(transport: Transport, options: LinkOptions): Promise<Link> {
    const link = new Link(transport, options);
    try {
      const known = options.knownCredentials.map(copyRecord);
      const signal = options.signal;
      await link.handshake(known, signal);
      return link;
    } catch (error) {
      await link.close();
      throw error;
    }
  }

  get properties(): DeviceProperties {
    return this.deviceProperties as DeviceProperties;
  }

  /** What the device's handshake answer says. Taken alone it is a claim; see {@link credentialMatched}. */
  get pairingState(): PairingState {
    return this.devicePairingState;
  }

  /** Whether the handshake sent a stored credential: whether this computer has a record of the device. */
  get credentialMatched(): boolean {
    return this.matched;
  }

  /** The handshake hash of the channel (mixed into the pairing code). */
  get handshakeHash(): Uint8Array {
    return this.hash.slice();
  }

  /** The host static private key of this channel, as the library used it (a stored one, or a fresh one). */
  get hostStaticPrivateKey(): Uint8Array {
    return this.hostPrivate.slice();
  }

  get hostStaticPublicKey(): Uint8Array {
    return this.hostPublic.slice();
  }

  get isClosed(): boolean {
    return this.closed;
  }

  /**
   * How many packet writes this link has started. A request is on its way to
   * the device once this has grown during its sending: a failure before that
   * left the device untouched.
   */
  get writesStarted(): number {
    return this.writesBegun;
  }

  /** The number of messages sent on this channel (the library's send counter). */
  get sendCounter(): number {
    return this.state.sendNonce;
  }

  /** Cancels the read, releases the device, and discards channel, keys and unread messages. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.reader.markClosed();
    this.inbox.length = 0;
    this.outstanding = undefined;
    this.hostPrivate.fill(0);
    try {
      this.state.resetState();
    } catch {
      // The state holds nothing the device could use once the link is closed.
    }
    try {
      await this.transport.close();
    } catch {
      // Closing is best effort: the device is released or gone.
    }
  }

  /**
   * Sends one message and waits until the device acknowledges it,
   * retransmitting the same ciphertext when the acknowledgement does not come.
   * This is the raw channel: its errors carry no `outcomeUnknown` flag of the
   * request that the message belongs to (a time-out of the acknowledgement
   * does). The client sets that flag for the requests it makes.
   */
  async send(session: number, messageType: number, payload: Uint8Array, signal?: AbortSignal): Promise<void> {
    return this.guarded(async () => {
      this.ensureOpen();
      if (this.phase !== 'transport') throw new TrezorProtocolError('the channel is not ready for messages');
      if (payload.length > MAX_PLAINTEXT) {
        throw new TrezorProtocolError(`a message of ${payload.length} bytes does not fit one frame`);
      }
      if (this.state.sendNonce >= COUNTER_LIMIT) {
        throw new TrezorProtocolError(
          'the message counter of this channel reached 2^31; connect again to start a new channel',
        );
      }
      this.state.setSessionId(nb([session & 0xff]));
      const frame = thp.encodeProtobufMessage(
        messageType,
        nb(payload),
        this.state.channel,
        this.state,
      );
      const ackBit = this.state.sendBit;
      this.state.sync('send', 'ThpEncrypted' as never);
      this.outstanding = { packets: splitFrame(frame), ackBit };
      await this.awaitAck(signal);
    });
  }

  /** Waits for the next message of the device and acknowledges it (it is acknowledged when it arrives). */
  async receive(timeoutMs: number, waitingFor: string, signal?: AbortSignal): Promise<DeviceMessage> {
    return this.guarded(async () => {
      this.ensureOpen();
      const deadline = this.clock.now() + timeoutMs;
      for (;;) {
        const message = this.inbox.shift();
        if (message) {
          this.busyOver();
          return message;
        }
        const frame = await this.readFrame(deadline, signal);
        if (!frame) throw new TrezorTimeoutError(waitingFor, 'answer');
        if ((await this.dispatch(frame, signal)) === 'busy') await this.backOffBusy(signal);
      }
    });
  }

  // ---- handshake ----

  private async handshake(known: readonly CredentialRecord[], signal?: AbortSignal): Promise<void> {
    const state = this.state;
    state.setChannel(nb([0xff, 0xff]));

    // 1. Channel allocation: a broadcast request with a random nonce; the
    //    response that carries the same nonce is ours.
    const nonce = randomBytes(8) as unknown as NodeBuffer;
    const request = thp.encode({
      messageName: 'ThpCreateChannelRequest',
      data: { nonce: toHex(nonce) },
      protobufEncoder,
      thpState: state,
    } as never);
    const allocated = await this.exchange(
      request,
      ALLOCATION_TIMEOUT_MS,
      'channel allocation',
      'allocation',
      (frame) => {
        if (frame.control !== CONTROL.allocationResponse) return undefined;
        const out = this.decode(frame) as unknown as {
          message: { nonce: NodeBuffer; channel: NodeBuffer; properties: unknown; handshakeHash: NodeBuffer };
        };
        return equalBytes(out.message.nonce, nonce) ? out.message : undefined;
      },
      signal,
    );
    const props = allocated.properties as {
      internal_model: string;
      protocol_version_major: number;
      protocol_version_minor: number;
      pairing_methods?: number[];
    };
    state.setThpProperties(props as never);
    state.setChannel(nb(allocated.channel));
    state.updateHandshakeCredentials({ handshakeHash: allocated.handshakeHash } as never);
    this.channelId = (allocated.channel[0] << 8) | allocated.channel[1];
    this.phase = 'handshake';
    this.deviceProperties = {
      internalModel: props.internal_model,
      protocolVersion: [props.protocol_version_major, props.protocol_version_minor],
      pairingMethods: props.pairing_methods ?? [],
    };

    // 2. Initiation: our ephemeral key; the device's ephemeral and encrypted
    //    static keys come back. "Try to unlock" lets a locked device ask its
    //    user instead of refusing.
    const ephemeral = thp.getCurve25519KeyPair(randomBytes(32) as unknown as NodeBuffer);
    const init = thp.encode({
      messageName: 'ThpHandshakeInitRequest',
      data: { key: toHex(ephemeral.publicKey), tryToUnlock: 1 },
      protobufEncoder,
      thpState: state,
    } as never);
    state.sync('send', 'ThpHandshakeInitRequest');
    const initResponse = await this.exchange(
      init,
      HANDSHAKE_TIMEOUT_MS,
      'handshake',
      'handshake',
      (frame) => {
        if ((frame.control & 0xe7) !== CONTROL.initResponse) return undefined;
        this.checkHandshakeLength(frame, HANDSHAKE_INIT_RESPONSE_LEN, 'handshake initiation response');
        return this.decode(frame).message;
      },
      signal,
    );
    state.sync('recv', 'ThpHandshakeInitResponse');

    // 3. The Noise handshake, with the stored credential the device's masked
    //    key matches, if any. A credential that does not fit the completion
    //    payload (over 126 bytes) is never used, even when it is the first
    //    match: the handshake is then made again with a fresh key, which makes
    //    the device pair, as the Rust host does.
    const toLibrary = (r: CredentialRecord): Record<string, string> => ({
      trezor_static_public_key: toHex(r.trezorStaticPubkey),
      host_static_key: toHex(r.hostStaticPrivkey),
      credential: toHex(r.credential),
    });
    const run = (list: readonly CredentialRecord[]): ReturnType<typeof thp.handleHandshakeInit> =>
      thp.handleHandshakeInit({
        handshakeInitResponse: initResponse,
        thpState: state,
        knownCredentials: list.map(toLibrary),
        hostEphemeralKeys: ephemeral,
        tryToUnlock: 1,
        protobufEncoder,
      } as never);
    let hs: ReturnType<typeof thp.handleHandshakeInit>;
    try {
      hs = run(known);
      const first = hs.credentials as { credential: string } | undefined;
      if (first && first.credential.length / 2 > MAX_CREDENTIAL_LEN) hs = run([]);
    } catch (error) {
      throw new TrezorProtocolError('the handshake did not verify', { cause: error });
    }
    this.matched = hs.credentials !== undefined;
    this.hostPrivate = Uint8Array.from(hs.staticKey);
    this.hostPublic = Uint8Array.from(hs.hostStaticKeys.publicKey);
    this.hash = Uint8Array.from(hs.handshakeHash);

    state.updateHandshakeCredentials({
      hostKey: hs.hostKey,
      trezorKey: hs.trezorKey,
      handshakeHash: hs.handshakeHash,
    } as never);
    const completion = thp.encode({
      messageName: 'ThpHandshakeCompletionRequest',
      data: { hostPubkey: toHex(hs.hostEncryptedStaticPubkey), encryptedPayload: toHex(hs.encryptedPayload) },
      protobufEncoder,
      thpState: state,
    } as never);
    state.sync('send', 'ThpHandshakeCompletionRequest');
    const answer = await this.exchange(
      completion,
      HANDSHAKE_TIMEOUT_MS,
      'handshake',
      'handshake',
      (frame) => {
        if ((frame.control & 0xe7) !== CONTROL.completionResponse) return undefined;
        this.checkHandshakeLength(frame, HANDSHAKE_COMPLETION_RESPONSE_LEN, 'handshake completion response');
        let decoded: { message: { state: number } };
        try {
          decoded = this.decode(frame) as never;
        } catch (error) {
          throw new TrezorProtocolError('the handshake answer did not verify', { cause: error });
        }
        return { pairing: decoded.message.state, seqBit: (frame.control >> 4) & 1 };
      },
      signal,
    );
    state.sync('recv', 'ThpHandshakeCompletionResponse');
    const names: PairingState[] = ['unpaired', 'paired', 'paired_autoconnect'];
    const pairing = names[answer.pairing];
    if (!pairing) throw new TrezorProtocolError(`the device reported pairing state ${answer.pairing}`);
    this.devicePairingState = pairing;
    this.phase = 'transport';
    state.enablePiggybackAck(true);
    // The completion response is acknowledged by itself, not by the next message.
    await this.writeAck(answer.seqBit, signal);
  }

  /**
   * Sends a frame and waits for the response `match` accepts. The handshake
   * and the allocation are not acknowledged separately: the response is the
   * acknowledgement. Only `TRANSPORT_BUSY` makes the request go out again.
   */
  private async exchange<T>(
    frame: Uint8Array,
    timeoutMs: number,
    waitingFor: string,
    kind: 'allocation' | 'handshake',
    match: (frame: Frame) => T | undefined,
    signal?: AbortSignal,
  ): Promise<T> {
    const packets = splitFrame(frame);
    this.outstanding = { packets };
    await this.writePackets(packets, signal);
    const deadline = this.clock.now() + timeoutMs;
    for (;;) {
      const incoming = await this.readFrame(deadline, signal);
      if (!incoming) throw new TrezorTimeoutError(waitingFor, kind, { outcomeUnknown: false });
      if (incoming.control === CONTROL.error) {
        if (this.onError(incoming) === 'busy') await this.backOffBusy(signal);
        continue;
      }
      const matched = match(incoming);
      if (matched !== undefined) {
        this.outstanding = undefined;
        this.busyOver();
        return matched;
      }
    }
  }

  // ---- sending ----

  private async awaitAck(signal?: AbortSignal): Promise<void> {
    const out = this.outstanding as Outstanding;
    let started = this.clock.now();
    let retry = 0;
    await this.writePackets(out.packets, signal);
    for (;;) {
      let deadline = this.clock.now() + retransmitAfterMs(retry);
      for (;;) {
        const frame = await this.readFrame(deadline, signal);
        if (!frame) break;
        if ((await this.dispatch(frame, signal)) === 'busy') {
          // The message was refused: the busy wait is not the device failing to acknowledge.
          await this.backOffBusy(signal);
          started = this.clock.now();
          retry = 0;
          deadline = this.clock.now() + retransmitAfterMs(retry);
          continue;
        }
        if (this.outstanding === undefined) return;
      }
      if (this.clock.now() - started > ACK_BUDGET_MS) {
        throw new TrezorTimeoutError('the device stopped acknowledging', 'ack', { outcomeUnknown: true });
      }
      retry++;
      if (retry > MAX_RETRANSMISSIONS) {
        throw new TrezorTimeoutError('the device stopped acknowledging', 'ack', { outcomeUnknown: true });
      }
      // The same packets, byte for byte: a retransmission is the same ciphertext.
      this.stats.retransmissions++;
      await this.writePackets(out.packets, signal);
    }
  }

  /**
   * The device said `TRANSPORT_BUSY`: waits (backing off) and sends the
   * outstanding message again. Gives up with an error a person can act on
   * once the total wait would pass the budget.
   */
  private async backOffBusy(signal?: AbortSignal): Promise<void> {
    const out = this.outstanding;
    if (!out) return;
    this.busySince ??= this.clock.now();
    const wait = this.busyWait;
    if (this.clock.now() - this.busySince + wait > BUSY_POLICY.budgetMs) {
      throw new TrezorTimeoutError(BUSY_GIVE_UP, 'busy');
    }
    this.stats.busyBackoffs++;
    if (!(await sleep(this.clock, wait, signal))) throw new TrezorAbortedError();
    this.ensureOpen();
    this.busyWait = Math.min(wait * 2, BUSY_POLICY.longestWaitMs);
    this.stats.retransmissions++;
    await this.writePackets(out.packets, signal);
  }

  /** The exchange moved on: the next busy answer starts a new budget. */
  private busyOver(): void {
    this.busySince = undefined;
    this.busyWait = BUSY_POLICY.firstWaitMs;
  }

  // ---- receiving ----

  /** The next complete, checksummed frame of our channel, or `undefined` when `deadline` passes. */
  private async readFrame(deadline: number, signal?: AbortSignal): Promise<Frame | undefined> {
    for (;;) {
      this.ensureOpen();
      const left = deadline - this.clock.now();
      if (left <= 0) return undefined;
      const packet = await this.reader.next(left, signal);
      if (packet === undefined) return undefined;
      const frame = this.accept(packet);
      if (frame) return frame;
    }
  }

  /** Filters by channel, reassembles and checks the checksum. */
  private accept(packet: Uint8Array): Frame | undefined {
    if (packet.length !== PACKET_LEN) {
      this.stats.droppedPackets++;
      return undefined;
    }
    if (packet[0] !== 0x80) {
      const channel = (packet[1] << 8) | packet[2];
      // Before the channel is known only the broadcast channel is listened to;
      // afterwards a packet of another channel (a previous run's leftovers,
      // another host's allocation) is not ours.
      const ours = this.phase === 'allocation' ? channel === 0xffff : channel === this.channelId;
      if (!ours) {
        this.stats.otherChannel++;
        return undefined;
      }
    }
    let frame: Frame | undefined;
    const before = this.assembler.dropped;
    try {
      frame = this.assembler.push(packet);
    } catch (error) {
      if (error instanceof DeclaredLengthError) throw new TrezorProtocolError(error.message);
      throw error;
    }
    this.stats.droppedPackets += this.assembler.dropped - before;
    if (!frame) return undefined;
    try {
      thp.validateCrc({ header: nb(frame.header), length: frame.length, payload: nb(frame.body) } as never);
    } catch {
      this.stats.badChecksum++;
      return undefined;
    }
    return frame;
  }

  /** The library's decoder for the frames it can decode (not the encrypted ones: it drops the session byte). */
  private decode(frame: Frame): { type: string; message: unknown } {
    const messageType = v2.decodeCtrlByte(frame.control);
    if (messageType === undefined) throw new TrezorProtocolError(`unknown control byte ${frame.control}`);
    return thp.decode(
      {
        header: nb(frame.header),
        chunkHeader: nb([0x80, frame.channel[0], frame.channel[1]]),
        length: frame.length,
        messageType,
        payload: nb(frame.body),
      } as never,
      protobufDecoder as never,
      this.state,
    ) as never;
  }

  /** Reads a `ThpError` frame: `'busy'` for `TRANSPORT_BUSY`, an exception for the rest. */
  private onError(frame: Frame): 'busy' {
    const out = this.decode(frame) as unknown as LibraryError;
    switch (out.message.code) {
      case 'ThpTransportBusy':
        return 'busy';
      case 'ThpDeviceLocked':
        throw new TrezorDeviceLockedError();
      case 'ThpUnallocatedChannel':
        throw new TrezorProtocolError('the device reported TRANSPORT_UNALLOCATED_CHANNEL');
      case 'ThpDecryptionFailed':
        throw new TrezorProtocolError('the device reported DECRYPTION_FAILED');
      default:
        throw new TrezorProtocolError('the device reported an unknown error');
    }
  }

  /** What one frame does once the channel carries messages. */
  private async dispatch(frame: Frame, signal?: AbortSignal): Promise<'busy' | undefined> {
    const control = frame.control;
    if (control === CONTROL.error) return this.onError(frame);
    if ((control & 0xf7) === CONTROL.ack) {
      this.onAckBit((control >> 3) & 1);
      return undefined;
    }
    if ((control & 0xe7) === CONTROL.encrypted) {
      await this.onEncrypted(frame, signal);
      return undefined;
    }
    if ((control & 0xe7) === CONTROL.completionResponse) {
      // The device repeats its completion response when our acknowledgement
      // was lost: acknowledge it again, deliver nothing.
      const seq = (control >> 4) & 1;
      if (seq !== this.state.recvBit) {
        this.stats.duplicates++;
        await this.writeAck(seq, signal);
      } else this.stats.strayAcks++;
      return undefined;
    }
    this.stats.strayAcks++;
    return undefined;
  }

  private onAckBit(bit: number): void {
    const out = this.outstanding;
    if (out && out.ackBit === bit) {
      this.outstanding = undefined;
      this.busyOver();
    } else {
      this.stats.strayAcks++;
    }
  }

  private async onEncrypted(frame: Frame, signal?: AbortSignal): Promise<void> {
    const ackBit = (frame.control >> 3) & 1;
    const seqBit = (frame.control >> 4) & 1;
    if (seqBit !== this.state.recvBit) {
      // A message already delivered, sent again because our acknowledgement
      // did not reach the device: acknowledge it again and deliver nothing.
      this.stats.duplicates++;
      await this.writeAck(seqBit, signal);
      return;
    }
    if (this.state.recvNonce >= COUNTER_LIMIT) {
      throw new TrezorProtocolError('the message counter of this channel reached 2^31; connect again');
    }
    const tagStart = frame.length - CRC_LEN - 16;
    if (tagStart < 3) throw new TrezorProtocolError('an encrypted message is too short');
    let plain: Uint8Array;
    try {
      const keys = this.state.handshakeCredentials as unknown as { trezorKey: NodeBuffer };
      const aes = thpCrypto.aesgcm(keys.trezorKey, thpCrypto.getIvFromNonce(this.state.recvNonce));
      aes.auth(nb([]));
      plain = aes.decrypt(
        nb(frame.body.subarray(0, tagStart)),
        nb(frame.body.subarray(tagStart, tagStart + 16)),
      );
    } catch (error) {
      throw new TrezorProtocolError('a message of the device did not verify', { cause: error });
    }
    this.state.sync('recv', 'ThpEncrypted' as never);
    // A message that carries the acknowledgement of ours counts as one.
    if (this.state.isPiggybackAckEnabled) this.onAckBit(ackBit);
    this.inbox.push({ session: plain[0], messageType: (plain[1] << 8) | plain[2], payload: copyBytes(plain.subarray(3)) });
    await this.writeAck(seqBit, signal);
  }

  // ---- packets ----

  private async writeAck(bit: number, signal?: AbortSignal): Promise<void> {
    const frame = thp.encodeAck({ recvAckBit: bit, channel: this.state.channel } as never);
    await this.writePackets(splitFrame(frame), signal);
  }

  /**
   * Writes the packets of one frame, in order. The signal is looked at before
   * every packet and while a write is pending: an abort stops the frame there
   * (the link is closed by the caller's guard, which releases the transport and
   * so ends the transfer in flight), so that no packet is written after it. A
   * request cut off after its first packet may still have reached the device;
   * the client reports that as an unknown outcome.
   */
  private async writePackets(packets: readonly Uint8Array[], signal?: AbortSignal): Promise<void> {
    for (const packet of packets) {
      this.ensureOpen();
      if (signal?.aborted) throw new TrezorAbortedError();
      this.writesBegun++;
      try {
        await abortable(this.transport.writePacket(packet), signal, () => new TrezorAbortedError());
      } catch (error) {
        if (error instanceof TrezorError) throw error;
        throw new TrezorTransportError(error instanceof Error ? error.message : String(error), {
          cause: error,
          kind: transportKindOf(error),
        });
      }
    }
  }

  /** The handshake's answers have an exact length (before their checksum); a longer or shorter one is a protocol error. */
  private checkHandshakeLength(frame: Frame, expected: number, what: string): void {
    const length = frame.length - CRC_LEN;
    if (length !== expected) {
      throw new TrezorProtocolError(`the device's ${what} has ${length} bytes, the protocol has exactly ${expected}`);
    }
  }

  private ensureOpen(): void {
    if (this.closed) throw new TrezorClosedError();
  }

  /** Runs an operation; any error ends the link. */
  private async guarded<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      await this.close();
      throw error;
    }
  }
}
