import { defineConfig } from 'tsup';

export default defineConfig({
  format: ['esm', 'cjs'],
  entry: {
    index: 'src/index.ts',
    web: 'src/web.ts',
    popup: 'src/popup-entry.ts',
    mobile: 'src/mobile/index.ts',
    auth: 'src/auth/index.ts',
    server: 'src/server/index.ts',
  },
  external: ['expo-secure-store', 'react-native', 'react-native-passkeys', 'zustand'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2020',
  tsconfig: 'tsconfig.json',
});
