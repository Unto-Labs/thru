import { useEffect, useRef } from 'react';
import type { WalletAccount } from "../../../interfaces";
import { useThru } from './useThru';

export interface UseAccountsOptions {
  /** Fired whenever the active account flips (initial pick or switch). */
  onAccountSelect?: (account: WalletAccount) => void;
}

/**
 * useAccounts - mirror of @thru/wallet/react's useAccounts. Subscribes to
 * `selectedAccount` flips and invokes the consumer's callback on real
 * changes (deduped against the previous address).
 */
export function useAccounts({ onAccountSelect }: UseAccountsOptions = {}) {
  const { accounts, selectedAccount, isConnected, isConnecting } = useThru();
  const lastSeen = useRef<string | null>(null);

  useEffect(() => {
    if (!selectedAccount) {
      lastSeen.current = null;
      return;
    }
    if (lastSeen.current === selectedAccount.address) return;
    lastSeen.current = selectedAccount.address;
    onAccountSelect?.(selectedAccount);
  }, [selectedAccount, onAccountSelect]);

  return {
    accounts,
    selectedAccount,
    isConnected,
    isConnecting,
  };
}
