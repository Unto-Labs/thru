import { defineConfig } from 'tsup';

export default defineConfig({
  format: ['esm', 'cjs'],
  entry: { index: 'src/index.ts' },
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2020',
  tsconfig: 'tsconfig.json',
});
