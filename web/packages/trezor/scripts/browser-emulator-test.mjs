// The emulator scenarios of scripts/emulator-test.mjs in headless Chrome, through
// the real WebUSB transport and the real IndexedDB store of the BUILT browser
// bundles (dist/index.js, dist/webusb.js), plan B9. Run by
// `trezor/scripts/test-web-host.sh --browser` (`pnpm test:emulator:browser`),
// which starts the emulator and the debug-link helper that answers its screens
// and writes the pairing code it shows to --code-file.
//
// How packets travel: the page has a stand-in for `navigator.usb` that forwards
// each 64-byte packet through a Playwright binding to this script, which sends
// it as one UDP datagram to the emulator (scripts/lib/usb-stand-in.mjs, shared
// with the wallet's popup specs, which also describes what the stand-in keeps of
// Chrome's behaviour). Everything on the page side of that line is production
// code: the transport, the driver, the signer, the credential store.
//
// Six page loads, each in its own browser launch with the storage of the last:
// `pair` (empty IndexedDB, a click for the picker, wrong code, right code, app
// upload), `reconnect` (the credential comes from IndexedDB, no code, no upload),
// `messages`, `eoa`, `tokens` (the signer's requests) and `forget`.
//
//   node scripts/browser-emulator-test.mjs --address 127.0.0.1:21324 --image <.tapp> \
//     --code-file <file> --work <directory>
//
// Exits non-zero on any mismatch. Needs `pnpm build` first and Google Chrome (or
// Chromium; CHROME_PATH names an executable); nothing is downloaded.
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';
import { chromium } from 'playwright-core';

import { createUsbStandIn } from './lib/usb-stand-in.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const repo = resolve(root, '../../..');

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
const standIn = createUsbStandIn({ address, codeFile });

// ---- what the page gets ----

const bundle = async (entry) =>
  (
    await build({
      entryPoints: [join(root, entry)],
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'browser',
      target: 'es2020',
      logLevel: 'silent',
    })
  ).outputFiles[0].text;
const indexBundle = await bundle('dist/index.js');
const webusbBundle = await bundle('dist/webusb.js');
const scenarioBundle = await bundle('src/__tests__/browser-emulator.ts');

const readJson = (relative) => JSON.parse(readFileSync(join(repo, relative), 'utf8'));
const base64 = (file) => readFileSync(file).toString('base64');
// The image: three files, the root packet two directories above the .tapp's own
// (the name of the root packet comes from the app's header, which the bundle reads).
const { readAppHeader, rootPacketFileName } = await import(join(root, 'dist/index.js'));
const header = readAppHeader(new Uint8Array(readFileSync(imagePath)));
const rootPacketPath = join(dirname(imagePath), '../../root-packets', rootPacketFileName(header.appRing));
const databaseName = `thru-trezor-browser-test-${process.pid}-${Date.now()}`;
const data = JSON.stringify({
  fixture: readJson('trezor/app-thru/tests/fixtures/sign_tx.json'),
  en: readJson('trezor/app-thru/translations/en.json'),
  hd: readJson('contrib/test/vectors/signing/hd_vectors.json'),
  messages: readJson('contrib/test/vectors/signing/message_vectors.json'),
  eoa: readJson('contrib/test/vectors/signing/eoa_auth_vectors.json'),
  image: { tapp: base64(imagePath), proof: base64(imagePath.replace(/\.tapp$/, '.proof')), rootPacket: base64(rootPacketPath) },
});

const PAGE = `<!doctype html><meta charset="utf-8"><title>thru trezor browser test</title>
<button id="go">Connect</button>
<script type="module">
  const params = new URLSearchParams(location.search);
  const phase = params.get('phase');
  let clickResolve;
  const clicked = new Promise((r) => { clickResolve = r; });
  document.getElementById('go').addEventListener('click', () => clickResolve());
  try {
    const api = await import('/bundle/index.js');
    const webusb = await import('/bundle/webusb.js');
    const { runBrowserEmulator } = await import('/scenario.js');
    const data = await (await fetch('/data.json')).json();
    data.databaseName = params.get('db');
    data.bindings = { shownCode: () => window.__emuShownCode(), clearShownCode: () => window.__emuClearShownCode() };
    const results = await runBrowserEmulator(api, webusb, data, phase, () => { window.__waitingForClick = true; return clicked; });
    window.__result = { phase, userAgent: navigator.userAgent, results };
  } catch (e) {
    window.__result = { error: String((e && e.stack) || e) };
  }
</script>`;

// ---- the server and the browser ----

const routes = {
  '/': ['text/html', () => PAGE],
  '/favicon.ico': ['image/x-icon', () => ''],
  '/bundle/index.js': ['text/javascript', () => indexBundle],
  '/bundle/webusb.js': ['text/javascript', () => webusbBundle],
  '/scenario.js': ['text/javascript', () => scenarioBundle],
  '/data.json': ['application/json', () => data],
};
const server = createServer((req, res) => {
  const route = routes[(req.url ?? '').split('?')[0]];
  if (!route) {
    res.writeHead(404).end();
    return;
  }
  const body = route[1]();
  res.writeHead(body.length === 0 ? 204 : 200, { 'content-type': route[0] }).end(body);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const { port } = server.address();

// Each page load gets its own browser launch, with the storage of the one
// before it (IndexedDB and localStorage, through Playwright's storage state):
// what the first writes is read by the next from a new browser, as after a
// restart. A launch is also kept short, and never reuses a profile directory:
// the Chrome of a machine that is enrolled in cloud management can exit by
// itself some 30 s after it starts (seen here with a bare
// `Google Chrome --headless=new`), and a second start on a profile that has run
// for a few seconds waits for its first window until that happens. A run that
// needs one browser, or one profile, for longer cannot finish there.
async function launch() {
  if (process.env.CHROME_PATH) return chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true });
  try {
    return await chromium.launch({ headless: true });
  } catch {
    return chromium.launch({ channel: 'chrome', headless: true });
  }
}

const PHASES = ['pair', 'reconnect', 'messages', 'eoa', 'tokens', 'forget'];
// What the browser keeps between page loads: it holds the pairing credential (a host private key), so
// it stays in memory and is never written to a file or a log.
let storageState;
let failed = false;
let checksRun = 0;
const started = Date.now();
try {
  for (const phase of PHASES) {
    const phaseStarted = Date.now();
    const browser = await launch();
    const context = await browser.newContext(storageState ? { storageState } : {});
    let closedEarly = false;
    browser.on('disconnected', () => {
      closedEarly = true;
    });
    try {
      await standIn.install(context);
      const page = await context.newPage();
      const problems = [];
      page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
      page.on('console', (m) => {
        if (m.type() === 'error') problems.push(`console.error: ${m.text()}`);
      });
      await page.goto(`http://127.0.0.1:${port}/?phase=${phase}&db=${databaseName}`);
      if (phase === 'pair') {
        // The click the picker needs: the scenario says when it is waiting for it.
        await page.waitForFunction(() => window.__waitingForClick === true, null, { timeout: 60_000 });
        await page.click('#go');
      }
      let result;
      try {
        await page.waitForFunction(() => window.__result !== undefined, null, { timeout: 240_000 });
        result = await page.evaluate(() => window.__result);
      } catch (error) {
        if (!closedEarly) throw error;
        console.error(`the browser exited by itself during the ${phase} page load, ${((Date.now() - phaseStarted) / 1000).toFixed(1)} s after it started`);
        failed = true;
        continue;
      }
      if (result.error) {
        console.error(`the page failed: ${result.error}`);
        failed = true;
      } else {
        if (phase === 'pair') console.log(`browser: ${result.userAgent}`);
        console.log(`== page load: ${phase}`);
        for (const c of result.results) {
          checksRun += c.checks;
          const ok = c.failures.length === 0 && c.checks > 0;
          console.log(`${ok ? 'ok  ' : 'FAIL'} ${c.name} (${c.checks} checks)`);
          for (const f of c.failures) console.error(`     ${f.label}\n       expected ${f.expected}\n       actual   ${f.actual}`);
          if (!ok) failed = true;
        }
      }
      for (const p of problems) {
        console.error(p);
        failed = true;
      }
      console.log(`   (${((Date.now() - phaseStarted) / 1000).toFixed(1)} s)`);
      storageState = await context.storageState({ indexedDB: true });
    } finally {
      await browser.close().catch(() => undefined);
    }
  }

  const device = standIn.counters;
  console.log(
    `emulator end: ${device.opened} devices opened and ${device.closed} closed, ${device.writes} packets written, ${device.reads} reads, ${device.unread} datagrams handed back`,
  );
  if (device.opened !== device.closed || standIn.isOpen) {
    console.error('a device was left open');
    failed = true;
  }
} finally {
  server.close();
}
console.log(failed ? 'FAILED' : `PASSED (${checksRun} checks in ${((Date.now() - started) / 1000).toFixed(1)} s)`);
process.exit(failed ? 1 : 0);
