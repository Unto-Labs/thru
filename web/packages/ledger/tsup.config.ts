import { defineConfig } from 'tsup';

export default defineConfig({
  format: ['esm', 'cjs'],
  entry: {
    index: 'src/index.ts',
    protocol: 'src/protocol/index.ts',
    webhid: 'src/transports/webhid.ts',
    speculos: 'src/transports/speculos.ts',
    'node-hid': 'src/transports/node-hid.ts',
  },
  outExtension({ format }) {
    return { js: format === 'cjs' ? '.cjs' : '.js' };
  },
  external: [
    '@ledgerhq/device-management-kit',
    '@ledgerhq/device-transport-kit-web-hid',
    '@ledgerhq/device-transport-kit-speculos',
    '@ledgerhq/device-transport-kit-node-hid',
    'rxjs',
  ],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  target: 'es2020',
  tsconfig: 'tsconfig.json',
});
