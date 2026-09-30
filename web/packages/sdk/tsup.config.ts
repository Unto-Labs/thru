import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    compression: 'thru-ts-client-sdk/compression.ts',
    'programs/compression/abi/thru/program/compression/types': 'thru-ts-client-sdk/domain/programs/compression/abi/thru/program/compression/types.ts',
    'programs/compression/abi/thru/blockchain/state_proof/types': 'thru-ts-client-sdk/domain/programs/compression/abi/thru/blockchain/state_proof/types.ts',
    'programs/multicall/abi/thru/program/multicall/types': 'thru-ts-client-sdk/domain/programs/multicall/abi/thru/program/multicall/types.ts',
    'programs/multicall/abi/thru/common/primitives/types': 'thru-ts-client-sdk/domain/programs/multicall/abi/thru/common/primitives/types.ts',
    'programs/uploader/abi/thru/program/uploader/types': 'thru-ts-client-sdk/domain/programs/uploader/abi/thru/program/uploader/types.ts',
    'programs/uploader/abi/thru/common/primitives/types': 'thru-ts-client-sdk/domain/programs/uploader/abi/thru/common/primitives/types.ts',
    'programs/passkey-manager/abi/thru/program/passkey_manager/types': 'thru-ts-client-sdk/domain/programs/passkey-manager/abi/thru/program/passkey_manager/types.ts',
    'programs/passkey-manager/abi/thru/common/primitives/types': 'thru-ts-client-sdk/domain/programs/passkey-manager/abi/thru/common/primitives/types.ts',
    'programs/passkey-manager/abi/thru/blockchain/state_proof/types': 'thru-ts-client-sdk/domain/programs/passkey-manager/abi/thru/blockchain/state_proof/types.ts',
    'programs/utils/helpers': 'thru-ts-client-sdk/domain/programs/utils/helpers.ts',
    'programs/compression/instructions': 'thru-ts-client-sdk/domain/programs/compression/instructions.ts',
    'programs/multicall': 'thru-ts-client-sdk/domain/programs/multicall/index.ts',
    'programs/uploader/instructions': 'thru-ts-client-sdk/domain/programs/uploader/instructions.ts',
    'programs/uploader/derivation': 'thru-ts-client-sdk/domain/programs/uploader/derivation.ts',
    'programs/uploader/types': 'thru-ts-client-sdk/domain/programs/uploader/types.ts',
    'programs/uploader/constants': 'thru-ts-client-sdk/domain/programs/uploader/constants.ts',
    'programs/passkey-manager/context': 'thru-ts-client-sdk/domain/programs/passkey-manager/context.ts',
    'programs/helpers/bytes': 'thru-ts-client-sdk/domain/programs/helpers/bytes.ts',
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
