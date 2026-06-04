import { useEffect, useRef } from 'react';
import type { ConnectOptions } from "../../NativeSDK";
import { useThru } from './useThru';
import { waitForWallet } from './waitForWallet';

export function useWalletAvailability() {
  const { wallet, walletAvailability } = useThru();
  const walletRef = useRef(wallet);

  useEffect(() => {
    walletRef.current = wallet;
  }, [wallet]);

  const refreshWalletAvailability = async (options?: ConnectOptions) => {
    const ready =
      walletRef.current ?? (await waitForWallet(() => walletRef.current));
    return ready.refreshWalletAvailability(options);
  };

  return {
    walletAvailability,
    refreshWalletAvailability,
    hasPasskey: walletAvailability.hasPasskey,
    hasWalletAccount: walletAvailability.hasWalletAccount,
    isAuthorized: walletAvailability.isAuthorized,
    isWalletAvailabilityLoading: walletAvailability.status === 'checking',
    accounts: walletAvailability.accounts,
    selectedAccount: walletAvailability.selectedAccount,
    error: walletAvailability.error,
  };
}
