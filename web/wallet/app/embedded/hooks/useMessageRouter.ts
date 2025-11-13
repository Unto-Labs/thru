'use client';

/**
 * Simplified Message Router using Zustand Store
 * 
 * This replaces useEmbeddedMessageRouter + useEmbeddedMessageHandlers.
 * Routes messages directly to store actions.
 */

import { useEffect } from 'react';
import { useEmbeddedAppStore, type EmbeddedAppStoreDeps } from '../store/useEmbeddedAppStore';
import type {
    SelectAccountRequestMessage
} from '../types';
import { ErrorCode, POST_MESSAGE_REQUEST_TYPES, type PostMessageRequest } from '../types';

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

interface UseMessageRouterParams extends EmbeddedAppStoreDeps {}

/**
 * Message router hook that routes postMessage events directly to store actions
 */
export function useMessageRouter(deps: UseMessageRouterParams) {
  const handleConnect = useEmbeddedAppStore(state => state.handleConnect);
  const handleDisconnect = useEmbeddedAppStore(state => state.handleDisconnect);
  const handleSignTransaction = useEmbeddedAppStore(state => state.handleSignTransaction);
  const handleGetAccounts = useEmbeddedAppStore(state => state.handleGetAccounts);
  const handleSelectAccount = useEmbeddedAppStore(state => state.handleSelectAccount);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (!isPostMessageRequest(event.data)) {
        // Handle unknown messages
        const { data } = event;
        if (data?.id) {
          deps.sendResponse({
            id: data.id,
            success: false,
            error: {
              code: ErrorCode.UNKNOWN_ERROR,
              message: `Unknown request type: ${data?.type ?? 'unknown'}`,
            },
          });
        }
        return;
      }

      const message = event.data;

      switch (message.type) {
        case POST_MESSAGE_REQUEST_TYPES.CONNECT:
          void handleConnect(message, event, deps);
          break;
        case POST_MESSAGE_REQUEST_TYPES.DISCONNECT:
          handleDisconnect(message, deps);
          break;
        case POST_MESSAGE_REQUEST_TYPES.SIGN_TRANSACTION:
          handleSignTransaction(message, deps);
          break;
        case POST_MESSAGE_REQUEST_TYPES.GET_ACCOUNTS:
          handleGetAccounts(message, deps);
          break;
        case POST_MESSAGE_REQUEST_TYPES.SELECT_ACCOUNT:
          handleSelectAccount(message as SelectAccountRequestMessage, deps);
          break;
        default:
          // Unknown type
          if (message.id) {
            deps.sendResponse({
              id: message.id,
              success: false,
              error: {
                code: ErrorCode.UNKNOWN_ERROR,
                message: `Unknown request type: ${message.type}`,
              },
            });
          }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
    // Include deps so effect re-runs when isUnlocked or other deps change
    // This ensures handlers always have latest deps values
    // Store actions are stable, deps object is memoized in parent
  }, [handleConnect, handleDisconnect, handleSignTransaction, handleGetAccounts, handleSelectAccount, deps]);
}

