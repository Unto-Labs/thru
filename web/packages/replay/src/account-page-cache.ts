/**
 * Delta overlay cache for streamed account updates.
 *
 * StreamAccountUpdates delivers *page deltas*: one message per page a
 * transaction actually modified, each carrying full account meta. To
 * reconstruct complete account data a consumer must overlay those deltas
 * onto previously known full data — the same model the server's own
 * exporter uses (grpc/internal/app/exporter/insert_accounts.go, keyed by
 * (address, page_idx)).
 *
 * This cache holds the full data buffer per account, seeded from a source
 * of complete data (backfill GetAccount, catch-up GetAccount, stream
 * snapshots, or resync fetches), applies page deltas as overlays, and
 * yields assembled full accounts at block boundaries via flushDirty().
 *
 * It replaces the internal use of PageAssembler, which assumed every
 * update arrives as the complete page set (ceil(dataSize/PAGE_SIZE)
 * pages). That assumption only holds for single-page accounts or full
 * rewrites; for larger accounts with partial writes the set never
 * completed and live account events were silently never emitted.
 */

import type { AccountMeta, AccountUpdate } from "@thru/sdk/proto";
import { NOOP_LOGGER } from "./logger";
import type { ReplayLogger } from "./types";
import { PAGE_SIZE, type AssembledAccount } from "./page-assembler";

/** Default byte budget for cached account data (LRU-evicted beyond this). */
export const DEFAULT_CACHE_MAX_BYTES = 256 * 1024 * 1024;
const CACHE_PRESSURE_THRESHOLDS = [85, 95] as const;

interface CachedAccount {
  address: Uint8Array;
  meta: AccountMeta;
  data: Uint8Array;
  slot: bigint;
  seq: bigint;
  dirty: boolean;
}

/** Outcome of applying one streamed update to the cache. */
export type ApplyUpdateResult =
  /** Complete account state is available now — emit immediately. */
  | { kind: "emit"; account: AssembledAccount }
  /** Delta overlaid onto cached data; emitted on the next flushDirty(). */
  | { kind: "buffered" }
  /** Older than cached state (or unusable) — safe to ignore. */
  | { kind: "stale" }
  /**
   * Cache cannot produce full data for this account (never seeded, data
   * grew, or delta out of bounds). Caller must refetch the account via
   * GetAccount and seed() the result.
   */
  | { kind: "resync" };

export interface AccountPageCacheOptions {
  /** Byte budget for cached data; least-recently-touched accounts are
      evicted beyond it (eviction only costs a resync on next touch). */
  maxBytes?: number;
  logger?: ReplayLogger;
}

export interface AccountPageCacheCounters {
  overlaysApplied: number;
  immediateEmits: number;
  flushedAccounts: number;
  resyncsRequested: number;
  staleDropped: number;
  evictions: number;
  dirtyEvictions: number;
}

/** Point-in-time operational statistics for cached account data. */
export interface AccountPageCacheStats {
  /** Bytes occupied by cached account data buffers, not Node.js process memory. */
  readonly cacheBytes: number;
  readonly cacheMaxBytes: number;
  readonly cacheUsagePercent: number;
  readonly cachedAccounts: number;
  readonly dirtyAccounts: number;
  readonly evictionsTotal: number;
  readonly dirtyEvictionsTotal: number;
}

export class AccountPageCache {
  /** Insertion order doubles as LRU order (entries re-inserted on touch). */
  private readonly entries = new Map<string, CachedAccount>();
  private readonly maxBytes: number;
  private readonly logger: ReplayLogger;
  private totalBytes = 0;
  private dirtyAccounts = 0;
  private readonly activePressureThresholds = new Set<number>();
  readonly counters: AccountPageCacheCounters = {
    overlaysApplied: 0,
    immediateEmits: 0,
    flushedAccounts: 0,
    resyncsRequested: 0,
    staleDropped: 0,
    evictions: 0,
    dirtyEvictions: 0,
  };

  constructor(options: AccountPageCacheOptions = {}) {
    this.maxBytes = options.maxBytes ?? DEFAULT_CACHE_MAX_BYTES;
    this.logger = options.logger ?? NOOP_LOGGER;
  }

  get size(): number {
    return this.entries.size;
  }

  /** Return an immutable point-in-time snapshot of cache statistics. */
  getStats(): Readonly<AccountPageCacheStats> {
    return Object.freeze({
      cacheBytes: this.totalBytes,
      cacheMaxBytes: this.maxBytes,
      cacheUsagePercent: this.cacheUsagePercent(),
      cachedAccounts: this.entries.size,
      dirtyAccounts: this.dirtyAccounts,
      evictionsTotal: this.counters.evictions,
      dirtyEvictionsTotal: this.counters.dirtyEvictions,
    });
  }

  /**
   * Seed (or refresh) an account with complete data from an authoritative
   * source. Older-than-cached seeds are ignored so an in-flight resync
   * fetch cannot roll back newer streamed state.
   */
  seed(state: {
    address: Uint8Array;
    addressHex: string;
    meta: AccountMeta;
    data: Uint8Array;
    slot: bigint;
    seq: bigint;
    isDelete?: boolean;
  }): void {
    if (state.isDelete) {
      this.drop(state.addressHex);
      return;
    }
    const existing = this.entries.get(state.addressHex);
    if (existing && !this.isNewer(existing, state.slot, state.seq)) {
      return;
    }
    const data = new Uint8Array(state.data.length);
    data.set(state.data);
    this.replaceEntry(state.addressHex, {
      address: state.address,
      meta: state.meta,
      data,
      slot: state.slot,
      seq: state.seq,
      dirty: existing?.dirty ?? false,
    });
  }

  /** Apply one streamed update (page delta, delete, or meta-only). */
  applyUpdate(address: Uint8Array, addressHex: string, update: AccountUpdate): ApplyUpdateResult {
    const slot = BigInt(update.slot.toString());

    if (update.delete) {
      this.drop(addressHex);
      this.counters.immediateEmits++;
      return {
        kind: "emit",
        account: {
          address,
          slot,
          seq: update.meta?.seq !== undefined ? BigInt(update.meta.seq.toString()) : 0n,
          meta: update.meta!,
          data: new Uint8Array(0),
          isDelete: true,
        },
      };
    }

    /* Every server-produced delta carries meta (ingest_handlers.go:101).
       Without it we know neither size nor seq, so a refetch is the only
       safe recovery. */
    if (!update.meta) {
      this.counters.resyncsRequested++;
      return { kind: "resync" };
    }

    const seq = BigInt(update.meta.seq.toString());
    const dataSize = Number(update.meta.dataSize);

    /* Single-page accounts with page data carry the complete account. A
       metadata-only update, however, must retain the previously cached
       bytes; synthesizing a zero-filled buffer would corrupt the account. */
    if (dataSize <= PAGE_SIZE) {
      const entry = this.entries.get(addressHex);
      if (entry && !this.isNewer(entry, slot, seq)) {
        this.counters.staleDropped++;
        return { kind: "stale" };
      }

      let data: Uint8Array;
      if (!update.page?.pageData) {
        if (!entry || dataSize > entry.data.length) {
          if (entry) this.drop(addressHex);
          this.counters.resyncsRequested++;
          this.logger.debug(
            `[page-cache] metadata-only update for uncached or growing single-page account ${addressHex} (slot ${slot}); requesting resync`
          );
          return { kind: "resync" };
        }
        data = entry.data.slice(0, dataSize);
      } else {
        if (update.page.pageIdx !== 0 || update.page.pageData.length < dataSize) {
          this.drop(addressHex);
          this.counters.resyncsRequested++;
          this.logger.warn(
            `[page-cache] incomplete single-page update for account ${addressHex} (slot ${slot}); requesting resync`
          );
          return { kind: "resync" };
        }
        data = update.page.pageData.slice(0, dataSize);
      }

      this.replaceEntry(addressHex, {
        address,
        meta: update.meta,
        data,
        slot,
        seq,
        dirty: false,
      });
      this.counters.immediateEmits++;
      return {
        kind: "emit",
        account: { address, slot, seq, meta: update.meta, data, isDelete: false },
      };
    }

    const entry = this.entries.get(addressHex);
    if (!entry) {
      this.counters.resyncsRequested++;
      this.logger.debug(
        `[page-cache] delta for uncached multi-page account ${addressHex} (slot ${slot}); requesting resync`
      );
      return { kind: "resync" };
    }
    /* A transaction can emit one update per changed page, with every page
       carrying the same (slot, seq). Reject only an older version here so
       all pages from the current version are overlaid before the flush. */
    if (this.isOlder(entry, slot, seq) || (!entry.dirty && !this.isNewer(entry, slot, seq))) {
      this.counters.staleDropped++;
      return { kind: "stale" };
    }

    if (dataSize > entry.data.length) {
      /* Account grew: pages beyond the old size may never have been
         streamed to us, so cached data cannot be extended safely. */
      this.drop(addressHex);
      this.counters.resyncsRequested++;
      this.logger.debug(
        `[page-cache] account ${addressHex} grew ${entry.data.length} -> ${dataSize}; requesting resync`
      );
      return { kind: "resync" };
    }
    if (dataSize < entry.data.length) {
      entry.data = entry.data.slice(0, dataSize);
      this.recomputeBytesAfterShrink();
    }

    if (update.page?.pageData) {
      const offset = update.page.pageIdx * PAGE_SIZE;
      if (offset >= dataSize) {
        this.drop(addressHex);
        this.counters.resyncsRequested++;
        this.logger.warn(
          `[page-cache] page ${update.page.pageIdx} out of bounds for ${addressHex} (dataSize ${dataSize}); requesting resync`
        );
        return { kind: "resync" };
      }
      const pageData = update.page.pageData.subarray(0, Math.min(update.page.pageData.length, dataSize - offset));
      entry.data.set(pageData, offset);
      this.counters.overlaysApplied++;
    }

    entry.meta = update.meta;
    entry.slot = slot;
    entry.seq = seq;
    if (!entry.dirty) {
      entry.dirty = true;
      this.dirtyAccounts++;
    }
    this.touch(addressHex, entry);
    return { kind: "buffered" };
  }

  /**
   * Return assembled accounts for everything dirtied since the last flush.
   * Call at block boundaries (`finished` messages) so consumers never see
   * torn mid-transaction data.
   */
  flushDirty(): AssembledAccount[] {
    const out: AssembledAccount[] = [];
    for (const entry of this.entries.values()) {
      if (!entry.dirty) continue;
      entry.dirty = false;
      this.dirtyAccounts--;
      const data = new Uint8Array(entry.data.length);
      data.set(entry.data);
      out.push({
        address: entry.address,
        slot: entry.slot,
        seq: entry.seq,
        meta: entry.meta,
        data,
        isDelete: false,
      });
    }
    this.counters.flushedAccounts += out.length;
    return out;
  }

  clear(): void {
    this.entries.clear();
    this.totalBytes = 0;
    this.dirtyAccounts = 0;
    this.updatePressureThresholds();
  }

  private isNewer(entry: CachedAccount, slot: bigint, seq: bigint): boolean {
    return slot > entry.slot || (slot === entry.slot && seq > entry.seq);
  }

  private isOlder(entry: CachedAccount, slot: bigint, seq: bigint): boolean {
    return slot < entry.slot || (slot === entry.slot && seq < entry.seq);
  }

  private drop(addressHex: string): void {
    const entry = this.entries.get(addressHex);
    if (entry) {
      this.totalBytes -= entry.data.length;
      if (entry.dirty) {
        this.dirtyAccounts--;
      }
      this.entries.delete(addressHex);
      this.updatePressureThresholds();
    }
  }

  private replaceEntry(addressHex: string, entry: CachedAccount): void {
    const existing = this.entries.get(addressHex);
    if (existing) {
      this.totalBytes -= existing.data.length;
      if (existing.dirty) {
        this.dirtyAccounts--;
      }
      this.entries.delete(addressHex);
    }
    this.entries.set(addressHex, entry);
    this.totalBytes += entry.data.length;
    if (entry.dirty) {
      this.dirtyAccounts++;
    }
    this.updatePressureThresholds();
    this.evictOverBudget();
  }

  /** Move an entry to the most-recently-used position. */
  private touch(addressHex: string, entry: CachedAccount): void {
    this.entries.delete(addressHex);
    this.entries.set(addressHex, entry);
  }

  private evictOverBudget(): void {
    while (this.totalBytes > this.maxBytes && this.entries.size > 1) {
      /* Never evict a dirty entry ahead of clean ones — its state would be
         lost before the next flush. Prefer the least-recently-used clean
         entry; fall back to LRU overall if everything is dirty. */
      let victimKey: string | null = null;
      for (const [key, entry] of this.entries) {
        if (!entry.dirty) {
          victimKey = key;
          break;
        }
      }
      if (victimKey === null) {
        victimKey = this.entries.keys().next().value ?? null;
      }
      if (victimKey === null) return;
      const victim = this.entries.get(victimKey);
      if (!victim) return;
      if (victim.dirty) {
        this.counters.dirtyEvictions++;
        const stats = this.getStats();
        this.logger.error("Replay cache evicted dirty account", {
          event: "replay.cache.dirty_eviction",
          address: victimKey,
          slot: victim.slot.toString(),
          seq: victim.seq.toString(),
          cache_bytes: stats.cacheBytes,
          cache_max_bytes: stats.cacheMaxBytes,
          dirty_accounts: stats.dirtyAccounts,
        });
      }
      this.drop(victimKey);
      this.counters.evictions++;
      this.logger.debug(`[page-cache] evicted ${victimKey} (budget ${this.maxBytes} bytes)`);
    }
  }

  private recomputeBytesAfterShrink(): void {
    let total = 0;
    for (const entry of this.entries.values()) total += entry.data.length;
    this.totalBytes = total;
    this.updatePressureThresholds();
  }

  private cacheUsagePercent(): number {
    const usage =
      this.maxBytes > 0
        ? (this.totalBytes / this.maxBytes) * 100
        : this.totalBytes > 0
          ? 100
          : 0;
    return Math.round(usage * 10) / 10;
  }

  private updatePressureThresholds(): void {
    const stats = this.getStats();
    for (const threshold of CACHE_PRESSURE_THRESHOLDS) {
      const crossed =
        this.maxBytes > 0
          ? this.totalBytes * 100 >= this.maxBytes * threshold
          : this.totalBytes > 0;
      if (!crossed) {
        this.activePressureThresholds.delete(threshold);
        continue;
      }
      if (this.activePressureThresholds.has(threshold)) {
        continue;
      }
      this.activePressureThresholds.add(threshold);
      this.logger.warn("Replay cache pressure threshold crossed", {
        event: "replay.cache.pressure",
        threshold_percent: threshold,
        cache_bytes: stats.cacheBytes,
        cache_max_bytes: stats.cacheMaxBytes,
        cache_usage_percent: stats.cacheUsagePercent,
        cached_accounts: stats.cachedAccounts,
        dirty_accounts: stats.dirtyAccounts,
      });
    }
  }
}
