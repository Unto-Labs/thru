'use client';

import { NetworkType, WalletManager } from '@/lib/wallet/wallet-manager';
import { workerClient } from '@/lib/worker/worker-client';
import { DerivedAccount } from '@/types/account';
import { WORKER_EVENT_TYPE } from '@/types/worker-messages';
import { AddressType, type ConnectedApp } from '@thru/chain-interfaces';
import { AccountStorage, ConnectedAppsStorage, WalletStorage } from '@thru/indexed-db-stamper';
import { ConsensusStatus } from '@thru/thru-sdk';
import { createThruClient } from '@thru/thru-sdk/client';
import React, { createContext, useCallback, useEffect, useState } from 'react';

const uint8ArrayToBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return globalThis.btoa(binary);
};

const base64ToUint8Array = (value: string): Uint8Array => {
  const binary = globalThis.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

export interface WalletContextState {
  // Status
  isInitialized: boolean;
  walletExists: boolean;
  isUnlocked: boolean;
  isLoading: boolean;
  autoLockCount: number;

  // Data
  accounts: DerivedAccount[];
  balances: Map<number, bigint>;
  selectedAccountIndex: number;
  connectedApps: ConnectedApp[];

  isConnectedAppsLoading: boolean;

  // Network
  network: NetworkType;

  // Operations - Wallet Lifecycle
  createWallet: (password: string, mnemonic?: string) => Promise<{ mnemonic: string }>;
  importWallet: (mnemonic: string, password: string) => Promise<void>;
  unlockWallet: (password: string) => Promise<void>;
  lockWallet: () => void;

  // Operations - Accounts
  createAccount: (label?: string) => Promise<void>;
  renameAccount: (index: number, label: string) => Promise<void>;
  selectAccount: (index: number) => void;
  refreshBalances: () => Promise<void>;
  refreshAccounts: () => Promise<void>;

  // Operations - Transactions
  sendTransfer: (to: string, amount: bigint) => Promise<string>;

  // Connected apps
  refreshConnectedApps: (accountIndex?: number) => Promise<void>;
  revokeConnectedApp: (accountIndex: number, appId: string) => Promise<void>;

  // Utilities
  setNetwork: (network: NetworkType) => void;
}

export const WalletContext = createContext<WalletContextState | null>(null);

interface WalletProviderProps {
  children: React.ReactNode;
}

/**
 * WalletProvider - Always uses Web Worker for security
 * All private key operations happen in isolated worker thread
 */
export function WalletProvider({ children }: WalletProviderProps) {
  // Status
  const [isInitialized, setIsInitialized] = useState(false);
  const [walletExists, setWalletExists] = useState(false);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [autoLockCount, setAutoLockCount] = useState(0);

  // Data
  const [accounts, setAccounts] = useState<DerivedAccount[]>([]);
  const [balances, setBalances] = useState<Map<number, bigint>>(new Map());
  const [selectedAccountIndex, setSelectedAccountIndex] = useState(0);
  const [connectedApps, setConnectedApps] = useState<ConnectedApp[]>([]);
  const [isConnectedAppsLoading, setIsConnectedAppsLoading] = useState(false);

  // Network
  const [network, setNetwork] = useState<NetworkType>('default');

  const refreshConnectedApps = useCallback(
    async (accountIndex?: number): Promise<void> => {
      const targetIndex = accountIndex ?? selectedAccountIndex;
      setIsConnectedAppsLoading(true);
      try {
        const apps = await ConnectedAppsStorage.listByAccount(targetIndex);
        setConnectedApps(apps);
      } catch (error) {
        console.error('[WalletProvider] Failed to refresh connected apps:', error);
        setConnectedApps([]);
      } finally {
        setIsConnectedAppsLoading(false);
      }
    },
    [selectedAccountIndex]
  );

  // Initialize wallet and worker on mount
  useEffect(() => {
    const init = async () => {
      // Initialize worker first (only if not already initialized)
      if (typeof window !== 'undefined' && !workerClient.isInitialized()) {
        try {
          workerClient.initialize();
          console.log('[WalletProvider] Worker initialized (new instance)');
        } catch (error) {
          console.error('[WalletProvider] Failed to initialize worker:', error);
        }
      } else if (workerClient.isInitialized()) {
        console.log('[WalletProvider] Worker already initialized, reusing existing instance');
      }

      // Then initialize wallet (which may check if worker is unlocked)
      await initializeWallet();
    };

    init();

    // DO NOT terminate worker on unmount - we want it to persist across page navigations
    // Worker will stay alive for the browser session and maintain its state (unlocked seed)
    // This allows seamless navigation between pages without re-entering password
  }, []);

  // Listen for worker auto-lock events
  useEffect(() => {
    const handleAutoLock = () => {
      console.log('[WalletProvider] Worker auto-locked, resetting state');
      setIsUnlocked(false);
      setAccounts([]);
      setBalances(new Map());
      setSelectedAccountIndex(0);
      setAutoLockCount((count) => count + 1);
      setConnectedApps([]);
      setIsConnectedAppsLoading(false);
    };

    workerClient.onEvent(WORKER_EVENT_TYPE.AUTO_LOCK, handleAutoLock);
    return () => {
      workerClient.offEvent(WORKER_EVENT_TYPE.AUTO_LOCK, handleAutoLock);
    };
  }, []);

  useEffect(() => {
    if (!isUnlocked) {
      setConnectedApps([]);
      setIsConnectedAppsLoading(false);
      return;
    }

    refreshConnectedApps().catch((error) => {
      console.error('[WalletProvider] Failed to refresh connected apps:', error);
    });
  }, [isUnlocked, selectedAccountIndex, refreshConnectedApps]);

  // Initialize wallet - check if wallet exists and if worker is still unlocked
  const initializeWallet = async () => {
    try {
      const exists = await WalletManager.checkWalletExists();
      setWalletExists(exists);

      // Check if worker is still unlocked (within 15 min window)
      if (exists && workerClient.isInitialized()) {
        try {
          // Small delay to ensure worker is fully initialized
          await new Promise(resolve => setTimeout(resolve, 100));

          const unlocked = await workerClient.isUnlocked();

          if (unlocked) {
            setIsUnlocked(true);
            // Load accounts if wallet is still unlocked
            const loadedAccounts = await AccountStorage.getAccounts();
            // Note: We don't have keypairs since they're in the worker,
            // but the UI doesn't need them
            setAccounts(loadedAccounts as any);
            await refreshConnectedApps(loadedAccounts[0]?.index ?? 0);
          }
        } catch (error) {
          console.error('[WalletProvider] Failed to check worker unlock status:', error);
        }
      }

      setIsInitialized(true);
    } catch (error) {
      console.error('Failed to initialize wallet:', error);
      setIsInitialized(true);
    }
  };

  // Create a new wallet
  const createWallet = useCallback(
    async (password: string, mnemonic?: string): Promise<{ mnemonic: string }> => {
      setIsLoading(true);
      try {
        const result = await WalletManager.createWallet(password, mnemonic);
        setWalletExists(true);
        return result;
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  // Import existing wallet
  const importWallet = useCallback(async (mnemonic: string, password: string): Promise<void> => {
    setIsLoading(true);
    try {
      await WalletManager.createWallet(password, mnemonic);
      setWalletExists(true);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadBalances = useCallback(
    async (publicKeys: string[]) => {
      try {
        const newBalances = await WalletManager.getBalances(publicKeys, network);
        setBalances(newBalances);
      } catch (error) {
        console.error('Failed to load balances:', error);
      }
    },
    [network]
  );

  const loadAccounts = useCallback(async () => {
    try {
      const loadedAccounts = await WalletManager.getAccounts();
      setAccounts(loadedAccounts);

      if (loadedAccounts.length > 0) {
        await loadBalances(loadedAccounts.map((a) => a.publicKey));
      }
    } catch (error) {
      console.error('Failed to load accounts:', error);
      throw error;
    }
  }, [loadBalances]);

  // Unlock wallet with password (always uses worker)
  const unlockWallet = useCallback(
    async (password: string): Promise<void> => {
      setIsLoading(true);
      try {
        const encrypted = await WalletStorage.getEncryptedSeed();
        if (!encrypted) {
          throw new Error('Wallet not found');
        }

        await workerClient.unlock(encrypted, password);
        setIsUnlocked(true);

        await loadAccounts();
        await refreshConnectedApps();
      } finally {
        setIsLoading(false);
      }
    },
    [loadAccounts, refreshConnectedApps]
  );

  // Lock wallet (always uses worker)
  const lockWallet = useCallback(async () => {
    try {
      await workerClient.lock();
    } catch (error) {
      console.error('[WalletProvider] Error locking worker:', error);
    }

    setIsUnlocked(false);
    setAccounts([]);
    setBalances(new Map());
    setSelectedAccountIndex(0);
    setConnectedApps([]);
    setIsConnectedAppsLoading(false);
  }, []);

  const revokeConnectedApp = useCallback(
    async (accountId: number, appId: string): Promise<void> => {
      try {
        await ConnectedAppsStorage.remove(accountId, appId);
      } catch (error) {
        console.error('[WalletProvider] Failed to revoke connected app:', error);
        throw error;
      }

      if (accountId === selectedAccountIndex) {
        await refreshConnectedApps(accountId);
      }
    },
    [refreshConnectedApps, selectedAccountIndex]
  );

  // Create a new account (worker-based)
  const createAccount = useCallback(
    async (label?: string): Promise<void> => {
      if (!isUnlocked) {
        throw new Error('Wallet is locked');
      }

      setIsLoading(true);
      try {
        // Get next account index
        const nextIndex = await AccountStorage.getNextAccountIndex();

        // Derive account in worker to get address and derivation path
        const derivedAccount = await workerClient.deriveAccount(nextIndex);
        const accountLabel = label || `Account ${nextIndex + 1}`;

        const sdk = createThruClient({});
        const transaction = await sdk.accounts.create({
          publicKey: derivedAccount.publicKey,
        });

        const unsignedBytes = transaction.toWireForSigning();
        const unsignedBase64 = uint8ArrayToBase64(unsignedBytes);
        const signedBase64 = await workerClient.signSerializedTransaction(nextIndex, unsignedBase64);
        const signedBytes = base64ToUint8Array(signedBase64);

        const signature = await sdk.transactions.send(signedBytes);

        let finalized = false;
        try {
          for await (const update of sdk.transactions.track(signature, { timeoutMs: 60000 })) {
            if (
              update.consensusStatus === ConsensusStatus.FINALIZED ||
              update.consensusStatus === ConsensusStatus.CLUSTER_EXECUTED
            ) {
              finalized = true;
              break;
            }
          }
        } catch (error) {
          console.warn('[WalletProvider] Account creation track error:', error);
        }

        if (!finalized) {
          throw new Error('Account creation transaction was not finalized');
        }

        await AccountStorage.saveAccount({
          index: nextIndex,
          label: accountLabel,
          publicKey: derivedAccount.publicKey,
          path: derivedAccount.path,
          createdAt: new Date(),
          addressType: AddressType.THRU,
        });

        await loadAccounts();
        setSelectedAccountIndex(nextIndex);
      } finally {
        setIsLoading(false);
      }
    },
    [isUnlocked, loadAccounts]
  );

  // Rename account
  const renameAccount = useCallback(async (index: number, label: string): Promise<void> => {
    await WalletManager.renameAccount(index, label);

    // Update local state
    setAccounts((prev) =>
      prev.map((acc) => (acc.index === index ? { ...acc, label } : acc))
    );
  }, []);

  // Select account
  const selectAccount = useCallback((index: number) => {
    setSelectedAccountIndex(index);
  }, []);

  // Refresh balances
  const refreshBalances = useCallback(async (): Promise<void> => {
    if (accounts.length === 0) return;

    try {
      const publicKeys = accounts.map((a) => a.publicKey);
      await loadBalances(publicKeys);
    } catch (error) {
      console.error('Failed to refresh balances:', error);
    }
  }, [accounts, loadBalances]);

  // Refresh accounts (reload from storage)
  const refreshAccounts = useCallback(async (): Promise<void> => {
    try {
      await loadAccounts();
    } catch (error) {
      console.error('Failed to refresh accounts:', error);
    }
  }, [loadAccounts]);

  // Send transfer (worker-based signing)
  const sendTransfer = useCallback(
    async (to: string, amount: bigint): Promise<string> => {
      if (!isUnlocked) {
        throw new Error('Wallet is locked');
      }

      // Get selected account's public key
      const selectedAccount = accounts.find((a) => a.index === selectedAccountIndex);
      if (!selectedAccount) {
        throw new Error('No account selected');
      }

      // Use worker for signing
      const signature = await WalletManager.sendTransfer(
        workerClient,
        selectedAccountIndex,
        selectedAccount.publicKey,
        to,
        amount,
        network
      );

      setTimeout(() => {
        refreshBalances().catch((error) => {
          console.error('Failed to refresh balances after transfer:', error);
        });
      }, 2000);

      return signature;
    },
    [isUnlocked, selectedAccountIndex, network, accounts, refreshBalances]
  );

  const contextValue: WalletContextState = {
    // Status
    isInitialized,
    walletExists,
    isUnlocked,
    isLoading,
    autoLockCount,

    // Data
    accounts,
    balances,
    selectedAccountIndex,
    connectedApps,
    isConnectedAppsLoading,

    // Network
    network,

    // Operations - Wallet Lifecycle
    createWallet,
    importWallet,
    unlockWallet,
    lockWallet,

    // Operations - Accounts
    createAccount,
    renameAccount,
    selectAccount,
    refreshBalances,
    refreshAccounts,

    // Operations - Transactions
    sendTransfer,

    // Connected apps
    refreshConnectedApps,
    revokeConnectedApp,

    // Utilities
    setNetwork,
  };

  return <WalletContext.Provider value={contextValue}>{children}</WalletContext.Provider>;
}
