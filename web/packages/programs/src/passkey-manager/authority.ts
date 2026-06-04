import { parseWalletAuthorities, type ParsedAuthority } from './accounts';
import { bytesToHex } from './encoding';

const DEFAULT_AUTHORITY_TARGET_CONCURRENCY = 8;

export interface PasskeyAuthorityIdentity {
  publicKeyX?: string | null;
  publicKeyY?: string | null;
}

export interface CheckablePasskeyAuthorityIdentity {
  publicKeyX: string;
  publicKeyY: string;
}

interface AccountLike {
  data?: {
    data?: Uint8Array;
  };
}

interface ThruAccountClient {
  accounts: {
    get(address: string): Promise<AccountLike>;
  };
}

export interface PasskeyAuthorityTarget<T> {
  account: T;
  walletAddress: string;
  authIdx: number;
  authorities: ParsedAuthority[];
}

export interface PreparePasskeyAuthorityTargetsOptions<T> {
  accounts: T[];
  passkey?: PasskeyAuthorityIdentity | null;
  thru: ThruAccountClient;
  getWalletAddress: (account: T) => string;
  concurrency?: number;
}

function getAccountData(account: AccountLike | null | undefined): Uint8Array | null {
  return account?.data?.data ?? null;
}

export function isPasskeyAuthorityCheckable(
  passkey: PasskeyAuthorityIdentity | null | undefined
): passkey is CheckablePasskeyAuthorityIdentity {
  return Boolean(passkey?.publicKeyX && passkey.publicKeyY);
}

export function findPasskeyAuthorityIndexForIdentity(
  authorities: ParsedAuthority[],
  passkey: PasskeyAuthorityIdentity | null | undefined
): number | null {
  if (!isPasskeyAuthorityCheckable(passkey)) return null;

  const expectedX = passkey.publicKeyX.toLowerCase();
  const expectedY = passkey.publicKeyY.toLowerCase();
  const authority = authorities.find(
    (item) =>
      item.kind === 'passkey' &&
      bytesToHex(item.x).toLowerCase() === expectedX &&
      bytesToHex(item.y).toLowerCase() === expectedY
  );
  return authority?.idx ?? null;
}

export function findPasskeyAuthorityIndexInWalletData(
  walletData: Uint8Array,
  passkey: PasskeyAuthorityIdentity | null | undefined
): { authIdx: number; authorities: ParsedAuthority[] } | null {
  const parsed = parseWalletAuthorities(walletData);
  const authIdx = findPasskeyAuthorityIndexForIdentity(parsed.authorities, passkey);
  return authIdx === null ? null : { authIdx, authorities: parsed.authorities };
}

export async function resolvePasskeyAuthorityIndex(params: {
  thru: ThruAccountClient;
  walletAddress: string;
  passkey?: PasskeyAuthorityIdentity | null;
}): Promise<number | null> {
  const walletAccount = await params.thru.accounts.get(params.walletAddress);
  const walletData = getAccountData(walletAccount);
  if (!walletData) return null;

  return findPasskeyAuthorityIndexInWalletData(walletData, params.passkey)?.authIdx ?? null;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(Math.floor(concurrency), items.length));

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        results[currentIndex] = await mapper(items[currentIndex]);
      }
    })
  );

  return results;
}

export async function preparePasskeyAuthorityTargets<T>({
  accounts,
  passkey,
  thru,
  getWalletAddress,
  concurrency = DEFAULT_AUTHORITY_TARGET_CONCURRENCY,
}: PreparePasskeyAuthorityTargetsOptions<T>): Promise<PasskeyAuthorityTarget<T>[]> {
  if (!isPasskeyAuthorityCheckable(passkey) || accounts.length === 0) {
    return [];
  }

  const targets = await mapWithConcurrency(accounts, concurrency, async (account) => {
    const walletAddress = getWalletAddress(account);
    try {
      const walletAccount = await thru.accounts.get(walletAddress);
      const walletData = getAccountData(walletAccount);
      if (!walletData) return null;

      const target = findPasskeyAuthorityIndexInWalletData(walletData, passkey);
      if (!target) return null;

      return {
        account,
        walletAddress,
        authIdx: target.authIdx,
        authorities: target.authorities,
      };
    } catch {
      return null;
    }
  });

  return targets.filter(
    (target): target is PasskeyAuthorityTarget<T> => target !== null
  );
}
