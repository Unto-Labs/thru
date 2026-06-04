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
  ErrorCode,
  type BrowserSDKConfig,
  type ConnectOptions,
  type SDKEvent,
} from "../index";

export type {
  ConnectResult,
  IThruChain,
  SignMessageParams,
  SignMessageResult,
  ThruSigningContext,
  ThruTransactionEncoding,
  WalletAccount,
} from "../interfaces";
