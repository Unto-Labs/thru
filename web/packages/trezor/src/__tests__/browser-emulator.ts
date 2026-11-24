/**
 * The emulator scenarios of `scripts/emulator-test.mjs`, run in a page in
 * headless Chromium by `scripts/browser-emulator-test.mjs`: the production
 * browser bundle (`dist/index.js`), the real WebUSB transport and the real
 * IndexedDB store (`dist/webusb.js`), above a stand-in for `navigator.usb`
 * whose packets the script forwards to the emulator's UDP port. It runs in
 * several page loads, each in its own browser launch on one profile directory,
 * as a person's visits would; what the first one stores in IndexedDB is what
 * the later ones read:
 *
 * - `pair`: the credential store is empty; a click asks for the device (the
 *   stand-in refuses outside a click, as Chromium does); a wrong code is
 *   refused and nothing is stored; the right code pairs and the credential
 *   lands in IndexedDB; the app is uploaded; the key and the native transfer
 *   of the fixture are signed.
 * - `reconnect`: the device is reopened with no click, the credential comes
 *   from IndexedDB and no code is asked, the app is not uploaded again; the
 *   transfer and the address are signed again.
 * - `messages`, `eoa`, `tokens`: text messages, EOA authorizations and hinted
 *   token transfers, each with the signature the shared vectors hold.
 * - `forget`: the credential is forgotten and the next connection needs a
 *   code again.
 *
 * It uses no Node API: the code of the shown pairing code and the emulator's
 * packets reach it through bindings the script exposes.
 */
import { newCheck, type CaseResult } from './driver-support';
import type { SigningData } from './signer-support';
import type { Api } from './vector-checks';
import type * as WebUsbApi from '../webusb';

type WebUsb = typeof WebUsbApi;

export type BrowserEmulatorData = SigningData & {
  /** The app image: its three files, base64. */
  image: { tapp: string; proof: string; rootPacket: string };
  /** The IndexedDB database of this run. */
  databaseName: string;
  /** The bindings of the script. */
  bindings: { shownCode(): Promise<string>; clearShownCode(): Promise<void> };
};

/** The page loads of the run, in order; each is a new page, and the script gives each its own browser launch. */
export const BROWSER_EMULATOR_PHASES = ['pair', 'reconnect', 'messages', 'eoa', 'tokens', 'forget'] as const;
export type BrowserEmulatorPhase = (typeof BROWSER_EMULATOR_PHASES)[number];

const HARDENED = 0x80000000;
const parsePath = (text: string): number[] =>
  text
    .split('/')
    .slice(1)
    .map((p) => (p.endsWith("'") ? (Number(p.slice(0, -1)) | HARDENED) >>> 0 : Number(p)));

const decodeBase64 = (text: string): Uint8Array => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

export async function runBrowserEmulator(
  api: Api,
  webusb: WebUsb,
  data: BrowserEmulatorData,
  phase: BrowserEmulatorPhase,
  /** Resolves when a person has clicked (the stand-in refuses a device request outside a click). */
  waitForClick: () => Promise<void>,
): Promise<CaseResult[]> {
  const results: CaseResult[] = [];
  const group = `browser emulator (${phase})`;
  const step = async (name: string, run: (t: ReturnType<typeof newCheck>['check']) => Promise<void>): Promise<void> => {
    const { check, failures, count } = newCheck();
    try {
      await run(check);
    } catch (error) {
      failures.push({ label: `${name}: the step itself threw`, expected: 'no exception', actual: String((error as Error)?.stack ?? error) });
    }
    results.push({ group, name, checks: count(), failures });
    console.log(`${failures.length === 0 ? 'done' : 'FAILED'}: ${name}`);
  };

  // ---- what the run is checked against ----
  const corpus = data.hd.derivations.find((d) => d.name === 'bip39-abandon-about/no-passphrase/depth4/account-0');
  const signCase = data.fixture.cases.find((c) => c.name === 'transfer_shared_corpus');
  if (!corpus || !signCase) throw new Error('the shared vectors lack the corpus derivation or the transfer case');
  const path = parsePath(corpus.path);
  const hintedCases = data.fixture.cases.filter(
    (c) => c.outcome === 'signed' && c.token_hint_hex !== undefined && c.path === corpus.path,
  );
  const image = api.parseAppImage({
    tapp: decodeBase64(data.image.tapp),
    proof: decodeBase64(data.image.proof),
    rootPacket: decodeBase64(data.image.rootPacket),
  });
  const store = new webusb.IndexedDbCredentialStore({ databaseName: data.databaseName });
  const noCode = (why: string) => ({
    pairingCode: (): never => {
      throw new Error(`the host asked for a pairing code ${why}`);
    },
  });
  const options = (ui: { pairingCode(): string | Promise<string> }) => ({
    hostName: 'thru browser test',
    appName: 'thru',
    credentialStore: store,
    ui,
  });

  if (phase === 'pair') {
    await step('IndexedDB starts empty, and WebUSB is there', async (t) => {
      t.eq('the credentials in IndexedDB', 0, (await store.load()).length);
      t.ok('the page has navigator.usb (the stand-in)', webusb.isWebUsbSupported());
      const early = await t.rejects('a device request before any click', webusb.requestWebUsbTransport());
      t.eq('refused as access_denied, as Chromium does', 'access_denied', (early as { kind?: string })?.kind);
    });

    await step('the picker, from a click: the device is claimed on interface 0', async (t) => {
      await waitForClick();
      const transport = await webusb.requestWebUsbTransport();
      t.ok('a WebUsbTransport', transport instanceof webusb.WebUsbTransport);
      t.ok('it is not the emulator transport (pairing cannot be skipped)', (transport as { isEmulator?: boolean }).isEmulator !== true);
      await transport.close();
      // A page that has been granted the device reopens it with no click.
      const again = await webusb.reopenWebUsbTransport();
      await again.close();
    });

    await step('pairing by code: a wrong code is refused and nothing is stored', async (t) => {
      await data.bindings.clearShownCode();
      let typed = '';
      const error = await t.rejects(
        'connecting with the wrong code',
        (async () => {
          const transport = await webusb.reopenWebUsbTransport();
          return api.TrezorClient.connect(
            transport,
            options({
              pairingCode: async () => {
                const shown = await data.bindings.shownCode();
                typed = [...shown].map((d) => String((Number(d) + 1) % 10)).join('');
                return typed;
              },
            }),
          );
        })(),
      );
      t.ok('a pairing error', error instanceof api.TrezorPairingError, String(error));
      t.eq('the reason', 'wrong_code', (error as { reason?: string })?.reason);
      t.eq('the credentials in IndexedDB', 0, (await store.load()).length);
    });

    await step('pairing by code: the right code pairs, the credential lands in IndexedDB, the app is uploaded, the transfer is signed', async (t) => {
      await data.bindings.clearShownCode();
      const transport = await webusb.reopenWebUsbTransport();
      const client = await api.TrezorClient.connect(
        transport,
        options({ pairingCode: () => data.bindings.shownCode() }),
      );
      try {
        const stored = await store.load();
        t.eq('credentials in IndexedDB', 1, stored.length);
        t.eq('a device key of 32 bytes', 32, stored[0]?.trezorStaticPubkey.length);
        t.eq('a host key of 32 bytes', 32, stored[0]?.hostStaticPrivkey.length);
        t.ok('a credential of 1 to 126 bytes', stored[0]?.credential.length >= 1 && stored[0]?.credential.length <= 126);
        const { app, uploaded } = await api.ThruApp.load(client, image);
        t.eq('the app was uploaded', true, uploaded);
        const key = await app.getPublicKey(path, { showOnDevice: false });
        t.eq("public key of m/44'/8478'/0'/0'", corpus.pubkey_hex, api.toHex(key.publicKey));
        t.eq('address', corpus.address, key.address);
        const signature = await app.signTransaction(path, api.fromHex(signCase.body_hex));
        t.eq('signature of transfer_shared_corpus', signCase.signature_hex, api.toHex(signature));
      } finally {
        await client.close();
      }
    });
    return results;
  }

  // ---- the later page loads: the credential comes from IndexedDB ----

  const reopened = async (): Promise<Awaited<ReturnType<Api['TrezorClient']['connect']>>> => {
    const transport = await webusb.reopenWebUsbTransport();
    return api.TrezorClient.connect(transport, options(noCode('(a stored credential must pair)')));
  };
  const withSigner = async (
    run: (signer: InstanceType<Api['ThruTrezorSigner']>, t: ReturnType<typeof newCheck>['check']) => Promise<void>,
    t: ReturnType<typeof newCheck>['check'],
  ): Promise<void> => {
    const client = await reopened();
    try {
      const { app, uploaded } = await api.ThruApp.load(client, image);
      t.eq('the app was already on the device', false, uploaded);
      await run(new api.ThruTrezorSigner({ app, transactionSigningScheme: 'rfc8032' as never }), t);
    } finally {
      await client.close();
    }
  };

  if (phase === 'reconnect') await step('a new page: the credential is in IndexedDB, the device reopens with no click, no code is asked', async (t) => {
    t.eq('the credentials in IndexedDB', 1, (await store.load()).length);
    const client = await reopened();
    try {
      t.eq('the handshake sent the stored credential', true, client.channel.credentialMatched);
      t.ok('the device reports this host as paired', ['paired', 'paired_autoconnect'].includes(client.channel.pairingState), client.channel.pairingState);
      const { app, uploaded } = await api.ThruApp.load(client, image);
      t.eq('the app is not uploaded again', false, uploaded);
      const signature = await app.signTransaction(path, api.fromHex(signCase.body_hex));
      t.eq('signature of the native transfer, transfer_shared_corpus', signCase.signature_hex, api.toHex(signature));
    } finally {
      await client.close();
    }
  });

  if (phase === 'reconnect') await step('connectTrezor in one call: the address and the key of the corpus, the screen confirmed', async (t) => {
    const transport = await webusb.reopenWebUsbTransport();
    const signer = await api.connectTrezor({
      transport,
      credentialStore: store,
      image,
      hostName: 'thru browser test',
      appName: 'thru',
      ui: noCode('(a stored credential must pair)'),
      transactionSigningScheme: 'rfc8032' as never,
    });
    try {
      const out = await signer.getAddress(corpus.path, { display: true });
      t.eq('public key', corpus.pubkey_hex, api.toHex(out.publicKey));
      t.eq('address', corpus.address, out.address);
      const silent = await signer.getAddress(corpus.path);
      t.eq('the same key without a screen', corpus.address, silent.address);
      const wrong = await t.rejects("a key that is not the device's", signer.getAddress(corpus.path, { expectedPublicKey: new Uint8Array(32) }));
      t.eq('refused as key_mismatch', 'key_mismatch', (wrong as { code?: string })?.code);
    } finally {
      await signer.close();
    }
    t.eq('a call after close is refused as closed', 'closed', ((await t.rejects('after close', signer.getAddress(corpus.path))) as { code?: string })?.code);
  });

  if (phase === 'messages') await step('a text message is signed on the device, with the corpus signatures', async (t) => {
    await withSigner(async (signer) => {
      for (const name of ['ledger_msg_hello', 'ascii_with_newline']) {
        const vector = data.messages.find((v) => v.name === name);
        if (!vector) throw new Error(`no message vector ${name}`);
        const out = await signer.signMessage(vector.signer_path, api.fromHex(vector.message_hex));
        t.eq(`${name}: the corpus signature`, vector.signature_hex, api.toHex(out.signature));
        t.eq(`${name}: the key`, vector.signer_pubkey_hex, api.toHex(out.publicKey));
      }
      const refused = await t.rejects('a message that is not text', signer.signMessage(corpus.path, new TextEncoder().encode('two  spaces')));
      t.eq('the host refuses it as invalid_request', 'invalid_request', (refused as { code?: string })?.code);
    }, t);
  });

  if (phase === 'eoa') await step('EOA authorizations (create and delete) are signed on the device, with the corpus signatures', async (t) => {
    await withSigner(async (signer) => {
      for (const name of ['ledger_eoa_create_chain_1', 'delete_chain_1']) {
        const vector = data.eoa.find((v) => v.name === name);
        if (!vector) throw new Error(`no EOA vector ${name}`);
        const out = await signer.signEoaAuth(vector.signer_path, vector.kind as 'create' | 'delete', vector.chain_id, api.fromHex(vector.fee_payer_hex), api.fromHex(vector.account_hex));
        t.eq(`${name}: the corpus signature`, vector.signature_hex, api.toHex(out.signature));
      }
      const other = data.eoa.find((v) => v.name === 'device_create_other_account');
      if (!other) throw new Error('no EOA vector device_create_other_account');
      const error = await t.rejects(
        'an authorization for another account',
        signer.signEoaAuth(other.signer_path, other.kind as 'create' | 'delete', other.chain_id, api.fromHex(other.fee_payer_hex), api.fromHex(other.account_hex)),
      );
      t.eq('the host refuses it as invalid_request', 'invalid_request', (error as { code?: string })?.code);
    }, t);
  });

  if (phase === 'tokens') await step('token transfers with their hints are signed on the device, with the fixture signatures', async (t) => {
    t.ok('the fixture has hinted token transfers for account 0', hintedCases.length >= 2, String(hintedCases.length));
    await withSigner(async (signer) => {
      for (const c of hintedCases.slice(0, 2)) {
        const out = await signer.signTransactionBody(c.path, api.fromHex(c.body_hex), { tokenHint: api.fromHex(c.token_hint_hex as string) });
        t.eq(`${c.name}: the fixture signature`, c.signature_hex, api.toHex(out.signature));
        t.eq(`${c.name}: the hash the device shows`, c.review?.tx_hash, out.bodyHash);
        const review = api.transactionReview(api.fromHex(c.body_hex), out.publicKey, c.path, api.fromHex(c.token_hint_hex as string));
        t.eq(`${c.name}: the preview is a token transfer`, 'token_transfer', review?.kind);
      }
    }, t);
  });

  if (phase === 'forget') await step('forget: the credential is gone from IndexedDB and the next connection asks for a code', async (t) => {
    await store.forget();
    t.eq('the credentials in IndexedDB', 0, (await store.load()).length);
    let asked = false;
    const transport = await webusb.reopenWebUsbTransport();
    const error = await t.rejects(
      'connecting after forget',
      api.TrezorClient.connect(transport, {
        ...options({
          pairingCode: () => {
            asked = true;
            throw new Error('stop: the code was asked for');
          },
        }),
      }),
    );
    t.eq('the host asked for a pairing code', true, asked);
    t.ok('and the connection failed', error !== undefined);
  });
  return results;
}
