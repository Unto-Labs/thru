import { Pubkey } from '@thru/sdk';
import {
  PERP_CBOOK_EMPTY_PRICE_IN_TICKS,
  PERP_MARGIN_ACCOUNT_SIZE,
  PERP_MARGIN_MAGIC,
  PERP_MARKET_MAGIC,
  PERP_ORDER_ARENA_ENTRIES_OFFSET,
  PERP_ORDER_ENTRY_SIZE,
  PERP_SEAT_ARENA_ENTRIES_OFFSET,
  PERP_SEAT_ENTRY_SIZE,
  PERP_SEAT_MANAGER_RESERVED_SIZE,
} from '../index';
import type { PerpDeployment } from './deployment';

/* Account bytes in the current (0.4.0) layout for the SDK's tests; not exported. */

export function key(id: number): Uint8Array {
  const bytes = new Uint8Array(32);
  bytes[0] = id;
  bytes[31] = 0xa0 + id;
  return bytes;
}

export const address = (id: number) => Pubkey.from(key(id)).toThruFmt();

export interface FixtureMarket {
  seatArena: string;
  orderArena: string;
  bidsCbook: string;
  asksCbook: string;
  quoteVault: string;
  oracleFeed: string;
  marketAuthority: string;
}

export interface FixtureSeat {
  authority: string;
  quantityQuote: bigint;
  longLots?: bigint;
  shortLots?: bigint;
  openBidLots?: bigint;
  openBidNotional?: bigint;
  entryNotional?: bigint;
  headOrderEntryIndex?: number;
  cross?: boolean;
}

/** A seat arena: a 448 byte market header (lot 1, tick 1000, 20x) and seats. */
export function seatArenaBytes(market: FixtureMarket, seats: FixtureSeat[], options: { funding?: boolean; maxMarkAgeNs?: bigint } = {}): Uint8Array {
  const data = new Uint8Array(PERP_SEAT_ARENA_ENTRIES_OFFSET + Math.max(seats.length, 1) * PERP_SEAT_ENTRY_SIZE);
  const view = new DataView(data.buffer);
  data[0] = PERP_MARKET_MAGIC;
  view.setBigUint64(8, 1n, true); /* lot_size */
  view.setBigUint64(16, 1_000n, true); /* tick_size */
  view.setBigUint64(24, 5n, true); /* next_order_id */
  view.setBigUint64(32, 200_000_000n, true); /* price_cap */
  view.setBigUint64(40, 1_000_000n, true); /* max_position_lots */
  const pubkeys: Array<[number, string]> = [
    [64, market.orderArena],
    [96, market.bidsCbook],
    [128, market.asksCbook],
    [160, market.quoteVault],
    [192, market.marketAuthority],
    [224, market.oracleFeed],
  ];
  for (const [offset, entry] of pubkeys) data.set(Pubkey.from(entry).toBytes(), offset);
  view.setBigUint64(256, 1n, true); /* mark_num */
  view.setBigUint64(264, 1n, true); /* mark_den */
  view.setUint32(272, 500, true);
  view.setUint32(276, 250, true);
  view.setUint32(280, 100, true);
  view.setInt32(284, -8, true); /* oracle_exponent */
  view.setBigUint64(288, options.maxMarkAgeNs ?? 0n, true); /* max_mark_age_ns */
  if (options.funding) {
    view.setBigInt64(320, 2_000_000n, true); /* funding_index lo */
    view.setBigUint64(344, 7_200_000_000_000n, true); /* last round */
    view.setBigInt64(376, 25n, true); /* rate */
    view.setUint32(392, 40_000, true);
    view.setUint32(396, 100, true); /* premium_multiplier: on */
    view.setBigUint64(368, 10_000n, true);
  }
  view.setUint32(PERP_SEAT_MANAGER_RESERVED_SIZE + 116, seats.length + 1, true);
  seats.forEach((seat, i) => {
    const at = PERP_SEAT_ARENA_ENTRIES_OFFSET + i * PERP_SEAT_ENTRY_SIZE;
    data.set(Pubkey.from(seat.authority).toBytes(), at);
    view.setBigUint64(at + 32, BigInt.asUintN(64, seat.quantityQuote), true);
    view.setBigUint64(at + 40, seat.longLots ?? 0n, true);
    view.setBigUint64(at + 48, seat.shortLots ?? 0n, true);
    view.setBigUint64(at + 56, seat.openBidLots ?? 0n, true);
    view.setUint32(at + 72, seat.headOrderEntryIndex ?? 0, true);
    view.setBigUint64(at + 80, seat.entryNotional ?? 0n, true);
    view.setBigUint64(at + 88, seat.openBidNotional ?? 0n, true);
    view.setBigUint64(at + 120, seat.cross ? 3n : 1n, true);
  });
  return data;
}

/** An oracle price feed account (161 bytes, packed): feed_type 1,
    max_staleness_ns, last_update_ns, admin, reporter, name, price,
    max_variance_bps, exponent. */
export function oracleFeedBytes(feed: { price: bigint; lastUpdateNs: bigint; maxStalenessNs: bigint; exponent?: number; name?: string }): Uint8Array {
  const data = new Uint8Array(161);
  const view = new DataView(data.buffer);
  data[0] = 1;
  view.setBigUint64(1, feed.maxStalenessNs, true);
  view.setBigUint64(9, feed.lastUpdateNs, true);
  data.set(key(8), 17);
  data.set(key(8), 49);
  data.set(new TextEncoder().encode(feed.name ?? 'BTC/USD'), 81);
  view.setBigUint64(145, feed.price, true);
  view.setUint32(153, 500, true);
  view.setInt32(157, feed.exponent ?? -8, true);
  return data;
}

/** An order arena with resting bids on level `levelIndex` of the bids cbook. */
export function orderArenaBytes(orders: Array<{ seatIndex: number; levelIndex: number; lots: bigint; orderId: bigint }>): Uint8Array {
  const data = new Uint8Array(PERP_ORDER_ARENA_ENTRIES_OFFSET + Math.max(orders.length, 1) * PERP_ORDER_ENTRY_SIZE);
  const view = new DataView(data.buffer);
  view.setUint32(8 + 52, orders.length + 1, true);
  orders.forEach((order, i) => {
    const at = PERP_ORDER_ARENA_ENTRIES_OFFSET + i * PERP_ORDER_ENTRY_SIZE;
    view.setBigUint64(at, BigInt(order.seatIndex) << 40n, true);
    view.setBigUint64(at + 8, BigInt(order.levelIndex) << 40n, true); /* level account 0: bids */
    view.setBigUint64(at + 16, order.lots, true);
    view.setBigUint64(at + 24, order.orderId, true);
    view.setBigInt64(at + 56, 9_223_372_036_854_775_807n, true);
  });
  return data;
}

/** A cbook of `levels` levels; best price unset unless given. */
export function cbookBytes(levels: number, bestPriceInTicks: bigint = PERP_CBOOK_EMPTY_PRICE_IN_TICKS, heads: Array<[number, number]> = []): Uint8Array {
  const data = new Uint8Array(16 + levels * 8);
  const view = new DataView(data.buffer);
  view.setBigUint64(8, bestPriceInTicks, true);
  for (const [level, entry] of heads) {
    view.setUint32(16 + level * 8, entry, true);
    view.setUint32(20 + level * 8, entry, true);
  }
  return data;
}

export function marginAccountBytes(account: { owner: string; vault: string; accountId: number; links: Array<{ market: string; seatIndex: number }> }): Uint8Array {
  const data = new Uint8Array(PERP_MARGIN_ACCOUNT_SIZE);
  const view = new DataView(data.buffer);
  data[0] = PERP_MARGIN_MAGIC;
  data[1] = 1;
  data[2] = account.links.length;
  view.setUint32(8, account.accountId, true);
  data.set(Pubkey.from(account.owner).toBytes(), 16);
  data.set(Pubkey.from(account.vault).toBytes(), 48);
  account.links.forEach((link, i) => {
    data.set(Pubkey.from(link.market).toBytes(), 80 + i * 40);
    view.setUint32(112 + i * 40, link.seatIndex, true);
  });
  return data;
}

export function fixtureMarket(base: number): FixtureMarket {
  return {
    seatArena: address(base),
    orderArena: address(base + 1),
    bidsCbook: address(base + 2),
    asksCbook: address(base + 3),
    quoteVault: address(9),
    oracleFeed: address(base + 4),
    marketAuthority: address(8),
  };
}

export function fixtureDeployment(markets: Array<{ symbol: string; market: FixtureMarket }>): PerpDeployment {
  return {
    network: 'testnet',
    rpcUrl: 'http://127.0.0.1:1',
    deployedAt: '2026-10-16T00:00:00.000Z',
    deployer: address(8),
    perpProgram: address(5),
    perpProgramMeta: address(6),
    perpAbi: null,
    exchangeMeta: address(1),
    tokenProgram: address(2),
    oracleProgram: address(3),
    thruFaucetUrl: 'http://127.0.0.1:1/faucet',
    quoteMints: [{ symbol: 'THRUSD', name: 'Thru USD', glyph: '$', address: address(4), decimals: 6, mintAuthority: address(8), faucet: 'perps', seedHex: null }],
    markets: markets.map(({ symbol, market }) => ({
      symbol,
      baseSymbol: symbol.split('-')[0]!,
      quoteSymbol: 'THRUSD',
      ...market,
      lotSize: '1',
      tickSize: '1000',
      priceCap: '200000000',
      maxPositionLots: '1000000',
      baseDecimals: 3,
      quoteDecimals: 6,
      oracleFeedName: `${symbol}@test`,
      indexFxRate: '1',
      defaultOrderLots: '1',
      initialMarginBps: 500,
      maintenanceMarginBps: 250,
      liquidationFeeBps: 100,
      markNum: '1',
      markDen: '1',
      oracleExponent: -8,
    })),
  };
}
