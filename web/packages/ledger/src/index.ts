/**
 * `@thru/ledger`: Ledger hardware-wallet signer for Thru, built on the Ledger
 * Device Management Kit. Protocol: `specs/ledger/app-thru-apdu.md`.
 *
 * Transports live in subpath entries: `@thru/ledger/webhid`,
 * `@thru/ledger/speculos`, `@thru/ledger/node-hid`. The DMK-free protocol
 * layer is `@thru/ledger/protocol` (also re-exported here).
 */
export * from './protocol';
export * from './errors';

export {
  DEFAULT_BUSY_RETRY,
  isDeviceBusy,
  retryWhileBusy,
  ThruLedgerSigner,
  runDeviceAction,
  type BusyRetryPolicy,
  type LedgerAddress,
  type OperationOptions,
  type SignMessageLedgerOptions,
  type SignTransactionBodyOptions,
  type SignTransactionBodyResult,
  type StreamOperationOptions,
  type ThruLedgerSignerConfig,
} from './ThruLedgerSigner';

export {
  buildAndSignWithLedger,
  createLedgerEoa,
  EOA_CREATE_RESOURCES,
  EOA_TRANSFER_RESOURCES,
  ledgerBodySigner,
  mergeHeader,
  privateKeyBodySigner,
  sendWithLedger,
  type BuildWithLedgerOptions,
  type CreateLedgerEoaArgs,
  type CreateLedgerEoaResult,
  type LedgerThruClient,
  type LedgerTransactionResult,
  type TransactionBodySigner,
  type TransactionResources,
} from './adapter';

export { connectLedger, type ConnectLedgerOptions } from './connect';

/* DMK signer kit (observable API, device actions, commands). */
export {
  DefaultSignerThru,
  SignerThruBuilder,
  type SignerThru,
  type SignerThruOptions,
  type SignMessageOptions,
  type SignTransactionOptions,
  type ThruDeviceActionReturn,
} from './dmk/SignerThru';
export {
  getAddressDeviceAction,
  getAppConfigDeviceAction,
  signEoaAuthDeviceAction,
  signMessageDeviceAction,
  signTransactionDeviceAction,
  type DeviceActionOptions,
} from './dmk/device-actions';
export {
  ensureThruApp,
  getAddressTask,
  getAppConfigTask,
  readAppConfig,
  signEoaAuthTask,
  signMessageTask,
  signTransactionTask,
  type ProgressCallback,
  type SignProgress,
  type SignatureOutput,
  type SignTransactionOutput,
} from './dmk/tasks';
export {
  GetAppConfigCommand,
  GetAppNameCommand,
  GetPubkeyCommand,
  GetVersionCommand,
  SignChunkCommand,
  SignEoaAuthCommand,
  ThruAppCommandError,
  ThruCommand,
  THRU_APP_COMMAND_ERROR_TAG,
  type ThruAppErrorCode,
} from './dmk/commands';
export { toThruLedgerError } from './dmk/to-error';
