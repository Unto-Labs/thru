'use client';

import { AddressType } from '@thru/chain-interfaces';
import { AccountStorage } from '@thru/indexed-db-stamper';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import { ConnectModal } from '../components/ConnectModal';
import { TransactionApprovalModal } from '../components/TransactionApprovalModal';
import { UnlockModal } from '../components/UnlockModal';
import { useConnectionFlow } from '../hooks/useConnectionFlow';
import { useEmbeddedMessageHandlers } from '../hooks/useEmbeddedMessageHandlers';
import { useEmbeddedMessageRouter } from '../hooks/useEmbeddedMessageRouter';
import { useTransactionFlow } from '../hooks/useTransactionFlow';
import { useUnlockFlow } from '../hooks/useUnlockFlow';
import {
  EMBEDDED_PROVIDER_EVENTS,
  ErrorCode,
  IFRAME_READY_EVENT,
  type EmbeddedProviderEvent,
  type SendResponseFn,
} from '../types';

interface AccountSummary {
  index: number;
  publicKey: string;
  [key: string]: any;
}

interface EmbeddedFlowProviderProps {
  accounts: AccountSummary[];
  isUnlocked: boolean;
  refreshAccounts: () => Promise<void>;
  selectedAccountIndex: number;
  unlockWallet: (password: string) => Promise<void>;
  selectAccount: (index: number) => void;
  autoLockCount: number;
  sendResponse: SendResponseFn;
  sendEvent: (eventName: EmbeddedProviderEvent, data?: any) => void;
  signSerializedTransaction: (accountIndex: number, serializedTransaction: string) => Promise<string>;
}

type ConnectionFlowReturn = ReturnType<typeof useConnectionFlow>;
type UnlockFlowReturn = ReturnType<typeof useUnlockFlow>;
type TransactionFlowReturn = ReturnType<typeof useTransactionFlow>;

interface EmbeddedFlowContextValue {
  connection: ConnectionFlowReturn;
  unlock: UnlockFlowReturn;
  transaction: TransactionFlowReturn;
  accounts: AccountSummary[];
  selectedAccountIndex: number;
  selectAccount: (index: number) => void;
  messageHandlers: ReturnType<typeof useEmbeddedMessageHandlers>;
}

const EmbeddedFlowContext = createContext<EmbeddedFlowContextValue | null>(null);

export function EmbeddedFlowProvider({
  accounts,
  isUnlocked,
  refreshAccounts,
  selectedAccountIndex,
  unlockWallet,
  selectAccount,
  autoLockCount,
  sendResponse,
  sendEvent,
  signSerializedTransaction,
}: EmbeddedFlowProviderProps) {
  const lightweightAccounts = useMemo(
    () =>
      accounts.map(({ index, publicKey, label, name }) => ({
        index,
        publicKey,
        label,
        name,
      })),
    [accounts]
  );

  const connection = useConnectionFlow({
    accounts: lightweightAccounts,
    isUnlocked,
    refreshAccounts,
    selectedAccountIndex,
    getFallbackAccounts: () => AccountStorage.getAccounts(),
    selectAccount,
    sendResponse,
    sendEvent,
  });

  const unlock = useUnlockFlow({
    unlockWallet,
    pendingRequest: connection.state.pendingRequest,
    approveConnection: connection.actions.approveConnection,
    setModalType: connection.actions.setModalType,
    setError: connection.actions.setError,
    setIsLoading: connection.actions.setIsLoading,
    setPendingRequest: connection.actions.setPendingRequest,
    setAppMetadata: connection.actions.setAppMetadata,
    sendResponse,
    onUnlockForTransaction: () => connection.actions.setModalType('approve-transaction'),
  });

  const transaction = useTransactionFlow({
    accounts: lightweightAccounts,
    selectedAccountIndex,
    pendingRequest: connection.state.pendingRequest,
    setPendingRequest: connection.actions.setPendingRequest,
    setModalType: connection.actions.setModalType,
    setError: connection.actions.setError,
    setIsLoading: connection.actions.setIsLoading,
    isConnected: connection.state.isConnected,
    isUnlocked,
    sendResponse,
    signSerializedTransaction,
  });

  const messageHandlers = useEmbeddedMessageHandlers({
    connectionActions: connection.actions,
    transactionHandlers: {
      handleSignTransaction: transaction.handleSignTransaction,
    },
    sendResponse,
  });

  const autoLockCountRef = useRef(autoLockCount);
  const lastEmittedAccountRef = useRef<string | null>(null);
  const {
    setIsConnected,
    setModalType,
    setPendingRequest,
    setIsLoading,
    setError,
    setAppMetadata,
  } = connection.actions;
  const { pendingRequest } = connection.state;
  const { setPassword } = unlock;

  useEffect(() => {
    const active =
      accounts.find(account => account.index === selectedAccountIndex) ??
      accounts[selectedAccountIndex];

    if (!active) {
      lastEmittedAccountRef.current = null;
      return;
    }

    const payloadAccount = {
      accountType: AddressType.THRU,
      address: active.publicKey,
      label: active.label ?? active.name ?? `Account ${active.index + 1}`,
    };

    if (lastEmittedAccountRef.current === payloadAccount.address) {
      return;
    }

    lastEmittedAccountRef.current = payloadAccount.address;
    sendEvent(EMBEDDED_PROVIDER_EVENTS.ACCOUNT_CHANGED, { account: payloadAccount });
  }, [accounts, selectedAccountIndex, sendEvent]);

  useEffect(() => {
    if (autoLockCount > autoLockCountRef.current) {
      if (pendingRequest) {
        sendResponse({
          id: pendingRequest.id,
          success: false,
          error: {
            code: ErrorCode.WALLET_LOCKED,
            message: 'Wallet auto-locked',
          },
        });
      }

      setIsConnected(false);
      setModalType(null);
      setPendingRequest(null);
      setIsLoading(false);
      setError(null);
      setAppMetadata(null);
      setPassword('');

      sendEvent(EMBEDDED_PROVIDER_EVENTS.LOCK, { reason: 'auto_lock' });
    }
    autoLockCountRef.current = autoLockCount;
  }, [
    autoLockCount,
    pendingRequest,
    sendEvent,
    sendResponse,
    setAppMetadata,
    setError,
    setIsConnected,
    setIsLoading,
    setModalType,
    setPendingRequest,
    setPassword,
  ]);

  const value = useMemo<EmbeddedFlowContextValue>(
    () => ({
      connection,
      unlock,
      transaction,
      accounts,
      selectedAccountIndex,
      selectAccount,
      messageHandlers,
    }),
    [accounts, connection, messageHandlers, selectAccount, selectedAccountIndex, transaction, unlock]
  );

  return (
    <EmbeddedFlowContext.Provider value={value}>
      <EmbeddedFlowView />
    </EmbeddedFlowContext.Provider>
  );
}

export function useEmbeddedFlowContext(): EmbeddedFlowContextValue {
  const context = useContext(EmbeddedFlowContext);
  if (!context) {
    throw new Error('useEmbeddedFlowContext must be used within EmbeddedFlowProvider');
  }
  return context;
}

function EmbeddedFlowView() {
  const { connection, unlock, transaction, accounts, selectedAccountIndex, messageHandlers } =
    useEmbeddedFlowContext();

  useEffect(() => {
    const readyMessage = {
      type: IFRAME_READY_EVENT,
      data: { ready: true },
    };
    window.parent.postMessage(readyMessage, '*');
  }, []);

  useEmbeddedMessageRouter(messageHandlers);

  const { state, actions } = connection;

  const handleApproveConnect = useCallback(() => {
    actions.approveConnection();
  }, [actions]);

  const handleReject = useCallback(() => {
    actions.handleReject();
    unlock.setPassword('');
  }, [actions, unlock]);

  if (!state.modalType) {
    return null
  }

  switch (state.modalType) {
    case 'connect':
      return (
        <ConnectModal
          origin={state.pendingRequest?.origin}
          metadata={state.appMetadata ?? undefined}
          error={state.error}
          isLoading={state.isLoading}
          onApprove={handleApproveConnect}
          onReject={handleReject}
        />
      );
    case 'unlock':
      return (
        <UnlockModal
          password={unlock.password}
          error={state.error}
          isLoading={state.isLoading}
          onPasswordChange={unlock.setPassword}
          onSubmit={unlock.handleUnlock}
          onCancel={handleReject}
        />
      );
    case 'approve-transaction': {
      const activeAccount =
        accounts.find(account => account.index === selectedAccountIndex) ??
        accounts[selectedAccountIndex] ??
        null;
      return (
        <TransactionApprovalModal
          account={activeAccount}
          requestType={state.pendingRequest?.type}
          error={state.error}
          isLoading={state.isLoading}
          onApprove={transaction.handleApproveTransaction}
          onReject={handleReject}
        />
      );
    }
    default:
      return null;
  }
}
