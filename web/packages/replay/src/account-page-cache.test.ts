import { create } from "@bufbuild/protobuf";
import { describe, expect, test, vi } from "vitest";
import {
  AccountMetaSchema,
  AccountPageSchema,
  AccountUpdateSchema,
  PubkeySchema,
  type AccountMeta,
  type AccountUpdate,
} from "@thru/sdk/proto";
import { AccountPageCache } from "./account-page-cache";
import { PAGE_SIZE } from "./page-assembler";
import type { ReplayLogger } from "./types";

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function makeMeta(owner: Uint8Array, seq: bigint, dataSize: number): AccountMeta {
  return create(AccountMetaSchema, {
    owner: create(PubkeySchema, { value: owner }),
    seq,
    dataSize,
  });
}

function makeDelta(options: {
  address: Uint8Array;
  slot: bigint;
  seq: bigint;
  dataSize: number;
  pageIdx?: number;
  pageData?: Uint8Array;
  isDelete?: boolean;
  omitMeta?: boolean;
}): AccountUpdate {
  const owner = new Uint8Array([9]);
  return create(AccountUpdateSchema, {
    slot: options.slot,
    seq: options.seq,
    address: create(PubkeySchema, { value: options.address }),
    meta: options.omitMeta ? undefined : makeMeta(owner, options.seq, options.dataSize),
    page:
      options.pageData !== undefined
        ? create(AccountPageSchema, {
            pageIdx: options.pageIdx ?? 0,
            pageSize: options.pageData.length,
            pageData: options.pageData,
          })
        : undefined,
    delete: options.isDelete ? true : undefined,
  });
}

function seedAccount(
  cache: AccountPageCache,
  address: Uint8Array,
  slot: bigint,
  seq: bigint,
  data: Uint8Array
): void {
  cache.seed({
    address,
    addressHex: bytesToHex(address),
    meta: makeMeta(new Uint8Array([9]), seq, data.length),
    data,
    slot,
    seq,
  });
}

function seedDelete(
  cache: AccountPageCache,
  address: Uint8Array,
  slot: bigint,
  seq: bigint
): void {
  cache.seed({
    address,
    addressHex: bytesToHex(address),
    meta: makeMeta(new Uint8Array([9]), seq, 0),
    data: new Uint8Array(0),
    slot,
    seq,
    isDelete: true,
  });
}

function createMockLogger(): ReplayLogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

const ADDR = new Uint8Array([1, 2, 3]);
const ADDR_HEX = bytesToHex(ADDR);
const THREE_PAGES = 3 * PAGE_SIZE;

describe("AccountPageCache", () => {
  test("single-page account emits immediately with page data", () => {
    const cache = new AccountPageCache();
    const payload = new Uint8Array([5, 6, 7]);
    const result = cache.applyUpdate(
      ADDR,
      ADDR_HEX,
      makeDelta({ address: ADDR, slot: 10n, seq: 1n, dataSize: 3, pageIdx: 0, pageData: payload })
    );
    expect(result.kind).toBe("emit");
    if (result.kind !== "emit") return;
    expect(result.account.isDelete).toBe(false);
    expect(Array.from(result.account.data)).toEqual([5, 6, 7]);
    expect(result.account.slot).toBe(10n);
    expect(cache.size).toBe(1);
  });

  test("single-page metadata-only update preserves cached data", () => {
    const cache = new AccountPageCache();
    seedAccount(cache, ADDR, 5n, 1n, new Uint8Array([5, 6, 7]));

    const result = cache.applyUpdate(
      ADDR,
      ADDR_HEX,
      makeDelta({ address: ADDR, slot: 6n, seq: 2n, dataSize: 3 })
    );

    expect(result.kind).toBe("emit");
    if (result.kind !== "emit") return;
    expect(Array.from(result.account.data)).toEqual([5, 6, 7]);
    expect(result.account.slot).toBe(6n);
    expect(result.account.seq).toBe(2n);
  });

  test("unseeded single-page metadata-only update requests resync", () => {
    const cache = new AccountPageCache();

    const result = cache.applyUpdate(
      ADDR,
      ADDR_HEX,
      makeDelta({ address: ADDR, slot: 6n, seq: 2n, dataSize: 3 })
    );

    expect(result.kind).toBe("resync");
    expect(cache.size).toBe(0);
    expect(cache.counters.immediateEmits).toBe(0);
    expect(cache.counters.resyncsRequested).toBe(1);
  });

  test("delete emits immediately and drops cache entry", () => {
    const cache = new AccountPageCache();
    seedAccount(cache, ADDR, 5n, 1n, new Uint8Array(THREE_PAGES));
    const result = cache.applyUpdate(
      ADDR,
      ADDR_HEX,
      makeDelta({ address: ADDR, slot: 6n, seq: 2n, dataSize: THREE_PAGES, isDelete: true })
    );
    expect(result.kind).toBe("emit");
    if (result.kind !== "emit") return;
    expect(result.account.isDelete).toBe(true);
    expect(cache.size).toBe(0);
  });

  test("redelivered duplicate delete after a cross-slot recreate does not drop the recreated cache entry", () => {
    /* Under UNTO-2630, seq only restarts at 0 when an account is
       recreated in a LATER slot; the cache's plain (slot, seq) comparison
       against the current entry (no separate tombstone) already protects
       this case, since the delete's (30,7) is older than the recreated
       entry's (31,0). */
    const cache = new AccountPageCache();

    const deleted = cache.applyUpdate(
      ADDR,
      ADDR_HEX,
      makeDelta({ address: ADDR, slot: 30n, seq: 7n, dataSize: 0, isDelete: true })
    );
    expect(deleted.kind).toBe("emit");
    expect(cache.size).toBe(0);

    const recreated = cache.applyUpdate(
      ADDR,
      ADDR_HEX,
      makeDelta({ address: ADDR, slot: 31n, seq: 0n, dataSize: 3, pageIdx: 0, pageData: new Uint8Array([1, 2, 3]) })
    );
    expect(recreated.kind).toBe("emit");
    expect(cache.size).toBe(1);

    /* A redelivered duplicate of the ORIGINAL delete arrives after the
       account has already been recreated in a later slot. It is older
       than the current cache entry's (31,0) mark, so it is rejected
       before any mutation. */
    const duplicate = cache.applyUpdate(
      ADDR,
      ADDR_HEX,
      makeDelta({ address: ADDR, slot: 30n, seq: 7n, dataSize: 0, isDelete: true })
    );
    expect(duplicate.kind).toBe("stale");
    expect(cache.size).toBe(1);
    expect(cache.counters.staleDropped).toBe(1);

    /* The recreated account's cached data survived: a subsequent delta for
       it overlays cleanly without requiring a resync. */
    const overlaid = cache.applyUpdate(
      ADDR,
      ADDR_HEX,
      makeDelta({ address: ADDR, slot: 31n, seq: 1n, dataSize: 3, pageIdx: 0, pageData: new Uint8Array([4, 5, 6]) })
    );
    expect(overlaid.kind).toBe("emit");
    if (overlaid.kind !== "emit") return;
    expect(Array.from(overlaid.account.data)).toEqual([4, 5, 6]);

    /* A genuinely newer delete (later slot) still drops the entry. */
    const newerDelete = cache.applyUpdate(
      ADDR,
      ADDR_HEX,
      makeDelta({ address: ADDR, slot: 32n, seq: 2n, dataSize: 0, isDelete: true })
    );
    expect(newerDelete.kind).toBe("emit");
    expect(cache.size).toBe(0);
  });

  test("delete(30,7) -> update(31,1) -> redelivered delete(30,9) is rejected against the current entry; a duplicate of the original delete and a genuinely newer delete are handled the same way", () => {
    const cache = new AccountPageCache();

    const deleted = cache.applyUpdate(
      ADDR,
      ADDR_HEX,
      makeDelta({ address: ADDR, slot: 30n, seq: 7n, dataSize: 0, isDelete: true })
    );
    expect(deleted.kind).toBe("emit");

    const updated = cache.applyUpdate(
      ADDR,
      ADDR_HEX,
      makeDelta({ address: ADDR, slot: 31n, seq: 1n, dataSize: 3, pageIdx: 0, pageData: new Uint8Array([1, 2, 3]) })
    );
    expect(updated.kind).toBe("emit");
    expect(cache.size).toBe(1);
    const emitsBeforeStaleDeletes = cache.counters.immediateEmits;

    /* Redelivered delete(30,9) is newer than the original delete(30,7)
       but older than the cached (31,1) entry left by the intervening
       update -- rejected against the current cache entry, the only
       freshness bound a delete needs under UNTO-2630 (see the comparison
       helper in account-replay.ts). */
    const staleDelete = cache.applyUpdate(
      ADDR,
      ADDR_HEX,
      makeDelta({ address: ADDR, slot: 30n, seq: 9n, dataSize: 0, isDelete: true })
    );
    expect(staleDelete.kind).toBe("stale");
    expect(cache.size).toBe(1);
    expect(cache.counters.staleDropped).toBe(1);

    /* An exact duplicate of the original delete(30,7) is rejected the
       same way -- it is even older than (31,1). */
    const duplicate = cache.applyUpdate(
      ADDR,
      ADDR_HEX,
      makeDelta({ address: ADDR, slot: 30n, seq: 7n, dataSize: 0, isDelete: true })
    );
    expect(duplicate.kind).toBe("stale");
    expect(cache.size).toBe(1);
    expect(cache.counters.staleDropped).toBe(2);
    expect(cache.counters.immediateEmits).toBe(emitsBeforeStaleDeletes);

    /* A genuinely newer delete, newer than the (31,1) entry, still
       succeeds. */
    const legitimateDelete = cache.applyUpdate(
      ADDR,
      ADDR_HEX,
      makeDelta({ address: ADDR, slot: 31n, seq: 2n, dataSize: 0, isDelete: true })
    );
    expect(legitimateDelete.kind).toBe("emit");
    expect(cache.size).toBe(0);
  });

  test("delete(30,7) followed by a same-slot lower-seq recreate is rejected by the version floor (UNTO-2632 P1)", () => {
    /* Pre-P1-fix this was the transitional pre-UNTO-2630 case: the cache
       had no persistent version memory for a deleted address (the entry
       was dropped, not retained), so a same-slot recreate at a LOWER seq
       than the delete was accepted vacuously -- indistinguishable from a
       genuinely new incarnation. The version floor now closes that gap
       unconditionally, regardless of runtime era: (30,0) is not newer
       than the floor's (30,7), so it is rejected like any other stale
       update. This also matches the current runtime: under UNTO-2630 an
       in-block delete+recreate reuses (never restarts) seq, so this exact
       sequence cannot occur live -- but the cache no longer depends on
       that invariant to stay correct. */
    const cache = new AccountPageCache();

    const deleted = cache.applyUpdate(
      ADDR,
      ADDR_HEX,
      makeDelta({ address: ADDR, slot: 30n, seq: 7n, dataSize: 0, isDelete: true })
    );
    expect(deleted.kind).toBe("emit");

    const recreateAttempt = cache.applyUpdate(
      ADDR,
      ADDR_HEX,
      makeDelta({ address: ADDR, slot: 30n, seq: 0n, dataSize: 3, pageIdx: 0, pageData: new Uint8Array([1, 2, 3]) })
    );
    expect(recreateAttempt.kind).toBe("stale");
    expect(cache.size).toBe(0);

    /* A genuinely newer update within the same slot is still accepted. */
    const modified = cache.applyUpdate(
      ADDR,
      ADDR_HEX,
      makeDelta({ address: ADDR, slot: 30n, seq: 8n, dataSize: 3, pageIdx: 0, pageData: new Uint8Array([4, 5, 6]) })
    );
    expect(modified.kind).toBe("emit");
    expect(cache.size).toBe(1);

    /* delete(30,9) is newer than the current (30,8) entry. */
    const finalDelete = cache.applyUpdate(
      ADDR,
      ADDR_HEX,
      makeDelta({ address: ADDR, slot: 30n, seq: 9n, dataSize: 0, isDelete: true })
    );
    expect(finalDelete.kind).toBe("emit");
    if (finalDelete.kind !== "emit") return;
    expect(finalDelete.account.isDelete).toBe(true);
    expect(cache.size).toBe(0);
  });

  test("UNTO-2632 P1: a stale resync/snapshot seed after an accepted delete is rejected by the version floor, and a later-slot partial delta requests a resync instead of overlaying onto stale bytes", () => {
    const cache = new AccountPageCache();

    /* Accepted delete drops the entry, but the version floor must survive
       the drop. */
    const deleted = cache.applyUpdate(
      ADDR,
      ADDR_HEX,
      makeDelta({ address: ADDR, slot: 31n, seq: 2n, dataSize: 0, isDelete: true })
    );
    expect(deleted.kind).toBe("emit");
    expect(cache.size).toBe(0);

    /* A stale in-flight resync/snapshot fetch, seeded well before the
       delete was observed, arrives after it. Pre-P1-fix, seed() only
       compared against `entries` -- with the entry gone, this passed the
       freshness check vacuously and reseeded pre-delete bytes. The
       version floor must reject it even though there is no entry left to
       compare against, and the cache must stay empty. */
    seedAccount(cache, ADDR, 30n, 5n, new Uint8Array(THREE_PAGES).fill(0xff));
    expect(cache.size).toBe(0);

    /* A later-slot partial delta (one page of a multi-page account)
       arrives next. With no entry to overlay onto, the cache's contract
       is to request a resync rather than fabricate a partial buffer --
       critically, it must NOT silently overlay onto the stale bytes the
       rejected seed above would have reintroduced. */
    const laterPartial = cache.applyUpdate(
      ADDR,
      ADDR_HEX,
      makeDelta({
        address: ADDR,
        slot: 32n,
        seq: 0n,
        dataSize: THREE_PAGES,
        pageIdx: 1,
        pageData: new Uint8Array(PAGE_SIZE).fill(0xaa),
      })
    );
    expect(laterPartial.kind).toBe("resync");
    expect(cache.size).toBe(0);
    expect(cache.counters.resyncsRequested).toBe(1);
  });

  test("redelivered duplicate delete after a delete-snapshot seed + cross-slot recreate does not drop the recreated entry", () => {
    const cache = new AccountPageCache();

    /* Account observed already-deleted via an authoritative snapshot (e.g.
       backfill/catch-up), not a streamed delete update. seed() records no
       persistent tombstone for this -- it only drops any current cache
       entry, so once the recreate below lands, that recreated entry is
       the sole freshness bound available. */
    seedDelete(cache, ADDR, 30n, 7n);
    expect(cache.size).toBe(0);

    const recreated = cache.applyUpdate(
      ADDR,
      ADDR_HEX,
      makeDelta({ address: ADDR, slot: 31n, seq: 0n, dataSize: 3, pageIdx: 0, pageData: new Uint8Array([1, 2, 3]) })
    );
    expect(recreated.kind).toBe("emit");
    expect(cache.size).toBe(1);

    /* A redelivered duplicate of the delete snapshot's own (slot, seq)
       arrives as a streamed update. It is older than the recreated
       entry's (31,0) mark, so it is rejected against the current cache
       entry. */
    const duplicate = cache.applyUpdate(
      ADDR,
      ADDR_HEX,
      makeDelta({ address: ADDR, slot: 30n, seq: 7n, dataSize: 0, isDelete: true })
    );
    expect(duplicate.kind).toBe("stale");
    expect(cache.size).toBe(1);
    expect(cache.counters.staleDropped).toBe(1);

    /* The recreated account's cached state is intact. */
    const overlaid = cache.applyUpdate(
      ADDR,
      ADDR_HEX,
      makeDelta({ address: ADDR, slot: 31n, seq: 1n, dataSize: 3, pageIdx: 0, pageData: new Uint8Array([4, 5, 6]) })
    );
    expect(overlaid.kind).toBe("emit");
    if (overlaid.kind !== "emit") return;
    expect(Array.from(overlaid.account.data)).toEqual([4, 5, 6]);
  });

  test("non-delete seeding behavior is unaffected by delete seeding", () => {
    const cache = new AccountPageCache();
    seedAccount(cache, ADDR, 5n, 1n, new Uint8Array([1, 2, 3]));
    expect(cache.size).toBe(1);

    /* Older-than-cached non-delete seed is still ignored outright. Probe
       via a newer metadata-only update (rather than re-reading the seeded
       version itself) so the read doesn't get rejected as stale too. */
    seedAccount(cache, ADDR, 4n, 9n, new Uint8Array([9, 9, 9]));
    const staleSeed = cache.applyUpdate(
      ADDR,
      ADDR_HEX,
      makeDelta({ address: ADDR, slot: 6n, seq: 5n, dataSize: 3 })
    );
    expect(staleSeed.kind).toBe("emit");
    if (staleSeed.kind !== "emit") return;
    expect(Array.from(staleSeed.account.data)).toEqual([1, 2, 3]);

    /* A newer non-delete seed still unconditionally overwrites once past
       the freshness gate. */
    seedAccount(cache, ADDR, 7n, 1n, new Uint8Array([7, 8, 9]));
    const refreshed = cache.applyUpdate(
      ADDR,
      ADDR_HEX,
      makeDelta({ address: ADDR, slot: 8n, seq: 1n, dataSize: 3 })
    );
    expect(refreshed.kind).toBe("emit");
    if (refreshed.kind !== "emit") return;
    expect(Array.from(refreshed.account.data)).toEqual([7, 8, 9]);
  });

  test("partial page deltas overlay onto seeded data and flush at boundary", () => {
    const cache = new AccountPageCache();
    const base = new Uint8Array(THREE_PAGES).fill(1);
    seedAccount(cache, ADDR, 5n, 1n, base);

    /* Transaction touches only page 1 of 3 — the exact case PageAssembler
       could never complete. */
    const page1 = new Uint8Array(PAGE_SIZE).fill(2);
    const result = cache.applyUpdate(
      ADDR,
      ADDR_HEX,
      makeDelta({ address: ADDR, slot: 6n, seq: 2n, dataSize: THREE_PAGES, pageIdx: 1, pageData: page1 })
    );
    expect(result.kind).toBe("buffered");

    const flushed = cache.flushDirty();
    expect(flushed).toHaveLength(1);
    const account = flushed[0];
    expect(account.slot).toBe(6n);
    expect(account.seq).toBe(2n);
    expect(account.data[0]).toBe(1); /* page 0 untouched */
    expect(account.data[PAGE_SIZE]).toBe(2); /* page 1 overlaid */
    expect(account.data[2 * PAGE_SIZE]).toBe(1); /* page 2 untouched */
  });

  test("multiple deltas across pages accumulate before a single flush", () => {
    const cache = new AccountPageCache();
    seedAccount(cache, ADDR, 5n, 1n, new Uint8Array(THREE_PAGES).fill(1));

    const first = cache.applyUpdate(
      ADDR,
      ADDR_HEX,
      makeDelta({ address: ADDR, slot: 6n, seq: 2n, dataSize: THREE_PAGES, pageIdx: 0, pageData: new Uint8Array(PAGE_SIZE).fill(3) })
    );
    const second = cache.applyUpdate(
      ADDR,
      ADDR_HEX,
      makeDelta({ address: ADDR, slot: 6n, seq: 2n, dataSize: THREE_PAGES, pageIdx: 2, pageData: new Uint8Array(PAGE_SIZE).fill(4) })
    );
    expect(first.kind).toBe("buffered");
    expect(second.kind).toBe("buffered");

    const flushed = cache.flushDirty();
    expect(flushed).toHaveLength(1);
    expect(flushed[0].seq).toBe(2n);
    expect(flushed[0].data[0]).toBe(3);
    expect(flushed[0].data[PAGE_SIZE]).toBe(1);
    expect(flushed[0].data[2 * PAGE_SIZE]).toBe(4);
    expect(cache.counters.overlaysApplied).toBe(2);
    expect(cache.counters.staleDropped).toBe(0);
  });

  test("flush is idempotent until new deltas arrive", () => {
    const cache = new AccountPageCache();
    seedAccount(cache, ADDR, 5n, 1n, new Uint8Array(THREE_PAGES));
    cache.applyUpdate(
      ADDR,
      ADDR_HEX,
      makeDelta({ address: ADDR, slot: 6n, seq: 2n, dataSize: THREE_PAGES, pageIdx: 0, pageData: new Uint8Array(PAGE_SIZE) })
    );
    expect(cache.flushDirty()).toHaveLength(1);
    expect(cache.flushDirty()).toHaveLength(0);
  });

  test("delta for uncached multi-page account requests resync", () => {
    const cache = new AccountPageCache();
    const result = cache.applyUpdate(
      ADDR,
      ADDR_HEX,
      makeDelta({ address: ADDR, slot: 6n, seq: 2n, dataSize: THREE_PAGES, pageIdx: 1, pageData: new Uint8Array(PAGE_SIZE) })
    );
    expect(result.kind).toBe("resync");
    expect(cache.counters.resyncsRequested).toBe(1);
  });

  test("account growth requests resync and drops stale entry", () => {
    const cache = new AccountPageCache();
    seedAccount(cache, ADDR, 5n, 1n, new Uint8Array(THREE_PAGES));
    const result = cache.applyUpdate(
      ADDR,
      ADDR_HEX,
      makeDelta({ address: ADDR, slot: 6n, seq: 2n, dataSize: THREE_PAGES + PAGE_SIZE, pageIdx: 3, pageData: new Uint8Array(PAGE_SIZE) })
    );
    expect(result.kind).toBe("resync");
    expect(cache.size).toBe(0);
  });

  test("account shrink truncates and keeps overlaying", () => {
    const cache = new AccountPageCache();
    seedAccount(cache, ADDR, 5n, 1n, new Uint8Array(THREE_PAGES).fill(1));
    const result = cache.applyUpdate(
      ADDR,
      ADDR_HEX,
      makeDelta({ address: ADDR, slot: 6n, seq: 2n, dataSize: 2 * PAGE_SIZE, pageIdx: 0, pageData: new Uint8Array(PAGE_SIZE).fill(7) })
    );
    expect(result.kind).toBe("buffered");
    const flushed = cache.flushDirty();
    expect(flushed[0].data.length).toBe(2 * PAGE_SIZE);
    expect(flushed[0].data[0]).toBe(7);
    expect(flushed[0].data[PAGE_SIZE]).toBe(1);
  });

  test("page beyond dataSize requests resync", () => {
    const cache = new AccountPageCache();
    seedAccount(cache, ADDR, 5n, 1n, new Uint8Array(THREE_PAGES));
    const result = cache.applyUpdate(
      ADDR,
      ADDR_HEX,
      makeDelta({ address: ADDR, slot: 6n, seq: 2n, dataSize: THREE_PAGES, pageIdx: 5, pageData: new Uint8Array(PAGE_SIZE) })
    );
    expect(result.kind).toBe("resync");
  });

  test("meta-less update requests resync", () => {
    const cache = new AccountPageCache();
    const result = cache.applyUpdate(
      ADDR,
      ADDR_HEX,
      makeDelta({ address: ADDR, slot: 6n, seq: 2n, dataSize: THREE_PAGES, omitMeta: true })
    );
    expect(result.kind).toBe("resync");
  });

  test("stale delta (older slot/seq) is dropped", () => {
    const cache = new AccountPageCache();
    seedAccount(cache, ADDR, 10n, 5n, new Uint8Array(THREE_PAGES).fill(1));
    const older = cache.applyUpdate(
      ADDR,
      ADDR_HEX,
      makeDelta({ address: ADDR, slot: 9n, seq: 9n, dataSize: THREE_PAGES, pageIdx: 0, pageData: new Uint8Array(PAGE_SIZE).fill(2) })
    );
    const sameSlotOlderSeq = cache.applyUpdate(
      ADDR,
      ADDR_HEX,
      makeDelta({ address: ADDR, slot: 10n, seq: 5n, dataSize: THREE_PAGES, pageIdx: 0, pageData: new Uint8Array(PAGE_SIZE).fill(2) })
    );
    expect(older.kind).toBe("stale");
    expect(sameSlotOlderSeq.kind).toBe("stale");
    expect(cache.flushDirty()).toHaveLength(0);
  });

  test("stale seed cannot roll back newer streamed state", () => {
    const cache = new AccountPageCache();
    seedAccount(cache, ADDR, 5n, 1n, new Uint8Array(THREE_PAGES).fill(1));
    cache.applyUpdate(
      ADDR,
      ADDR_HEX,
      makeDelta({ address: ADDR, slot: 8n, seq: 3n, dataSize: THREE_PAGES, pageIdx: 0, pageData: new Uint8Array(PAGE_SIZE).fill(9) })
    );
    /* A resync fetch that raced and returned older data must not clobber. */
    seedAccount(cache, ADDR, 6n, 2n, new Uint8Array(THREE_PAGES).fill(1));
    const flushed = cache.flushDirty();
    expect(flushed).toHaveLength(1);
    expect(flushed[0].slot).toBe(8n);
    expect(flushed[0].data[0]).toBe(9);
  });

  test("LRU byte budget evicts clean entries first", () => {
    const cache = new AccountPageCache({ maxBytes: 2 * THREE_PAGES });
    const a = new Uint8Array([1]);
    const b = new Uint8Array([2]);
    const c = new Uint8Array([3]);
    seedAccount(cache, a, 5n, 1n, new Uint8Array(THREE_PAGES));
    seedAccount(cache, b, 5n, 1n, new Uint8Array(THREE_PAGES));
    /* Dirty `b` so eviction must prefer clean `a`. */
    cache.applyUpdate(
      b,
      bytesToHex(b),
      makeDelta({ address: b, slot: 6n, seq: 2n, dataSize: THREE_PAGES, pageIdx: 0, pageData: new Uint8Array(PAGE_SIZE) })
    );
    seedAccount(cache, c, 5n, 1n, new Uint8Array(THREE_PAGES));
    expect(cache.counters.evictions).toBe(1);
    /* `a` was evicted: a new delta for it must resync. */
    const result = cache.applyUpdate(
      a,
      bytesToHex(a),
      makeDelta({ address: a, slot: 7n, seq: 3n, dataSize: THREE_PAGES, pageIdx: 0, pageData: new Uint8Array(PAGE_SIZE) })
    );
    expect(result.kind).toBe("resync");
    /* Dirty `b` survived and still flushes. */
    expect(cache.flushDirty().map((acct) => bytesToHex(acct.address))).toEqual([bytesToHex(b)]);
  });

  test("statistics track account-data bytes, accounts, and dirty accounts", () => {
    const cache = new AccountPageCache({ maxBytes: 10 * PAGE_SIZE });
    const a = new Uint8Array([10]);
    const b = new Uint8Array([11]);

    seedAccount(cache, a, 5n, 1n, new Uint8Array(3 * PAGE_SIZE));
    seedAccount(cache, b, 5n, 1n, new Uint8Array(2 * PAGE_SIZE));

    const seededStats = cache.getStats();
    expect(seededStats).toEqual({
      cacheBytes: 5 * PAGE_SIZE,
      cacheMaxBytes: 10 * PAGE_SIZE,
      cacheUsagePercent: 50,
      cachedAccounts: 2,
      dirtyAccounts: 0,
      evictionsTotal: 0,
      dirtyEvictionsTotal: 0,
    });
    expect(Object.isFrozen(seededStats)).toBe(true);

    cache.applyUpdate(
      a,
      bytesToHex(a),
      makeDelta({
        address: a,
        slot: 6n,
        seq: 2n,
        dataSize: 3 * PAGE_SIZE,
        pageIdx: 0,
        pageData: new Uint8Array(PAGE_SIZE),
      })
    );
    cache.applyUpdate(
      b,
      bytesToHex(b),
      makeDelta({
        address: b,
        slot: 6n,
        seq: 2n,
        dataSize: 2 * PAGE_SIZE,
        pageIdx: 0,
        pageData: new Uint8Array(PAGE_SIZE),
      })
    );
    expect(cache.getStats().dirtyAccounts).toBe(2);

    cache.flushDirty();
    expect(cache.getStats().dirtyAccounts).toBe(0);

    cache.applyUpdate(
      b,
      bytesToHex(b),
      makeDelta({
        address: b,
        slot: 7n,
        seq: 3n,
        dataSize: PAGE_SIZE + 10,
        pageIdx: 0,
        pageData: new Uint8Array(PAGE_SIZE),
      })
    );
    expect(cache.getStats()).toMatchObject({
      cacheBytes: 4 * PAGE_SIZE + 10,
      cachedAccounts: 2,
      dirtyAccounts: 1,
    });

    cache.applyUpdate(
      a,
      bytesToHex(a),
      makeDelta({
        address: a,
        slot: 8n,
        seq: 4n,
        dataSize: 3 * PAGE_SIZE,
        isDelete: true,
      })
    );
    expect(cache.getStats()).toMatchObject({
      cacheBytes: PAGE_SIZE + 10,
      cachedAccounts: 1,
      dirtyAccounts: 1,
    });

    cache.clear();
    expect(cache.getStats()).toMatchObject({
      cacheBytes: 0,
      cachedAccounts: 0,
      dirtyAccounts: 0,
    });
  });

  test("cache pressure warnings fire once per threshold crossing", () => {
    const logger = createMockLogger();
    const cache = new AccountPageCache({ maxBytes: 100, logger });
    const address = new Uint8Array([12]);
    const addressHex = bytesToHex(address);

    seedAccount(cache, address, 1n, 1n, new Uint8Array(86));
    seedAccount(cache, address, 2n, 2n, new Uint8Array(90));
    seedAccount(cache, address, 3n, 3n, new Uint8Array(96));

    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenNthCalledWith(
      1,
      "Replay cache pressure threshold crossed",
      expect.objectContaining({
        event: "replay.cache.pressure",
        threshold_percent: 85,
        cache_bytes: 86,
        cache_usage_percent: 86,
      })
    );
    expect(logger.warn).toHaveBeenNthCalledWith(
      2,
      "Replay cache pressure threshold crossed",
      expect.objectContaining({
        event: "replay.cache.pressure",
        threshold_percent: 95,
        cache_bytes: 96,
        cache_usage_percent: 96,
      })
    );

    cache.applyUpdate(
      address,
      addressHex,
      makeDelta({ address, slot: 4n, seq: 4n, dataSize: 96, isDelete: true })
    );
    seedAccount(cache, address, 5n, 5n, new Uint8Array(96));

    expect(logger.warn).toHaveBeenCalledTimes(4);
    expect(logger.warn).toHaveBeenNthCalledWith(
      3,
      "Replay cache pressure threshold crossed",
      expect.objectContaining({ threshold_percent: 85 })
    );
    expect(logger.warn).toHaveBeenNthCalledWith(
      4,
      "Replay cache pressure threshold crossed",
      expect.objectContaining({ threshold_percent: 95 })
    );
  });

  test("dirty eviction logs account and cache information without account data", () => {
    const logger = createMockLogger();
    const cache = new AccountPageCache({ maxBytes: 2 * THREE_PAGES, logger });
    const a = new Uint8Array([13]);
    const b = new Uint8Array([14]);

    seedAccount(cache, a, 5n, 1n, new Uint8Array(THREE_PAGES));
    seedAccount(cache, b, 5n, 1n, new Uint8Array(THREE_PAGES));
    for (const address of [a, b]) {
      cache.applyUpdate(
        address,
        bytesToHex(address),
        makeDelta({
          address,
          slot: 6n,
          seq: 2n,
          dataSize: THREE_PAGES,
          pageIdx: 0,
          pageData: new Uint8Array(PAGE_SIZE),
        })
      );
    }

    seedAccount(cache, b, 7n, 3n, new Uint8Array(2 * THREE_PAGES));

    expect(cache.getStats()).toMatchObject({
      evictionsTotal: 1,
      dirtyEvictionsTotal: 1,
      dirtyAccounts: 1,
    });
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      "Replay cache evicted dirty account",
      {
        event: "replay.cache.dirty_eviction",
        address: bytesToHex(a),
        slot: "6",
        seq: "2",
        cache_bytes: 3 * THREE_PAGES,
        cache_max_bytes: 2 * THREE_PAGES,
        dirty_accounts: 2,
      }
    );
    const metadata = vi.mocked(logger.error).mock.calls[0]?.[1];
    expect(metadata).not.toHaveProperty("data");
    expect(metadata).not.toHaveProperty("meta");
  });

  test("counters track overlays, flushes and stales", () => {
    const cache = new AccountPageCache();
    seedAccount(cache, ADDR, 5n, 1n, new Uint8Array(THREE_PAGES));
    cache.applyUpdate(
      ADDR,
      ADDR_HEX,
      makeDelta({ address: ADDR, slot: 6n, seq: 2n, dataSize: THREE_PAGES, pageIdx: 0, pageData: new Uint8Array(PAGE_SIZE) })
    );
    cache.applyUpdate(
      ADDR,
      ADDR_HEX,
      makeDelta({ address: ADDR, slot: 6n, seq: 2n, dataSize: THREE_PAGES, pageIdx: 0, pageData: new Uint8Array(PAGE_SIZE) })
    );
    cache.flushDirty();
    cache.applyUpdate(
      ADDR,
      ADDR_HEX,
      makeDelta({ address: ADDR, slot: 5n, seq: 1n, dataSize: THREE_PAGES, pageIdx: 0, pageData: new Uint8Array(PAGE_SIZE) })
    );
    expect(cache.counters.overlaysApplied).toBe(2);
    expect(cache.counters.staleDropped).toBe(1);
    expect(cache.counters.flushedAccounts).toBe(1);
  });

  /* Reconnect-repair regression (Greptile finding on the UNTO-2632 PR): a
     disconnect mid-version leaves a dirty half-applied overlay whose page
     deltas already raised the floor to exactly (S, N). The reconnect
     catch-up then refetches the account and seeds the authoritative full
     image at that same (S, N) -- a strict seed gate rejected that repair,
     so the corrupt bytes stayed as the base every later delta overlaid
     onto. seed() must accept an equal-to-floor seed. */
  test("equal-version catch-up seed repairs a half-applied overlay after a mid-version disconnect", () => {
    const cache = new AccountPageCache();
    const TWO_PAGES = 2 * PAGE_SIZE;
    const pageA0 = new Uint8Array(PAGE_SIZE).fill(0xa0);
    const pageB0 = new Uint8Array(PAGE_SIZE).fill(0xb0);
    const pageA1 = new Uint8Array(PAGE_SIZE).fill(0xa1);
    const pageB1 = new Uint8Array(PAGE_SIZE).fill(0xb1);
    const pageA2 = new Uint8Array(PAGE_SIZE).fill(0xa2);

    /* Baseline version (10, 1). */
    const base = new Uint8Array(TWO_PAGES);
    base.set(pageA0, 0);
    base.set(pageB0, PAGE_SIZE);
    seedAccount(cache, ADDR, 10n, 1n, base);

    /* Version (20, 5) changed both pages, but only page 0's delta arrived
       before the disconnect. The entry is now dirty and half-applied, and
       the floor sits at exactly (20, 5). */
    const partial = cache.applyUpdate(
      ADDR,
      ADDR_HEX,
      makeDelta({ address: ADDR, slot: 20n, seq: 5n, dataSize: TWO_PAGES, pageIdx: 0, pageData: pageA1 })
    );
    expect(partial.kind).toBe("buffered");

    /* Reconnect catch-up: authoritative full image at the same (20, 5).
       Must be accepted and replace the half-applied bytes. */
    const repaired = new Uint8Array(TWO_PAGES);
    repaired.set(pageA1, 0);
    repaired.set(pageB1, PAGE_SIZE);
    seedAccount(cache, ADDR, 20n, 5n, repaired);

    const flushed = cache.flushDirty();
    expect(flushed).toHaveLength(1);
    expect(flushed[0]!.data).toEqual(repaired);

    /* Strictly-older seeds are still rejected: a stale in-flight resync at
       (20, 4) must not roll the repaired state back. */
    const garbage = new Uint8Array(TWO_PAGES).fill(0xee);
    seedAccount(cache, ADDR, 20n, 4n, garbage);

    /* A later partial write overlays onto the REPAIRED base. */
    const later = cache.applyUpdate(
      ADDR,
      ADDR_HEX,
      makeDelta({ address: ADDR, slot: 21n, seq: 1n, dataSize: TWO_PAGES, pageIdx: 0, pageData: pageA2 })
    );
    expect(later.kind).toBe("buffered");
    const expected = new Uint8Array(TWO_PAGES);
    expected.set(pageA2, 0);
    expected.set(pageB1, PAGE_SIZE);
    const finalFlush = cache.flushDirty();
    expect(finalFlush).toHaveLength(1);
    expect(finalFlush[0]!.data).toEqual(expected);
  });
});
