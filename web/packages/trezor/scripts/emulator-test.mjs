// The gate of plan B2 against the Trezor Safe 7 emulator, then every request of
// the app through the signer: the code under test is the BUILT browser bundle
// (dist/index.js) with the Node UDP transport and the credential file of
// dist/emulator.js. Run by `trezor/scripts/test-web-host.sh`
// (`pnpm test:emulator`), which starts the emulator, loads the wallet of the
// signing fixtures and runs `web_host_screens.py confirm`, the debug-link helper
// that answers the device's screens and writes the pairing code it shows to
// --code-file, as a person would read it.
//
//   node scripts/emulator-test.mjs --address 127.0.0.1:21324 --image <.tapp> \
//     --code-file <file> --work <directory> --screens <web_host_screens.py> \
//     --plans <dir> --captures <dir> --previews <dir> --emulator-log <file> \
//     --screens-log <file> [--older-image <.tapp of an older build>]
//
// After the gate and the signer's requests, the scenarios that read the screens:
// the device's review of every signed case of the fixture, of the messages and
// of the EOA authorizations is compared with the review the TypeScript preview
// gave before the request; the refused cases give the app's reason and no
// screen; the person refuses on the device (by the button and through the
// menu), holds an approval back, types a passphrase; and the image cases.
// Everything the helper does with a screen is `scripts/lib/screens.mjs`.
//
// Exits non-zero on any mismatch.
import { createHash, createPublicKey, verify } from 'node:crypto';
import { existsSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createScreens } from './lib/screens.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../../..');
const dist = join(here, '..', 'dist');

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);
const need = (name) => {
  const value = args.get(name);
  if (!value) throw new Error(`missing ${name}`);
  return value;
};
const address = need('--address');
const imagePath = need('--image');
const codeFile = need('--code-file');
const work = need('--work');
const screens = createScreens({
  helper: need('--screens'),
  plans: need('--plans'),
  captures: need('--captures'),
  previews: need('--previews'),
  emulatorLog: need('--emulator-log'),
  screensLog: need('--screens-log'),
});
const olderPath = args.get('--older-image') ?? '';

const api = await import(join(dist, 'index.js'));
const emulator = await import(join(dist, 'emulator.js'));

// ---- reporting ----

let failures = 0;
/** How many of each kind of scenario ran and passed, for the summary. */
const counts = new Map();
const count = (kind) => counts.set(kind, (counts.get(kind) ?? 0) + 1);
const check = (label, ok, detail = '') => {
  if (ok) console.log(`ok:   ${label}`);
  else {
    failures++;
    console.error(`FAIL: ${label}${detail ? `: ${detail}` : ''}`);
  }
};
const equal = (label, got, want) => check(`${label} = ${typeof got === 'string' ? got : JSON.stringify(got)}`, got === want, `got ${got}, want ${want}`);
const rejects = async (label, promise) => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  check(label, false, 'no error');
  return undefined;
};
const phase = async (name, run) => {
  const started = Date.now();
  console.log(`== ${name}`);
  try {
    await run();
  } catch (error) {
    failures++;
    console.error(`FAIL: ${name}: ${error?.stack ?? error}`);
  }
  console.log(`   (${((Date.now() - started) / 1000).toFixed(1)} s)`);
};

// ---- what the test is checked against ----

const hd = JSON.parse(readFileSync(join(repo, 'contrib/test/vectors/signing/hd_vectors.json'), 'utf8'));
const corpus = hd.derivations.find((d) => d.name === 'bip39-abandon-about/no-passphrase/depth4/account-0');
const fixture = JSON.parse(readFileSync(join(repo, 'trezor/app-thru/tests/fixtures/sign_tx.json'), 'utf8'));
const signCase = fixture.cases.find((c) => c.name === 'transfer_shared_corpus');
const HARDENED = 0x80000000;
const parsePath = (text) => text.split('/').slice(1).map((p) => (p.endsWith("'") ? (Number(p.slice(0, -1)) | HARDENED) >>> 0 : Number(p)));
const path = parsePath(corpus.path);
const body = api.fromHex(signCase.body_hex);
// The requests of the app through the signer, with what the shared corpus signs.
const messageVectors = JSON.parse(readFileSync(join(repo, 'contrib/test/vectors/signing/message_vectors.json'), 'utf8'));
const eoaVectors = JSON.parse(readFileSync(join(repo, 'contrib/test/vectors/signing/eoa_auth_vectors.json'), 'utf8'));
const hintedCases = fixture.cases.filter((c) => c.outcome === 'signed' && c.token_hint_hex !== undefined && c.path === corpus.path);

// The image: three files, the root packet two directories above the .tapp's own.
const readBytes = (file) => new Uint8Array(readFileSync(file));
/** The image of a `.tapp` with its `.proof` beside it and its root packet two directories up. */
function readImage(tappPath) {
  const tapp = readBytes(tappPath);
  const header = api.readAppHeader(tapp);
  const rootPacketPath = join(dirname(tappPath), '../../root-packets', api.rootPacketFileName(header.appRing));
  return api.parseAppImage({
    tapp,
    proof: readBytes(tappPath.replace(/\.tapp$/, '.proof')),
    rootPacket: readBytes(rootPacketPath),
  });
}
const image = readImage(imagePath);

// ---- helpers ----

/**
 * The emulator's UDP transport. It answers a ping from the same thread that draws
 * the screens, which the debug-link helper keeps reading, so on a loaded machine
 * the default 500 ms can pass before the answer: the test waits ten seconds.
 */
const connectUdp = () => emulator.UdpTransport.connect({ address, pingTimeoutMs: 10_000 });

const credentialPath = join(work, 'credentials', 'trezor.json');
const files = new emulator.FileCredentialStore(credentialPath);

async function shownCode() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (existsSync(codeFile)) return readFileSync(codeFile, 'utf8').trim();
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('the device showed no pairing code within a minute');
}

async function open(options) {
  const transport = await connectUdp();
  return api.TrezorClient.connect(transport, {
    hostName: 'thru web host test',
    appName: 'thru',
    credentialStore: options.store,
    ui: options.ui,
    allowSkipPairing: options.skip === true,
    passphraseOnDevice: options.passphraseOnDevice === true,
    signal: options.signal,
  });
}

const noCode = (why) => ({
  pairingCode: () => {
    throw new Error(`the host asked for a pairing code ${why}`);
  },
});

const verifies = (publicKey, signature) => {
  const spki = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(publicKey)]);
  const digest = createHash('sha256').update(body).digest();
  const message = Buffer.concat([Buffer.from('tn_txn_sign_v1__'), digest]);
  return verify(null, message, createPublicKey({ key: spki, format: 'der', type: 'spki' }), Buffer.from(signature));
};

async function keyAndSignature(app, label) {
  const key = await app.getPublicKey(path, { showOnDevice: false });
  equal(`${label}: public key of m/44'/8478'/0'/0'`, api.toHex(key.publicKey), corpus.pubkey_hex);
  equal(`${label}: address`, key.address, corpus.address);
  const signature = await app.signTransaction(path, body);
  equal(`${label}: signature of transfer_shared_corpus`, api.toHex(signature), signCase.signature_hex);
  check(`${label}: the signature verifies under the device's key (tn_txn_sign_v1__ || SHA-256(body))`, verifies(key.publicKey, signature));
}

console.log(`bundle: ${join(dist, 'index.js')} (${(statSync(join(dist, 'index.js')).size / 1024).toFixed(0)} KB), emulator at ${address}`);
console.log(`image:  ${imagePath} (${image.id} ${image.version.join('.')}, ${image.chunks.length} chunks)`);

// ---- 1. channel allocation and handshake ----

await phase('channel allocation and handshake', async () => {
  const transport = await connectUdp();
  check('the emulator transport says it is the emulator', transport.isEmulator === true);
  const link = await api.Link.open(transport, { clock: api.systemClock, knownCredentials: [] });
  try {
    equal('device model', link.properties.internalModel, 'T3W1');
    equal('protocol version', link.properties.protocolVersion.join('.'), '2.1');
    equal('pairing state with no credential', link.pairingState, 'unpaired');
    equal('no stored credential matched', link.credentialMatched, false);
    check('the device offers code entry', link.properties.pairingMethods.includes(2), JSON.stringify(link.properties.pairingMethods));
    console.log(`info: pairing methods ${JSON.stringify(link.properties.pairingMethods)}, handshake hash ${api.toHex(link.handshakeHash).slice(0, 16)}...`);
  } finally {
    await link.close();
  }
});

// ---- 2. pairing is not skipped unless asked ----

await phase('pairing is not skipped when it is not asked for', async () => {
  const error = await rejects('connecting without the skip option', open({ store: new api.MemoryCredentialStore(), ui: noCode('(as it must)') }));
  check('the host asked for a pairing code', /asked for a pairing code/.test(String(error?.message)), String(error));
});

// ---- 3. a wrong code ----

await phase('pairing by code: a wrong code is refused', async () => {
  const { unlinkSync } = await import('node:fs');
  if (existsSync(codeFile)) unlinkSync(codeFile);
  let typed;
  const error = await rejects(
    'connecting with the wrong code',
    open({
      store: files,
      ui: {
        pairingCode: async () => {
          const shown = await shownCode();
          typed = [...shown].map((d) => String((Number(d) + 1) % 10)).join('');
          console.log(`info: the device shows ${shown}, the host types ${typed}`);
          return typed;
        },
      },
    }),
  );
  check('a pairing error', error instanceof api.TrezorPairingError, String(error));
  equal('the reason', error?.reason, 'wrong_code');
  check('the text says the code is wrong', /the code is wrong/.test(String(error?.message)), String(error?.message));
  check('no credential was stored', !existsSync(credentialPath));
});

// ---- 3b. the image cases of the rollback rule. They come before anything loads
// the current image: a device that has loaded a newer build of the app refuses an
// older one until it is wiped, so the older build must be the first to load. ----

/** The fixture's wallet transfer: only the current build signs it; the older one refuses it. */
const walletCase = fixture.cases.find((c) => c.name === 'wallet_transfer');
/** Whether the device already holds the current build, which the later scenarios take into account. */
let currentHeld = false;

/** A connection with pairing skipped (the emulator's), the app of `img` loaded; the caller closes `client`. */
async function loadWith(img) {
  const client = await open({ store: new api.MemoryCredentialStore(), ui: noCode('(pairing was skipped)'), skip: true });
  try {
    return { client, ...(await api.ThruApp.load(client, img)) };
  } catch (error) {
    await client.close();
    throw error;
  }
}

/** The wallet transfer on `app`: its signature, or the error. */
async function walletTransfer(app) {
  try {
    return { signature: api.toHex(await app.signTransaction(walletCase.path, api.fromHex(walletCase.body_hex))) };
  } catch (error) {
    return { error };
  }
}

if (olderPath === '') {
  console.log('skip: the image cases of the rollback rule (the older build is not given: TREZOR_OLDER_APP_IMAGE_DIR is not set)');
} else {
  await phase('image cases: an older build loads and runs, the current one replaces it, the older one is then refused', async () => {
    const older = readImage(olderPath);
    console.log(`info: older build ${older.version.join('.')} (root packet time ${older.rootPacketTimestamp}), current ${image.version.join('.')} (${image.rootPacketTimestamp})`);
    check('the fixture has the wallet transfer that tells the builds apart', walletCase !== undefined);

    // 1. The older build is uploaded and runs: it refuses a wallet transfer.
    let held = await loadWith(older);
    try {
      equal('the older build is uploaded', held.uploaded, true);
      const result = await walletTransfer(held.app);
      equal('the older build refuses a wallet transfer (so it is the one running): reason', result.error?.reason, 'unsupported_transaction');
    } finally {
      await held.client.close();
    }
    // 2. Connected again, it is held: nothing is uploaded.
    held = await loadWith(older);
    try {
      equal('the older build, connected again, is not uploaded again', held.uploaded, false);
    } finally {
      await held.client.close();
    }
    // 3. The current build replaces it and signs the wallet transfer.
    held = await loadWith(image);
    try {
      equal('the current build replaces the older one (uploaded)', held.uploaded, true);
      const result = await walletTransfer(held.app);
      equal('the current build signs the wallet transfer with the fixture signature', result.signature, walletCase.signature_hex);
    } finally {
      await held.client.close();
    }
    // 4. The device has loaded the newer build: the older one is refused, and the error says what to do.
    const refused = await rejects('the older build after the current one', loadWith(older));
    check('a failure of the device', refused instanceof api.TrezorFailureError, String(refused));
    equal('the device says', refused?.failureMessage, 'Failed to load app');
    check(
      'the error says what to do',
      String(refused?.message).endsWith(
        'Failed to load app; one cause: a device that has loaded a newer build of the app refuses an older one until it is wiped, so load the newest build; otherwise check that the image, its proof and the root packet are from the same build',
      ),
      String(refused?.message),
    );
    equal('the CLI code of the error', refused === undefined ? undefined : api.trezorErrorCode(refused), 'device_error');
    // 5. The current build loads again (the device dropped what it held) and is then held.
    held = await loadWith(image);
    try {
      console.log(`info: the current build after the refusal: uploaded ${held.uploaded}`);
    } finally {
      await held.client.close();
    }
    held = await loadWith(image);
    try {
      equal('the current build, connected again, is not uploaded again', held.uploaded, false);
    } finally {
      await held.client.close();
    }
    currentHeld = true;
    count('image');
  });
}

// ---- 4. pairing, the credential, the app, a session ----

let before;
await phase('pairing by code: the right code pairs, stores a credential, loads the app, signs', async () => {
  const { unlinkSync } = await import('node:fs');
  if (existsSync(codeFile)) unlinkSync(codeFile);
  const client = await open({
    store: files,
    ui: {
      pairingCode: async () => {
        const shown = await shownCode();
        console.log(`info: the device shows ${shown}, the host types it`);
        return shown;
      },
    },
  });
  try {
    check('a session was created', !client.isClosed);
    const stored = await files.load();
    equal('credentials stored', stored.length, 1);
    equal('a device key of 32 bytes', stored[0]?.trezorStaticPubkey.length, 32);
    equal('a host key of 32 bytes', stored[0]?.hostStaticPrivkey.length, 32);
    check('a credential of 1 to 126 bytes', stored[0]?.credential.length >= 1 && stored[0]?.credential.length <= 126, String(stored[0]?.credential.length));
    const mode = statSync(credentialPath).mode & 0o777;
    const directoryMode = statSync(dirname(credentialPath)).mode & 0o777;
    equal('credential file mode', mode.toString(8), '600');
    equal('credential directory mode', directoryMode.toString(8), '700');
    before = readFileSync(credentialPath);

    const { app, uploaded, instanceId } = await api.ThruApp.load(client, image);
    equal(currentHeld ? 'the app was not uploaded (the image cases left it on the device)' : 'the app was uploaded (the device did not hold it)', uploaded, !currentHeld);
    console.log(`info: instance ${instanceId}`);
    await keyAndSignature(app, 'first connection');
    const shownKey = await app.getPublicKey(path, { showOnDevice: true });
    equal('public key shown on the device', api.toHex(shownKey.publicKey), corpus.pubkey_hex);
  } finally {
    await client.close();
  }
});

// ---- 5. a second connection with the stored credential ----

await phase('a second connection uses the credential: no pairing, the app is not uploaded again', async () => {
  const client = await open({ store: new emulator.FileCredentialStore(credentialPath), ui: noCode('(a stored credential must pair)') });
  try {
    equal('the handshake sent the stored credential', client.channel.credentialMatched, true);
    // The credential was requested with autoconnect off; the emulator's
    // firmware answers "paired, autoconnect" (state 2) all the same. Either
    // means paired.
    check('the device reports this host as paired', ['paired', 'paired_autoconnect'].includes(client.channel.pairingState), client.channel.pairingState);
    console.log(`info: pairing state reported by the device: ${client.channel.pairingState}`);
    console.log(`info: busy answers met: ${client.channel.stats.busyBackoffs}`);
    const { app, uploaded } = await api.ThruApp.load(client, image);
    equal('the app was uploaded again', uploaded, false);
    await keyAndSignature(app, 'second connection');
  } finally {
    await client.close();
  }
  check('the credential file is unchanged', Buffer.compare(readFileSync(credentialPath), before) === 0);
});

// ---- 6. skipping pairing, asked for on the emulator ----

await phase('pairing skipped on the emulator, when asked for', async () => {
  const client = await open({ store: new api.MemoryCredentialStore(), ui: noCode('(pairing was skipped)'), skip: true });
  try {
    const { app } = await api.ThruApp.load(client, image);
    const key = await app.getPublicKey(path);
    equal('public key', api.toHex(key.publicKey), corpus.pubkey_hex);
  } finally {
    await client.close();
  }
});

// ---- 7. the signer: a message, an authorization, a hinted token transfer ----

/** A signer on a new connection that uses the stored credential: no pairing, and the app is not uploaded again. */
async function withSigner(run) {
  const client = await open({ store: new emulator.FileCredentialStore(credentialPath), ui: noCode('(a stored credential must pair)') });
  try {
    const { app, uploaded } = await api.ThruApp.load(client, image);
    equal('the app was already on the device', uploaded, false);
    await run(new api.ThruTrezorSigner({ app, transactionSigningScheme: 'rfc8032' }));
  } finally {
    await client.close();
  }
}

await phase('the signer, from connectTrezor: the key and address of the corpus, the screen confirmed on the device', async () => {
  let appLoading = 0;
  // The whole connection in one call: transport, stored credential (no pairing), app already loaded.
  const signer = await api.connectTrezor({
    transport: await connectUdp(),
    credentialStore: new emulator.FileCredentialStore(credentialPath),
    image,
    hostName: 'thru web host test',
    appName: 'thru',
    ui: noCode('(a stored credential must pair)'),
    transactionSigningScheme: 'rfc8032',
    onAppLoading: () => {
      appLoading++;
    },
  });
  equal('onAppLoading was called once, before the app was offered to the device', appLoading, 1);
  try {
    const out = await signer.getAddress(corpus.path, { display: true });
    equal('public key', api.toHex(out.publicKey), corpus.pubkey_hex);
    equal('address', out.address, corpus.address);
    equal('path', out.path.path, corpus.path);
    const silent = await signer.getAddress(corpus.path);
    equal('the same key without a screen', silent.address, corpus.address);
    // The address refused on the device: a cancellation, then the next request works.
    screens.plan('address-refused', { refuseAddress: true });
    const refusedAddress = await rejects('the address refused on the device', signer.getAddress(corpus.path, { display: true }));
    check(`the address refused on the device is a cancellation (${refusedAddress?.code})`, refusedAddress instanceof api.TrezorCancelledError, String(refusedAddress));
    equal('the refused address: the CLI\'s code', refusedAddress instanceof api.TrezorError ? api.trezorErrorCode(refusedAddress) : undefined, 'user_rejected');
    screens.wait('address-refused', 30);
    equal('the refused address: the helper refused the address', screens.info('address-refused', 'address'), 'refused');
    const afterRefusal = await signer.getAddress(corpus.path, { display: true });
    equal('the address shown again after the refusal', afterRefusal.address, corpus.address);
    const wrong = await rejects('a key that is not the device\'s', signer.getAddress(corpus.path, { expectedPublicKey: new Uint8Array(32) }));
    equal('refused as key_mismatch', wrong?.code, 'key_mismatch');
  } finally {
    await signer.close();
  }
  const closed = await rejects('a call after close', signer.getAddress(corpus.path));
  equal('refused as closed', closed?.code, 'closed');
  // A callback that throws does not break the connection.
  const throwing = await api.connectTrezor({
    transport: await connectUdp(),
    credentialStore: new emulator.FileCredentialStore(credentialPath),
    image,
    hostName: 'thru web host test',
    appName: 'thru',
    ui: noCode('(a stored credential must pair)'),
    transactionSigningScheme: 'rfc8032',
    onAppLoading: () => {
      throw new Error('the status line failed');
    },
  });
  try {
    equal('a connection whose onAppLoading throws still works', (await throwing.getAddress(corpus.path)).address, corpus.address);
  } finally {
    await throwing.close();
  }
});

await phase('the signer: text messages signed on the device, with the corpus signatures', async () => {
  await withSigner(async (signer) => {
    for (const name of ['ledger_msg_hello', 'ascii_with_newline']) {
      const vector = messageVectors.find((v) => v.name === name);
      const out = await signer.signMessage(vector.signer_path, api.fromHex(vector.message_hex));
      equal(`${name}: the corpus signature`, api.toHex(out.signature), vector.signature_hex);
      equal(`${name}: the key`, api.toHex(out.publicKey), vector.signer_pubkey_hex);
    }
    // What the host knows is refused before the device is asked.
    const refused = await rejects('a message that is not text', signer.signMessage(corpus.path, new Uint8Array(Buffer.from('two  spaces'))));
    equal('the host refuses it as invalid_request', refused?.code, 'invalid_request');
  });
});

await phase('the signer: EOA authorizations (create and delete) signed on the device, with the corpus signatures', async () => {
  await withSigner(async (signer) => {
    for (const name of ['ledger_eoa_create_chain_1', 'delete_chain_1']) {
      const vector = eoaVectors.find((v) => v.name === name);
      const out = await signer.signEoaAuth(
        vector.signer_path,
        vector.kind,
        vector.chain_id,
        api.fromHex(vector.fee_payer_hex),
        api.fromHex(vector.account_hex),
      );
      equal(`${name}: the corpus signature`, api.toHex(out.signature), vector.signature_hex);
    }
    const other = eoaVectors.find((v) => v.name === 'device_create_other_account');
    const error = await rejects(
      'an authorization for another account',
      signer.signEoaAuth(other.signer_path, other.kind, other.chain_id, api.fromHex(other.fee_payer_hex), api.fromHex(other.account_hex)),
    );
    equal('the host refuses it as invalid_request', error?.code, 'invalid_request');
  });
});

await phase('the signer: token transfers with their hints signed on the device, with the fixture signatures', async () => {
  check('the fixture has hinted token transfers for account 0', hintedCases.length >= 2, String(hintedCases.length));
  await withSigner(async (signer) => {
    for (const c of hintedCases.slice(0, 2)) {
      const out = await signer.signTransactionBody(c.path, api.fromHex(c.body_hex), { tokenHint: api.fromHex(c.token_hint_hex) });
      equal(`${c.name}: the fixture signature`, api.toHex(out.signature), c.signature_hex);
      equal(`${c.name}: the hash the device shows`, out.bodyHash, c.review.tx_hash);
      // The host said first what the device would show.
      const review = api.transactionReview(api.fromHex(c.body_hex), out.publicKey, c.path, api.fromHex(c.token_hint_hex));
      equal(`${c.name}: the preview is a token transfer`, review?.kind, 'token_transfer');
    }
  });
});

// ---- 7b. what the device shows against what the TypeScript preview said it would show ----

const signedCases = fixture.cases.filter((c) => c.outcome === 'signed');
const refusedCases = fixture.cases.filter((c) => c.outcome !== 'signed');
const textMessages = messageVectors.filter((v) => v.display === 'text');
const notTextMessages = messageVectors.filter((v) => v.display === 'hash');
const validEoa = eoaVectors.filter((v) => v.category === 'valid');
const rejectedEoa = eoaVectors.filter((v) => v.category !== 'valid');
const HOLD_SECONDS = 8;

/** A signer on a new connection that uses the stored credential; `ui` adds callbacks, `extra` connect options. */
async function newSigner(extra = {}, ui = {}) {
  return api.connectTrezor({
    transport: await connectUdp(),
    credentialStore: new emulator.FileCredentialStore(credentialPath),
    image,
    hostName: 'thru web host test',
    appName: 'thru',
    ui: { ...noCode('(a stored credential must pair)'), ...ui },
    transactionSigningScheme: 'rfc8032',
    ...extra,
  });
}

const keyAt = async (signer, signerPath) => (await signer.getAddress(signerPath)).publicKey;

/**
 * One request as a person sees it. The helper is told what to do with it (`plan`:
 * approve, refuse at a step, hold the approval back), the request is made, and
 * the review the helper read off the screens is compared, by the helper, with
 * the review the TypeScript preview gave: equal for a request that was signed,
 * the preview's first steps for one that was refused (`planned`: the caller wrote
 * the plan file itself). Returns what the call
 * returned or the error it threw.
 */
async function onDevice(name, { preview, plan = {}, outcome, planned = false }, call) {
  if (!planned) screens.plan(name, plan);
  let value;
  let error;
  try {
    value = await call();
  } catch (caught) {
    error = caught;
  }
  try {
    screens.wait(name);
  } catch (caught) {
    const unused = screens.discardUnusedPlan();
    check(`${name}: the screens were captured`, false, `${caught.message}${unused ? ' (no screen came up for the request)' : ''}`);
    return { value, error };
  }
  equal(`${name}: the outcome on the device`, screens.info(name, 'outcome'), outcome);
  if (plan.refuseAt !== undefined) equal(`${name}: refused at`, screens.info(name, 'refused_at'), plan.refuseAt);
  const result = screens.compare(name, screens.writePreview(name, preview));
  check(`${name}: the device's review equals the TypeScript preview (${result.text.split('\n').pop()})`, result.ok, result.text);
  return { value, error };
}

await phase('every signed fixture case: the fixture signature, and the device shows the preview\'s review', async () => {
  const signer = await newSigner();
  let first;
  let last;
  try {
    for (const c of signedCases) {
      const name = `fixture-${c.name}`;
      const body = api.fromHex(c.body_hex);
      const hint = c.token_hint_hex === undefined ? undefined : api.fromHex(c.token_hint_hex);
      const key = await keyAt(signer, c.path);
      const preview = api.transactionReview(body, key, c.path, hint);
      if (preview === null) {
        check(`${name}: the preview has a review`, false);
        continue;
      }
      const { value, error } = await onDevice(name, { preview, outcome: 'signed' }, () => signer.signTransactionBody(c.path, body, { tokenHint: hint }));
      if (error !== undefined) {
        check(`${name}: signed`, false, String(error?.stack ?? error));
        continue;
      }
      equal(`${name}: the fixture signature (${body.length} bytes, ${c.path}${hint === undefined ? '' : ', with the token hint'})`, api.toHex(value.signature), c.signature_hex);
      equal(`${name}: the hash the device shows`, value.bodyHash, c.review.tx_hash);
      first ??= name;
      last = name;
      count('signed');
    }
  } finally {
    await signer.close();
  }
  equal('signed cases run', counts.get('signed') ?? 0, signedCases.length);
  // The comparison looks at the real captures: a preview of another request must not match.
  if (first !== undefined && first !== last) {
    const other = screens.compare(last, screens.previewPath(first));
    check(`the comparison refuses the review of ${last} against the preview of ${first}`, !other.ok, other.text);
  }
});

await phase('every refused fixture case: the app\'s reason as the typed error, and no screen', async () => {
  const client = await open({ store: new emulator.FileCredentialStore(credentialPath), ui: noCode('(a stored credential must pair)') });
  try {
    const { app } = await api.ThruApp.load(client, image);
    const requestsBefore = screens.screensCount('request ');
    const byHost = [];
    const byApp = [];
    for (const c of refusedCases) {
      const hint = c.token_hint_hex === undefined ? undefined : api.fromHex(c.token_hint_hex);
      const error = await rejects(`${c.name}: refused`, app.signTransaction(c.path, api.fromHex(c.body_hex), { tokenHint: hint }));
      if (error === undefined) continue;
      const typed = error instanceof api.TrezorAppRefusedError || error instanceof api.TrezorInvalidRequestError;
      equal(`${c.name}: refused as ${c.outcome} (${typed ? error.code : error?.constructor?.name})`, typed ? error.reason : undefined, c.outcome);
      (error instanceof api.TrezorInvalidRequestError ? byHost : byApp).push(c.name);
      count('refused');
    }
    console.log(`info: refused by the host before the device: ${byHost.length} (${byHost.join(', ')})`);
    console.log(`info: refused by the app on the device: ${byApp.length}`);
    equal('refused cases run', counts.get('refused') ?? 0, refusedCases.length);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    equal('requests with a screen for the refused cases', screens.screensCount('request '), requestsBefore);
    const key = await app.getPublicKey(path);
    equal('the connection still works after the refusals: the public key', api.toHex(key.publicKey), corpus.pubkey_hex);
  } finally {
    await client.close();
  }
});

await phase('a refusal on the device: by the step\'s button and through the menu, at a first and at a later step', async () => {
  const signer = await newSigner();
  try {
    const plans = [
      { name: 'refuse-transfer_high_fee-button', case: 'transfer_high_fee', title: 'High fee', how: 'button' },
      { name: 'refuse-transfer_high_fee-menu', case: 'transfer_high_fee', title: 'Send', how: 'menu' },
      { name: 'refuse-transfer_high_fee-first-button', case: 'transfer_high_fee', title: 'Send', how: 'button' },
      // The step "High fee" has no menu to leave by, so the later step refused through its menu is the last one, "Summary".
      { name: 'refuse-transfer_high_fee-last-menu', case: 'transfer_high_fee', title: 'Summary', how: 'menu' },
      { name: 'refuse-wallet_transfer_high_fee-button', case: 'wallet_transfer_high_fee', title: 'High fee', how: 'button' },
    ];
    for (const p of plans) {
      const c = fixture.cases.find((x) => x.name === p.case);
      const body = api.fromHex(c.body_hex);
      const key = await keyAt(signer, c.path);
      const preview = api.transactionReview(body, key, c.path);
      check(`${p.name}: the preview has a step "${p.title}"`, preview?.steps.some((s) => s.title === p.title) === true, JSON.stringify(preview?.steps.map((s) => s.title)));
      if (preview === null) continue;
      const { error } = await onDevice(p.name, { preview, outcome: 'refused', plan: { refuseAt: p.title, refuseHow: p.how } }, () => signer.signTransactionBody(c.path, body));
      check(`${p.name}: refused as a cancellation (${error?.code})`, error instanceof api.TrezorCancelledError, String(error));
      equal(`${p.name}: the CLI's code`, error instanceof api.TrezorError ? api.trezorErrorCode(error) : undefined, 'user_rejected');
      equal(`${p.name}: the connection still works: the public key`, api.toHex(await keyAt(signer, c.path)), api.toHex(key));
      count('refusal');
    }
  } finally {
    await signer.close();
  }
});

await phase(`the person holds the approval back (${HOLD_SECONDS} s): the host waits and signs`, async () => {
  const signer = await newSigner();
  try {
    const c = signCase;
    const body = api.fromHex(c.body_hex);
    const preview = api.transactionReview(body, await keyAt(signer, c.path), c.path);
    const started = Date.now();
    const { value, error } = await onDevice('slow-approval', { preview, outcome: 'signed', plan: { holdSeconds: HOLD_SECONDS } }, () => signer.signTransactionBody(c.path, body));
    const elapsed = (Date.now() - started) / 1000;
    check('the request signed', error === undefined, String(error));
    equal('the fixture signature', value === undefined ? undefined : api.toHex(value.signature), c.signature_hex);
    check(`the host waited for the approval (${elapsed.toFixed(1)} s)`, elapsed >= HOLD_SECONDS);
    count('held');
  } finally {
    await signer.close();
  }
});

await phase('the approval is held back until a file exists, with the plan file written by hand (the chain scenarios\' way)', async () => {
  const signer = await newSigner();
  try {
    const c = signCase;
    const body = api.fromHex(c.body_hex);
    const preview = api.transactionReview(body, await keyAt(signer, c.path), c.path);
    const releaseFile = join(work, 'release');
    if (existsSync(releaseFile)) unlinkSync(releaseFile);
    const name = 'hold-file';
    screens.writePlanFile({ name, hold_file: releaseFile });
    const started = Date.now();
    let released = 0;
    setTimeout(() => {
      released = Date.now();
      writeFileSync(releaseFile, '');
    }, 6000);
    const { value, error } = await onDevice(name, { preview, outcome: 'signed', planned: true }, () => signer.signTransactionBody(c.path, body));
    check('the request signed', error === undefined, String(error));
    equal('the fixture signature', value === undefined ? undefined : api.toHex(value.signature), c.signature_hex);
    check(`the host waited for the file (${((Date.now() - started) / 1000).toFixed(1)} s), and signed only after it appeared`, released !== 0 && Date.now() >= released);
    count('held by file');
  } finally {
    await signer.close();
  }
});

await phase('the six text messages of the corpus: their signatures, and the device shows the preview\'s review', async () => {
  const signer = await newSigner();
  try {
    for (const v of textMessages) {
      const name = `message-${v.name}`;
      const message = api.fromHex(v.message_hex);
      const key = await keyAt(signer, v.signer_path);
      const preview = api.messageReview(message, key, v.signer_path);
      if (preview === null) {
        check(`${name}: the preview has a review`, false);
        continue;
      }
      const { value, error } = await onDevice(name, { preview, outcome: 'signed' }, () => signer.signMessage(v.signer_path, message));
      if (error !== undefined) {
        check(`${name}: signed`, false, String(error?.stack ?? error));
        continue;
      }
      equal(`${name}: the corpus signature (${message.length} bytes)`, api.toHex(value.signature), v.signature_hex);
      count('message');
    }
    equal('text messages run', counts.get('message') ?? 0, textMessages.length);
    // What the host cannot show is refused before the device is asked, with no screen.
    const requestsBefore = screens.screensCount('request ');
    for (const v of notTextMessages) {
      const error = await rejects(`${v.name}: a message that is not text`, signer.signMessage(v.signer_path, api.fromHex(v.message_hex)));
      equal(`${v.name}: refused on the host as invalid_request`, error?.code, 'invalid_request');
      count('message refused');
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
    equal('requests with a screen for the messages that are not text', screens.screensCount('request '), requestsBefore);
    // A refusal on the device.
    const v = textMessages.find((x) => x.name === 'short_ascii');
    const message = api.fromHex(v.message_hex);
    const preview = api.messageReview(message, await keyAt(signer, v.signer_path), v.signer_path);
    const { error } = await onDevice('refuse-message-button', { preview, outcome: 'refused', plan: { refuseAt: 'Sign message', refuseHow: 'button' } }, () => signer.signMessage(v.signer_path, message));
    check(`a message refused on the device is a cancellation (${error?.code})`, error instanceof api.TrezorCancelledError, String(error));
    count('refusal');
  } finally {
    await signer.close();
  }
});

await phase('the eight valid EOA authorizations of the corpus: their signatures, and the device shows the preview\'s review', async () => {
  const signer = await newSigner();
  try {
    for (const v of validEoa) {
      const name = `eoa-${v.name}`;
      const feePayer = api.fromHex(v.fee_payer_hex);
      const account = api.fromHex(v.account_hex);
      const key = await keyAt(signer, v.signer_path);
      const preview = api.eoaAuthReview(v.kind, v.chain_id, feePayer, account, key, v.signer_path);
      if (preview === null) {
        check(`${name}: the preview has a review`, false);
        continue;
      }
      const { value, error } = await onDevice(name, { preview, outcome: 'signed' }, () => signer.signEoaAuth(v.signer_path, v.kind, v.chain_id, feePayer, account));
      if (error !== undefined) {
        check(`${name}: signed`, false, String(error?.stack ?? error));
        continue;
      }
      equal(`${name}: the corpus signature (${v.kind}, chain ${v.chain_id})`, api.toHex(value.signature), v.signature_hex);
      count('eoa');
    }
    equal('valid EOA authorizations run', counts.get('eoa') ?? 0, validEoa.length);
    for (const [name, vector, title, how] of [
      ['eoa-refuse-button', 'ledger_eoa_create_chain_1', 'Authorize account creation', 'button'],
      ['eoa-refuse-menu', 'delete_chain_1', 'Authorize account deletion', 'menu'],
    ]) {
      const v = eoaVectors.find((x) => x.name === vector);
      const feePayer = api.fromHex(v.fee_payer_hex);
      const account = api.fromHex(v.account_hex);
      const preview = api.eoaAuthReview(v.kind, v.chain_id, feePayer, account, await keyAt(signer, v.signer_path), v.signer_path);
      const { error } = await onDevice(name, { preview, outcome: 'refused', plan: { refuseAt: title, refuseHow: how } }, () => signer.signEoaAuth(v.signer_path, v.kind, v.chain_id, feePayer, account));
      check(`${name}: refused as a cancellation (${error?.code})`, error instanceof api.TrezorCancelledError, String(error));
      count('refusal');
    }
  } finally {
    await signer.close();
  }
});

await phase('the corpus\'s refused EOA authorizations: refused with the reason, and no screen', async () => {
  const requestsBefore = screens.screensCount('request ');
  // Through the signer: the host knows both reasons (an account that is not the key, a zero chain id) and refuses before the device is asked to sign.
  const signer = await newSigner();
  try {
    for (const v of rejectedEoa) {
      const error = await rejects(`${v.name}: through the signer`, signer.signEoaAuth(v.signer_path, v.kind, v.chain_id, api.fromHex(v.fee_payer_hex), api.fromHex(v.account_hex)));
      equal(`${v.name}: the signer refuses it with no screen (${v.reject_reason})`, error?.code, 'invalid_request');
    }
  } finally {
    await signer.close();
  }
  // To the app as it is (one connection at a time: the device serves one channel): the host refuses what it knows, the app the rest.
  const client = await open({ store: new emulator.FileCredentialStore(credentialPath), ui: noCode('(a stored credential must pair)') });
  try {
    const { app } = await api.ThruApp.load(client, image);
    for (const v of rejectedEoa) {
      const error = await rejects(`${v.name}: through the app`, app.signEoaAuth(v.signer_path, v.kind, v.chain_id, api.fromHex(v.fee_payer_hex), api.fromHex(v.account_hex)));
      const where = error instanceof api.TrezorAppRefusedError ? `the app on the device, reason ${error.reason}` : `the host, ${error?.code}`;
      console.log(`info: ${v.name} (${v.reject_reason}) is refused by ${where}`);
      check(`${v.name}: refused by the app or the host with a typed error`, error instanceof api.TrezorAppRefusedError || error instanceof api.TrezorInvalidRequestError, String(error));
      if (error instanceof api.TrezorAppRefusedError) equal(`${v.name}: the app's reason`, error.reason, v.reject_reason);
      count('eoa refused');
    }
    equal('refused EOA authorizations run', counts.get('eoa refused') ?? 0, rejectedEoa.length);
  } finally {
    await client.close();
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
  equal('requests with a screen for the refused authorizations', screens.screensCount('request '), requestsBefore);
});

await phase('a passphrase key: TREZOR typed on the device, a wrong one refused, a standard key right after', async () => {
  const passphraseKey = hd.derivations.find((d) => d.mnemonic === fixture.mnemonic && d.passphrase === 'TREZOR' && d.path === corpus.path);
  check('the shared vectors have the passphrase key', passphraseKey !== undefined);
  check('it is not the standard key', passphraseKey?.pubkey_hex !== corpus.pubkey_hex);
  let prompted = 0;
  const onDeviceUi = { enterPassphraseOnDevice: () => prompted++ };
  const withPassphrase = (typed, request, run) =>
    (async () => {
      screens.plan(request, { passphrase: typed });
      const signer = await newSigner({ passphraseOnDevice: true }, onDeviceUi);
      try {
        return await run(signer);
      } finally {
        await signer.close();
        screens.wait(request, 60);
      }
    })();

  const added = await withPassphrase('TREZOR', 'passphrase-add', (signer) => signer.getAddress(corpus.path));
  equal('the key of the passphrase TREZOR', api.toHex(added.publicKey), passphraseKey.pubkey_hex);
  equal('its address', added.address, passphraseKey.address);
  equal('the passphrase was typed on the device', screens.info('passphrase-add', 'passphrase'), 'typed');
  check('the host told the person to type it on the device', prompted >= 1, String(prompted));
  count('passphrase');

  const again = await withPassphrase('TREZOR', 'passphrase-again', (signer) => signer.getAddress(corpus.path, { display: true, expectedPublicKey: added.publicKey }));
  equal('the same passphrase typed again gives the same key (shown on the device)', again.address, passphraseKey.address);
  count('passphrase');

  for (const typed of ['OTHER', '']) {
    const request = `passphrase-wrong-${typed === '' ? 'empty' : typed}`;
    const error = await rejects(
      `a key checked with ${typed === '' ? 'an empty passphrase' : `the passphrase ${typed}`} typed`,
      withPassphrase(typed, request, (signer) => signer.getAddress(corpus.path, { expectedPublicKey: added.publicKey })),
    );
    equal(`${request}: refused as a key mismatch`, error?.code, 'key_mismatch');
    count('passphrase');
  }

  const keyboards = screens.screensCount('screen: passphrase keyboard');
  const standard = await newSigner();
  try {
    const out = await standard.getAddress(corpus.path, { display: true });
    equal('a standard key right after: the standard wallet', api.toHex(out.publicKey), corpus.pubkey_hex);
    equal('its address', out.address, corpus.address);
  } finally {
    await standard.close();
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
  equal('passphrase screens for the standard key', screens.screensCount('screen: passphrase keyboard'), keyboards);
  count('passphrase');
});

// ---- 7c. the image: its fingerprint, and the version rule ----

await phase('an image whose header was changed: the host\'s fingerprint differs, the device asks for it and fails to verify it', async () => {
  const changedPath = screens.variant(imagePath, join(work, 'variant'));
  const changed = readImage(changedPath);
  check('the fingerprint of the changed header differs', api.toHex(api.appFingerprint(changed)) !== api.toHex(api.appFingerprint(image)));
  const from = screens.logSize();
  const client = await open({ store: new api.MemoryCredentialStore(), ui: noCode('(pairing was skipped)'), skip: true });
  try {
    const error = await rejects('loading the changed image', api.ThruApp.load(client, changed));
    check('a failure of the device', error instanceof api.TrezorFailureError, String(error));
    check('the device says the verification failed', /App image verification failed/.test(String(error?.message)), String(error?.message));
    check('and no hint about a newer build (it is not that failure)', !/one cause/.test(String(error?.message)), String(error?.message));
  } finally {
    await client.close();
  }
  await new Promise((resolve) => setTimeout(resolve, 2000));
  equal('load requests for the changed image', screens.logCount(from, 'received message: ExtAppLoad\\b'), 1);
  equal('the device asked for its header (the fingerprint was not the held one)', screens.logCount(from, 'write message: ExtAppHeaderRequest'), 1);
  // The device dropped the held image when it asked for the new one: the host's own image is uploaded again, once.
  for (const [label, uploaded] of [['the host\'s own image after the refused one', true], ['the host\'s own image, connected again', false]]) {
    const client2 = await open({ store: new api.MemoryCredentialStore(), ui: noCode('(pairing was skipped)'), skip: true });
    try {
      const loaded = await api.ThruApp.load(client2, image);
      equal(`${label}: uploaded`, loaded.uploaded, uploaded);
    } finally {
      await client2.close();
    }
  }
  count('image');
});

await phase('an app image of a wrong version is refused by the host, before anything is sent to the device', async () => {
  const tappFile = JSON.parse(readFileSync(imagePath, 'utf8'));
  const headerBytes = Buffer.from(tappFile.header, 'base64');
  const files = (version) => {
    const changed = Buffer.from(headerBytes);
    changed.set(version, 108);
    return {
      tapp: new Uint8Array(Buffer.from(JSON.stringify({ ...tappFile, header: changed.toString('base64') }))),
      proof: readBytes(imagePath.replace(/\.tapp$/, '.proof')),
      rootPacket: readBytes(join(dirname(imagePath), '../../root-packets', api.rootPacketFileName(image.appRing))),
    };
  };
  const same = [...headerBytes.subarray(108, 112)];
  const control = api.parseAppImage(files(same));
  equal('control: the unchanged version parses', control.version.join('.'), image.version.join('.'));
  const loadsBefore = screens.logCount(0, 'received message: ExtAppLoad\\b');
  for (const version of [[0, 0, 9, 0], [0, 1, 0, 5], [0, 2, 0, 0], [1, 0, 0, 0]]) {
    const error = await rejects(`version ${version.join('.')}`, Promise.resolve().then(() => api.parseAppImage(files(version))));
    check(`version ${version.join('.')}: an image error (${error?.code})`, error instanceof api.TrezorAppImageError, String(error));
    check(`version ${version.join('.')}: the text says which versions this host supports`, /is not supported, this host supports 0\.1\.1 up to \(not including\) 0\.2\.0/.test(String(error?.message)), String(error?.message));
    count('wrong version');
  }
  equal('load requests the device got meanwhile', screens.logCount(0, 'received message: ExtAppLoad\\b'), loadsBefore);
});

await phase('an app image built for another model than the device is refused by the host, naming both, before anything is sent to the device', async () => {
  const tappFile = JSON.parse(readFileSync(imagePath, 'utf8'));
  const headerBytes = Buffer.from(tappFile.header, 'base64');
  equal('the model the real image names', api.appImageModel(image), 'T3W1');
  const changed = Buffer.from(headerBytes);
  changed.fill(0, 104, 108);
  changed.set(Buffer.from('T3T1'), 104);
  const otherModel = api.parseAppImage({
    tapp: new Uint8Array(Buffer.from(JSON.stringify({ ...tappFile, header: changed.toString('base64') }))),
    proof: readBytes(imagePath.replace(/\.tapp$/, '.proof')),
    rootPacket: readBytes(join(dirname(imagePath), '../../root-packets', api.rootPacketFileName(image.appRing))),
  });
  equal('the image names the Safe 5', api.appImageModel(otherModel), 'T3T1');
  const loadsBefore = screens.logCount(0, 'received message: ExtAppLoad\\b');
  const client = await open({ store: new api.MemoryCredentialStore(), ui: noCode('(pairing was skipped)'), skip: true });
  try {
    equal('the device says it is a Safe 7', client.properties.internalModel, 'T3W1');
    const error = await rejects('loading the Safe 5 image', api.ThruApp.load(client, otherModel));
    check('an app image error', error instanceof api.TrezorAppImageError, String(error));
    check('naming both models', /built for the T3T1.*this Trezor is a T3W1/.test(String(error?.message)), String(error?.message));
    check('the connection is still open', !client.isClosed);
  } finally {
    await client.close();
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
  equal('load requests the device got meanwhile', screens.logCount(0, 'received message: ExtAppLoad\\b'), loadsBefore);
  count('wrong model');
});

// ---- 8. a second connection while the first waits at the device's code screen ----

await phase("a second connection while the first waits at the device's code screen (busy, then abort)", async () => {
  const { unlinkSync } = await import('node:fs');
  if (existsSync(codeFile)) unlinkSync(codeFile);
  const controller = new AbortController();
  // The first connection reaches the code prompt and the person never types: the device shows the code and waits.
  const first = open({
    store: new api.MemoryCredentialStore(),
    ui: { pairingCode: () => new Promise(() => undefined) },
    signal: controller.signal,
  });
  const firstEnded = first.then(() => undefined, (error) => error);
  const shown = await shownCode();
  console.log(`info: the first connection waits at the code screen (${shown})`);
  const started = Date.now();
  const client = await open({ store: new api.MemoryCredentialStore(), ui: noCode('(pairing was skipped)'), skip: true });
  try {
    console.log(`info: the second connection took ${((Date.now() - started) / 1000).toFixed(1)} s and met ${client.channel.stats.busyBackoffs} busy answer(s)`);
    check('the device told the second connection it was busy, and the host waited and sent again', client.channel.stats.busyBackoffs >= 1, String(client.channel.stats.busyBackoffs));
    const { app } = await api.ThruApp.load(client, image);
    const key = await app.getPublicKey(path);
    equal('public key of the second connection', api.toHex(key.publicKey), corpus.pubkey_hex);
  } finally {
    await client.close();
  }
  controller.abort();
  const error = await Promise.race([firstEnded, new Promise((r) => setTimeout(() => r('still waiting'), 5000))]);
  check('aborting ends the first connection at its prompt', error instanceof api.TrezorAbortedError, String(error));
});

console.log(`scenarios: ${[...counts].map(([kind, n]) => `${kind} ${n}`).join(', ')}`);
if (failures > 0) {
  console.error(`FAILED: ${failures} check(s)`);
  process.exit(1);
}
console.log('PASSED');
process.exit(0);
