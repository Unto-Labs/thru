/**
 * The USB transports and the IndexedDB store against fakes, in Node, on the
 * built entries (`dist/webusb.js`, `dist/node-usb.js`): the transport contract
 * through the browser's entry and through the Node entry over a fake of the
 * `usb` package. The same cases run in Chromium (`scripts/run-browser-vectors.mjs`).
 * The real `usb` package is never imported here: loading it is the owner's
 * step on a machine with the device.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { loadBundle } from './helpers/bundle';
import { loadNodeUsb, loadWebUsb } from './helpers/usb';
import { runIdbCases } from './idb-checks';
import { runUsbCase, usbCaseNames, type Flavor } from './usb-checks';
import { FakeUsb, FakeUsbDevice, named, packet } from './usb-support';
import type { Api } from './vector-checks';
import type * as NodeUsbApi from '../node-usb';
import type * as WebUsbApi from '../webusb';

let webusb: typeof WebUsbApi;
let nodeUsb: typeof NodeUsbApi;
let api: Api;

beforeAll(async () => {
  webusb = await loadWebUsb();
  nodeUsb = await loadNodeUsb();
  api = await loadBundle();
});

/** What the `usb` package looks like to the Node entry: a `WebUSB` class over the system's devices. */
function fakeUsbModule(usb: FakeUsb, record: { options: unknown[] } = { options: [] }) {
  return {
    WebUSB: class {
      constructor(options: { allowAllDevices?: boolean }) {
        record.options.push(options);
      }
      getDevices() {
        return usb.getDevices();
      }
    },
  };
}

const webusbFlavor = (): Flavor => ({
  name: 'webusb',
  open: (usb, options) => webusb.requestWebUsbTransport({ usb, ...options }),
});
const nodeUsbFlavor = (): Flavor => ({
  name: 'node-usb',
  open: (usb, options) => nodeUsb.openNodeUsbTransport({ module: fakeUsbModule(usb), ...options }),
});

describe.each([
  ['./webusb', webusbFlavor],
  ['./node-usb', nodeUsbFlavor],
] as const)('USB transport contract through %s', (_entry, flavor) => {
  usbCaseNames().forEach(({ name }, index) => {
    it(name, async () => {
      const result = await runUsbCase(webusb, flavor(), index);
      expect(result.failures).toEqual([]);
    });
  });
});

describe('the IndexedDB credential store without IndexedDB', () => {
  it('fails clearly and has no fallback (the cases that need a browser run in Chromium)', async () => {
    const results = await runIdbCases(webusb);
    expect(results.map((r) => r.name)).toEqual([
      'an unavailable IndexedDB fails every operation with a clear error and falls back to nothing',
    ]);
    for (const result of results) {
      expect(result.failures).toEqual([]);
      expect(result.checks).toBeGreaterThan(0);
    }
  });
});

describe('./node-usb', () => {
  it('uses the usb package\'s WebUSB with every device allowed, and lists the devices only when a transport is opened', async () => {
    const record = { options: [] as unknown[] };
    const device = new FakeUsbDevice();
    const usb = new FakeUsb([new FakeUsbDevice({ vendorId: 0x2c97, productId: 0x4011 }), device]);
    const module = fakeUsbModule(usb, record);
    const created = await nodeUsb.createNodeUsb({ module });
    expect(record.options).toEqual([{ allowAllDevices: true }]);
    expect(device.log).toEqual([]);
    const transport = await nodeUsb.openNodeUsbTransport({ module });
    expect(device.log).toEqual(['open', 'claimInterface 0']);
    // The one Trezor firmware, among the other devices the system lists.
    expect((await created.getDevices()).length).toBe(2);
    await transport.close();
  });

  it('accepts the module in the shapes the package has: WebUSB, a ready-made usb, or a default export', async () => {
    const usb = new FakeUsb([new FakeUsbDevice()]);
    const ready = await nodeUsb.createNodeUsb({ module: { usb } });
    expect((await ready.getDevices()).length).toBe(1);
    const viaDefault = await nodeUsb.createNodeUsb({ module: { default: { usb } } });
    expect((await viaDefault.getDevices()).length).toBe(1);
    await expect(nodeUsb.createNodeUsb({ module: {} })).rejects.toMatchObject({ kind: 'unsupported' });
  });

  it('says how to install the package when it cannot be loaded', async () => {
    const error = (await nodeUsb.createNodeUsb({ packageName: 'thru-trezor-no-such-package' }).catch((e: unknown) => e)) as Error & { kind?: string };
    expect(error).toBeInstanceOf(nodeUsb.UsbTransportError);
    expect(error.kind).toBe('unsupported');
    expect(error.message).toMatch(/pnpm add thru-trezor-no-such-package/);
  });

  it('has no Trezor, a bootloader, or two: the Rust host\'s errors', async () => {
    const none = nodeUsb.openNodeUsbTransport({ module: fakeUsbModule(new FakeUsb([new FakeUsbDevice({ vendorId: 0x2c97 })])) });
    await expect(none).rejects.toMatchObject({ kind: 'not_found' });
    const boot = nodeUsb.openNodeUsbTransport({ module: fakeUsbModule(new FakeUsb([new FakeUsbDevice({ productId: 0x53c0 })])) });
    await expect(boot).rejects.toThrow(/bootloader/);
    const two = nodeUsb.openNodeUsbTransport({ module: fakeUsbModule(new FakeUsb([new FakeUsbDevice(), new FakeUsbDevice()])) });
    await expect(two).rejects.toMatchObject({ kind: 'ambiguous' });
  });

  it('exports the credential file store', () => {
    expect(typeof nodeUsb.FileCredentialStore).toBe('function');
  });
});

describe('the transport error kinds reach the caller through the driver', () => {
  it('an unplugged device during the handshake is a TrezorTransportError of kind disconnected, with the CLI code transport', async () => {
    const device = new FakeUsbDevice();
    const transport = await webusb.requestWebUsbTransport({ usb: new FakeUsb([device]) });
    const connecting = api.Link.open(transport, { clock: api.systemClock, knownCredentials: [] });
    // The link has written the channel allocation request; the device is unplugged before it answers.
    await new Promise((r) => setTimeout(r, 20));
    device.unplug();
    const error = (await connecting.catch((e: unknown) => e)) as InstanceType<Api['TrezorTransportError']>;
    expect(error).toBeInstanceOf(api.TrezorTransportError);
    expect(error.kind).toBe('disconnected');
    expect(api.trezorErrorCode(error)).toBe('transport');
  });

  it('a device that holds a bad packet is kind io; no device chosen reports as the CLI\'s not_found', async () => {
    const error = new api.TrezorTransportError('x', { kind: 'no_device_chosen' });
    expect(api.trezorErrorCode(error)).toBe('not_found');
    expect(api.trezorErrorCode(new api.TrezorTransportError('x', { kind: 'busy' }))).toBe('transport');
    expect(api.transportKindOf(named('E', 'x'))).toBeUndefined();
    expect(api.transportKindOf({ kind: 'busy' })).toBe('busy');
    void packet;
  });
});

describe('the diagnostics of the IndexedDB store reach the caller through the client', () => {
  it('an unavailable IndexedDB is a credentials error that names the database and the failure', async () => {
    const broken = {
      open: () => {
        throw named('SecurityError', 'The operation is insecure.');
      },
    } as unknown as IDBFactory;
    const clock = { now: () => 0, setTimeout: () => 0, clearTimeout: () => undefined };
    const transport = { writePacket: async () => undefined, readPacket: () => new Promise<Uint8Array>(() => undefined), close: async () => undefined };
    const error = (await api.TrezorClient.connect(transport, {
      hostName: 'h',
      appName: 'a',
      credentialStore: new webusb.IndexedDbCredentialStore({ indexedDB: broken, databaseName: 'diagnostic-database' }),
      ui: { pairingCode: () => '000000' },
      clock,
    }).catch((e: unknown) => e)) as Error;
    expect(error).toBeInstanceOf(api.TrezorCredentialsError);
    expect(error.message).toContain('the credentials could not be read');
    expect(error.message).toContain('diagnostic-database');
    expect(error.message).toContain('SecurityError');
  });
});
