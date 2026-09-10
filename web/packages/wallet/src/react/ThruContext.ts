import { BrowserSDK } from "../BrowserSDK";
import type { WalletAccount } from "../interfaces";
import type {
  AccountMenuPayload,
  AccountMenuResult,
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
  WaitForDepositParams,
} from "../deposit";
import { formatDepositAmount } from "../deposit";
import {
  CHECKING_WALLET_AVAILABILITY,
  type WalletAvailability,
} from "../connection-state";
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
  walletAvailability: WalletAvailability;
  selectAccount: (account: WalletAccount) => Promise<void>;
  manageAccounts: () => Promise<ManageAccountsResult>;
  /** Open the wallet-drawn account menu under a host control (see BrowserSDK). */
  openAccountMenu: (options: AccountMenuPayload) => Promise<AccountMenuResult>;
  prepareDeposit: (
    depositTargetOrPayload?:
      PrepareDepositPayload["depositTarget"] | PrepareDepositPayload,
  ) => Promise<DepositDestination>;
  deposit: (payload: DepositRequestPayload) => Promise<DepositResult>;
  ensureDepositAccount: (
    params?: EnsureDepositAccountParams,
  ) => Promise<DepositAccountState>;
  getDepositAccountState: (
    params?: GetDepositAccountStateParams,
  ) => Promise<DepositAccountState>;
  waitForDepositBalance: (
    params: WaitForDepositParams,
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
  walletAvailability: CHECKING_WALLET_AVAILABILITY,
  selectAccount: async () => undefined,
  manageAccounts: async () => ({ selectedAccount: null }),
  openAccountMenu: async () => ({ action: "closed" }),
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
    getProviders: async () => [],
    getAccountState: async () => {
      throw new Error("BrowserSDK not initialized");
    },
    waitForDeposit: async () => {
      throw new Error("BrowserSDK not initialized");
    },
    formatAmount: formatDepositAmount,
  },
};

export const ThruContext = createContext<ThruContextValue>(defaultContextValue);
