import { AccountStorage } from '@thru/wallet-store';
import { useCallback, useMemo } from 'react';
import type { EmbeddedAppStoreDeps } from '../store/useEmbeddedAppStore';
import type { EmbeddedProviderEvent, InferPostMessageResponse, PostMessageRequest } from '../types';

interface UseEmbeddedDepsParams {
  accounts: Array<{ index: number; publicKey: string; label?: string }>;
  isUnlocked: boolean;
  passkeyError: string | null;
  lockWallet: () => void;
  refreshAccounts: () => Promise<void>;
  selectedAccountIndex: number;
  selectAccount: (index: number) => void;
  signInWithPasskey: (context?: { appId?: string; appName?: string; appUrl?: string; origin?: string; imageUrl?: string }) => Promise<boolean>;
  shouldUsePasskeyPopup: () => Promise<boolean>;
  getEmbeddedAccountsSnapshot: () => Array<{ publicKey: string; index: number; label?: string }>;
  sendResponse: <T extends PostMessageRequest>(response: InferPostMessageResponse<T>) => void;
  sendEvent: (eventName: EmbeddedProviderEvent, data?: any) => void;
  signSerializedTransaction: (serializedTransaction: string) => Promise<string>;
}

/**
 * Creates the dependencies object for the embedded app store
 */
export function useEmbeddedDeps({
  accounts,
  isUnlocked,
  passkeyError,
  lockWallet,
  refreshAccounts,
  selectedAccountIndex,
  selectAccount,
  signInWithPasskey,
  shouldUsePasskeyPopup,
  getEmbeddedAccountsSnapshot,
  sendResponse,
  sendEvent,
  signSerializedTransaction,
}: UseEmbeddedDepsParams): EmbeddedAppStoreDeps {
  const getFallbackAccounts = useCallback(async () => {
    const snapshot = getEmbeddedAccountsSnapshot();
    if (snapshot.length > 0) {
      return snapshot;
    }
    return AccountStorage.getAccounts();
  }, [getEmbeddedAccountsSnapshot]);

  return useMemo(
    () => ({
      // Store only needs { index, publicKey, label } - accounts already has these
      accounts: accounts.map(({ index, publicKey, label }) => ({
        index,
        publicKey,
        label,
      })),
      isUnlocked,
      passkeyError,
      lockWallet,
      refreshAccounts,
      selectedAccountIndex,
      getFallbackAccounts,
      selectAccount,
      sendResponse,
      sendEvent,
      signInWithPasskey,
      shouldUsePasskeyPopup,
      signSerializedTransaction: (_accountIndex: number, serialized: string) =>
        signSerializedTransaction(serialized),
    }),
    [
      accounts,
      isUnlocked,
      passkeyError,
      lockWallet,
      refreshAccounts,
      selectedAccountIndex,
      selectAccount,
      sendResponse,
      sendEvent,
      signInWithPasskey,
      shouldUsePasskeyPopup,
      getFallbackAccounts,
      signSerializedTransaction,
      getEmbeddedAccountsSnapshot,
    ]
  );
}
