import { defineConfig } from 'tsup';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  platform: 'browser',
  banner: {
    js: '"use client";',
  },
  noExternal: ['@thru/chain-interfaces'],
  external: [
    '@thru/browser-sdk',
    '@thru/embedded-provider',
    'react',
    'react-dom',
  ],
  onSuccess: () => {
    const distDir = dirname(fileURLToPath(import.meta.url));
    const outputPath = join(distDir, 'dist', 'index.js');
    const content = readFileSync(outputPath, 'utf8');
    if (!content.startsWith('"use client";')) {
      writeFileSync(outputPath, `"use client";\n${content}`);
    }
  },
});
