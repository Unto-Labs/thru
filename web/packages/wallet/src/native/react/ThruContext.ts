import { createContext } from 'react';
import type {
  CreateAccountOptions,
  NativeSDK,
} from "../NativeSDK";
import type { WalletAvailability } from "../../connection-state";
import type { WalletAccount } from "../../interfaces";
import type {
  CreateAccountResult,
  DepositDestination,
  DepositRequestPayload,
  DepositResult,
  ManageAccountsResult,
  PrepareDepositPayload,
} from "../../protocol";
import type {
  DepositAccountState,
  DepositsApi,
  EnsureDepositAccountParams,
  GetDepositAccountStateParams,
  WaitForDepositParams,
} from "../../deposit";
import { formatDepositAmount } from "../../deposit";
import type { Thru } from "@thru/sdk/client";

export interface ThruContextValue {
  /** Initialized NativeSDK instance, or null while still constructing. */
  wallet: NativeSDK | null;
  /** Lazily-instantiated Thru chain client. */
  thru: Thru | null;
  isConnected: boolean;
  isConnecting: boolean;
  accounts: WalletAccount[];
  selectedAccount: WalletAccount | null;
  walletAvailability: WalletAvailability;
  error: Error | null;
  selectAccount: (account: WalletAccount) => Promise<void>;
  createAccount: (options?: CreateAccountOptions) => Promise<CreateAccountResult>;
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
    params: WaitForDepositParams
  ) => Promise<DepositAccountState>;
  formatDepositAmount: typeof formatDepositAmount;
  deposits: DepositsApi;
}

export const ThruContext = createContext<ThruContextValue | null>(null);
