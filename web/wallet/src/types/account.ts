import type { StoredAccount as PersistedStoredAccount } from '@thru/wallet-store';

/**
 * Account with derived keypair (used in-memory only, never stored)
 */
export type DerivedAccount = PersistedStoredAccount;

export type StoredAccount = PersistedStoredAccount;
