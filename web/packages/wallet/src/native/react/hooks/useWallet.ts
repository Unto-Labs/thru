import { useCallback, useEffect, useRef } from 'react';
import type { ConnectResult, IThruChain } from "../../../interfaces";
import type { ConnectOptions, SignInOptions } from "../../NativeSDK";
import { useThru } from './useThru';
import { waitForWallet } from './waitForWallet';

/**
 * useWallet - mirror of @thru/wallet/react's useWallet. The `wallet` field
 * exposes the chain interface (`provider.thru`); `connect` /
 * `disconnect` proxy through the SDK.
 */
export function useWallet() {
  const {
    wallet,
    isConnected,
    isConnecting,
    accounts,
    selectedAccount,
    selectAccount,
    manageAccounts,
    walletAvailability,
  } = useThru();
  const walletRef = useRef(wallet);

  useEffect(() => {
    walletRef.current = wallet;
  }, [wallet]);

  const connect = useCallback(async (options?: ConnectOptions): Promise<ConnectResult> => {
    const ready =
      walletRef.current ?? (await waitForWallet(() => walletRef.current));
    return ready.connect(options);
  }, []);

  const signIn = useCallback(async (options: SignInOptions): Promise<ConnectResult> => {
    const ready =
      walletRef.current ?? (await waitForWallet(() => walletRef.current));
    return ready.signIn(options);
  }, []);

  const disconnect = useCallback(async (): Promise<void> => {
    const ready =
      walletRef.current ?? (await waitForWallet(() => walletRef.current));
    await ready.disconnect();
  }, []);

  const refreshWalletAvailability = useCallback(async (options?: ConnectOptions) => {
    const ready =
      walletRef.current ?? (await waitForWallet(() => walletRef.current));
    return ready.refreshWalletAvailability(options);
  }, []);

  return {
    /** Chain interface (`provider.thru`); undefined until connected. */
    wallet: wallet?.thru as IThruChain | undefined,
    accounts,
    connect,
    signIn,
    disconnect,
    isConnected: isConnected && !!wallet,
    isConnecting,
    selectedAccount,
    selectAccount,
    manageAccounts,
    walletAvailability,
    hasPasskey: walletAvailability.hasPasskey,
    hasWalletAccount: walletAvailability.hasWalletAccount,
    isWalletAvailabilityLoading: walletAvailability.status === 'checking',
    refreshWalletAvailability,
  };
}
