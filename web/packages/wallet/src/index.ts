// Main exports
export {
  BrowserSDK,
  type BrowserSDKConfig, type ConnectOptions, type EventCallback, type SDKEvent
} from './BrowserSDK';

export type {
  ConnectedApp, ConnectResult, IThruChain, SignMessageParams,
  SignMessageResult, ThruSigningContext, ThruSigningSession,
  ThruSigningSessionCreateOptions, ThruSigningSessionDescriptor,
  ThruSigningSessionRenewOptions,
  ThruSigningSessionTimestamp, ThruTransactionIntent, WalletAccount
} from './interfaces';
export {
  AddressType,
  normalizeActiveWalletAccounts,
  normalizeWalletAccountResult,
  resolveSelectedWalletAccount,
  resolveWalletAccountByAddress,
  ThruTransactionEncoding,
} from './interfaces';
export type {
  ActiveWalletAccounts,
  WalletAccountResult,
} from './interfaces';

export {
  ErrorCode,
} from './protocol';
export * from './protocol';
export type {
  DepositAccountState,
  DepositsApi,
  EnsureDepositAccountParams,
  GetDepositAccountStateParams,
  WaitForDepositParams,
} from './deposit';
export {
  DepositTransactionError,
  createDepositsApi,
  formatDepositAmount,
} from './deposit';
export type { SigningSessionStorage } from './signing-sessions';
export type { WalletSDKStorage } from './storage';
export { WalletSDKStorageError } from './storage';
export type {
  AccountsApi,
  ConnectionApi,
  SigningSessionsApi,
  WalletConnectOptions,
  WalletSDK,
} from './sdk-contract';
export {
  TRANSACTION_SIGNING_SCHEME_SEARCH_PARAM,
  TransactionSigningScheme,
  withTransactionSigningScheme,
} from './transaction-signing-scheme';
export {
  TELEMETRY_APP_CONTEXT_SEARCH_PARAM,
  TELEMETRY_BATCH_VERSION,
  TELEMETRY_CONTEXT_SEARCH_PARAM,
  TELEMETRY_ENABLED_SEARCH_PARAM,
  TELEMETRY_SESSION_SEARCH_PARAM,
  WALLET_SDK_VERSION,
} from './telemetry';
export type {
  TelemetryAppContext,
  TelemetryEvent,
  TelemetrySeverity,
  TelemetrySource,
} from './telemetry';
export {
  CHECKING_WALLET_AVAILABILITY,
} from './connection-state';
export type {
  ConnectionStorage,
  WalletAvailability,
  WalletAvailabilityStatus,
} from './connection-state';
