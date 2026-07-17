import { describe, expect, it } from 'vitest';
import { encodeAddress } from '@thru/sdk/helpers';
import {
  CLOB_INSTRUCTION_CREATE_ORDER_ENTRY,
  CLOB_INSTRUCTION_CREATE_SEATLESS_ORDER_ENTRY,
  CLOB_CBOOK_MAX_PRICE_IN_TICKS,
  CLOB_EVENT_SIDE_BUY,
  CLOB_ORDER_FLAG_BUY,
  CLOB_ORDER_FLAG_HAS_CLIENT_ID,
  CLOB_ORDER_TYPE_FOK,
  CLOB_ORDER_TYPE_GTC,
  CLOB_ORDER_TYPE_IOC,
  CLOB_ORDER_TYPE_MTL,
  ClobEventBuilder,
  MarketAccountBuilder,
  MarketCreatedEventBuilder,
  OrderEntryBuilder,
  OrderFilledEventBuilder,
  SeatEntryBuilder,
  buildOrderBookSnapshot,
  createOrderEntryInstruction,
  createSeatlessOrderEntryInstruction,
  encodeOrderFlags,
  parseClobEvent,
  parseMarketAccount,
  parseOrderArenaAccount,
  parseSeatArenaAccount,
} from './index';

function key(id: number): Uint8Array {
  const bytes = new Uint8Array(32);
  bytes[0] = id;
  return bytes;
}

function context(indexes: Record<string, number>) {
  return {
    getAccountIndex(pubkey: Uint8Array): number {
      const index = indexes[bytesToHex(pubkey)];
      if (index === undefined) throw new Error(`missing account ${bytesToHex(pubkey)}`);
      return index;
    },
  };
}

describe('clob helpers', () => {
  it('encodes order flags with C program bit semantics', () => {
    expect(encodeOrderFlags({ side: 'buy', orderType: 'gtc' })).toBe(
      CLOB_ORDER_FLAG_BUY | (CLOB_ORDER_TYPE_GTC << 1)
    );
    expect(encodeOrderFlags({ side: 'sell', orderType: 'mtl' })).toBe(CLOB_ORDER_TYPE_MTL << 1);
    expect(encodeOrderFlags({ side: 'buy', orderType: 'fok', clientId: new Uint8Array(16) })).toBe(
      CLOB_ORDER_FLAG_BUY | (CLOB_ORDER_TYPE_FOK << 1) | CLOB_ORDER_FLAG_HAS_CLIENT_ID
    );
  });

  it('packs create order entry instructions for the CLOB envelope', async () => {
    const clientId = new Uint8Array(16).fill(0xab);
    const instruction = await createOrderEntryInstruction({
      marketRecordIndex: 2,
      side: 'buy',
      orderType: 'gtc',
      price: 123n,
      quantity: 456n,
      expirationTime: 789n,
      clientId,
    })(context({}));

    expect(instruction[0]).toBe(CLOB_INSTRUCTION_CREATE_ORDER_ENTRY);
    expect(instruction[1]).toBe(CLOB_ORDER_FLAG_BUY | CLOB_ORDER_FLAG_HAS_CLIENT_ID);
    expect(instruction[2]).toBe(2);
    expect(new DataView(instruction.buffer).getBigUint64(8, true)).toBe(123n);
    expect(new DataView(instruction.buffer).getBigUint64(16, true)).toBe(456n);
    expect(new DataView(instruction.buffer).getBigInt64(24, true)).toBe(789n);
    expect(instruction.slice(32)).toEqual(clientId);
  });

  it('packs seatless order instructions with wallet account indexes', async () => {
    const quote = key(1);
    const base = key(2);
    const instruction = await createSeatlessOrderEntryInstruction({
      marketRecordIndex: 3,
      side: 'sell',
      orderType: 'ioc',
      price: 10n,
      quantity: 20n,
      quoteWalletBytes: quote,
      baseWalletBytes: base,
    })(context({
      [bytesToHex(quote)]: 5,
      [bytesToHex(base)]: 6,
    }));

    expect(instruction[0]).toBe(CLOB_INSTRUCTION_CREATE_SEATLESS_ORDER_ENTRY);
    expect(instruction[1]).toBe(CLOB_ORDER_TYPE_IOC << 1);
    expect(instruction[2]).toBe(3);
    expect(new DataView(instruction.buffer).getUint16(24, true)).toBe(5);
    expect(new DataView(instruction.buffer).getUint16(26, true)).toBe(6);
  });

  it('parses market accounts into frontend-oriented addresses', () => {
    const data = new MarketAccountBuilder()
      .set_magic(0xc1)
      .set_status_flags(3)
      .set_reserved0([0, 0, 0, 0, 0, 0])
      .set_lot_size(100n)
      .set_tick_size(5n)
      .set_next_order_id(42n)
      .set_order_entry_pubkey(key(10))
      .set_bids_cbook_pubkey(key(11))
      .set_asks_cbook_pubkey(key(12))
      .set_token_program_pubkey(key(16))
      .set_base_vault_pubkey(key(13))
      .set_quote_vault_pubkey(key(14))
      .set_market_authority_pubkey(key(15))
      .build();

    const market = parseMarketAccount(data);
    expect(market.magic).toBe(0xc1);
    expect(market.statusFlags).toBe(3);
    expect(market.lotSize).toBe(100n);
    expect(market.tickSize).toBe(5n);
    expect(market.nextOrderId).toBe(42n);
    expect(market.bidsCbook).not.toBe(market.asksCbook);
    expect(market.tokenProgram).toBe(bytesToAddress(key(16)));
  });

  it('parses order arenas and groups active orderbook depth', () => {
    const data = new Uint8Array(72 + 3 * 64);
    new DataView(data.buffer).setUint32(60, 2, true);
    new OrderEntryBuilder()
      .set_seat_ptrs(2n << 40n)
      .set_level_ptrs(7n << 40n)
      .set_qty_in_lots(10n)
      .set_order_id(100n)
      .set_reserved0([0, 0, 0, 0, 0, 0, 0, 0])
      .set_client_id(new Uint8Array(16).fill(1))
      .set_expiry(99n)
      .buildInto(data, 72);
    new OrderEntryBuilder()
      .set_seat_ptrs(9n << 40n)
      .set_level_ptrs(7n << 40n)
      .set_qty_in_lots(999n)
      .set_order_id(999n)
      .set_reserved0([0, 0, 0, 0, 0, 0, 0, 0])
      .set_client_id(new Uint8Array(16).fill(9))
      .set_expiry(0n)
      .buildInto(data, 136);
    new OrderEntryBuilder()
      .set_seat_ptrs(3n << 40n)
      .set_level_ptrs(7n << 40n)
      .set_qty_in_lots(15n)
      .set_order_id(101n)
      .set_reserved0([0, 0, 0, 0, 0, 0, 0, 0])
      .set_client_id(new Uint8Array(16).fill(2))
      .set_expiry(100n)
      .buildInto(data, 200);

    const arena = parseOrderArenaAccount(data);
    expect(arena.slots).toHaveLength(3);
    expect(arena.slots.map((slot) => slot.active)).toEqual([true, false, true]);
    expect(arena.orders).toHaveLength(2);
    expect(arena.orders[0].seatIndex).toBe(2);

    const snapshot = buildOrderBookSnapshot({
      bids: arena.orders,
      asks: [],
      bidsCbook: {
        bestLevelIndex: 5,
        bestPriceInTicks: CLOB_CBOOK_MAX_PRICE_IN_TICKS - 52n,
        levels: Array.from({ length: 10 }, (_, levelIndex) => ({
          levelIndex,
          headOrderEntryIndex: 0,
          tailOrderEntryIndex: 0,
        })),
      },
    });
    expect(snapshot.bestBid?.priceInTicks).toBe(50n);
    expect(snapshot.bestBid?.quantityInLots).toBe(25n);
    expect(snapshot.bestAsk).toBeNull();
  });

  it('parses seat arenas without treating the reserved seatless slot as a user seat', () => {
    const data = new Uint8Array(320 + 3 * 64);
    new SeatEntryBuilder()
      .set_seat_authority_pubkey(key(1))
      .set_quantity_base(111n)
      .set_quantity_quote(222n)
      .set_head_order_entry_idx(0)
      .set_reserved0(0)
      .set_non_nullable_reserved(1n)
      .buildInto(data, 320);
    new SeatEntryBuilder()
      .set_seat_authority_pubkey(key(2))
      .set_quantity_base(333n)
      .set_quantity_quote(444n)
      .set_head_order_entry_idx(5)
      .set_reserved0(0)
      .set_non_nullable_reserved(1n)
      .buildInto(data, 384);

    const arena = parseSeatArenaAccount(data);
    expect(arena.slots).toHaveLength(3);
    expect(arena.slots.map((slot) => slot.active)).toEqual([true, true, false]);
    expect(arena.seatlessSeat?.index).toBe(1);
    expect(arena.seats).toHaveLength(1);
    expect(arena.seats[0].seatIndex).toBe(2);
  });


  it('parses market created events into indexer-friendly fields', () => {
    const payload = new MarketCreatedEventBuilder()
      .set_lot_size(100n)
      .set_tick_size(5n)
      .set_base_mint(key(1))
      .set_quote_mint(key(2))
      .set_market_authority(key(3))
      .set_market(key(4))
      .set_order_arena(key(5))
      .set_bids_cbook(key(6))
      .set_asks_cbook(key(7))
      .set_base_vault(key(8))
      .set_quote_vault(key(9))
      .build();
    const builder = new ClobEventBuilder();
    builder.payload().select('market_created').writePayload(payload).finish();

    const event = parseClobEvent(builder.build());
    expect(event.variant).toBe('market_created');
    if (event.variant !== 'market_created') throw new Error('expected market_created');
    expect(event.lotSize).toBe(100n);
    expect(event.tickSize).toBe(5n);
    expect(event.baseMint).toBe(bytesToAddress(key(1)));
    expect(event.quoteMint).toBe(bytesToAddress(key(2)));
    expect(event.market).toBe(bytesToAddress(key(4)));
    expect(event.orderArena).toBe(bytesToAddress(key(5)));
  });

  it('parses order filled events into trade fields', () => {
    const clientId = new Uint8Array(16).fill(0xcd);
    const payload = new OrderFilledEventBuilder()
      .set_taker_seat_idx(2)
      .set_maker_seat_idx(3)
      .set_taker_side(CLOB_EVENT_SIDE_BUY)
      .set_reserved0([0, 0, 0])
      .set_price(123n)
      .set_qty(456n)
      .set_maker_order_id(789n)
      .set_maker_client_id(clientId)
      .set_market(key(10))
      .set_taker_seat_authority(key(11))
      .set_maker_seat_authority(key(12))
      .build();
    const builder = new ClobEventBuilder();
    builder.payload().select('order_filled').writePayload(payload).finish();

    const event = parseClobEvent(builder.build());
    expect(event.variant).toBe('order_filled');
    if (event.variant !== 'order_filled') throw new Error('expected order_filled');
    expect(event.takerSeatIndex).toBe(2);
    expect(event.makerSeatIndex).toBe(3);
    expect(event.takerSide).toBe('buy');
    expect(event.price).toBe(123n);
    expect(event.quantity).toBe(456n);
    expect(event.makerOrderId).toBe(789n);
    expect(event.makerClientId).toEqual(clientId);
    expect(event.market).toBe(bytesToAddress(key(10)));
  });
});

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function bytesToAddress(bytes: Uint8Array): string {
  return encodeAddress(bytes);
}
