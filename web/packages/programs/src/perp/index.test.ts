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
  createPerpFundingUpdateInstruction,
  createPerpLiquidateInstruction,
  createPerpMarketSetFundingInstruction,
  createPerpSettleFundingInstruction,
  createPerpMarketCreateInstruction,
  createPerpMarketRecordInstruction,
  createPerpMarketSetOracleInstruction,
  derivePerpMarketAccounts,
  parsePerpEvent,
  perpFundingHourlyRate,
  perpFundingParamsProblem,
  perpFundingPremiumSample,
  perpFundingRoundDue,
  perpFundingSampleDue,
  perpNextFundingRoundNs,
  perpSeatSideIndex,
  perpSettleFunding,
  PERP_EVENT_FUNDING_ROUND,
  PERP_INSTRUCTION_FUNDING_UPDATE,
  PERP_INSTRUCTION_MARKET_SET_FUNDING,
  PERP_INSTRUCTION_SETTLE_FUNDING,
  type PerpFunding,
  parsePerpMarketAccount,
  parsePerpOrderArenaAccount,
  parsePerpSeatArenaAccount,
  parsePerpSeatEntry,
  perpSeatEntryOffset,
  perpWithdrawable,
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
  perpOracleFeedIsFresh,
  perpOracleMaxAgeNs,
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
  PERP_EVENT_MARGIN,
  PERP_INSTRUCTION_MARGIN_ACCOUNT_CREATE,
  PERP_INSTRUCTION_MARGIN_LINK,
  PERP_INSTRUCTION_MARGIN_RECORD,
  PERP_INSTRUCTION_MARGIN_TRANSFER,
  PERP_INSTRUCTION_MARGIN_UNLINK,
  PERP_INSTRUCTION_MARKET_SET_CROSS,
  PERP_INSTRUCTION_MARKET_SET_VAULT,
  PERP_MARGIN_ACCOUNT_SIZE,
  PERP_MARGIN_MAGIC,
  PERP_SEAT_FLAG_ACTIVE,
  PERP_SEAT_FLAG_CROSS,
  createPerpMarginAccountCreateInstruction,
  createPerpMarginLinkInstruction,
  createPerpMarginRecordInstruction,
  createPerpMarginTransferInstruction,
  createPerpMarginUnlinkInstruction,
  createPerpMarketSetCrossInstruction,
  createPerpMarketSetVaultInstruction,
  derivePerpMarginAccountAddress,
  parsePerpMarginAccount,
  perpCrossIsBankruptFlat,
  perpCrossIsLiquidatable,
  perpCrossLiquidationAction,
  perpCrossLiquidationFee,
  perpCrossLiquidationTotals,
  perpCrossMakerFillAllowed,
  perpCrossTotals,
  perpCrossWithdrawable,
  perpMarginEquity,
  perpSeatIsCross,
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
  /* funding */
  view.setBigInt64(320, -5_000_000n, true); /* funding_index (lo): -5,000,000 as signed 128 bit */
  view.setBigInt64(328, -1n, true); /* funding_index (hi) */
  view.setBigInt64(336, 7n, true); /* funding_balance */
  view.setBigUint64(344, 3_600_000_000_000n, true); /* funding_last_round_ns */
  view.setBigUint64(352, 3_660_000_000_000n, true); /* funding_last_sample_ns */
  view.setBigInt64(360, -120_000n, true); /* funding_premium_sum */
  view.setBigUint64(368, 19_400n, true); /* funding_impact_notional */
  view.setBigInt64(376, -312n, true); /* funding_rate */
  view.setUint32(384, 100, true); /* funding_interest_rate */
  view.setUint32(388, 500, true); /* funding_clamp_small */
  view.setUint32(392, 40_000, true); /* funding_clamp_big */
  view.setUint32(396, 100, true); /* funding_premium_multiplier */
  view.setUint32(400, 3, true); /* funding_sample_cnt */
  view.setUint32(404, 2_500, true); /* cross_upnl_haircut_bps */
  /* the loss waterfall (0.5.0) */
  view.setUint16(4, 300, true); /* socialize_cap_bps */
  view.setUint16(6, 2_500, true); /* if_epoch_budget_bps */
  view.setUint16(316, 50, true); /* bankrupt_liq_reward_bps */
  view.setBigUint64(416, 9_000n, true); /* insurance_balance */
  view.setBigUint64(424, 1_000n, true); /* epoch_if_drawn */
  view.setBigUint64(432, 42n, true); /* epoch_soc_ticks */
  view.setBigUint64(440, 23n, true); /* bad_debt_both */
  view.setBigUint64(448, 142_857_143n, true); /* loss_offset_long (lo) */
  view.setBigInt64(464, -71_428_572n, true); /* loss_offset_short (lo): negative as signed 128 bit */
  view.setBigInt64(472, -1n, true); /* loss_offset_short (hi) */
  view.setUint32(480, 61_351, true); /* epoch_id */
  /* trading fees (0.5.0) */
  view.setUint32(296, 300, true); /* taker_fee_ppm */
  view.setUint32(300, 100, true); /* maker_rebate_ppm */
  view.setUint32(304, 50, true); /* builder_fee_cap_ppm */
  view.setUint32(308, 250_000, true); /* fee_insurance_share_ppm */
  view.setUint32(312, 500_000, true); /* liq_insurance_share_ppm */
  view.setUint32(488, 400, true); /* pending_taker_fee_ppm */
  view.setUint32(492, 0, true); /* pending_builder_fee_cap_ppm */
  view.setBigUint64(496, 7_200_000_000_000n, true); /* pending_activation_ns */
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
  fundingSnapshot?: bigint;
  fundingCarry?: number;
  /** Flags word when active (default 1: an isolated seat). */
  flags?: bigint;
  active: boolean;
}): Uint8Array {
  const data = new Uint8Array(PERP_SEAT_ENTRY_SIZE);
  const view = new DataView(data.buffer);
  data.set(seat.authority, 0);
  view.setBigUint64(32, BigInt.asUintN(64, seat.quantityQuote), true);
  view.setBigUint64(40, seat.longLots, true);
  view.setBigUint64(48, seat.shortLots, true);
  view.setBigUint64(56, seat.openBidLots, true);
  view.setBigUint64(64, seat.openAskLots, true);
  view.setUint32(72, seat.headOrderEntryIndex, true);
  view.setBigUint64(80, seat.entryNotional, true);
  view.setBigUint64(88, seat.openBidNotional, true);
  view.setBigUint64(96, seat.openAskNotional, true);
  view.setUint32(76, seat.fundingCarry ?? 0, true); /* funding_carry */
  view.setBigInt64(104, BigInt.asIntN(64, seat.fundingSnapshot ?? 0n), true); /* funding_snapshot (lo) */
  view.setBigInt64(112, (seat.fundingSnapshot ?? 0n) < 0n ? -1n : 0n, true); /* funding_snapshot (hi) */
  view.setBigUint64(120, seat.active ? seat.flags ?? 1n : 0n, true); /* flags */
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
  it('parses the 512 byte market account with its funding, loss waterfall and fee state', () => {
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
      funding: {
        index: -5_000_000n,
        balance: 7n,
        lastRoundNs: 3_600_000_000_000n,
        lastSampleNs: 3_660_000_000_000n,
        premiumSum: -120_000n,
        sampleCount: 3,
        rate: -312n,
        interestRate: 100,
        clampSmall: 500,
        clampBig: 40_000,
        premiumMultiplier: 100,
        impactNotional: 19_400n,
      },
      crossUpnlHaircutBps: 2_500,
      risk: {
        socializeCapBps: 300,
        ifEpochBudgetBps: 2_500,
        bankruptLiqRewardBps: 50,
        feeBalance: 0n,
        insuranceBalance: 9_000n,
        epochId: 61_351,
        epochIfDrawn: 1_000n,
        epochSocTicks: 42n,
        badDebtBoth: 23n,
        lossOffsetLong: 142_857_143n,
        lossOffsetShort: -71_428_572n,
      },
      fees: {
        takerFeePpm: 300,
        makerRebatePpm: 100,
        builderFeeCapPpm: 50,
        feeInsuranceSharePpm: 250_000,
        liqInsuranceSharePpm: 500_000,
        pendingTakerFeePpm: 400,
        pendingBuilderFeeCapPpm: 0,
        pendingActivationNs: 7_200_000_000_000n,
      },
    });
  });

  it('rejects a short (224 byte) market', () => {
    expect(() => parsePerpMarketAccount(marketBytes().subarray(0, 224))).toThrow(/512 bytes/);
    expect(() => parsePerpMarketAccount(new Uint8Array(512))).toThrow(/not a perp market/);
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
          fundingSnapshot: -4_000_000n,
          fundingCarry: 123,
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
        fundingSnapshot: -4_000_000n,
        fundingCarry: 123,
        cross: false,
      },
    ]);
  });

  it('parses one seat entry read as a slice the same as the whole arena', () => {
    const active = { authority: key(10), quantityQuote: 50_000_000n, longLots: 10n, shortLots: 0n, openBidLots: 2n, openAskLots: 3n,
      headOrderEntryIndex: 7, entryNotional: 850_000_000n, openBidNotional: 168_000_000n, openAskNotional: 258_000_000n };
    const bytes = seatArenaBytes([
      seatBytes({ ...active, authority: key(11), active: false }),
      seatBytes({ ...active, active: true }),
      seatBytes({ ...active, quantityQuote: -5_000_000n, flags: 3n, active: true }),
    ]);
    expect(perpSeatEntryOffset(1)).toBe(PERP_SEAT_ARENA_ENTRIES_OFFSET);
    const slice = (seatIndex: number) =>
      bytes.subarray(perpSeatEntryOffset(seatIndex), perpSeatEntryOffset(seatIndex) + PERP_SEAT_ENTRY_SIZE);
    const arena = parsePerpSeatArenaAccount(bytes);
    expect(parsePerpSeatEntry(slice(2), 2)).toEqual(arena.seats[0]);
    expect(parsePerpSeatEntry(slice(3), 3)).toEqual(arena.seats[1]);
    expect(arena.seats[1]).toMatchObject({ cross: true, quantityQuote: -5_000_000n });
    expect(arena.seats[0]!.seatIndex).toBe(2);
    expect(parsePerpSeatEntry(slice(1), 1)).toBeNull();
    expect(() => parsePerpSeatEntry(bytes.subarray(0, 64), 1)).toThrow(/128 bytes/);
    expect(parsePerpMarketAccount(bytes.subarray(0, PERP_MARKET_ACCOUNT_SIZE))).toEqual(arena.market);
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

  it("applies the program's oracle freshness rule (oracle_feed_is_fresh)", () => {
    const feed = { common: { maxStalenessNs: 10n, lastUpdateNs: 100n, adminAddress: address(1), reporterAddress: address(2), feedName: 'BTC/USD' } };
    /* The market's maxMarkAgeNs, or the feed's maxStalenessNs when it is 0. */
    expect(perpOracleMaxAgeNs({ maxMarkAgeNs: 0n }, feed)).toBe(10n);
    expect(perpOracleMaxAgeNs({ maxMarkAgeNs: 3n }, feed)).toBe(3n);
    expect(perpOracleFeedIsFresh(feed, { maxMarkAgeNs: 0n }, 100n)).toBe(true);
    expect(perpOracleFeedIsFresh(feed, { maxMarkAgeNs: 0n }, 110n)).toBe(true); /* the boundary is fresh */
    expect(perpOracleFeedIsFresh(feed, { maxMarkAgeNs: 0n }, 111n)).toBe(false);
    expect(perpOracleFeedIsFresh(feed, { maxMarkAgeNs: 3n }, 103n)).toBe(true);
    expect(perpOracleFeedIsFresh(feed, { maxMarkAgeNs: 3n }, 104n)).toBe(false);
    expect(perpOracleFeedIsFresh(feed, { maxMarkAgeNs: 0n }, 99n)).toBe(false); /* stamped after now */
    /* Both ages 0: fresh only at the update's own time. */
    const zero = { common: { ...feed.common, maxStalenessNs: 0n } };
    expect(perpOracleFeedIsFresh(zero, { maxMarkAgeNs: 0n }, 100n)).toBe(true);
    expect(perpOracleFeedIsFresh(zero, { maxMarkAgeNs: 0n }, 101n)).toBe(false);
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
    /* withdrawable: free floored at zero and capped at the balance */
    expect(perpWithdrawable(MARKET, s, 86_000_000n)).toBe(17_000_000n);
    expect(perpWithdrawable(MARKET, s, 84_000_000n)).toBe(0n);
    expect(perpWithdrawable(MARKET, seat({ longLots: 0n, entryNotional: 0n }), ENTRY)).toBe(COLLATERAL);
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
    expect(gap).toEqual({ side: 'long', lots: LOTS, price: 80_000_000n, fee: 0n, insurance: 0n, liquidatorFee: 0n, targetQuoteAfter: 0n });
    /* mark between liquidation and bankruptcy: fee 1% of notional capped by what is left */
    const mark = 81_000_000n;
    const preview = perpLiquidationPreview(MARKET, s, mark)!;
    expect(preview.price).toBe(mark);
    const quoteAfterClose = COLLATERAL + perpUnrealizedPnl(MARKET, s, mark); /* 10,000,000 */
    expect(quoteAfterClose).toBe(10_000_000n);
    expect(preview.fee).toBe((850_000_000n - 40_000_000n) / 100n); /* 8,100,000 */
    expect(preview.targetQuoteAfter).toBe(quoteAfterClose - preview.fee);
    expect(preview.liquidatorFee).toBe(preview.fee);
    /* A 0.5.0 market sends floor( fee * share ) to insurance: the liquidator gets the rest. */
    const shared = perpLiquidationPreview({ ...MARKET, fees: { liqInsuranceSharePpm: 333_333 } }, s, mark)!;
    expect(shared.insurance).toBe((8_100_000n * 333_333n) / 1_000_000n);
    expect(shared.liquidatorFee).toBe(8_100_000n - shared.insurance);
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

describe('perp funding', () => {
  /* The vectors match thru-perps/tests/test_txn_perp_program/test_funding.c. */
  const params = { interestRate: 100, clampSmall: 500, clampBig: 40_000, premiumMultiplier: 100 };

  it('turns the premium samples into the hourly rate as Lighter does', () => {
    expect(perpFundingHourlyRate(0n, params)).toBe(12n);
    expect(perpFundingHourlyRate(60n * 2_000n, params)).toBe(187n);
    expect(perpFundingHourlyRate(-60n * 3_000n, params)).toBe(-312n);
    expect(perpFundingHourlyRate(60n * 400n, params)).toBe(12n);
    expect(perpFundingHourlyRate(60n * 100_000n, params)).toBe(5_000n);
    expect(perpFundingHourlyRate(-60n * 100_000n, params)).toBe(-5_000n);
    expect(perpFundingHourlyRate(30n * 2_000n, params)).toBe(62n);
    expect(perpFundingHourlyRate(60n * 2_000n, { ...params, premiumMultiplier: 50 })).toBe((1_000n - 250n) / 8n);
    expect(perpFundingHourlyRate(59n, { interestRate: 0, clampSmall: 0, clampBig: 40_000, premiumMultiplier: 100 })).toBe(0n);
    expect(perpFundingHourlyRate(-59n, { interestRate: 0, clampSmall: 0, clampBig: 40_000, premiumMultiplier: 100 })).toBe(0n);
  });

  it('samples the premium from the impact prices', () => {
    expect(perpFundingPremiumSample(200n, 220n, 240n)).toBe(100_000n);
    expect(perpFundingPremiumSample(200n, 160n, 180n)).toBe(-100_000n);
    expect(perpFundingPremiumSample(200n, 190n, 210n)).toBe(0n);
    expect(perpFundingPremiumSample(200n, 0n, 0n)).toBe(0n);
    expect(perpFundingPremiumSample(200n, 1_000n, 0n)).toBe(1_000_000n);
    expect(perpFundingPremiumSample(3n, 4n, 0n)).toBe(333_333n);
    expect(perpFundingPremiumSample(0n, 4n, 5n)).toBe(0n);
  });

  it('validates parameters like market_set_funding', () => {
    const margins = { initialMarginBps: 1000, maintenanceMarginBps: 500 };
    const ok = { interestRate: 100, clampSmall: 500, clampBig: 400_000, premiumMultiplier: 100, impactNotional: 1n };
    expect(perpFundingParamsProblem(margins, ok)).toBeNull();
    expect(perpFundingParamsProblem(margins, { ...ok, clampBig: 400_008 })).toMatch(/margin gap/);
    expect(perpFundingParamsProblem(margins, { ...ok, premiumMultiplier: 101 })).toMatch(/premiumMultiplier/);
    expect(perpFundingParamsProblem(margins, { ...ok, impactNotional: 0n })).toMatch(/impactNotional/);
    expect(perpFundingParamsProblem(margins, { ...ok, interestRate: 1_000_001 })).toMatch(/interestRate/);
    expect(perpFundingParamsProblem(margins, { ...ok, premiumMultiplier: 0, impactNotional: 0n })).toBeNull();
  });

  it('schedules rounds on UTC hours and samples on UTC minutes', () => {
    const t0 = 1_767_225_600_000_000_000n; /* an exact UTC hour */
    const funding = { lastRoundNs: t0 + 30_000_000_000n, lastSampleNs: t0 + 30_000_000_000n };
    expect(perpNextFundingRoundNs(funding)).toBe(t0 + 3_600_000_000_000n);
    expect(perpFundingRoundDue(funding, t0 + 3_599_999_999_999n)).toBe(false);
    expect(perpFundingRoundDue(funding, t0 + 3_600_000_000_000n)).toBe(true);
    expect(perpFundingSampleDue(funding, t0 + 59_000_000_000n)).toBe(false);
    expect(perpFundingSampleDue(funding, t0 + 60_000_000_000n)).toBe(true);
  });

  it('settles seats exactly, rounding against the seat, carrying the remainder', () => {
    const funding: PerpFunding = {
      index: 232_800n, balance: 0n, lastRoundNs: 0n, lastSampleNs: 0n, premiumSum: 0n, sampleCount: 0, rate: 12n,
      interestRate: 100, clampSmall: 500, clampBig: 40_000, premiumMultiplier: 100, impactNotional: 1n,
    };
    const market = { funding };
    const longer = seat({ quantityQuote: 1_000n, longLots: 10n, shortLots: 0n });
    const shorter = seat({ quantityQuote: 1_000n, longLots: 0n, shortLots: 10n });
    const a = perpSettleFunding(market, longer);
    expect(a.paid).toBe(-3n);
    expect(a.seat.quantityQuote).toBe(997n);
    expect(a.seat.fundingCarry).toBe(672_000);
    expect(a.seat.fundingSnapshot).toBe(232_800n);
    const b = perpSettleFunding(market, shorter);
    expect(b.paid).toBe(2n);
    expect(b.seat.quantityQuote).toBe(1_002n);
    expect(b.seat.fundingCarry).toBe(328_000);
    /* the collected atom is exactly the two carries */
    expect((-a.paid - b.paid) * 1_000_000n).toBe(BigInt(a.seat.fundingCarry + b.seat.fundingCarry));
    /* settling a settled seat is a no-op */
    expect(perpSettleFunding(market, a.seat)).toEqual({ seat: a.seat, paid: 0n, badDebt: 0n });
    /* a charge beyond the collateral raises a long's cost basis */
    const poor = perpSettleFunding(market, seat({ quantityQuote: 1n, longLots: 10n, shortLots: 0n, entryNotional: 100n }));
    expect(poor.seat.quantityQuote).toBe(0n);
    expect(poor.seat.entryNotional).toBe(102n);
    expect(poor.badDebt).toBe(0n);
    /* a short's entry absorbs what it can; the rest is bad debt */
    const down = { funding: { ...funding, index: -232_800n } };
    const thin = perpSettleFunding(down, seat({ quantityQuote: 1n, longLots: 0n, shortLots: 10n, entryNotional: 1n }));
    expect(thin.seat.quantityQuote).toBe(0n);
    expect(thin.seat.entryNotional).toBe(0n);
    expect(thin.badDebt).toBe(1n);
    /* no funding on the market: nothing moves */
    expect(perpSettleFunding({}, longer)).toEqual({ seat: { ...longer, fundingSnapshot: 0n, fundingCarry: 0 }, paid: 0n, badDebt: 0n });
  });

  it('settles loss charges against the side index (0.5.0)', () => {
    const funding: PerpFunding = {
      index: 0n, balance: 0n, lastRoundNs: 0n, lastSampleNs: 0n, premiumSum: 0n, sampleCount: 0, rate: 0n,
      interestRate: 100, clampSmall: 500, clampBig: 40_000, premiumMultiplier: 100, impactNotional: 1n,
    };
    /* Longs charged 142,857,143 ticks a lot (R = 1,000 over 7 lots, rounded
       up), shorts untouched. */
    const risk = {
      socializeCapBps: 500, ifEpochBudgetBps: 0, bankruptLiqRewardBps: 0, feeBalance: 0n, insuranceBalance: 0n, epochId: 0,
      epochIfDrawn: 0n, epochSocTicks: 142_857_143n, badDebtBoth: 0n, lossOffsetLong: 142_857_143n, lossOffsetShort: 0n,
    };
    const market = { funding, risk };
    const long3 = seat({ quantityQuote: 10_000n, longLots: 3n, shortLots: 0n });
    const short7 = seat({ quantityQuote: 10_000n, longLots: 0n, shortLots: 7n });
    const flat = seat({ quantityQuote: 10_000n, longLots: 0n, shortLots: 0n });
    expect(perpSeatSideIndex(market, long3)).toBe(142_857_143n);
    expect(perpSeatSideIndex(market, short7)).toBe(0n);
    const a = perpSettleFunding(market, long3);
    /* 3 * 142,857,143 = 428,571,429 ticks: 429 atoms, carry 428,571 */
    expect(a.paid).toBe(-429n);
    expect(a.seat.fundingCarry).toBe(428_571);
    expect(a.seat.fundingSnapshot).toBe(142_857_143n);
    expect(perpSettleFunding(market, short7).paid).toBe(0n);
    expect(perpSettleFunding(market, flat).paid).toBe(0n);
    /* a market without the waterfall settles against the funding index */
    expect(perpSettleFunding({ funding }, long3).paid).toBe(0n);
  });

  it('funding update is 8 bytes; market set funding is 32', async () => {
    const ctx = { getAccountIndex: () => 0 } as never;
    expect([...(await createPerpFundingUpdateInstruction({ marketRecordIndex: 1 })(ctx))]).toEqual([PERP_INSTRUCTION_FUNDING_UPDATE, 1, 0, 0, 0, 0, 0, 0]);
    const bytes = await createPerpMarketSetFundingInstruction({
      marketRecordIndex: 1, interestRate: 100, clampSmall: 500, clampBig: 40_000, premiumMultiplier: 100, impactNotional: 19_400n,
    })(ctx);
    expect(bytes.length).toBe(32);
    const view = new DataView(bytes.buffer, bytes.byteOffset);
    expect(bytes[0]).toBe(PERP_INSTRUCTION_MARKET_SET_FUNDING);
    expect(bytes[1]).toBe(1);
    expect(view.getUint32(4, true)).toBe(100);
    expect(view.getUint32(8, true)).toBe(500);
    expect(view.getUint32(12, true)).toBe(40_000);
    expect(view.getUint32(16, true)).toBe(100);
    expect(view.getBigUint64(24, true)).toBe(19_400n);
    expect([...(await createPerpSettleFundingInstruction({ marketRecordIndex: 1, targetSeatIndex: 42 })(ctx))]).toEqual([
      PERP_INSTRUCTION_SETTLE_FUNDING, 1, 0, 0, 42, 0, 0, 0,
    ]);
    expect(() => createPerpSettleFundingInstruction({ marketRecordIndex: 1, targetSeatIndex: 0 })).toThrow(/targetSeatIndex/);
    expect(() => createPerpMarketSetFundingInstruction({
      marketRecordIndex: 1, interestRate: -1, clampSmall: 0, clampBig: 0, premiumMultiplier: 0, impactNotional: 0n,
    })).toThrow(/interestRate/);
  });

  it('parses the funding round event (type 16)', () => {
    const data = new Uint8Array(8 + 32 + 8 + 8 + 4 + 4 + 8 + 16 + 8);
    const view = new DataView(data.buffer);
    view.setBigUint64(0, BigInt(PERP_EVENT_FUNDING_ROUND), true);
    data.set(key(60), 8); /* market */
    view.setBigInt64(40, -312n, true); /* rate */
    view.setBigInt64(48, -180_000n, true); /* premium_sum */
    view.setUint32(56, 60, true); /* sample_cnt */
    view.setBigUint64(64, 200n, true); /* index_price */
    view.setBigInt64(72, -6_052_800n, true); /* funding_index lo */
    view.setBigInt64(80, -1n, true); /* funding_index hi */
    view.setBigUint64(88, 3_600_000_000_000n, true); /* round_ns */
    const event = parsePerpEvent(data);
    expect(event).toMatchObject({
      variant: 'funding_round',
      market: address(60),
      rate: -312n,
      premiumSum: -180_000n,
      sampleCount: 60,
      indexPrice: 200n,
      fundingIndex: -6_052_800n,
      roundNs: 3_600_000_000_000n,
    });
  });
});

describe('perp cross margin', () => {
  /* Vectors match thru-perps/tests/test_txn_perp_program/test_cross.c: lot
     97, 10% initial, 5% maintenance, marks in quote atoms (100 ticks = 200). */
  const market = { lotSize: 97n, initialMarginBps: 1000, maintenanceMarginBps: 500, crossUpnlHaircutBps: 0 };
  const flat = (quantityQuote: bigint): PerpMarginSeat => ({
    quantityQuote, longLots: 0n, shortLots: 0n, openBidLots: 0n, openAskLots: 0n,
    entryNotional: 0n, openBidNotional: 0n, openAskNotional: 0n, cross: true,
  });
  const long = (quantityQuote: bigint, lots: bigint, entryTicks: bigint): PerpMarginSeat => ({
    ...flat(quantityQuote), longLots: lots, entryNotional: lots * 97n * entryTicks * 2n,
  });

  it('reads a cross seat\'s balance as signed', () => {
    const arena = parsePerpSeatArenaAccount(
      seatArenaBytes([
        seatBytes({
          authority: key(12), quantityQuote: -300n, longLots: 0n, shortLots: 0n, openBidLots: 0n, openAskLots: 0n,
          headOrderEntryIndex: 0, entryNotional: 0n, openBidNotional: 0n, openAskNotional: 0n,
          flags: PERP_SEAT_FLAG_ACTIVE | PERP_SEAT_FLAG_CROSS, active: true,
        }),
        seatBytes({
          authority: key(13), quantityQuote: 0xffff_ffff_ffff_fed4n, longLots: 0n, shortLots: 0n, openBidLots: 0n, openAskLots: 0n,
          headOrderEntryIndex: 0, entryNotional: 0n, openBidNotional: 0n, openAskNotional: 0n, active: true,
        }),
      ]),
    );
    expect(arena.seats[0]).toMatchObject({ quantityQuote: -300n, cross: true });
    /* the same bits on an isolated seat are an unsigned balance */
    expect(arena.seats[1]).toMatchObject({ quantityQuote: 0xffff_ffff_ffff_fed4n, cross: false });
    expect(perpSeatIsCross(3n)).toBe(true);
    expect(perpSeatIsCross(1n)).toBe(false);
  });

  it('parses the 433 byte margin account', () => {
    expect(PERP_MARGIN_ACCOUNT_SIZE).toBe(433);
    const data = new Uint8Array(PERP_MARGIN_ACCOUNT_SIZE);
    const view = new DataView(data.buffer);
    data[0] = PERP_MARGIN_MAGIC;
    data[1] = 1; /* version */
    data[2] = 2; /* link_cnt */
    view.setUint32(8, 7, true); /* account_id */
    data.set(key(30), 16); /* owner */
    data.set(key(31), 48); /* vault */
    data.set(key(32), 80); /* links[0].market */
    view.setUint32(112, 3, true); /* links[0].seat_idx */
    data.set(key(33), 120); /* links[1].market */
    view.setUint32(152, 9, true); /* links[1].seat_idx */
    data.set(key(34), 160); /* links[2] beyond link_cnt: ignored */
    expect(parsePerpMarginAccount(data)).toEqual({
      accountId: 7, owner: address(30), vault: address(31),
      links: [{ market: address(32), seatIndex: 3 }, { market: address(33), seatIndex: 9 }],
    });
    expect(() => parsePerpMarginAccount(data.subarray(0, 432))).toThrow(/433 bytes/);
    data[0] = PERP_MARKET_MAGIC;
    expect(() => parsePerpMarginAccount(data)).toThrow(/not a perp margin account/);
  });

  it('profit in one market backs a position in another', () => {
    /* long 5 lots at 100 ticks in market A with 10000; market B's seat holds nothing */
    const a = long(10_000n, 5n, 100n);
    const b = flat(0n);
    expect(perpCrossTotals([{ market, seat: a, mark: 200n }, { market, seat: b }]).free).toBe(300n);
    const up = perpCrossTotals([{ market, seat: a, mark: 220n }, { market, seat: b }]);
    expect(up.free).toBe(9_030n);
    expect(perpCanPostOrder(market, b, 'buy', 1n, 200n, 200n, 300n)).toBe(false);
    expect(perpCanPostOrder(market, b, 'buy', 1n, 200n, 200n, 9_030n)).toBe(true);
    /* a flat seat needs no mark; an exposed one does */
    expect(() => perpCrossTotals([{ market, seat: a }])).toThrow(/mark/);
  });

  it('a loss in one market makes the account liquidatable; profit elsewhere nets it', () => {
    const a = long(20_000n, 5n, 100n);
    const b = long(0n, 5n, 100n);
    const down = perpCrossTotals([{ market, seat: a, mark: 200n }, { market, seat: b, mark: 160n }]);
    expect(down).toEqual({ equity: 600n, free: 600n - 9_700n - 7_760n, maintenance: 8_730n, collateral: 20_000n, hasPosition: true });
    expect(perpCrossIsLiquidatable(down)).toBe(true);
    /* short 5 in A instead: both legs at 80 net to the collateral */
    const shortA: PerpMarginSeat = { ...flat(20_000n), shortLots: 5n, entryNotional: 5n * 97n * 200n };
    const netted = perpCrossTotals([{ market, seat: shortA, mark: 160n }, { market, seat: b, mark: 160n }]);
    expect(netted.equity).toBe(20_000n);
    expect(netted.maintenance).toBe(7_760n);
    expect(perpCrossIsLiquidatable(netted)).toBe(false);
    /* flat everywhere with a negative sum: written off */
    expect(perpCrossIsBankruptFlat(perpCrossTotals([{ market, seat: flat(10_000n) }, { market, seat: flat(-14_550n) }]))).toBe(true);
  });

  it('liquidation bounds a market without a mark and cancels orders where the account is flat', () => {
    /* test_cross.c "Cross stale liquidation": short 1 in A (entry 19400) on
       20000, long 5 in B (entry 97000); cap 1000 ticks, 1% fee. */
    const capped = { ...market, priceCap: 2_000n, liquidationFeeBps: 100 };
    const shortA: PerpMarginSeat = { ...flat(20_000n), shortLots: 1n, entryNotional: 19_400n };
    const longB = long(0n, 5n, 100n);
    /* B at 70 ticks: exact, liquidatable */
    const exact = perpCrossLiquidationTotals([{ market: capped, seat: shortA, mark: 200n }, { market: capped, seat: longB, mark: 140n }]);
    expect(exact).toMatchObject({ equityLow: -9_100n, equityHigh: -9_100n, maintenanceLow: 4_365n, bounded: false });
    expect(perpCrossLiquidationAction(longB, 140n, exact)).toBe('liquidate');
    /* A unread: its short is worth up to its entry, 10300 >= 3395 */
    const inconclusive = perpCrossLiquidationTotals([{ market: capped, seat: shortA }, { market: capped, seat: longB, mark: 140n }]);
    expect(inconclusive).toMatchObject({ equityHigh: 10_300n, maintenanceLow: 3_395n, bounded: true });
    expect(perpCrossLiquidationAction(longB, 140n, inconclusive)).toBeNull();
    /* B at 10 ticks: at most -47900 against 485; the short at the cap leaves no fee */
    const decided = perpCrossLiquidationTotals([{ market: capped, seat: shortA }, { market: capped, seat: longB, mark: 20n }]);
    expect(decided).toMatchObject({ equityLow: 20_000n + 19_400n - 194_000n - 87_300n, equityHigh: -47_900n, maintenanceLow: 485n });
    expect(perpCrossLiquidationAction(longB, 20n, decided)).toBe('liquidate');
    expect(perpCrossLiquidationFee(capped, 5n, 20n, decided)).toBe(0n);
    /* the market's own mark is still needed for its position */
    expect(perpCrossLiquidationAction(longB, undefined, decided)).toBeNull();
    /* resting orders in a market without a position: cancelled when liquidatable */
    const bidOnly: PerpMarginSeat = { ...flat(0n), openBidLots: 2n, openBidNotional: 2n * 97n * 180n };
    const withOrders = perpCrossLiquidationTotals([{ market: capped, seat: bidOnly }, { market: capped, seat: longB, mark: 140n }, { market: capped, seat: flat(20_000n) }]);
    expect(perpCrossLiquidationAction(bidOnly, undefined, withOrders)).toBe('cancel');
    const healthy = perpCrossLiquidationTotals([{ market: capped, seat: bidOnly }, { market: capped, seat: longB, mark: 200n }, { market: capped, seat: flat(20_000n) }]);
    expect(perpCrossLiquidationAction(bidOnly, 200n, healthy)).toBeNull();
    /* flat everywhere with a negative sum: written off */
    expect(perpCrossLiquidationAction(flat(-500n), 200n, perpCrossLiquidationTotals([{ market: capped, seat: flat(-500n) }]))).toBe('write-off');
  });

  it('withdrawals are bounded by free margin and realized collateral', () => {
    const a = long(10_000n, 5n, 100n);
    expect(perpCrossWithdrawable(perpCrossTotals([{ market, seat: a, mark: 200n }, { market, seat: flat(10_000n) }]))).toBe(10_300n);
    /* market A at 130 ticks: free 26190, realized 9700 */
    const t = perpCrossTotals([{ market, seat: a, mark: 260n }, { market, seat: flat(-300n) }]);
    expect(t.free).toBe(26_190n);
    expect(perpCrossWithdrawable(t)).toBe(9_700n);
  });

  it('haircuts a cross seat\'s positive unrealized pnl for initial margin only', () => {
    const a = long(10_000n, 5n, 100n);
    const cut = { ...market, crossUpnlHaircutBps: 5_000 };
    expect(perpMarginEquity(cut, a, 220n)).toBe(10_000n + 4_850n);
    expect(perpFreeCollateral(cut, a, 220n)).toBe(10_000n + 4_850n - 10_670n);
    expect(perpEquity(cut, a, 220n)).toBe(19_700n);
    /* an isolated seat is never cut */
    expect(perpMarginEquity(cut, { ...a, cross: false }, 220n)).toBe(19_700n);
    /* a loss is never cut */
    expect(perpMarginEquity({ ...market, crossUpnlHaircutBps: 10_000 }, a, 180n)).toBe(10_000n - 9_700n);
  });

  it('accepts a cross maker fill only at or better than the mark', () => {
    /* a bid at 95 ticks: fine with the mark at 100 or exactly 95, evicted with the mark at 80 */
    expect(perpCrossMakerFillAllowed('buy', 190n, 200n)).toBe(true);
    expect(perpCrossMakerFillAllowed('buy', 190n, 190n)).toBe(true);
    expect(perpCrossMakerFillAllowed('buy', 190n, 160n)).toBe(false);
    /* an ask: at or above the mark */
    expect(perpCrossMakerFillAllowed('sell', 190n, 160n)).toBe(true);
    expect(perpCrossMakerFillAllowed('sell', 190n, 200n)).toBe(false);
  });

  it('settles a cross seat\'s funding into a negative balance', () => {
    const funding: PerpFunding = {
      index: 2_000_000_000n, balance: 0n, lastRoundNs: 0n, lastSampleNs: 0n, premiumSum: 0n, sampleCount: 0, rate: 0n,
      interestRate: 100, clampSmall: 500, clampBig: 40_000, premiumMultiplier: 100, impactNotional: 1n,
    };
    const settled = perpSettleFunding({ funding }, { ...long(0n, 5n, 100n), fundingSnapshot: 0n, fundingCarry: 0 });
    expect(settled.paid).toBe(-10_000n);
    expect(settled.seat.quantityQuote).toBe(-10_000n);
    expect(settled.seat.entryNotional).toBe(5n * 97n * 200n);
    expect(settled.badDebt).toBe(0n);
  });

  const marginAccount = key(40);
  const arenaA = key(41);
  const arenaB = key(42);
  const arenaC = key(43);
  const feedA = key(44);
  const owner = key(45);
  const vault = key(46);
  const newVault = key(47);
  const exchangeMeta = key(48);
  const ctx = context([
    [marginAccount, 9], [arenaA, 1], [arenaB, 2], [arenaC, 3], [feedA, 4], [owner, 5], [vault, 6], [newVault, 7], [exchangeMeta, 8],
  ]);

  it('margin record: 8 bytes plus every link padded to 8 bytes', async () => {
    const three = await createPerpMarginRecordInstruction({
      marginRecordIndex: 2,
      marginAccountBytes: marginAccount,
      exchangeMetaAccountBytes: exchangeMeta,
      entries: [{ seatArenaAccountBytes: arenaA, oracleFeedAccountBytes: feedA }, { seatArenaAccountBytes: arenaB }, { seatArenaAccountBytes: arenaC }],
    })(ctx);
    expect([...three]).toEqual([
      PERP_INSTRUCTION_MARGIN_RECORD, 2, 9, 0, 3, 0, 8, 0,
      1, 0, 4, 0, 2, 0, 0xff, 0xff,
      3, 0, 0xff, 0xff, 0, 0, 0, 0,
    ]);
    const none = await createPerpMarginRecordInstruction({ marginRecordIndex: 0, marginAccountBytes: marginAccount, exchangeMetaAccountBytes: exchangeMeta, entries: [] })(ctx);
    expect([...none]).toEqual([PERP_INSTRUCTION_MARGIN_RECORD, 0, 9, 0, 0, 0, 8, 0]);
    expect(() => createPerpMarginRecordInstruction({ marginRecordIndex: 4, marginAccountBytes: marginAccount, exchangeMetaAccountBytes: exchangeMeta, entries: [] })).toThrow(/marginRecordIndex/);
  });

  it('margin link, unlink, transfer, set vault and set cross layouts', async () => {
    expect([...(await createPerpMarginLinkInstruction({ marginRecordIndex: 1, marketRecordIndex: 3 })(ctx))]).toEqual([
      PERP_INSTRUCTION_MARGIN_LINK, 1, 3, 0, 0, 0, 0, 0,
    ]);
    expect([...(await createPerpMarginUnlinkInstruction({ marginRecordIndex: 1, marketRecordIndex: 3 })(ctx))]).toEqual([
      PERP_INSTRUCTION_MARGIN_UNLINK, 1, 3, 0, 0, 0, 0, 0,
    ]);
    const transfer = await createPerpMarginTransferInstruction({ marginRecordIndex: 0, fromLink: 0, toLink: 2, ownerAccountBytes: owner, amount: 3_880n })(ctx);
    expect(transfer.length).toBe(16);
    expect([...transfer.subarray(0, 8)]).toEqual([PERP_INSTRUCTION_MARGIN_TRANSFER, 0, 0, 2, 5, 0, 0, 0]);
    expect(new DataView(transfer.buffer, transfer.byteOffset).getBigUint64(8, true)).toBe(3_880n);
    expect([...(await createPerpMarketSetVaultInstruction({ marketRecordIndex: 4, exchangeAdminAccountBytes: owner, newVaultAccountBytes: newVault })(ctx))]).toEqual([
      PERP_INSTRUCTION_MARKET_SET_VAULT, 4, 5, 0, 7, 0, 0, 0,
    ]);
    expect([...(await createPerpMarketSetCrossInstruction({ marketRecordIndex: 1, crossUpnlHaircutBps: 5_000 })(ctx))]).toEqual([
      PERP_INSTRUCTION_MARKET_SET_CROSS, 1, 0, 0, 0x88, 0x13, 0, 0,
    ]);
    expect(() => createPerpMarketSetCrossInstruction({ marketRecordIndex: 1, crossUpnlHaircutBps: 10_001 })).toThrow(/crossUpnlHaircutBps/);
  });

  it('margin account create carries the proof after a 16 byte header', async () => {
    const proof = new Uint8Array([9, 8, 7]);
    const bytes = await createPerpMarginAccountCreateInstruction({
      ownerAccountBytes: owner, marginAccountBytes: marginAccount, vaultAccountBytes: vault, accountId: 258, proof,
    })(ctx);
    expect(bytes.length).toBe(19);
    expect([...bytes]).toEqual([PERP_INSTRUCTION_MARGIN_ACCOUNT_CREATE, 0, 5, 0, 9, 0, 6, 0, 2, 1, 0, 0, 3, 0, 0, 0, 9, 8, 7]);
  });

  it('derives the margin account address like margin_account_create', async () => {
    const id = new Uint8Array([7, 0, 0, 0]);
    const seed = createHash('sha256').update(Buffer.from('perp_margin')).update(key(30)).update(key(31)).update(id).digest();
    const expected = deriveProgramAddress({ programAddress: PERP_PROGRAM_ADDRESS, seed: new Uint8Array(seed), ephemeral: false });
    const derived = await derivePerpMarginAccountAddress({ ownerAddress: address(30), vaultAddress: address(31), accountId: 7 });
    expect(derived.address).toBe(expected.address);
    expect([...derived.seed]).toEqual([...seed]);
  });

  it('parses the margin event (type 17)', () => {
    const data = new Uint8Array(8 + 152);
    const view = new DataView(data.buffer);
    view.setBigUint64(0, BigInt(PERP_EVENT_MARGIN), true);
    data[8] = 3; /* action: transfer */
    data[9] = 2; /* link_cnt */
    view.setUint32(12, 4, true); /* seat_idx */
    view.setUint32(16, 6, true); /* to_seat_idx */
    view.setUint32(20, 1, true); /* account_id */
    view.setBigUint64(24, 3_880n, true); /* amount */
    data.set(key(70), 32); /* margin_account */
    data.set(key(71), 64); /* owner */
    data.set(key(72), 96); /* market */
    data.set(key(73), 128); /* to_market */
    expect(parsePerpEvent(data)).toMatchObject({
      variant: 'margin', action: 'transfer', linkCount: 2, seatIndex: 4, toSeatIndex: 6, accountId: 1, amount: 3_880n,
      marginAccount: address(70), owner: address(71), market: address(72), toMarket: address(73),
    });
  });
});
