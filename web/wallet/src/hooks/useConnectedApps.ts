import { useCallback } from 'react';
import { useWallet } from '@/hooks/useWallet';

export function useConnectedApps() {
  const {
    connectedApps,
    isConnectedAppsLoading,
    selectedAccountIndex,
    refreshConnectedApps,
    revokeConnectedApp,
  } = useWallet();

  const refresh = useCallback(() => refreshConnectedApps(selectedAccountIndex), [refreshConnectedApps, selectedAccountIndex]);

  const revoke = useCallback(
    (appId: string) => revokeConnectedApp(selectedAccountIndex, appId),
    [revokeConnectedApp, selectedAccountIndex]
  );

  return {
    connectedApps,
    isLoading: isConnectedAppsLoading,
    refreshConnectedApps: refresh,
    revokeConnectedApp: revoke,
    selectedAccountIndex,
  };
}
