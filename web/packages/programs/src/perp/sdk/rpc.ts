import { Pubkey, consensus, type Account } from '@thru/sdk';
import type { Thru } from '@thru/sdk/client';
import { StateProofType, type DataSlice } from '@thru/sdk/proto';

/* RPC helpers that work the same in Node and in the browser: reading
   accounts through transient read races, waiting for accounts, state
   proofs.  Nothing here touches the file system or process.env. */

export type ThruClient = Thru;

export function pubkeyBytes(address: string): Uint8Array {
  return Pubkey.from(address).toBytes();
}

export function normalizeAddress(address: string): string {
  return Pubkey.from(address).toThruFmt();
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

/** First line of an error's message (RPC errors carry multi-line details). */
export function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split('\n')[0] ?? message;
}

/** The Alphanet query service refuses an account whose first page was not
    rewritten by the transaction that last bumped its sequence number
    ("account data validation failed ... seq mismatch", surfaced as a gRPC
    `unavailable`). It heals as soon as the next order post rewrites the
    page. A read that timed out or failed on the network is treated the
    same way: worth retrying. */
export function isTransientRead(error: unknown): boolean {
  return /validation failed|seq mismatch|unavailable|deadline|timed out|network|fetch/i.test(errorMessage(error));
}

export function isNotFound(error: unknown): boolean {
  return /not found|NotFound|does not exist/i.test(errorMessage(error));
}

export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/* Account reads occasionally hang for minutes; a hung read is treated like
   an unsettled one so callers can retry or fall back. */
export const DEFAULT_READ_TIMEOUT_MS = 15_000;

export interface ReadAccountOptions {
  /** Attempts before the last transient error is thrown (default 3). */
  attempts?: number;
  timeoutMs?: number;
  /** Read only this byte range of the account's data. */
  dataSlice?: { offset: number; length: number };
  /** Return an archived (compressed) account's last state instead of
      throwing not-found (default true); see isArchivedAccount. */
  archived?: boolean;
}

/* Accounts readAccount returned from archived state. */
const archivedAccounts = new WeakSet<Account>();

/** True for an account readAccount read from archived state: state
    compression archived it, and the next transaction that touches it
    restores it first (restoreArchivedAccounts). Its data is the state it
    was archived with, which nothing can change until it is restored. */
export function isArchivedAccount(account: Account): boolean {
  return archivedAccounts.has(account);
}

/** The archived state of an account that has no current state: one
    current-or-historical read (as the SDK's compression status lookup
    does). Null when it never existed or was deleted. */
async function readArchived(sdk: Pick<ThruClient, 'accounts'>, address: string, options: ReadAccountOptions): Promise<Account | null> {
  try {
    const account = await sdk.accounts.get(address, {
      versionContext: consensus.currentOrHistoricalVersionContext(),
      ...(options.dataSlice ? { dataSlice: options.dataSlice as DataSlice } : {}),
    });
    if (!account.meta || account.meta.flags.isDeleted) return null;
    archivedAccounts.add(account);
    return account;
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

/** Reads an account, retrying transient read races and hung reads with a
    short backoff. Other errors are thrown at once, as is not-found for an
    account that has no archived state either. An archived account is
    returned with its archived data (isArchivedAccount tells it apart). */
export async function readAccount(sdk: Pick<ThruClient, 'accounts'>, address: string, options: ReadAccountOptions = {}): Promise<Account> {
  const attempts = options.attempts ?? 3;
  const timeoutMs = options.timeoutMs ?? DEFAULT_READ_TIMEOUT_MS;
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const read = options.dataSlice
        ? /* the SDK builds the request message from this plain init */
          sdk.accounts.get(address, { dataSlice: options.dataSlice as DataSlice })
        : sdk.accounts.get(address);
      try {
        return await withTimeout(read, timeoutMs, `read ${address}`);
      } catch (error) {
        if (!isNotFound(error) || options.archived === false) throw error;
        const archived = await withTimeout(readArchived(sdk, address, options), timeoutMs, `read archived ${address}`);
        if (archived) return archived;
        throw error;
      }
    } catch (error) {
      if (isNotFound(error) || !isTransientRead(error)) throw error;
      lastError = error;
      await sleep(250 * (attempt + 1));
    }
  }
  throw lastError;
}

/** Whether the account exists, active or archived. */
export async function accountExists(sdk: Pick<ThruClient, 'accounts'>, address: string, options?: ReadAccountOptions): Promise<boolean> {
  try {
    await readAccount(sdk, address, options);
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

/** Polls until the account can be read as active (a freshly created account
    takes a few blocks to become visible). Throws after `retries` attempts. */
export async function waitForAccount(sdk: Pick<ThruClient, 'accounts'>, address: string, label: string, retries = 30, delayMs = 750): Promise<void> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    if (await accountExists(sdk, address, { archived: false })) return;
    if (attempt === retries) throw new Error(`timed out waiting for ${label} ${address}`);
    await sleep(delayMs);
  }
}

/* A client's chain ID does not change, so it is read once per client (the
   chain check and the transaction header share the read). A failed read is
   dropped so the next transaction asks again. */
const chainIds = new WeakMap<Pick<ThruClient, 'chain'>, Promise<number>>();

/** The client's chain ID, read once per client. */
export function rpcChainId(sdk: Pick<ThruClient, 'chain'>): Promise<number> {
  let pending = chainIds.get(sdk);
  if (!pending) {
    const read = Promise.resolve().then(() => sdk.chain.getChainId());
    pending = read;
    chainIds.set(sdk, read);
    read.catch(() => {
      if (chainIds.get(sdk) === read) chainIds.delete(sdk);
    });
  }
  return pending;
}

/** Creating-state proof an instruction needs to create `address`. */
export async function getStateProof(sdk: Pick<ThruClient, 'proofs'>, address: string, label = address): Promise<Uint8Array> {
  const proof = await sdk.proofs.generate({ address, proofType: StateProofType.CREATING });
  if (!proof.proof || proof.proof.length === 0) throw new Error(`a state proof is required to create ${label}`);
  return proof.proof;
}
