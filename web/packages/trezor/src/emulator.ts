/**
 * `@thru/trezor/emulator`: what only Node has. The Trezor emulator's UDP
 * transport (the only transport on which pairing may be skipped, and only when
 * asked for) and the credential file store. Nothing here belongs in a browser.
 */
export { UDP_QUEUE_LIMIT, UdpQueueFullError, UdpTransport, UdpTransportError, type UdpTransportOptions } from './transports/udp';
export { FileCredentialStore, CredentialFileError } from './credentials-file';
