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
  /**
   * Per-address (slot, seq) of the last ACCEPTED update or seed -- deletes
   * included. This is the cache's only version memory that SURVIVES entry
   * removal: `entries` alone cannot detect staleness once an address's
   * entry is gone (dropped by an accepted delete, or LRU-evicted), so a
   * seed()/applyUpdate() arriving afterward would otherwise pass the
   * freshness check vacuously against a missing entry. See isNewerThanFloor
   * / isOlderThanFloor / raiseFloor for how this is consulted and advanced,
   * and drop() for why eviction deliberately does not touch it.
   */
  private readonly versionFloor = new Map<string, { slot: bigint; seq: bigint }>();
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
   * source. Only STRICTLY-older-than-floor seeds (delete or not) are
   * ignored -- checked against the per-address version floor, NOT just the
   * current cache entry, so a stale in-flight resync/snapshot fetch can
   * neither roll back newer streamed state nor, critically, revive
   * pre-delete bytes after the entry it would have been compared against
   * was already dropped (UNTO-2632 P1: `entries` alone forgets an address's
   * version the moment its entry is removed, so a stale seed arriving after
   * an accepted delete used to pass this check vacuously).
   *
   * An EQUAL-to-floor seed is deliberately accepted: seeds carry
   * authoritative full images, and equal-version overwrite is the repair
   * path for a half-applied overlay. A disconnect mid-version leaves a
   * dirty entry holding only some of version (S, N)'s pages -- with the
   * floor already raised to (S, N) by those overlays -- and the reconnect
   * catch-up refetch returns exactly (S, N) when the account has not
   * changed since. A strict gate would reject that repair, leaving the
   * corrupt bytes as the base every later delta overlays onto.
   *
   * A delete snapshot (backfill/catch-up/resync can all observe an account
   * as already deleted) drops the cache entry instead of replacing it;
   * non-delete seeds keep their unconditional-overwrite semantics (once
   * past the freshness gate) -- seed() is the authoritative refresh path
   * and callers rely on it being able to replace cached data outright.
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
    if (this.isOlderThanFloor(state.addressHex, state.slot, state.seq)) {
      return;
    }
    const existing = this.entries.get(state.addressHex);
    if (state.isDelete) {
      this.drop(state.addressHex);
      this.raiseFloor(state.addressHex, state.slot, state.seq);
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
    this.raiseFloor(state.addressHex, state.slot, state.seq);
  }

  /** Apply one streamed update (page delta, delete, or meta-only). */
  applyUpdate(address: Uint8Array, addressHex: string, update: AccountUpdate): ApplyUpdateResult {
    const slot = BigInt(update.slot.toString());

    /* Top-level seq (AccountUpdate.seq) is always present, unlike
       update.meta?.seq which is stripped under DATA_ONLY/PUBKEY_ONLY
       views (META_ONLY strips data, not meta). Source it from there
       instead of falling back to 0n. */
    const topSeq = BigInt(update.seq.toString());

    if (update.delete) {
      /* Reject a stale/duplicate delete against the version floor, BEFORE
         any state mutation. See the comparison helper in account-replay.ts
         for the UNTO-2630 grounding: plain lexicographic (slot, seq),
         applied identically to deletes and non-delete updates -- there is
         no separate persistent tombstone. Checked against the floor rather
         than the current entry so a delete redelivered after this same
         address was already dropped by an earlier accepted delete is still
         rejected (UNTO-2632 P1) -- a missing floor (never seen before)
         means any delete is accepted. */
      if (!this.isNewerThanFloor(addressHex, slot, topSeq)) {
        this.counters.staleDropped++;
        return { kind: "stale" };
      }

      this.drop(addressHex);
      this.raiseFloor(addressHex, slot, topSeq);
      this.counters.immediateEmits++;
      return {
        kind: "emit",
        account: {
          address,
          slot,
          seq: topSeq,
          meta: update.meta!,
          data: new Uint8Array(0),
          isDelete: true,
        },
      };
    }

    /* Every server-produced delta carries meta (ingest_handlers.go:101) so
       we know the page's dataSize; the seq itself is now sourced from the
       top-level field above regardless of meta's presence. */
    if (!update.meta) {
      this.counters.resyncsRequested++;
      return { kind: "resync" };
    }

    const seq = topSeq;
    const dataSize = Number(update.meta.dataSize);

    /* Single-page accounts with page data carry the complete account. A
       metadata-only update, however, must retain the previously cached
       bytes; synthesizing a zero-filled buffer would corrupt the account. */
    if (dataSize <= PAGE_SIZE) {
      /* Checked against the version floor rather than the entry directly
         (see seed() / UNTO-2632 P1): the entry may already be gone (an
         accepted delete or LRU eviction), and the floor is the only thing
         that still remembers this address was already at a newer version. */
      if (!this.isNewerThanFloor(addressHex, slot, seq)) {
        this.counters.staleDropped++;
        return { kind: "stale" };
      }
      const entry = this.entries.get(addressHex);

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
      this.raiseFloor(addressHex, slot, seq);
      this.counters.immediateEmits++;
      return {
        kind: "emit",
        account: { address, slot, seq, meta: update.meta, data, isDelete: false },
      };
    }

    const entry = this.entries.get(addressHex);
    if (!entry) {
      /* No cached bytes to overlay onto (never seeded, or dropped by a
         delete/eviction). Still consult the floor before asking for a
         resync: a delta that is actually stale relative to a version we
         already know about (via the floor, even without an entry) should
         be dropped outright rather than triggering a wasted refetch. */
      if (!this.isNewerThanFloor(addressHex, slot, seq)) {
        this.counters.staleDropped++;
        return { kind: "stale" };
      }
      this.counters.resyncsRequested++;
      this.logger.debug(
        `[page-cache] delta for uncached multi-page account ${addressHex} (slot ${slot}); requesting resync`
      );
      return { kind: "resync" };
    }
    /* A transaction can emit one update per changed page, with every page
       carrying the same (slot, seq). Reject only an older version here so
       all pages from the current version are overlaid before the flush.
       Compared against the floor, not the entry directly: the floor is
       proven >= the entry's version (raised alongside every entry write
       below), so this is equivalent whenever an entry exists, and it stays
       correct in the `!entry` branch above where there is no entry to
       compare against at all. entry.dirty itself is orthogonal (a
       capacity/in-flight-transaction concern, not a version one) and is
       still read directly off the entry. */
    if (
      this.isOlderThanFloor(addressHex, slot, seq) ||
      (!entry.dirty && !this.isNewerThanFloor(addressHex, slot, seq))
    ) {
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
    this.raiseFloor(addressHex, slot, seq);
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
    this.versionFloor.clear();
    this.totalBytes = 0;
    this.dirtyAccounts = 0;
    this.updatePressureThresholds();
  }

  /**
   * True when (slot, seq) is strictly newer than the address's version
   * floor, or the address has no floor yet (never seen before -- anything
   * is accepted). Mirrors isNewerAccountVersion's plain lexicographic
   * comparison in account-replay.ts.
   */
  private isNewerThanFloor(addressHex: string, slot: bigint, seq: bigint): boolean {
    const floor = this.versionFloor.get(addressHex);
    if (!floor) return true;
    return slot > floor.slot || (slot === floor.slot && seq > floor.seq);
  }

  /** True when (slot, seq) is strictly older than the address's version
      floor. False (not older) when there is no floor yet. */
  private isOlderThanFloor(addressHex: string, slot: bigint, seq: bigint): boolean {
    const floor = this.versionFloor.get(addressHex);
    if (!floor) return false;
    return slot < floor.slot || (slot === floor.slot && seq < floor.seq);
  }

  /**
   * Advance the version floor for an address to (slot, seq) if it is newer
   * than what's already recorded. Called on every ACCEPTED update or seed
   * -- i.e. every path that writes a new entry or drops one via an accepted
   * delete -- so the floor is always >= the corresponding entry's version
   * whenever an entry exists.
   *
   * Deliberately NOT called from the resync-triggering drop sites (account
   * growth, an out-of-bounds page, an incomplete single-page update): those
   * deltas passed the freshness check against the *previous* version, but
   * this layer never actually accepted/cached their own (slot, seq) -- it
   * bounced back a `resync` request instead. The eventual seed() that
   * satisfies that resync will typically carry that exact (slot, seq); if
   * the floor were raised at the drop site, that legitimate seed would
   * itself be rejected as "not newer than the floor" (see isNewerThanFloor,
   * a strict comparison). Leaving the floor at the last successfully
   * cached version keeps that follow-up seed valid.
   */
  private raiseFloor(addressHex: string, slot: bigint, seq: bigint): void {
    const floor = this.versionFloor.get(addressHex);
    if (!floor || slot > floor.slot || (slot === floor.slot && seq > floor.seq)) {
      this.versionFloor.set(addressHex, { slot, seq });
    }
  }

  /**
   * Drop an address's cache entry (accounting only -- callers are
   * responsible for the version floor, since not every drop represents an
   * accepted version: see raiseFloor). Deliberately never touches
   * `versionFloor` itself, for two distinct reasons depending on the
   * caller:
   *   - Accepted-delete / superseded-entry drops: the caller raises the
   *     floor itself immediately after calling drop(), to the delete's own
   *     (slot, seq).
   *   - Capacity-driven LRU eviction (evictOverBudget) and
   *     cannot-reconstruct drops (growth/out-of-bounds/incomplete-page):
   *     these are not version statements -- eviction is purely a memory
   *     budget concern, and the cannot-reconstruct cases intentionally
   *     leave the floor exactly where raiseFloor's doc explains. Keeping
   *     the floor untouched here means an evicted-then-restale-delivered
   *     update is still correctly rejected by the floor even though its
   *     entry is gone.
   */
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
