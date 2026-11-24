/**
 * Injected by the build in place of the free `Buffer` global that
 * `@trezor/protocol` reads, so that the bundle defines its own and leaves the
 * page's globals alone.
 */
export { Buffer } from './node-shims';
