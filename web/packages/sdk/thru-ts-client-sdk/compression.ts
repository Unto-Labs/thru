/** Public compression types. Operations are bound on createThruClient().compression. */
export { CompressionError } from './modules/compression/types';
export type { CompressionErrorCode, CompressionOptions, KeypairCompressionOptions, WalletCompressionOptions,
  DecompressionOptions, CompressionResult, AccountOutcome, UploadCleanup, CompressionJournal,
  PendingCompressionTransaction } from './modules/compression/types';
export type { AccountCompressionStatus } from './modules/compression/status';
