'use client';

/**
 * Zustand Store for Embedded App
 * 
 * This store consolidates all state management from multiple hooks into a single source of truth.
 * It replaces useConnectionFlow, useUnlockFlow, and useTransactionFlow.
 * 
 * Migration notes:
 * - External dependencies (accounts, isUnlocked, etc.) are passed as parameters to actions
 * - State is centralized here instead of scattered across hooks
 * - Actions are pure functions that update state
 */

import { AddressType, type WalletAccount } from '@thru/chain-interfaces';
import { ConnectedAppsStorage } from '@thru/indexed-db-stamper';
import { create } from 'zustand';
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
  type SignTransactionRequestMessage,
} from '../types';
import { resolveAppMetadata } from '../utils/appMetadata';

// External dependencies that come from props
export interface EmbeddedAppStoreDeps {
  accounts: Array<{ publicKey: string; index: number; label?: string }>;
  isUnlocked: boolean;
  refreshAccounts: () => Promise<void>;
  selectedAccountIndex: number;
  getFallbackAccounts: () => Promise<Array<{ publicKey: string; index: number }>>;
  selectAccount: (index: number) => void;
  sendResponse: <T extends PendingRequest>(response: any) => void;
  sendEvent: (eventName: EmbeddedProviderEvent, data?: any) => void;
  unlockWallet: (password: string) => Promise<void>;
  signSerializedTransaction: (accountIndex: number, serializedTransaction: string) => Promise<string>;
}

// Internal state managed by the store
interface EmbeddedAppStoreState {
  // Modal state
  modalType: ModalType;
  
  // Request state
  pendingRequest: PendingRequest | null;
  
  // Connection state
  isConnected: boolean;
  appMetadata: AppMetadata | null;
  connectCache: {
    origin: string;
    result: ConnectResult;
  } | null;
  
  // Loading and error state
  isLoading: boolean;
  error: string | null;
  
  // Unlock state
  password: string;
}

// Actions
interface EmbeddedAppStoreActions {
  // Connection actions
  handleConnect: (message: ConnectRequestMessage, event: MessageEvent, deps: EmbeddedAppStoreDeps) => Promise<void>;
  handleDisconnect: (message: DisconnectRequestMessage, deps: EmbeddedAppStoreDeps) => void;
  handleGetAccounts: (message: GetAccountsRequestMessage, deps: EmbeddedAppStoreDeps) => void;
  handleSelectAccount: (message: SelectAccountRequestMessage, deps: EmbeddedAppStoreDeps) => void;
  approveConnection: (options?: { skipUnlockCheck?: boolean; metadataOverride?: AppMetadata; }, deps?: EmbeddedAppStoreDeps) => Promise<void>;
  
  // Unlock actions
  setPassword: (password: string) => void;
  handleUnlock: (deps: EmbeddedAppStoreDeps) => Promise<void>;
  
  // Transaction actions
  handleSignTransaction: (message: SignTransactionRequestMessage, deps: EmbeddedAppStoreDeps) => void;
  handleApproveTransaction: (deps: EmbeddedAppStoreDeps) => Promise<void>;
  
  // Rejection/cancellation
  handleReject: (deps?: EmbeddedAppStoreDeps) => void;
  
  // State management
  resetState: () => void;
}

export type EmbeddedAppStore = EmbeddedAppStoreState & EmbeddedAppStoreActions;

// Helper to convert account-like objects to WalletAccount
const toWalletAccount = (account: { publicKey: string; index: number; label?: string }): WalletAccount => ({
  accountType: AddressType.THRU,
  address: account.publicKey,
  label: account.label ?? `Account ${account.index + 1}`,
});

/**
 * Main Zustand store for embedded app
 * 
 * This store manages all state and actions for the embedded wallet app.
 * External dependencies (accounts, isUnlocked, etc.) are passed as parameters to actions.
 */
export const useEmbeddedAppStore = create<EmbeddedAppStore>((set, get) => ({
  // Initial state
  modalType: null,
  pendingRequest: null,
  isConnected: false,
  appMetadata: null,
  connectCache: null,
  isLoading: false,
  error: null,
  password: '',

  // State management
  resetState: () => set({
    modalType: null,
    pendingRequest: null,
    appMetadata: null,
    isConnected: false,
    isLoading: false,
    error: null,
    password: '',
    connectCache: null,
  }),
  setPassword: (password) => set({ password }),

  // Connection actions
  approveConnection: async (options = {}, deps) => {
    if (!deps) {
      console.warn('[Embedded] approveConnection called without deps');
      return;
    }

    const { pendingRequest } = get();
    
    if (!pendingRequest) {
      console.warn('[Embedded] Approve connection called without pending request');
      return;
    }

    if (pendingRequest.type !== POST_MESSAGE_REQUEST_TYPES.CONNECT) {
      console.warn('[Embedded] Approve connection called for non-connect request type');
      return;
    }

    set({ isLoading: true, error: null });

    try {
      if (!options.skipUnlockCheck && !deps.isUnlocked) {
        set({ isLoading: false, modalType: 'unlock' });
        return;
      }

      set({ isConnected: true });

      const latestAccounts: Array<{ publicKey: string; index: number; label?: string }> =
        deps.accounts.length > 0 ? deps.accounts : await deps.getFallbackAccounts();

      if (deps.accounts.length === 0 && latestAccounts.length > 0) {
        deps.refreshAccounts().catch((err) =>
          console.error('[Embedded] Failed to refresh accounts after connect:', err)
        );
      }

      const resultAccounts = latestAccounts.map(toWalletAccount);

      const connectRequest = pendingRequest as ConnectRequestMessage;
      const fallbackMetadata = resolveAppMetadata(
        connectRequest.origin,
        connectRequest.payload?.metadata
      );

      const metadataForResult = options.metadataOverride || get().appMetadata || fallbackMetadata || null;

      if (metadataForResult) {
        try {
          await Promise.all(
            latestAccounts.map((acc) =>
              ConnectedAppsStorage.upsert({
                accountId: acc.index,
                appId: metadataForResult.appId,
                origin: connectRequest.origin,
                metadata: metadataForResult,
              })
            )
          );
        } catch (storageError) {
          console.error('[Embedded] Failed to persist connected app metadata:', storageError);
        }
      }

      const result: ConnectResult = {
        accounts: resultAccounts,
        status: 'completed',
        metadata: metadataForResult,
      };

      set({
        connectCache: {
          origin: connectRequest.origin,
          result,
        },
      });

      deps.sendResponse<ConnectRequestMessage>({ id: connectRequest.id, success: true, result });
      deps.sendEvent(EMBEDDED_PROVIDER_EVENTS.CONNECT, {
        ...result,
      });

      set({ modalType: null, pendingRequest: null, appMetadata: metadataForResult ?? null });
    } catch (err) {
      console.error('[Embedded] Error approving connect:', err);
      set({ error: err instanceof Error ? err.message : 'Connection failed' });
    } finally {
      set({ isLoading: false });
    }
  },

  handleConnect: async (message, event, deps) => {
    const { isConnected, connectCache } = get();

    // Check cache for same origin
    if (isConnected && connectCache?.origin === event.origin) {
      deps.sendResponse<ConnectRequestMessage>({
        id: message.id,
        success: true,
        result: connectCache.result,
      });

      deps.sendEvent(EMBEDDED_PROVIDER_EVENTS.CONNECT, {
        ...connectCache.result,
      });

      set({
        pendingRequest: null,
        modalType: null,
        appMetadata: connectCache.result.metadata ?? null,
        error: null,
      });
      return;
    }

    // Reject if already connected to different origin
    if (isConnected) {
      deps.sendResponse<ConnectRequestMessage>({
        id: message.id,
        success: false,
        error: {
          code: ErrorCode.ALREADY_CONNECTED,
          message: 'Wallet already connected',
        },
      });
      return;
    }

    // Set pending request
    set({ pendingRequest: { ...message, origin: event.origin } });

    const pendingMetadata =
      get().pendingRequest?.type === POST_MESSAGE_REQUEST_TYPES.CONNECT
        ? resolveAppMetadata(get().pendingRequest!.origin, (get().pendingRequest as ConnectRequestMessage).payload?.metadata)
        : null;

    const resolvedMetadata = resolveAppMetadata(event.origin, message.payload?.metadata);
    const metadata = pendingMetadata ?? resolvedMetadata;
    set({ appMetadata: metadata });

    const suppliedMetadata = message.payload?.metadata;

    if (!suppliedMetadata) {
      set({ modalType: 'connect' });
      return;
    }

    try {
      const existing = await ConnectedAppsStorage.get(deps.selectedAccountIndex, metadata.appId);

      if (existing) {
        if (!deps.isUnlocked) {
          set({ modalType: 'unlock' });
          return;
        }

        await get().approveConnection({ skipUnlockCheck: true, metadataOverride: metadata }, deps);
        return;
      }
    } catch (err) {
      console.error('[Embedded] Failed to check connected apps store:', err);
    }

    set({ modalType: 'connect' });
  },

  handleDisconnect: (message, deps) => {
    set({
      isConnected: false,
      modalType: null,
      pendingRequest: null,
      appMetadata: null,
      connectCache: null,
    });

    deps.sendResponse<DisconnectRequestMessage>({ id: message.id, success: true, result: {} });
    deps.sendEvent(EMBEDDED_PROVIDER_EVENTS.DISCONNECT, {});
  },

  handleGetAccounts: (message, deps) => {
    const { isConnected } = get();

    if (!isConnected) {
      deps.sendResponse<GetAccountsRequestMessage>({
        id: message.id,
        success: false,
        error: {
          code: ErrorCode.WALLET_LOCKED,
          message: 'Wallet not connected',
        },
      });
      return;
    }

    const resultAccounts = deps.accounts.map(toWalletAccount);

    deps.sendResponse<GetAccountsRequestMessage>({
      id: message.id,
      success: true,
      result: { accounts: resultAccounts },
    });
  },

  handleSelectAccount: (message, deps) => {
    const { isConnected } = get();

    if (!isConnected) {
      deps.sendResponse<SelectAccountRequestMessage>({
        id: message.id,
        success: false,
        error: {
          code: ErrorCode.WALLET_LOCKED,
          message: 'Wallet not connected',
        },
      });
      return;
    }

    const account = deps.accounts.find((acc) => acc.publicKey === message.payload.publicKey);
    if (!account) {
      deps.sendResponse<SelectAccountRequestMessage>({
        id: message.id,
        success: false,
        error: {
          code: ErrorCode.UNKNOWN_ERROR,
          message: 'Account not found',
        },
      });
      return;
    }

    deps.selectAccount(account.index);

    deps.sendResponse<SelectAccountRequestMessage>({
      id: message.id,
      success: true,
      result: { account: toWalletAccount(account) },
    });

    deps.sendEvent(EMBEDDED_PROVIDER_EVENTS.ACCOUNT_CHANGED, { account: toWalletAccount(account) });
  },

  // Unlock actions
  handleUnlock: async (deps) => {
    const { password, pendingRequest } = get();

    if (!password) {
      set({ error: 'Password required' });
      return;
    }

    set({ isLoading: true, error: null });

    try {
      await deps.unlockWallet(password);
      set({ password: '' });

      if (pendingRequest?.type === POST_MESSAGE_REQUEST_TYPES.CONNECT) {
        await get().approveConnection({ skipUnlockCheck: true }, deps);
      } else {
        set({ modalType: 'approve-transaction' });
      }
    } catch (err) {
      console.error('[Embedded] Unlock failed:', err);
      set({ error: 'Incorrect password', password: '' });
    } finally {
      set({ isLoading: false });
    }
  },

  // Transaction actions
  handleSignTransaction: (message, deps) => {
    const { isConnected } = get();

    if (!isConnected) {
      deps.sendResponse<SignTransactionRequestMessage>({
        id: message.id,
        success: false,
        error: {
          code: ErrorCode.WALLET_LOCKED,
          message: 'Wallet not connected',
        },
      });
      return;
    }

    set({ pendingRequest: { ...message, origin: message.origin }, appMetadata: null });

    if (!deps.isUnlocked) {
      set({ modalType: 'unlock' });
    } else {
      set({ modalType: 'approve-transaction' });
    }
  },

  handleApproveTransaction: async (deps) => {
    const { pendingRequest } = get();

    if (!pendingRequest) {
      console.warn('[Embedded] Approve transaction called without pending request');
      return;
    }

    set({ isLoading: true, error: null });

    try {
      const selectedAccount = deps.accounts[deps.selectedAccountIndex];
      if (!selectedAccount) {
        throw new Error('No account selected');
      }

      if (pendingRequest.type !== POST_MESSAGE_REQUEST_TYPES.SIGN_TRANSACTION) {
        throw new Error(`Unsupported request type: ${pendingRequest.type}`);
      }

      const signRequest = pendingRequest as SignTransactionRequestMessage;
      const serializedTransaction = signRequest.payload.transaction;
      if (typeof serializedTransaction !== 'string' || serializedTransaction.length === 0) {
        throw new Error('Missing transaction payload');
      }

      const signedTransaction = await deps.signSerializedTransaction(
        selectedAccount.index,
        serializedTransaction
      );

      deps.sendResponse<SignTransactionRequestMessage>({
        id: pendingRequest.id,
        success: true,
        result: { signedTransaction },
      });

      set({ modalType: null, pendingRequest: null });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Transaction failed';
      set({ error: message });

      deps.sendResponse<SignTransactionRequestMessage>({
        id: pendingRequest.id,
        success: false,
        error: {
          code: ErrorCode.UNKNOWN_ERROR,
          message,
        },
      });

      set({ pendingRequest: null, modalType: null });
    } finally {
      set({ isLoading: false });
    }
  },

  // Rejection
  handleReject: (deps?: EmbeddedAppStoreDeps) => {
    const { pendingRequest } = get();
    
    if (pendingRequest && deps) {
      deps.sendResponse({
        id: pendingRequest.id,
        success: false,
        error: {
          code: ErrorCode.USER_REJECTED,
          message: 'User rejected the request',
        },
      });
    }

    set({
      modalType: null,
      pendingRequest: null,
      appMetadata: null,
      error: null,
      password: '',
    });
  },
}));

