import { describe, expect, it } from 'vitest';
import { Pubkey } from '@thru/sdk';
import {
  FeeClaimInstructionBuilder,
  MarketSetFeesInstructionBuilder,
  PERP_EVENT_FEE,
  PERP_EVENT_INSURANCE,
  PERP_EVENT_INSURANCE_LIQUIDATION,
  PERP_FEE_INCREASE_DELAY_NS,
  PERP_FEE_MAX_PPM,
  PERP_INSTRUCTION_FEE_CLAIM,
  PERP_INSTRUCTION_MARKET_RECORD,
  PERP_INSTRUCTION_MARKET_SET_FEES,
  PERP_INSTRUCTION_SEAT_SET_BUILDER_APPROVAL,
  PERP_INSTRUCTION_SEAT_SET_FEE_RECEIVER,
  PERP_PPM_DENOMINATOR,
  PERP_SEAT_FLAG_FEE,
  PerpInstruction,
  PerpInstructionBuilder,
  SeatSetBuilderApprovalInstructionBuilder,
  SeatSetFeeReceiverInstructionBuilder,
  createPerpFeeClaimInstruction,
  createPerpMarketRecordInstruction,
  createPerpMarketSetFeesInstruction,
  createPerpSeatSetBuilderApprovalInstruction,
  createPerpSeatSetFeeReceiverInstruction,
  parsePerpEvent,
  perpCeilPpm,
  perpEffectiveFeeRates,
  perpFeeParamsProblem,
  perpFeePerLot,
  perpFeesAfterSet,
  perpFloorPpm,
  perpMakerBuilderFee,
  perpMaxBuyLots,
  perpMaxSellLots,
  perpQuoteTakerFees,
  perpSeatBuilderApproval,
  perpSeatIsFeeReceiver,
  type PerpFeeParams,
  type PerpMarginMarket,
  type PerpMarginSeat,
  type PerpMarketFees,
} from './index';
import {
  encodePerpInstruction,
  feeClaimTx,
  marketSetFeesTx,
  ordersTx,
  perpTransactionFromJSON,
  perpTransactionToJSON,
  seatSetBuilderApprovalTx,
  seatSetFeeReceiverTx,
  type MarketRef,
} from './sdk';
import { PERP_ABI_V0_4, PERP_ABI_V0_5 } from './versions';

/* Trading fees and builder codes (0.5.0): thru-perps/PLAN-FEES.md,
   tn_perp_program/utils/fees.h and tests/test_txn_perp_program/test_fees.c. */

function key(id: number): Uint8Array {
  const bytes = new Uint8Array(32);
  bytes[0] = id;
  bytes[31] = 0xa0 + id;
  return bytes;
}
const address = (id: number) => Pubkey.from(key(id)).toThruFmt();

function context(indexes: Array<[Uint8Array, number]>) {
  return {
    getAccountIndex(pubkey: Uint8Array) {
      const hit = indexes.find(([candidate]) => candidate.every((byte, i) => byte === pubkey[i]));
      if (!hit) throw new Error('account not in the transaction');
      return hit[1];
    },
  };
}

/** What the generated builders produce for a payload of `variant`. */
function generated(variant: string, payload: Uint8Array): Uint8Array {
  const builder = new PerpInstructionBuilder();
  builder.payload().select(variant as never).writePayload(payload).finish();
  return builder.build();
}

const RATES: PerpFeeParams = { takerFeePpm: 300, makerRebatePpm: 100, builderFeeCapPpm: 0, feeInsuranceSharePpm: 250_000, liqInsuranceSharePpm: 0 };

describe('perp fee math', () => {
  it('rounds ppm like perp_floor_ppm / perp_ceil_ppm', () => {
    expect(PERP_PPM_DENOMINATOR).toBe(1_000_000n);
    expect(perpFloorPpm(194_000n, 300)).toBe(58n);
    expect(perpCeilPpm(194_000n, 300)).toBe(59n);
    expect(perpCeilPpm(1_000_000n, 300)).toBe(300n);
    expect(perpCeilPpm(0n, 300)).toBe(0n);
    expect(perpFloorPpm(60n, 250_000)).toBe(15n);
  });

  it('quotes the taker fee telescoped, the rebates per fill and the protocol split (test_fees.c)', () => {
    /* taker 300 ppm, rebate 100, 25% to insurance; fills of 194,000 and
       97,970: ceil(58.2) = 59, then ceil(87.591) - 59 = 29. */
    const quote = perpQuoteTakerFees(RATES, [194_000n, 97_970n]);
    expect(quote.fills.map((fill) => fill.takerFee)).toEqual([59n, 29n]);
    expect(quote.fills.map((fill) => fill.makerRebate)).toEqual([19n, 9n]);
    expect(quote).toMatchObject({
      notional: 291_970n, takerFee: 88n, makerRebates: 28n, insurance: 15n, protocolFee: 45n, builderFee: 0n, total: 88n,
    });
    expect(quote.insurance + quote.protocolFee).toBe(60n);
    /* The total does not depend on the split: one fill of the same notional. */
    expect(perpQuoteTakerFees(RATES, [291_970n]).takerFee).toBe(88n);
  });

  it('charges 10 ppm on three 19,400 fills one atom in total', () => {
    const quote = perpQuoteTakerFees({ ...RATES, takerFeePpm: 10, makerRebatePpm: 0 }, [19_400n, 19_400n, 19_400n]);
    expect(quote.fills.map((fill) => fill.takerFee)).toEqual([1n, 0n, 0n]);
    expect(quote.takerFee).toBe(1n);
  });

  it('floors the builder fee of the cumulative notional, at most the market cap', () => {
    const rates = { ...RATES, builderFeeCapPpm: 40 };
    const quote = perpQuoteTakerFees(rates, [30_000n, 30_000n], 100);
    expect(quote.builderFeePpm).toBe(40);
    /* floor(1.2) = 1, floor(2.4) - 1 = 1 */
    expect(quote.fills.map((fill) => fill.builderFee)).toEqual([1n, 1n]);
    expect(quote.builderFee).toBe(2n);
    expect(quote.total).toBe(quote.takerFee + 2n);
    expect(perpQuoteTakerFees(rates, [30_000n], 0).builderFee).toBe(0n);
    expect(perpQuoteTakerFees({ ...rates, builderFeeCapPpm: 0 }, [30_000n], 100).builderFee).toBe(0n);
  });

  it('applies a pending increase once due', () => {
    const fees: PerpMarketFees = { ...RATES, pendingTakerFeePpm: 500, pendingBuilderFeeCapPpm: 20, pendingActivationNs: 1_000n };
    expect(perpEffectiveFeeRates({ fees }, 999n)).toMatchObject({ takerFeePpm: 300, builderFeeCapPpm: 0 });
    expect(perpEffectiveFeeRates({ fees }, 1_000n)).toMatchObject({ takerFeePpm: 500, builderFeeCapPpm: 20, makerRebatePpm: 100 });
    expect(perpEffectiveFeeRates({}, 0n)).toEqual({ takerFeePpm: 0, makerRebatePpm: 0, builderFeeCapPpm: 0, feeInsuranceSharePpm: 0, liqInsuranceSharePpm: 0 });
  });

  it('validates and applies market_set_fees like fee_params_valid / fee_set', () => {
    expect(perpFeeParamsProblem(RATES)).toBeNull();
    expect(perpFeeParamsProblem({ ...RATES, takerFeePpm: PERP_FEE_MAX_PPM + 1 })).toMatch(/takerFeePpm/);
    expect(perpFeeParamsProblem({ ...RATES, builderFeeCapPpm: PERP_FEE_MAX_PPM + 1 })).toMatch(/builderFeeCapPpm/);
    expect(perpFeeParamsProblem({ ...RATES, makerRebatePpm: 301 })).toMatch(/makerRebatePpm/);
    expect(perpFeeParamsProblem({ ...RATES, feeInsuranceSharePpm: 1_000_001 })).toMatch(/feeInsuranceSharePpm/);

    /* From zero: an increase is pending for the delay; the rebate must fit
       the taker fee in effect, so it is refused until the fee applies. */
    const now = 5_000n;
    expect(perpFeesAfterSet(undefined, now, RATES)).toBeNull();
    const pending = perpFeesAfterSet(undefined, now, { ...RATES, makerRebatePpm: 0, builderFeeCapPpm: 50 })!;
    expect(pending).toEqual({
      takerFeePpm: 0, makerRebatePpm: 0, builderFeeCapPpm: 0, feeInsuranceSharePpm: 250_000, liqInsuranceSharePpm: 0,
      pendingTakerFeePpm: 300, pendingBuilderFeeCapPpm: 50, pendingActivationNs: now + PERP_FEE_INCREASE_DELAY_NS,
    });
    /* After the delay the increase is in effect; a decrease applies at once
       and drops nothing else. */
    const later = now + PERP_FEE_INCREASE_DELAY_NS;
    expect(perpEffectiveFeeRates({ fees: pending }, later)).toMatchObject({ takerFeePpm: 300, builderFeeCapPpm: 50 });
    const lowered = perpFeesAfterSet(pending, later, { ...RATES, takerFeePpm: 200, builderFeeCapPpm: 50 })!;
    expect(lowered).toMatchObject({ takerFeePpm: 200, makerRebatePpm: 100, builderFeeCapPpm: 50, pendingTakerFeePpm: 0, pendingBuilderFeeCapPpm: 0, pendingActivationNs: 0n });
    /* Before the delay: a rate at or below the one in effect cancels its
       pending increase; a request that still raises a rate restarts the
       delay. */
    expect(perpFeesAfterSet(pending, now + 1n, { ...RATES, takerFeePpm: 0, makerRebatePpm: 0, builderFeeCapPpm: 50 })).toMatchObject({
      takerFeePpm: 0, pendingTakerFeePpm: 0, pendingBuilderFeeCapPpm: 50, pendingActivationNs: now + 1n + PERP_FEE_INCREASE_DELAY_NS,
    });
    expect(perpFeesAfterSet(pending, now + 1n, { ...RATES, takerFeePpm: 0, makerRebatePpm: 0, builderFeeCapPpm: 0 })).toMatchObject({
      pendingTakerFeePpm: 0, pendingBuilderFeeCapPpm: 0, pendingActivationNs: 0n,
    });
  });

  it('bounds taker capacity by the fee per lot (seat_open_capacity_lots); 0 is the bound without fees', () => {
    const market: PerpMarginMarket = { lotSize: 1n, priceCap: 200_000_000n, maxPositionLots: 1_000_000n, initialMarginBps: 500, maintenanceMarginBps: 250, liquidationFeeBps: 100 };
    const flat: PerpMarginSeat = { quantityQuote: 1_000_000n, longLots: 0n, shortLots: 0n, openBidLots: 0n, openAskLots: 0n, entryNotional: 0n, openBidNotional: 0n, openAskNotional: 0n };
    const price = 100_000n;
    /* margin 5,000 a lot; fee ceil(100,000 * 300 / 1e6) = 30 */
    expect(perpFeePerLot(market, price, 300)).toBe(30n);
    expect(perpFeePerLot(market, price, 300, 50)).toBe(35n);
    expect(perpFeePerLot(market, price, 0, 0)).toBe(0n);
    expect(perpMaxBuyLots(market, flat, price, price)).toBe(200n);
    expect(perpMaxBuyLots(market, flat, price, price, 0n)).toBe(200n);
    expect(perpMaxBuyLots(market, flat, price, price, 30n)).toBe(198n); /* 1,000,000 / 5,030 */
    expect(perpMaxBuyLots(market, flat, price, price, 35n)).toBe(198n);
    /* Short 10 at 100,000: free 950,000.  The 10 closing lots' fees come
       out of free first: (950,000 - 300) / 5,030 = 188 opened. */
    const short: PerpMarginSeat = { ...flat, shortLots: 10n, entryNotional: 1_000_000n };
    expect(perpMaxBuyLots(market, short, price, price)).toBe(200n);
    expect(perpMaxBuyLots(market, short, price, price, 30n)).toBe(198n);
    expect(perpMaxSellLots(market, short, price, price)).toBe(190n);
    expect(perpMaxSellLots(market, short, price, price, 30n)).toBe(188n);
  });

  it('charges a maker the builder its seat approves, at the lowest of the three rates', () => {
    const order = { builder: { builderSeatIndex: 7, feePpm: 30 } };
    const approved = { builderApproval: { builderSeatIndex: 7, maxFeePpm: 20 } };
    expect(perpMakerBuilderFee(order, approved, { builderFeeCapPpm: 50 }, 100_000n)).toBe(2n);
    expect(perpMakerBuilderFee(order, approved, { builderFeeCapPpm: 10 }, 100_000n)).toBe(1n);
    expect(perpMakerBuilderFee(order, { builderApproval: { builderSeatIndex: 8, maxFeePpm: 20 } }, { builderFeeCapPpm: 50 }, 100_000n)).toBe(0n);
    expect(perpMakerBuilderFee(order, {}, { builderFeeCapPpm: 50 }, 100_000n)).toBe(0n);
    expect(perpMakerBuilderFee({}, approved, { builderFeeCapPpm: 50 }, 100_000n)).toBe(0n);
  });

  it('reads the fee seat flag and the builder approval from seat flags', () => {
    expect(PERP_SEAT_FLAG_FEE).toBe(4n);
    expect(perpSeatIsFeeReceiver(1n | 4n)).toBe(true);
    expect(perpSeatIsFeeReceiver(3n)).toBe(false);
    expect(perpSeatBuilderApproval(1n)).toBeUndefined();
    expect(perpSeatBuilderApproval(1n | (10_000n << 8n) | (0xffffen << 22n))).toEqual({ builderSeatIndex: 0xffffe, maxFeePpm: 10_000 });
  });
});

describe('perp fee events', () => {
  it('parses the FEE event (type 18) with its fill maps', () => {
    const data = new Uint8Array(8 + 176);
    const view = new DataView(data.buffer);
    view.setBigUint64(0, BigInt(PERP_EVENT_FEE), true);
    data.set(key(40), 8); /* market */
    view.setUint32(40, 3, true); /* seat_idx */
    view.setUint32(44, 9, true); /* builder_seat_idx */
    data[48] = 0; /* kind: trade */
    data[49] = 66; /* fill_cnt */
    view.setUint32(52, 300, true); /* taker_fee_ppm */
    view.setUint32(56, 100, true); /* maker_rebate_ppm */
    view.setUint32(60, 40, true); /* builder_fee_ppm */
    const amounts = [291_970n, 88n, 0n, 28n, 11n, 0n, 2n, 45n, 15n, 1_045n, 9_015n];
    amounts.forEach((amount, i) => view.setBigUint64(64 + i * 8, amount, true));
    view.setBigUint64(152, (1n << 1n) | (1n << 63n), true); /* waived_map[0] */
    view.setBigUint64(160, 1n << 1n, true); /* waived_map[1]: fill 65 */
    view.setBigUint64(168, 1n, true); /* maker_fee_map[0] */
    expect(parsePerpEvent(data)).toMatchObject({
      variant: 'fee',
      market: address(40),
      kind: 'trade',
      fillCount: 66,
      seatIndex: 3,
      builderSeatIndex: 9,
      takerFeePpm: 300,
      makerRebatePpm: 100,
      builderFeePpm: 40,
      notional: 291_970n,
      takerFee: 88n,
      takerFeeWaived: 0n,
      makerRebates: 28n,
      builderFee: 11n,
      builderFeeWaived: 0n,
      makerBuilderFees: 2n,
      protocolFee: 45n,
      insurance: 15n,
      feeBalance: 1_045n,
      insuranceBalance: 9_015n,
      waivedFills: [1, 63, 65],
      makerBuilderFeeFills: [0],
    });
    data[48] = 1;
    data[49] = 0;
    expect(parsePerpEvent(data)).toMatchObject({ variant: 'fee', kind: 'claim', fillCount: 0 });
    data[48] = 2;
    expect(() => parsePerpEvent(data)).toThrow('unknown perp fee kind 2');
  });

  it('parses the insurance share of a liquidation fee (INSURANCE kind 1)', () => {
    const data = new Uint8Array(8 + 56);
    const view = new DataView(data.buffer);
    view.setBigUint64(0, BigInt(PERP_EVENT_INSURANCE), true);
    view.setBigUint64(40, 4_050_000n, true); /* amount */
    view.setBigUint64(48, 9_000_000n, true); /* balance_after */
    view.setUint32(56, 2, true); /* seat_idx: the liquidator */
    data[60] = PERP_EVENT_INSURANCE_LIQUIDATION;
    expect(parsePerpEvent(data)).toMatchObject({ variant: 'insurance', kind: 'liquidation', amount: 4_050_000n, balanceAfter: 9_000_000n, seatIndex: 2 });
  });
});

describe('perp fee instruction builders', () => {
  const seatArena = key(21);
  const orderArena = key(22);
  const bids = key(23);
  const asks = key(24);
  const exchangeMeta = key(25);
  const authority = key(26);
  const ctx = context([[seatArena, 1], [orderArena, 2], [bids, 3], [asks, 4], [exchangeMeta, 5], [authority, 6]]);
  const record = {
    marketRecordIndex: 1,
    seatArenaAccountBytes: seatArena,
    orderArenaAccountBytes: orderArena,
    bidsCbookAccountBytes: bids,
    asksCbookAccountBytes: asks,
    seatAuthorityAccountBytes: authority,
    seatIndex: 3,
    exchangeMetaAccountBytes: exchangeMeta,
  };

  it('market record carries the builder code at offsets 26 and 28', async () => {
    const bytes = await createPerpMarketRecordInstruction({ ...record, builderSeatIndex: 9, builderFeePpm: 40 })(ctx);
    expect(bytes.length).toBe(32);
    expect(bytes[0]).toBe(PERP_INSTRUCTION_MARKET_RECORD);
    const view = new DataView(bytes.buffer, bytes.byteOffset);
    expect(view.getUint16(26, true)).toBe(9);
    expect(view.getUint16(28, true)).toBe(40);
    const decoded = PerpInstruction.from_array(bytes)!.payload().asMarketRecord()!;
    expect([decoded.get_builder_seat_idx(), decoded.get_builder_fee_ppm(), decoded.get_seat_idx()]).toEqual([9, 40, 3]);
    /* No builder: the bytes the record had before fees. */
    expect([...(await createPerpMarketRecordInstruction(record)(ctx)).subarray(26)]).toEqual([0, 0, 0, 0, 0, 0]);
    expect(() => createPerpMarketRecordInstruction({ ...record, builderFeePpm: 5 })).toThrow(/needs a builderSeatIndex/);
    expect(() => createPerpMarketRecordInstruction({ ...record, builderSeatIndex: 9, builderFeePpm: PERP_FEE_MAX_PPM + 1 })).toThrow(/builderFeePpm/);
    expect(() => createPerpMarketRecordInstruction({ ...record, builderSeatIndex: 0x10000 })).toThrow(/65535/);
    expect(() => createPerpMarketRecordInstruction({ ...record, seatIndex: undefined, builderSeatIndex: 9 })).toThrow(/needs the seat/);
  });

  it('market set fees is 24 bytes and matches the generated builder', async () => {
    const bytes = await createPerpMarketSetFeesInstruction({ marketRecordIndex: 1, ...RATES, builderFeeCapPpm: 50, liqInsuranceSharePpm: 500_000 })(ctx);
    expect(bytes.length).toBe(24);
    expect([...bytes.subarray(0, 4)]).toEqual([PERP_INSTRUCTION_MARKET_SET_FEES, 1, 0, 0]);
    const view = new DataView(bytes.buffer, bytes.byteOffset);
    expect([4, 8, 12, 16, 20].map((offset) => view.getUint32(offset, true))).toEqual([300, 100, 50, 250_000, 500_000]);
    const payload = new MarketSetFeesInstructionBuilder()
      .set_market_record_idx(1).set_reserved0(0).set_taker_fee_ppm(300).set_maker_rebate_ppm(100)
      .set_builder_fee_cap_ppm(50).set_fee_insurance_share_ppm(250_000).set_liq_insurance_share_ppm(500_000).build();
    expect([...bytes]).toEqual([...generated('market_set_fees', payload)]);
    expect(PerpInstruction.from_array(bytes)!.payload().asMarketSetFees()!.get_liq_insurance_share_ppm()).toBe(500_000);
    expect(() => createPerpMarketSetFeesInstruction({ marketRecordIndex: 1, ...RATES, makerRebatePpm: 301 })).toThrow(/makerRebatePpm/);
  });

  it('fee claim is 16 bytes with the amount at offset 8', async () => {
    const bytes = await createPerpFeeClaimInstruction({ marketRecordIndex: 2, amount: 45n })(ctx);
    expect([...bytes.subarray(0, 8)]).toEqual([PERP_INSTRUCTION_FEE_CLAIM, 2, 0, 0, 0, 0, 0, 0]);
    expect(new DataView(bytes.buffer, bytes.byteOffset).getBigUint64(8, true)).toBe(45n);
    const payload = new FeeClaimInstructionBuilder().set_market_record_idx(2).set_reserved0(0).set_reserved1(0).set_amount(45n).build();
    expect([...bytes]).toEqual([...generated('fee_claim', payload)]);
    expect(() => createPerpFeeClaimInstruction({ marketRecordIndex: 2, amount: 0n })).toThrow(/positive/);
  });

  it('seat set fee receiver and builder approval are 8 bytes', async () => {
    const receiver = await createPerpSeatSetFeeReceiverInstruction({ marketRecordIndex: 1 })(ctx);
    expect([...receiver]).toEqual([PERP_INSTRUCTION_SEAT_SET_FEE_RECEIVER, 1, 0, 0, 0, 0, 0, 0]);
    expect([...receiver]).toEqual([...generated('seat_set_fee_receiver', new SeatSetFeeReceiverInstructionBuilder().set_market_record_idx(1).set_reserved0(0).set_reserved1(0).build())]);
    const approval = await createPerpSeatSetBuilderApprovalInstruction({ marketRecordIndex: 1, builderSeatIndex: 0x12345, maxFeePpm: 10_000 })(ctx);
    expect([...approval]).toEqual([PERP_INSTRUCTION_SEAT_SET_BUILDER_APPROVAL, 1, 0x10, 0x27, 0x45, 0x23, 0x01, 0]);
    expect([...approval]).toEqual([
      ...generated('seat_set_builder_approval', new SeatSetBuilderApprovalInstructionBuilder().set_market_record_idx(1).set_max_fee_ppm(10_000).set_builder_seat_idx(0x12345).build()),
    ]);
    expect([...(await createPerpSeatSetBuilderApprovalInstruction({ marketRecordIndex: 1, builderSeatIndex: 0, maxFeePpm: 0 })(ctx))]).toEqual([
      PERP_INSTRUCTION_SEAT_SET_BUILDER_APPROVAL, 1, 0, 0, 0, 0, 0, 0,
    ]);
    expect(() => createPerpSeatSetBuilderApprovalInstruction({ marketRecordIndex: 1, builderSeatIndex: 0, maxFeePpm: 5 })).toThrow(/revocation/);
    expect(() => createPerpSeatSetBuilderApprovalInstruction({ marketRecordIndex: 1, builderSeatIndex: 4, maxFeePpm: 0 })).toThrow(/positive/);
    expect(() => createPerpSeatSetBuilderApprovalInstruction({ marketRecordIndex: 1, builderSeatIndex: 4, maxFeePpm: 10_001 })).toThrow(/maxFeePpm/);
  });
});

describe('perp fee transactions', () => {
  const ref: MarketRef = {
    deployment: { exchangeMeta: address(1), tokenProgram: address(2) },
    market: { seatArena: address(3), orderArena: address(4), bidsCbook: address(5), asksCbook: address(6), quoteVault: address(7), oracleFeed: address(8) },
  };
  const trader = address(10);
  const admin = address(11);

  it('puts the builder code in the order record and refuses it before 0.5.0', () => {
    const order = { side: 'buy' as const, price: 100_000n, quantity: 2n };
    const tx = ordersTx(ref, trader, 3, [order], [], undefined, { builder: { builderSeatIndex: 9, feePpm: 40 }, version: PERP_ABI_V0_5 });
    expect(tx.instructions[0]).toMatchObject({ ix: 'market_record', seatIndex: 3, builderSeatIndex: 9, builderFeePpm: 40 });
    expect(perpTransactionFromJSON(JSON.parse(JSON.stringify(perpTransactionToJSON(tx)))).instructions).toEqual(tx.instructions);
    expect('builderSeatIndex' in ordersTx(ref, trader, 3, [order]).instructions[0]!).toBe(false);
    expect(() => ordersTx(ref, trader, 3, [order], [], undefined, { builder: { builderSeatIndex: 9, feePpm: 40 }, version: PERP_ABI_V0_4 })).toThrow(/tradingFees/);
  });

  it('builds the fee administration and seat transactions', async () => {
    const setFees = marketSetFeesTx(ref, admin, RATES);
    expect(setFees.instructions.map((spec) => spec.ix)).toEqual(['market_record', 'market_set_fees']);
    expect(setFees.instructions[0]).toMatchObject({ marketAuthority: admin });
    const claim = feeClaimTx(ref, admin, 3, 45n);
    expect(claim.instructions[0]).toMatchObject({ marketAuthority: admin, seatAuthority: admin, seatIndex: 3 });
    expect(claim.instructions[1]).toEqual({ ix: 'fee_claim', marketRecordIndex: 1, amount: '45' });
    expect(claim.readWrite).toContain(ref.market.seatArena);
    expect(seatSetFeeReceiverTx(ref, trader, 4).instructions[1]).toEqual({ ix: 'seat_set_fee_receiver', marketRecordIndex: 1 });
    expect(seatSetBuilderApprovalTx(ref, trader, 3, { builderSeatIndex: 4, maxFeePpm: 20 }).instructions[1]).toEqual({
      ix: 'seat_set_builder_approval', marketRecordIndex: 1, builderSeatIndex: 4, maxFeePpm: 20,
    });
    expect(seatSetBuilderApprovalTx(ref, trader, 3, { builderSeatIndex: 0, maxFeePpm: 0 }).label).toBe('revoke builder approval');
    expect(() => marketSetFeesTx(ref, admin, RATES, { version: PERP_ABI_V0_4 })).toThrow(/tradingFees/);
    /* The specs encode as the createPerp* encoders do. */
    const spec = setFees.instructions[1]!;
    expect([...(await encodePerpInstruction(spec)({ getAccountIndex: () => 0 }))]).toEqual([
      ...(await createPerpMarketSetFeesInstruction({ marketRecordIndex: 1, ...RATES })({ getAccountIndex: () => 0 })),
    ]);
  });
});
