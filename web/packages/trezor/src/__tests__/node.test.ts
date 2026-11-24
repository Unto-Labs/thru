/**
 * What only Node has: the credential file and the emulator's UDP transport
 * (`dist/emulator.js`), and the recorded conversation played over real UDP
 * sockets through the browser bundle's driver (`dist/index.js`).
 */
import { createSocket, type Socket } from 'node:dgram';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { inspect } from 'node:util';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as EmulatorModule from '../emulator';
import { distFile, loadBundle, loadVectors } from './helpers/bundle';
import { Conversation, randomValuesOf, scriptRandom, stepsOf, type ScriptedTransport } from './driver-support';
import type { Api, Vectors } from './vector-checks';

type Emulator = typeof EmulatorModule;

let api: Api;
let emulator: Emulator;
let vectors: Vectors;
let dir: string;

beforeAll(async () => {
  api = await loadBundle();
  const url = pathToFileURL(distFile('emulator.js')).href;
  emulator = (await import(/* @vite-ignore */ url)) as Emulator;
  vectors = loadVectors();
  dir = mkdtempSync(join(tmpdir(), 'thru-trezor-'));
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

const record = (device: number, credential = 10) => ({
  trezorStaticPubkey: new Uint8Array(32).fill(device),
  hostStaticPrivkey: new Uint8Array(32).fill(0x55),
  credential: new Uint8Array(credential).fill(0xc0 + device),
});

describe('the credential file', () => {
  it('writes a file of mode 0600 in a directory of mode 0700, in the Rust host\'s format', async () => {
    const path = join(dir, 'a', 'b', 'credentials.json');
    const store = new emulator.FileCredentialStore(path);
    expect(await store.load()).toEqual([]);
    await store.store(record(1));
    expect((statSync(path).mode & 0o777).toString(8)).toBe('600');
    expect((statSync(join(dir, 'a', 'b')).mode & 0o777).toString(8)).toBe('700');
    const text = readFileSync(path, 'utf8');
    expect(JSON.parse(text)).toEqual({
      version: 1,
      credentials: [
        {
          trezor_static_pubkey: '01'.repeat(32),
          host_static_privkey: '55'.repeat(32),
          credential: 'c1'.repeat(10),
        },
      ],
    });
    expect(text).toBe(JSON.stringify(JSON.parse(text), null, 2));
    // No temporary file is left behind.
    expect(readdirSync(join(dir, 'a', 'b'))).toEqual(['credentials.json']);
  });

  it('reads what it wrote, replaces a device, keeps the others, and forgets', async () => {
    const store = new emulator.FileCredentialStore(join(dir, 'replace.json'));
    await store.store(record(1));
    await store.store(record(2));
    await store.store({ ...record(1), credential: new Uint8Array(5).fill(9) });
    const all = await new emulator.FileCredentialStore(join(dir, 'replace.json')).load();
    expect(all.map((r) => [r.trezorStaticPubkey[0], r.credential.length])).toEqual([[2, 10], [1, 5]]);
    await store.forget(new Uint8Array(32).fill(2));
    expect((await store.load()).map((r) => r.trezorStaticPubkey[0])).toEqual([1]);
    await store.forget();
    expect(await store.load()).toEqual([]);
    expect((statSync(join(dir, 'replace.json')).mode & 0o777).toString(8)).toBe('600');
  });

  it('serializes writes made at the same time', async () => {
    const store = new emulator.FileCredentialStore(join(dir, 'parallel.json'));
    await Promise.all(Array.from({ length: 25 }, (_, i) => store.store(record(i + 1))));
    expect((await store.load()).length).toBe(25);
    expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('refuses a file it cannot read, names it, and never overwrites it', async () => {
    const path = join(dir, 'broken.json');
    for (const text of ['{', '[]', JSON.stringify({ version: 2, credentials: [] }), JSON.stringify({ version: 1 }), JSON.stringify({ version: 1, credentials: [{ trezor_static_pubkey: 'zz' }] })]) {
      writeFileSync(path, text);
      const store = new emulator.FileCredentialStore(path);
      await expect(store.load()).rejects.toThrow(path);
      await expect(store.store(record(1))).rejects.toThrow(path);
      expect(readFileSync(path, 'utf8')).toBe(text);
    }
  });

  it('is wrapped as a credentials error when the client cannot read it', async () => {
    const path = join(dir, 'unreadable.json');
    writeFileSync(path, '{');
    const clock = { now: () => 0, setTimeout: () => 0, clearTimeout: () => undefined };
    const transport = { writePacket: async () => undefined, readPacket: () => new Promise<Uint8Array>(() => undefined), close: async () => undefined };
    const error = await api.TrezorClient.connect(transport, {
      hostName: 'h',
      appName: 'a',
      credentialStore: new emulator.FileCredentialStore(path),
      ui: { pairingCode: () => '000000' },
      clock,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(api.TrezorCredentialsError);
    expect(String((error as Error).message)).toContain(path);
  });

  it('keeps a credential of 127 bytes that another host wrote', async () => {
    const store = new emulator.FileCredentialStore(join(dir, 'long.json'));
    await store.store(record(3, 127));
    expect((await store.load())[0].credential.length).toBe(127);
  });

  it('creates nothing outside its directory', async () => {
    mkdirSync(join(dir, 'only'));
    await new emulator.FileCredentialStore(join(dir, 'only', 'c.json')).store(record(1));
    expect(readdirSync(join(dir, 'only'))).toEqual(['c.json']);
  });
});

describe('the credential file and Buffers', () => {
  it('keeps its own bytes of a record held in a Node Buffer, also while the write waits in the queue', async () => {
    const path = join(dir, 'buffers.json');
    const store = new emulator.FileCredentialStore(path);
    // Something is in the queue, so the write runs after the caller has changed its Buffers.
    const earlier = store.load();
    const given = {
      trezorStaticPubkey: Buffer.alloc(32, 1),
      hostStaticPrivkey: Buffer.alloc(32, 2),
      credential: Buffer.alloc(10, 3),
    };
    const storing = store.store(given);
    given.trezorStaticPubkey.fill(9);
    given.hostStaticPrivkey.fill(9);
    given.credential.fill(9);
    await Promise.all([earlier, storing]);
    expect(JSON.parse(readFileSync(path, 'utf8')).credentials).toEqual([
      { trezor_static_pubkey: '01'.repeat(32), host_static_privkey: '02'.repeat(32), credential: '03'.repeat(10) },
    ]);
  });

  it('forgets the device named at the call, not the one the key comes to name while the call waits', async () => {
    const store = new emulator.FileCredentialStore(join(dir, 'forget-buffer.json'));
    await store.store(record(1));
    await store.store(record(2));
    const earlier = store.load();
    const key = Buffer.alloc(32, 2);
    const forgetting = store.forget(key);
    key.fill(1);
    await Promise.all([earlier, forgetting]);
    expect((await store.load()).map((r) => r.trezorStaticPubkey[0])).toEqual([1]);
  });
});

describe('a credential file that cannot be parsed never quotes it', () => {
  const secret = '1f2e3d4c5b6a79880a1b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef';
  const windows = (text: string): string[] => Array.from({ length: text.length - 7 }, (_, i) => text.slice(i, i + 8));
  const entry = (privkey: string): string =>
    JSON.stringify({ version: 1, credentials: [{ trezor_static_pubkey: '01'.repeat(32), host_static_privkey: privkey, credential: 'c1'.repeat(10) }] }, null, 2);
  const files: [string, string, RegExp][] = [
    ['a stray character after the key', entry(`${secret}x`), /host_static_privkey/],
    ['a stray character inside the key', entry(`${secret.slice(0, 20)}zz${secret.slice(22)}`), /host_static_privkey/],
    ['a key of odd length', entry(secret.slice(1)), /host_static_privkey/],
    ['a key that is not text', entry(secret).replace(`"${secret}"`, '12345'), /host_static_privkey/],
    ['a key with a prefix', entry(`0x${secret}`), /host_static_privkey/],
    ['broken JSON right after the key', `{"version":1,"credentials":[{"host_static_privkey":"${secret}", nope}]}`, /not valid JSON/],
    ['broken JSON before the key', `{"version":1,"credentials":[nope,{"host_static_privkey":"${secret}"}]}`, /not valid JSON/],
    ['a version that is the key', JSON.stringify({ version: secret, credentials: [] }), /version/],
  ];
  const everything = (error: unknown): string => {
    const parts = [inspect(error, { depth: 20, showHidden: true })];
    for (let e: unknown = error, depth = 0; e !== undefined && e !== null && depth < 10; depth++) {
      parts.push(String(e), (e as Error).message ?? '', (e as Error).stack ?? '');
      e = (e as { cause?: unknown }).cause;
    }
    return parts.join('\n');
  };
  const logged: string[] = [];
  let spies: Array<{ mockRestore(): void }> = [];
  beforeEach(() => {
    logged.length = 0;
    spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void logged.push(args.map((a) => String(a)).join(' '))),
    );
  });
  afterEach(() => spies.forEach((spy) => spy.mockRestore()));

  it.each(files)('%s', async (_what, text, pattern) => {
    const path = join(dir, 'secret.json');
    writeFileSync(path, text);
    const store = new emulator.FileCredentialStore(path);
    const direct = await store.load().catch((e: unknown) => e);
    expect(direct).toBeInstanceOf(emulator.CredentialFileError);
    expect((direct as Error).message).toContain(path);
    expect((direct as Error).message).toMatch(pattern);
    expect(windows(secret).filter((w) => everything(direct).includes(w))).toEqual([]);

    // Through the client: the error it raises holds nothing of the file either.
    const clock = { now: () => 0, setTimeout: () => 0, clearTimeout: () => undefined };
    const transport = { writePacket: async () => undefined, readPacket: () => new Promise<Uint8Array>(() => undefined), close: async () => undefined };
    const wrapped = await api.TrezorClient.connect(transport, {
      hostName: 'h',
      appName: 'a',
      credentialStore: store,
      ui: { pairingCode: () => '000000' },
      clock,
    }).catch((e: unknown) => e);
    expect(wrapped).toBeInstanceOf(api.TrezorCredentialsError);
    // The file's own diagnostics (its path and what is wrong with it) reach the caller.
    expect((wrapped as Error).message).toContain(path);
    expect((wrapped as Error).message).toMatch(pattern);
    expect(windows(secret).filter((w) => everything(wrapped).includes(w))).toEqual([]);
    expect(windows(secret).filter((w) => logged.join('\n').includes(w))).toEqual([]);
    expect(readFileSync(path, 'utf8')).toBe(text);
  });
});

/** A UDP socket that answers the emulator's ping and plays `onPacket`. */
async function fakeEmulator(onPacket: (packet: Uint8Array, reply: (packets: Uint8Array[]) => void) => void) {
  const socket: Socket = createSocket('udp4');
  const received: Uint8Array[] = [];
  socket.on('message', (message, remote) => {
    const reply = (packets: Uint8Array[]): void => {
      for (const p of packets) socket.send(p, remote.port, remote.address);
    };
    if (message.toString('latin1') === 'PINGPING') {
      socket.send(Buffer.from('PONGPONG'), remote.port, remote.address);
      return;
    }
    received.push(Uint8Array.from(message));
    onPacket(Uint8Array.from(message), reply);
  });
  await new Promise<void>((resolve) => socket.bind(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  return {
    address: `127.0.0.1:${port}`,
    received,
    close: () => new Promise<void>((resolve) => socket.close(() => resolve())),
  };
}

describe('the emulator\'s UDP transport', () => {
  it('pings, says it is the emulator, sends 64-byte packets and reads them', async () => {
    let send!: (packets: Uint8Array[]) => void;
    const server = await fakeEmulator((_packet, reply) => (send = reply));
    const transport = await emulator.UdpTransport.connect({ address: server.address });
    try {
      expect(transport.isEmulator).toBe(true);
      await transport.writePacket(new Uint8Array(64).fill(7));
      await new Promise((r) => setTimeout(r, 50));
      expect(server.received.length).toBe(1);
      expect([...server.received[0]]).toEqual(new Array(64).fill(7));
      // A packet that arrives while nobody reads is kept for the next read.
      send([new Uint8Array(64).fill(1), new Uint8Array(64).fill(2)]);
      await new Promise((r) => setTimeout(r, 50));
      expect((await transport.readPacket())[0]).toBe(1);
      expect((await transport.readPacket())[0]).toBe(2);
      // A read that waits is answered by the next packet.
      const waiting = transport.readPacket();
      send([new Uint8Array(64).fill(3)]);
      expect((await waiting)[0]).toBe(3);
      // A second read while one is outstanding breaks the contract and is refused.
      const first = transport.readPacket();
      await expect(transport.readPacket()).rejects.toThrow(/already outstanding/);
      // A packet of the wrong size is not a packet.
      await expect(transport.writePacket(new Uint8Array(63))).rejects.toThrow(/64 bytes/);
      // Closing cancels the read that waits.
      await transport.close();
      await expect(first).rejects.toThrow(/closed/);
      await expect(transport.writePacket(new Uint8Array(64))).rejects.toThrow(/closed/);
      await transport.close();
    } finally {
      await transport.close();
      await server.close();
    }
  });

  it('bounds what it keeps for a reader that is not reading: past the bound it fails with a typed error and keeps nothing more', async () => {
    let send!: (packets: Uint8Array[]) => void;
    const server = await fakeEmulator((_packet, reply) => (send = reply));
    expect(emulator.UDP_QUEUE_LIMIT).toBeGreaterThanOrEqual(256);
    const transport = await emulator.UdpTransport.connect({ address: server.address, maxQueuedPackets: 16 });
    try {
      // The peer learns where to send from the first packet it gets.
      await transport.writePacket(new Uint8Array(64));
      await new Promise((r) => setTimeout(r, 50));
      // Exactly the bound is kept and read.
      send(Array.from({ length: 16 }, (_, i) => new Uint8Array(64).fill(i + 1)));
      await new Promise((r) => setTimeout(r, 100));
      expect((await transport.readPacket())[0]).toBe(1);
      // Nobody reads: the peer sends far more than the bound.
      send(Array.from({ length: 300 }, (_, i) => new Uint8Array(64).fill(i & 0xff)));
      await new Promise((r) => setTimeout(r, 200));
      const error = await transport.readPacket().then(() => undefined, (e: unknown) => e);
      expect(error).toBeInstanceOf(emulator.UdpQueueFullError);
      expect(error).toBeInstanceOf(emulator.UdpTransportError);
      expect((error as Error).message).toMatch(/16/);
      // The packets kept before are not delivered after the failure, and every later call fails the same way.
      await expect(transport.readPacket()).rejects.toBe(error);
      await expect(transport.writePacket(new Uint8Array(64))).rejects.toBe(error);
    } finally {
      await transport.close();
      await server.close();
    }
  });

  it('refuses a bound on the queue that is not a whole number of at least 1, when the transport is made', async () => {
    // A port nothing listens on: a bound that is not refused fails later, with another message.
    const unused = createSocket('udp4');
    await new Promise<void>((resolve) => unused.bind(0, '127.0.0.1', resolve));
    const { port } = unused.address();
    unused.close();
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 2]) {
      const error = await emulator.UdpTransport.connect({ address: `127.0.0.1:${port}`, pingTimeoutMs: 50, maxQueuedPackets: bad }).then(
        async (transport) => {
          await transport.close();
          return undefined;
        },
        (e: unknown) => e,
      );
      expect(error, String(bad)).toBeInstanceOf(emulator.UdpTransportError);
      expect((error as Error).message, String(bad)).toMatch(/maxQueuedPackets/);
    }
    // The smallest bound and the default are fine.
    const server = await fakeEmulator(() => undefined);
    try {
      for (const good of [1, undefined]) {
        const transport = await emulator.UdpTransport.connect({ address: server.address, maxQueuedPackets: good });
        await transport.close();
      }
    } finally {
      await server.close();
    }
  });

  it('refuses a port where nothing answers the ping', async () => {
    const socket = createSocket('udp4');
    await new Promise<void>((resolve) => socket.bind(0, '127.0.0.1', resolve));
    const { port } = socket.address();
    socket.close();
    await expect(emulator.UdpTransport.connect({ address: `127.0.0.1:${port}`, pingTimeoutMs: 100 })).rejects.toThrow(/no emulator answers|emulator at/);
    await expect(emulator.UdpTransport.connect({ address: 'nonsense' })).rejects.toThrow(/host:port/);
  });
});

describe('the recorded conversation over UDP', () => {
  it('plays the reconnect scenario through the bundle\'s driver on real sockets', async () => {
    const sc = vectors.handshake.scenarios.find((s) => s.name === 'reconnect_with_credential')!;
    const steps = stepsOf(api, [...sc.handshake_frames, ...sc.conversation_frames]);
    let reply!: (packets: Uint8Array[]) => void;
    // The conversation pushes through this stand-in, which sends datagrams.
    const stand = { writeTimes: [] as number[], onWrite: (_p: Uint8Array): void => undefined, push: (packets: readonly Uint8Array[]) => reply([...packets]) };
    const conversation = new Conversation(steps);
    const server = await fakeEmulator((packet, r) => {
      reply = r;
      stand.onWrite(packet);
    });
    const random = scriptRandom(api, randomValuesOf(api, sc));
    try {
      const transport = await emulator.UdpTransport.connect({ address: server.address });
      conversation.attach(stand as unknown as ScriptedTransport);
      const store = new api.MemoryCredentialStore();
      const stored = sc.inputs.stored_credential!;
      await store.store({
        trezorStaticPubkey: api.fromHex(stored.trezor_static_pubkey),
        hostStaticPrivkey: api.fromHex(stored.host_static_privkey),
        credential: api.fromHex(stored.credential),
      });
      const client = await api.TrezorClient.connect(transport, {
        hostName: 'vector-host',
        appName: 'thru',
        credentialStore: store,
        ui: { pairingCode: () => '000000', enterPassphraseOnDevice: () => undefined },
        passphraseOnDevice: true,
      });
      expect(client.channel.credentialMatched).toBe(true);
      expect(conversation.mismatches).toEqual([]);
      // The first host frames of the recording were matched packet for packet, over sockets.
      expect(conversation.hostFrames.length).toBeGreaterThan(8);
      await client.close();
    } finally {
      random.restore();
      await server.close();
    }
  });
});
