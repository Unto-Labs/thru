import { BrowserSDK } from "../BrowserSDK";
import type { WalletAccount } from "../interfaces";
import type {
    DepositDestination,
    DepositRequestPayload,
    DepositResult,
    ManageAccountsResult,
    PrepareDepositPayload,
} from "../protocol";
import type {
    DepositAccountState,
    DepositsApi,
    EnsureDepositAccountParams,
    GetDepositAccountStateParams,
    WaitForDepositBalanceParams,
} from "../deposit";
import { formatDepositAmount } from "../deposit";
import { Thru } from "@thru/sdk/client";
import { createContext } from "react";

export interface ThruContextValue {
    wallet: BrowserSDK | null;
    isConnected: boolean;
    accounts: WalletAccount[];
    isConnecting: boolean;
    error: Error | null;
    thru: Thru | null;
    selectedAccount: WalletAccount | null;
    selectAccount: (account: WalletAccount) => Promise<void>;
    manageAccounts: () => Promise<ManageAccountsResult>;
    prepareDeposit: (
        depositTargetOrPayload?: PrepareDepositPayload['depositTarget'] | PrepareDepositPayload
    ) => Promise<DepositDestination>;
    deposit: (payload: DepositRequestPayload) => Promise<DepositResult>;
    ensureDepositAccount: (
        params?: EnsureDepositAccountParams
    ) => Promise<DepositAccountState>;
    getDepositAccountState: (
        params?: GetDepositAccountStateParams
    ) => Promise<DepositAccountState>;
    waitForDepositBalance: (
        params: WaitForDepositBalanceParams
    ) => Promise<DepositAccountState>;
    formatDepositAmount: typeof formatDepositAmount;
    deposits: DepositsApi;
}

const defaultContextValue: ThruContextValue = {
    wallet: null,
    isConnected: false,
    accounts: [],
    isConnecting: false,
    error: null,
    thru: null,
    selectedAccount: null,
    selectAccount: async () => undefined,
    manageAccounts: async () => ({ accounts: [], selectedAccount: null }),
    prepareDeposit: async () => {
        throw new Error("BrowserSDK not initialized");
    },
    deposit: async () => ({ status: "cancelled" }),
    ensureDepositAccount: async () => {
        throw new Error("BrowserSDK not initialized");
    },
    getDepositAccountState: async () => {
        throw new Error("BrowserSDK not initialized");
    },
    waitForDepositBalance: async () => {
        throw new Error("BrowserSDK not initialized");
    },
    formatDepositAmount,
    deposits: {
        prepare: async () => {
            throw new Error("BrowserSDK not initialized");
        },
        ensureAccount: async () => {
            throw new Error("BrowserSDK not initialized");
        },
        open: async () => ({ status: "cancelled" }),
        getAccountState: async () => {
            throw new Error("BrowserSDK not initialized");
        },
        waitForBalance: async () => {
            throw new Error("BrowserSDK not initialized");
        },
        formatAmount: formatDepositAmount,
    },
};

export const ThruContext = createContext<ThruContextValue>(defaultContextValue);
