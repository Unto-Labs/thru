import type { WalletAccount } from "./types";

export interface ActiveWalletAccounts {
  accounts: WalletAccount[];
  selectedAccount: WalletAccount | null;
}

export type WalletAccountResult<T> = Omit<T, "accounts" | "selectedAccount"> & {
  accounts: WalletAccount[];
  selectedAccount: WalletAccount | null;
};

export function resolveSelectedWalletAccount(
  accounts: WalletAccount[],
  selectedAccount?: WalletAccount | null,
): WalletAccount | null {
  if (selectedAccount) {
    return (
      accounts.find((account) => account.address === selectedAccount.address) ??
      selectedAccount
    );
  }

  return accounts[0] ?? null;
}

export function resolveWalletAccountByAddress(
  accounts: WalletAccount[],
  address?: string | null,
): WalletAccount | null {
  if (!address) return null;
  return accounts.find((account) => account.address === address) ?? null;
}

export function normalizeActiveWalletAccounts(
  accounts: WalletAccount[],
  selectedAccount?: WalletAccount | null,
): ActiveWalletAccounts {
  const activeAccount = resolveSelectedWalletAccount(accounts, selectedAccount);
  return {
    accounts: activeAccount ? [activeAccount] : [],
    selectedAccount: activeAccount,
  };
}

export function normalizeWalletAccountResult<
  T extends { accounts: WalletAccount[]; selectedAccount?: WalletAccount | null },
>(
  result: T,
  selectedAccount?: WalletAccount | null,
): WalletAccountResult<T> {
  const active = normalizeActiveWalletAccounts(
    result.accounts,
    selectedAccount ?? result.selectedAccount ?? null,
  );
  return {
    ...result,
    accounts: active.accounts,
    selectedAccount: active.selectedAccount,
  };
}
