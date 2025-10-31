import { defineConfig } from 'tsup';

type Format = 'esm';

type Config = {
  format: Format[];
  entry: Record<string, string>;
  dts: boolean;
  sourcemap: boolean;
  clean: boolean;
  target: string;
  tsconfig: string;
};

export default defineConfig((): Config => ({
  format: ['esm'],
  entry: { index: 'src/index.ts' },
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2020',
  tsconfig: 'tsconfig.json',
}));
