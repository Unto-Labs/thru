'use client';

import { useCallback, useMemo } from 'react';
import { ErrorCode } from '../types';
import type {
  ConnectRequestMessage,
  DisconnectRequestMessage,
  GetAccountsRequestMessage,
  SignTransactionRequestMessage,
  SelectAccountRequestMessage,
  SendResponseFn,
} from '../types';
import type { ConnectionFlowActions } from './useConnectionFlow';

interface UseEmbeddedMessageHandlersParams {
  connectionActions: Pick<
    ConnectionFlowActions,
    | 'setPendingRequest'
    | 'setAppMetadata'
    | 'handleConnect'
    | 'handleDisconnect'
    | 'handleGetAccounts'
    | 'handleSelectAccount'
    | 'setIsConnected'
    | 'setIsLoading'
    | 'setError'
  >;
  transactionHandlers: {
    handleSignTransaction: (request: SignTransactionRequestMessage) => void;
  };
  sendResponse: SendResponseFn;
}

export interface EmbeddedMessageHandlers {
  onConnect: (request: ConnectRequestMessage, event: MessageEvent) => void;
  onDisconnect: (request: DisconnectRequestMessage, event: MessageEvent) => void;
  onSignTransaction: (request: SignTransactionRequestMessage, event: MessageEvent) => void;
  onGetAccounts: (request: GetAccountsRequestMessage, event: MessageEvent) => void;
  onSelectAccount: (request: SelectAccountRequestMessage, event: MessageEvent) => void;
  onUnknown: (event: MessageEvent) => void;
}

export function useEmbeddedMessageHandlers({
  connectionActions,
  transactionHandlers,
  sendResponse,
}: UseEmbeddedMessageHandlersParams): EmbeddedMessageHandlers {
  const onConnect = useCallback(
    (request: ConnectRequestMessage, event: MessageEvent) => {
      connectionActions.setPendingRequest({
        ...request,
        origin: event.origin,
      });
      void connectionActions.handleConnect(request, event);
    },
    [connectionActions]
  );

  const onDisconnect = useCallback(
    (request: DisconnectRequestMessage, event: MessageEvent) => {
      connectionActions.setPendingRequest({
        ...request,
        origin: event.origin,
      });
      connectionActions.setAppMetadata(null);
      connectionActions.setIsConnected(false);
      connectionActions.setIsLoading(false);
      connectionActions.setError(null);
      connectionActions.handleDisconnect(request);
    },
    [connectionActions]
  );

  const onSignTransaction = useCallback(
    (request: SignTransactionRequestMessage, event: MessageEvent) => {
      connectionActions.setPendingRequest({
        ...request,
        origin: event.origin,
      });
      connectionActions.setAppMetadata(null);
      transactionHandlers.handleSignTransaction(request);
    },
    [connectionActions, transactionHandlers]
  );

  const onGetAccounts = useCallback(
    (request: GetAccountsRequestMessage, event: MessageEvent) => {
      connectionActions.setPendingRequest({
        ...request,
        origin: event.origin,
      });
      connectionActions.setAppMetadata(null);
      connectionActions.handleGetAccounts(request);
    },
    [connectionActions]
  );

  const onSelectAccount = useCallback(
    (request: SelectAccountRequestMessage) => {
      connectionActions.setAppMetadata(null);
      connectionActions.handleSelectAccount(request);
    },
    [connectionActions]
  );

  const onUnknown = useCallback(
    (event: MessageEvent) => {
      const { data } = event;
      if (!data?.id) {
        return;
      }

      sendResponse({
        id: data.id,
        success: false,
        error: {
          code: ErrorCode.UNKNOWN_ERROR,
          message: `Unknown request type: ${data?.type ?? 'unknown'}`,
        },
      });
    },
    [sendResponse]
  );

  return useMemo(
    () => ({
      onConnect,
      onDisconnect,
      onSignTransaction,
      onGetAccounts,
      onSelectAccount,
      onUnknown,
    }),
    [onConnect, onDisconnect, onSignTransaction, onGetAccounts, onSelectAccount, onUnknown]
  );
}
