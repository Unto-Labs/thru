import { useSession } from '@/providers/SessionProvider';
import { usePasskeyAuth } from '@/providers/PasskeyAuthProvider';
import { useAccounts } from '@/providers/AccountProvider';
import { useTransactions } from '@/providers/TransactionProvider';
import { useConnectedAppsContext } from '@/providers/ConnectedAppsProvider';
import type { WalletContextState } from '@/types/wallet-context';

/**
 * Unified hook that composes all wallet providers into a single object.
 * Maintains backward compatibility with the original WalletContextState interface.
 * All existing consumers can continue using `useWallet()` unchanged.
 */
export function useWallet(): WalletContextState {
  const session = useSession();
  const passkeyAuth = usePasskeyAuth();
  const accounts = useAccounts();
  const transactions = useTransactions();
  const connectedApps = useConnectedAppsContext();

  return {
    // Session
    isUnlocked: session.isUnlocked,
    autoLockCount: session.autoLockCount,
    network: session.network,
    lockWallet: session.lockWallet,
    setNetwork: session.setNetwork,

    // Passkey Auth
    isInitialized: passkeyAuth.isInitialized,
    walletExists: passkeyAuth.walletExists,
    isPasskeySupported: passkeyAuth.isPasskeySupported,
    hasPasskey: passkeyAuth.hasPasskey,
    passkeyError: passkeyAuth.passkeyError,
    isRegisteringPasskey: passkeyAuth.isRegisteringPasskey,
    isSigningWithPasskey: passkeyAuth.isSigningWithPasskey,
    registerPasskey: passkeyAuth.registerPasskey,
    signInWithPasskey: passkeyAuth.signInWithPasskey,
    shouldUsePasskeyPopup: passkeyAuth.shouldUsePasskeyPopup,
    clearPasskeyError: passkeyAuth.clearPasskeyError,

    // Accounts
    accounts: accounts.accounts,
    balances: accounts.balances,
    selectedAccountIndex: accounts.selectedAccountIndex,
    isLoading: accounts.isLoading || transactions.isTransactionLoading,
    createAccount: accounts.createAccount,
    renameAccount: accounts.renameAccount,
    selectAccount: accounts.selectAccount,
    refreshBalances: accounts.refreshBalances,
    refreshAccounts: accounts.refreshAccounts,
    getEmbeddedAccountsSnapshot: accounts.getEmbeddedAccountsSnapshot,

    // Transactions
    sendTransfer: transactions.sendTransfer,
    signSerializedTransaction: transactions.signSerializedTransaction,

    // Connected Apps
    connectedApps: connectedApps.connectedApps,
    isConnectedAppsLoading: connectedApps.isConnectedAppsLoading,
    refreshConnectedApps: connectedApps.refreshConnectedApps,
    revokeConnectedApp: connectedApps.revokeConnectedApp,
  };
}
