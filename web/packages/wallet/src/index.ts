// Main exports
export {
  BrowserSDK,
  type BrowserSDKConfig, type ConnectOptions, type EventCallback, type SDKEvent
} from './BrowserSDK';

export type {
  ConnectedApp, ConnectResult, IThruChain, SignMessageParams,
  SignMessageResult, ThruSigningContext, ThruSigningSession,
  ThruSigningSessionCreateOptions, ThruSigningSessionDescriptor,
  ThruSigningSessionInstruction, ThruSigningSessionInstructionCreateOptions,
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
  WaitForDepositBalanceParams,
} from './deposit';
export {
  DepositTransactionError,
  formatDepositAmount,
} from './deposit';
export type { SigningSessionStorage } from './signing-sessions';
export {
  TRANSACTION_SIGNING_SCHEME_SEARCH_PARAM,
  TransactionSigningScheme,
  withTransactionSigningScheme,
} from './transaction-signing-scheme';
export {
  TELEMETRY_APP_CONTEXT_SEARCH_PARAM,
  TELEMETRY_BATCH_VERSION,
  TELEMETRY_ENABLED_SEARCH_PARAM,
  TELEMETRY_SESSION_SEARCH_PARAM,
  WALLET_SDK_VERSION,
} from './telemetry';
export type {
  TelemetryEvent,
  TelemetrySeverity,
  TelemetrySource,
} from './telemetry';
