import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'token/index': 'src/token/index.ts',
    'passkey-manager/index': 'src/passkey-manager/index.ts',
    'multicall/index': 'src/multicall/index.ts',
    'amm/index': 'src/amm/index.ts',
    'clob/index': 'src/clob/index.ts',
  },
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
});
