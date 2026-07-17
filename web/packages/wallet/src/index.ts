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
