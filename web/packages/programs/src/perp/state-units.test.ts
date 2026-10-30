import { describe, expect, it } from 'vitest';
import {
  PERP_CBOOK_EMPTY_PRICE_IN_TICKS,
  PERP_CBOOK_MAX_PRICE_IN_TICKS,
  estimatePerpOrderStateUnits,
  parsePerpCbookAccount,
  parsePerpCbookHeader,
  perpAccountStateUnits,
  perpCbookAccountSize,
  perpCbookAfterPost,
  type PerpCbookHeader,
  type PerpOrderEntry,
} from './index';

/* The vectors match thru-perps/tests/test_txn_perp_program/test_state_units.c,
   which runs the same books through the program in LiteVM and checks that
   the estimated units are exactly what the transaction consumes. */

const TICK = 1000n;
/* A market starts with 10-level cbooks (CBOOK_INITIAL_LEVEL_CNT). */
const INITIAL_LEVELS = 10;

function cbook(levelCount: number, best: { side: 'buy' | 'sell'; ticks: bigint } | null, bestLevelIndex = 0): PerpCbookHeader {
  return {
    bestLevelIndex,
    bestPriceInTicks: best === null
      ? PERP_CBOOK_EMPTY_PRICE_IN_TICKS
      : best.side === 'buy' ? PERP_CBOOK_MAX_PRICE_IN_TICKS - best.ticks : best.ticks,
    levelCount,
  };
}

function entry(orderEntryIndex: number, levelAccountIndex: number, levelIndex: number): PerpOrderEntry {
  return {
    orderEntryIndex,
    seatNextOrderEntryIndex: 0,
    seatPreviousOrderEntryIndex: 0,
    seatIndex: 1,
    levelNextOrderEntryIndex: 0,
    levelPreviousOrderEntryIndex: 0,
    levelIndex,
    levelAccountIndex,
    quantityInLots: 1n,
    orderId: BigInt(orderEntryIndex),
    clientId: new Uint8Array(16),
    expirationTime: 1n,
  };
}

const price = (ticks: bigint) => ticks * TICK;

describe('perp state units', () => {
  it('charges one unit per 4 KiB of footprint including the 64 B meta', () => {
    expect(perpAccountStateUnits(perpCbookAccountSize(INITIAL_LEVELS))).toBe(1);
    expect(perpAccountStateUnits(4096 - 64)).toBe(1);
    expect(perpAccountStateUnits(4096 - 63)).toBe(2);
    /* 502 levels still fit the first unit, 503 do not. */
    expect(perpAccountStateUnits(perpCbookAccountSize(502))).toBe(1);
    expect(perpAccountStateUnits(perpCbookAccountSize(503))).toBe(2);
  });

  it('needs nothing for the first order on an empty side or a price inside the range', () => {
    const empty = estimatePerpOrderStateUnits({
      tickSize: TICK,
      bidsCbook: cbook(INITIAL_LEVELS, null),
      asksCbook: cbook(INITIAL_LEVELS, null),
      orders: [{ side: 'sell', price: price(86_750n) }, { side: 'buy', price: price(1n) }],
    });
    expect(empty).toEqual({
      stateUnits: 0,
      bids: { levelsBefore: INITIAL_LEVELS, levelsAfter: INITIAL_LEVELS },
      asks: { levelsBefore: INITIAL_LEVELS, levelsAfter: INITIAL_LEVELS },
      complete: true,
    });

    const inside = estimatePerpOrderStateUnits({
      tickSize: TICK,
      bidsCbook: cbook(INITIAL_LEVELS, null),
      asksCbook: cbook(INITIAL_LEVELS, { side: 'sell', ticks: 86_750n }),
      orders: [{ side: 'sell', price: price(86_755n) }],
    });
    expect(inside.stateUnits).toBe(0);
    expect(inside.asks).toEqual({ levelsBefore: INITIAL_LEVELS, levelsAfter: INITIAL_LEVELS });
  });

  it('grows the side for a bid at half the best bid (the Betanet failure)', () => {
    /* 43 000 ticks behind a 10-level book: 43 001 levels, 344 024 B, 85
       units against the 1 the side had. */
    const estimate = estimatePerpOrderStateUnits({
      tickSize: TICK,
      bidsCbook: cbook(INITIAL_LEVELS, { side: 'buy', ticks: 86_000n }),
      asksCbook: cbook(INITIAL_LEVELS, { side: 'sell', ticks: 86_750n }),
      orders: [{ side: 'buy', price: price(43_000n) }],
    });
    expect(estimate.bids).toEqual({ levelsBefore: INITIAL_LEVELS, levelsAfter: 43_001 });
    expect(estimate.stateUnits).toBe(84);
  });

  it('grows the side for a price far ahead of the best, keeping the resting levels', () => {
    /* 650 ticks better than the best ask: 10 + 650 levels. */
    const estimate = estimatePerpOrderStateUnits({
      tickSize: TICK,
      bidsCbook: cbook(INITIAL_LEVELS, null),
      asksCbook: cbook(INITIAL_LEVELS, { side: 'sell', ticks: 86_750n }),
      orders: [{ side: 'sell', price: price(86_100n) }],
    });
    expect(estimate.asks).toEqual({ levelsBefore: INITIAL_LEVELS, levelsAfter: 660 });
    expect(estimate.stateUnits).toBe(1);
  });

  it('grows to at least twice the level count', () => {
    const after = perpCbookAfterPost({ levelCount: 600, bestPriceInTicks: 1_000n }, 1_600n);
    expect(after).toEqual({ levelCount: 1200, bestPriceInTicks: 1_000n });
    const estimate = estimatePerpOrderStateUnits({
      tickSize: TICK,
      bidsCbook: null,
      asksCbook: cbook(600, { side: 'sell', ticks: 1_000n }),
      orders: [{ side: 'sell', price: price(1_600n) }],
    });
    /* 600 levels (4816 B) is 2 units, 1200 levels (9616 B) is 3. */
    expect(estimate.stateUnits).toBe(1);
  });

  it('applies several orders on one side in transaction order', () => {
    const estimate = estimatePerpOrderStateUnits({
      tickSize: TICK,
      bidsCbook: cbook(INITIAL_LEVELS, null),
      asksCbook: cbook(INITIAL_LEVELS, null),
      /* The first sets the best, the second grows to 1001 levels, the
         third to 2002 (twice 1001 is more than the 1801 it needs). */
      orders: [
        { side: 'buy', price: price(5_000n) },
        { side: 'buy', price: price(4_000n) },
        { side: 'buy', price: price(3_200n) },
      ],
    });
    expect(estimate.bids).toEqual({ levelsBefore: INITIAL_LEVELS, levelsAfter: 2002 });
    expect(estimate.stateUnits).toBe(perpAccountStateUnits(perpCbookAccountSize(2002)) - 1);
  });

  it('ignores orders that never rest', () => {
    const estimate = estimatePerpOrderStateUnits({
      tickSize: TICK,
      bidsCbook: cbook(INITIAL_LEVELS, { side: 'buy', ticks: 86_000n }),
      asksCbook: cbook(INITIAL_LEVELS, null),
      orders: [
        { side: 'buy', orderType: 'ioc', price: price(1n) },
        { side: 'buy', orderType: 'fok', price: price(1n) },
      ],
    });
    expect(estimate.stateUnits).toBe(0);
  });

  it('moves the best when a cancel empties the best level', () => {
    /* Bids at 86 000 (level 0, the best) and 85 100 (level 900) in a
       1000-level book. Cancelling the best moves it to 85 100, so a bid at
       86 200 is 1100 ticks ahead and grows the side to 2100 levels. */
    const bids = cbook(1000, { side: 'buy', ticks: 86_000n });
    const restingOrders = [entry(1, 0, 0), entry(2, 0, 900)];
    const orders = [{ side: 'buy' as const, price: price(86_200n) }];
    const without = estimatePerpOrderStateUnits({ tickSize: TICK, bidsCbook: bids, asksCbook: null, restingOrders, orders });
    expect(without.stateUnits).toBe(0);
    const withCancel = estimatePerpOrderStateUnits({
      tickSize: TICK,
      bidsCbook: bids,
      asksCbook: null,
      restingOrders,
      cancels: [{ orderEntryIndex: 1 }],
      orders,
    });
    expect(withCancel.bids).toEqual({ levelsBefore: 1000, levelsAfter: 2100 });
    expect(withCancel.stateUnits).toBe(perpAccountStateUnits(perpCbookAccountSize(2100)) - perpAccountStateUnits(perpCbookAccountSize(1000)));
    expect(withCancel.stateUnits).toBe(3);

    /* Cancelling every order empties the side: the next order sets the best. */
    const emptied = estimatePerpOrderStateUnits({
      tickSize: TICK,
      bidsCbook: bids,
      asksCbook: null,
      restingOrders,
      cancels: [{ orderEntryIndex: 1 }, { orderEntryIndex: 2 }],
      orders: [{ side: 'buy', price: price(1n) }],
    });
    expect(emptied.stateUnits).toBe(0);
  });

  it('reports an unreadable side as incomplete and refuses prices no cbook can hold', () => {
    const unread = estimatePerpOrderStateUnits({
      tickSize: TICK,
      bidsCbook: null,
      asksCbook: cbook(INITIAL_LEVELS, null),
      orders: [{ side: 'buy', price: price(1n) }],
    });
    expect(unread).toEqual({ stateUnits: 0, bids: null, asks: { levelsBefore: INITIAL_LEVELS, levelsAfter: INITIAL_LEVELS }, complete: false });

    expect(() =>
      estimatePerpOrderStateUnits({
        tickSize: TICK,
        bidsCbook: null,
        asksCbook: cbook(INITIAL_LEVELS, { side: 'sell', ticks: 1n }),
        orders: [{ side: 'sell', price: price(3_000_000n) }],
      }),
    ).toThrow(/more than a cbook can hold/);
  });
});

describe('parsePerpCbookHeader', () => {
  it('reads the header and level count the full parse does, without the levels', () => {
    const levelCount = 43_001;
    const data = new Uint8Array(perpCbookAccountSize(levelCount));
    const view = new DataView(data.buffer);
    view.setUint32(4, 1234, true);
    view.setBigUint64(8, PERP_CBOOK_MAX_PRICE_IN_TICKS - 86_000n, true);
    const full = parsePerpCbookAccount(data);
    expect(parsePerpCbookHeader(data)).toEqual({
      bestLevelIndex: full.bestLevelIndex,
      bestPriceInTicks: full.bestPriceInTicks,
      levelCount: full.levels.length,
    });
    expect(parsePerpCbookHeader(data)).toEqual({ bestLevelIndex: 1234, bestPriceInTicks: PERP_CBOOK_MAX_PRICE_IN_TICKS - 86_000n, levelCount });
  });

  it('rejects a size that is not a whole number of levels', () => {
    expect(() => parsePerpCbookHeader(new Uint8Array(perpCbookAccountSize(10) + 3))).toThrow(/malformed/);
    expect(() => parsePerpCbookHeader(new Uint8Array(8))).toThrow(/malformed/);
  });
});
