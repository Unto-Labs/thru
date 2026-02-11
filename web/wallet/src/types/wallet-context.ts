import type { ConnectedApp } from '@thru/chain-interfaces';
import type { PasskeyPopupContext } from '@thru/passkey';
import type { NetworkType } from '@/lib/wallet/wallet-manager';
import type { DerivedAccount } from '@/types/account';

export interface WalletContextState {
  // Status
  isInitialized: boolean;
  walletExists: boolean;
  isUnlocked: boolean;
  isLoading: boolean;
  autoLockCount: number;

  // Data
  accounts: DerivedAccount[];
  balances: Map<number, bigint>;
  selectedAccountIndex: number;
  connectedApps: ConnectedApp[];

  isConnectedAppsLoading: boolean;

  // Network
  network: NetworkType;

  // Operations - Wallet Lifecycle
  lockWallet: (reason?: 'manual' | 'auto') => void;

  // Passkey Profile
  isPasskeySupported: boolean;
  hasPasskey: boolean;
  passkeyError: string | null;
  isRegisteringPasskey: boolean;
  isSigningWithPasskey: boolean;
  registerPasskey: (alias: string) => Promise<boolean>;
  signInWithPasskey: (context?: PasskeyPopupContext) => Promise<boolean>;
  shouldUsePasskeyPopup: () => Promise<boolean>;
  clearPasskeyError: () => void;

  // Operations - Accounts
  createAccount: (
    accountName: string
  ) => Promise<{
    accountName: string;
    address: string;
    signature: string | null;
    vmError: string | null;
    userErrorCode: string | null;
    executionResult: string | null;
  }>;
  renameAccount: (index: number, label: string) => Promise<void>;
  selectAccount: (index: number) => void;
  refreshBalances: () => Promise<void>;
  refreshAccounts: () => Promise<void>;
  getEmbeddedAccountsSnapshot: () => DerivedAccount[];

  // Operations - Transactions
  sendTransfer: (to: string, amount: bigint) => Promise<{
    signature: string | null;
    vmError: string | null;
    userErrorCode: number | null;
    executionResult: string | null;
  }>;

  // Embedded signing (manager profile)
  signSerializedTransaction: (serializedTransaction: string) => Promise<string>;

  // Connected apps
  refreshConnectedApps: (accountIndex?: number) => Promise<void>;
  revokeConnectedApp: (accountIndex: number, appId: string) => Promise<void>;

  // Utilities
  setNetwork: (network: NetworkType) => void;
}
