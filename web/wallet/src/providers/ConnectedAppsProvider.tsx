'use client';

import type { ConnectedApp } from '@thru/chain-interfaces';
import { ConnectedAppsStorage } from '@thru/wallet-store';
import { useSession } from '@/providers/SessionProvider';
import { useAccounts } from '@/providers/AccountProvider';
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

export interface ConnectedAppsContextState {
  connectedApps: ConnectedApp[];
  isConnectedAppsLoading: boolean;
  refreshConnectedApps: (accountIndex?: number) => Promise<void>;
  revokeConnectedApp: (accountIndex: number, appId: string) => Promise<void>;
}

export const ConnectedAppsContext = createContext<ConnectedAppsContextState | null>(null);

export function useConnectedAppsContext(): ConnectedAppsContextState {
  const context = useContext(ConnectedAppsContext);
  if (!context) {
    throw new Error('useConnectedAppsContext must be used within ConnectedAppsProvider');
  }
  return context;
}

export function ConnectedAppsProvider({ children }: { children: React.ReactNode }) {
  const { isUnlocked } = useSession();
  const { selectedAccountIndex } = useAccounts();

  const [connectedApps, setConnectedApps] = useState<ConnectedApp[]>([]);
  const [isConnectedAppsLoading, setIsConnectedAppsLoading] = useState(false);

  const refreshConnectedApps = useCallback(
    async (accountIndex?: number): Promise<void> => {
      const targetIndex = accountIndex ?? selectedAccountIndex;
      setIsConnectedAppsLoading(true);
      try {
        const apps = await ConnectedAppsStorage.listByAccount(targetIndex);
        setConnectedApps(apps);
      } catch (error) {
        console.error('[ConnectedAppsProvider] Failed to refresh connected apps:', error);
        setConnectedApps([]);
      } finally {
        setIsConnectedAppsLoading(false);
      }
    },
    [selectedAccountIndex]
  );

  const revokeConnectedApp = useCallback(
    async (accountId: number, appId: string): Promise<void> => {
      try {
        await ConnectedAppsStorage.remove(accountId, appId);
      } catch (error) {
        console.error('[ConnectedAppsProvider] Failed to revoke connected app:', error);
        throw error;
      }

      if (accountId === selectedAccountIndex) {
        await refreshConnectedApps(accountId);
      }
    },
    [refreshConnectedApps, selectedAccountIndex]
  );

  // Refresh connected apps when unlocked or account changes
  useEffect(() => {
    if (!isUnlocked) {
      setConnectedApps([]);
      setIsConnectedAppsLoading(false);
      return;
    }

    refreshConnectedApps().catch((error) => {
      console.error('[ConnectedAppsProvider] Failed to refresh connected apps:', error);
    });
  }, [isUnlocked, selectedAccountIndex, refreshConnectedApps]);

  const value: ConnectedAppsContextState = {
    connectedApps,
    isConnectedAppsLoading,
    refreshConnectedApps,
    revokeConnectedApp,
  };

  return <ConnectedAppsContext.Provider value={value}>{children}</ConnectedAppsContext.Provider>;
}
