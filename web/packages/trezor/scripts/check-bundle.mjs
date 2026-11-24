// Fails if a browser build in dist/ still reaches for Node: an import or
// require of `crypto`, `buffer`, `node:*` or any other bare specifier that is
// not one of the package's declared dependencies listed below, or a free
// global that exists only in Node (`Buffer`, `process`, `global`,
// `__dirname`, `require` in an ES module, ...). Run by `pnpm build`.
//
// `emulator.*` and `node-usb.*` are the Node-only entries (the emulator's UDP
// transport, the optional native `usb` package, the credential file): they may
// import `node:` built-ins and nothing else (`node-usb` loads `usb` with a
// dynamic import whose specifier is a variable, which is no import to the
// bundler), and no other file may import them or contain their code.
//
// `webusb.*` is the browser's USB entry (the WebUSB transport, the IndexedDB
// credential store): it imports nothing, may use `navigator` and `indexedDB`,
// and holds no driver, signer, shim or Node-only code.
//
// `protocol.*` is the entry a wallet frame imports: it may import the Ledger
// package's protocol layer and nothing else, and must hold nothing of the
// link, the client, the signer, a transport or the credential file.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';
import { Linter } from 'eslint';

// An optional argument names another directory (the check's own test).
const dist = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const all = readdirSync(dist).filter((f) => /\.(js|cjs)$/.test(f));
if (all.length === 0) throw new Error(`no build output in ${dist}`);
const isNodeEntry = (f) => /^(?:emulator|node-usb)\.c?js$/.test(f);
const files = all.filter((f) => !isNodeEntry(f));
const nodeFiles = all.filter(isNodeEntry);

// Globals a page has and the bundle may use (ES built-ins come with the
// language level).
const BROWSER_GLOBALS = {
  crypto: 'readonly',
  TextEncoder: 'readonly',
  TextDecoder: 'readonly',
  console: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  AbortSignal: 'readonly',
};
// Globals only the browser's USB entry reads, each behind a `typeof` guard or
// a feature check: WebUSB and IndexedDB exist in a page and nowhere else.
const ENTRY_GLOBALS = {
  webusb: { navigator: 'readonly', indexedDB: 'readonly' },
};

// The bare specifiers an entry may import: the package's own dependencies.
const ALLOWED_IMPORTS = {
  index: ['@thru/ledger/protocol', '@thru/sdk', '@thru/sdk/proto'],
  protocol: ['@thru/ledger/protocol'],
  webusb: [],
};
const entryOf = (file) => file.replace(/\.c?js$/, '');
const allowedFor = (file) => ALLOWED_IMPORTS[entryOf(file)] ?? [];

// What no browser entry may hold: the Node-only credential file.
const NODE_ONLY_CODE =
  /FileCredentialStore|CredentialFileError|credentials-file|NODE_USB_PACKAGE|createNodeUsb|openNodeUsbTransport/;
// What the device-free entries (`protocol`, `webusb`) may not hold: the
// driver, the signer, the UDP transport, the shims.
const DRIVER_CODE = /\bclass (?:Link|TrezorClient|ThruTrezorSigner|UdpTransport|PacketReader)\b|node-shims|ThpState/;
const DEVICE_FREE = ['protocol', 'webusb'];

const linter = new Linter({ configType: 'flat' });
const problems = [];

for (const file of files) {
  const path = join(dist, file);
  const code = readFileSync(path, 'utf8');
  const isCjs = file.endsWith('.cjs');

  // 1. Every import and require the output makes. The bundle is expected to
  // make none: all of it is inside.
  const result = await build({
    entryPoints: [path],
    bundle: false,
    write: false,
    metafile: true,
    logLevel: 'silent',
    format: isCjs ? 'cjs' : 'esm',
  });
  for (const output of Object.values(result.metafile.outputs)) {
    for (const imp of output.imports) {
      if (!allowedFor(file).includes(imp.path)) problems.push(`${file}: ${imp.kind} of "${imp.path}"`);
    }
  }
  for (const match of code.matchAll(/\b(?:require|import)\s*\(\s*([^)]*)\)/g)) {
    const specifier = /^\s*["']([^"']*)["']\s*$/.exec(match[1])?.[1];
    if (specifier === undefined || !allowedFor(file).includes(specifier)) problems.push(`${file}: call ${match[0]}`);
  }
  if (NODE_ONLY_CODE.test(code)) problems.push(`${file}: holds the Node-only credential file`);
  if (DEVICE_FREE.includes(entryOf(file)) && DRIVER_CODE.test(code)) {
    problems.push(`${file}: holds the driver, the signer or the UDP transport`);
  }
  if (entryOf(file) !== 'webusb' && /\bclass (?:WebUsbTransport|IndexedDbCredentialStore)\b/.test(code)) {
    problems.push(`${file}: holds the browser's USB code`);
  }
  if (/\bfrom\s*["'](?:node:|crypto["']|buffer["'])/.test(code)) {
    problems.push(`${file}: import from a Node built-in`);
  }

  // 2. Free globals that a page does not have.
  const messages = linter.verify(
    code,
    [
      {
        files: ['**/*.js', '**/*.cjs'],
        languageOptions: {
          ecmaVersion: 2022,
          sourceType: isCjs ? 'commonjs' : 'module',
          globals: { ...BROWSER_GLOBALS, ...(ENTRY_GLOBALS[entryOf(file)] ?? {}) },
        },
        rules: { 'no-undef': 'error' },
      },
    ],
    { filename: file },
  );
  for (const m of messages) {
    problems.push(`${file}:${m.line}:${m.column}: ${m.message}`);
  }
  if (/(?:emulator|node-usb)\.c?js/.test(code)) problems.push(`${file}: reaches a Node-only entry`);
}

// The Node-only entry: only `node:` built-ins may be imported.
for (const file of nodeFiles) {
  const path = join(dist, file);
  const result = await build({
    entryPoints: [path],
    bundle: false,
    write: false,
    metafile: true,
    logLevel: 'silent',
    format: file.endsWith('.cjs') ? 'cjs' : 'esm',
    platform: 'node',
  });
  for (const output of Object.values(result.metafile.outputs)) {
    for (const imp of output.imports) {
      // esbuild reports `node:dgram` as `dgram`.
      if (!builtinModules.includes(imp.path.replace(/^node:/, ''))) {
        problems.push(`${file}: ${imp.kind} of "${imp.path}"`);
      }
    }
  }
  // The one thing `node-usb` loads that is not a built-in: the optional
  // native package, by a dynamic import of a variable that holds its name.
  if (/^node-usb\./.test(file)) {
    const code = readFileSync(path, 'utf8');
    const loads = [...code.matchAll(/\bimport\s*\(\s*([^)]*)\)|\brequire\s*\(\s*([^)]*)\)/g)].map((m) => (m[1] ?? m[2]).trim());
    const literal = loads.filter((l) => /^["']/.test(l) && !builtinModules.includes(l.slice(1, -1).replace(/^node:/, '')));
    if (literal.length > 0) problems.push(`${file}: loads ${literal.join(', ')} by name; it must load only the optional package, by a variable`);
    if (!/NODE_USB_PACKAGE\s*=\s*["']usb["']/.test(code)) problems.push(`${file}: does not name the optional package "usb"`);
  }
}

if (problems.length > 0) {
  console.error('browser bundle check failed:');
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
const sizes = [...files, ...nodeFiles]
  .filter((f) => f.endsWith('.js'))
  .map((f) => `${f} ${(statSync(join(dist, f)).size / 1024).toFixed(1)} KB`)
  .join(', ');
console.log(
  `browser bundle check: ${files.length} files, no Node built-in, no Node-only global, no import but the declared dependencies; ${nodeFiles.length} Node-only files import only node: built-ins (sizes: ${sizes})`,
);
