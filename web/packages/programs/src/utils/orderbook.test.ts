import { describe, expect, it } from 'vitest';
import { Pubkey } from '@thru/sdk';
import {
  NULL_ACCOUNT_INDEX,
  ORDER_FLAG_BUY,
  ORDER_FLAG_HAS_CLIENT_ID,
  assertStatusFlags,
  bitField,
  buildModifyOrderMetadata,
  bytesFromView,
  eventSideFromValue,
  groupByPrice,
  optionalAccountIndex,
  orderFlags,
  orderTypeFromValue,
  orderTypeValue,
  pubkeyViewToAddress,
  removalReasonFromValue,
} from './orderbook';

describe('shared order-book helpers', () => {
  it('encodes order flags the way the CLOB and perp programs read them', () => {
    expect(orderFlags({ side: 'sell' })).toBe(0);
    expect(orderFlags({ side: 'buy' })).toBe(ORDER_FLAG_BUY);
    expect(orderFlags({ side: 'buy', orderType: 'ioc' })).toBe(ORDER_FLAG_BUY | (3 << 1));
    expect(orderFlags({ side: 'sell', orderType: 'alo', discardAfterMatch: true, failIfOutsideBook: true })).toBe((2 << 1) | (1 << 4) | (1 << 5));
    expect(orderFlags({ side: 'sell', clientId: new Uint8Array(16) })).toBe(ORDER_FLAG_HAS_CLIENT_ID);
    for (const type of ['gtc', 'mtl', 'alo', 'ioc', 'fok'] as const) {
      expect(orderTypeFromValue(orderTypeValue(type))).toBe(type);
    }
    expect(() => orderTypeFromValue(9)).toThrow(/unknown order type 9/);
    expect(eventSideFromValue(0)).toBe('buy');
    expect(eventSideFromValue(1)).toBe('sell');
    expect(() => eventSideFromValue(2)).toThrow(/unknown order side 2/);
    expect([0, 1, 2, 3].map(removalReasonFromValue)).toEqual(['filled', 'expired', 'evicted', 'user']);
    expect(() => removalReasonFromValue(4)).toThrow(/removal reason 4/);
    expect(assertStatusFlags(0b1111)).toBe(0b1111);
    expect(() => assertStatusFlags(0b10000)).toThrow(/statusFlags/);
  });

  it('builds the modify metadata as client id then order id', () => {
    expect(buildModifyOrderMetadata({})).toEqual(new Uint8Array(0));
    const clientId = new Uint8Array(16).fill(7);
    expect(buildModifyOrderMetadata({ clientId })).toEqual(clientId);
    const both = buildModifyOrderMetadata({ clientId, orderId: 0x0102n });
    expect(both.length).toBe(24);
    expect([...both.subarray(0, 16)]).toEqual([...clientId]);
    expect([...both.subarray(16)]).toEqual([2, 1, 0, 0, 0, 0, 0, 0]);
    expect(() => buildModifyOrderMetadata({ clientId: new Uint8Array(3) })).toThrow(/clientId/);
    expect(() => buildModifyOrderMetadata({ orderId: -1n })).toThrow(/orderId/);
  });

  it('resolves optional accounts to 0xffff when absent', () => {
    const key = new Uint8Array(32).fill(1);
    const context = { getAccountIndex: (pubkey: Uint8Array) => (pubkey[0] === 1 ? 4 : 0) };
    expect(optionalAccountIndex(context, key)).toBe(4);
    expect(optionalAccountIndex(context, undefined)).toBe(NULL_ACCOUNT_INDEX);
  });

  it('reads packed bit fields and view bytes', () => {
    const packed = 5n | (6n << 20n) | (7n << 40n) | (1n << 60n);
    expect(bitField(packed, 0n, 20n)).toBe(5);
    expect(bitField(packed, 20n, 40n)).toBe(6);
    expect(bitField(packed, 40n, 60n)).toBe(7);
    expect(bitField(packed, 60n, 64n)).toBe(1);
    const bytes = new Uint8Array(32).fill(9);
    expect(bytesFromView({ buffer: bytes })).toEqual(bytes);
    expect(bytesFromView(bytes)).not.toBe(bytes);
    expect(bytesFromView(Pubkey.from(bytes))).toEqual(bytes);
    expect(pubkeyViewToAddress({ buffer: bytes })).toBe(Pubkey.from(bytes).toThruFmt());
    expect(() => bytesFromView({})).toThrow(/byte buffer/);
  });

  it('groups orders by price, best first, dropping empty ones', () => {
    const order = (priceInTicks: bigint, quantityInLots: bigint, id: number) => ({ priceInTicks, quantityInLots, id });
    const orders = [order(10n, 1n, 1), order(12n, 2n, 2), order(10n, 3n, 3), order(11n, 0n, 4)];
    const bids = groupByPrice(orders, 'buy');
    expect(bids.map((level) => [level.priceInTicks, level.quantityInLots, level.orders.map((o) => o.id)])).toEqual([
      [12n, 2n, [2]],
      [10n, 4n, [1, 3]],
    ]);
    expect(bids.every((level) => level.side === 'buy')).toBe(true);
    const asks = groupByPrice(orders, 'sell');
    expect(asks.map((level) => level.priceInTicks)).toEqual([10n, 12n]);
  });
});
