/**
 * `@thru/trezor`: Trezor host for the Thru app, for browsers and Node.
 *
 * The signer (`ThruTrezorSigner`, with the shape of `ThruLedgerSigner`) and its
 * adapter into the SDK's signing flow; the connection driver (`TrezorClient`,
 * on the `Link`), pairing, credential stores, the app loader and the app's
 * requests; the path policy, the preview of the device's review and the typed
 * errors (all also in `@thru/trezor/protocol`); under it
 * the THP packet and handshake code of `@trezor/protocol` bundled with
 * browser shims for Node's `crypto` and `Buffer`, and the protobuf encodings
 * of the host's messages. Node-only parts (the emulator's UDP transport, the
 * credential file) are in `@thru/trezor/emulator`.
 */
export * from './protocol';
export { thp, v2, thpCrypto } from './thp/library';
export { Buffer, setRandomBytesSource, type RandomSourceTestOnly } from './thp/node-shims';
export { protobufDecoder, protobufEncoder } from './thp/codec-adapter';

export { PACKET_LEN, type Transport } from './transport';
export { systemClock, type Clock } from './clock';
export {
  MAX_CREDENTIAL_LEN,
  MemoryCredentialStore,
  type CredentialRecord,
  type CredentialStore,
} from './credentials';
export { CRC_LEN, FrameAssembler, MAX_INBOUND_LENGTH, splitFrame, type Frame } from './thp/framing';
export {
  ACK_BUDGET_MS,
  ALLOCATION_TIMEOUT_MS,
  BUSY_POLICY,
  COUNTER_LIMIT,
  HANDSHAKE_TIMEOUT_MS,
  Link,
  MAX_RETRANSMISSIONS,
  retransmitAfterMs,
  type DeviceMessage,
  type DeviceProperties,
  type LinkOptions,
  type LinkStats,
  type PairingState,
} from './thp/link';
export { CHALLENGE_LEN, CODE_LEN, CPACE_MAX_INPUT, cpaceExchange, isPairingCode, verifyCodeEntry, type CpaceExchange } from './pairing';
export {
  alreadyPaired,
  CALL_TIMEOUT_MS,
  MAX_BUTTON_REQUESTS,
  skipPairingAllowed,
  TrezorClient,
  type CallOptions,
  type ConnectOptions,
  type TrezorUi,
} from './client';
export {
  appFingerprint,
  appImageModel,
  appVersionSupported,
  checkImageModel,
  checkLoadedVersion,
  loadApp,
  parseAppImage,
  readAppHeader,
  rootPacketFileName,
  SUPPORTED_APP_RANGE,
  type AppImage,
  type AppImageChunk,
  type AppImageFiles,
  type LoadResult,
} from './extapp';
export {
  checkEoaChainId,
  checkMessage,
  CHUNK_MAX,
  eoaKindCode,
  EoaAuthKind,
  MESSAGE_MAX,
  PUBLIC_KEY_LEN,
  SIGNATURE_LEN,
  streamBody,
  ThruApp,
  TOKEN_HINT_LEN,
  type AppCallOptions,
  type AppConnection,
  type EoaAuthKindInput,
  type PublicKeyResult,
  type SignTransactionOptions,
} from './app';
export {
  connectTrezor,
  ThruTrezorSigner,
  type ConnectTrezorOptions,
  type OperationOptions,
  type ThruTrezorSignerConfig,
  type TrezorAddress,
  type TrezorAppApi,
  type TrezorSignatureOutput,
  type TrezorSignMessageOptions,
  type TrezorSignTransactionBodyOptions,
  type TrezorSignTransactionBodyResult,
} from './ThruTrezorSigner';
export {
  buildAndSignWithTrezor,
  createTrezorEoa,
  EOA_CREATE_RESOURCES,
  EOA_TRANSFER_RESOURCES,
  mergeHeader,
  privateKeyBodySigner,
  sendWithTrezor,
  trezorBodySigner,
  type BuildWithTrezorOptions,
  type CreateTrezorEoaArgs,
  type CreateTrezorEoaResult,
  type TransactionBodySigner,
  type TransactionResources,
  type TrezorThruClient,
  type TrezorTransactionResult,
} from './adapter';
