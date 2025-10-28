import type { WalletAccount } from '@thru/chain-interfaces';
import { useEffect, useMemo } from 'react';
import { useThru } from './useThru';

export interface UseAccountsResult {
  accounts: WalletAccount[];
  selectedAccount: WalletAccount | null;
  isConnected: boolean;
  isConnecting: boolean;
}

export interface UseAccountsOptions {
  onAccountSelect?: (account: WalletAccount) => void;
}

/**
 * useAccounts - Exposes connected wallet accounts and selection helpers.
 */
export function useAccounts(options?: UseAccountsOptions): UseAccountsResult {
  const { accounts, selectedAccount, isConnected, isConnecting } = useThru();
  const externalOnSelect = options?.onAccountSelect;

  useEffect(() => {
    if (selectedAccount) {
      externalOnSelect?.(selectedAccount);
    }
  }, [externalOnSelect, selectedAccount]);

  return useMemo(
    () => ({
      accounts,
      selectedAccount,
      isConnected,
      isConnecting,
    }),
    [accounts, selectedAccount, isConnected, isConnecting]
  );
}
