import { createContext } from 'react';
import type {
  CreateAccountOptions,
  NativeSDK,
  WalletAvailability,
} from "../NativeSDK";
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
  WaitForDepositBalanceParams,
} from "../../deposit";
import { formatDepositAmount } from "../../deposit";

export const CHECKING_WALLET_AVAILABILITY: WalletAvailability = {
  status: 'checking',
  isAuthorized: false,
  isConnected: false,
  isUnlocked: false,
  hasPasskey: false,
  hasWalletAccount: false,
  accounts: [],
  selectedAccount: null,
  metadata: null,
  error: null,
};

export interface ThruContextValue {
  /** Initialized NativeSDK instance, or null while still constructing. */
  wallet: NativeSDK | null;
  /** Lazily-instantiated Thru chain client (cast at the call site). */
  thru: unknown;
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
    params: WaitForDepositBalanceParams
  ) => Promise<DepositAccountState>;
  formatDepositAmount: typeof formatDepositAmount;
  deposits: DepositsApi;
}

export const ThruContext = createContext<ThruContextValue | null>(null);
