// Provider and context
export type { ThruContextValue } from './ThruContext';
export { ThruProvider, type ThruProviderProps } from './ThruProvider';


// Hooks
export { useAccounts, type UseAccountsOptions, type UseAccountsResult } from './hooks/useAccounts';
export { useThru } from './hooks/useThru';
export { useWallet } from './hooks/useWallet';

// Re-export from browser-sdk for convenience
export { BrowserSDK, ErrorCode, type BrowserSDKConfig, type ConnectOptions, type SDKEvent } from '@thru/browser-sdk';

// Re-export types from chain-interfaces
export type {
  ConnectResult, IThruChain, SignMessageParams,
  SignMessageResult, WalletAccount
} from '@thru/chain-interfaces';
