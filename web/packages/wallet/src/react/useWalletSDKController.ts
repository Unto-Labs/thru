import { useCallback, useEffect, useMemo, useState } from "react";
import {
  normalizeActiveWalletAccounts,
  type ConnectResult,
  type WalletAccount,
} from "../interfaces";
import {
  CHECKING_WALLET_AVAILABILITY,
  type WalletAvailability,
} from "../connection-state";
import type { WalletSDK } from "../sdk-contract";
import type {
  DepositAccountState,
  EnsureDepositAccountParams,
  GetDepositAccountStateParams,
  WaitForDepositParams,
} from "../deposit";
import { formatDepositAmount } from "../deposit";
import type { DepositRequestPayload, PrepareDepositPayload } from "../protocol";

type SDKEvent =
  | "connect"
  | "disconnect"
  | "error"
  | "accountChanged"
  | "availabilityChanged";

export interface ObservableWalletSDK extends WalletSDK {
  on(event: SDKEvent, callback: (...args: any[]) => void): void;
  off(event: SDKEvent, callback: (...args: any[]) => void): void;
}

/** Shared React state and operation controller for browser and native SDKs. */
export function useWalletSDKController<TSDK extends ObservableWalletSDK>(sdk: TSDK) {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [accounts, setAccounts] = useState<WalletAccount[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<WalletAccount | null>(null);
  const [walletAvailability, setWalletAvailability] =
    useState<WalletAvailability>(CHECKING_WALLET_AVAILABILITY);
  const [error, setError] = useState<Error | null>(null);

  const captureError = useCallback((input: unknown) => {
    const candidate =
      input && typeof input === "object" && "error" in input
        ? (input as { error?: unknown }).error
        : input;
    setError(candidate instanceof Error ? candidate : new Error("Unknown wallet error"));
    setIsConnecting(false);
  }, []);

  const syncFromSDK = useCallback(
    (preferred?: WalletAccount | null) => {
      const selected = preferred ?? sdk.accounts.getSelected();
      const active = normalizeActiveWalletAccounts(
        selected ? [selected] : [],
        selected,
      );
      const availability = sdk.connection.getState();
      setAccounts(active.accounts);
      setSelectedAccount(active.selectedAccount);
      setWalletAvailability(availability);
      setIsConnected(
        availability.status === "connected" && Boolean(active.selectedAccount),
      );
      setIsConnecting(availability.status === "checking");
    },
    [sdk],
  );

  useEffect(() => {
    const handleConnect = (result: ConnectResult | { status?: string }) => {
      if (result?.status === "connecting") {
        setIsConnecting(true);
        setError(null);
        return;
      }
      setError(null);
      setIsConnecting(false);
      syncFromSDK("selectedAccount" in result ? result.selectedAccount : null);
    };
    const handleDisconnect = () => {
      setIsConnected(false);
      setIsConnecting(false);
      setAccounts([]);
      setSelectedAccount(null);
      setWalletAvailability(sdk.connection.getState());
    };
    const handleAccountChanged = (account?: WalletAccount | null) => {
      syncFromSDK(account ?? null);
    };
    const handleAvailabilityChanged = (availability: WalletAvailability) => {
      setWalletAvailability(availability);
      setIsConnecting(availability.status === "checking");
      if (availability.status === "connected") {
        syncFromSDK(availability.selectedAccount);
      } else if (availability.status === "disconnected") {
        setIsConnected(false);
        setAccounts([]);
        setSelectedAccount(null);
      }
    };

    sdk.on("connect", handleConnect);
    sdk.on("disconnect", handleDisconnect);
    sdk.on("error", captureError);
    sdk.on("accountChanged", handleAccountChanged);
    sdk.on("availabilityChanged", handleAvailabilityChanged);
    return () => {
      sdk.off("connect", handleConnect);
      sdk.off("disconnect", handleDisconnect);
      sdk.off("error", captureError);
      sdk.off("accountChanged", handleAccountChanged);
      sdk.off("availabilityChanged", handleAvailabilityChanged);
    };
  }, [captureError, sdk, syncFromSDK]);

  const selectAccount = useCallback(
    async (account: WalletAccount) => {
      try {
        const selected = await sdk.accounts.select(account.address);
        syncFromSDK(selected);
      } catch (nextError) {
        captureError(nextError);
        throw nextError;
      }
    },
    [captureError, sdk, syncFromSDK],
  );

  const manageAccounts = useCallback(async () => {
    try {
      const result = await sdk.accounts.manage();
      syncFromSDK(result.selectedAccount);
      return result;
    } catch (nextError) {
      captureError(nextError);
      throw nextError;
    }
  }, [captureError, sdk, syncFromSDK]);

  const prepareDeposit = useCallback(
    async (target?: PrepareDepositPayload["depositTarget"] | PrepareDepositPayload) => {
      try {
        return await sdk.deposits.prepare(target);
      } catch (nextError) {
        captureError(nextError);
        throw nextError;
      }
    },
    [captureError, sdk],
  );

  const deposit = useCallback(
    async (payload: DepositRequestPayload) => {
      try {
        return await sdk.deposits.open(payload);
      } catch (nextError) {
        captureError(nextError);
        throw nextError;
      }
    },
    [captureError, sdk],
  );

  const ensureDepositAccount = useCallback(
    async (params: EnsureDepositAccountParams = {}): Promise<DepositAccountState> => {
      try {
        return await sdk.deposits.ensureAccount(params);
      } catch (nextError) {
        captureError(nextError);
        throw nextError;
      }
    },
    [captureError, sdk],
  );

  const getDepositAccountState = useCallback(
    async (params: GetDepositAccountStateParams = {}): Promise<DepositAccountState> => {
      try {
        return await sdk.deposits.getAccountState(params);
      } catch (nextError) {
        captureError(nextError);
        throw nextError;
      }
    },
    [captureError, sdk],
  );

  const waitForDepositBalance = useCallback(
    async (params: WaitForDepositParams): Promise<DepositAccountState> => {
      try {
        return await sdk.deposits.waitForDeposit(params);
      } catch (nextError) {
        captureError(nextError);
        throw nextError;
      }
    },
    [captureError, sdk],
  );

  const deposits = useMemo(
    () => ({
      prepare: prepareDeposit,
      ensureAccount: ensureDepositAccount,
      open: deposit,
      getProviders: () => sdk.deposits.getProviders(),
      getAccountState: getDepositAccountState,
      waitForDeposit: waitForDepositBalance,
      formatAmount: sdk.deposits.formatAmount,
    }),
    [
      deposit,
      ensureDepositAccount,
      getDepositAccountState,
      prepareDeposit,
      sdk,
      waitForDepositBalance,
    ],
  );

  return {
    isConnected,
    isConnecting,
    accounts,
    selectedAccount,
    walletAvailability,
    error,
    selectAccount,
    manageAccounts,
    prepareDeposit,
    deposit,
    ensureDepositAccount,
    getDepositAccountState,
    waitForDepositBalance,
    formatDepositAmount,
    deposits,
    captureError,
    syncFromSDK,
  };
}
