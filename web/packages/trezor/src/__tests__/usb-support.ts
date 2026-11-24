/**
 * Fakes for the USB checks: a USB device whose transfers the test completes
 * or fails by hand, and a `navigator.usb` that lists such devices. They
 * implement the structural types of `transports/webusb.ts`, uses no Node API,
 * and behave as the browser's objects do where it matters: a transfer that is
 * pending when the device closes is aborted, and a transfer on an unplugged
 * device fails with `NotFoundError`.
 */
import type {
  UsbConfigurationLike,
  UsbDeviceLike,
  UsbFilter,
  UsbInResultLike,
  UsbLike,
  UsbOutResultLike,
} from '../webusb';

/** A DOMException-like error with the name a browser gives it. */
export function named(name: string, message: string): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

export const packet = (fill: number, length = 64): Uint8Array => new Uint8Array(length).fill(fill);

/** The descriptors of the Trezor's protocol interface: vendor class, interrupt endpoints 1 in and 1 out, 64 bytes. */
export function trezorConfiguration(
  change: { interfaceClass?: number; packetSize?: number; type?: 'bulk' | 'interrupt'; withoutIn?: boolean; interfaceNumber?: number } = {},
): UsbConfigurationLike {
  const endpoint = (direction: 'in' | 'out') => ({
    endpointNumber: 1,
    direction,
    type: change.type ?? 'interrupt',
    packetSize: change.packetSize ?? 64,
  });
  return {
    configurationValue: 1,
    interfaces: [
      {
        interfaceNumber: change.interfaceNumber ?? 0,
        alternate: {
          alternateSetting: 0,
          interfaceClass: change.interfaceClass ?? 0xff,
          endpoints: change.withoutIn ? [endpoint('out')] : [endpoint('out'), endpoint('in')],
        },
      },
    ],
  };
}

type PendingIn = { resolve: (result: UsbInResultLike) => void; reject: (error: Error) => void };
type PendingOut = { bytes: Uint8Array; resolve: (result: UsbOutResultLike) => void; reject: (error: Error) => void };

export type FakeDeviceOptions = {
  vendorId?: number;
  productId?: number;
  /** No active configuration until `selectConfiguration` is called. */
  unconfigured?: boolean;
  configuration?: UsbConfigurationLike;
  /** `open`, `selectConfiguration` or `claimInterface` fails with this. */
  failOpen?: Error;
  failSelect?: Error;
  failClaim?: Error;
  /** `close` never finishes (a driver stuck on a transfer). */
  closeHangs?: boolean;
};

export class FakeUsbDevice implements UsbDeviceLike {
  readonly vendorId: number;
  readonly productId: number;
  opened = false;
  configuration: UsbConfigurationLike | null;
  readonly configurations: UsbConfigurationLike[];
  /** Everything the transport did to the device, in order. */
  readonly log: string[] = [];
  /** How many IN transfers were started. */
  inTransfers = 0;
  /** The most OUT transfers in flight at once. */
  maxOutInFlight = 0;
  /** What the transport wrote, in order of completion. */
  readonly written: Uint8Array[] = [];
  unplugged = false;
  /** How `transferOut` behaves: completes at once, waits for `completeOut`, or never completes. */
  outMode: 'immediate' | 'manual' | 'hang' = 'immediate';
  private readonly pendingIn: PendingIn[] = [];
  private readonly pendingOut: PendingOut[] = [];
  private readonly arrived: Array<Uint8Array | { raw: UsbInResultLike }> = [];
  private outInFlight = 0;

  constructor(private readonly options: FakeDeviceOptions = {}) {
    this.vendorId = options.vendorId ?? 0x1209;
    this.productId = options.productId ?? 0x53c1;
    this.configurations = [options.configuration ?? trezorConfiguration()];
    this.configuration = options.unconfigured ? null : this.configurations[0];
  }

  async open(): Promise<void> {
    this.log.push('open');
    if (this.options.failOpen) throw this.options.failOpen;
    this.opened = true;
  }

  async close(): Promise<void> {
    this.log.push('close');
    this.opened = false;
    // A browser aborts the transfers that are pending when the device closes.
    for (const pending of this.pendingIn.splice(0)) pending.reject(named('AbortError', 'the transfer was aborted'));
    for (const pending of this.pendingOut.splice(0)) pending.reject(named('AbortError', 'the transfer was aborted'));
    if (this.options.closeHangs) await new Promise<never>(() => undefined);
  }

  async selectConfiguration(value: number): Promise<void> {
    this.log.push(`selectConfiguration ${value}`);
    if (this.options.failSelect) throw this.options.failSelect;
    this.configuration = this.configurations.find((c) => c.configurationValue === value) ?? null;
  }

  async claimInterface(number: number): Promise<void> {
    this.log.push(`claimInterface ${number}`);
    if (this.options.failClaim) throw this.options.failClaim;
  }

  async releaseInterface(number: number): Promise<void> {
    this.log.push(`releaseInterface ${number}`);
  }

  transferIn(endpoint: number, length: number): Promise<UsbInResultLike> {
    this.log.push(`transferIn ${endpoint} ${length}`);
    this.inTransfers++;
    if (this.unplugged) return Promise.reject(named('NotFoundError', 'The device was disconnected.'));
    const arrived = this.arrived.shift();
    if (arrived) return Promise.resolve(this.asResult(arrived));
    return new Promise<UsbInResultLike>((resolve, reject) => this.pendingIn.push({ resolve, reject }));
  }

  transferOut(endpoint: number, data: Uint8Array): Promise<UsbOutResultLike> {
    this.log.push(`transferOut ${endpoint} ${data.length}`);
    this.outInFlight++;
    this.maxOutInFlight = Math.max(this.maxOutInFlight, this.outInFlight);
    const finish = <T>(value: T): T => {
      this.outInFlight--;
      return value;
    };
    if (this.unplugged) {
      this.outInFlight--;
      return Promise.reject(named('NotFoundError', 'The device was disconnected.'));
    }
    if (this.outMode === 'immediate') {
      this.written.push(data.slice());
      return Promise.resolve(finish({ status: 'ok', bytesWritten: data.length } as UsbOutResultLike));
    }
    if (this.outMode === 'hang') return new Promise<never>(() => undefined);
    return new Promise<UsbOutResultLike>((resolve, reject) =>
      this.pendingOut.push({
        bytes: data.slice(),
        resolve: (result) => resolve(finish(result)),
        reject: (error) => {
          this.outInFlight--;
          reject(error);
        },
      }),
    );
  }

  // ---- what the test does to the device ----

  /** The device sends `bytes`: the pending IN transfer completes, or the packet waits for the next one. */
  send(bytes: Uint8Array): void {
    this.deliver(bytes);
  }

  /** The device ends the pending IN transfer with a raw result (a stall, a babble, a short packet). */
  sendRaw(result: UsbInResultLike): void {
    this.deliver({ raw: result });
  }

  /** A DataView of `bytes`, as a browser hands one over. */
  static view(bytes: Uint8Array): DataView {
    const buffer = new ArrayBuffer(bytes.length + 8);
    new Uint8Array(buffer, 4, bytes.length).set(bytes);
    return new DataView(buffer, 4, bytes.length);
  }

  private deliver(item: Uint8Array | { raw: UsbInResultLike }): void {
    const pending = this.pendingIn.shift();
    if (pending) pending.resolve(this.asResult(item));
    else this.arrived.push(item);
  }

  private asResult(item: Uint8Array | { raw: UsbInResultLike }): UsbInResultLike {
    return item instanceof Uint8Array ? { status: 'ok', data: FakeUsbDevice.view(item) } : item.raw;
  }

  /** Completes the oldest OUT transfer that is waiting (`outMode` `manual`). */
  completeOut(result: UsbOutResultLike = { status: 'ok', bytesWritten: 64 }): Uint8Array {
    const pending = this.pendingOut.shift();
    if (!pending) throw new Error('no OUT transfer is waiting');
    if (result.status === 'ok') this.written.push(pending.bytes);
    pending.resolve(result);
    return pending.bytes;
  }

  get waitingOut(): number {
    return this.pendingOut.length;
  }

  get waitingIn(): number {
    return this.pendingIn.length;
  }

  /** The cable is pulled: pending and later transfers fail as a browser's do. */
  unplug(): void {
    this.unplugged = true;
    for (const pending of this.pendingIn.splice(0)) pending.reject(named('NotFoundError', 'The device was disconnected.'));
    for (const pending of this.pendingOut.splice(0)) pending.reject(named('NotFoundError', 'The device was disconnected.'));
  }
}

type Listener = (event: { device: UsbDeviceLike }) => void;

/** `navigator.usb` over a list of fake devices. */
export class FakeUsb implements UsbLike {
  readonly requests: Array<{ filters: UsbFilter[] }> = [];
  private readonly listeners = new Set<Listener>();
  /** What `requestDevice` does: pick the first match, or fail with this. */
  requestFailure?: Error;
  getDevicesFailure?: Error;
  /** Which of `devices` the origin has permission for (`getDevices`); all by default. */
  granted?: UsbDeviceLike[];

  constructor(readonly devices: FakeUsbDevice[]) {}

  async requestDevice(options: { filters: UsbFilter[] }): Promise<UsbDeviceLike> {
    this.requests.push({ filters: options.filters.map((f) => ({ ...f })) });
    if (this.requestFailure) throw this.requestFailure;
    const found = this.devices.find((d) =>
      options.filters.some((f) => (f.vendorId === undefined || f.vendorId === d.vendorId) && (f.productId === undefined || f.productId === d.productId)),
    );
    if (!found) throw named('NotFoundError', 'Failed to execute \'requestDevice\' on \'USB\': No device selected.');
    return found;
  }

  async getDevices(): Promise<UsbDeviceLike[]> {
    if (this.getDevicesFailure) throw this.getDevicesFailure;
    return [...(this.granted ?? this.devices)];
  }

  addEventListener(_type: 'disconnect', listener: Listener): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: 'disconnect', listener: Listener): void {
    this.listeners.delete(listener);
  }

  get listenerCount(): number {
    return this.listeners.size;
  }

  /** The browser tells the page that `device` was unplugged. */
  dispatchDisconnect(device: UsbDeviceLike): void {
    for (const listener of [...this.listeners]) listener({ device });
  }
}

/** A turn of the event loop in which promises settle (a timer, so it works in Node and in a page). */
export const turn = (ms = 0): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
