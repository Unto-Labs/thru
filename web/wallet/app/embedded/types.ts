import {
  EMBEDDED_PROVIDER_EVENTS,
  ErrorCode,
  IFRAME_READY_EVENT,
  POST_MESSAGE_EVENT_TYPE,
  POST_MESSAGE_REQUEST_TYPES,
  type AppMetadata,
  type ConnectRequestMessage,
  type ConnectResult,
  type DisconnectRequestMessage,
  type DisconnectResult,
  type EmbeddedProviderEvent,
  type GetAccountsRequestMessage,
  type GetAccountsResult,
  type InferPostMessageResponse,
  type InferSuccessfulPostMessageResponse,
  type PostMessageEvent,
  type PostMessageRequest,
  type PostMessageResponse,
  type RequestType,
  type SelectAccountPayload,
  type SelectAccountRequestMessage,
  type SelectAccountResult,
  type SignMessagePayload,
  type SignMessageRequestMessage,
  type SignTransactionPayload,
  type SignTransactionRequestMessage,
  type SuccessfulPostMessageResponse,
} from '@thru/protocol';

export {
  EMBEDDED_PROVIDER_EVENTS, ErrorCode, IFRAME_READY_EVENT, POST_MESSAGE_EVENT_TYPE, POST_MESSAGE_REQUEST_TYPES, type AppMetadata, type ConnectRequestMessage, type ConnectResult, type DisconnectRequestMessage, type DisconnectResult, type EmbeddedProviderEvent, type GetAccountsRequestMessage, type GetAccountsResult, type InferPostMessageResponse, type InferSuccessfulPostMessageResponse, type PostMessageEvent, type PostMessageRequest, type PostMessageResponse, type RequestType, type SelectAccountPayload, type SelectAccountRequestMessage, type SelectAccountResult, type SignMessagePayload, type SignMessageRequestMessage, type SignTransactionPayload, type SignTransactionRequestMessage, type SuccessfulPostMessageResponse
};

export type ModalType = 'connect' | 'approve-transaction' | null;

export type PendingRequest = PostMessageRequest;

export type SendResponseFn = <T extends PostMessageRequest>(
  response: InferPostMessageResponse<T>
) => void;
