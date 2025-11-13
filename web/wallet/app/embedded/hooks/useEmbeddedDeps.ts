import { workerClient } from '@/lib/worker/worker-client';
import { AccountStorage } from '@thru/indexed-db-stamper';
import { useMemo } from 'react';
import type { EmbeddedAppStoreDeps } from '../store/useEmbeddedAppStore';
import type { EmbeddedProviderEvent, InferPostMessageResponse, PostMessageRequest } from '../types';

interface UseEmbeddedDepsParams {
  accounts: Array<{ index: number; publicKey: string; label?: string }>;
  isUnlocked: boolean;
  refreshAccounts: () => Promise<void>;
  selectedAccountIndex: number;
  selectAccount: (index: number) => void;
  unlockWallet: (password: string) => Promise<void>;
  sendResponse: <T extends PostMessageRequest>(response: InferPostMessageResponse<T>) => void;
  sendEvent: (eventName: EmbeddedProviderEvent, data?: any) => void;
}

/**
 * Creates the dependencies object for the embedded app store
 */
export function useEmbeddedDeps({
  accounts,
  isUnlocked,
  refreshAccounts,
  selectedAccountIndex,
  selectAccount,
  unlockWallet,
  sendResponse,
  sendEvent,
}: UseEmbeddedDepsParams): EmbeddedAppStoreDeps {
  return useMemo(
    () => ({
      // Store only needs { index, publicKey, label } - accounts already has these
      accounts: accounts.map(({ index, publicKey, label }) => ({
        index,
        publicKey,
        label,
      })),
      isUnlocked,
      refreshAccounts,
      selectedAccountIndex,
      getFallbackAccounts: () => AccountStorage.getAccounts(),
      selectAccount,
      sendResponse,
      sendEvent,
      unlockWallet,
      signSerializedTransaction: (accountIndex: number, serialized: string) =>
        workerClient.signSerializedTransaction(accountIndex, serialized),
    }),
    [
      accounts,
      isUnlocked,
      refreshAccounts,
      selectedAccountIndex,
      selectAccount,
      sendResponse,
      sendEvent,
      unlockWallet,
    ]
  );
}

