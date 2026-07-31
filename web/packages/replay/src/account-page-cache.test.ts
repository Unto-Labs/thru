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
});
