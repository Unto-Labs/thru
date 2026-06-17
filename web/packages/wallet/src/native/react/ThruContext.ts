import { createContext } from 'react';
import type {
  CreateAccountOptions,
  NativeSDK,
  WalletAvailability,
} from "../NativeSDK";
import type { WalletAccount } from "../../interfaces";
import type { CreateAccountResult, ManageAccountsResult } from "../../protocol";

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
}

export const ThruContext = createContext<ThruContextValue | null>(null);
