/* React Native mirror of `@thru/wallet/react`'s ThruProvider. Owns the
   NativeSDK instance, mirrors its events into context state. The
   bottom sheet is a separate component (<ThruWalletSheet>) the host
   composes alongside this provider. */

import { type ReactNode, useCallback, useEffect, useState } from "react";
import {
  NativeSDK,
  type NativeSDKConfig,
  type WalletAvailability,
} from "../NativeSDK";
import type { WalletAccount } from "../../interfaces";
import { CHECKING_WALLET_AVAILABILITY, ThruContext } from "./ThruContext";

export interface ThruProviderProps {
  children: ReactNode;
  config: NativeSDKConfig;
}

export function ThruProvider({ children, config }: ThruProviderProps) {
  const [sdk, setSdk] = useState<NativeSDK | null>(null);
  const [thru, setThru] = useState<unknown>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [accounts, setAccounts] = useState<WalletAccount[]>([]);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [selectedAccount, setSelectedAccount] = useState<WalletAccount | null>(
    null,
  );
  const [walletAvailability, setWalletAvailability] =
    useState<WalletAvailability>(CHECKING_WALLET_AVAILABILITY);

  useEffect(() => {
    const sdkInstance = new NativeSDK(config);
    setSdk(sdkInstance);
    /* getThru() is lazy in NativeSDK; pull it eagerly so consumers see
       a stable reference. */
    setThru(sdkInstance.getThru());

    const updateAccountsFromSdk = () => setAccounts(sdkInstance.getAccounts());

    const updateSelectedAccount = (account?: WalletAccount | null) => {
      if (account) {
        setSelectedAccount(account);
        return;
      }
      const fallback =
        sdkInstance.getSelectedAccount() ??
        sdkInstance.getAccounts()[0] ??
        null;
      setSelectedAccount(fallback);
    };

    /* Initialization is lazy: NativeSDK.connect() will call initialize
       on demand. We don't pre-initialize because the bridge needs a
       WebView ref attached first by ThruWalletSheet. */

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleConnect = (result: any) => {
      if (result?.status === "connecting") {
        setIsConnecting(true);
        setError(null);
        return;
      }
      setIsConnected(true);
      updateAccountsFromSdk();
      setIsConnecting(false);
      setError(null);
      setWalletAvailability(sdkInstance.getWalletAvailability());
      updateSelectedAccount();
    };

    const resetData = () => {
      setIsConnected(false);
      setAccounts([]);
      setIsConnecting(false);
      setSelectedAccount(null);
    };

    const handleDisconnect = () => resetData();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleError = (err: any) => {
      setError(err?.error ?? err ?? new Error("Unknown error"));
      setIsConnecting(false);
      setWalletAvailability(sdkInstance.getWalletAvailability());
    };
    const handleLock = () => resetData();
    const handleAccountChanged = (
      account: WalletAccount | null | undefined,
    ) => {
      updateAccountsFromSdk();
      updateSelectedAccount(account ?? undefined);
    };
    const handleAvailabilityChanged = (availability: WalletAvailability) => {
      setWalletAvailability(availability);
    };
    sdkInstance.on("connect", handleConnect);
    sdkInstance.on("disconnect", handleDisconnect);
    sdkInstance.on("error", handleError);
    sdkInstance.on("lock", handleLock);
    sdkInstance.on("accountChanged", handleAccountChanged);
    sdkInstance.on("availabilityChanged", handleAvailabilityChanged);

    void sdkInstance.restoreConnection({ hydrate: false }).catch(handleError);

    return () => {
      sdkInstance.off("connect", handleConnect);
      sdkInstance.off("disconnect", handleDisconnect);
      sdkInstance.off("error", handleError);
      sdkInstance.off("lock", handleLock);
      sdkInstance.off("accountChanged", handleAccountChanged);
      sdkInstance.off("availabilityChanged", handleAvailabilityChanged);
      sdkInstance.destroy();
    };
    /* Empty deps: SDK is constructed once; config changes after mount
       are intentionally ignored to mirror @thru/wallet/react semantics. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectAccount = useCallback(
    async (account: WalletAccount) => {
      if (!sdk) throw new Error("NativeSDK not initialized");
      try {
        const updated = await sdk.selectAccount(account.address);
        setSelectedAccount(updated);
        setAccounts([updated]);
      } catch (err) {
        setError(
          err instanceof Error ? err : new Error("selectAccount failed"),
        );
        throw err;
      }
    },
    [sdk],
  );

  const manageAccounts = useCallback(async () => {
    if (!sdk) throw new Error("NativeSDK not initialized");
    try {
      const result = await sdk.manageAccounts();
      setSelectedAccount(result.selectedAccount);
      setAccounts(result.accounts);
      return result;
    } catch (err) {
      setError(err instanceof Error ? err : new Error("manageAccounts failed"));
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
        walletAvailability,
        selectAccount,
        manageAccounts,
      }}
    >
      {children}
    </ThruContext.Provider>
  );
}
