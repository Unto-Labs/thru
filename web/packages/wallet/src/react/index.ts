// Provider and context
export type { ThruContextValue } from "./ThruContext";
export { ThruProvider, type ThruProviderProps } from "./ThruProvider";

// Hooks
export {
  useAccounts,
  type UseAccountsOptions,
  type UseAccountsResult,
} from "./hooks/useAccounts";
export { useThru } from "./hooks/useThru";
export { useWallet } from "./hooks/useWallet";

export {
  BrowserSDK,
  DepositTarget,
  ErrorCode,
  ThruNetwork,
  type BrowserSDKConfig,
  type ConnectOptions,
  type DepositDestination,
  type DepositUiConfig,
  type DepositRequestPayload,
  type DepositResult,
  type PrepareDepositPayload,
  type SDKEvent,
} from "../index";

export type {
  DepositAccountState,
  DepositsApi,
  EnsureDepositAccountParams,
  GetDepositAccountStateParams,
  WaitForDepositBalanceParams,
} from "../deposit";
export {
  DepositTransactionError,
  formatDepositAmount,
} from "../deposit";

export type {
  ConnectResult,
  IThruChain,
  SignMessageParams,
  SignMessageResult,
  ThruSigningContext,
  ThruSigningSession,
  ThruSigningSessionCreateOptions,
  ThruSigningSessionDescriptor,
  ThruSigningSessionTimestamp,
  ThruTransactionEncoding,
  ThruTransactionIntent,
  WalletAccount,
} from "../interfaces";
export type { SigningSessionStorage } from "../signing-sessions";
