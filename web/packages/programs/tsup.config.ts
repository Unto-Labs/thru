import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'token/index': 'src/token/index.ts',
    'passkey-manager/index': 'src/passkey-manager/index.ts',
  },
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
});
