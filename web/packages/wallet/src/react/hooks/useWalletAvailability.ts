import { useEffect, useRef } from "react";
import type { BrowserSDK, ConnectOptions } from "../../BrowserSDK";
import { useThru } from "./useThru";

function waitForWallet(
  getWallet: () => BrowserSDK | null,
  timeout = 5000,
  interval = 100,
): Promise<BrowserSDK> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      const wallet = getWallet();
      if (wallet) return resolve(wallet);
      if (Date.now() - start > timeout) {
        return reject(new Error("SDK not initialized in time"));
      }
      setTimeout(check, interval);
    };
    check();
  });
}

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
    isAuthorized: walletAvailability.isConnected,
    isWalletAvailabilityLoading: walletAvailability.status === "checking",
    accounts: walletAvailability.accounts,
    selectedAccount: walletAvailability.selectedAccount,
    error: walletAvailability.error,
  };
}
