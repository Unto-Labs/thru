/**
 * The WebUSB transport: 64-byte Trezor Host Protocol packets over the
 * vendor-class interface of a Trezor Safe 7 (the layout the Rust host proved
 * on a device, `rpc/thru-trezor/src/usb.rs`): vendor `0x1209`, product
 * `0x53C1`, interface 0 of class `0xFF`, interrupt endpoints 1 in and 1 out,
 * 64-byte packets.
 *
 * It follows the transport contract (plan B11, `transport.ts`):
 *
 * - One IN transfer is in flight at a time. It is started by the first
 *   `readPacket` and is never cancelled when the caller stops waiting for it:
 *   `readPacket` called again while that transfer is pending returns the same
 *   promise, so the packet that arrives later reaches the next read, once.
 *   (A browser does not cancel a USB transfer when its caller times out, and
 *   a second transfer would take the packet away from the first.)
 * - Writes are queued and run one at a time, each bounded by a timeout.
 * - `close` rejects the pending read, releases interface 0 and closes the
 *   device; the cleanup is bounded, so a stuck driver cannot hang the caller.
 * - Any failed or malformed transfer ends the transport: the byte stream is
 *   no longer known to be in step, and every later call fails the same way.
 *
 * The browser's own object is used through the small structural types below
 * (`UsbLike`, `UsbDeviceLike`), so the same code runs on Node's `usb` package
 * (`@thru/trezor/node-usb`) and over fakes in tests.
 */
import { copyBytes } from '../bytes';
import { systemClock, waitFor, type Clock } from '../clock';
import type { TrezorTransportKind } from '../errors';
import { PACKET_LEN, type Transport } from '../transport';

/** USB vendor id of SatoshiLabs devices. */
export const TREZOR_USB_VENDOR_ID = 0x1209;
/** USB product id of Trezor firmware: the mode this transport talks to. */
export const TREZOR_USB_PRODUCT_ID = 0x53c1;
/** USB product id of the Trezor bootloader: not usable here. */
export const TREZOR_USB_BOOTLOADER_PRODUCT_ID = 0x53c0;
/** The protocol interface. */
export const TREZOR_USB_INTERFACE = 0;
/** Endpoint number of both interrupt endpoints (OUT `0x01`, IN `0x81`). */
export const TREZOR_USB_ENDPOINT = 1;
/** Interface class "vendor specific". */
const CLASS_VENDOR = 0xff;

/** How long one packet write may take before the transport gives it up as failed. */
export const WRITE_TIMEOUT_MS = 10_000;
/** How long `close` waits for the system to release the interface and the device. */
export const CLOSE_TIMEOUT_MS = 2_000;

/** What the device picker is asked for: Trezor firmware, not the bootloader. */
export const TREZOR_USB_FILTERS: readonly UsbFilter[] = [
  { vendorId: TREZOR_USB_VENDOR_ID, productId: TREZOR_USB_PRODUCT_ID },
];

// ---- the part of the WebUSB API this transport uses ----

export type UsbFilter = { vendorId?: number; productId?: number };

export type UsbEndpointLike = {
  endpointNumber: number;
  direction: 'in' | 'out';
  type: 'bulk' | 'interrupt' | 'isochronous';
  packetSize: number;
};
export type UsbAlternateLike = {
  alternateSetting: number;
  interfaceClass: number;
  endpoints: readonly UsbEndpointLike[];
};
export type UsbInterfaceLike = {
  interfaceNumber: number;
  alternate: UsbAlternateLike;
};
export type UsbConfigurationLike = {
  configurationValue: number;
  interfaces: readonly UsbInterfaceLike[];
};
export type UsbInResultLike = { status: 'ok' | 'stall' | 'babble'; data?: DataView };
export type UsbOutResultLike = { status: 'ok' | 'stall'; bytesWritten: number };

/** A WebUSB `USBDevice`, as far as this transport uses it. */
export interface UsbDeviceLike {
  readonly vendorId: number;
  readonly productId: number;
  readonly opened: boolean;
  readonly configuration?: UsbConfigurationLike | null;
  readonly configurations?: readonly UsbConfigurationLike[];
  open(): Promise<void>;
  close(): Promise<void>;
  selectConfiguration(configurationValue: number): Promise<void>;
  claimInterface(interfaceNumber: number): Promise<void>;
  releaseInterface(interfaceNumber: number): Promise<void>;
  transferIn(endpointNumber: number, length: number): Promise<UsbInResultLike>;
  transferOut(endpointNumber: number, data: Uint8Array): Promise<UsbOutResultLike>;
}

/** `navigator.usb`, as far as this transport uses it. */
export interface UsbLike {
  requestDevice(options: { filters: UsbFilter[] }): Promise<UsbDeviceLike>;
  getDevices(): Promise<UsbDeviceLike[]>;
  /** Optional: where there is one, an unplug fails the pending read at once. */
  addEventListener?(type: 'disconnect', listener: (event: { device: UsbDeviceLike }) => void): void;
  removeEventListener?(type: 'disconnect', listener: (event: { device: UsbDeviceLike }) => void): void;
}

export type WebUsbOptions = {
  /** The USB object to use. Default: `navigator.usb`. */
  usb?: UsbLike;
  /** Time source for the write and close timeouts. */
  clock?: Clock;
  /** Overrides {@link WRITE_TIMEOUT_MS}. */
  writeTimeoutMs?: number;
  /** Overrides {@link CLOSE_TIMEOUT_MS}. */
  closeTimeoutMs?: number;
};

// ---- errors ----

/**
 * Failures of the USB transports, with the kind the link carries into
 * `TrezorTransportError`. A failure of `requestWebUsbTransport` and
 * `reopenWebUsbTransport` reaches the caller as this class; one during a
 * conversation is wrapped by the link, which keeps `kind`.
 */
export class UsbTransportError extends Error {
  readonly kind: TrezorTransportKind;

  constructor(kind: TrezorTransportKind, message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'UsbTransportError';
    this.kind = kind;
    if (options?.cause !== undefined) {
      // ES2022 `Error.cause`, set by hand because the build targets ES2020.
      Object.defineProperty(this, 'cause', { value: options.cause, enumerable: false, writable: true });
    }
  }
}

const HELD_HINT = 'another program uses the Trezor: close Trezor Suite, the Trezor Bridge and other pages that hold it';
const ACCESS_HINT =
  'the system refused access to the Trezor (on Linux install the Trezor udev rules; on Windows the interface must use the WinUSB driver)';

function errorName(error: unknown): string {
  return (error as { name?: unknown } | null)?.name === undefined ? '' : String((error as { name: unknown }).name);
}
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The error of a failed step of opening the device. */
function openFailure(step: string, error: unknown): UsbTransportError {
  if (error instanceof UsbTransportError) return error;
  const name = errorName(error);
  if (name === 'NotFoundError') {
    return new UsbTransportError('disconnected', `${step}: the Trezor was disconnected`, { cause: error });
  }
  if (name === 'SecurityError' || name === 'NotAllowedError') {
    return new UsbTransportError('access_denied', `${step}: ${ACCESS_HINT}`, { cause: error });
  }
  if (name === 'NetworkError' || name === 'InvalidStateError') {
    return new UsbTransportError('busy', `${step}: ${HELD_HINT} (${errorText(error)})`, { cause: error });
  }
  return new UsbTransportError('io', `${step}: ${errorText(error)}`, { cause: error });
}

/** The error of a failed transfer. */
function transferFailure(step: string, error: unknown): UsbTransportError {
  if (error instanceof UsbTransportError) return error;
  const name = errorName(error);
  if (name === 'NotFoundError' || /disconnect|unplug|no such device|device was removed/i.test(errorText(error))) {
    return new UsbTransportError('disconnected', `${step}: the Trezor was disconnected`, { cause: error });
  }
  return new UsbTransportError('io', `${step}: ${errorText(error)}`, { cause: error });
}

/** The error of `requestDevice`. */
function requestFailure(error: unknown): UsbTransportError {
  if (error instanceof UsbTransportError) return error;
  const name = errorName(error);
  if (name === 'NotFoundError') {
    return new UsbTransportError('no_device_chosen', 'no Trezor was chosen in the browser\'s device picker', { cause: error });
  }
  if (name === 'SecurityError' && /gesture/i.test(errorText(error))) {
    return new UsbTransportError(
      'access_denied',
      "the browser shows its device picker only inside a click or a key press: ask for the Trezor from an event handler",
      { cause: error },
    );
  }
  if (name === 'SecurityError' || name === 'NotAllowedError') {
    return new UsbTransportError('access_denied', `the browser refused WebUSB here (${errorText(error)}): it needs a secure, top-level page`, {
      cause: error,
    });
  }
  return new UsbTransportError('io', `asking for a Trezor: ${errorText(error)}`, { cause: error });
}

// ---- finding the device ----

/** Whether this page has WebUSB (Chromium browsers on a secure page). */
export function isWebUsbSupported(): boolean {
  return typeof navigator !== 'undefined' && (navigator as { usb?: unknown }).usb !== undefined;
}

function usbOf(options: WebUsbOptions): UsbLike {
  const usb = options.usb ?? (typeof navigator === 'undefined' ? undefined : ((navigator as { usb?: UsbLike }).usb));
  if (!usb) {
    throw new UsbTransportError(
      'unsupported',
      'this browser has no WebUSB (use Chrome, Edge or another Chromium browser on an https or localhost page)',
    );
  }
  return usb;
}

/**
 * Chooses the one Trezor firmware among `devices`, as the Rust host does:
 * none, a bootloader only, or several are errors.
 */
export function pickDevice<T extends { vendorId: number; productId: number }>(devices: readonly T[]): T {
  const firmware = devices.filter((d) => d.vendorId === TREZOR_USB_VENDOR_ID && d.productId === TREZOR_USB_PRODUCT_ID);
  if (firmware.length > 1) {
    throw new UsbTransportError('ambiguous', 'more than one Trezor is connected; connect only one');
  }
  if (firmware.length === 1) return firmware[0];
  if (devices.some((d) => d.vendorId === TREZOR_USB_VENDOR_ID && d.productId === TREZOR_USB_BOOTLOADER_PRODUCT_ID)) {
    throw new UsbTransportError('not_found', 'the Trezor is in bootloader mode; reconnect it to start the firmware');
  }
  throw new UsbTransportError('not_found', 'no Trezor (USB 1209:53c1) is connected');
}

/** Checks that interface 0 is the vendor-class protocol interface with the expected endpoints. */
function checkLayout(device: UsbDeviceLike): void {
  const bad = (what: string): UsbTransportError => new UsbTransportError('io', `unexpected USB layout: ${what}`);
  const protocolInterface = device.configuration?.interfaces.find((i) => i.interfaceNumber === TREZOR_USB_INTERFACE);
  if (!protocolInterface) throw bad('interface 0 is missing');
  const alternate = protocolInterface.alternate;
  if (alternate.interfaceClass !== CLASS_VENDOR) {
    throw bad(`interface 0 has class 0x${alternate.interfaceClass.toString(16).padStart(2, '0')}, expected the vendor class 0xff`);
  }
  for (const direction of ['out', 'in'] as const) {
    const endpoint = alternate.endpoints.find((e) => e.direction === direction && e.endpointNumber === TREZOR_USB_ENDPOINT);
    if (!endpoint) throw bad(`the ${direction} endpoint ${TREZOR_USB_ENDPOINT} is missing`);
    if (endpoint.type !== 'interrupt') throw bad(`the ${direction} endpoint is ${endpoint.type}, expected interrupt`);
    if (endpoint.packetSize !== PACKET_LEN) {
      throw bad(`the ${direction} endpoint has packet size ${endpoint.packetSize}, expected ${PACKET_LEN}`);
    }
  }
}

type Deferred = { promise: Promise<Uint8Array>; resolve: (packet: Uint8Array) => void; reject: (error: Error) => void };

function deferred(): Deferred {
  let resolve!: (packet: Uint8Array) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<Uint8Array>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // The caller of `readPacket` handles the rejection; this keeps a read that
  // nobody awaits any more from being reported as unhandled.
  promise.catch(() => undefined);
  return { promise, resolve, reject };
}

export class WebUsbTransport implements Transport {
  private reading?: Deferred;
  private writes: Promise<unknown> = Promise.resolve();
  private failure?: UsbTransportError;
  private closed = false;
  private readonly onDisconnect = (event: { device: UsbDeviceLike }): void => {
    if (event.device === this.device) this.fail(new UsbTransportError('disconnected', 'the Trezor was disconnected'));
  };

  private constructor(
    private readonly device: UsbDeviceLike,
    private readonly usb: UsbLike | undefined,
    private readonly clock: Clock,
    private readonly writeTimeoutMs: number,
    private readonly closeTimeoutMs: number,
  ) {
    this.usb?.addEventListener?.('disconnect', this.onDisconnect);
  }

  /**
   * Opens `device`: selects its configuration if none is active, claims
   * interface 0 and checks that it is the protocol interface. On failure
   * nothing is left claimed or open.
   */
  static async open(device: UsbDeviceLike, options: WebUsbOptions = {}): Promise<WebUsbTransport> {
    let claimed = false;
    try {
      if (!device.opened) {
        try {
          await device.open();
        } catch (error) {
          throw openFailure('opening the Trezor', error);
        }
      }
      if (!device.configuration) {
        try {
          await device.selectConfiguration(device.configurations?.[0]?.configurationValue ?? 1);
        } catch (error) {
          throw openFailure('selecting the USB configuration', error);
        }
      }
      try {
        await device.claimInterface(TREZOR_USB_INTERFACE);
        claimed = true;
      } catch (error) {
        throw openFailure('claiming USB interface 0', error);
      }
      checkLayout(device);
    } catch (error) {
      if (claimed) await device.releaseInterface(TREZOR_USB_INTERFACE).catch(() => undefined);
      await device.close().catch(() => undefined);
      throw error;
    }
    let usb: UsbLike | undefined;
    try {
      usb = options.usb ?? (typeof navigator === 'undefined' ? undefined : (navigator as { usb?: UsbLike }).usb);
    } catch {
      usb = undefined;
    }
    return new WebUsbTransport(
      device,
      usb,
      options.clock ?? systemClock,
      options.writeTimeoutMs ?? WRITE_TIMEOUT_MS,
      options.closeTimeoutMs ?? CLOSE_TIMEOUT_MS,
    );
  }

  /** Ends the transport on its first failure; every later call fails the same way. */
  private fail(error: UsbTransportError): void {
    if (this.closed) return;
    this.failure ??= error;
    const reading = this.reading;
    this.reading = undefined;
    reading?.reject(this.failure);
  }

  readPacket(): Promise<Uint8Array> {
    if (this.closed) return Promise.reject(new UsbTransportError('io', 'the transport is closed'));
    if (this.failure) return Promise.reject(this.failure);
    if (this.reading) return this.reading.promise;
    const reading = deferred();
    this.reading = reading;
    void this.transferIn(reading);
    return reading.promise;
  }

  /** The one IN transfer in flight: it settles `reading`, whoever still waits for it. */
  private async transferIn(reading: Deferred): Promise<void> {
    let result: UsbInResultLike;
    try {
      result = await this.device.transferIn(TREZOR_USB_ENDPOINT, PACKET_LEN);
    } catch (error) {
      if (!this.closed) this.fail(transferFailure('USB read', error));
      return;
    }
    if (this.closed || this.reading !== reading) return;
    if (result.status !== 'ok') {
      const what = result.status === 'stall' ? 'endpoint stalled' : 'the device sent more than one packet';
      this.fail(new UsbTransportError('io', `USB read: ${what}`));
      return;
    }
    const data = result.data;
    if (!data || data.byteLength !== PACKET_LEN) {
      this.fail(new UsbTransportError('io', `USB read returned ${data?.byteLength ?? 0} bytes, expected ${PACKET_LEN}`));
      return;
    }
    this.reading = undefined;
    reading.resolve(copyBytes(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)));
  }

  writePacket(packet: Uint8Array): Promise<void> {
    if (packet.length !== PACKET_LEN) {
      return Promise.reject(new UsbTransportError('io', `a packet is ${PACKET_LEN} bytes, not ${packet.length}`));
    }
    // A copy of its own (a `Buffer`'s `slice` is a view): what the caller does
    // with its buffer afterwards changes nothing, also while the write waits its turn.
    const bytes = copyBytes(packet);
    const run = (): Promise<void> => this.write(bytes);
    const next = this.writes.then(run, run);
    this.writes = next.catch(() => undefined);
    return next;
  }

  private async write(bytes: Uint8Array): Promise<void> {
    if (this.closed) throw new UsbTransportError('io', 'the transport is closed');
    if (this.failure) throw this.failure;
    let waited;
    try {
      waited = await waitFor(this.clock, this.device.transferOut(TREZOR_USB_ENDPOINT, bytes), this.writeTimeoutMs);
    } catch (error) {
      const failure = this.closed ? new UsbTransportError('io', 'the transport is closed') : transferFailure('USB write', error);
      this.fail(failure);
      throw failure;
    }
    if (this.closed) throw new UsbTransportError('io', 'the transport is closed');
    if (waited.kind === 'timeout') {
      const failure = new UsbTransportError('io', `USB write timed out after ${this.writeTimeoutMs} ms`);
      this.fail(failure);
      throw failure;
    }
    if (waited.kind !== 'value') throw new UsbTransportError('io', 'USB write was aborted');
    const { status, bytesWritten } = waited.value;
    if (status !== 'ok' || bytesWritten !== PACKET_LEN) {
      const failure = new UsbTransportError(
        'io',
        status === 'ok' ? `USB write sent ${bytesWritten} of ${PACKET_LEN} bytes` : `USB write: endpoint ${status}`,
      );
      this.fail(failure);
      throw failure;
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.usb?.removeEventListener?.('disconnect', this.onDisconnect);
    const reading = this.reading;
    this.reading = undefined;
    reading?.reject(new UsbTransportError('io', 'the transport is closed'));
    const release = (async (): Promise<void> => {
      await this.device.releaseInterface(TREZOR_USB_INTERFACE).catch(() => undefined);
      await this.device.close().catch(() => undefined);
    })();
    await waitFor(this.clock, release, this.closeTimeoutMs);
  }
}

/**
 * Asks the browser for a Trezor and opens it. The browser shows its device
 * picker, which it allows only inside a click or a key press: call this from
 * an event handler. Rejects with {@link UsbTransportError} of kind
 * `no_device_chosen` when the person closes the picker, `busy` when another
 * program holds the device, `access_denied` when the system refuses access.
 */
export async function requestWebUsbTransport(options: WebUsbOptions = {}): Promise<WebUsbTransport> {
  const usb = usbOf(options);
  let device: UsbDeviceLike;
  try {
    device = await usb.requestDevice({ filters: TREZOR_USB_FILTERS.map((f) => ({ ...f })) });
  } catch (error) {
    throw requestFailure(error);
  }
  return WebUsbTransport.open(device, { ...options, usb });
}

/**
 * Opens the Trezor this origin already has permission for, with no picker and
 * no click needed (a person who connected once reconnects without being
 * asked). Rejects with kind `not_found` when there is none, and with kind
 * `ambiguous` when there are several.
 */
export async function reopenWebUsbTransport(options: WebUsbOptions = {}): Promise<WebUsbTransport> {
  const usb = usbOf(options);
  let devices: UsbDeviceLike[];
  try {
    devices = await usb.getDevices();
  } catch (error) {
    throw new UsbTransportError('io', `listing the Trezors this page may use: ${errorText(error)}`, { cause: error });
  }
  let device: UsbDeviceLike;
  try {
    device = pickDevice(devices);
  } catch (error) {
    if (error instanceof UsbTransportError && error.kind === 'not_found' && devices.length === 0) {
      throw new UsbTransportError('not_found', 'this page has no permission for a Trezor yet: connect it with the device picker first');
    }
    throw error;
  }
  return WebUsbTransport.open(device, { ...options, usb });
}
