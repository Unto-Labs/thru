import { fileURLToPath } from 'node:url';

import { defineConfig, type Options } from 'tsup';

const shims = fileURLToPath(new URL('./src/thp/node-shims.ts', import.meta.url));
const bufferGlobal = fileURLToPath(new URL('./src/thp/buffer-global.ts', import.meta.url));

const common: Options = {
  format: ['esm', 'cjs'],
  outExtension({ format }) {
    return { js: format === 'cjs' ? '.cjs' : '.js' };
  },
  // Everything is bundled: the packages below are build-time dependencies and
  // nothing is left for the application's bundler to resolve.
  noExternal: ['@trezor/protocol', '@noble/ciphers', '@noble/hashes', '@bufbuild/protobuf', 'buffer'],
  platform: 'browser',
  sourcemap: true,
  // `pnpm run clean` runs first: the two configs build in parallel.
  clean: false,
  treeshake: true,
  target: 'es2020',
  tsconfig: 'tsconfig.json',
  esbuildOptions(options) {
    // `@bufbuild/protobuf` probes `process.env` for an opt-out flag behind a
    // `typeof process` guard; the bundle has no `process` and takes the guard.
    options.define = { ...options.define, process: 'undefined' };
  },
};

export default defineConfig([
  {
    ...common,
    entry: { index: 'src/index.ts' },
    esbuildOptions(options, context) {
      common.esbuildOptions?.(options, context);
      // `@trezor/protocol` imports Node's `crypto`; the bundle gets the shim.
      options.alias = { ...options.alias, crypto: shims };
      // ...and reads a free `Buffer`; the bundle gets its own.
      options.inject = [...(options.inject ?? []), bufferGlobal];
    },
    // The library's types are folded in: it is a build-time dependency.
    dts: { resolve: true },
  },
  {
    // The device-free entry stays free of the library and the shims, so that
    // a page that only needs the messages stays small.
    ...common,
    entry: { protocol: 'src/protocol/index.ts' },
    dts: true,
  },
  {
    // Node only: the emulator's UDP transport and the credential file. It
    // imports Node built-ins and nothing of the browser bundle, so that no
    // browser entry can reach them.
    format: ['esm', 'cjs'],
    outExtension({ format }) {
      return { js: format === 'cjs' ? '.cjs' : '.js' };
    },
    entry: { emulator: 'src/emulator.ts' },
    platform: 'node',
    target: 'node18',
    sourcemap: true,
    clean: false,
    treeshake: true,
    tsconfig: 'tsconfig.json',
    dts: true,
  },
  {
    // The browser's USB: the WebUSB transport and the IndexedDB credential
    // store. It has no driver and no dependency, and its own copy of what it
    // shares with the other entries, so that it stands alone.
    ...common,
    entry: { webusb: 'src/webusb.ts' },
    dts: true,
  },
  {
    // Node only: a real device through the optional native package `usb`
    // (a dynamic import, left alone), the credential file, and its own copy
    // of the WebUSB transport it reuses. Nothing of the browser bundle.
    format: ['esm', 'cjs'],
    outExtension({ format }) {
      return { js: format === 'cjs' ? '.cjs' : '.js' };
    },
    entry: { 'node-usb': 'src/node-usb.ts' },
    platform: 'node',
    target: 'node18',
    sourcemap: true,
    clean: false,
    treeshake: true,
    tsconfig: 'tsconfig.json',
    dts: true,
  },
]);
