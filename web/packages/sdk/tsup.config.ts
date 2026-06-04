import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    sdk: 'thru-ts-client-sdk/sdk.ts',
    client: 'thru-ts-client-sdk/client.ts',
    'proto/index': 'src/proto/index.ts',
    'helpers/index': 'src/helpers/index.ts',
    'crypto/index': 'src/crypto/index.ts',
    'abi/index': 'src/abi/index.ts'
  },
  format: ['esm', 'cjs'],
  outExtension({ format }) {
    if (format === 'cjs') return { js: '.cjs' };
    return { js: '.js' };
  },
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  metafile: true
});
