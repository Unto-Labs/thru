'use client';

import {
  normalizeActiveWalletAccounts,
  normalizeWalletAccountResult,
  type WalletAccount,
} from '../interfaces';
import { BrowserSDK, type BrowserSDKConfig } from '../BrowserSDK';
import type { ManageAccountsResult } from '../protocol';
import type { Thru } from '@thru/sdk/client';
import { ReactNode, useCallback, useEffect, useState } from 'react';
import { ThruContext } from './ThruContext';

export interface ThruProviderProps {
  children: ReactNode;
  config: BrowserSDKConfig;
}

/**
 * ThruProvider - React context provider for Thru Wallet SDK
 * Wraps the BrowserSDK and exposes state via context
 */
export function ThruProvider({ children, config }: ThruProviderProps) {
  const [sdk, setSdk] = useState<BrowserSDK | null>(null);
  const [thru, setThru] = useState<Thru | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [accounts, setAccounts] = useState<WalletAccount[]>([]);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [selectedAccount, setSelectedAccount] = useState<WalletAccount | null>(null);

  useEffect(() => {
    // Create SDK instance
    const sdkInstance = new BrowserSDK(config);
    setSdk(sdkInstance);
    setThru(sdkInstance.getThru());

    const updateAccountsFromSdk = () => {
      const active = normalizeActiveWalletAccounts(
        sdkInstance.getAccounts(),
        sdkInstance.getSelectedAccount()
      );
      setAccounts(active.accounts);
      setSelectedAccount(active.selectedAccount);
    };

    const updateSelectedAccount = (account?: WalletAccount | null) => {
      const active = normalizeActiveWalletAccounts(
        sdkInstance.getAccounts(),
        account ?? sdkInstance.getSelectedAccount()
      );
      setAccounts(active.accounts);
      setSelectedAccount(active.selectedAccount);
    };

    sdkInstance.initialize().catch((err) => {
      console.error('Failed to initialize SDK:', err);
      setError(err);
    });

    // Listen to SDK events
    const handleConnect = (result: any) => {
      // Check if this is the initial "connecting" status or actual connection
      if (result.status === 'connecting') {
        setIsConnecting(true);
        setError(null);
      } else {
        setIsConnected(true);
        updateAccountsFromSdk();
        setIsConnecting(false);
        setError(null);
        updateSelectedAccount(result?.selectedAccount ?? null);
      }
    };

    const resetData = () => {
      setIsConnected(false);
      setAccounts([]);
      setIsConnecting(false);
      setSelectedAccount(null);
    };

    const handleDisconnect = () => {
      resetData();
    };

    const handleError = (err: any) => {
      setError(err.error || new Error('Unknown error'));
      setIsConnecting(false);
    };

    const handleLock = () => {
      resetData();
    };

    const handleAccountChanged = (account: WalletAccount | null | undefined) => {
      updateAccountsFromSdk();
      updateSelectedAccount(account ?? undefined);
    };

    sdkInstance.on('connect', handleConnect);
    sdkInstance.on('disconnect', handleDisconnect);
    sdkInstance.on('error', handleError);
    sdkInstance.on('lock', handleLock);
    sdkInstance.on('accountChanged', handleAccountChanged);

    // Cleanup on unmount
    return () => {
      sdkInstance.off('connect', handleConnect);
      sdkInstance.off('disconnect', handleDisconnect);
      sdkInstance.off('error', handleError);
      sdkInstance.off('lock', handleLock);
      sdkInstance.off('accountChanged', handleAccountChanged);
      sdkInstance.destroy();
    };
  }, []); // Empty dependency array - only create SDK once

  const selectAccount = useCallback(async (account: WalletAccount) => {
    if (!sdk) {
      throw new Error('BrowserSDK not initialized');
    }

    try {
      const updated = await sdk.selectAccount(account.address);
      const active = normalizeActiveWalletAccounts(sdk.getAccounts(), updated);
      setSelectedAccount(active.selectedAccount);
      setAccounts(active.accounts);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to select account'));
      throw err;
    }
  }, [sdk]);

  const manageAccounts = useCallback(async (): Promise<ManageAccountsResult> => {
    if (!sdk) {
      throw new Error('BrowserSDK not initialized');
    }

    try {
      const result = await sdk.manageAccounts();
      const activeResult = normalizeWalletAccountResult(result);
      setSelectedAccount(activeResult.selectedAccount);
      setAccounts(activeResult.accounts);
      setIsConnected(Boolean(activeResult.selectedAccount));
      return activeResult;
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to manage accounts'));
      throw err;
    }
  }, [sdk]);

  return (
    <ThruContext.Provider
      value={{
        thru,
        wallet: sdk,
        isConnected,
        accounts,
        isConnecting,
        error,
        selectedAccount,
        selectAccount,
        manageAccounts,
      }}
    >
      {children}
    </ThruContext.Provider>
  );
}
