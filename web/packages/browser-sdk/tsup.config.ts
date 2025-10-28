import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  platform: 'browser',
  noExternal: ['@thru/chain-interfaces'],
  external: [
    '@thru/embedded-provider',
    '@thru/protocol',
    'crypto',
    'buffer',
    'stream',
    'http',
    'https',
    'url',
    'zlib',
  ],
});
