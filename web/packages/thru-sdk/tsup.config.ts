import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    sdk: 'thru-ts-client-sdk/sdk.ts',
    client: 'thru-ts-client-sdk/client.ts'
  },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  metafile: true
});
