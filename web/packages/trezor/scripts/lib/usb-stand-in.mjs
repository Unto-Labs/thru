// The stand-in for `navigator.usb` that the browser tests of the Trezor host and
// of the wallet's Trezor popup share, and the emulator end it talks to.
//
// How packets travel: the page has a stand-in for `navigator.usb` (STAND_IN
// below). Its device does nothing but forward: `transferOut` sends the 64
// bytes, as hex, through a Playwright binding to the test, which sends them as
// one UDP datagram to the emulator; `transferIn` asks the test for the next
// datagram. Everything on the page side of that line is production code. The
// stand-in also keeps what Chrome keeps: a device request is refused outside a
// click (and consumes it), an open device can be claimed once, a pending
// transfer is aborted when the device closes, a granted device is remembered
// for the origin (localStorage), and two IN transfers at once are an error.
//
//   const standIn = createUsbStandIn({ address: '127.0.0.1:21324' });
//   await standIn.install(context);   // a Playwright browser context
//   ...
//   standIn.counters.writes           // 64-byte packets sent to the device so far
//   await standIn.close();            // closes an emulator end a page left open
//
// One stand-in serves any number of contexts, one after the other: its
// counters add up, and it holds at most one open device.
import { createSocket } from 'node:dgram';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';

// The stand-in for navigator.usb: plain JavaScript (a serialized function can
// pick up helpers from the transform that do not exist in the page). The
// bindings are looked up per call: they may be installed after this runs.
export const STAND_IN = String.raw`
(() => {
  const toHex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  const fromHex = (h) => new Uint8Array((h.match(/../g) || []).map((x) => parseInt(x, 16)));
  const named = (name, message) => Object.assign(new Error(message), { name });
  const interrupt = (direction) => ({ endpointNumber: 1, direction, type: 'interrupt', packetSize: 64 });
  const configuration = {
    configurationValue: 1,
    interfaces: [{ interfaceNumber: 0, claimed: false, alternate: { alternateSetting: 0, interfaceClass: 0xff, endpoints: [interrupt('out'), interrupt('in')] } }],
  };
  class StandInDevice {
    constructor() {
      this.vendorId = 0x1209;
      this.productId = 0x53c1;
      this.opened = false;
      this.configuration = configuration;
      this.configurations = [configuration];
      this.claimed = false;
      this.pending = null;
      this.nextId = 1;
    }
    async open() {
      if (this.opened) throw named('InvalidStateError', 'The device is already open.');
      await window.__emuOpen();
      this.opened = true;
    }
    async close() {
      if (!this.opened) return;
      this.opened = false;
      this.claimed = false;
      if (this.pending) {
        const pending = this.pending;
        this.pending = null;
        window.__emuCancel(pending.id);
        pending.reject(named('AbortError', 'The transfer was aborted.'));
      }
      await window.__emuClose();
    }
    async selectConfiguration() {}
    async claimInterface(n) {
      if (!this.opened) throw named('InvalidStateError', 'The device must be opened first.');
      if (n !== 0) throw named('NotFoundError', 'No such interface.');
      if (this.claimed) throw named('NetworkError', 'Unable to claim interface.');
      this.claimed = true;
    }
    async releaseInterface() {
      this.claimed = false;
    }
    async transferOut(endpoint, data) {
      if (!this.opened || !this.claimed) throw named('InvalidStateError', 'The interface must be claimed first.');
      if (endpoint !== 1) throw named('NotFoundError', 'No such endpoint.');
      const bytes = new Uint8Array(data.buffer ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : data);
      await window.__emuWrite(toHex(bytes));
      return { status: 'ok', bytesWritten: bytes.length };
    }
    transferIn(endpoint, length) {
      if (!this.opened || !this.claimed) return Promise.reject(named('InvalidStateError', 'The interface must be claimed first.'));
      if (endpoint !== 1 || length !== 64) return Promise.reject(named('NotFoundError', 'No such endpoint.'));
      // The contract of the transport: one IN transfer in flight at a time.
      if (this.pending) return Promise.reject(new Error('stand-in: two IN transfers at once'));
      const id = this.nextId++;
      return new Promise((resolve, reject) => {
        this.pending = { id, reject };
        window.__emuRead(id).then(
          (hex) => {
            if (!this.pending || this.pending.id !== id) {
              // The device closed while the datagram was on its way: give it back.
              window.__emuUnread(hex);
              return;
            }
            this.pending = null;
            const bytes = fromHex(hex);
            resolve({ status: 'ok', data: new DataView(bytes.buffer) });
          },
          (error) => {
            if (this.pending && this.pending.id === id) {
              this.pending = null;
              reject(error);
            }
          },
        );
      });
    }
  }
  const device = new StandInDevice();
  // Chrome allows the device picker inside a click only, and a click allows one.
  let activation = -Infinity;
  window.addEventListener('click', (event) => { if (event.isTrusted) activation = performance.now(); }, true);
  const usb = new EventTarget();
  usb.requestDevice = async (options) => {
    if (performance.now() - activation > 1000) throw named('SecurityError', 'Must be handling a user gesture to show a permission request.');
    activation = -Infinity;
    const matches = (options.filters || []).some((f) => f.vendorId === 0x1209 && (f.productId === undefined || f.productId === 0x53c1));
    if (!matches) throw named('NotFoundError', "Failed to execute 'requestDevice' on 'USB': No device selected.");
    localStorage.setItem('stand-in-granted', '1');
    return device;
  };
  usb.getDevices = async () => (localStorage.getItem('stand-in-granted') ? [device] : []);
  Object.defineProperty(navigator, 'usb', { value: usb, configurable: true });
})();
`;

// ---- the emulator end: one UDP socket per opened device ----

const PACKET_LEN = 64;

/**
 * @param {{ address: string, codeFile?: string, trace?: (line: string) => void }} options
 * `address` is the emulator's `host:port`; `codeFile`, when given, adds the
 * bindings through which a page reads the pairing code the device shows (the
 * debug-link helper writes it there) and clears it; `trace`, when given, is
 * called with one line (a time, what happened, never the bytes) for each
 * device opened or closed and each packet crossing the line.
 */
export function createUsbStandIn({ address, codeFile, trace }) {
  const note = (what) => trace?.(`${new Date().toISOString()} ${what}`);
  const device = { socket: undefined, queue: [], waiter: undefined };
  const counters = { opened: 0, closed: 0, writes: 0, reads: 0, maxReads: 0, unread: 0 };

  function openSocket() {
    const [host, portText] = [address.slice(0, address.lastIndexOf(':')), address.slice(address.lastIndexOf(':') + 1)];
    const socket = createSocket('udp4');
    device.queue = [];
    device.waiter = undefined;
    let onPong;
    socket.on('message', (message) => {
      if (onPong && message.toString('latin1') === 'PONGPONG') {
        onPong();
        return;
      }
      if (message.length !== PACKET_LEN) return;
      if (device.waiter) {
        const { resolve } = device.waiter;
        device.waiter = undefined;
        note('packet from the device, handed to a waiting read');
        resolve(Buffer.from(message).toString('hex'));
      } else {
        note('packet from the device, queued');
        device.queue.push(Buffer.from(message).toString('hex'));
      }
    });
    return new Promise((resolvePromise, reject) => {
      socket.once('error', reject);
      socket.bind(0, '127.0.0.1', () => {
        socket.connect(Number(portText), host, () => {
          const timer = setTimeout(() => reject(new Error(`no emulator answers at ${address}`)), 2000);
          onPong = () => {
            clearTimeout(timer);
            onPong = undefined;
            socket.off('error', reject);
            resolvePromise(socket);
          };
          socket.send(Buffer.from('PINGPING'));
        });
      });
    });
  }

  async function closeDevice() {
    const socket = device.socket;
    if (!socket) return;
    device.socket = undefined;
    device.queue = [];
    if (device.waiter) device.waiter = undefined;
    counters.closed++;
    note('device closed');
    await new Promise((r) => socket.close(r));
  }

  const bindings = {
    async __emuOpen() {
      if (device.socket) throw new Error('the emulator end is already open');
      device.socket = await openSocket();
      counters.opened++;
      note('device opened');
    },
    __emuClose: closeDevice,
    async __emuWrite(hex) {
      if (!device.socket) throw new Error('the emulator end is not open');
      counters.writes++;
      note('packet to the device');
      const bytes = Buffer.from(hex, 'hex');
      if (bytes.length !== PACKET_LEN) throw new Error(`a write of ${bytes.length} bytes`);
      await new Promise((resolveWrite, reject) => device.socket.send(bytes, (e) => (e ? reject(e) : resolveWrite())));
    },
    __emuRead(id) {
      if (!device.socket) return Promise.reject(new Error('the emulator end is not open'));
      counters.reads++;
      note('read asked');
      const queued = device.queue.shift();
      if (queued) return Promise.resolve(queued);
      if (device.waiter) return Promise.reject(new Error('two reads at once reached the emulator end'));
      return new Promise((resolveRead) => {
        device.waiter = { id, resolve: resolveRead };
      });
    },
    async __emuCancel(id) {
      if (device.waiter && device.waiter.id === id) device.waiter = undefined;
    },
    async __emuUnread(hex) {
      counters.unread++;
      device.queue.unshift(hex);
    },
  };
  if (codeFile !== undefined) {
    bindings.__emuShownCode = async () => {
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        if (existsSync(codeFile)) return readFileSync(codeFile, 'utf8').trim();
        await new Promise((r) => setTimeout(r, 200));
      }
      throw new Error('the device showed no pairing code within a minute');
    };
    bindings.__emuClearShownCode = async () => {
      if (existsSync(codeFile)) unlinkSync(codeFile);
    };
  }

  return {
    /** The counts of what crossed the line: devices opened and closed, packets written, reads, datagrams handed back. */
    counters,
    /** Whether a page holds the emulator end open. */
    get isOpen() {
      return device.socket !== undefined;
    },
    /** Adds the bindings and the stand-in to a Playwright browser context (before its pages load). */
    async install(context) {
      for (const [name, fn] of Object.entries(bindings)) await context.exposeFunction(name, fn);
      await context.addInitScript(STAND_IN);
    },
    /** Closes the emulator end if a page left it open (a browser that went away without closing the device). */
    close: closeDevice,
  };
}
