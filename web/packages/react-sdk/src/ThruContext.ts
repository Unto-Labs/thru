import { BrowserSDK } from "@thru/browser-sdk";
import { WalletAccount } from "@thru/chain-interfaces";
import { Thru } from "@thru/thru-sdk/client";
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
};

export const ThruContext = createContext<ThruContextValue>(defaultContextValue);
