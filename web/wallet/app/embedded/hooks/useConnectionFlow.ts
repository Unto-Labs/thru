'use client';

import { AddressType, type WalletAccount } from '@thru/chain-interfaces';
import { ConnectedAppsStorage } from '@thru/indexed-db-stamper';
import { useCallback, useRef, useState } from 'react';
import {
  EMBEDDED_PROVIDER_EVENTS,
  ErrorCode,
  POST_MESSAGE_REQUEST_TYPES,
  type AppMetadata,
  type ConnectRequestMessage,
  type ConnectResult,
  type DisconnectRequestMessage,
  type EmbeddedProviderEvent,
  type GetAccountsRequestMessage,
  type ModalType,
  type PendingRequest,
  type SelectAccountRequestMessage,
  type SendResponseFn,
} from '../types';
import { resolveAppMetadata } from '../utils/appMetadata';

export interface ApproveConnectionOptions {
  skipUnlockCheck?: boolean;
  metadataOverride?: AppMetadata;
  autoApproved?: boolean;
}

type AccountLike = { publicKey: string; index: number; label?: string; };

const toWalletAccount = (account: AccountLike): WalletAccount => ({
  accountType: AddressType.THRU,
  address: account.publicKey,
  label: account.label ?? `Account ${account.index + 1}`,
});

export interface ConnectionFlowDeps {
  accounts: Array<AccountLike>;
  isUnlocked: boolean;
  refreshAccounts: () => Promise<void>;
  selectedAccountIndex: number;
  getFallbackAccounts: () => Promise<Array<AccountLike>>;
  selectAccount: (index: number) => void;
  sendResponse: SendResponseFn;
  sendEvent: (eventName: EmbeddedProviderEvent, data?: any) => void;
}

export interface ConnectionFlowState {
  modalType: ModalType;
  pendingRequest: PendingRequest | null;
  appMetadata: AppMetadata | null;
  isConnected: boolean;
  isLoading: boolean;
  error: string | null;
}

export interface ConnectionFlowActions {
  setModalType: (value: ModalType) => void;
  setPendingRequest: (value: PendingRequest | null) => void;
  setAppMetadata: (value: AppMetadata | null) => void;
  setIsConnected: (value: boolean) => void;
  setIsLoading: (value: boolean) => void;
  setError: (value: string | null) => void;
  approveConnection: (options?: ApproveConnectionOptions) => Promise<void>;
  handleConnect: (message: ConnectRequestMessage, event: MessageEvent) => Promise<void>;
  handleDisconnect: (message: DisconnectRequestMessage) => void;
  handleGetAccounts: (message: GetAccountsRequestMessage) => void;
  handleSelectAccount: (message: SelectAccountRequestMessage) => void;
  handleReject: () => void;
}

export interface ConnectionFlowHook {
  state: ConnectionFlowState;
  actions: ConnectionFlowActions;
}

export function useConnectionFlow({
  accounts,
  isUnlocked,
  refreshAccounts,
  selectedAccountIndex,
  getFallbackAccounts,
  selectAccount,
  sendResponse,
  sendEvent,
}: ConnectionFlowDeps): ConnectionFlowHook {
  const [modalType, setModalType] = useState<ModalType>(null);
  const [pendingRequest, setPendingRequest] = useState<PendingRequest | null>(null);
  const [appMetadata, setAppMetadata] = useState<AppMetadata | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connectCacheRef = useRef<{
    origin: string;
    result: ConnectResult;
    autoApproved: boolean;
  } | null>(null);

  const approveConnection = useCallback(
    async (options: ApproveConnectionOptions = {}) => {
      if (!pendingRequest) {
        console.warn('[Embedded] Approve connection called without pending request');
        return;
      }

      if (pendingRequest.type !== POST_MESSAGE_REQUEST_TYPES.CONNECT) {
        console.warn('[Embedded] Approve connection called for non-connect request type');
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        if (!options.skipUnlockCheck && !isUnlocked) {
          setIsLoading(false);
          setModalType('unlock');
          return;
        }

        setIsConnected(true);

        const latestAccounts: AccountLike[] =
          accounts.length > 0 ? accounts : await getFallbackAccounts();

        if (accounts.length === 0 && latestAccounts.length > 0) {
          refreshAccounts().catch((err) =>
            console.error('[Embedded] Failed to refresh accounts after connect:', err)
          );
        }

        const resultAccounts = latestAccounts.map(toWalletAccount);

        const fallbackMetadata = resolveAppMetadata(
          pendingRequest.origin,
          pendingRequest.payload.metadata
        );

        const metadataForResult = options.metadataOverride || appMetadata || fallbackMetadata || null;

        if (metadataForResult) {
          try {
            await Promise.all(
              latestAccounts.map((acc) =>
                ConnectedAppsStorage.upsert({
                  accountId: acc.index,
                  appId: metadataForResult.appId,
                  origin: pendingRequest.origin,
                  metadata: metadataForResult,
                })
              )
            );
          } catch (storageError) {
            console.error('[Embedded] Failed to persist connected app metadata:', storageError);
          }
        }

        const connectRequest = pendingRequest as ConnectRequestMessage;

        const result: ConnectResult = {
          accounts: resultAccounts,
          status: 'completed',
          metadata: metadataForResult,
        };

        connectCacheRef.current = {
          origin: pendingRequest.origin,
          result,
          autoApproved: options.autoApproved ?? false,
        };

        sendResponse<ConnectRequestMessage>({ id: connectRequest.id, success: true, result });
        sendEvent(
          EMBEDDED_PROVIDER_EVENTS.CONNECT,
          {
            ...result,
            autoApproved: options.autoApproved ?? false,
          }
        );

        setModalType(null);
        setPendingRequest(null);
        setAppMetadata(result.metadata ?? null);
      } catch (err) {
        console.error('[Embedded] Error approving connect:', err);
        setError(err instanceof Error ? err.message : 'Connection failed');
      } finally {
        setIsLoading(false);
      }
    },
    [
      accounts,
      appMetadata,
      getFallbackAccounts,
      isUnlocked,
      pendingRequest,
      refreshAccounts,
      sendEvent,
      sendResponse,
    ]
  );

  const handleConnect = useCallback(
    async (message: ConnectRequestMessage, event: MessageEvent) => {
      const cached = connectCacheRef.current;

      if (isConnected && cached?.origin === event.origin) {
        sendResponse<ConnectRequestMessage>({
          id: message.id,
          success: true,
          result: cached.result,
        });

        sendEvent(EMBEDDED_PROVIDER_EVENTS.CONNECT, {
          ...cached.result,
          autoApproved: cached.autoApproved,
        });

        setPendingRequest(null);
        setModalType(null);
        setAppMetadata(cached.result.metadata ?? null);
        setError(null);
        return;
      }

      if (isConnected) {
        sendResponse<ConnectRequestMessage>({
          id: message.id,
          success: false,
          error: {
            code: ErrorCode.ALREADY_CONNECTED,
            message: 'Wallet already connected',
          },
        });
        return;
      }

      const pendingMetadata =
        pendingRequest?.type === POST_MESSAGE_REQUEST_TYPES.CONNECT
          ? resolveAppMetadata(pendingRequest.origin, pendingRequest.payload.metadata)
          : null;

      const resolvedMetadata = resolveAppMetadata(event.origin, message.payload?.metadata);
      const metadata = pendingMetadata ?? resolvedMetadata;
      setAppMetadata(metadata);

      const suppliedMetadata =
        pendingRequest?.type === POST_MESSAGE_REQUEST_TYPES.CONNECT
          ? pendingRequest.payload.metadata
          : message.payload?.metadata;

      if (!suppliedMetadata) {
        setModalType('connect');
        return;
      }

      try {
        const existing = await ConnectedAppsStorage.get(selectedAccountIndex, metadata.appId);

        if (existing) {
          if (!isUnlocked) {
            setModalType('unlock');
            return;
          }

          await approveConnection({ skipUnlockCheck: true, metadataOverride: metadata, autoApproved: true });
          return;
        }
      } catch (err) {
        console.error('[Embedded] Failed to check connected apps store:', err);
      }

      setModalType('connect');
    },
    [approveConnection, isConnected, isUnlocked, pendingRequest, selectedAccountIndex, sendResponse]
  );

  const handleDisconnect = useCallback(
    (message: DisconnectRequestMessage) => {
      setIsConnected(false);
      setModalType(null);
      setPendingRequest(null);
      setAppMetadata(null);
      connectCacheRef.current = null;

      sendResponse<DisconnectRequestMessage>({ id: message.id, success: true, result: {} });
      sendEvent(EMBEDDED_PROVIDER_EVENTS.DISCONNECT, {});
    },
    [sendEvent, sendResponse]
  );

  const handleGetAccounts = useCallback(
    (message: GetAccountsRequestMessage) => {
      if (!isConnected) {
        sendResponse<GetAccountsRequestMessage>({
          id: message.id,
          success: false,
          error: {
            code: ErrorCode.WALLET_LOCKED,
            message: 'Wallet not connected',
          },
        });
        return;
      }

      const resultAccounts = accounts.map(toWalletAccount);

      sendResponse<GetAccountsRequestMessage>({
        id: message.id,
        success: true,
        result: { accounts: resultAccounts },
      });
    },
    [accounts, isConnected, sendResponse]
  );

  const handleSelectAccount = useCallback(
    (message: SelectAccountRequestMessage) => {
      if (!isConnected || !isUnlocked) {
        sendResponse<SelectAccountRequestMessage>({
          id: message.id,
          success: false,
          error: {
            code: ErrorCode.WALLET_LOCKED,
            message: isConnected ? 'Wallet locked' : 'Wallet not connected',
          },
        });
        return;
      }

      const publicKey = message.payload?.publicKey;

      if (!publicKey) {
        sendResponse<SelectAccountRequestMessage>({
          id: message.id,
          success: false,
          error: {
            code: ErrorCode.UNKNOWN_ERROR,
            message: 'Missing public key in selectAccount payload',
          },
        });
        return;
      }

      const target = accounts.find(account => account.publicKey === publicKey);

      if (!target) {
        sendResponse<SelectAccountRequestMessage>({
          id: message.id,
          success: false,
          error: {
            code: ErrorCode.ACCOUNT_NOT_FOUND,
            message: 'Requested account not found',
          },
        });
        return;
      }

      selectAccount(target.index);

      const walletAccount = toWalletAccount(target);
      sendResponse<SelectAccountRequestMessage>({
        id: message.id,
        success: true,
        result: { account: walletAccount },
      });
    },
    [accounts, isConnected, isUnlocked, selectAccount, sendResponse]
  );

  const handleReject = useCallback(() => {
    if (!pendingRequest) {
      return;
    }

    sendResponse({
      id: pendingRequest.id,
      success: false,
      error: {
        code: ErrorCode.USER_REJECTED,
        message: 'User rejected the request',
      },
    });

    setModalType(null);
    setPendingRequest(null);
    setAppMetadata(null);
    setError(null);
  }, [pendingRequest, sendResponse]);

  return {
    state: {
      modalType,
      pendingRequest,
      appMetadata,
      isConnected,
      isLoading,
      error,
    },
    actions: {
      setModalType,
      setPendingRequest,
      setAppMetadata,
      setIsConnected,
      setIsLoading,
      setError,
      approveConnection,
      handleConnect,
      handleDisconnect,
      handleGetAccounts,
      handleSelectAccount,
      handleReject,
    },
  };
}
