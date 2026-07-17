import { encodeAddress, decodeAddress } from '@thru/sdk/helpers';
import { bytesEqual, compareBytes, uniqueAccounts } from './encoding';
import { PASSKEY_MANAGER_PROGRAM_ADDRESS } from './constants';
import type { AccountContext, WalletAccountContext } from './types';

interface WalletAccountContextParams {
  walletAddress: string;
  readWriteAccounts: Uint8Array[];
  readOnlyAccounts: Uint8Array[];
  programAddress?: string;
}

function buildDeferredAccountLists(params: WalletAccountContextParams) {
  const programBytes = decodeAddress(params.programAddress ?? PASSKEY_MANAGER_PROGRAM_ADDRESS);
  const walletBytes = decodeAddress(params.walletAddress);

  const readWriteBytes = uniqueAccounts([walletBytes, ...params.readWriteAccounts])
    .filter((addr) => !bytesEqual(addr, programBytes))
    .sort(compareBytes);
  const readOnlyBytes = uniqueAccounts(params.readOnlyAccounts)
    .filter(
      (addr) =>
        !bytesEqual(addr, programBytes) &&
        !readWriteBytes.some((candidate) => bytesEqual(candidate, addr))
    )
    .sort(compareBytes);

  return { programBytes, walletBytes, readWriteBytes, readOnlyBytes };
}

/**
 * Build account indices for an instruction that a wallet will wrap and pay for.
 * The concrete fee payer is intentionally unknown here; index 0 is reserved for
 * it and index 1 for the wrapper program.
 */
export function buildWalletAccountContext(
  params: WalletAccountContextParams
): WalletAccountContext {
  const { programBytes, walletBytes, readWriteBytes, readOnlyBytes } =
    buildDeferredAccountLists(params);
  const readWriteAddresses = readWriteBytes.map(encodeAddress);
  const readOnlyAddresses = readOnlyBytes.map(encodeAddress);

  const findIndex = (target: Uint8Array): number => {
    if (bytesEqual(target, programBytes)) return 1;

    const rwIndex = readWriteBytes.findIndex((candidate) => bytesEqual(candidate, target));
    if (rwIndex >= 0) return rwIndex + 2;

    const roIndex = readOnlyBytes.findIndex((candidate) => bytesEqual(candidate, target));
    if (roIndex >= 0) return roIndex + 2 + readWriteBytes.length;

    return -1;
  };

  const walletAccountIdx = findIndex(walletBytes);
  if (walletAccountIdx < 2) {
    throw new Error('Wallet account must be a non-program account');
  }

  return {
    readWriteAddresses,
    readOnlyAddresses,
    walletAccountIdx,
    getAccountIndex: (pubkey: Uint8Array) => {
      const idx = findIndex(pubkey);
      if (idx < 0) {
        throw new Error('Account not found in transaction accounts');
      }
      return idx;
    },
  };
}

/** Ensure the wallet-selected fee payer does not invalidate indices that were
 * encoded before that payer was known. */
export function assertWalletFeePayerCompatible(params: WalletAccountContextParams & {
  feePayerAddress: string;
}): void {
  const feePayerBytes = decodeAddress(params.feePayerAddress);
  const { programBytes, walletBytes, readWriteBytes, readOnlyBytes } =
    buildDeferredAccountLists(params);
  const conflicts = [programBytes, walletBytes, ...readWriteBytes, ...readOnlyBytes];
  if (conflicts.some((account) => bytesEqual(account, feePayerBytes))) {
    throw new Error('Wallet fee payer must not overlap instruction accounts');
  }
}

/**
 * Build account context for passkey manager transactions.
 * Handles account deduplication, sorting, and index lookup.
 */
export function buildAccountContext(params: {
  walletAddress: string;
  readWriteAccounts: Uint8Array[];
  readOnlyAccounts: Uint8Array[];
  feePayerAddress: string;
  programAddress?: string;
}): AccountContext {
  const feePayerBytes = decodeAddress(params.feePayerAddress);
  const programBytes = decodeAddress(params.programAddress ?? PASSKEY_MANAGER_PROGRAM_ADDRESS);
  const walletBytes = decodeAddress(params.walletAddress);

  const readWriteBytes = uniqueAccounts([walletBytes, ...params.readWriteAccounts])
    .filter(
      (addr) => !bytesEqual(addr, feePayerBytes) && !bytesEqual(addr, programBytes)
    )
    .sort(compareBytes);

  const readOnlyBytes = uniqueAccounts(params.readOnlyAccounts)
    .filter(
      (addr) =>
        !bytesEqual(addr, feePayerBytes) &&
        !bytesEqual(addr, programBytes) &&
        !readWriteBytes.some((candidate) => bytesEqual(candidate, addr))
    )
    .sort(compareBytes);

  const readWriteAddresses = readWriteBytes.map(encodeAddress);
  const readOnlyAddresses = readOnlyBytes.map(encodeAddress);

  const accountAddresses = [
    encodeAddress(feePayerBytes),
    encodeAddress(programBytes),
    ...readWriteAddresses,
    ...readOnlyAddresses,
  ];

  const findIndex = (target: Uint8Array): number => {
    if (bytesEqual(target, feePayerBytes)) return 0;
    if (bytesEqual(target, programBytes)) return 1;

    const rwIndex = readWriteBytes.findIndex((candidate) => bytesEqual(candidate, target));
    if (rwIndex >= 0) return rwIndex + 2;

    const roIndex = readOnlyBytes.findIndex((candidate) => bytesEqual(candidate, target));
    if (roIndex >= 0) return roIndex + 2 + readWriteBytes.length;

    return -1;
  };

  const walletAccountIdx = findIndex(walletBytes);
  if (walletAccountIdx < 2) {
    throw new Error('Wallet account must be a non-fee-payer account');
  }

  return {
    readWriteAddresses,
    readOnlyAddresses,
    accountAddresses,
    walletAccountIdx,
    getAccountIndex: (pubkey: Uint8Array) => {
      const idx = findIndex(pubkey);
      if (idx < 0) {
        throw new Error('Account not found in transaction accounts');
      }
      return idx;
    },
  };
}

/**
 * Build read-write accounts list for passkey manager transactions (simpler wallet-only version).
 */
export function buildPasskeyReadWriteAccounts(
  userAccounts: Uint8Array[],
  feePayerPublicKey: Uint8Array,
  programAddress: Uint8Array
): {
  readWriteAddresses: string[];
  findAccountIndex: (target: Uint8Array) => number;
} {
  const sortedUserAccounts = uniqueAccounts(userAccounts).sort(compareBytes);
  const filteredUserAccounts = sortedUserAccounts.filter(
    (addr) => !bytesEqual(addr, feePayerPublicKey) && !bytesEqual(addr, programAddress)
  );
  const readWriteAddresses = filteredUserAccounts.map((addr) => encodeAddress(addr));

  const findAccountIndex = (target: Uint8Array): number => {
    if (bytesEqual(target, feePayerPublicKey)) return 0;
    if (bytesEqual(target, programAddress)) return 1;
    for (let i = 0; i < filteredUserAccounts.length; i++) {
      if (bytesEqual(filteredUserAccounts[i], target)) return i + 2;
    }
    return -1;
  };

  return { readWriteAddresses, findAccountIndex };
}
