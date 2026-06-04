import { BrowserSDK } from "../BrowserSDK";
import type { WalletAccount } from "../interfaces";
import type { ManageAccountsResult } from "../protocol";
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
};

export const ThruContext = createContext<ThruContextValue>(defaultContextValue);
