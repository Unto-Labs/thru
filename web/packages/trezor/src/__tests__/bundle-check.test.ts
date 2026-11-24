/**
 * The build check (`scripts/check-bundle.mjs`) must notice what it guards: the
 * device-free entry (`protocol`) importing more than the Ledger package's
 * protocol layer or holding the driver, a browser entry importing a Node
 * built-in or the SDK where it may not, and the Node-only credential file
 * reaching a browser entry. Each case writes a copy of `dist/` with one change
 * and runs the check on it.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import { distFile } from './helpers/bundle';

const root = fileURLToPath(new URL('../..', import.meta.url));
const script = join(root, 'scripts/check-bundle.mjs');
const dirs: string[] = [];

/** Copies `dist/`, applies `change` to the named file, and returns the check's output (or its failure). */
function check(file: string | undefined, change?: (code: string) => string): { ok: boolean; output: string } {
  const dir = mkdtempSync(join(tmpdir(), 'thru-trezor-bundle-'));
  dirs.push(dir);
  for (const name of readdirSync(join(root, 'dist'))) {
    if (/\.(js|cjs)$/.test(name)) cpSync(join(root, 'dist', name), join(dir, name));
  }
  if (file !== undefined && change !== undefined) {
    writeFileSync(join(dir, file), change(readFileSync(join(dir, file), 'utf8')));
  }
  try {
    return { ok: true, output: execFileSync('node', [script, dir], { encoding: 'utf8', stdio: 'pipe' }) };
  } catch (error) {
    const e = error as { stderr?: string; stdout?: string };
    return { ok: false, output: `${e.stderr ?? ''}${e.stdout ?? ''}` };
  }
}

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe('the bundle check', () => {
  it('passes on the build', () => {
    const result = check(undefined);
    expect(result.output).toMatch(/browser bundle check: 6 files[\s\S]*4 Node-only files/);
    expect(result.ok).toBe(true);
  });

  it('refuses a Node built-in in a browser entry', () => {
    for (const [file, line] of [
      ['index.js', "import * as zzCrypto from 'node:crypto';\nvoid zzCrypto;\n"],
      ['protocol.js', "import * as zzFs from 'node:fs';\nvoid zzFs;\n"],
      ['index.cjs', "const zzFs = require('fs');\nvoid zzFs;\n"],
    ] as const) {
      const result = check(file, (code) => line + code);
      expect(result.ok, file).toBe(false);
      expect(result.output, file).toMatch(/browser bundle check failed[\s\S]*(node:crypto|node:fs|"fs")/);
    }
  });

  it('keeps the device-free entry to the Ledger protocol layer', () => {
    const sdk = check('protocol.js', (code) => `import * as zzSdk from '@thru/sdk';\nvoid zzSdk;\n${code}`);
    expect(sdk.ok).toBe(false);
    expect(sdk.output).toMatch(/protocol\.js: .*@thru\/sdk/);
    const required = check('protocol.cjs', (code) => `const sdk = require('@thru/sdk');\nvoid sdk;\n${code}`);
    expect(required.ok).toBe(false);
    expect(required.output).toMatch(/protocol\.cjs: call require\(/);
    // The entry the wallet frame imports may hold none of the driver, the signer or a transport.
    for (const holder of ['class Link {}', 'class TrezorClient {}', 'class ThruTrezorSigner {}', 'class UdpTransport {}']) {
      const result = check('protocol.js', (code) => `${code}\n${holder}\n`);
      expect(result.ok, holder).toBe(false);
      expect(result.output, holder).toMatch(/holds the driver, the signer or the UDP transport/);
    }
  });

  describe.each(['index.js', 'index.cjs', 'protocol.js', 'protocol.cjs', 'webusb.js', 'webusb.cjs'])('%s', (file) => {
    it.each(['FileCredentialStore', 'CredentialFileError', 'createNodeUsb', 'NODE_USB_PACKAGE'])(
      'keeps the Node-only credential marker %s out of the browser entry',
      (text) => {
        const result = check(file, (code) => `${code}\nconst x = '${text}';\n`);
        expect(result.ok, `${file} ${text}`).toBe(false);
        expect(result.output, `${file} ${text}`).toMatch(/holds the Node-only credential file/);
      },
    );
  });

  it('lets the full entry import the SDK and the Ledger protocol layer, and nothing else', () => {
    const other = check('index.js', (code) => `import * as zzPad from 'left-pad';\nvoid zzPad;\n${code}`);
    expect(other.ok).toBe(false);
    expect(other.output).toMatch(/left-pad/);
  });

  it('keeps the Node-only entry to node: built-ins', () => {
    const result = check('emulator.js', (code) => `import * as zzSdk from '@thru/sdk';\nvoid zzSdk;\n${code}`);
    expect(result.ok).toBe(false);
    expect(result.output).toMatch(/emulator\.js: .*@thru\/sdk/);
  });

  it('keeps the browser\'s USB entry free of imports, the driver and Node', () => {
    const imported = check('webusb.js', (code) => `import * as zzSdk from '@thru/sdk';\nvoid zzSdk;\n${code}`);
    expect(imported.ok).toBe(false);
    expect(imported.output).toMatch(/webusb\.js: .*@thru\/sdk/);
    const builtin = check('webusb.cjs', (code) => `const zzFs = require('node:fs');\nvoid zzFs;\n${code}`);
    expect(builtin.ok).toBe(false);
    expect(builtin.output).toMatch(/webusb\.cjs/);
    for (const holder of ['class Link {}', 'class TrezorClient {}', 'class UdpTransport {}']) {
      const result = check('webusb.js', (code) => `${code}\n${holder}\n`);
      expect(result.ok, holder).toBe(false);
      expect(result.output, holder).toMatch(/holds the driver/);
    }
    const global = check('webusb.js', (code) => `${code}\nvoid process.pid;\n`);
    expect(global.ok).toBe(false);
    expect(global.output).toMatch(/webusb\.js:\d+:\d+: 'process' is not defined/);
  });

  it('exports no load of the app that skips the check of the model, and no option that skips it', async () => {
    const dist = distFile('');
    const entries = ['index', 'protocol', 'emulator', 'webusb', 'node-usb'];
    // The built code has neither the option nor a function that loads without the check.
    for (const name of readdirSync(dist).filter((f) => /\.(js|cjs)$/.test(f))) {
      const code = readFileSync(join(dist, name), 'utf8');
      expect(code, name).not.toMatch(/skipModelCheck|loadAppWithoutModelCheck/);
    }
    // And no entry the package declares exports one under any name.
    const declared = Object.keys((JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { exports: Record<string, unknown> }).exports);
    expect(declared.sort()).toEqual(['.', './emulator', './node-usb', './protocol', './webusb']);
    for (const entry of entries) {
      const module = (await import(/* @vite-ignore */ pathToFileURL(join(dist, `${entry}.js`)).href)) as Record<string, unknown>;
      for (const name of Object.keys(module)) expect(name, `${entry}: ${name}`).not.toMatch(/model.?check|without.?model/i);
    }
  });

  it('keeps the browser\'s USB code out of the other entries', () => {
    for (const file of ['index.js', 'protocol.cjs']) {
      const result = check(file, (code) => `${code}\nclass WebUsbTransport {}\n`);
      expect(result.ok, file).toBe(false);
      expect(result.output, file).toMatch(/holds the browser's USB code/);
    }
  });

  it('keeps the Node USB entry to node: built-ins and a dynamic load of the optional package', () => {
    for (const file of ['node-usb.js', 'node-usb.cjs']) {
      const imported = check(file, (code) => `${code}\nconst zzLoad = () => import('left-pad');\nvoid zzLoad;\n`);
      expect(imported.ok, file).toBe(false);
      expect(imported.output, file).toMatch(/node-usb\.c?js: .*left-pad/);
      const renamed = check(file, (code) => code.replace(/NODE_USB_PACKAGE\s*=\s*["']usb["']/, 'NODE_USB_PACKAGE = "other"'));
      expect(renamed.ok, file).toBe(false);
      expect(renamed.output, file).toMatch(/does not name the optional package "usb"/);
    }
    // Neither a browser entry nor another Node entry may reach it.
    for (const file of ['index.js', 'webusb.cjs']) {
      const result = check(file, (code) => `${code}\nconst zzPath = './node-usb.js';\n`);
      expect(result.ok, file).toBe(false);
      expect(result.output, file).toMatch(/reaches a Node-only entry/);
    }
  });
});
