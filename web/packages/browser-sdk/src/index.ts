// Main exports
export {
  BrowserSDK,
  type BrowserSDKConfig, type ConnectOptions, type EventCallback, type SDKEvent
} from './BrowserSDK';

// Re-export types from chain-interfaces for convenience
export type {
  ConnectResult, IThruChain, SignMessageParams,
  SignMessageResult, WalletAccount
} from '@thru/chain-interfaces';

// Re-export error codes from embedded-provider
export { ErrorCode } from '@thru/embedded-provider';
