'use client';

import { useCallback } from 'react';
import { useWallet } from '@/hooks/useWallet';
import { workerClient } from '@/lib/worker/worker-client';
import type {
  EmbeddedProviderEvent,
  PostMessageRequest,
  InferPostMessageResponse,
} from './types';
import { POST_MESSAGE_EVENT_TYPE } from './types';
import { EmbeddedFlowProvider } from './context/EmbeddedFlowContext';

export default function EmbeddedPage() {
  const {
    accounts,
    isUnlocked,
    unlockWallet,
    selectedAccountIndex,
    selectAccount,
    refreshAccounts,
    autoLockCount,
  } = useWallet();

  const sendResponse = useCallback(
    <T extends PostMessageRequest>(response: InferPostMessageResponse<T>) => {
      window.parent.postMessage(response, '*');
    },
    []
  );

  const sendEvent = useCallback((eventName: EmbeddedProviderEvent, data?: any) => {
    const event = {
      type: POST_MESSAGE_EVENT_TYPE,
      event: eventName,
      data,
    };
    window.parent.postMessage(event, '*');
  }, []);

  return (
    <EmbeddedFlowProvider
      accounts={accounts}
      isUnlocked={isUnlocked}
      refreshAccounts={refreshAccounts}
      selectedAccountIndex={selectedAccountIndex}
      unlockWallet={unlockWallet}
      selectAccount={selectAccount}
      autoLockCount={autoLockCount}
      sendResponse={sendResponse}
      sendEvent={sendEvent}
      signSerializedTransaction={(accountIndex: number, serialized: string) =>
        workerClient.signSerializedTransaction(accountIndex, serialized)
      }
    />
  );
}
