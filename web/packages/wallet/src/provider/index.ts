export { EmbeddedThruChain } from './chains/ThruChain';
export { EmbeddedProvider, type ConnectOptions, type EmbeddedProviderConfig } from './EmbeddedProvider';

export type {
  ConnectResult, EmbeddedProviderEvent, PostMessageEvent, PostMessageRequest,
  PostMessageResponse, RequestType, SignMessagePayload,
  SignMessageResult,
  SignTransactionPayload,
  SignTransactionResult
} from './types/messages';

export { ErrorCode } from './types/messages';

export type { IThruChain, WalletAccount } from '../interfaces';
