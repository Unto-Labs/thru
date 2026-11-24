/**
 * Checks of `@trezor/protocol` (with this package's shims) and of the message
 * codecs against `contrib/test/vectors/trezor/host_vectors.json`, which the
 * Rust host's own code wrote. The module takes the package's API as an
 * argument and uses no Node API, so the same code runs under vitest in Node
 * and, bundled, in a page in Chromium.
 *
 * A check is an equality of bytes or values. Where the library is known to
 * differ from the vectors, `deviation` pins what the library does, so that
 * the difference stays visible in the report and a change in either direction
 * is noticed.
 */
import type * as PackageApi from '../index';
import type { JsonFields } from '../messages-json';

export type Api = typeof PackageApi;

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
type Obj = { [key: string]: Json };

export type CheckFailure = { label: string; expected: string; actual: string };
export type Deviation = {
  id: string;
  label: string;
  vector: string;
  library: string;
};
export type GroupReport = {
  group: string;
  cases: number;
  failures: CheckFailure[];
  deviations: Deviation[];
};

export type Report = {
  eq(label: string, expected: unknown, actual: unknown): void;
  ok(label: string, condition: boolean, detail?: string): void;
  deviation(id: string, label: string, vector: string, library: string, holds: boolean): void;
  throws(label: string, fn: () => unknown): void;
  done(): GroupReport;
};

export function newReport(group: string): Report {
  const failures: CheckFailure[] = [];
  const deviations: Deviation[] = [];
  let cases = 0;
  const show = (v: unknown): string =>
    typeof v === 'bigint' ? v.toString() : typeof v === 'string' ? v : JSON.stringify(v);
  return {
    eq(label, expected, actual) {
      cases++;
      const e = show(expected);
      const a = show(actual);
      if (e !== a) failures.push({ label, expected: e, actual: a });
    },
    ok(label, condition, detail = '') {
      cases++;
      if (!condition) failures.push({ label, expected: 'true', actual: `false ${detail}`.trim() });
    },
    deviation(id, label, vector, library, holds) {
      cases++;
      deviations.push({ id, label, vector, library });
      if (!holds) {
        failures.push({
          label: `${id} ${label}`,
          expected: `pinned: ${library}`,
          actual: 'the library no longer behaves like this',
        });
      }
    },
    throws(label, fn) {
      cases++;
      try {
        fn();
        failures.push({ label, expected: 'an error', actual: 'no error' });
      } catch {
        // expected
      }
    },
    done: () => ({ group, cases, failures, deviations }),
  };
}

/** JSON with sorted keys, to compare field objects regardless of key order. */
function canon(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Obj).sort(([a], [b]) => (a < b ? -1 : 1)))
      : v,
  );
}

// ---- framing helpers (test-local: the library has none) ----

const PACKET = 64;

/** Splits a frame (header, length, payload, checksum) into 64-byte packets. */
function chunk(frame: Uint8Array): Uint8Array[] {
  const out: Uint8Array[] = [];
  const first = new Uint8Array(PACKET);
  const firstLen = Math.min(frame.length, PACKET);
  first.set(frame.subarray(0, firstLen));
  out.push(first);
  for (let off = PACKET; off < frame.length; off += PACKET - 3) {
    const p = new Uint8Array(PACKET);
    p[0] = 0x80;
    p[1] = frame[1];
    p[2] = frame[2];
    const part = frame.subarray(off, off + PACKET - 3);
    p.set(part, 3);
    out.push(p);
  }
  return out;
}

/** Joins packets into the frame they carry, without padding. */
function unchunk(packets: Uint8Array[]): Uint8Array {
  const total = 5 + ((packets[0][3] << 8) | packets[0][4]);
  const frame = new Uint8Array(total);
  frame.set(packets[0].subarray(0, Math.min(total, PACKET)));
  let off = PACKET;
  for (let i = 1; i < packets.length; i++) {
    const part = packets[i].subarray(3, 3 + Math.min(PACKET - 3, total - off));
    frame.set(part, off);
    off += PACKET - 3;
  }
  return frame;
}

// ---- vector file shapes (only what is read) ----

export type Frame = {
  index: number;
  direction: 'host_to_device' | 'device_to_host';
  kind: string;
  control_byte: string;
  sync_bits?: { ack_bit: boolean; seq_bit: boolean };
  channel_id: string;
  length: number;
  payload: string;
  checksum: string;
  packets: string[];
  counter?: number;
  pairing_state?: string;
  message?: { session: number; message_type: number; name: string; payload: string };
};

export type Scenario = {
  name: string;
  inputs: Obj & {
    channel_allocation_nonce: string;
    channel_id: string;
    device_properties: string;
    host_static_privkey: string;
    host_ephemeral_privkey: string;
    host_ephemeral_pubkey: string;
    stored_credential?: { trezor_static_pubkey: string; host_static_privkey: string; credential: string };
  };
  noise: {
    messages: Obj[];
    handshake_hash: string;
    host_to_device_key: string;
    device_to_host_key: string;
  };
  handshake_frames: Frame[];
  conversation_frames: Frame[];
};

export type Vectors = {
  messages: { cases: Obj[]; captured: Obj[] };
  cpace: {
    crypto: {
      elligator2: { input: string; reduced_input: string; output: string }[];
      exchanges: { exchange: Obj }[];
      low_order_device_keys: Obj[];
      generator_string_too_long: Obj[];
    };
    code_entry: Obj[];
  };
  credentials: Obj[];
  aead: { channel: Obj[]; synthetic: Obj[] };
  packets: (Frame & { name: string; scenario: string })[];
  handshake: { scenarios: Scenario[] };
};

const s = (o: Obj, key: string): string => o[key] as string;

// ---- groups ----

export function checkMessages(api: Api, v: Vectors): GroupReport {
  const r = newReport('messages');
  const { fromHex, toHex } = api;
  const run = (kind: string, entries: Obj[]): void => {
    entries.forEach((c, i) => {
      const where = `${kind}[${i}] ${s(c, 'name')}`;
      const codec = api.codecByName(s(c, 'name'));
      if (!codec) {
        r.ok(`${where}: codec exists`, false);
        return;
      }
      const fields = c.fields as JsonFields;
      r.eq(`${where}: encode`, s(c, 'hex'), toHex(codec.encode(api.fieldsFromJson(codec, fields) as never)));
      const decoded = codec.decode(fromHex(s(c, 'hex')));
      r.eq(`${where}: decode`, canon(fields), canon(api.fieldsToJson(codec, decoded)));
      if (c.wire_id !== undefined) r.eq(`${where}: wire id`, c.wire_id, codec.id);
      if (c.app_message_id !== undefined) r.eq(`${where}: app message id`, c.app_message_id, codec.id);
      if (c.wire_id !== undefined) r.eq(`${where}: layer`, 'wire', codec.layer);
      if (c.app_message_id !== undefined) r.eq(`${where}: layer`, 'app', codec.layer);
    });
  };
  run('cases', v.messages.cases);
  run('captured', v.messages.captured);
  return r.done();
}

/** The argument that `setRandomBytesSource` demands: it exists for tests only. */
const TEST_ONLY = { forTests: true } as const;

/** Scripted randomness: the next calls of `randomBytes` answer these values. */
function scriptRandom(api: Api, values: Uint8Array[]): { used: () => number; restore: () => void } {
  let n = 0;
  api.setRandomBytesSource((length) => {
    const value = values[n++];
    if (!value) throw new Error('unscripted randomBytes call');
    if (value.length !== length) throw new Error(`scripted ${value.length} bytes, asked ${length}`);
    return value;
  }, TEST_ONLY);
  return { used: () => n, restore: () => api.setRandomBytesSource(undefined, TEST_ONLY) };
}

export function checkCpace(api: Api, v: Vectors): GroupReport {
  const r = newReport('cpace');
  const { fromHex, toHex } = api;
  const B = (hex: string): Buffer => api.Buffer.from(fromHex(hex)) as unknown as Buffer;
  const { elligator2, curve25519 } = api.thpCrypto;

  v.cpace.crypto.elligator2.forEach((c, i) => {
    r.eq(`elligator2[${i}] ${c.input.slice(0, 8)}`, c.output, toHex(elligator2(B(c.input))));
  });

  v.cpace.crypto.exchanges.forEach(({ exchange: x }, i) => {
    const where = `exchange[${i}] code ${s(x, 'code')}`;
    r.eq(`${where}: generator from generator_hash`, s(x, 'generator'), toHex(elligator2(B(s(x, 'generator_hash')))));
    const script = scriptRandom(api, [fromHex(s(x, 'host_private_key'))]);
    try {
      const keys = api.thp.getCpaceHostKeys(s(x, 'code') as never, B(s(x, 'handshake_hash')));
      r.eq(`${where}: getCpaceHostKeys public key`, s(x, 'host_public_key'), toHex(keys.publicKey));
      r.eq(`${where}: getCpaceHostKeys private key`, s(x, 'host_private_key'), toHex(keys.privateKey));
      r.eq(`${where}: one random draw`, 1, script.used());
      const tag = api.thp.getSharedSecret(B(s(x, 'device_public_key')), keys.privateKey);
      r.eq(`${where}: getSharedSecret is SHA-256 of the shared secret`, s(x, 'tag'), toHex(tag));
    } finally {
      script.restore();
    }
    r.eq(`${where}: raw shared secret`, s(x, 'shared_secret'), toHex(curve25519(B(s(x, 'host_private_key')), B(s(x, 'device_public_key')))));
  });

  // A low-order device key gives an all-zero secret, which the Rust host
  // refuses; the library hashes it and goes on.
  v.cpace.crypto.low_order_device_keys.forEach((x, i) => {
    const zero = new Uint8Array(32);
    const expectedTag = toHex(api.thp.getSharedSecret(B(toHex(zero)), B(s(x, 'host_private_key'))));
    let library = 'throws';
    let holds = false;
    try {
      const tag = toHex(api.thp.getSharedSecret(B(s(x, 'device_public_key')), B(s(x, 'host_private_key'))));
      library = `returns a tag (${tag === expectedTag ? 'SHA-256 of 32 zero bytes' : tag})`;
      holds = tag === expectedTag;
    } catch {
      // keeps "throws"
    }
    r.deviation(
      'F1',
      `low-order device key ${s(x, 'device_public_key').slice(0, 4)} (case ${i})`,
      'error low_order_point: the host stops',
      library,
      holds,
    );
  });

  // Inputs the Rust host refuses as too long; the library takes them.
  const tooLong = v.cpace.crypto.generator_string_too_long;
  tooLong.forEach((x, i) => {
    const code = 'x'.repeat(x.code_length as number);
    const hash = new Uint8Array(x.handshake_hash_length as number).fill(7);
    const script = scriptRandom(api, [new Uint8Array(32).fill(9)]);
    let library = 'throws';
    let holds = false;
    try {
      api.thp.getCpaceHostKeys(code as never, api.Buffer.from(hash) as unknown as Buffer);
      library = 'returns a key pair';
      holds = true;
    } catch {
      // keeps "throws"
    } finally {
      script.restore();
    }
    r.deviation(
      'F2',
      `code of ${x.code_length} bytes, handshake hash of ${x.handshake_hash_length} bytes (case ${i})`,
      'error input_too_long',
      library,
      holds,
    );
  });

  v.cpace.code_entry.forEach((c, i) => {
    const where = `code_entry[${i}] code ${s(c, 'code')}`;
    const creds = {
      handshakeHash: B(s(c, 'handshake_hash')),
      handshakeCommitment: B(s(c, 'commitment')),
      codeEntryChallenge: B(s(c, 'challenge')),
    };
    const validate = (code: string, commitment = creds.handshakeCommitment): void =>
      api.thp.validateCodeEntryTag({ ...creds, handshakeCommitment: commitment } as never, code, s(c, 'secret'));
    try {
      validate(s(c, 'code'));
      r.ok(`${where}: valid code accepted`, true);
    } catch (e) {
      r.ok(`${where}: valid code accepted`, false, String(e));
    }
    const wrong = String((Number(s(c, 'code')) + 1) % 1000000).padStart(6, '0');
    r.throws(`${where}: wrong code ${wrong} refused`, () => validate(wrong));
    const bad = new Uint8Array(fromHex(s(c, 'commitment')));
    bad[0] ^= 1;
    r.throws(`${where}: wrong commitment refused`, () => validate(s(c, 'code'), api.Buffer.from(bad) as unknown as Buffer));
  });
  return r.done();
}

export function checkCredentials(api: Api, v: Vectors): GroupReport {
  const r = newReport('credentials');
  const { fromHex } = api;
  const B = (hex: string): Buffer => api.Buffer.from(fromHex(hex)) as unknown as Buffer;
  for (const c of v.credentials) {
    const stored = c.stored_credentials as Obj[];
    const known = stored.map((e) => ({
      trezor_static_public_key: s(e, 'trezor_static_pubkey'),
      host_static_key: s(e, 'host_static_privkey'),
      credential: s(e, 'credential'),
    }));
    const found = api.thpCrypto.findKnownPairingCredentials(
      known as never,
      B(s(c, 'masked_static_pubkey')),
      B(s(c, 'ephemeral_pubkey')),
    ) as unknown as typeof known;
    const first = found[0];
    const credentialBytes = first ? first.credential.length / 2 : 0;
    // The Rust host never uses a credential that does not fit the handshake
    // payload (longer than 126 bytes); the library has no such rule.
    if (c.matched === false && first !== undefined && credentialBytes > 126) {
      r.deviation(
        'F3',
        `${s(c, 'name')}: credential of ${credentialBytes} bytes`,
        'matched false: a credential longer than 126 bytes is never used',
        'matched: the first credential whose key fits is returned, whatever its length',
        found.length > 0,
      );
      continue;
    }
    r.eq(`${s(c, 'name')}: matched`, c.matched, first !== undefined);
    if (c.matched === true) {
      const index = known.findIndex((k) => k.credential === first.credential);
      const expectedKey = s(c, 'host_static_privkey');
      r.eq(`${s(c, 'name')}: stored key of the first match`, expectedKey, known[index].host_static_key);
      r.eq(
        `${s(c, 'name')}: Noise payload of the match`,
        s(c, 'noise_payload'),
        api.toHex(
          api.ThpHandshakeCompletionReqNoisePayload.encode({ host_pairing_credential: fromHex(first.credential) }),
        ),
      );
    } else {
      r.eq(`${s(c, 'name')}: Noise payload without a match`, s(c, 'noise_payload'), api.toHex(api.ThpHandshakeCompletionReqNoisePayload.encode({})));
    }
  }
  return r.done();
}

export function checkAead(api: Api, v: Vectors): GroupReport {
  const r = newReport('aead');
  const { fromHex, toHex } = api;
  const B = (hex: string): Buffer => api.Buffer.from(fromHex(hex)) as unknown as Buffer;
  const { aesgcm, getIvFromNonce } = api.thpCrypto;

  const both = (where: string, c: Obj, iv: Buffer): void => {
    const aad = B(s(c, 'associated_data'));
    const enc = aesgcm(B(s(c, 'key')), iv);
    enc.auth(aad);
    const ct = enc.encrypt(B(s(c, 'plaintext')));
    r.eq(`${where}: encrypt ciphertext`, s(c, 'ciphertext'), toHex(ct));
    r.eq(`${where}: encrypt tag`, s(c, 'tag'), toHex(enc.finish()));
    const dec = aesgcm(B(s(c, 'key')), iv);
    dec.auth(aad);
    try {
      r.eq(`${where}: decrypt`, s(c, 'plaintext'), toHex(dec.decrypt(B(s(c, 'ciphertext')), B(s(c, 'tag')))));
    } catch (e) {
      r.ok(`${where}: decrypt`, false, String(e));
    }
    const forged = new Uint8Array(fromHex(s(c, 'tag')));
    forged[15] ^= 1;
    const bad = aesgcm(B(s(c, 'key')), iv);
    bad.auth(aad);
    r.throws(`${where}: forged tag refused`, () =>
      bad.decrypt(B(s(c, 'ciphertext')), api.Buffer.from(forged) as unknown as Buffer),
    );
  };

  v.aead.channel.forEach((c, i) => {
    const where = `channel[${i}] ${s(c, 'scenario')} ${s(c, 'sender')} counter ${c.counter}`;
    const iv = getIvFromNonce(c.counter as number);
    r.eq(`${where}: nonce from counter`, s(c, 'nonce'), toHex(iv));
    both(where, c, B(s(c, 'nonce')));
  });

  v.aead.synthetic.forEach((c, i) => {
    const where = `synthetic[${i}] counter ${s(c, 'counter')}`;
    both(where, c, B(s(c, 'nonce')));
    const counter = BigInt(s(c, 'counter'));
    const viaLibrary = toHex(getIvFromNonce(Number(counter)));
    if (counter < 2n ** 31n) {
      r.eq(`${where}: nonce from counter`, s(c, 'nonce'), viaLibrary);
    } else {
      // `getIvFromNonce` shifts a JavaScript number with `>>`, which works on
      // 32-bit signed integers.
      r.deviation(
        'F4',
        `nonce for counter ${counter}`,
        `nonce ${s(c, 'nonce')}`,
        `nonce ${viaLibrary}`,
        viaLibrary !== s(c, 'nonce'),
      );
    }
  });
  return r.done();
}

function allFrames(sc: Scenario): Frame[] {
  return [...sc.handshake_frames, ...sc.conversation_frames];
}

function frameBytes(f: Frame): Uint8Array {
  const parts = [f.control_byte, f.channel_id, f.length.toString(16).padStart(4, '0'), f.payload, f.checksum];
  return new Uint8Array(parts.join('').match(/../g)!.map((b) => parseInt(b, 16)));
}

/** What the library's `decode` takes: the first packet's parts and the whole payload. */
function parsedFrame(api: Api, frame: Uint8Array): Record<string, unknown> {
  const B = (bytes: Uint8Array): Buffer => api.Buffer.from(bytes) as unknown as Buffer;
  const first = api.v2.decode(B(frame.subarray(0, Math.min(frame.length, PACKET)))) as unknown as {
    header: Uint8Array;
    chunkHeader: Uint8Array;
    length: number;
    messageType: number;
  };
  return {
    header: B(first.header),
    chunkHeader: B(first.chunkHeader),
    length: first.length,
    messageType: first.messageType,
    payload: B(frame.subarray(5)),
  };
}

const PAIRING_STATE: Record<string, number> = { unpaired: 0, paired: 1, paired_autoconnect: 2 };

export function checkPackets(api: Api, v: Vectors): GroupReport {
  const r = newReport('packets');
  const { fromHex, toHex } = api;
  const B = (hex: string): Buffer => api.Buffer.from(fromHex(hex)) as unknown as Buffer;
  const { thp, v2 } = api;
  const protoEnc = api.protobufEncoder as never;
  const protoDec = api.protobufDecoder as never;

  for (const sc of v.handshake.scenarios) {
    const props = api.ThpDeviceProperties.decode(fromHex(s(sc.inputs, 'device_properties')));
    const newState = (f: Frame): InstanceType<typeof thp.ThpState> => {
      const st = new thp.ThpState();
      st.setChannel(B(f.channel_id));
      st.setThpProperties(props as never);
      return st;
    };
    const frames = allFrames(sc);

    for (const f of frames) {
      const where = `${sc.name} frame ${f.index} ${f.direction === 'host_to_device' ? 'out' : 'in'} ${f.kind}`;
      const expectedFrame = frameBytes(f);
      const packets = f.packets.map((p) => fromHex(p));

      // The packets of the file are the frame cut into 64-byte packets.
      r.eq(`${where}: packet count`, packets.length, chunk(expectedFrame).length);
      r.eq(`${where}: chunking`, f.packets.join(''), chunk(expectedFrame).map(toHex).join(''));
      r.eq(`${where}: reassembly`, toHex(expectedFrame), toHex(unchunk(packets)));

      // The checksum is the library's CRC-32 over header, length and payload.
      r.eq(`${where}: crc32`, f.checksum, toHex(api.thpCrypto.crc32(B(toHex(expectedFrame.subarray(0, expectedFrame.length - 4))))));

      const ack = f.sync_bits?.ack_bit ? 1 : 0;
      const seq = f.sync_bits?.seq_bit ? 1 : 0;

      if (f.direction === 'host_to_device') {
        const st = newState(f);
        let produced: Buffer;
        switch (f.kind) {
          case 'channel_allocation_request':
            st.setChannel(B('ffff'));
            produced = thp.encode({
              messageName: 'ThpCreateChannelRequest',
              data: { nonce: s(sc.inputs, 'channel_allocation_nonce') },
              protobufEncoder: protoEnc,
              thpState: st,
            } as never);
            break;
          case 'handshake_initiation_request':
            produced = thp.encode({
              messageName: 'ThpHandshakeInitRequest',
              data: { key: f.payload.slice(0, 64), tryToUnlock: 1 },
              protobufEncoder: protoEnc,
              thpState: st,
            } as never);
            break;
          case 'handshake_completion_request':
            if (seq) st.updateSyncBit('send');
            produced = thp.encode({
              messageName: 'ThpHandshakeCompletionRequest',
              data: { hostPubkey: f.payload.slice(0, 96), encryptedPayload: f.payload.slice(96) },
              protobufEncoder: protoEnc,
              thpState: st,
            } as never);
            break;
          case 'ack':
            if (ack) st.updateAckBit('recv');
            produced = thp.encodeAck(st);
            r.eq(`${where}: encode({ThpAck}) with piggybacking not enabled`, toHex(expectedFrame), toHex(thp.encode({ messageName: 'ThpAck', data: {}, protobufEncoder: protoEnc, thpState: st } as never)));
            break;
          case 'encrypted_transport': {
            const m = f.message!;
            st.updateHandshakeCredentials({ hostKey: B(s(sc.noise as never, 'host_to_device_key')) } as never);
            st.setSessionId(B(m.session.toString(16).padStart(2, '0')));
            for (let n = 0; n < (f.counter ?? 0); n++) st.updateNonce('send');
            if (seq) st.updateSyncBit('send');
            st.enablePiggybackAck(true);
            // The library sends the complement of its "receive" ack bit.
            if (!ack) st.updateAckBit('recv');
            produced = thp.encodeProtobufMessage(m.message_type, B(m.payload), B(f.channel_id), st);
            break;
          }
          default:
            r.ok(`${where}: known kind`, false);
            continue;
        }
        r.eq(`${where}: library frame`, toHex(expectedFrame), toHex(produced));
        r.eq(`${where}: library frame, chunked`, f.packets.join(''), chunk(produced).map(toHex).join(''));
      } else {
        // Device to host: the library parses the first packet and the
        // reassembled payload.
        const first = v2.decode(B(toHex(packets[0])));
        const header = first.header as Uint8Array;
        const hdr = thp.readThpHeader(B(toHex(header)));
        r.eq(`${where}: control byte`, f.control_byte, toHex(new Uint8Array([header[0]])));
        r.eq(`${where}: ack bit`, f.sync_bits ? ack : 0, f.sync_bits ? hdr.ackBit : 0);
        r.eq(`${where}: sequence bit`, f.sync_bits ? seq : 0, f.sync_bits ? hdr.sequenceBit : 0);
        r.eq(`${where}: channel`, f.channel_id, toHex(hdr.channel));
        r.eq(`${where}: length`, f.length, first.length);
        const decoded = parsedFrame(api, expectedFrame);
        try {
          thp.validateCrc(decoded as never);
          r.ok(`${where}: validateCrc`, true);
        } catch (e) {
          r.ok(`${where}: validateCrc`, false, String(e));
        }
        r.eq(`${where}: crc from payload`, f.checksum, toHex(thp.getCRC(decoded as never)));
        const forged = new Uint8Array(expectedFrame);
        forged[forged.length - 1] ^= 1;
        r.throws(`${where}: corrupted checksum refused`, () =>
          thp.validateCrc({ ...decoded, payload: B(toHex(forged.subarray(5))) } as never),
        );

        const st = newState(f);
        switch (f.kind) {
          case 'channel_allocation_response': {
            const out = thp.decode(decoded as never, protoDec, st);
            const m = out.message as { nonce: Buffer; channel: Buffer; properties: unknown };
            r.eq(`${where}: nonce`, s(sc.inputs, 'channel_allocation_nonce'), toHex(m.nonce));
            r.eq(`${where}: channel id`, s(sc.inputs, 'channel_id'), toHex(m.channel));
            r.eq(`${where}: properties`, s(sc.inputs, 'device_properties'), toHex(api.ThpDeviceProperties.encode(m.properties as never)));
            break;
          }
          case 'handshake_initiation_response': {
            const out = thp.decode(decoded as never, protoDec, st);
            const m = out.message as { trezorEphemeralPubkey: Buffer; trezorEncryptedStaticPubkey: Buffer; tag: Buffer };
            const noise = sc.noise.messages.find((x) => x.name === 'initiation_response')!;
            r.eq(`${where}: ephemeral key`, s(noise, 'ephemeral_pubkey'), toHex(m.trezorEphemeralPubkey));
            r.eq(`${where}: encrypted static key`, s(noise, 'encrypted_static_pubkey'), toHex(m.trezorEncryptedStaticPubkey));
            r.eq(`${where}: payload tag`, s(noise, 'encrypted_payload'), toHex(m.tag));
            break;
          }
          case 'handshake_completion_response': {
            st.updateHandshakeCredentials({ trezorKey: B(sc.noise.device_to_host_key) } as never);
            const out = thp.decode(decoded as never, protoDec, st);
            r.eq(`${where}: pairing state`, PAIRING_STATE[f.pairing_state!], (out.message as { state: number }).state);
            break;
          }
          case 'ack': {
            const out = thp.decode(decoded as never, protoDec, st);
            r.eq(`${where}: type`, 'ThpAck', out.type);
            break;
          }
          case 'encrypted_transport': {
            const m = f.message!;
            st.updateHandshakeCredentials({ trezorKey: B(sc.noise.device_to_host_key) } as never);
            for (let n = 1; n < (f.counter ?? 0); n++) st.updateNonce('recv');
            const out = thp.decode(decoded as never, protoDec, st);
            r.eq(`${where}: message type`, m.name, out.type);
            const codec = api.codecByName(m.name)!;
            r.eq(`${where}: message payload`, m.payload, toHex(codec.encode(out.message as never)));
            break;
          }
          default:
            r.ok(`${where}: known kind`, false);
        }
      }
    }
  }

  // The file's selection of packets is a subset of the frames above.
  for (const p of v.packets) {
    const sc = v.handshake.scenarios.find((x) => x.name === p.scenario)!;
    const f = allFrames(sc).find((x) => x.index === p.index)!;
    r.eq(`packets[] ${p.name}: is frame ${p.index} of ${p.scenario}`, f.packets.join(''), p.packets.join(''));
  }
  return r.done();
}

export function checkHandshake(api: Api, v: Vectors): GroupReport {
  const r = newReport('handshake');
  const { fromHex, toHex } = api;
  const B = (hex: string): Buffer => api.Buffer.from(fromHex(hex)) as unknown as Buffer;
  const { thp } = api;
  const protoEnc = api.protobufEncoder as never;
  const protoDec = api.protobufDecoder as never;

  for (const sc of v.handshake.scenarios) {
    const where = sc.name;
    const frames = allFrames(sc);
    const byKind = (kind: string): Frame => frames.find((f) => f.kind === kind)!;
    const st = new thp.ThpState();
    st.setChannel(B('ffff'));

    // 1. Channel allocation response: the library derives the initial hash
    //    (the Noise protocol name mixed with the prologue, the device properties).
    const alloc = byKind('channel_allocation_response');
    const allocBytes = frameBytes(alloc);
    const allocOut = thp.decode(parsedFrame(api, allocBytes) as never, protoDec, st);
    const alloced = allocOut.message as { properties: unknown; handshakeHash: Buffer; channel: Buffer };
    st.setThpProperties(alloced.properties as never);
    st.setChannel(alloced.channel);
    st.updateHandshakeCredentials({ handshakeHash: alloced.handshakeHash } as never);

    // 2. Host ephemeral key from the vector's private scalar.
    const eph = thp.getCurve25519KeyPair(B(s(sc.inputs, 'host_ephemeral_privkey')));
    r.eq(`${where}: host ephemeral public key`, s(sc.inputs, 'host_ephemeral_pubkey'), toHex(eph.publicKey));

    // 3. Initiation request.
    const initReq = byKind('handshake_initiation_request');
    const initFrame = thp.encode({
      messageName: 'ThpHandshakeInitRequest',
      data: { key: toHex(eph.publicKey), tryToUnlock: 1 },
      protobufEncoder: protoEnc,
      thpState: st,
    } as never);
    r.eq(`${where}: initiation request frame`, toHex(frameBytes(initReq)), toHex(initFrame));
    st.sync('send', 'ThpHandshakeInitRequest');

    // 4. Initiation response in, completion request out.
    const initRes = byKind('handshake_initiation_response');
    const resBytes = frameBytes(initRes);
    const resOut = thp.decode(parsedFrame(api, resBytes) as never, protoDec, st);
    st.sync('recv', 'ThpHandshakeInitResponse');

    const cred = sc.inputs.stored_credential;
    const known = cred
      ? [{ trezor_static_public_key: cred.trezor_static_pubkey, host_static_key: cred.host_static_privkey, credential: cred.credential }]
      : [];
    const script = scriptRandom(api, cred ? [] : [fromHex(s(sc.inputs, 'host_static_privkey'))]);
    let hs: ReturnType<typeof thp.handleHandshakeInit>;
    try {
      hs = thp.handleHandshakeInit({
        handshakeInitResponse: resOut.message,
        thpState: st,
        knownCredentials: known,
        hostEphemeralKeys: eph,
        tryToUnlock: 1,
        protobufEncoder: protoEnc,
      } as never);
      r.eq(`${where}: random draws by handleHandshakeInit`, cred ? 0 : 1, script.used());
    } finally {
      script.restore();
    }

    const complReq = byKind('handshake_completion_request');
    r.eq(`${where}: host encrypted static key`, toHex(frameBytes(complReq).subarray(5, 5 + 48)), toHex(hs.hostEncryptedStaticPubkey));
    r.eq(`${where}: host encrypted payload`, toHex(frameBytes(complReq).subarray(5 + 48, frameBytes(complReq).length - 4)), toHex(hs.encryptedPayload));
    r.eq(`${where}: handshake hash`, sc.noise.handshake_hash, toHex(hs.handshakeHash));
    r.eq(`${where}: host to device key`, sc.noise.host_to_device_key, toHex(hs.hostKey));
    r.eq(`${where}: device to host key`, sc.noise.device_to_host_key, toHex(hs.trezorKey));
    r.eq(`${where}: credential matched`, cred ? cred.credential : null, hs.credentials ? (hs.credentials as { credential: string }).credential : null);
    r.eq(`${where}: host static public key`, s(sc.inputs, 'host_static_pubkey'), toHex(hs.hostStaticKeys.publicKey));

    st.updateHandshakeCredentials({ hostKey: hs.hostKey, trezorKey: hs.trezorKey, handshakeHash: hs.handshakeHash } as never);
    const complFrame = thp.encode({
      messageName: 'ThpHandshakeCompletionRequest',
      data: { hostPubkey: toHex(hs.hostEncryptedStaticPubkey), encryptedPayload: toHex(hs.encryptedPayload) },
      protobufEncoder: protoEnc,
      thpState: st,
    } as never);
    r.eq(`${where}: completion request frame`, toHex(frameBytes(complReq)), toHex(complFrame));
    st.sync('send', 'ThpHandshakeCompletionRequest');

    // 5. Completion response: the pairing state under the device to host key.
    const complRes = byKind('handshake_completion_response');
    const cBytes = frameBytes(complRes);
    const cOut = thp.decode(parsedFrame(api, cBytes) as never, protoDec, st);
    r.eq(`${where}: pairing state`, PAIRING_STATE[complRes.pairing_state!], (cOut.message as { state: number }).state);
  }
  return r.done();
}

/**
 * Extra, beyond the groups the plan asks for: the library's own `ThpState`
 * (sequence bits, acknowledgement bits, nonces) driven through both whole
 * conversations by `sync`, with every frame the library would send compared
 * with the file's and every frame it receives decoded. This is not a
 * connection driver (no transport, no timing, no retransmission): the order
 * of frames comes from the file.
 */
export function checkStateReplay(api: Api, v: Vectors): GroupReport {
  const r = newReport('state replay');
  const { fromHex, toHex } = api;
  const B = (hex: string): Buffer => api.Buffer.from(fromHex(hex)) as unknown as Buffer;
  const { thp } = api;
  const protoEnc = api.protobufEncoder as never;
  const protoDec = api.protobufDecoder as never;

  for (const sc of v.handshake.scenarios) {
    const st = new thp.ThpState();
    st.setChannel(B('ffff'));
    const where = (f: Frame): string => `${sc.name} frame ${f.index} ${f.kind}`;
    const handshake = sc.handshake_frames;
    const byKind = (kind: string): Frame => handshake.find((f) => f.kind === kind)!;

    // Handshake (as in `checkHandshake`), keeping the state.
    const alloc = thp.decode(parsedFrame(api, frameBytes(byKind('channel_allocation_response'))) as never, protoDec, st);
    const a = alloc.message as { properties: unknown; handshakeHash: Buffer; channel: Buffer };
    st.setThpProperties(a.properties as never);
    st.setChannel(a.channel);
    st.updateHandshakeCredentials({ handshakeHash: a.handshakeHash } as never);
    const eph = thp.getCurve25519KeyPair(B(s(sc.inputs, 'host_ephemeral_privkey')));
    r.eq(
      `${sc.name}: initiation request (ack bit asks for piggybacking)`,
      toHex(frameBytes(byKind('handshake_initiation_request'))),
      toHex(thp.encode({ messageName: 'ThpHandshakeInitRequest', data: { key: toHex(eph.publicKey), tryToUnlock: 1 }, protobufEncoder: protoEnc, thpState: st } as never)),
    );
    st.sync('send', 'ThpHandshakeInitRequest');
    const initRes = thp.decode(parsedFrame(api, frameBytes(byKind('handshake_initiation_response'))) as never, protoDec, st);
    st.sync('recv', 'ThpHandshakeInitResponse');
    const cred = sc.inputs.stored_credential;
    const known = cred
      ? [{ trezor_static_public_key: cred.trezor_static_pubkey, host_static_key: cred.host_static_privkey, credential: cred.credential }]
      : [];
    const script = scriptRandom(api, cred ? [] : [fromHex(s(sc.inputs, 'host_static_privkey'))]);
    let hs: ReturnType<typeof thp.handleHandshakeInit>;
    try {
      hs = thp.handleHandshakeInit({ handshakeInitResponse: initRes.message, thpState: st, knownCredentials: known, hostEphemeralKeys: eph, tryToUnlock: 1, protobufEncoder: protoEnc } as never);
    } finally {
      script.restore();
    }
    st.updateHandshakeCredentials({ hostKey: hs.hostKey, trezorKey: hs.trezorKey, handshakeHash: hs.handshakeHash } as never);
    r.eq(
      `${sc.name}: completion request`,
      toHex(frameBytes(byKind('handshake_completion_request'))),
      toHex(thp.encode({ messageName: 'ThpHandshakeCompletionRequest', data: { hostPubkey: toHex(hs.hostEncryptedStaticPubkey), encryptedPayload: toHex(hs.encryptedPayload) }, protobufEncoder: protoEnc, thpState: st } as never)),
    );
    st.sync('send', 'ThpHandshakeCompletionRequest');
    thp.decode(parsedFrame(api, frameBytes(byKind('handshake_completion_response'))) as never, protoDec, st);
    st.sync('recv', 'ThpHandshakeCompletionResponse');
    st.enablePiggybackAck(true);

    // Conversation.
    for (const f of sc.conversation_frames) {
      const bytes = frameBytes(f);
      if (f.direction === 'host_to_device') {
        let produced: Buffer;
        if (f.kind === 'ack') {
          produced = thp.encode({ messageName: 'ThpAck', data: {}, protobufEncoder: protoEnc, thpState: st } as never);
        } else {
          const m = f.message!;
          st.setSessionId(B(m.session.toString(16).padStart(2, '0')));
          produced = thp.encodeProtobufMessage(m.message_type, B(m.payload), st.channel, st);
          st.sync('send', m.name);
        }
        r.eq(`${where(f)}: frame sent`, toHex(bytes), toHex(produced));
      } else {
        const out = thp.decode(parsedFrame(api, bytes) as never, protoDec, st);
        if (f.kind === 'ack') {
          r.eq(`${where(f)}: type`, 'ThpAck', out.type);
        } else {
          const m = f.message!;
          r.eq(`${where(f)}: message`, m.name, out.type);
          r.eq(`${where(f)}: payload`, m.payload, toHex(api.codecByName(m.name)!.encode(out.message as never)));
          st.sync('recv', m.name);
        }
      }
    }
  }
  return r.done();
}

/** A group that throws is a failed group, not a crashed run. */
function guarded(group: string, run: () => GroupReport): GroupReport {
  try {
    return run();
  } catch (e) {
    return {
      group,
      cases: 1,
      deviations: [],
      failures: [{ label: `${group}: the check itself threw`, expected: 'a result', actual: String(e) }],
    };
  }
}

export function runAllChecks(api: Api, vectors: Vectors): GroupReport[] {
  return [
    guarded('messages', () => checkMessages(api, vectors)),
    guarded('cpace', () => checkCpace(api, vectors)),
    guarded('credentials', () => checkCredentials(api, vectors)),
    guarded('aead', () => checkAead(api, vectors)),
    guarded('packets', () => checkPackets(api, vectors)),
    guarded('handshake', () => checkHandshake(api, vectors)),
    guarded('state replay', () => checkStateReplay(api, vectors)),
  ];
}
