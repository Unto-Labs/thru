import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Pubkey, deriveAddress, deriveProgramAddress } from '@thru/sdk';
import type { Thru } from '@thru/sdk/client';
import { BOOTSTRAP_PROGRAM_ADDRESSES } from '../bootstrap-addresses';
import type { OracleFeed } from '../oracle/types';
import {
  PERP_BPS_DENOMINATOR,
  PERP_DEFAULT_MARKET_RECORD_INDEX,
  PERP_EVENT_LIQUIDATION,
  PERP_INSTRUCTION_LIQUIDATE,
  PERP_INSTRUCTION_MARKET_CREATE,
  PERP_INSTRUCTION_MARKET_RECORD,
  PERP_INSTRUCTION_MARKET_SET_ORACLE,
  PERP_MARKET_ACCOUNT_SIZE,
  PERP_MARKET_MAGIC,
  PERP_NULL_ACCOUNT_INDEX,
  PERP_ORDER_ARENA_ENTRIES_OFFSET,
  PERP_ORDER_ENTRY_SIZE,
  PERP_PROGRAM_ADDRESS,
  PERP_SEAT_ARENA_ENTRIES_OFFSET,
  PERP_SEAT_ENTRY_SIZE,
  PERP_SEAT_MANAGER_RESERVED_SIZE,
  createPerpLiquidateInstruction,
  createPerpMarketCreateInstruction,
  createPerpMarketRecordInstruction,
  createPerpMarketSetOracleInstruction,
  derivePerpMarketAccounts,
  parsePerpEvent,
  parsePerpMarketAccount,
  parsePerpOrderArenaAccount,
  parsePerpSeatArenaAccount,
  perpAverageEntryPrice,
  perpBankruptcyPrice,
  perpCanPostOrder,
  perpEquity,
  perpFreeCollateral,
  perpInitialMargin,
  perpIsLiquidatable,
  perpLeverageBps,
  perpLiquidationPreview,
  perpLiquidationPrice,
  perpMaintenanceMargin,
  perpMarkFraction,
  perpMarkFromFeed,
  perpMarkPrice,
  perpMarketAccountAddresses,
  perpMarketReadOnlyAddresses,
  perpMaxBuyLots,
  perpMaxLeverage,
  perpMaxSellLots,
  perpNotional,
  perpOrderInitialMargin,
  perpCeilBps,
  perpSeatOrders,
  perpSideMarginNotional,
  perpUnrealizedPnl,
  type PerpMarginSeat,
  type PerpMarket,
  type PerpSeatEntry,
} from './index';

/* Fixtures ******************************************************************/

const thru = { helpers: { deriveAddress, deriveProgramAddress } } as unknown as Thru;

function key(id: number): Uint8Array {
  const bytes = new Uint8Array(32);
  bytes[0] = id;
  bytes[31] = 0xa0 + id;
  return bytes;
}

function address(id: number): string {
  return Pubkey.from(key(id)).toThruFmt();
}

function context(indexes: Array<[Uint8Array, number]>) {
  return {
    getAccountIndex(pubkey: Uint8Array): number {
      for (const [candidate, index] of indexes) {
        if (candidate.length === pubkey.length && candidate.every((byte, i) => byte === pubkey[i])) return index;
      }
      throw new Error('missing account');
    },
  };
}

/** Writes the 320 byte market_t at its documented offsets. */

function marketBytes(): Uint8Array {
  const data = new Uint8Array(PERP_MARKET_ACCOUNT_SIZE);
  const view = new DataView(data.buffer);
  data[0] = PERP_MARKET_MAGIC;
  data[1] = 0x02; /* status_flags: post only */
  data[2] = 0x01; /* exchange_status_flags: paused */
  view.setBigUint64(8, 1n, true); /* lot_size */
  view.setBigUint64(16, 1_000n, true); /* tick_size */
  view.setBigUint64(24, 77n, true); /* next_order_id */
  view.setBigUint64(32, 200_000_000n, true); /* price_cap */
  view.setBigUint64(40, 1_000_000n, true); /* max_position_lots */
  view.setBigUint64(48, 10n, true); /* open_interest_lots */
  view.setBigUint64(56, 123n, true); /* bad_debt */
  data.set(key(1), 64); /* order_entry_pubkey */
  data.set(key(2), 96); /* bids_cbook_pubkey */
  data.set(key(3), 128); /* asks_cbook_pubkey */
  data.set(key(4), 160); /* quote_vault_pubkey */
  data.set(key(5), 192); /* market_authority_pubkey */
  data.set(key(6), 224); /* oracle_feed_pubkey */
  view.setBigUint64(256, 100_000n, true); /* mark_num */
  view.setBigUint64(264, 1n, true); /* mark_den */
  view.setUint32(272, 250, true); /* initial_margin_bps */
  view.setUint32(276, 125, true); /* maintenance_margin_bps */
  view.setUint32(280, 100, true); /* liquidation_fee_bps */
  view.setInt32(284, -8, true); /* oracle_exponent */
  view.setBigUint64(288, 60_000_000_000n, true); /* max_mark_age_ns */
  return data;
}

/** Writes a seat_entry_t at its documented offsets. */
function seatBytes(seat: {
  authority: Uint8Array;
  quantityQuote: bigint;
  longLots: bigint;
  shortLots: bigint;
  openBidLots: bigint;
  openAskLots: bigint;
  headOrderEntryIndex: number;
  entryNotional: bigint;
  openBidNotional: bigint;
  openAskNotional: bigint;
  active: boolean;
}): Uint8Array {
  const data = new Uint8Array(PERP_SEAT_ENTRY_SIZE);
  const view = new DataView(data.buffer);
  data.set(seat.authority, 0);
  view.setBigUint64(32, seat.quantityQuote, true);
  view.setBigUint64(40, seat.longLots, true);
  view.setBigUint64(48, seat.shortLots, true);
  view.setBigUint64(56, seat.openBidLots, true);
  view.setBigUint64(64, seat.openAskLots, true);
  view.setUint32(72, seat.headOrderEntryIndex, true);
  view.setBigUint64(80, seat.entryNotional, true);
  view.setBigUint64(88, seat.openBidNotional, true);
  view.setBigUint64(96, seat.openAskNotional, true);
  view.setBigUint64(120, seat.active ? 1n : 0n, true); /* non_nullable_reserved */
  return data;
}

function seatArenaBytes(seats: Uint8Array[]): Uint8Array {
  const data = new Uint8Array(PERP_SEAT_ARENA_ENTRIES_OFFSET + seats.length * PERP_SEAT_ENTRY_SIZE);
  data.set(marketBytes(), 0);
  const view = new DataView(data.buffer);
  /* Arena header entry at SEATS_MANAGER_RESERVED_SIZE: reserved0[116], next_entry_idx u32, free_magic u64 */
  view.setUint32(PERP_SEAT_MANAGER_RESERVED_SIZE + 116, seats.length + 1, true);
  view.setBigUint64(PERP_SEAT_MANAGER_RESERVED_SIZE + 120, 0n, true);
  seats.forEach((seat, index) => data.set(seat, PERP_SEAT_ARENA_ENTRIES_OFFSET + index * PERP_SEAT_ENTRY_SIZE));
  return data;
}

/** Writes an order_entry_t at its documented offsets; expiry 0 = free slot. */
function orderBytes(order: {
  seatNext: number;
  seatPrev: number;
  seatIndex: number;
  levelIndex: number;
  levelAccountIndex: number;
  quantityInLots: bigint;
  orderId: bigint;
  expiry: bigint;
}): Uint8Array {
  const data = new Uint8Array(PERP_ORDER_ENTRY_SIZE);
  const view = new DataView(data.buffer);
  const seatPtrs = BigInt(order.seatNext) | (BigInt(order.seatPrev) << 20n) | (BigInt(order.seatIndex) << 40n);
  const levelPtrs = (BigInt(order.levelIndex) << 40n) | (BigInt(order.levelAccountIndex) << 60n);
  view.setBigUint64(0, seatPtrs, true);
  view.setBigUint64(8, levelPtrs, true);
  view.setBigUint64(16, order.quantityInLots, true);
  view.setBigUint64(24, order.orderId, true);
  data.fill(order.orderId === 0n ? 0 : Number(order.orderId & 0xffn), 40, 56); /* client_id */
  view.setBigInt64(56, order.expiry, true);
  return data;
}

function orderArenaBytes(orders: Uint8Array[]): Uint8Array {
  const data = new Uint8Array(PERP_ORDER_ARENA_ENTRIES_OFFSET + orders.length * PERP_ORDER_ENTRY_SIZE);
  const view = new DataView(data.buffer);
  /* 8 reserved bytes, then the header: reserved0[52], next_entry_idx u32, free_magic u64 */
  view.setUint32(8 + 52, orders.length + 1, true);
  view.setBigUint64(8 + 56, 0n, true);
  orders.forEach((order, index) => data.set(order, PERP_ORDER_ARENA_ENTRIES_OFFSET + index * PERP_ORDER_ENTRY_SIZE));
  return data;
}

const FREE_ORDER = orderBytes({ seatNext: 0, seatPrev: 0, seatIndex: 0, levelIndex: 0, levelAccountIndex: 0, quantityInLots: 0n, orderId: 0n, expiry: 0n });

/* Worked example: 20x market (IM 500 bps, MM 250 bps), long 10 lots bought
   at 85,000,000 atoms with 50,000,000 atoms of collateral. */
const MARKET: PerpMarket = {
  magic: PERP_MARKET_MAGIC,
  statusFlags: 0,
  exchangeStatusFlags: 0,
  lotSize: 1n,
  tickSize: 1_000n,
  nextOrderId: 1n,
  priceCap: 200_000_000n,
  maxPositionLots: 1_000_000n,
  openInterestLots: 10n,
  badDebt: 0n,
  orderArena: address(1),
  bidsCbook: address(2),
  asksCbook: address(3),
  quoteVault: address(4),
  marketAuthority: address(5),
  oracleFeed: address(6),
  markNum: 1_000n,
  markDen: 1n,
  initialMarginBps: 500,
  maintenanceMarginBps: 250,
  liquidationFeeBps: 100,
  oracleExponent: -8,
  maxMarkAgeNs: 0n,
};

const ENTRY = 85_000_000n;
const LOTS = 10n;
const COLLATERAL = 50_000_000n;

function seat(overrides: Partial<PerpMarginSeat> = {}): PerpMarginSeat {
  return {
    quantityQuote: COLLATERAL,
    longLots: LOTS,
    shortLots: 0n,
    openBidLots: 0n,
    openAskLots: 0n,
    entryNotional: LOTS * ENTRY,
    openBidNotional: 0n,
    openAskNotional: 0n,
    ...overrides,
  };
}

const shortSeat = (overrides: Partial<PerpMarginSeat> = {}) => seat({ longLots: 0n, shortLots: LOTS, ...overrides });

const ceilBps = (amount: bigint, bps: bigint) => (amount * bps + PERP_BPS_DENOMINATOR - 1n) / PERP_BPS_DENOMINATOR;
const minLots = (a: bigint, b: bigint) => (a < b ? a : b);

/* Tests *********************************************************************/

describe('perp account parsers', () => {
  it('parses the 320 byte market account', () => {
    const market = parsePerpMarketAccount(marketBytes());
    expect(market).toEqual<PerpMarket>({
      magic: PERP_MARKET_MAGIC,
      statusFlags: 2,
      exchangeStatusFlags: 1,
      lotSize: 1n,
      tickSize: 1_000n,
      nextOrderId: 77n,
      priceCap: 200_000_000n,
      maxPositionLots: 1_000_000n,
      openInterestLots: 10n,
      badDebt: 123n,
      orderArena: address(1),
      bidsCbook: address(2),
      asksCbook: address(3),
      quoteVault: address(4),
      marketAuthority: address(5),
      oracleFeed: address(6),
      markNum: 100_000n,
      markDen: 1n,
      initialMarginBps: 250,
      maintenanceMarginBps: 125,
      liquidationFeeBps: 100,
      oracleExponent: -8,
      maxMarkAgeNs: 60_000_000_000n,
    });
  });

  it('rejects a short (224 byte) market', () => {
    expect(() => parsePerpMarketAccount(marketBytes().subarray(0, 224))).toThrow(/320 bytes/);
    expect(() => parsePerpMarketAccount(new Uint8Array(320))).toThrow(/not a perp market/);
  });

  it('rejects a header whose margin fields are not a margined market', () => {
    const withHeader = (patch: (view: DataView) => void) => {
      const data = marketBytes();
      patch(new DataView(data.buffer));
      return data;
    };
    expect(() => parsePerpMarketAccount(withHeader((view) => view.setUint32(272, 0, true)))).toThrow(/initialMarginBps 0/);
    expect(() => parsePerpMarketAccount(withHeader((view) => view.setUint32(272, 10_001, true)))).toThrow(/initialMarginBps 10001/);
    expect(() => parsePerpMarketAccount(withHeader((view) => view.setUint32(276, 250, true)))).toThrow(/maintenanceMarginBps 250 is not in 1\.\.249/);
    expect(() => parsePerpMarketAccount(withHeader((view) => view.setUint32(276, 0, true)))).toThrow(/maintenanceMarginBps 0/);
    expect(() => parsePerpMarketAccount(withHeader((view) => view.setUint32(280, 10_001, true)))).toThrow(/liquidationFeeBps 10001/);
    expect(() => parsePerpMarketAccount(withHeader((view) => view.setBigUint64(256, 0n, true)))).toThrow(/markNum 0/);
    expect(() => parsePerpMarketAccount(withHeader((view) => view.setBigUint64(264, 0n, true)))).toThrow(/markDen 0/);
    /* the boundary values pass */
    expect(parsePerpMarketAccount(withHeader((view) => {
      view.setUint32(272, 10_000, true);
      view.setUint32(276, 9_999, true);
      view.setUint32(280, 10_000, true);
    })).initialMarginBps).toBe(10_000);
    /* an arena with the market magic but a header without margin fields is rejected too */
    const legacy = seatArenaBytes([]);
    legacy.fill(0, 256, PERP_MARKET_ACCOUNT_SIZE);
    expect(() => parsePerpSeatArenaAccount(legacy)).toThrow(/not a margined market/);
    expect(() => parsePerpMarketAccount(legacy)).toThrow(/not a margined market/);
  });


  it('parses seats starting at byte 640 of the arena with the notional fields', () => {
    expect(PERP_SEAT_MANAGER_RESERVED_SIZE).toBe(512);
    expect(PERP_SEAT_ARENA_ENTRIES_OFFSET).toBe(640);
    const arena = parsePerpSeatArenaAccount(
      seatArenaBytes([
        seatBytes({
          authority: key(10),
          quantityQuote: 50_000_000n,
          longLots: 10n,
          shortLots: 0n,
          openBidLots: 2n,
          openAskLots: 3n,
          headOrderEntryIndex: 7,
          entryNotional: 850_000_000n,
          openBidNotional: 168_000_000n,
          openAskNotional: 258_000_000n,
          active: true,
        }),
        seatBytes({
          authority: key(11),
          quantityQuote: 0n,
          longLots: 0n,
          shortLots: 0n,
          openBidLots: 0n,
          openAskLots: 0n,
          headOrderEntryIndex: 0,
          entryNotional: 0n,
          openBidNotional: 0n,
          openAskNotional: 0n,
          active: false,
        }),
      ]),
    );
    expect(arena.market.oracleFeed).toBe(address(6));
    expect(arena.header.nextEntryIndex).toBe(3);
    /* slots is sparse: the free seat is a hole, not a decoded entry */
    expect(arena.slots.length).toBe(2);
    expect(0 in arena.slots).toBe(true);
    expect(1 in arena.slots).toBe(false);
    expect(arena.slots[0]).toEqual({ index: 1, active: true, entry: arena.seats[0] });
    expect(arena.slots[1]).toBeUndefined();
    expect(arena.slots.map((slot) => slot?.index)).toEqual([1, undefined]);
    expect(arena.seats).toEqual<PerpSeatEntry[]>([
      {
        seatIndex: 1,
        seatAuthority: address(10),
        quantityQuote: 50_000_000n,
        longLots: 10n,
        shortLots: 0n,
        openBidLots: 2n,
        openAskLots: 3n,
        headOrderEntryIndex: 7,
        entryNotional: 850_000_000n,
        openBidNotional: 168_000_000n,
        openAskNotional: 258_000_000n,
      },
    ]);
  });

  it('decodes active order slots only and keeps arena indexes for the seat list walk', () => {
    expect(PERP_ORDER_ARENA_ENTRIES_OFFSET).toBe(72);
    const arena = parsePerpOrderArenaAccount(
      orderArenaBytes([
        FREE_ORDER, /* slot 1 */
        orderBytes({ seatNext: 4, seatPrev: 0, seatIndex: 1, levelIndex: 3, levelAccountIndex: 0, quantityInLots: 5n, orderId: 11n, expiry: 9_000n }), /* slot 2 */
        FREE_ORDER, /* slot 3 */
        orderBytes({ seatNext: 0, seatPrev: 2, seatIndex: 1, levelIndex: 7, levelAccountIndex: 1, quantityInLots: 6n, orderId: 12n, expiry: 9_000n }), /* slot 4 */
        orderBytes({ seatNext: 0, seatPrev: 0, seatIndex: 2, levelIndex: 1, levelAccountIndex: 0, quantityInLots: 7n, orderId: 13n, expiry: -1n }), /* slot 5 */
      ]),
    );
    expect(arena.header.nextEntryIndex).toBe(6);
    expect(arena.slots.length).toBe(5);
    expect([0, 1, 2, 3, 4].map((idx) => idx in arena.slots)).toEqual([false, true, false, true, true]);
    expect(arena.orders.map((order) => order.orderEntryIndex)).toEqual([2, 4, 5]);
    expect(arena.orders[0]).toMatchObject({
      orderEntryIndex: 2,
      seatNextOrderEntryIndex: 4,
      seatPreviousOrderEntryIndex: 0,
      seatIndex: 1,
      levelIndex: 3,
      levelAccountIndex: 0,
      quantityInLots: 5n,
      orderId: 11n,
      expirationTime: 9_000n,
    });
    expect(arena.orders[1].clientId).toEqual(new Uint8Array(16).fill(12));
    expect(arena.orders[2].expirationTime).toBe(-1n);
    expect(arena.slots[3]!.entry).toBe(arena.orders[1]);
    const seat = { headOrderEntryIndex: 2 } as PerpSeatEntry;
    expect(perpSeatOrders(seat, arena).map((order) => order.orderEntryIndex)).toEqual([2, 4]);
    expect(perpSeatOrders({ headOrderEntryIndex: 5 } as PerpSeatEntry, arena).map((order) => order.orderId)).toEqual([13n]);
    /* a head pointing at a free slot or past the arena yields nothing */
    expect(perpSeatOrders({ headOrderEntryIndex: 3 } as PerpSeatEntry, arena)).toEqual([]);
    expect(perpSeatOrders({ headOrderEntryIndex: 9 } as PerpSeatEntry, arena)).toEqual([]);
    expect(perpSeatOrders({ headOrderEntryIndex: 0 } as PerpSeatEntry, arena)).toEqual([]);
  });
});


describe('perp margin math', () => {
  it('computes the mark from the feed price', () => {
    expect(perpMarkPrice(8_500_000_000_000n, { priceCap: 200_000_000n, markNum: 1n, markDen: 100_000n })).toBe(85_000_000n);
    expect(perpMarkPrice(85_000n, { priceCap: 200_000_000n, markNum: 1_000n, markDen: 1n })).toBe(85_000_000n);
    /* clamped to the cap */
    expect(perpMarkPrice(300_000n, { priceCap: 200_000_000n, markNum: 1_000n, markDen: 1n })).toBe(200_000_000n);
    expect(() => perpMarkPrice(1n, { priceCap: 200_000_000n, markNum: 1n, markDen: 1_000n })).toThrow(/zero/);
    expect(() => perpMarkPrice(1n, { priceCap: 200_000_000n, markNum: 0n, markDen: 1n })).toThrow(/markNum/);
    expect(() => perpMarkPrice(1n, { priceCap: 200_000_000n, markNum: 1n, markDen: 0n })).toThrow(/markDen/);
  });

  it('takes the mark from a price feed with the market exponent only', () => {
    const common = { maxStalenessNs: 0n, lastUpdateNs: 0n, adminAddress: address(1), reporterAddress: address(2), feedName: 'BTC/USD' };
    const feed: OracleFeed = { kind: 'price', common, price: 85_000n, maxVarianceBps: 0, exponent: -8 };
    expect(perpMarkFromFeed(feed, MARKET)).toBe(85_000_000n);
    expect(() => perpMarkFromFeed({ ...feed, exponent: -6 }, MARKET)).toThrow(/"BTC\/USD" exponent -6 differs from the market's -8/);
    expect(() => perpMarkFromFeed({ kind: 'boolean', common, value: true }, MARKET)).toThrow(/boolean feed, not a price feed/);
    expect(() => perpMarkFromFeed({ ...feed, price: 0n }, MARKET)).toThrow(/zero/);
  });

  it('mark fraction is 10^(quoteDecimals - baseDecimals + exponent) as an integer fraction', () => {
    /* USDC (6) / BTC lots of 0.001 (3) with a -8 feed: 10^-5 */
    expect(perpMarkFraction(6, 3, -8)).toEqual({ markNum: 1n, markDen: 100_000n });
    expect(perpMarkFraction(9, 3, -6)).toEqual({ markNum: 1n, markDen: 1n });
    expect(perpMarkFraction(9, 0, -6)).toEqual({ markNum: 1_000n, markDen: 1n });
    expect(perpMarkFraction(6, 3, 0)).toEqual({ markNum: 1_000n, markDen: 1n });
    /* round trip against the program's mark: 85,000 * 10^-8 USD/coin in atoms */
    const fraction = perpMarkFraction(6, 3, -8);
    expect(perpMarkPrice(8_500_000_000_000n, { ...fraction, priceCap: 10n ** 12n })).toBe(85_000_000n);
    expect(() => perpMarkFraction(6.5, 3, -8)).toThrow(/quoteDecimals/);
  });

  it('max leverage is floor(10000 / initialMarginBps)', () => {
    expect(perpMaxLeverage(500)).toBe(20);
    expect(perpMaxLeverage(250)).toBe(40);
    expect(perpMaxLeverage(300)).toBe(33);
    expect(perpMaxLeverage(10_000)).toBe(1);
    expect(perpMaxLeverage(1)).toBe(10_000);
    expect(() => perpMaxLeverage(0)).toThrow(/initialMarginBps/);
    expect(() => perpMaxLeverage(10_001)).toThrow(/initialMarginBps/);
  });

  it('lists the market accounts a transaction carries', () => {
    expect(PERP_DEFAULT_MARKET_RECORD_INDEX).toBe(1);
    const market = { seatArena: 's', orderArena: 'o', bidsCbook: 'b', asksCbook: 'a', quoteVault: 'q' };
    expect(perpMarketAccountAddresses(market)).toEqual(['s', 'o', 'b', 'a']);
    expect(perpMarketReadOnlyAddresses({ exchangeMeta: 'e', oracleFeed: 'f' })).toEqual(['e', 'f']);
    const bytes = { seatArena: key(1), orderArena: key(2), bidsCbook: key(3), asksCbook: key(4) };
    expect(perpMarketAccountAddresses(bytes)).toEqual([key(1), key(2), key(3), key(4)]);
  });

  it('long 10 lots at 85,000,000 with 50,000,000 collateral at the entry mark', () => {

    const mark = ENTRY;
    const s = seat();
    expect(perpNotional(MARKET, LOTS, mark)).toBe(850_000_000n);
    expect(perpUnrealizedPnl(MARKET, s, mark)).toBe(0n);
    expect(perpEquity(MARKET, s, mark)).toBe(50_000_000n);
    expect(perpInitialMargin(MARKET, s, mark)).toBe(42_500_000n); /* 5% of 850,000,000 */
    expect(perpMaintenanceMargin(MARKET, s, mark)).toBe(21_250_000n); /* 2.5% */
    expect(perpFreeCollateral(MARKET, s, mark)).toBe(7_500_000n);
    expect(perpLeverageBps(MARKET, s, mark)).toBe(170_000n); /* 17x */
    expect(perpAverageEntryPrice(MARKET, s)).toBe(ENTRY);
    expect(perpIsLiquidatable(MARKET, s, mark)).toBe(false);
    /* free 7.5M buys one more lot (4.25M initial margin each); selling can
       close all 10 plus open one */
    expect(perpMaxBuyLots(MARKET, s, mark, mark)).toBe(1n);
    expect(perpMaxSellLots(MARKET, s, mark, mark)).toBe(11n);
    expect(perpCanPostOrder(MARKET, s, 'buy', 1n, mark, mark)).toBe(true);
    expect(perpCanPostOrder(MARKET, s, 'buy', 2n, mark, mark)).toBe(false);
  });

  it('mark moves: equity, free and liquidation', () => {
    const s = seat();
    /* up 1,000,000: +10,000,000 pnl */
    expect(perpUnrealizedPnl(MARKET, s, 86_000_000n)).toBe(10_000_000n);
    expect(perpEquity(MARKET, s, 86_000_000n)).toBe(60_000_000n);
    expect(perpFreeCollateral(MARKET, s, 86_000_000n)).toBe(60_000_000n - 43_000_000n);
    /* down 1,000,000: -10,000,000 pnl, free negative but not liquidatable */
    expect(perpEquity(MARKET, s, 84_000_000n)).toBe(40_000_000n);
    expect(perpFreeCollateral(MARKET, s, 84_000_000n)).toBe(40_000_000n - 42_000_000n);
    expect(perpMaxBuyLots(MARKET, s, 84_000_000n, 84_000_000n)).toBe(0n);
    expect(perpMaxSellLots(MARKET, s, 84_000_000n, 84_000_000n)).toBe(10n);
    expect(perpIsLiquidatable(MARKET, s, 84_000_000n)).toBe(false);
    /* resting orders that grow the position consume free through their notional */
    const withOrders = seat({ openBidLots: 1n, openBidNotional: 84_000_000n });
    expect(perpInitialMargin(MARKET, withOrders, ENTRY)).toBe(42_500_000n + 4_200_000n);
    expect(perpFreeCollateral(MARKET, withOrders, ENTRY)).toBe(3_300_000n);
  });

  it('nets resting orders against the position they would reduce', () => {
    expect(perpSideMarginNotional(0n, 0n, 0n)).toBe(0n);
    expect(perpSideMarginNotional(10n, 850_000_000n, 10n)).toBe(0n);
    expect(perpSideMarginNotional(10n, 850_000_000n, 12n)).toBe(0n);
    expect(perpSideMarginNotional(10n, 850_000_000n, 0n)).toBe(850_000_000n);
    expect(perpSideMarginNotional(12n, 267_720n, 10n)).toBe(44_620n); /* ceil(267720 * 2 / 12) */
    /* a long of 10 lots with free exactly 0 can still post a 10-lot close */
    const tight = seat({ quantityQuote: 42_500_000n }); /* equity 42.5M = im_position at the entry mark */
    expect(perpFreeCollateral(MARKET, tight, ENTRY)).toBe(0n);
    expect(perpCanPostOrder(MARKET, tight, 'sell', 10n, ENTRY, ENTRY)).toBe(true);
    expect(perpCanPostOrder(MARKET, tight, 'sell', 11n, ENTRY, ENTRY)).toBe(false);
    expect(perpCanPostOrder(MARKET, tight, 'buy', 1n, ENTRY, ENTRY)).toBe(false);
    const closing = seat({ quantityQuote: 42_500_000n, openAskLots: 10n, openAskNotional: 850_000_000n });
    expect(perpOrderInitialMargin(MARKET, closing)).toBe(0n);
    expect(perpFreeCollateral(MARKET, closing, ENTRY)).toBe(0n);
    /* an 11-lot close charges margin on the one excess lot only: ceil(935M * 1 / 11) = 85M -> 5% = 4.25M */
    const over = seat({ openAskLots: 11n, openAskNotional: 11n * ENTRY });
    expect(perpOrderInitialMargin(MARKET, over)).toBe(4_250_000n);
    expect(perpFreeCollateral(MARKET, over, ENTRY)).toBe(7_500_000n - 4_250_000n);
    expect(perpMaxSellLots(MARKET, seat(), ENTRY, ENTRY)).toBe(11n);
    /* pro rata across two ask prices: 6 @ 110 + 6 @ 120 on a 10-lot long,
       margined notional = ceil(267720 * 2 / 12) = 44620 */
    const pro = seat({ longLots: 10n, entryNotional: 10n * 100n * 100n, openAskLots: 12n, openAskNotional: 267_720n });
    expect(perpSideMarginNotional(pro.openAskLots, pro.openAskNotional, minLots(pro.openAskLots, pro.longLots))).toBe(44_620n);
    expect(perpOrderInitialMargin(MARKET, pro)).toBe(ceilBps(44_620n, 500n));
    /* bids net against a short the same way */
    const shortWithBids = shortSeat({ openBidLots: 4n, openBidNotional: 4n * ENTRY });
    expect(perpOrderInitialMargin(MARKET, shortWithBids)).toBe(0n);
    const shortOverBids = shortSeat({ openBidLots: 12n, openBidNotional: 12n * ENTRY });
    expect(perpOrderInitialMargin(MARKET, shortOverBids)).toBe(perpCeilBps(2n * ENTRY, 500));
  });

  it('liquidation price is the highest mark at which a long is liquidatable', () => {
    const s = seat();
    /* m* = 10000 * (850,000,000 - 50,000,000) / (10 * 9750) = 82,051,282.05 */
    const price = perpLiquidationPrice(MARKET, s);
    expect(price).toBe(82_051_282n);
    expect(perpIsLiquidatable(MARKET, s, price!)).toBe(true);
    expect(perpIsLiquidatable(MARKET, s, price! + 1n)).toBe(false);
    expect(perpEquity(MARKET, s, price!)).toBe(20_512_820n);
    expect(perpMaintenanceMargin(MARKET, s, price!)).toBe(20_512_821n);
    /* bankruptcy: ceil((850,000,000 - 50,000,000) / 10) */
    expect(perpBankruptcyPrice(MARKET, s)).toBe(80_000_000n);
    expect(perpEquity(MARKET, s, 80_000_000n)).toBe(0n);
    /* a fully collateralized long cannot be liquidated by a price move */
    expect(perpLiquidationPrice(MARKET, seat({ quantityQuote: 850_000_000n }))).toBeNull();
    expect(perpBankruptcyPrice(MARKET, seat({ quantityQuote: 850_000_000n }))).toBe(0n);
  });

  it('liquidation price is the lowest mark at which a short is liquidatable', () => {
    const s = shortSeat();
    /* m* = 10000 * (850,000,000 + 50,000,000) / (10 * 10250) = 87,804,878.04 */
    const price = perpLiquidationPrice(MARKET, s);
    expect(price).toBe(87_804_879n);
    expect(perpIsLiquidatable(MARKET, s, price!)).toBe(true);
    expect(perpIsLiquidatable(MARKET, s, price! - 1n)).toBe(false);
    expect(perpUnrealizedPnl(MARKET, s, 84_000_000n)).toBe(10_000_000n);
    /* bankruptcy: floor((850,000,000 + 50,000,000) / 10) */
    expect(perpBankruptcyPrice(MARKET, s)).toBe(90_000_000n);
    expect(perpEquity(MARKET, s, 90_000_000n)).toBe(0n);
    /* threshold above the cap: the clamped mark can never liquidate it */
    expect(perpLiquidationPrice({ ...MARKET, priceCap: 87_000_000n }, s)).toBeNull();
    expect(perpBankruptcyPrice({ ...MARKET, priceCap: 87_000_000n }, s)).toBe(87_000_000n);
    expect(perpMaxBuyLots(MARKET, s, ENTRY, ENTRY)).toBe(11n);
    expect(perpMaxSellLots(MARKET, s, ENTRY, ENTRY)).toBe(1n);
  });

  it('flat seats have no position derived values', () => {
    const flat = seat({ longLots: 0n, entryNotional: 0n });
    expect(perpUnrealizedPnl(MARKET, flat, ENTRY)).toBe(0n);
    expect(perpLiquidationPrice(MARKET, flat)).toBeNull();
    expect(perpBankruptcyPrice(MARKET, flat)).toBeNull();
    expect(perpLeverageBps(MARKET, flat, ENTRY)).toBeNull();
    expect(perpAverageEntryPrice(MARKET, flat)).toBeNull();
    expect(perpIsLiquidatable(MARKET, flat, 1n)).toBe(false);
    expect(perpLiquidationPreview(MARKET, flat, ENTRY)).toBeNull();
    /* the whole collateral buys 50,000,000 / ceil(85,000,000 * 0.05) = 11 lots */
    expect(perpMaxBuyLots(MARKET, flat, ENTRY, ENTRY)).toBe(11n);
    expect(perpMaxSellLots(MARKET, flat, ENTRY, ENTRY)).toBe(11n);
    /* the position limit binds first when free is plentiful */
    expect(perpMaxBuyLots({ ...MARKET, maxPositionLots: 5n }, flat, ENTRY, ENTRY)).toBe(5n);
  });

  it('previews a liquidation at the mark clamped to bankruptcy', () => {
    const s = seat();
    /* mark below bankruptcy: transfer at the bankruptcy price, target keeps nothing */
    const gap = perpLiquidationPreview(MARKET, s, 79_000_000n)!;
    expect(gap).toEqual({ side: 'long', lots: LOTS, price: 80_000_000n, fee: 0n, targetQuoteAfter: 0n });
    /* mark between liquidation and bankruptcy: fee 1% of notional capped by what is left */
    const mark = 81_000_000n;
    const preview = perpLiquidationPreview(MARKET, s, mark)!;
    expect(preview.price).toBe(mark);
    const quoteAfterClose = COLLATERAL + perpUnrealizedPnl(MARKET, s, mark); /* 10,000,000 */
    expect(quoteAfterClose).toBe(10_000_000n);
    expect(preview.fee).toBe((850_000_000n - 40_000_000n) / 100n); /* 8,100,000 */
    expect(preview.targetQuoteAfter).toBe(quoteAfterClose - preview.fee);
    /* ceil_bps matches the reference helper for the margin figures */
    expect(perpInitialMargin(MARKET, s, mark)).toBe(ceilBps(810_000_000n, 500n));
  });
});

describe('perp instruction builders', () => {
  const seatArena = key(21);
  const orderArena = key(22);
  const bids = key(23);
  const asks = key(24);
  const exchangeMeta = key(25);
  const authority = key(26);
  const oracle = key(27);
  const ctx = context([
    [seatArena, 1],
    [orderArena, 2],
    [bids, 3],
    [asks, 4],
    [exchangeMeta, 5],
    [authority, 6],
    [oracle, 7],
  ]);

  it('market record carries the oracle feed index at offset 24 (0xffff when absent)', async () => {
    const base = {
      marketRecordIndex: 1,
      seatArenaAccountBytes: seatArena,
      orderArenaAccountBytes: orderArena,
      bidsCbookAccountBytes: bids,
      asksCbookAccountBytes: asks,
      seatAuthorityAccountBytes: authority,
      seatIndex: 3,
      exchangeMetaAccountBytes: exchangeMeta,
    };
    const withOracle = await createPerpMarketRecordInstruction({ ...base, oracleFeedAccountBytes: oracle })(ctx);
    expect(withOracle.length).toBe(32);
    expect(withOracle[0]).toBe(PERP_INSTRUCTION_MARKET_RECORD);
    expect(withOracle[1]).toBe(1);
    const view = new DataView(withOracle.buffer, withOracle.byteOffset);
    expect(view.getUint16(2, true)).toBe(1);
    expect(view.getUint32(12, true)).toBe(3);
    expect(view.getUint16(24, true)).toBe(7);
    expect([...withOracle.subarray(26)]).toEqual([0, 0, 0, 0, 0, 0]);
    const without = await createPerpMarketRecordInstruction(base)(ctx);
    expect(new DataView(without.buffer, without.byteOffset).getUint16(24, true)).toBe(PERP_NULL_ACCOUNT_INDEX);
  });

  it('liquidate is 8 bytes with the target seat at offset 4', async () => {
    const bytes = await createPerpLiquidateInstruction({ marketRecordIndex: 1, targetSeatIndex: 42 })(ctx);
    expect([...bytes]).toEqual([PERP_INSTRUCTION_LIQUIDATE, 1, 0, 0, 42, 0, 0, 0]);
    await expect(createPerpLiquidateInstruction({ marketRecordIndex: 1, targetSeatIndex: 0 })(ctx)).rejects.toThrow(/targetSeatIndex/);
  });

  it('market set oracle is 40 bytes', async () => {
    const args = {
      marketRecordIndex: 1,
      oracleFeedAccountBytes: oracle,
      oracleExponent: -8,
      markNum: 1n,
      markDen: 100_000n,
      maxMarkAgeNs: 5n,
    };
    await expect(createPerpMarketSetOracleInstruction({ ...args, markNum: 0n })(ctx)).rejects.toThrow(/markNum/);
    const bytes = await createPerpMarketSetOracleInstruction(args)(ctx);
    expect(bytes.length).toBe(40);
    expect(bytes[0]).toBe(PERP_INSTRUCTION_MARKET_SET_ORACLE);
    expect(bytes[1]).toBe(1);
    const view = new DataView(bytes.buffer, bytes.byteOffset);
    expect(view.getUint16(2, true)).toBe(7);
    expect(view.getInt32(4, true)).toBe(-8);
    expect(view.getBigUint64(8, true)).toBe(1n);
    expect(view.getBigUint64(16, true)).toBe(100_000n);
    expect(view.getBigUint64(24, true)).toBe(5n);
    expect(view.getBigUint64(32, true)).toBe(0n);
  });

  it('market create is 112 bytes plus proofs with the margin params at offset 72', async () => {
    const tokenProgram = key(30);
    const quoteMint = key(31);
    const quoteVault = key(32);
    const createCtx = context([
      [tokenProgram, 1],
      [exchangeMeta, 2],
      [quoteMint, 3],
      [seatArena, 4],
      [orderArena, 5],
      [bids, 6],
      [asks, 7],
      [quoteVault, 8],
      [authority, 9],
      [oracle, 10],
    ]);
    const args = {
      marketRecordIndex: 1,
      tokenProgramAccountBytes: tokenProgram,
      exchangeMetaAccountBytes: exchangeMeta,
      quoteMintAccountBytes: quoteMint,
      lotSize: 1n,
      tickSize: 1_000n,
      priceCap: 200_000_000n,
      maxPositionLots: 1_000_000n,
      oracleFeedAccountBytes: oracle,
      initialMarginBps: 250,
      maintenanceMarginBps: 125,
      liquidationFeeBps: 100,
      markNum: 1n,
      markDen: 100_000n,
      oracleExponent: -8,
      maxMarkAgeNs: 0n,
      seatArenaAccountBytes: seatArena,
      orderArenaAccountBytes: orderArena,
      bidsCbookAccountBytes: bids,
      asksCbookAccountBytes: asks,
      quoteVaultAccountBytes: quoteVault,
      marketAuthorityAccountBytes: authority,
      seatArenaStateProof: Uint8Array.of(1, 2, 3),
      orderArenaStateProof: Uint8Array.of(4),
      bidsCbookStateProof: Uint8Array.of(5, 6),
      asksCbookStateProof: new Uint8Array(0),
      quoteVaultStateProof: Uint8Array.of(7),
    };
    const bytes = await createPerpMarketCreateInstruction(args)(createCtx);
    expect(bytes.length).toBe(112 + 3 + 1 + 2 + 0 + 1);
    expect(bytes[0]).toBe(PERP_INSTRUCTION_MARKET_CREATE);
    const view = new DataView(bytes.buffer, bytes.byteOffset);
    expect(view.getUint16(72, true)).toBe(10); /* oracle_feed_account_idx */
    expect(view.getUint16(74, true)).toBe(250);
    expect(view.getUint16(76, true)).toBe(125);
    expect(view.getUint16(78, true)).toBe(100);
    expect(view.getBigUint64(80, true)).toBe(1n);
    expect(view.getBigUint64(88, true)).toBe(100_000n);
    expect(view.getInt32(96, true)).toBe(-8);
    expect(view.getUint32(100, true)).toBe(0);
    expect(view.getBigUint64(104, true)).toBe(0n);
    expect([...bytes.subarray(112)]).toEqual([1, 2, 3, 4, 5, 6, 7]);
    await expect(createPerpMarketCreateInstruction({ ...args, maintenanceMarginBps: 250 })(createCtx)).rejects.toThrow(/maintenance/);
    await expect(createPerpMarketCreateInstruction({ ...args, markNum: 0n })(createCtx)).rejects.toThrow(/markNum/);
    await expect(createPerpMarketCreateInstruction({ ...args, markDen: 0n })(createCtx)).rejects.toThrow(/markDen/);
  });
});

describe('perp market derivation', () => {
  it('hashes initial_margin_bps as a trailing little-endian u16', async () => {
    const authority = address(40);
    const quoteMint = address(41);
    const tokenProgram = BOOTSTRAP_PROGRAM_ADDRESSES.token;
    const accounts = await derivePerpMarketAccounts({
      thru,
      tokenProgramAddress: tokenProgram,
      marketAuthorityAddress: authority,
      quoteMintAddress: quoteMint,
      lotSize: 1n,
      tickSize: 1_000n,
      priceCap: 200_000_000n,
      initialMarginBps: 250,
    });
    const u64 = (value: bigint) => {
      const bytes = Buffer.alloc(8);
      bytes.writeBigUInt64LE(value);
      return bytes;
    };
    const base = createHash('sha256')
      .update(key(40))
      .update(u64(1n))
      .update(u64(1_000n))
      .update(u64(200_000_000n))
      .update(key(41))
      .update(Buffer.from([250 & 0xff, 250 >> 8]))
      .digest();
    const unique = (id: string) => createHash('sha256').update(base).update(id).digest();
    const pda = (id: string) => deriveProgramAddress({ programAddress: PERP_PROGRAM_ADDRESS, seed: new Uint8Array(unique(id)), ephemeral: false }).address;
    expect(accounts.seatArena.address).toBe(pda('s'));
    expect(accounts.orderArena.address).toBe(pda('o'));
    expect(accounts.bidsCbook.address).toBe(pda('b'));
    expect(accounts.asksCbook.address).toBe(pda('a'));
    const other = await derivePerpMarketAccounts({
      thru,
      tokenProgramAddress: tokenProgram,
      marketAuthorityAddress: authority,
      quoteMintAddress: quoteMint,
      lotSize: 1n,
      tickSize: 1_000n,
      priceCap: 200_000_000n,
      initialMarginBps: 400,
    });
    expect(other.seatArena.address).not.toBe(accounts.seatArena.address);
  });
});

describe('perp events', () => {
  it('parses the liquidation event (type 15)', () => {
    const data = new Uint8Array(8 + 96 + 8 + 48 + 8);
    const view = new DataView(data.buffer);
    view.setBigUint64(0, BigInt(PERP_EVENT_LIQUIDATION), true);
    data.set(key(50), 8); /* market */
    data.set(key(51), 40); /* liquidator */
    data.set(key(52), 72); /* target */
    view.setUint32(104, 2, true); /* liquidator_seat_idx */
    view.setUint32(108, 5, true); /* target_seat_idx */
    view.setBigUint64(112, 10n, true); /* lots */
    view.setBigUint64(120, 81_000_000n, true); /* mark_price */
    view.setBigUint64(128, 8_100_000n, true); /* fee */
    view.setBigUint64(136, 0n, true); /* bad_debt */
    view.setBigUint64(144, 1_900_000n, true); /* target_quote_after */
    view.setBigUint64(152, 108_100_000n, true); /* liquidator_quote_after */
    data[160] = 0; /* side: target was long */
    const event = parsePerpEvent(data);
    expect(event.variant).toBe('liquidation');
    if (event.variant !== 'liquidation') throw new Error('unreachable');
    expect(event.market).toBe(address(50));
    expect(event.liquidator).toBe(address(51));
    expect(event.target).toBe(address(52));
    expect(event.liquidatorSeatIndex).toBe(2);
    expect(event.targetSeatIndex).toBe(5);
    expect(event.lots).toBe(10n);
    expect(event.markPrice).toBe(81_000_000n);
    expect(event.fee).toBe(8_100_000n);
    expect(event.badDebt).toBe(0n);
    expect(event.targetQuoteAfter).toBe(1_900_000n);
    expect(event.liquidatorQuoteAfter).toBe(108_100_000n);
    expect(event.targetSide).toBe('long');
    data[160] = 1;
    const short = parsePerpEvent(data);
    expect(short.variant === 'liquidation' && short.targetSide).toBe('short');
  });
});
