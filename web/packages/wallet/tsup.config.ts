import svgrPlugin from 'esbuild-plugin-svgr';
import { defineConfig } from 'tsup';

const sharedExternal = [
    '@thru/sdk',
    '@thru/sdk/client',
    'react',
    'react-dom',
    'crypto',
    'buffer',
    'stream',
    'http',
    'https',
    'url',
    'zlib',
];

const nativeExternal = [
  ...sharedExternal,
  '@gorhom/bottom-sheet',
  'expo',
  'expo-brightness',
  'expo-modules-core',
  'react-native',
  'react-native-gesture-handler',
  'react-native-qrcode-styled',
  'react-native-reanimated',
  'react-native-safe-area-context',
  'react-native-svg',
  'react-native-webview',
];

export default defineConfig([
  {
    entry: {
      index: 'src/index.ts',
      react: 'src/react/index.ts',
      'react-ui': 'src/react-ui/index.ts',
    },
    format: ['esm'],
    dts: true,
    sourcemap: true,
    clean: true,
    splitting: false,
    treeshake: true,
    platform: 'browser',
    banner: {
      js: '"use client";',
    },
    esbuildPlugins: [
      svgrPlugin({
        icon: true,
      }),
    ],
    external: sharedExternal,
  },
  {
    entry: {
      native: 'src/native/index.ts',
      'native/react': 'src/native/react/index.ts',
      'native/react/transparent': 'src/native/react/transparent.ts',
    },
    format: ['esm'],
    dts: true,
    sourcemap: true,
    clean: false,
    splitting: false,
    treeshake: true,
    platform: 'neutral',
    external: nativeExternal,
  },
]);
