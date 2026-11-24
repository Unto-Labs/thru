// Runs the vector checks (src/__tests__/vector-checks.ts), the driver checks
// (src/__tests__/driver-checks.ts: the connection driver on a scripted
// transport, the recorded conversations byte for byte, the faults and the
// guards) and the signer checks (src/__tests__/signer-checks.ts: path policy,
// errors, the preview tied to the app's fixture and texts, the signer on a
// fake app) in headless Chromium against the built browser bundle
// (dist/index.js), served to a bare page: no Node globals. The USB checks
// (src/__tests__/usb-checks.ts: the transport contract of plan B11 over fake
// USB devices, the device filter, the typed errors) and the IndexedDB checks
// (idb-checks.ts: the credential store on Chromium's real IndexedDB) run
// against the built browser USB entry (dist/webusb.js). The bundle imports
// the package's declared dependencies (`@thru/ledger/protocol`, `@thru/sdk`);
// esbuild resolves them into one module in memory, as an application's
// bundler would. Needs `pnpm build` first (`pnpm test:browser` does it) and a
// Chrome or Chromium: Playwright's own, or the installed Google Chrome
// (channel "chrome"), or the executable named by CHROME_PATH. Nothing is
// downloaded.
//
// THRU_TREZOR_BUNDLE=/path/to/module.js runs the checks against another ES
// module with the same exports instead of dist/index.js, e.g. the package
// as another bundler (webpack, Next.js) wrote it into an application.
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const vectorsPath = join(root, '../../../contrib/test/vectors/trezor/host_vectors.json');

const bundleChecks = (entry) =>
  build({
    entryPoints: [join(root, entry)],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2020',
    logLevel: 'silent',
  });
const checks = await bundleChecks('src/__tests__/vector-checks.ts');
const driverChecks = await bundleChecks('src/__tests__/driver-checks.ts');
const signerChecks = await bundleChecks('src/__tests__/signer-checks.ts');
const usbChecks = await bundleChecks('src/__tests__/usb-checks.ts');
const idbChecks = await bundleChecks('src/__tests__/idb-checks.ts');

// The package as a page gets it: dist/index.js with its dependencies resolved.
const bundleOfPackage = async () =>
  (
    await build({
      entryPoints: [join(root, 'dist/index.js')],
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'browser',
      target: 'es2020',
      logLevel: 'silent',
    })
  ).outputFiles[0].text;
const bundleOfEntry = async (entry) =>
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
const webusbBundle = await bundleOfEntry('dist/webusb.js');
const packageBundle = process.env.THRU_TREZOR_BUNDLE
  ? readFileSync(process.env.THRU_TREZOR_BUNDLE)
  : await bundleOfPackage();

// The app's files and the shared signing vectors, as the signer checks read them.
const readJson = (relative) => JSON.parse(readFileSync(join(root, '../../..', relative), 'utf8'));
const signingData = JSON.stringify({
  fixture: readJson('trezor/app-thru/tests/fixtures/sign_tx.json'),
  en: readJson('trezor/app-thru/translations/en.json'),
  hd: readJson('contrib/test/vectors/signing/hd_vectors.json'),
  messages: readJson('contrib/test/vectors/signing/message_vectors.json'),
  eoa: readJson('contrib/test/vectors/signing/eoa_auth_vectors.json'),
});

const PAGE = `<!doctype html><meta charset="utf-8"><title>vectors</title>
<script type="module">
  const globalsBefore = {
    Buffer: typeof Buffer, process: typeof process, require: typeof require, global: typeof global,
  };
  try {
    const api = await import('/bundle/index.js');
    const { runAllChecks } = await import('/checks.js');
    const { runAllDriverCases } = await import('/driver-checks.js');
    const { runAllSignerCases } = await import('/signer-checks.js');
    const webusb = await import('/bundle/webusb.js');
    const { runAllUsbCases } = await import('/usb-checks.js');
    const { runIdbCases } = await import('/idb-checks.js');
    const vectors = await (await fetch('/vectors.json')).json();
    const signingData = await (await fetch('/signing-data.json')).json();
    window.__result = {
      globalsBefore,
      globalsAfter: { Buffer: typeof Buffer, process: typeof process, require: typeof require, global: typeof global },
      userAgent: navigator.userAgent,
      reports: runAllChecks(api, vectors),
      driver: await runAllDriverCases(api, vectors),
      signer: await runAllSignerCases(api, signingData),
      usb: await runAllUsbCases(webusb, { name: 'webusb', open: (usb, options) => webusb.requestWebUsbTransport({ usb, ...options }) }),
      idb: await runIdbCases(webusb),
      hasIndexedDb: typeof indexedDB !== 'undefined',
    };
  } catch (e) {
    window.__result = { error: String(e && e.stack || e) };
  }
</script>`;

const routes = {
  '/': ['text/html', () => PAGE],
  '/favicon.ico': ['image/x-icon', () => ''],
  '/bundle/index.js': ['text/javascript', () => packageBundle],
  '/checks.js': ['text/javascript', () => checks.outputFiles[0].text],
  '/driver-checks.js': ['text/javascript', () => driverChecks.outputFiles[0].text],
  '/signer-checks.js': ['text/javascript', () => signerChecks.outputFiles[0].text],
  '/bundle/webusb.js': ['text/javascript', () => webusbBundle],
  '/usb-checks.js': ['text/javascript', () => usbChecks.outputFiles[0].text],
  '/idb-checks.js': ['text/javascript', () => idbChecks.outputFiles[0].text],
  '/signing-data.json': ['application/json', () => signingData],
  '/vectors.json': ['application/json', () => readFileSync(vectorsPath)],
};

const server = createServer((req, res) => {
  const route = routes[req.url ?? ''];
  if (!route) {
    res.writeHead(404).end();
    return;
  }
  const body = route[1]();
  res.writeHead(body.length === 0 ? 204 : 200, { 'content-type': route[0] }).end(body);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();

async function launch() {
  if (process.env.CHROME_PATH) {
    return chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true });
  }
  try {
    return await chromium.launch({ headless: true });
  } catch {
    return chromium.launch({ channel: 'chrome', headless: true });
  }
}

let failed = false;
const browser = await launch();
try {
  const page = await browser.newPage();
  const pageProblems = [];
  page.on('pageerror', (e) => pageProblems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') pageProblems.push(`console.error: ${m.text()}`);
  });
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => window.__result !== undefined, null, { timeout: 60_000 });
  const result = await page.evaluate(() => window.__result);

  if (result.error) {
    console.error(`the page failed: ${result.error}`);
    failed = true;
  } else {
    console.log(`browser: ${result.userAgent}`);
    console.log(
      `Node globals before loading the bundle: ${JSON.stringify(result.globalsBefore)}; after: ${JSON.stringify(result.globalsAfter)}`,
    );
    for (const [name, type] of Object.entries(result.globalsAfter)) {
      if (type !== 'undefined') {
        console.error(`the bundle left a global ${name} (${type}) in the page`);
        failed = true;
      }
    }
    for (const r of result.reports) {
      const status = r.failures.length === 0 ? 'ok  ' : 'FAIL';
      console.log(
        `${status} ${r.group.padEnd(13)} ${String(r.cases).padStart(5)} checks, ${r.failures.length} failed, ${r.deviations.length} pinned differences`,
      );
      for (const f of r.failures.slice(0, 20)) {
        console.error(`     ${f.label}\n       expected ${f.expected}\n       actual   ${f.actual}`);
      }
      if (r.failures.length > 0) failed = true;
    }
    const ids = [...new Set(result.reports.flatMap((r) => r.deviations.map((d) => d.id)))].sort();
    console.log(`pinned differences: ${ids.join(', ')}`);
    let driverChecksRun = 0;
    for (const c of result.driver) {
      driverChecksRun += c.checks;
      const status = c.failures.length === 0 && c.checks > 0 ? 'ok  ' : 'FAIL';
      console.log(`${status} ${c.group}: ${c.name} (${c.checks} checks)`);
      for (const f of c.failures.slice(0, 20)) {
        console.error(`     ${f.label}\n       expected ${f.expected}\n       actual   ${f.actual}`);
      }
      if (c.failures.length > 0 || c.checks === 0) failed = true;
    }
    console.log(`driver: ${result.driver.length} cases, ${driverChecksRun} checks`);
    let signerChecksRun = 0;
    for (const c of result.signer) {
      signerChecksRun += c.checks;
      const status = c.failures.length === 0 && c.checks > 0 ? 'ok  ' : 'FAIL';
      console.log(`${status} ${c.group}: ${c.name} (${c.checks} checks)`);
      for (const f of c.failures.slice(0, 20)) {
        console.error(`     ${f.label}\n       expected ${f.expected}\n       actual   ${f.actual}`);
      }
      if (c.failures.length > 0 || c.checks === 0) failed = true;
    }
    console.log(`signer: ${result.signer.length} cases, ${signerChecksRun} checks`);
    for (const [label, list] of [
      ['usb', result.usb],
      ['indexeddb', result.idb],
    ]) {
      let run = 0;
      for (const c of list) {
        run += c.checks;
        const status = c.failures.length === 0 && c.checks > 0 ? 'ok  ' : 'FAIL';
        console.log(`${status} ${c.group}: ${c.name} (${c.checks} checks)`);
        for (const f of c.failures.slice(0, 20)) {
          console.error(`     ${f.label}\n       expected ${f.expected}\n       actual   ${f.actual}`);
        }
        if (c.failures.length > 0 || c.checks === 0) failed = true;
      }
      console.log(`${label}: ${list.length} cases, ${run} checks`);
    }
    if (!result.hasIndexedDb || result.idb.length < 6) {
      console.error('Chromium has no IndexedDB, or the store cases did not run');
      failed = true;
    }
  }
  for (const p of pageProblems) {
    console.error(p);
    failed = true;
  }
} finally {
  await browser.close();
  server.close();
}
process.exit(failed ? 1 : 0);
