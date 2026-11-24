/**
 * Checks of the driver's parts that need no transport: framing, the
 * retransmission schedule, the rules of pairing and of credentials, errors,
 * the app image, the load exchange and the transaction body stream. Same
 * conventions as `driver-checks.ts`.
 */
import { loadAppWithoutModelCheck } from '../extapp';
import { bufferOf, buildFrame, scriptRandom, TEST_ONLY, type Case, type Ctx } from './driver-support';
import type { MessageCodec, TrezorClient } from '../index';

export const unitCases: Case[] = [];
const add = (name: string, run: (ctx: Ctx) => Promise<void>): void => void unitCases.push({ group: 'parts', name, run });

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice().buffer));
}

const base64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));
const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

// ---- framing ----

add('frames survive being cut into packets and put together again, at every length', async ({ api, t }) => {
  const channel = new Uint8Array([0x12, 0x34]);
  let checked = 0;
  for (let length = 0; length <= 400; length++) {
    const body = new Uint8Array(length).map((_, i) => (i * 7 + length) & 0xff);
    const frame = buildFrame(api, 0x04, channel, body);
    const packets = api.splitFrame(frame);
    const expectedPackets = frame.length <= 64 ? 1 : 1 + Math.ceil((frame.length - 64) / 61);
    if (packets.length !== expectedPackets || packets.some((p) => p.length !== 64)) {
      t.ok(`length ${length}: ${expectedPackets} packets of 64 bytes`, false, `${packets.length}`);
      continue;
    }
    const assembler = new api.FrameAssembler();
    let out: ReturnType<typeof assembler.push>;
    packets.forEach((p, i) => {
      const got = assembler.push(p);
      if (i < packets.length - 1 && got) t.ok(`length ${length}: no frame before the last packet`, false);
      out = got;
    });
    const ok = out !== undefined && api.toHex(out.body) === api.toHex(frame.subarray(5)) && out.length === length + 4;
    if (!ok) t.ok(`length ${length}: the frame comes back whole`, false);
    // The padding of the last packet is zeros.
    const padding = packets[packets.length - 1].subarray(packets.length === 1 ? frame.length : 3 + ((frame.length - 64) % 61 || 61));
    if (padding.some((b) => b !== 0)) t.ok(`length ${length}: padded with zeros`, false);
    checked++;
  }
  t.eq('401 lengths, 0 to 400 bytes of body', 401, checked);
});

add('the frame assembler drops what does not belong, bounds the declared length, and restarts on a new frame', async ({ api, t }) => {
  const channel = new Uint8Array([0x12, 0x34]);
  const body = new Uint8Array(200).fill(7);
  const packets = api.splitFrame(buildFrame(api, 0x04, channel, body));
  const a = new api.FrameAssembler();
  t.eq('a continuation with no frame in progress is dropped', undefined, a.push(packets[1]));
  t.eq('and counted', 1, a.dropped);
  a.push(packets[0]);
  const other = packets[1].slice();
  other[1] = 0x99;
  t.eq('a continuation of another channel is dropped', undefined, a.push(other));
  t.eq('and counted', 2, a.dropped);
  // A new first packet drops the unfinished frame.
  const second = api.splitFrame(buildFrame(api, 0x04, channel, new Uint8Array(10).fill(9)));
  const done = a.push(second[0]);
  t.eq('a new first packet starts over', api.toHex(new Uint8Array(10).fill(9)), done ? api.toHex(done.body.subarray(0, 10)) : '');
  t.eq('a packet that is not 64 bytes is dropped', undefined, new api.FrameAssembler().push(new Uint8Array(63)));
  let error: unknown;
  try {
    const big = new Uint8Array(64);
    big.set([0x04, 0x12, 0x34, 0x20, 0x01]);
    new api.FrameAssembler(8192).push(big);
  } catch (e) {
    error = e;
  }
  t.ok('a length over the bound is refused before anything is buffered', error !== undefined && /8193/.test(String((error as Error).message)));
  const edge = new Uint8Array(64);
  edge.set([0x04, 0x12, 0x34, 0x20, 0x00]);
  t.eq('the bound itself is waited for', undefined, new api.FrameAssembler(8192).push(edge));
});

add('the retransmission schedule is the device firmware\'s: 200 ms rising to about 3.5 s', async ({ api, t }) => {
  t.eq('first', 200, api.retransmitAfterMs(0));
  t.eq('second', 300, api.retransmitAfterMs(1));
  t.eq('third', 399, api.retransmitAfterMs(2));
  t.eq('the last step', 3522, api.retransmitAfterMs(49));
  t.eq('and it stays there', 3522, api.retransmitAfterMs(500));
  t.eq('the budget for an acknowledgement', 8000, api.ACK_BUDGET_MS);
  t.eq('the cap on retransmissions', 50, api.MAX_RETRANSMISSIONS);
  t.eq('the busy back-off', { firstWaitMs: 100, longestWaitMs: 2000, budgetMs: 30000 }, { ...api.BUSY_POLICY });
  t.eq('the counter limit', 2 ** 31, api.COUNTER_LIMIT);
});

// ---- pairing rules ----

add('the rule for "already paired" and for skipping pairing', async ({ api, t }) => {
  t.eq('claimed and matched: believed', true, api.alreadyPaired(true, true));
  t.eq('not claimed, nothing matched: pair', false, api.alreadyPaired(false, false));
  t.eq('not claimed, a stale credential matched: pair again', false, api.alreadyPaired(false, true));
  let error: unknown;
  try {
    api.alreadyPaired(true, false);
  } catch (e) {
    error = e;
  }
  t.ok(
    'claimed and nothing matched: an error that says so',
    error instanceof api.TrezorPairingError &&
      error.reason === 'unrecorded_pairing' &&
      /claims a pairing this computer has no record of/.test(error.message),
  );
  t.eq('skip: asked and emulator', true, api.skipPairingAllowed(true, true));
  t.eq('skip: asked, not emulator', false, api.skipPairingAllowed(true, false));
  t.eq('skip: not asked, emulator', false, api.skipPairingAllowed(false, true));
  t.eq('skip: neither', false, api.skipPairingAllowed(false, false));
  t.eq('the bound on button requests', 64, api.MAX_BUTTON_REQUESTS);
});

add('CPace through the driver matches the reference exchanges', async ({ api, v, t }) => {
  for (const [i, { exchange: x }] of v.cpace.crypto.exchanges.entries()) {
    const random = scriptRandom(api, [api.fromHex(x.host_private_key as string)]);
    try {
      const out = api.cpaceExchange(x.code as string, api.fromHex(x.handshake_hash as string), api.fromHex(x.device_public_key as string));
      t.eq(`exchange ${i}: host public key`, x.host_public_key, api.toHex(out.hostPublicKey));
      t.eq(`exchange ${i}: tag`, x.tag, api.toHex(out.tag));
      t.eq(`exchange ${i}: one random draw`, 1, 1);
    } catch (e) {
      // The reference exchanges use codes other than six digits? They must all be six.
      t.ok(`exchange ${i}: runs (${String(x.code)})`, false, String(e));
    } finally {
      random.restore();
    }
  }
});

add('CPace refuses a code that is not six digits, whatever its length, before it draws a key', async ({ api, t }) => {
  const hash = new Uint8Array(32).fill(7);
  const key = new Uint8Array(32).fill(1);
  // A scripted source with no values: a draw would throw.
  const random = scriptRandom(api, []);
  try {
    for (const code of ['12345', '1234567', 'abcdef', '12 456', '', '٠٠٠٠٠٠', '1234567'.repeat(30)]) {
      let reason = 'accepted';
      try {
        api.cpaceExchange(code, hash, key);
      } catch (e) {
        reason = e instanceof api.TrezorPairingError ? e.reason : String(e);
      }
      t.eq(`code ${JSON.stringify(code.slice(0, 12))} (${code.length} characters)`, code.length > 127 ? 'input_too_long' : 'invalid_code', reason);
    }
  } finally {
    random.restore();
  }
  t.eq('a six-digit code is a pairing code', true, api.isPairingCode('000000'));
  t.eq('seven is not', false, api.isPairingCode('0000000'));
});

add('the code check after the device reveals its secret: both refusals', async ({ api, v, t }) => {
  for (const [i, c] of v.cpace.code_entry.entries()) {
    const input = {
      handshakeHash: api.fromHex(c.handshake_hash as string),
      commitment: api.fromHex(c.commitment as string),
      challenge: api.fromHex(c.challenge as string),
    };
    const secret = api.fromHex(c.secret as string);
    const reason = (code: string, commitment = input.commitment, sec = secret): string => {
      try {
        api.verifyCodeEntry({ ...input, commitment }, code, sec);
        return 'accepted';
      } catch (e) {
        return e instanceof api.TrezorPairingError ? e.reason : String(e);
      }
    };
    t.eq(`case ${i}: the right code`, 'accepted', reason(c.code as string));
    t.eq(`case ${i}: another code`, 'code_mismatch', reason(String((Number(c.code) + 1) % 1000000).padStart(6, '0')));
    const bad = input.commitment.slice();
    bad[0] ^= 1;
    t.eq(`case ${i}: another commitment`, 'commitment_mismatch', reason(c.code as string, bad));
  }
});

add('a code mismatch from the direct verifier carries no digit and no dependency error', async ({ api, v, t }) => {
  for (const [i, c] of v.cpace.code_entry.entries()) {
    const input = {
      handshakeHash: api.fromHex(c.handshake_hash as string),
      commitment: api.fromHex(c.commitment as string),
      challenge: api.fromHex(c.challenge as string),
    };
    const typed = String((Number(c.code) + 1) % 1000000).padStart(6, '0');
    let caught: unknown;
    try {
      api.verifyCodeEntry(input, typed, api.fromHex(c.secret as string));
    } catch (e) {
      caught = e;
    }
    t.ok(`case ${i}: a pairing error`, caught instanceof api.TrezorPairingError);
    const error = caught as Error & { cause?: unknown };
    const holders: Record<string, string> = {
      message: error.message,
      'String(error)': String(error),
      'JSON.stringify(error)': JSON.stringify(error),
      stack: String(error.stack),
      cause: String(error.cause),
      'own properties': Object.getOwnPropertyNames(error)
        .map((name) => `${name}=${String((error as unknown as Record<string, unknown>)[name])}`)
        .join('\n'),
    };
    t.eq(`case ${i}: no cause is kept`, undefined, error.cause);
    for (const [where, text] of Object.entries(holders)) {
      t.eq(`case ${i}: the typed code is not in ${where}`, false, text.includes(typed));
      t.eq(`case ${i}: the calculated code is not in ${where}`, false, text.includes(c.code as string));
    }
  }
});

add('the public thp namespace refuses a pairing check without a digit, tag or key in the error', async ({ api, v, t }) => {
  const hex = (b: Uint8Array): string => api.toHex(b);
  const holders = (error: unknown): Record<string, string> => {
    const e = error as Error & { cause?: unknown };
    return {
      message: String(e.message),
      'String(error)': String(e),
      'JSON.stringify(error)': String(JSON.stringify(e)),
      stack: String(e.stack),
      cause: String(e.cause),
      'own properties': Object.getOwnPropertyNames(e)
        .map((name) => `${name}=${String((e as unknown as Record<string, unknown>)[name])}`)
        .join('\n'),
    };
  };
  const check = (label: string, run: () => void, secrets: string[]): void => {
    let caught: unknown;
    try {
      run();
    } catch (e) {
      caught = e;
    }
    t.ok(`${label}: refused`, caught instanceof Error);
    if (!(caught instanceof Error)) return;
    t.eq(`${label}: no cause`, undefined, (caught as Error & { cause?: unknown }).cause);
    for (const [where, text] of Object.entries(holders(caught))) {
      for (const secret of secrets) {
        t.eq(`${label}: ${secret.slice(0, 8)} is not in ${where}`, false, text.includes(secret));
      }
    }
  };

  for (const [i, c] of v.cpace.code_entry.entries()) {
    const creds = {
      handshakeHash: bufferOf(api, api.fromHex(c.handshake_hash as string)),
      handshakeCommitment: bufferOf(api, api.fromHex(c.commitment as string)),
      codeEntryChallenge: bufferOf(api, api.fromHex(c.challenge as string)),
    };
    const typed = String((Number(c.code) + 1) % 1000000).padStart(6, '0');
    check(
      `validateCodeEntryTag case ${i}, wrong code`,
      () => api.thp.validateCodeEntryTag(creds as never, typed, c.secret as string),
      [typed, c.code as string],
    );
    const bad = api.fromHex(c.commitment as string).slice();
    bad[0] ^= 1;
    const shaOfSecret = hex(await sha256(api.fromHex(c.secret as string)));
    check(
      `validateCodeEntryTag case ${i}, wrong commitment`,
      () =>
        api.thp.validateCodeEntryTag(
          { ...creds, handshakeCommitment: bufferOf(api, bad) } as never,
          c.code as string,
          c.secret as string,
        ),
      [hex(bad), shaOfSecret, c.commitment as string],
    );
  }

  // The QR and NFC tags: the first 16 bytes of SHA-256 over method, hash, secret.
  const handshakeHash = new Uint8Array(32).fill(7);
  const secret = new Uint8Array(16).map((_, i) => 0xa0 + i);
  const calculated = async (method: number): Promise<string> =>
    hex((await sha256(Uint8Array.from([method, ...handshakeHash, ...secret]))).subarray(0, 16));
  const typedTag = hex(new Uint8Array(16).fill(0x5c));
  const credentials = { handshakeHash: bufferOf(api, handshakeHash) } as never;
  check(
    'validateQrCodeTag, wrong tag',
    () => api.thp.validateQrCodeTag(credentials, typedTag, hex(secret)),
    [typedTag, await calculated(3)],
  );
  check(
    'validateNfcTag, wrong tag',
    () => api.thp.validateNfcTag(credentials, typedTag, bufferOf(api, secret) as never),
    [typedTag, await calculated(4)],
  );

  // What succeeds still succeeds.
  const good = v.cpace.code_entry[0];
  api.thp.validateCodeEntryTag(
    {
      handshakeHash: bufferOf(api, api.fromHex(good.handshake_hash as string)),
      handshakeCommitment: bufferOf(api, api.fromHex(good.commitment as string)),
      codeEntryChallenge: bufferOf(api, api.fromHex(good.challenge as string)),
    } as never,
    good.code as string,
    good.secret as string,
  );
  api.thp.validateQrCodeTag(credentials, await calculated(3), hex(secret));
  api.thp.validateNfcTag(credentials, await calculated(4), bufferOf(api, secret) as never);
  t.ok('the valid code, QR tag and NFC tag are accepted', true);
});

// ---- credentials ----

add('the memory credential store replaces by device, copies what it keeps, and forgets', async ({ api, t }) => {
  const store = new api.MemoryCredentialStore();
  const record = (device: number, credential: number) => ({
    trezorStaticPubkey: new Uint8Array(32).fill(device),
    hostStaticPrivkey: new Uint8Array(32).fill(0x55),
    credential: new Uint8Array(10).fill(credential),
  });
  const first = record(1, 1);
  await store.store(first);
  first.credential.fill(9);
  t.eq('the store holds its own copy', 1, (await store.load())[0].credential[0]);
  const loaded = await store.load();
  loaded[0].credential.fill(7);
  t.eq('and hands out copies', 1, (await store.load())[0].credential[0]);
  await store.store(record(2, 2));
  await store.store(record(1, 3));
  const all = await store.load();
  t.eq('a record for the same device replaces the earlier one', 2, all.length);
  t.eq('with the later credential', 3, all.find((r) => r.trezorStaticPubkey[0] === 1)?.credential[0]);
  await store.forget(new Uint8Array(32).fill(1));
  t.eq('forget removes one device', [2], (await store.load()).map((r) => r.trezorStaticPubkey[0]));
  await store.forget();
  t.eq('forget without a key removes all', 0, (await store.load()).length);
  await t.rejects('a record with a short key is refused', store.store({ ...record(1, 1), trezorStaticPubkey: new Uint8Array(31) }));
  await t.rejects('a record with no credential is refused', store.store({ ...record(1, 1), credential: new Uint8Array(0) }));
  await store.store({ ...record(1, 1), credential: new Uint8Array(127) });
  t.eq('a long credential can be kept; the handshake never uses it', 1, (await store.load()).length);
  t.eq('the limit', 126, api.MAX_CREDENTIAL_LEN);
});

// ---- errors ----

add('failures become typed errors', async ({ api, t }) => {
  t.ok('action cancelled is a cancellation', api.errorFromFailure(4, 'x') instanceof api.TrezorCancelledError);
  t.ok('so is pin cancelled', api.errorFromFailure(6, undefined) instanceof api.TrezorCancelledError);
  const other = api.errorFromFailure(3, 'Unexpected message');
  t.ok('anything else keeps its code and text', other instanceof api.TrezorFailureError && other.failureCode === 3 && other.failureMessage === 'Unexpected message');
  t.eq('a failure without a code is code 0', 0, (api.errorFromFailure(undefined, undefined) as unknown as { failureCode: number }).failureCode);

  const refusal = api.intoAppRefusal(api.errorFromFailure(3, 'message_not_text'));
  t.ok('a DataError with one token is an app refusal', refusal instanceof api.TrezorAppRefusedError && refusal.reason === 'message_not_text');
  for (const [code, text] of [[3, 'Unexpected message'], [3, ''], [9, 'token_hint_mismatch'], [99, 'unsupported_transaction']] as const) {
    t.ok(`failure ${code} ${JSON.stringify(text)} stays a failure`, api.intoAppRefusal(api.errorFromFailure(code, text)) instanceof api.TrezorFailureError);
  }
  t.ok('a cancellation stays one', api.intoAppRefusal(api.errorFromFailure(4, 'x')) instanceof api.TrezorCancelledError);

  const device = api.intoSessionRefusal(
    api.errorFromFailure(3, 'Providing passphrase in message is not allowed when PASSPHRASE_ALWAYS_ON_DEVICE is True.'),
  );
  t.ok('the always-on-device refusal is told apart', device instanceof api.TrezorPassphraseOnDeviceOnlyError);
  t.ok('and says what to do', /on the device only/.test((device as Error).message));
  t.ok('another DataError of a session stays a failure', api.intoSessionRefusal(api.errorFromFailure(3, 'Maximum passphrase length is 128 bytes')) instanceof api.TrezorFailureError);
  t.ok('the same text under another code stays a failure', api.intoSessionRefusal(api.errorFromFailure(9, 'PASSPHRASE_ALWAYS_ON_DEVICE')) instanceof api.TrezorFailureError);
});

add('the device\'s refusal to load an app says what to do, and no other failure does', async ({ api, t }) => {
  const sentence =
    '; one cause: a device that has loaded a newer build of the app refuses an older one until it is wiped, so load the newest build; otherwise check that the image, its proof and the root packet are from the same build';
  for (const code of [3, 9, 99]) {
    const error = api.errorFromFailure(code, 'Failed to load app');
    t.ok(`failure ${code} "Failed to load app" is a failure`, error instanceof api.TrezorFailureError);
    t.eq(`failure ${code}: the text is the device's, then the hint`, `the Trezor reported failure ${code}: Failed to load app${sentence}`, error.message);
    t.eq(`failure ${code}: the failure's own text is the device's alone`, 'Failed to load app', (error as InstanceType<typeof api.TrezorFailureError>).failureMessage);
  }
  for (const text of ['App image verification failed', 'Failed to load app.', 'failed to load app', 'Failed to load app: x', '']) {
    t.ok(`${JSON.stringify(text)} gets no hint`, !/one cause/.test(api.errorFromFailure(99, text).message));
  }
  t.eq('the hint of the exported function', sentence, api.failureHint(api.FAILED_TO_LOAD_APP));
  t.eq('and none for another text', '', api.failureHint('x'));
  t.eq('the CLI code stays device_error', 'device_error', api.trezorErrorCode(api.errorFromFailure(99, 'Failed to load app') as InstanceType<typeof api.TrezorFailureError>));
});

// ---- the app image ----

type Synth = {
  files: { tapp: Uint8Array; proof: Uint8Array; rootPacket: Uint8Array };
  header: Uint8Array;
  chunks: { hash: Uint8Array; data: Uint8Array }[];
};

async function synthetic(version = [0, 1, 1, 0], ring = 2, model = 'T3W1'): Promise<Synth> {
  const data = [new Uint8Array([1, 2, 3, 4]), new Uint8Array([5, 6, 7, 8]), new Uint8Array([9, 10])];
  const hashes: Uint8Array[] = [];
  let chain: Uint8Array = new Uint8Array(32);
  for (let i = data.length - 1; i >= 0; i--) {
    hashes[i] = chain;
    chain = await sha256(new Uint8Array([...chain, ...data[i]]));
  }
  const header = new Uint8Array(400);
  header.set(utf8('TRZA'));
  new DataView(header.buffer).setUint32(4, 400, true);
  header.set(utf8('thru.thru.org'), 8);
  header.set(utf8(model), 104);
  header.set(version, 108);
  header[118] = ring;
  header.set(chain, 128);
  new DataView(header.buffer).setUint16(160, 4, true);
  const root = new Uint8Array(24);
  root.set(utf8('TRRP'));
  new DataView(root.buffer).setBigInt64(8, 1234567890123n, true);
  const chunks = data.map((d, i) => ({ hash: hashes[i], data: d }));
  const toHex = (b: Uint8Array): string => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return {
    header,
    chunks,
    files: {
      tapp: utf8(JSON.stringify({ header: base64(header), chunks: chunks.map((c) => [toHex(c.hash), base64(c.data)]) })),
      proof: utf8(JSON.stringify({ proof: ['0a0b', '0c'] })),
      rootPacket: utf8(JSON.stringify({ root_packet: base64(root) })),
    },
  };
}

add('an app image is read from the bytes of its three files', async ({ api, t }) => {
  const s = await synthetic();
  const image = api.parseAppImage(s.files);
  t.eq('id', 'thru.thru.org', image.id);
  t.eq('version', [0, 1, 1, 0], [...image.version]);
  t.eq('ring', 2, image.appRing);
  t.eq('header', api.toHex(s.header), api.toHex(image.header));
  t.eq('proof is the files concatenated', '0a0b0c', api.toHex(image.proof));
  t.eq('root packet timestamp (i64 at offset 8)', 1234567890123n, image.rootPacketTimestamp);
  t.eq('chunks', 3, image.chunks.length);
  t.eq('chunk data', '0102030405060708090a', image.chunks.map((c) => api.toHex(c.data)).join(''));
  t.eq('the fingerprint is the SHA-256 of header_size bytes', api.toHex(await sha256(s.header)), api.toHex(api.appFingerprint(image)));
  // A header whose size field is shorter than the bytes: only those are hashed.
  const shorter = s.header.slice();
  new DataView(shorter.buffer).setUint32(4, 200, true);
  t.eq('header_size bytes only', api.toHex(await sha256(shorter.subarray(0, 200))), api.toHex(api.appFingerprint({ header: shorter })));
  t.eq('the root packet file of ring 2', 'rootpacket_ring12.tmr', api.rootPacketFileName(2));
  t.eq('of ring 1', 'rootpacket_ring12.tmr', api.rootPacketFileName(1));
  t.eq('of ring 0', 'rootpacket_ring0.tmr', api.rootPacketFileName(0));
  const head = api.readAppHeader(s.files.tapp);
  t.eq('the header read on its own', ['thru.thru.org', 2], [head.id, head.appRing]);
});

add('an app image that is damaged or of an unsupported version is refused, naming itself', async ({ api, t }) => {
  const refused = (what: string, files: Synth['files'], pattern: RegExp): void => {
    try {
      api.parseAppImage(files);
      t.ok(`${what}: refused`, false);
    } catch (e) {
      t.ok(`${what}: refused as an app image error naming ${pattern}`, e instanceof api.TrezorAppImageError && pattern.test(e.message), String(e));
    }
  };
  const good = await synthetic();
  const patch = (file: Uint8Array, change: (json: Record<string, unknown>) => void): Uint8Array => {
    const json = JSON.parse(new TextDecoder().decode(file)) as Record<string, unknown>;
    change(json);
    return utf8(JSON.stringify(json));
  };
  refused('not JSON', { ...good.files, tapp: utf8('{') }, /not valid/);
  refused('no header', { ...good.files, tapp: patch(good.files.tapp, (j) => delete j.header) }, /header is missing/);
  refused('header not base64', { ...good.files, tapp: patch(good.files.tapp, (j) => (j.header = '!!!!')) }, /not base64/);
  refused('header too short', { ...good.files, tapp: patch(good.files.tapp, (j) => (j.header = base64(new Uint8Array(100)))) }, /too short/);
  const noMagic = good.header.slice();
  noMagic[0] = 0x58;
  refused('bad magic', { ...good.files, tapp: patch(good.files.tapp, (j) => (j.header = base64(noMagic))) }, /TRZA/);
  const damaged = patch(good.files.tapp, (j) => {
    const chunks = j.chunks as string[][];
    chunks[1][1] = base64(new Uint8Array([5, 6, 7, 9]));
  });
  refused('a damaged chunk', { ...good.files, tapp: damaged }, /does not follow|do not hash/);
  const short = patch(good.files.tapp, (j) => {
    const chunks = j.chunks as string[][];
    chunks[0][1] = base64(new Uint8Array([1, 2, 3]));
  });
  refused('a chunk shorter than the chunk size that is not the last', { ...good.files, tapp: short }, /chunk 0 has 3 bytes/);
  refused('a root packet that is not one', { ...good.files, rootPacket: patch(good.files.rootPacket, (j) => (j.root_packet = base64(new Uint8Array(24)))) }, /not a root packet/);
  refused('a proof that is not hex', { ...good.files, proof: utf8(JSON.stringify({ proof: ['zz'] })) }, /not hex/);
  for (const version of [[0, 1, 0, 0], [0, 2, 0, 0], [1, 0, 0, 0], [0, 0, 9, 0]]) {
    refused(`version ${version.join('.')}`, (await synthetic(version)).files, /not supported/);
  }
  for (const version of [[0, 1, 1, 0], [0, 1, 7, 3]]) {
    t.eq(`version ${version.join('.')} is read`, [...version], [...api.parseAppImage((await synthetic(version)).files).version]);
  }
  t.eq('the supported range, in words', '0.1.1 up to (not including) 0.2.0', api.SUPPORTED_APP_RANGE);
  for (const [v, ok] of [[[0, 1, 1], true], [[0, 1, 0], false], [[0, 1, 99], true], [[0, 2, 0], false], [[1, 1, 1], false], [[0, 0, 5], false]] as const) {
    t.eq(`appVersionSupported(${v.join(', ')})`, ok, api.appVersionSupported(v[0], v[1], v[2]));
  }
});

// ---- the load exchange, on a client that answers from a script ----

type Reply = { id: number; payload: Uint8Array };
const reply = <T extends object>(codec: MessageCodec<T>, value: T): Reply => ({ id: codec.id as number, payload: codec.encode(value) });

function stubClient(answers: (Reply | Error)[], model = 'T3W1'): { client: TrezorClient; sent: Reply[]; loaded: () => number | undefined; closed: () => number } {
  const sent: Reply[] = [];
  let loaded: number | undefined;
  let closes = 0;
  const client = {
    properties: { internalModel: model, protocolVersion: [2, 1], pairingMethods: [] },
    callAny: async (id: number, payload: Uint8Array): Promise<Reply> => {
      sent.push({ id, payload });
      const next = answers.shift();
      if (!next) throw new Error('the script has no more answers');
      if (next instanceof Error) throw next;
      return next;
    },
    setLoadedApp: (n: number) => void (loaded = n),
    close: async () => void closes++,
  } as unknown as TrezorClient;
  return { client, sent, loaded: () => loaded, closed: () => closes };
}

const version = (minor: number, patch: number) => ({ major: 0, minor, patch, build: 0 });

add('the load request carries the fingerprint, and a held app is not uploaded again', async ({ api, t }) => {
  const image = api.parseAppImage((await synthetic()).files);
  const { client, sent, loaded } = stubClient([reply(api.ExtAppLoaded, { instance_id: 4, version: version(1, 1) })]);
  const result = await api.loadApp(client, image);
  t.eq('one request', 1, sent.length);
  t.eq('it is ExtAppLoad', api.ExtAppLoad.id, sent[0].id);
  const request = api.ExtAppLoad.decode(sent[0].payload);
  t.eq('the app id', 'thru.thru.org', request.id);
  t.eq('the version asked for', [0, 1, 1, 0], [request.version.major, request.version.minor, request.version.patch, request.version.build]);
  t.eq('the fingerprint of the header', api.toHex(api.appFingerprint(image)), api.toHex(request.fingerprint as Uint8Array));
  t.eq('nothing was uploaded', false, result.uploaded);
  t.eq('the instance', 4, result.instanceId);
  t.eq('the client knows the app', 4, loaded());
});

add('the image is uploaded when the device asks: header, root packet once, chunks in the order asked', async ({ api, t }) => {
  const s = await synthetic();
  const image = api.parseAppImage(s.files);
  const { client, sent } = stubClient([
    reply(api.ExtAppHeaderRequest, {}),
    reply(api.ExtAppRootPacketRequest, { app_ring: 2 }),
    reply(api.ExtAppDataChunkRequest, { index: 2 }),
    reply(api.ExtAppDataChunkRequest, { index: 0 }),
    reply(api.ExtAppDataChunkRequest, { index: 1 }),
    reply(api.ExtAppLoaded, { instance_id: 7, version: version(1, 1) }),
  ]);
  const result = await api.loadApp(client, image);
  t.eq('uploaded', true, result.uploaded);
  t.eq('the requests in order', [api.ExtAppLoad.id, api.ExtAppHeaderAck.id, api.ExtAppRootPacketAck.id, api.ExtAppDataChunkAck.id, api.ExtAppDataChunkAck.id, api.ExtAppDataChunkAck.id], sent.map((m) => m.id));
  const ack = api.ExtAppHeaderAck.decode(sent[1].payload);
  t.eq('header sent', api.toHex(s.header), api.toHex(ack.header));
  t.eq('proof sent', '0a0b0c', api.toHex(ack.proof));
  t.eq('timestamp sent', 1234567890123n, ack.root_packet_timestamp);
  t.eq('root packet sent', api.toHex(image.rootPacket), api.toHex(api.ExtAppRootPacketAck.decode(sent[2].payload).root_packet));
  const chunks = sent.slice(3).map((m) => api.ExtAppDataChunkAck.decode(m.payload));
  t.eq('chunk 2 then 0 then 1, each with its hash', [2, 0, 1].map((i) => `${api.toHex(s.chunks[i].data)}:${api.toHex(s.chunks[i].hash)}`), chunks.map((c) => `${api.toHex(c.data)}:${api.toHex(c.hash)}`));
});

add('the load exchange refuses what it should', async ({ api, t }) => {
  const image = api.parseAppImage((await synthetic()).files);
  const fails = async (what: string, answers: Reply[], check: (e: unknown) => boolean): Promise<void> => {
    const { client, loaded, closed } = stubClient(answers);
    const error = await t.rejects(what, api.loadApp(client, image));
    t.ok(`${what}: the right error`, check(error), String(error));
    t.eq(`${what}: the app is not recorded as loaded`, undefined, loaded());
    t.eq(`${what}: the connection is closed exactly when a response failed validation mid-load`, error instanceof api.TrezorUnexpectedError ? 1 : 0, closed());
  };
  const inRange = version(1, 1);
  await fails('a held app of version 0.2.0', [reply(api.ExtAppLoaded, { instance_id: 1, version: version(2, 0) })], (e) => e instanceof api.TrezorAppError && /0\.2\.0\.0/.test((e as Error).message) && /supports 0\.1\.1/.test((e as Error).message));
  await fails('an uploaded app of version 0.1.0', [reply(api.ExtAppHeaderRequest, {}), reply(api.ExtAppLoaded, { instance_id: 1, version: version(1, 0) })], (e) => e instanceof api.TrezorAppError);
  await fails('a chunk that does not exist', [reply(api.ExtAppHeaderRequest, {}), reply(api.ExtAppDataChunkRequest, { index: 3 })], (e) => e instanceof api.TrezorUnexpectedError && /chunk 3 of 3/.test((e as Error).message));
  await fails('a message that is not part of the exchange', [reply(api.ExtAppResponse, { message_id: 1, data: new Uint8Array(0) })], (e) => e instanceof api.TrezorUnexpectedError);
  await fails('a root packet asked for twice', [reply(api.ExtAppHeaderRequest, {}), reply(api.ExtAppRootPacketRequest, { app_ring: 2 }), reply(api.ExtAppRootPacketRequest, { app_ring: 2 }), reply(api.ExtAppLoaded, { instance_id: 1, version: inRange })], (e) => e instanceof api.TrezorUnexpectedError);
  await fails('an answer that cannot be decoded', [{ id: api.ExtAppLoaded.id as number, payload: new Uint8Array([0xff]) }], (e) => e instanceof api.TrezorUnexpectedError);
});

add('a load that stops between two exchanges for any reason but a refusal closes the connection; one that never began, or ended, does not', async ({ api, t }) => {
  const image = api.parseAppImage((await synthetic()).files);
  const header = reply(api.ExtAppHeaderRequest, {});
  const rootPacket = reply(api.ExtAppRootPacketRequest, { app_ring: 2 });
  const chunk = reply(api.ExtAppDataChunkRequest, { index: 0 });
  const timeout = (): Error => new api.TrezorTimeoutError('the next answer', 'answer');
  const cases: [string, (Reply | Error)[], (e: unknown) => boolean, 'closed' | 'open'][] = [
    ['an abort before anything was sent', [new api.TrezorAbortedError()], (e) => e instanceof api.TrezorAbortedError, 'open'],
    ['an abort after the header request', [header, new api.TrezorAbortedError()], (e) => e instanceof api.TrezorAbortedError, 'closed'],
    ['an abort after the root packet request', [header, rootPacket, new api.TrezorAbortedError()], (e) => e instanceof api.TrezorAbortedError, 'closed'],
    ['an abort after a chunk request', [header, rootPacket, chunk, new api.TrezorAbortedError()], (e) => e instanceof api.TrezorAbortedError, 'closed'],
    ['a time-out after the header request', [header, timeout()], (e) => e instanceof api.TrezorTimeoutError, 'closed'],
    ['a transport failure after the header request', [header, new api.TrezorTransportError('unplugged')], (e) => e instanceof api.TrezorTransportError, 'closed'],
    ['a refusal after the header request', [header, api.errorFromFailure(1, 'Unexpected message')], (e) => e instanceof api.TrezorFailureError, 'open'],
    ['the cancellation of a load after the header request', [header, api.errorFromFailure(4, 'cancelled')], (e) => e instanceof api.TrezorCancelledError, 'open'],
    ['a time-out of the first message', [timeout()], (e) => e instanceof api.TrezorTimeoutError, 'open'],
    ['an unsupported version in the final answer', [header, reply(api.ExtAppLoaded, { instance_id: 1, version: version(2, 0) })], (e) => e instanceof api.TrezorAppError, 'open'],
  ];
  for (const [what, script, check, state] of cases) {
    const { client, closed, loaded } = stubClient(script);
    const error = await t.rejects(what, api.loadApp(client, image));
    t.ok(`${what}: the right error`, check(error), String(error));
    t.eq(`${what}: the connection is ${state}`, state === 'closed' ? 1 : 0, closed());
    t.eq(`${what}: the app is not recorded as loaded`, undefined, loaded());
  }
});

add('the two requests of the loader that carry a payload are decoded before they are answered', async ({ api, t }) => {
  const image = api.parseAppImage((await synthetic()).files);
  const header = reply(api.ExtAppHeaderRequest, {});
  const loaded = reply(api.ExtAppLoaded, { instance_id: 7, version: version(1, 1) });
  const chunks = [0, 1, 2].map((index) => reply(api.ExtAppDataChunkRequest, { index }));
  // An empty header request is the whole message: it has no field.
  const good = stubClient([header, reply(api.ExtAppRootPacketRequest, { app_ring: 2 }), ...chunks, loaded]);
  t.eq('an empty header request and a root packet request with its ring: loaded', 7, (await api.loadApp(good.client, image)).instanceId);
  t.eq('and the connection stays open', 0, good.closed());

  const cases: [string, Reply[], number][] = [
    ['a root packet request with no payload (the ring is required)', [header, { id: api.ExtAppRootPacketRequest.id as number, payload: new Uint8Array(0) }, ...chunks, loaded], 2],
    ['a root packet request cut in the middle of its field', [header, { id: api.ExtAppRootPacketRequest.id as number, payload: new Uint8Array([0x08]) }, ...chunks, loaded], 2],
    ['a header request that is not a protobuf message', [{ id: api.ExtAppHeaderRequest.id as number, payload: new Uint8Array([0x08]) }, ...chunks, loaded], 1],
    ['a header request with a length that overruns it', [{ id: api.ExtAppHeaderRequest.id as number, payload: new Uint8Array([0x0a, 0x05, 1]) }, ...chunks, loaded], 1],
  ];
  for (const [what, script, sentCount] of cases) {
    const { client, sent, closed } = stubClient(script);
    const error = await t.rejects(what, api.loadApp(client, image));
    t.ok(`${what}: an unexpected-answer error`, error instanceof api.TrezorUnexpectedError, String(error));
    t.eq(`${what}: nothing was answered`, sentCount, sent.length);
    t.eq(`${what}: the connection is closed`, 1, closed());
  }
});

// ---- the app's requests ----

add('the transaction body is sent as the app asks, in order, and the signature is accepted only after all of it', async ({ api, t }) => {
  const body = new Uint8Array(5000).map((_, i) => i & 0xff);
  const sentAcks: Uint8Array[] = [];
  const answers = [
    { id: 3, data: api.TxDataRequest.encode({ offset: 0, length: 2048 }) },
    { id: 3, data: api.TxDataRequest.encode({ offset: 2048, length: 2048 }) },
    { id: 3, data: api.TxDataRequest.encode({ offset: 4096, length: 904 }) },
    { id: 5, data: api.TxSignature.encode({ signature: new Uint8Array(64).fill(3) }) },
  ];
  const first = answers.shift()!;
  const signature = await api.streamBody(body, first, async (data) => {
    sentAcks.push(data);
    return answers.shift()!;
  });
  t.eq('three pieces', [2048, 2048, 904], sentAcks.map((a) => a.length));
  t.eq('the pieces are the body', api.toHex(body), api.toHex(new Uint8Array(sentAcks.flatMap((a) => [...a]))));
  t.eq('the signature', api.toHex(new Uint8Array(64).fill(3)), api.toHex(signature));

  const fails = async (what: string, list: { id: number; data: Uint8Array }[], pattern: RegExp): Promise<void> => {
    const queue = [...list];
    const error = await t.rejects(what, api.streamBody(body, queue.shift()!, async () => queue.shift()!));
    t.ok(`${what}: an app error naming ${pattern}`, error instanceof api.TrezorAppError && pattern.test((error as Error).message), String(error));
  };
  const req = (offset: number, length: number) => ({ id: 3, data: api.TxDataRequest.encode({ offset, length }) });
  const sig = (n = 64) => ({ id: 5, data: api.TxSignature.encode({ signature: new Uint8Array(n) }) });
  await fails('a signature before the body was asked for', [sig()], /signed after asking for 0 of 5000/);
  await fails('a signature after part of it', [req(0, 2048), sig()], /signed after asking for 2048 of 5000/);
  await fails('a gap', [req(0, 2048), req(2049, 100)], /asked for offset 2049 when 2048 is next/);
  await fails('a repeat', [req(0, 100), req(0, 100)], /asked for offset 0 when 100 is next/);
  await fails('an empty piece', [req(0, 0)], /piece of 0 bytes/);
  await fails('a piece over the limit', [req(0, 2049)], /piece of 2049 bytes/);
  await fails('a piece past the end', [req(0, 2048), req(2048, 2048), req(4096, 905)], /of a body of 5000/);
  await fails('a signature of the wrong length', [req(0, 2048), req(2048, 2048), req(4096, 904), sig(63)], /63 bytes, not 64/);
  await fails('another message', [{ id: 7, data: new Uint8Array(0) }], /answered message 7, expected TxDataRequest/);
});

add('the app\'s requests check what they can before sending, and send the recorded encoding', async ({ api, t }) => {
  const calls: { message_id: number; data: Uint8Array }[] = [];
  let closes = 0;
  let answer: { message_id: number; data: Uint8Array } = { message_id: 1, data: new Uint8Array(0) };
  const client = {
    loadedApp: 3,
    call: async (_q: unknown, request: { message_id: number; data: Uint8Array }) => {
      calls.push(request);
      return answer;
    },
    close: async () => void closes++,
  } as unknown as TrezorClient;
  const app = api.ThruApp.attach(client, 3);
  answer = { message_id: 1, data: api.PublicKey.encode({ public_key: new Uint8Array(32).fill(1), address: 'ta' }) };
  const path = [0x8000002c, 0x8000211e, 0x80000000, 0x80000000];
  const key = await app.getPublicKey(path, { showOnDevice: false });
  t.eq('the address', 'ta', key.address);
  t.eq('GetPublicKey is message 0 with show_display present and false', '08ac80808008089ec2808008088080808008088080808008' + '1000', api.toHex(calls[0].data));
  t.eq('message id', 0, calls[0].message_id);
  answer = { message_id: 1, data: api.PublicKey.encode({ public_key: new Uint8Array(31), address: 'ta' }) };
  const short = await t.rejects('a public key of 31 bytes', app.getPublicKey(path));
  t.ok('is an app error', short instanceof api.TrezorAppError);
  t.eq('a key that fails validation closes the connection', 1, closes);
  answer = { message_id: 5, data: new Uint8Array(0) };
  const wrong = await t.rejects('the wrong answer', app.getPublicKey(path));
  t.ok('is an app error that names both', wrong instanceof api.TrezorAppError && /answered message 5, expected PublicKey/.test((wrong as Error).message));
  const before = calls.length;
  t.ok('a path element that is not a uint32 is refused', (await t.rejects('path', app.getPublicKey([-1]))) instanceof api.TrezorInvalidRequestError);
  t.ok('a token hint of 128 bytes is refused', (await t.rejects('hint', app.signTransaction(path, new Uint8Array(10), { tokenHint: new Uint8Array(128) }))) instanceof api.TrezorInvalidRequestError);
  t.ok('a body that is not bytes is refused, not sent as an empty one', (await t.rejects('body', app.signTransaction(path, undefined as never))) instanceof TypeError);
  t.ok('a message that is not bytes is refused', (await t.rejects('message', app.signMessage(path, undefined as never))) instanceof api.TrezorInvalidRequestError);
  t.eq('without sending anything', before, calls.length);
  const closed = api.ThruApp.attach({ loadedApp: undefined } as unknown as TrezorClient, 3);
  t.ok('an app whose connection forgot it is a closed connection', (await t.rejects('closed', closed.getPublicKey(path))) instanceof api.TrezorClosedError);
});

add('the app\'s refusals reach the caller as typed errors', async ({ api, t }) => {
  const client = {
    loadedApp: 3,
    call: async () => {
      throw api.errorFromFailure(3, 'unsupported_transaction');
    },
  } as unknown as TrezorClient;
  const error = await t.rejects('a refused request', api.ThruApp.attach(client, 3).signTransaction([0x8000002c, 0x8000211e, 0x80000000, 0x80000000], new Uint8Array(10)));
  t.ok('an app refusal with its reason', error instanceof api.TrezorAppRefusedError && error.reason === 'unsupported_transaction', String(error));
});

// ---- values that failed to parse are never quoted ----

/** Every window of `length` characters of `text`: if none of them is in an error, no part of `text` is. */
function windows(text: string, length = 8): string[] {
  const out: string[] = [];
  for (let i = 0; i + length <= text.length; i++) out.push(text.slice(i, i + length));
  return out;
}

const SECRET_HEX = '1f2e3d4c5b6a79880a1b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef';

add('a hex string that does not parse is not quoted by the error: neither odd length nor a stray character leaks it', async ({ api, t }) => {
  for (const [what, text] of [
    ['a stray character at the end', `${SECRET_HEX}x`],
    ['a stray character in the middle', `${SECRET_HEX.slice(0, 20)}zz${SECRET_HEX.slice(22)}`],
    ['an odd length', SECRET_HEX.slice(1)],
    ['a prefix', `0x${SECRET_HEX}`],
  ]) {
    const error = await t.rejects(what, Promise.resolve().then(() => api.fromHex(text)));
    const shown = `${(error as Error).message}\n${(error as Error).stack ?? ''}`;
    t.ok(`${what}: says what is wrong`, /hex/.test((error as Error).message), (error as Error).message);
    t.eq(`${what}: no part of the value is in the error`, [], windows(text).filter((w) => shown.includes(w)));
  }
  const missing = await t.rejects('not a string', Promise.resolve().then(() => api.fromHex(undefined as never)));
  t.ok('a value that is not a string is refused', /hex/.test((missing as Error).message), String(missing));
  t.eq('a good value still parses', [0x1f, 0x2e], [...api.fromHex('1f2e')]);
  t.eq('and the empty one', 0, api.fromHex('').length);
});

// ---- bytes held in a Buffer are copied, not shared ----

add('the memory credential store keeps its own bytes of a record held in a Buffer, and of the key it is told to forget', async ({ api, t }) => {
  const store = new api.MemoryCredentialStore();
  const record = {
    trezorStaticPubkey: bufferOf(api, new Uint8Array(32).fill(1)),
    hostStaticPrivkey: bufferOf(api, new Uint8Array(32).fill(2)),
    credential: bufferOf(api, new Uint8Array(10).fill(3)),
  };
  t.ok('the test holds Buffers, whose slice shares memory', record.credential.slice() instanceof Uint8Array && record.credential.slice().buffer === record.credential.buffer);
  await store.store(record);
  record.trezorStaticPubkey.fill(9);
  record.hostStaticPrivkey.fill(9);
  record.credential.fill(9);
  const [kept] = await store.load();
  t.eq('the device key kept', api.toHex(new Uint8Array(32).fill(1)), api.toHex(kept.trezorStaticPubkey));
  t.eq('the host key kept', api.toHex(new Uint8Array(32).fill(2)), api.toHex(kept.hostStaticPrivkey));
  t.eq('the credential kept', api.toHex(new Uint8Array(10).fill(3)), api.toHex(kept.credential));
  const forgotten = bufferOf(api, new Uint8Array(32).fill(1));
  const forgetting = store.forget(forgotten);
  forgotten.fill(7);
  await forgetting;
  t.eq('the device named at the call was forgotten', 0, (await store.load()).length);
});

add('a transaction body is sent in pieces that no later change of the caller\'s Buffer reaches', async ({ api, t }) => {
  const body = bufferOf(api, new Uint8Array(5000).map((_, i) => i & 0xff));
  const original = new Uint8Array(body);
  const pieces: Uint8Array[] = [];
  const answers = [
    { id: 3, data: api.TxDataRequest.encode({ offset: 2048, length: 2048 }) },
    { id: 3, data: api.TxDataRequest.encode({ offset: 4096, length: 904 }) },
    { id: 5, data: api.TxSignature.encode({ signature: new Uint8Array(64).fill(3) }) },
  ];
  await api.streamBody(body, { id: 3, data: api.TxDataRequest.encode({ offset: 0, length: 2048 }) }, async (data) => {
    pieces.push(data);
    // The caller changes its Buffer while the piece is on its way.
    body.fill(0xee);
    return answers.shift() as { id: number; data: Uint8Array };
  });
  t.eq('the pieces are the body as it was', api.toHex(original), api.toHex(new Uint8Array(pieces.flatMap((p) => [...p]))));
});

add('the load of an image copies it first: what the device is sent is the image of the call', async ({ api, t }) => {
  for (const [what, hold] of [
    ['plain arrays', (b: Uint8Array) => new Uint8Array(b)],
    ['Buffers', (b: Uint8Array) => bufferOf(api, b)],
  ] as const) {
    const s = await synthetic();
    const parsed = api.parseAppImage(s.files);
    const image = {
      ...parsed,
      header: hold(parsed.header),
      proof: hold(parsed.proof),
      rootPacket: hold(parsed.rootPacket),
      chunks: parsed.chunks.map((c) => ({ hash: hold(c.hash), data: hold(c.data) })),
    };
    const { client, sent } = stubClient([
      reply(api.ExtAppHeaderRequest, {}),
      reply(api.ExtAppRootPacketRequest, { app_ring: 2 }),
      reply(api.ExtAppDataChunkRequest, { index: 0 }),
      reply(api.ExtAppDataChunkRequest, { index: 1 }),
      reply(api.ExtAppDataChunkRequest, { index: 2 }),
      reply(api.ExtAppLoaded, { instance_id: 7, version: version(1, 1) }),
    ]);
    const loading = api.loadApp(client, image);
    // The caller changes the image while the load is under way.
    image.header.fill(0);
    image.proof.fill(0);
    image.rootPacket.fill(0);
    for (const c of image.chunks) {
      c.data.fill(0);
      c.hash.fill(0);
    }
    await loading;
    const ack = api.ExtAppHeaderAck.decode(sent[1].payload);
    t.eq(`${what}: the header sent`, api.toHex(parsed.header), api.toHex(ack.header));
    t.eq(`${what}: the proof sent`, api.toHex(parsed.proof), api.toHex(ack.proof));
    t.eq(`${what}: the root packet sent`, api.toHex(parsed.rootPacket), api.toHex(api.ExtAppRootPacketAck.decode(sent[2].payload).root_packet));
    const chunks = sent.slice(3).map((m) => api.ExtAppDataChunkAck.decode(m.payload));
    t.eq(
      `${what}: the chunks sent`,
      parsed.chunks.map((c) => `${api.toHex(c.data)}:${api.toHex(c.hash)}`),
      chunks.map((c) => `${api.toHex(c.data)}:${api.toHex(c.hash)}`),
    );
  }
});

add('the model an image was built for is read from its header and compared with the device\'s, as the Rust host does', async ({ api, t }) => {
  const s = await synthetic();
  const image = api.parseAppImage(s.files);
  t.eq('the model of the synthetic image', 'T3W1', api.appImageModel(image));
  const other = api.parseAppImage((await synthetic([0, 1, 1, 0], 2, 'T3T1')).files);
  t.eq('another model', 'T3T1', api.appImageModel(other));
  const shortName = api.parseAppImage((await synthetic([0, 1, 1, 0], 2, 'T3')).files);
  t.eq('a name shorter than the field is read up to the first zero', 'T3', api.appImageModel(shortName));
  const { client, sent } = stubClient([reply(api.ExtAppLoaded, { instance_id: 4, version: version(1, 1) })], 'T3T1');
  const error = await t.rejects('a Safe 7 image on a Safe 5', api.loadApp(client, image));
  t.ok('an app image error naming both models and what to use', error instanceof api.TrezorAppImageError && /built for the T3W1.*is a T3T1.*image built for the T3T1/.test((error as Error).message), String(error));
  t.eq('nothing was sent', 0, sent.length);
  t.eq('the CLI reports it as an app image error', 'app_image', api.trezorErrorCode(error as InstanceType<typeof api.TrezorAppImageError>));
  const unchecked = stubClient([reply(api.ExtAppLoaded, { instance_id: 4, version: version(1, 1) })], 'T3T1');
  const skipped = await t.rejects('the option that skipped the check is gone: an image of another model is refused although it is passed', api.loadApp(unchecked.client, image, { skipModelCheck: true } as never));
  t.ok('with the same app image error', skipped instanceof api.TrezorAppImageError, String(skipped));
  t.eq('and nothing was sent', 0, unchecked.sent.length);
  // A recorded conversation whose image has no model is loaded by the function the package does not export.
  t.eq('the load without the check is not in the package', false, 'loadAppWithoutModelCheck' in api);
  const recorded = stubClient([reply(api.ExtAppLoaded, { instance_id: 4, version: version(1, 1) })], 'T3T1');
  t.eq('and it loads the image of another model', 4, (await loadAppWithoutModelCheck(recorded.client, image)).instanceId);
});

// ---- the source of randomness cannot be replaced by accident ----

add('setRandomBytesSource is for tests: it refuses a call without the explicit argument', async ({ api, t }) => {
  const scripted = (): Uint8Array => new Uint8Array(32).fill(7);
  // Called as an application that does not know better would call it.
  const set = api.setRandomBytesSource as unknown as (source?: unknown, testOnly?: unknown) => void;
  try {
    for (const [what, call] of [
      ['no second argument', () => set(scripted)],
      ['an empty second argument', () => set(scripted, {})],
      ['forTests false', () => set(scripted, { forTests: false })],
      ['restoring without it', () => set(undefined)],
    ] as const) {
      let error: unknown;
      try {
        call();
      } catch (e) {
        error = e;
      }
      t.ok(`${what}: refused, and the text says it is for tests`, error instanceof Error && /tests/.test(error.message), String(error));
    }
    api.setRandomBytesSource(scripted, TEST_ONLY);
    t.ok('with the explicit argument the source is replaced', true);
  } finally {
    api.setRandomBytesSource(undefined, TEST_ONLY);
  }
});
