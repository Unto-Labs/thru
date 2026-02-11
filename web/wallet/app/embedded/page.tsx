'use client';

import { useWallet } from '@/hooks/useWallet';
import { EmbeddedModalRenderer } from './components/EmbeddedModalRenderer';
import { useAccountChangeEmitter } from './hooks/useAccountChangeEmitter';
import { useAutoLockHandler } from './hooks/useAutoLockHandler';
import { useEmbeddedDeps } from './hooks/useEmbeddedDeps';
import { useIframeReady } from './hooks/useIframeReady';
import { useMessageRouter } from './hooks/useMessageRouter';
import { useModalHandlers } from './hooks/useModalHandlers';
import { usePostMessage } from './hooks/usePostMessage';

export default function EmbeddedPage() {
  const {
    accounts,
    isUnlocked,
    passkeyError,
    signInWithPasskey,
    shouldUsePasskeyPopup,
    lockWallet,
    getEmbeddedAccountsSnapshot,
    selectedAccountIndex,
    selectAccount,
    refreshAccounts,
    autoLockCount,
    signSerializedTransaction,
  } = useWallet();

  const { sendResponse, sendEvent } = usePostMessage();

  const deps = useEmbeddedDeps({
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
  });

  // Setup message router
  useMessageRouter(deps);

  // Side effects
  useAutoLockHandler({ autoLockCount, sendResponse, sendEvent });
  useAccountChangeEmitter({ accounts, selectedAccountIndex, sendEvent });
  useIframeReady();

  // Modal handlers
  const handlers = useModalHandlers({ deps });

  return (
    <EmbeddedModalRenderer
      accounts={accounts}
      selectedAccountIndex={selectedAccountIndex}
      handlers={handlers}
    />
  );
}
