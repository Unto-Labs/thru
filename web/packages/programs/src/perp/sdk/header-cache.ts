import { readAccount, rpcChainId, type ThruClient } from './rpc';

/* The header fields transactions.build would otherwise fetch on every call,
   one after another: the fee payer's nonce, the finalized slot and the
   chain id (three sequential round trips before every transaction). Here
   they are fetched in parallel, and only when not cached:

   - chain id: fixed for the life of a client (rpcChainId, shared with
     the chain check);
   - start slot: the finalized slot, reused for SLOT_MAX_AGE_MS and
     refreshed in the background once SLOT_REFRESH_MS old. A transaction is
     valid for DEFAULT_EXPIRY_AFTER (100) slots from its start slot, about
     50 s on Betanet (2 slots/s), so a start slot a few seconds old costs a
     few slots of that window;
   - nonce: after a transaction from the fee payer executed successfully
     its next nonce is known without a read. A cached nonce is handed out
     once (a second, concurrent send reads the chain like before) and
     dropped on any failure. A wrong nonce is rejected by the runtime
     before anything executes (NONCE_TOO_LOW/HIGH), so it can cost a retry
     but never a double placement. */

export const SLOT_MAX_AGE_MS = 5_000;
export const SLOT_REFRESH_MS = 1_000;
export const PREFETCH_MAX_AGE_MS = 2_000;

export interface TxHeaderFields {
  nonce: bigint;
  startSlot: bigint;
  chainId: number;
  /** True when the nonce came from the cache rather than a read. */
  nonceCached: boolean;
}

export class TxHeaderCache {
  private slot: { value: bigint; at: number } | null = null;
  private slotRead: Promise<bigint> | null = null;
  private readonly nonces = new Map<string, bigint>();
  private readonly prefetched = new Map<string, { read: Promise<bigint>; at: number }>();

  constructor(
    private readonly sdk: TxHeaderClient,
    private readonly now: () => number = Date.now,
  ) {}

  /** Starts the reads the next `fields` call needs, so they overlap other
      work (the book read). A prefetched nonce is used by the next call
      within PREFETCH_MAX_AGE_MS, else read again. */
  prefetch(feePayer: string): void {
    if (!this.nonces.has(feePayer) && !this.prefetched.has(feePayer)) {
      const read = this.readNonce(feePayer);
      read.catch(() => {
        if (this.prefetched.get(feePayer)?.read === read) this.prefetched.delete(feePayer);
      });
      this.prefetched.set(feePayer, { read, at: this.now() });
    }
    void this.startSlot().catch(() => {});
    void this.readChainId().catch(() => {});
  }

  /** Header fields for the next transaction from `feePayer`. `fresh`
      ignores a cached or prefetched nonce and reads it again. */
  async fields(feePayer: string, options: { fresh?: boolean } = {}): Promise<TxHeaderFields> {
    const prefetched = this.prefetched.get(feePayer);
    this.prefetched.delete(feePayer);
    const cached = options.fresh ? undefined : this.nonces.get(feePayer);
    this.nonces.delete(feePayer);
    let nonce: Promise<bigint>;
    if (cached !== undefined) nonce = Promise.resolve(cached);
    else if (!options.fresh && prefetched && this.now() - prefetched.at < PREFETCH_MAX_AGE_MS) nonce = prefetched.read;
    else nonce = this.readNonce(feePayer);
    const [value, startSlot, chainId] = await Promise.all([nonce, this.startSlot(), this.readChainId()]);
    return { nonce: value, startSlot, chainId, nonceCached: cached !== undefined };
  }

  /** A transaction with `nonce` executed: the fee payer's next is nonce + 1. */
  confirmed(feePayer: string, nonce: bigint): void {
    this.nonces.set(feePayer, nonce + 1n);
  }

  invalidate(feePayer: string): void {
    this.nonces.delete(feePayer);
    this.prefetched.delete(feePayer);
  }

  private async readNonce(feePayer: string): Promise<bigint> {
    const nonce = (await readAccount(this.sdk, feePayer, { attempts: 3 })).meta?.nonce;
    if (nonce === undefined) throw new Error('fee payer account nonce is unavailable');
    return nonce;
  }

  private readChainId(): Promise<number> {
    return rpcChainId(this.sdk);
  }

  private startSlot(): Promise<bigint> {
    const age = this.slot ? this.now() - this.slot.at : Infinity;
    if (age < SLOT_MAX_AGE_MS) {
      if (age >= SLOT_REFRESH_MS) void this.readSlot().catch(() => {});
      return Promise.resolve(this.slot!.value);
    }
    return this.readSlot();
  }

  private readSlot(): Promise<bigint> {
    if (!this.slotRead) {
      const at = this.now();
      this.slotRead = Promise.resolve()
        .then(() => this.sdk.blocks.getBlockHeight())
        .then((height) => {
          if (!this.slot || height.finalized >= this.slot.value) this.slot = { value: height.finalized, at };
          return height.finalized;
        })
        .finally(() => {
          this.slotRead = null;
        });
    }
    return this.slotRead;
  }
}

export type TxHeaderClient = Pick<ThruClient, 'accounts' | 'chain' | 'blocks'>;

const caches = new WeakMap<TxHeaderClient, TxHeaderCache>();

/** The client's header cache (one per client, so per RPC endpoint). */
export function txHeaderCache(sdk: TxHeaderClient): TxHeaderCache {
  let cache = caches.get(sdk);
  if (!cache) {
    cache = new TxHeaderCache(sdk);
    caches.set(sdk, cache);
  }
  return cache;
}
