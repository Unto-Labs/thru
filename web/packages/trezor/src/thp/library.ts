/**
 * The pieces of `@trezor/protocol` (MIT) this package builds on, re-exported
 * under stable names (the `thp` namespace has its pairing-tag checks guarded,
 * see `guarded.ts`). The library is bundled with the shims of `node-shims.ts`
 * in place of Node's `crypto` and `Buffer`.
 */
export * as thp from './guarded';
export * as v2 from '@trezor/protocol/lib/protocol-v2/index.js';
export * as thpCrypto from './thp-crypto';
