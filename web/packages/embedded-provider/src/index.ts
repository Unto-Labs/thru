// Main exports
export { EmbeddedThruChain } from './chains/ThruChain';
export { EmbeddedProvider, type ConnectOptions, type EmbeddedProviderConfig } from './EmbeddedProvider';

// Type exports
export type {
  ConnectResult, EmbeddedProviderEvent, PostMessageEvent, PostMessageRequest,
  PostMessageResponse, RequestType, SignMessagePayload,
  SignMessageResult,
  SignTransactionPayload,
  SignTransactionResult
} from './types/messages';

export { ErrorCode } from './types/messages';

// Re-export types from chain-interfaces for convenience
export type { IThruChain, WalletAccount } from '@thru/chain-interfaces';
