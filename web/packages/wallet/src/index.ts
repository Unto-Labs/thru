// Main exports
export {
  BrowserSDK,
  type BrowserSDKConfig, type ConnectOptions, type EventCallback, type SDKEvent
} from './BrowserSDK';

export type {
  ConnectedApp, ConnectResult, IThruChain, SignMessageParams,
  SignMessageResult, ThruSigningContext, ThruTransactionIntent, WalletAccount
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
