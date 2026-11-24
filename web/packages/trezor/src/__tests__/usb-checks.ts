/**
 * Checks of the USB transports against fake devices (plan B11, section 6): the
 * transport contract (a read that times out is not abandoned, requests are
 * serialized, close, unplug, short and oversized transfers), the device
 * filter and the typed errors. The same cases run through the browser's entry
 * (`./webusb`, `requestWebUsbTransport`) and through the Node entry
 * (`./node-usb`, `openNodeUsbTransport`, over a fake of the `usb` package), and
 * under vitest in Node and, bundled, in a page in Chromium. Like the driver
 * checks they use no Node API.
 */
import { newCheck, sharedSlice, type Check, type CaseResult } from './driver-support';
import { FakeUsb, FakeUsbDevice, named, packet, trezorConfiguration, turn } from './usb-support';
import type { Transport } from '../index';
import type * as WebUsbApi from '../webusb';

export type { CaseResult } from './driver-support';

type WebUsb = typeof WebUsbApi;
/** How a flavor opens a transport on `device`, through its own public functions. */
export type Flavor = {
  name: 'webusb' | 'node-usb';
  open(usb: FakeUsb, options?: { writeTimeoutMs?: number; closeTimeoutMs?: number }): Promise<Transport>;
};
type Ctx = { webusb: WebUsb; flavor: Flavor; t: Check };
type Case = { group: string; name: string; run: (ctx: Ctx) => Promise<void> };

const cases: Case[] = [];
const add = (name: string, run: (ctx: Ctx) => Promise<void>): void => void cases.push({ group: 'usb', name, run });

const same = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((x, i) => x === b[i]);
const kindOf = (error: unknown): unknown => (error as { kind?: unknown } | undefined)?.kind;
const messageOf = (error: unknown): string => (error as Error | undefined)?.message ?? String(error);

/** Opens a transport on a new fake device and its `navigator.usb`. */
async function opened(
  flavor: Flavor,
  options?: { writeTimeoutMs?: number; closeTimeoutMs?: number },
  device = new FakeUsbDevice(),
): Promise<{ transport: Transport; device: FakeUsbDevice; usb: FakeUsb }> {
  const usb = new FakeUsb([device]);
  return { transport: await flavor.open(usb, options), device, usb };
}

/** Waits for `promise` at most `ms`: its value, or `'timeout'` (and the promise is left alone, as the link leaves it). */
async function within<T>(promise: Promise<T>, ms: number): Promise<T | 'timeout'> {
  return Promise.race([promise, turn(ms).then(() => 'timeout' as const)]);
}

// ---- opening ----

add('opens the device: opens it, selects the configuration when none is active, claims interface 0', async ({ flavor, t }) => {
  const { transport, device } = await opened(flavor, undefined, new FakeUsbDevice({ unconfigured: true }));
  t.eq('the steps', ['open', 'selectConfiguration 1', 'claimInterface 0'], device.log);
  await transport.close();
  const again = await opened(flavor);
  t.eq('an active configuration is kept', ['open', 'claimInterface 0'], again.device.log);
  await again.transport.close();
});

add('refuses an interface that is not the protocol interface, and leaves nothing claimed or open', async ({ flavor, t }) => {
  const layouts: Array<[string, Parameters<typeof trezorConfiguration>[0], RegExp]> = [
    ['an interface of class HID', { interfaceClass: 0x03 }, /class 0x03/],
    ['endpoints of 32 bytes', { packetSize: 32 }, /packet size 32/],
    ['bulk endpoints', { type: 'bulk' }, /bulk, expected interrupt/],
    ['no IN endpoint', { withoutIn: true }, /in endpoint 1 is missing/],
    ['no interface 0', { interfaceNumber: 1 }, /interface 0 is missing/],
  ];
  for (const [label, change, text] of layouts) {
    const device = new FakeUsbDevice({ configuration: trezorConfiguration(change) });
    const error = await t.rejects(label, flavor.open(new FakeUsb([device])));
    t.eq(`${label}: kind`, 'io', kindOf(error));
    t.ok(`${label}: says what is wrong`, text.test(messageOf(error)), messageOf(error));
    t.eq(`${label}: released and closed`, ['releaseInterface 0', 'close'], device.log.slice(-2));
    t.ok(`${label}: the device is closed`, !device.opened);
  }
});

add('names why a device cannot be opened: held by another program, access refused, unplugged', async ({ flavor, t }) => {
  const held = new FakeUsbDevice({ failClaim: named('NetworkError', 'Unable to claim interface.') });
  const heldError = await t.rejects('claim fails with NetworkError', flavor.open(new FakeUsb([held])));
  t.eq('kind busy', 'busy', kindOf(heldError));
  t.ok('names the programs', /Trezor Suite/.test(messageOf(heldError)), messageOf(heldError));
  t.ok('the device is closed again', !held.opened && held.log[held.log.length - 1] === 'close');

  const denied = new FakeUsbDevice({ failOpen: named('SecurityError', 'Access denied.') });
  const deniedError = await t.rejects('open fails with SecurityError', flavor.open(new FakeUsb([denied])));
  t.eq('kind access_denied', 'access_denied', kindOf(deniedError));
  t.ok('names udev and WinUSB', /udev/.test(messageOf(deniedError)) && /WinUSB/.test(messageOf(deniedError)));

  const gone = new FakeUsbDevice({ failOpen: named('NotFoundError', 'The device was disconnected.') });
  t.eq('kind disconnected', 'disconnected', kindOf(await t.rejects('open fails with NotFoundError', flavor.open(new FakeUsb([gone])))));

  const odd = new FakeUsbDevice({ failSelect: new Error('boom'), unconfigured: true });
  t.eq('any other failure is io', 'io', kindOf(await t.rejects('selecting the configuration fails', flavor.open(new FakeUsb([odd])))));
});

// ---- reading ----

add('a read that times out is not abandoned: the next read waits on the same transfer and gets its packet once', async ({ flavor, t }) => {
  const { transport, device } = await opened(flavor);
  const first = transport.readPacket();
  t.eq('the first read started one transfer', 1, device.inTransfers);
  t.eq('nothing arrives within the caller\'s timeout', 'timeout', await within(first, 15));
  // The caller gives up waiting, and asks again: no second transfer may be started,
  // for it would take the packet away from the first.
  const second = transport.readPacket();
  t.ok('the next read is the same pending read', second === first);
  t.eq('still one transfer', 1, device.inTransfers);
  device.send(packet(0x11));
  const got = (await within(second, 1000)) as Uint8Array;
  t.ok('the packet arrives at the next read, whole', got !== undefined && got.length === 64 && same(got, packet(0x11)));
  t.eq('and no transfer was started for it', 1, device.inTransfers);
  // Nothing is duplicated: a later read waits for a new packet.
  const third = transport.readPacket();
  t.eq('the third read starts a new transfer', 2, device.inTransfers);
  t.eq('and has nothing yet', 'timeout', await within(third, 15));
  device.send(packet(0x22));
  t.ok('then gets only the new packet', same((await within(third, 1000)) as Uint8Array, packet(0x22)));
  t.eq('two packets, two transfers', 2, device.inTransfers);
  await transport.close();
});

add('every packet arrives once and in order, whether the read was waiting or not', async ({ flavor, t }) => {
  const { transport, device } = await opened(flavor);
  const sent = Array.from({ length: 12 }, (_, i) => packet(i + 1));
  const received: Uint8Array[] = [];
  for (let i = 0; i < sent.length; i++) {
    if (i % 2 === 0) {
      // The packet is there before the read.
      device.send(sent[i]);
      received.push(await transport.readPacket());
    } else {
      const read = transport.readPacket();
      await turn();
      device.send(sent[i]);
      received.push(await read);
    }
  }
  t.eq('twelve packets', 12, received.length);
  t.ok('in order and equal', received.every((p, i) => same(p, sent[i])));
  t.eq('one transfer each', 12, device.inTransfers);
  await transport.close();
});

add('a packet is a copy: what the transport hands over is not the browser\'s buffer', async ({ flavor, t }) => {
  const { transport, device } = await opened(flavor);
  const read = transport.readPacket();
  device.send(packet(0x33));
  const got = await read;
  got.fill(0);
  device.send(packet(0x44));
  t.ok('the next packet is unaffected', same(await transport.readPacket(), packet(0x44)));
  await transport.close();
});

add('a short, an oversized or a stalled IN transfer is an error and ends the transport', async ({ flavor, t }) => {
  const results: Array<[string, (device: FakeUsbDevice) => void, RegExp]> = [
    ['63 bytes', (d) => d.send(packet(1, 63)), /returned 63 bytes, expected 64/],
    ['65 bytes', (d) => d.send(packet(1, 65)), /returned 65 bytes, expected 64/],
    ['no data', (d) => d.sendRaw({ status: 'ok' }), /returned 0 bytes/],
    ['babble', (d) => d.sendRaw({ status: 'babble', data: FakeUsbDevice.view(packet(1, 64)) }), /more than one packet/],
    ['stall', (d) => d.sendRaw({ status: 'stall' }), /endpoint stalled/],
  ];
  for (const [label, act, text] of results) {
    const { transport, device } = await opened(flavor);
    const read = transport.readPacket();
    act(device);
    const error = await t.rejects(label, read);
    t.eq(`${label}: kind`, 'io', kindOf(error));
    t.ok(`${label}: says what happened`, text.test(messageOf(error)), messageOf(error));
    const later = await t.rejects(`${label}: the next read fails the same way`, transport.readPacket());
    t.ok(`${label}: with the same error`, later === error);
    await t.rejects(`${label}: a write fails too`, transport.writePacket(packet(1)));
    await transport.close();
  }
});

// ---- writing ----

add('writes are one packet of 64 bytes, copied, and a wrong size is refused before the device', async ({ flavor, t }) => {
  const { transport, device } = await opened(flavor);
  const bytes = packet(0x5a);
  const writing = transport.writePacket(bytes);
  bytes.fill(0);
  await writing;
  t.ok('the device got the bytes as they were when the call was made', same(device.written[0], packet(0x5a)));
  const before = device.log.length;
  for (const length of [0, 63, 65]) {
    const error = await t.rejects(`${length} bytes`, transport.writePacket(new Uint8Array(length)));
    t.eq(`${length} bytes: kind`, 'io', kindOf(error));
  }
  t.eq('the device was not asked', before, device.log.length);
  await transport.writePacket(packet(1));
  t.eq('and the transport still works', 2, device.written.length);
  await transport.close();
});

add('a packet held in a buffer that shares memory is copied at the call, also while it waits its turn behind another write', async ({ flavor, t }) => {
  const { transport, device } = await opened(flavor);
  device.outMode = 'manual';
  const first = transport.writePacket(packet(0xa1));
  const queued = sharedSlice(packet(0xb2));
  const second = transport.writePacket(queued);
  queued.fill(0);
  await turn();
  device.completeOut();
  await first;
  await turn();
  device.completeOut();
  await second;
  t.ok('the first packet is as it was', same(device.written[0], packet(0xa1)));
  t.ok('the second packet reached the device as it was at the call', same(device.written[1], packet(0xb2)));
  await transport.close();
});

add('two requests at once are serialized: the second write starts when the first has finished', async ({ flavor, t }) => {
  const { transport, device } = await opened(flavor);
  device.outMode = 'manual';
  const a = transport.writePacket(packet(0xa1));
  const b = transport.writePacket(packet(0xb2));
  const c = transport.writePacket(packet(0xc3));
  await turn();
  t.eq('only the first is on the device', 1, device.waitingOut);
  device.completeOut();
  await a;
  await turn();
  t.eq('then the second', 1, device.waitingOut);
  device.completeOut();
  await b;
  await turn();
  device.completeOut();
  await c;
  t.eq('never more than one in flight', 1, device.maxOutInFlight);
  t.ok('in the order of the calls', device.written.length === 3 && same(device.written[0], packet(0xa1)) && same(device.written[1], packet(0xb2)) && same(device.written[2], packet(0xc3)));
  await transport.close();
});

add('a write that fails ends the transport; the writes behind it fail without reaching the device', async ({ flavor, t }) => {
  const { transport, device } = await opened(flavor);
  device.outMode = 'manual';
  const a = transport.writePacket(packet(1));
  const b = transport.writePacket(packet(2));
  await turn();
  device.completeOut({ status: 'stall', bytesWritten: 0 });
  const first = await t.rejects('the stalled write', a);
  t.ok('says it stalled', /endpoint stall/.test(messageOf(first)), messageOf(first));
  const second = await t.rejects('the write behind it', b);
  t.ok('fails with the same error', second === first);
  t.eq('and never reached the device', 1, device.log.filter((l) => l.startsWith('transferOut')).length);
  await t.rejects('a read fails too', transport.readPacket());
  await transport.close();
});

add('a short write is an error', async ({ flavor, t }) => {
  const { transport, device } = await opened(flavor);
  device.outMode = 'manual';
  const write = transport.writePacket(packet(1));
  await turn();
  device.completeOut({ status: 'ok', bytesWritten: 63 });
  const error = await t.rejects('63 of 64 bytes', write);
  t.ok('says so', /sent 63 of 64 bytes/.test(messageOf(error)), messageOf(error));
  await transport.close();
});

add('a write that never completes times out', async ({ flavor, t }) => {
  const { transport, device } = await opened(flavor, { writeTimeoutMs: 25 });
  device.outMode = 'hang';
  const error = await t.rejects('the hung write', transport.writePacket(packet(1)));
  t.eq('kind io', 'io', kindOf(error));
  t.ok('says it timed out', /timed out after 25 ms/.test(messageOf(error)), messageOf(error));
  await t.rejects('and the transport is finished', transport.readPacket());
  await transport.close();
});

// ---- closing ----

add('close during a read: the read rejects, the interface is released and the device closed, once', async ({ flavor, t }) => {
  const { transport, device } = await opened(flavor);
  const read = transport.readPacket();
  await turn();
  const closing = transport.close();
  const error = await t.rejects('the pending read', read);
  t.ok('says the transport is closed', /closed/.test(messageOf(error)), messageOf(error));
  await closing;
  t.eq('released, then closed', ['releaseInterface 0', 'close'], device.log.slice(-2));
  t.ok('the device is closed', !device.opened);
  await transport.close();
  t.eq('a second close does nothing', 1, device.log.filter((l) => l === 'close').length);
  await t.rejects('a read after close', transport.readPacket());
  await t.rejects('a write after close', transport.writePacket(packet(1)));
  await turn(5);
});

add('close does not wait for a driver that never finishes', async ({ flavor, t }) => {
  const { transport } = await opened(flavor, { closeTimeoutMs: 25 }, new FakeUsbDevice({ closeHangs: true }));
  const started = Date.now();
  await transport.close();
  t.ok('returned after the bound', Date.now() - started < 1500, `${Date.now() - started} ms`);
});

add('close with a write in flight rejects it and leaves nothing running', async ({ flavor, t }) => {
  const { transport, device } = await opened(flavor);
  device.outMode = 'manual';
  const write = transport.writePacket(packet(1));
  await turn();
  await transport.close();
  const error = await t.rejects('the write in flight', write);
  t.ok('says the transport is closed', /closed/.test(messageOf(error)), messageOf(error));
});

// ---- unplugging ----

add('unplug during a read: the read rejects as disconnected, and so does everything after it', async ({ flavor, t }) => {
  const { transport, device } = await opened(flavor);
  const read = transport.readPacket();
  await turn();
  device.unplug();
  const error = await t.rejects('the pending read', read);
  t.eq('kind disconnected', 'disconnected', kindOf(error));
  t.ok('says so', /disconnected/.test(messageOf(error)), messageOf(error));
  t.ok('the next read has the same error', (await t.rejects('next read', transport.readPacket())) === error);
  t.ok('a write has it too', (await t.rejects('write', transport.writePacket(packet(1)))) === error);
  await transport.close();
});

add('unplug during a write: the write rejects as disconnected', async ({ flavor, t }) => {
  const { transport, device } = await opened(flavor);
  device.outMode = 'manual';
  const write = transport.writePacket(packet(1));
  const queued = transport.writePacket(packet(2));
  await turn();
  device.unplug();
  const error = await t.rejects('the write in flight', write);
  t.eq('kind disconnected', 'disconnected', kindOf(error));
  t.ok('the queued write has the same error', (await t.rejects('queued write', queued)) === error);
  await transport.close();
});

add('the browser\'s disconnect event fails the pending read at once, for this device only', async ({ flavor, t }) => {
  if (flavor.name !== 'webusb') {
    t.ok('node-usb listens for no event (it would start the native hotplug watcher)', true);
    return;
  }
  const { transport, device, usb } = await opened(flavor);
  t.eq('listening for the event', 1, usb.listenerCount);
  const read = transport.readPacket();
  usb.dispatchDisconnect(new FakeUsbDevice());
  t.eq('another device\'s unplug is ignored', 'timeout', await within(read, 15));
  usb.dispatchDisconnect(device);
  const error = await t.rejects('this device\'s unplug', read);
  t.eq('kind disconnected', 'disconnected', kindOf(error));
  await transport.close();
  t.eq('the listener is removed on close', 0, usb.listenerCount);
});

// ---- the device filter and the typed errors of finding the device ----

add('the picker is asked for Trezor firmware only (vendor 0x1209, product 0x53c1), and nothing else', async ({ webusb, flavor, t }) => {
  t.eq('the filter', [{ vendorId: 0x1209, productId: 0x53c1 }], webusb.TREZOR_USB_FILTERS);
  if (flavor.name !== 'webusb') return;
  const usb = new FakeUsb([new FakeUsbDevice({ productId: 0x53c0 }), new FakeUsbDevice({ vendorId: 0x2c97 }), new FakeUsbDevice()]);
  const transport = await webusb.requestWebUsbTransport({ usb });
  t.eq('the request', [{ filters: [{ vendorId: 0x1209, productId: 0x53c1 }] }], usb.requests);
  t.eq('the firmware was opened, not the bootloader or another vendor\'s device', [[], [], ['open', 'claimInterface 0']], usb.devices.map((d) => d.log.slice(0, 2)));
  await transport.close();
});

add('asking for a device: no device chosen, not from a click, no WebUSB, other failures', async ({ webusb, flavor, t }) => {
  if (flavor.name !== 'webusb') return;
  const usb = new FakeUsb([new FakeUsbDevice()]);
  usb.requestFailure = named('NotFoundError', "Failed to execute 'requestDevice' on 'USB': No device selected.");
  const none = await t.rejects('the picker was closed', webusb.requestWebUsbTransport({ usb }));
  t.eq('kind no_device_chosen', 'no_device_chosen', kindOf(none));
  t.ok('is a UsbTransportError', none instanceof webusb.UsbTransportError);

  usb.requestFailure = named('SecurityError', 'Must be handling a user gesture to show a permission request.');
  const gesture = await t.rejects('not from a click', webusb.requestWebUsbTransport({ usb }));
  t.eq('kind access_denied', 'access_denied', kindOf(gesture));
  t.ok('says to call it from an event handler', /click or a key press/.test(messageOf(gesture)), messageOf(gesture));

  usb.requestFailure = named('SecurityError', 'Access denied.');
  t.eq('another SecurityError', 'access_denied', kindOf(await t.rejects('insecure page', webusb.requestWebUsbTransport({ usb }))));

  usb.requestFailure = new Error('boom');
  t.eq('any other failure', 'io', kindOf(await t.rejects('boom', webusb.requestWebUsbTransport({ usb }))));

  // A page that has WebUSB (a run in Chromium) would show the real picker: only a page without it is asked.
  if (typeof navigator === 'undefined' || (navigator as { usb?: unknown }).usb === undefined) {
    const unsupported = await t.rejects('a page without WebUSB', webusb.requestWebUsbTransport());
    t.eq('kind unsupported', 'unsupported', kindOf(unsupported));
    t.ok('names the browsers', /Chromium/.test(messageOf(unsupported)), messageOf(unsupported));
    t.eq('isWebUsbSupported', false, webusb.isWebUsbSupported());
  }
});

add('choosing among the devices a page may use: none, the bootloader only, several, one', async ({ webusb, t }) => {
  const fw = (): FakeUsbDevice => new FakeUsbDevice();
  const bootloader = new FakeUsbDevice({ productId: 0x53c0 });
  const other = new FakeUsbDevice({ vendorId: 0x2c97, productId: 0x4011 });
  const only = fw();
  t.ok('the one firmware among others', webusb.pickDevice([other, bootloader, only]) === only);
  const none = await t.rejects('nothing', Promise.resolve().then(() => webusb.pickDevice([other])));
  t.eq('not_found', 'not_found', kindOf(none));
  t.ok('names the ids', /1209:53c1/.test(messageOf(none)), messageOf(none));
  const boot = await t.rejects('the bootloader only', Promise.resolve().then(() => webusb.pickDevice([bootloader])));
  t.eq('not_found', 'not_found', kindOf(boot));
  t.ok('says bootloader', /bootloader/.test(messageOf(boot)), messageOf(boot));
  const two = await t.rejects('two firmwares', Promise.resolve().then(() => webusb.pickDevice([fw(), fw()])));
  t.eq('ambiguous', 'ambiguous', kindOf(two));
});

add('reopening: a device this page may use, with no picker; none or several are errors', async ({ webusb, flavor, t }) => {
  if (flavor.name !== 'webusb') return;
  const device = new FakeUsbDevice();
  const usb = new FakeUsb([device]);
  const transport = await webusb.reopenWebUsbTransport({ usb });
  t.eq('no picker was shown', 0, usb.requests.length);
  t.eq('the device was opened', ['open', 'claimInterface 0'], device.log);
  await transport.close();

  const nothing = new FakeUsb([device]);
  nothing.granted = [];
  const missing = await t.rejects('no permission yet', webusb.reopenWebUsbTransport({ usb: nothing }));
  t.eq('not_found', 'not_found', kindOf(missing));
  t.ok('says to use the picker first', /device picker first/.test(messageOf(missing)), messageOf(missing));

  const two = new FakeUsb([new FakeUsbDevice(), new FakeUsbDevice()]);
  t.eq('two devices', 'ambiguous', kindOf(await t.rejects('two', webusb.reopenWebUsbTransport({ usb: two }))));

  const failing = new FakeUsb([device]);
  failing.getDevicesFailure = new Error('no way');
  t.eq('listing fails', 'io', kindOf(await t.rejects('listing', webusb.reopenWebUsbTransport({ usb: failing }))));
});

// ---- runner ----

export function usbCaseNames(): Array<{ group: string; name: string }> {
  return cases.map(({ group, name }) => ({ group, name }));
}

export async function runUsbCase(webusb: WebUsb, flavor: Flavor, index: number): Promise<CaseResult> {
  const { group, name, run } = cases[index];
  const { check, failures, count } = newCheck();
  try {
    await run({ webusb, flavor, t: check });
  } catch (error) {
    failures.push({
      label: `${name}: the case itself threw`,
      expected: 'no exception',
      actual: String((error as Error)?.stack ?? error),
    });
  }
  return { group: `${group} (${flavor.name})`, name, checks: count(), failures };
}

export async function runAllUsbCases(webusb: WebUsb, flavor: Flavor): Promise<CaseResult[]> {
  const results: CaseResult[] = [];
  for (let i = 0; i < cases.length; i++) results.push(await runUsbCase(webusb, flavor, i));
  return results;
}
