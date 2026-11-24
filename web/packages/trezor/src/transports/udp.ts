/**
 * The Trezor emulator's UDP transport, for Node (`node:dgram`). The emulator
 * speaks 64-byte packets over UDP on one port (21324 by default); it answers
 * `PINGPING` with `PONGPONG` outside the protocol.
 *
 * This is the only transport that says it is the emulator
 * (`isEmulator`), and so the only one on which pairing may be skipped, and
 * only when the caller asks for it. It is not a device: anything that answers
 * the ping on the port is taken for one.
 */
import { createSocket, type Socket } from 'node:dgram';

import type { Transport } from '../transport';

const PACKET_LEN = 64;
const PING = new TextEncoder().encode('PINGPING');
const PONG = 'PONGPONG';
const PING_TIMEOUT_MS = 500;

/** Failures of this transport; the link wraps them as `TrezorTransportError`. */
export class UdpTransportError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'UdpTransportError';
    if (options?.cause !== undefined) {
      // ES2022 `Error.cause`, set by hand because the build targets ES2020.
      Object.defineProperty(this, 'cause', { value: options.cause, enumerable: false, writable: true });
    }
  }
}

/**
 * How many datagrams the transport keeps for a reader that is not reading (the
 * link reads one at a time, and not at all while the person types the pairing
 * code). A device does not talk unasked; a peer that fills the queue past this
 * is not one.
 */
export const UDP_QUEUE_LIMIT = 1024;

/**
 * The peer sent more datagrams than {@link UDP_QUEUE_LIMIT} (or the configured
 * bound) while nobody was reading. The transport fails with this and keeps
 * nothing more: the datagrams already queued are dropped, and every later
 * call fails with the same error.
 */
export class UdpQueueFullError extends UdpTransportError {
  /** The bound that was passed. */
  readonly limit: number;

  constructor(address: string, limit: number) {
    super(`emulator at ${address}: more than ${limit} packets arrived while nothing was reading them; the peer is not behaving like a device`);
    this.name = 'UdpQueueFullError';
    this.limit = limit;
  }
}

export type UdpTransportOptions = {
  /** `host:port` of the emulator. */
  address?: string;
  /** Milliseconds to wait for the answer to the ping. */
  pingTimeoutMs?: number;
  /** The most unread datagrams to keep: a whole number of at least 1. Default {@link UDP_QUEUE_LIMIT}. */
  maxQueuedPackets?: number;
};

export class UdpTransport implements Transport {
  /** The emulator's default address. */
  static readonly DEFAULT_ADDRESS = '127.0.0.1:21324';

  readonly isEmulator = true;

  private readonly queue: Uint8Array[] = [];
  private waiter?: { resolve: (packet: Uint8Array) => void; reject: (error: Error) => void };
  private failure?: Error;
  private closed = false;
  private onPong?: () => void;

  private constructor(
    private readonly socket: Socket,
    private readonly address: string,
    private readonly maxQueued: number,
  ) {
    socket.on('message', (message: Uint8Array) => this.onMessage(message));
    socket.on('error', (error: Error) => this.fail(new UdpTransportError(`emulator at ${address}: ${error.message}`, { cause: error })));
  }

  /** Connects to the emulator and checks that it answers. */
  static async connect(options: UdpTransportOptions = {}): Promise<UdpTransport> {
    const address = options.address ?? UdpTransport.DEFAULT_ADDRESS;
    const separator = address.lastIndexOf(':');
    const host = address.slice(0, separator);
    const port = Number(address.slice(separator + 1));
    if (separator <= 0 || !Number.isInteger(port) || port < 1 || port > 65535) {
      throw new UdpTransportError(`not a host:port address: ${address}`);
    }
    // A bound that is not a whole number (NaN, infinity, a fraction) would never be reached, and so would not bound anything.
    const maxQueued = options.maxQueuedPackets ?? UDP_QUEUE_LIMIT;
    if (!Number.isSafeInteger(maxQueued) || maxQueued < 1) {
      throw new UdpTransportError(
        `maxQueuedPackets must be a whole number of at least 1, not ${typeof maxQueued === 'number' ? String(maxQueued) : typeof maxQueued}`,
      );
    }
    const socket = createSocket('udp4');
    const transport = new UdpTransport(socket, address, maxQueued);
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once('error', reject);
        socket.bind(0, '127.0.0.1', () => {
          socket.connect(port, host, () => {
            socket.off('error', reject);
            resolve();
          });
        });
      });
      await transport.ping(options.pingTimeoutMs ?? PING_TIMEOUT_MS);
    } catch (error) {
      await transport.close();
      if (error instanceof UdpTransportError) throw error;
      throw new UdpTransportError(`emulator at ${address}: ${error instanceof Error ? error.message : String(error)}`, {
        cause: error,
      });
    }
    return transport;
  }

  private ping(timeoutMs: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.onPong = undefined;
        reject(new UdpTransportError(`no emulator answers at ${this.address}`));
      }, timeoutMs);
      this.onPong = () => {
        clearTimeout(timer);
        this.onPong = undefined;
        resolve();
      };
      this.socket.send(PING, (error) => {
        if (error) {
          clearTimeout(timer);
          reject(error);
        }
      });
    });
  }

  private onMessage(message: Uint8Array): void {
    if (this.onPong && Buffer.from(message).toString('latin1') === PONG) {
      this.onPong();
      return;
    }
    // Once the transport has failed or is closed it keeps nothing more.
    if (this.failure || this.closed || message.length !== PACKET_LEN) return;
    const packet = Uint8Array.from(message);
    if (this.waiter) {
      const { resolve } = this.waiter;
      this.waiter = undefined;
      resolve(packet);
    } else if (this.queue.length >= this.maxQueued) {
      this.queue.length = 0;
      this.fail(new UdpQueueFullError(this.address, this.maxQueued));
    } else {
      this.queue.push(packet);
    }
  }

  private fail(error: Error): void {
    this.failure ??= error;
    if (this.waiter) {
      const { reject } = this.waiter;
      this.waiter = undefined;
      reject(error);
    }
    if (this.onPong) this.onPong = undefined;
  }

  async writePacket(packet: Uint8Array): Promise<void> {
    if (this.closed) throw new UdpTransportError('the transport is closed');
    if (this.failure) throw this.failure;
    if (packet.length !== PACKET_LEN) throw new UdpTransportError(`a packet is ${PACKET_LEN} bytes`);
    // Sent from a copy of its own: the datagram may wait in the socket's queue.
    const datagram = Uint8Array.from(packet);
    await new Promise<void>((resolve, reject) => {
      this.socket.send(datagram, (error) => (error ? reject(error) : resolve()));
    });
  }

  readPacket(): Promise<Uint8Array> {
    if (this.closed) return Promise.reject(new UdpTransportError('the transport is closed'));
    const queued = this.queue.shift();
    if (queued) return Promise.resolve(queued);
    if (this.failure) return Promise.reject(this.failure);
    if (this.waiter) return Promise.reject(new UdpTransportError('a read is already outstanding'));
    return new Promise<Uint8Array>((resolve, reject) => {
      this.waiter = { resolve, reject };
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.queue.length = 0;
    if (this.waiter) {
      const { reject } = this.waiter;
      this.waiter = undefined;
      reject(new UdpTransportError('the transport is closed'));
    }
    await new Promise<void>((resolve) => {
      try {
        this.socket.close(() => resolve());
      } catch {
        resolve();
      }
    });
  }
}
