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
export { useWalletAvailability } from "./hooks/useWalletAvailability";

export {
  BrowserSDK,
  DepositTarget,
  ErrorCode,
  ThruNetwork,
  type BrowserSDKConfig,
  type ConnectOptions,
  type DepositDestination,
  type DepositFundingMethod,
  type DepositUiConfig,
  type DepositRequestPayload,
  type DepositResult,
  type PrepareDepositPayload,
  type SDKEvent,
  type WalletTheme,
  type WalletThemePreference,
} from "../index";

export type {
  DepositAccountState,
  DepositsApi,
  EnsureDepositAccountParams,
  GetDepositAccountStateParams,
  WaitForDepositParams,
} from "../deposit";
export { DepositTransactionError, formatDepositAmount } from "../deposit";

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
export type {
  WalletAvailability,
  WalletAvailabilityStatus,
} from "../connection-state";
export { WalletButton } from "./WalletButton";
export type { WalletButtonProps } from "./WalletButton";
