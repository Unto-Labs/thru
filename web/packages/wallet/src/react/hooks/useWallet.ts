import { BrowserSDK, ConnectOptions } from '../../BrowserSDK';
import type { ConnectResult, IThruChain } from '../../interfaces';
import type { ManageAccountsResult } from '../../protocol';
import { useEffect, useRef } from 'react';
import { useThru } from './useThru';

function waitForWallet(getWallet: () => BrowserSDK | null, timeout = 5000, interval = 100): Promise<BrowserSDK> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      const sdk = getWallet();
      if (sdk) return resolve(sdk);
      if (Date.now() - start > timeout) return reject(new Error('SDK not initialized in time'));
      setTimeout(check, interval);
    };
    check();
  });
}

/**
 * useThruChain - Hook for accessing the Thru chain API exposed by the Browser SDK.
 * Returns the chain instance (if available) and a boolean indicating readiness.
 */
export function useWallet() {
  const {
    wallet,
    isConnected,
    accounts,
    selectedAccount,
    selectAccount,
    manageAccounts,
    isConnecting,
  } = useThru();
  const walletRef = useRef(wallet);

  useEffect(() => {
    walletRef.current = wallet;
  }, [wallet]);

  const disconnect = async (): Promise<void> => {
    if (!wallet) {
      throw new Error('SDK not initialized');
    }
    await wallet.disconnect();
  };

  const connect = async (options?: ConnectOptions): Promise<ConnectResult> => {
    try {
      const readySdk =
        walletRef.current ?? (await waitForWallet(() => walletRef.current));
      const result = await readySdk.connect(options);
      return result;
    } catch (err) {
      const error = err as Error;
      throw error;
    }
  };

  const mountInline = async (container: HTMLElement): Promise<void> => {
    const readySdk =
      walletRef.current ?? (await waitForWallet(() => walletRef.current));
    await readySdk.mountInline(container);
  };

  const openAccountSettings = async (): Promise<ManageAccountsResult> => {
    return manageAccounts();
  };

  return {
    wallet: wallet?.thru as IThruChain | undefined,
    accounts,
    connect,
    disconnect,
    mountInline,
    manageAccounts: openAccountSettings,
    isConnected: isConnected && !!wallet,
    isConnecting,
    selectedAccount,
    selectAccount,
  };
}
