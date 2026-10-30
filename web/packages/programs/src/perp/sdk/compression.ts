import type { AccountCompressionStatus, CompressionResult, WalletCompressionOptions } from '@thru/sdk';

import { normalizeAddress, type ThruClient } from './rpc';

/* State compression: the chain archives idle accounts (EOAs, token
   accounts, mints, the accounts of a quiet market), and a transaction that
   touches an archived account fails until it is restored. Before building a
   transaction, restoreArchivedAccounts checks every account it touches and
   restores the archived ones with sdk.compression.decompressAccounts, signed
   by the same key (tools) or wallet (app) that signs the transaction.

   The common case is "everything active": that costs one metadata read per
   account, issued in parallel (the SDK's getAccountStatuses reads its list
   one account after another, ~85 ms each on Betanet), and nothing at all
   for an account seen active in the last ACTIVE_TTL_MS. An account that was
   just used cannot have gone idle long enough to be archived, so the short
   cache only skips reads that would answer "active" again; a transaction
   that fails anyway should call forgetAccountStatuses for its accounts, and
   one that executed refreshes them (noteAccountsActive). The reads are
   started early (prefetchAccountStatuses) so they overlap the rest of the
   transaction's preparation; only signing waits for them.
   submitPerpTransaction (submit.ts) does all of this when given `archived`. */

/** Signs the restore transaction(s). */
export type RestoreSigner =
  | { kind: 'keypair'; publicKey: string; privateKey: Uint8Array }
  | {
      kind: 'wallet';
      /** The fee payer the wallet signs with (a session key or the wallet's own payer). */
      feePayer: string;
      walletAddress: string;
      signTransaction: WalletCompressionOptions['signTransaction'];
    };

export interface RestoreArchivedOptions {
  /** Every account the transaction touches; the signer's accounts are added. */
  accounts: readonly string[];
  signer: RestoreSigner;
  /** Accounts that are never checked (program accounts, which are not archived). */
  skip?: readonly string[];
  /** Called once, before the restore transaction is signed. */
  onRestoring?: (addresses: string[]) => void;
  signal?: AbortSignal;
  /** Budget for the restore to confirm (default 30 s). */
  timeoutMs?: number;
}

export interface RestoreArchivedResult {
  /** Accounts that were archived and are active again. */
  restored: string[];
  signatures: string[];
}

export type ArchivedAccountsErrorKind = 'cooldown' | 'uncertain' | 'unsupported' | 'failed';

/** Restoring an archived account failed; the caller's transaction was not sent. */
export class ArchivedAccountsError extends Error {
  constructor(
    readonly kind: ArchivedAccountsErrorKind,
    message: string,
    readonly details: { address?: string; retrySlot?: bigint; signatures?: string[]; cause?: unknown } = {},
  ) {
    super(message);
    this.name = 'ArchivedAccountsError';
  }
}

export function isArchivedAccountsError(error: unknown): error is ArchivedAccountsError {
  return error instanceof ArchivedAccountsError;
}

const ACTIVE_TTL_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 30_000;

/* Per client, so two networks never share an entry. */
const activeUntil = new WeakMap<ThruClient, Map<string, number>>();

function activeCache(sdk: ThruClient): Map<string, number> {
  let cache = activeUntil.get(sdk);
  if (!cache) activeUntil.set(sdk, (cache = new Map()));
  return cache;
}

/* Status reads in flight, per client and address: a lookup started early
   (prefetchAccountStatuses, alongside a transaction's other reads) is
   joined by the restore that needs it instead of being issued twice. An
   answer other than ACTIVE (which the active cache keeps) stays joinable
   for SETTLED_REUSE_MS, long enough for that restore to pick it up. */
const SETTLED_REUSE_MS = 2_000;

interface StatusRead {
  read: Promise<AccountCompressionStatus>;
  settledAt?: number;
}

const inFlight = new WeakMap<ThruClient, Map<string, StatusRead>>();

function flights(sdk: ThruClient): Map<string, StatusRead> {
  let map = inFlight.get(sdk);
  if (!map) inFlight.set(sdk, (map = new Map()));
  return map;
}

/** Drops cached "active" statuses, e.g. after a transaction using them failed. */
export function forgetAccountStatuses(sdk: ThruClient, addresses?: readonly string[]): void {
  const cache = activeUntil.get(sdk);
  const pending = inFlight.get(sdk);
  if (!addresses) {
    cache?.clear();
    pending?.clear();
    return;
  }
  for (const address of addresses.map(normalizeAddress)) {
    cache?.delete(address);
    if (pending?.get(address)?.settledAt !== undefined) pending.delete(address);
  }
}

/** Compression statuses of `addresses` (deduplicated, normalized), one
    parallel metadata read each, skipping accounts cached as active and
    joining reads already in flight. */
export async function accountStatuses(
  sdk: ThruClient,
  addresses: readonly string[],
  signal?: AbortSignal,
  now = Date.now(),
): Promise<AccountCompressionStatus[]> {
  const cache = activeCache(sdk);
  const pending = flights(sdk);
  const unique = [...new Set(addresses.map(normalizeAddress))];
  const unknown = unique.filter((address) => (cache.get(address) ?? 0) <= now);
  return Promise.all(
    unknown.map((address) => {
      const current = pending.get(address);
      if (current && (current.settledAt === undefined || Date.now() - current.settledAt < SETTLED_REUSE_MS)) return current.read;
      const entry: StatusRead = {
        read: Promise.resolve()
          .then(() => sdk.compression.getAccountStatuses({ accounts: [address], signal }))
          .then((statuses) => {
            const status = statuses[0]!;
            if (status.status === 'ACTIVE') cache.set(status.address, now + ACTIVE_TTL_MS);
            else cache.delete(status.address);
            return status;
          }),
      };
      pending.set(address, entry);
      entry.read.then(
        (status) => {
          if (pending.get(address) !== entry) return;
          if (status.status === 'ACTIVE') pending.delete(address);
          else entry.settledAt = Date.now();
        },
        () => {
          if (pending.get(address) === entry) pending.delete(address);
        },
      );
      return entry.read;
    }),
  );
}

/** Starts the status lookups a restore of `addresses` will need, so they
    overlap a transaction's other reads (book, header fields, signing
    context). A failure is left for the restore to report. */
export function prefetchAccountStatuses(sdk: ThruClient, addresses: readonly string[], skip: readonly string[] = []): void {
  try {
    const skipped = new Set(skip.map(normalizeAddress));
    void accountStatuses(
      sdk,
      addresses.map(normalizeAddress).filter((address) => !skipped.has(address)),
    ).catch(() => {});
  } catch {
    /* an invalid address: the restore reports it */
  }
}

/** `addresses` were just used by a transaction that executed, so they are
    active: refresh their cached status (a busy sender then never reads
    statuses on its order path). */
export function noteAccountsActive(sdk: ThruClient, addresses: readonly string[], now = Date.now()): void {
  const cache = activeCache(sdk);
  for (const address of addresses) cache.set(normalizeAddress(address), now + ACTIVE_TTL_MS);
}

function short(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

interface CompressionErrorLike {
  name: string;
  code: string;
  message: string;
  details?: { address?: string; retrySlot?: bigint; signature?: string; result?: CompressionResult };
}

/* Matched by shape: the SDK's ESM and CJS bundles each carry their own class. */
function asCompressionError(error: unknown): CompressionErrorLike | null {
  if (!(error instanceof Error) || error.name !== 'CompressionError') return null;
  return typeof (error as { code?: unknown }).code === 'string' ? (error as unknown as CompressionErrorLike) : null;
}

/** Maps an SDK CompressionError (or any failure of decompressAccounts) to an ArchivedAccountsError. */
export function archivedAccountsError(error: unknown): ArchivedAccountsError {
  if (error instanceof ArchivedAccountsError) return error;
  const compression = asCompressionError(error);
  const details = compression?.details ?? {};
  const signatures = [...new Set([...(details.result?.signatures ?? []), ...(details.signature ? [details.signature] : [])])];
  const address = details.address;
  const which = address ? `account ${short(address)}` : 'an archived account';
  switch (compression?.code) {
    case 'NOT_READY':
      return new ArchivedAccountsError(
        'cooldown',
        `${which[0]!.toUpperCase()}${which.slice(1)} was archived moments ago and can be restored from slot ${details.retrySlot ?? 'unknown'}; retry in a few minutes.`,
        { address, retrySlot: details.retrySlot, signatures, cause: error },
      );
    case 'TRANSACTION_UNCERTAIN':
      return new ArchivedAccountsError(
        'uncertain',
        `Restoring ${which} is still awaiting confirmation; nothing else was submitted. Retry shortly.`,
        { address, signatures, cause: error },
      );
    default: {
      const reason = error instanceof Error ? error.message.split('\n')[0] : String(error);
      return new ArchivedAccountsError('failed', `Could not restore ${which}: ${reason}. Nothing else was submitted.`, {
        address,
        signatures,
        cause: error,
      });
    }
  }
}

/** Restores the archived accounts among `options.accounts` (and the
    signer's) so a transaction using them can execute. Does nothing when
    every account is active or does not exist yet (accounts the transaction
    creates). Throws ArchivedAccountsError; nothing is restored then. */
export async function restoreArchivedAccounts(sdk: ThruClient, options: RestoreArchivedOptions): Promise<RestoreArchivedResult> {
  const { signer } = options;
  const feePayer = normalizeAddress(signer.kind === 'keypair' ? signer.publicKey : signer.feePayer);
  const walletAddress = signer.kind === 'wallet' ? normalizeAddress(signer.walletAddress) : null;
  const skip = new Set((options.skip ?? []).map(normalizeAddress));
  const accounts = [feePayer, ...(walletAddress ? [walletAddress] : []), ...options.accounts.map(normalizeAddress)].filter(
    (address) => !skip.has(address),
  );
  let statuses: AccountCompressionStatus[];
  try {
    statuses = await accountStatuses(sdk, accounts, options.signal);
  } catch (error) {
    throw new ArchivedAccountsError('failed', `Could not check whether accounts are archived: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`, { cause: error });
  }
  const archived = statuses.filter((status) => status.status === 'COMPRESSED').map((status) => status.address);
  if (archived.length === 0) return { restored: [], signatures: [] };

  /* A wallet signs through its fee payer and wallet account; neither can be
     restored by a transaction that needs it to sign. (A local key restores
     itself: the SDK sends a payer self-restoration first.) */
  if (signer.kind === 'wallet') {
    const blocked = archived.find((address) => address === feePayer || address === walletAddress);
    if (blocked)
      throw new ArchivedAccountsError(
        'unsupported',
        blocked === feePayer
          ? 'The wallet fee payer is archived; it must be restored before this wallet can sign.'
          : 'Your wallet account is archived; it must be restored before it can sign.',
        { address: blocked },
      );
  }

  options.onRestoring?.(archived);
  const common = {
    accounts: archived,
    fee: 0n,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    ...(options.signal ? { signal: options.signal } : {}),
  };
  try {
    const result = await sdk.compression.decompressAccounts(
      signer.kind === 'keypair'
        ? { ...common, feePayer: { publicKey: feePayer, privateKey: signer.privateKey } }
        : { ...common, feePayer: { publicKey: feePayer }, walletAddress: walletAddress!, signTransaction: signer.signTransaction },
    );
    const now = Date.now();
    const cache = activeCache(sdk);
    for (const address of archived) cache.set(address, now + ACTIVE_TTL_MS);
    return {
      restored: result.accounts.filter((account) => account.status === 'restored').map((account) => account.address),
      signatures: result.signatures,
    };
  } catch (error) {
    throw archivedAccountsError(error);
  }
}
