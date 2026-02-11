import { WalletAccount } from './abi/thru/program/passkey_manager/types';

/**
 * Parse wallet account data to extract nonce.
 */
export function parseWalletNonce(data: Uint8Array): bigint {
  const account = WalletAccount.from_array(data);
  if (!account) return 0n;
  return account.get_nonce();
}

/**
 * Fetch wallet nonce from the chain.
 * Takes an SDK-like object with accounts.get() method.
 */
export async function fetchWalletNonce(
  sdk: { accounts: { get: (address: string) => Promise<{ data?: { data?: Uint8Array } }> } },
  walletAddress: string
): Promise<bigint> {
  const account = await sdk.accounts.get(walletAddress);
  const data = account.data?.data;
  if (!data) return 0n;
  const parsed = WalletAccount.from_array(data);
  if (!parsed) return 0n;
  return parsed.get_nonce();
}
