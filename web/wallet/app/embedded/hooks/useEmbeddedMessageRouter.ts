'use client';

import { useEffect } from 'react';
import { POST_MESSAGE_REQUEST_TYPES } from '../types';
import type {
  ConnectRequestMessage,
  DisconnectRequestMessage,
  GetAccountsRequestMessage,
  PostMessageRequest,
  SelectAccountRequestMessage,
  SignTransactionRequestMessage,
} from '../types';

interface UseEmbeddedMessageRouterParams {
  onConnect: (request: ConnectRequestMessage, event: MessageEvent) => void;
  onDisconnect: (request: DisconnectRequestMessage, event: MessageEvent) => void;
  onSignTransaction: (request: SignTransactionRequestMessage, event: MessageEvent) => void;
  onGetAccounts: (request: GetAccountsRequestMessage, event: MessageEvent) => void;
  onSelectAccount: (request: SelectAccountRequestMessage, event: MessageEvent) => void;
  onUnknown?: (event: MessageEvent) => void;
}

const isPostMessageRequest = (value: unknown): value is PostMessageRequest => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  if (typeof candidate.id !== 'string' || typeof candidate.type !== 'string') {
    return false;
  }

  if (typeof candidate.origin !== 'string') {
    return false;
  }

  return Object.values(POST_MESSAGE_REQUEST_TYPES).includes(
    candidate.type as (typeof POST_MESSAGE_REQUEST_TYPES)[keyof typeof POST_MESSAGE_REQUEST_TYPES]
  );
};

export function useEmbeddedMessageRouter({
  onConnect,
  onDisconnect,
  onSignTransaction,
  onGetAccounts,
  onSelectAccount,
  onUnknown,
}: UseEmbeddedMessageRouterParams) {
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (!isPostMessageRequest(event.data)) {
        onUnknown?.(event);
        return;
      }

      const message = event.data;

      switch (message.type) {
        case POST_MESSAGE_REQUEST_TYPES.CONNECT:
          onConnect(message, event);
          break;
        case POST_MESSAGE_REQUEST_TYPES.DISCONNECT:
          onDisconnect(message, event);
          break;
        case POST_MESSAGE_REQUEST_TYPES.SIGN_TRANSACTION:
          onSignTransaction(message, event);
          break;
        case POST_MESSAGE_REQUEST_TYPES.GET_ACCOUNTS:
          onGetAccounts(message, event);
          break;
        case POST_MESSAGE_REQUEST_TYPES.SELECT_ACCOUNT:
          onSelectAccount(message as SelectAccountRequestMessage, event);
          break;
        default:
          onUnknown?.(event);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [onConnect, onDisconnect, onGetAccounts, onSelectAccount, onSignTransaction, onUnknown]);
}
