import { Pubkey } from '@thru/sdk';
import { encodeAddress } from '@thru/sdk/helpers';
import { accountIndex, type AccountLookupContext } from './helpers';

/* Order-book primitives shared by the spot CLOB and the perp program, which
   keeps the CLOB's book, instruction flags, event codes and arena entry
   encodings unchanged. Each module re-exports the constants under its own
   prefix (CLOB_*, PERP_*). */

export const ORDER_TYPE_GTC = 0;
export const ORDER_TYPE_MTL = 1;
export const ORDER_TYPE_ALO = 2;
export const ORDER_TYPE_IOC = 3;
export const ORDER_TYPE_FOK = 4;

export const ORDER_FLAG_BUY = 1 << 0;
export const ORDER_FLAG_HAS_CLIENT_ID = 1 << 6;

export const EVENT_SIDE_BUY = 0;
export const EVENT_SIDE_SELL = 1;
export const EVENT_REMOVE_REASON_FILLED = 0;
export const EVENT_REMOVE_REASON_EXPIRED = 1;
export const EVENT_REMOVE_REASON_EVICTED = 2;
export const EVENT_REMOVE_REASON_USER = 3;

export const STATUS_FLAG_PAUSED = 1 << 0;
export const STATUS_FLAG_POST_ONLY = 1 << 1;
export const STATUS_FLAG_WITHDRAWALS_FROZEN = 1 << 2;
export const STATUS_FLAG_DEPOSITS_FROZEN = 1 << 3;
export const STATUS_FLAG_MASK =
  STATUS_FLAG_PAUSED | STATUS_FLAG_POST_ONLY | STATUS_FLAG_WITHDRAWALS_FROZEN | STATUS_FLAG_DEPOSITS_FROZEN;

export const CLIENT_ID_SIZE = 16;
/** Account index of an absent optional account in a market record. */
export const NULL_ACCOUNT_INDEX = 0xffff;

export type OrderSide = 'buy' | 'sell';
export type OrderType = 'gtc' | 'mtl' | 'alo' | 'ioc' | 'fok';
export type OrderRemovalReason = 'filled' | 'expired' | 'evicted' | 'user';

export interface OrderBookLevel<Order> {
  side: OrderSide;
  priceInTicks: bigint;
  quantityInLots: bigint;
  orders: Order[];
}

/* Instruction encoding ******************************************************/

export function fixedSeed(value: string): Uint8Array {
  const bytes = new TextEncoder().encode(value);
  if (bytes.length > 32) throw new Error('seed cannot exceed 32 bytes');
  const seed = new Uint8Array(32);
  seed.set(bytes);
  return seed;
}

export function optionalAccountIndex(context: AccountLookupContext, pubkey?: Uint8Array): number {
  return pubkey ? accountIndex(context, pubkey) : NULL_ACCOUNT_INDEX;
}

export function assertU8(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 0xff) {
    throw new Error(`${label} must be an integer between 0 and 255`);
  }
  return value;
}

export function assertU64(value: bigint, label: string): void {
  if (value < 0n || value > 0xffffffffffffffffn) {
    throw new Error(`${label} must be between 0 and 18446744073709551615`);
  }
}

export function assertClientId(value: Uint8Array): Uint8Array {
  if (value.length !== CLIENT_ID_SIZE) throw new Error(`clientId must be ${CLIENT_ID_SIZE} bytes`);
  return value;
}

export function assertStatusFlags(value: number): number {
  const flags = assertU8(value, 'statusFlags');
  if ((flags & ~STATUS_FLAG_MASK) !== 0) {
    throw new Error(`statusFlags may only contain bits in mask 0x${STATUS_FLAG_MASK.toString(16)}`);
  }
  return flags;
}

export function orderFlags(args: {
  side: OrderSide;
  orderType?: OrderType;
  clientId?: Uint8Array;
  discardAfterMatch?: boolean;
  failIfOutsideBook?: boolean;
}): number {
  let flags = args.side === 'buy' ? ORDER_FLAG_BUY : 0;
  flags |= orderTypeValue(args.orderType ?? 'gtc') << 1;
  if (args.discardAfterMatch) flags |= 1 << 4;
  if (args.failIfOutsideBook) flags |= 1 << 5;
  if (args.clientId) flags |= ORDER_FLAG_HAS_CLIENT_ID;
  return flags;
}

export function orderTypeValue(orderType: OrderType): number {
  switch (orderType) {
    case 'gtc': return ORDER_TYPE_GTC;
    case 'mtl': return ORDER_TYPE_MTL;
    case 'alo': return ORDER_TYPE_ALO;
    case 'ioc': return ORDER_TYPE_IOC;
    case 'fok': return ORDER_TYPE_FOK;
  }
}

/** Optional client id then optional order id, the modify_order_entry metadata. */
export function buildModifyOrderMetadata(args: { clientId?: Uint8Array; orderId?: bigint }): Uint8Array {
  const metadata = new Uint8Array((args.clientId ? CLIENT_ID_SIZE : 0) + (args.orderId !== undefined ? 8 : 0));
  let offset = 0;
  if (args.clientId) {
    metadata.set(assertClientId(args.clientId), offset);
    offset += CLIENT_ID_SIZE;
  }
  if (args.orderId !== undefined) {
    assertU64(args.orderId, 'orderId');
    new DataView(metadata.buffer).setBigUint64(offset, args.orderId, true);
  }
  return metadata;
}

/* Decoding *****************************************************************/

export function orderTypeFromValue(value: number): OrderType {
  switch (value) {
    case ORDER_TYPE_GTC: return 'gtc';
    case ORDER_TYPE_MTL: return 'mtl';
    case ORDER_TYPE_ALO: return 'alo';
    case ORDER_TYPE_IOC: return 'ioc';
    case ORDER_TYPE_FOK: return 'fok';
    default: throw new Error(`unknown order type ${value}`);
  }
}

export function eventSideFromValue(value: number): OrderSide {
  if (value === EVENT_SIDE_BUY) return 'buy';
  if (value === EVENT_SIDE_SELL) return 'sell';
  throw new Error(`unknown order side ${value}`);
}

export function removalReasonFromValue(value: number): OrderRemovalReason {
  switch (value) {
    case EVENT_REMOVE_REASON_FILLED: return 'filled';
    case EVENT_REMOVE_REASON_EXPIRED: return 'expired';
    case EVENT_REMOVE_REASON_EVICTED: return 'evicted';
    case EVENT_REMOVE_REASON_USER: return 'user';
    default: throw new Error(`unknown order removal reason ${value}`);
  }
}

/** Bits [begin, end) of a packed u64 as a number. */
export function bitField(value: bigint, begin: bigint, end: bigint): number {
  const mask = (1n << (end - begin)) - 1n;
  return Number((value >> begin) & mask);
}

/** A copy of the bytes behind a generated ABI view (or a Pubkey). */
export function bytesFromView(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  const buffer = (value as { buffer?: Uint8Array }).buffer;
  if (buffer instanceof Uint8Array) return new Uint8Array(buffer);
  if (value instanceof Pubkey) return value.toBytes();
  throw new Error('generated view did not expose a byte buffer');
}

export function pubkeyViewToAddress(value: unknown): string {
  return encodeAddress(bytesFromView(value));
}

export function cbookLevelFromView(
  view: { get_head_entry_idx(): number; get_tail_entry_idx(): number },
  levelIndex: number,
): { levelIndex: number; headOrderEntryIndex: number; tailOrderEntryIndex: number } {
  return {
    levelIndex,
    headOrderEntryIndex: view.get_head_entry_idx(),
    tailOrderEntryIndex: view.get_tail_entry_idx(),
  };
}

/** Price levels of one side, best first (highest bid, lowest ask); orders
    with zero quantity are dropped. */
export function groupByPrice<Order extends { priceInTicks: bigint; quantityInLots: bigint }>(
  orders: Order[],
  side: OrderSide,
): OrderBookLevel<Order>[] {
  const levels = new Map<bigint, OrderBookLevel<Order>>();
  for (const order of orders) {
    if (order.quantityInLots === 0n) continue;
    const existing = levels.get(order.priceInTicks);
    if (existing) {
      existing.quantityInLots += order.quantityInLots;
      existing.orders.push(order);
    } else {
      levels.set(order.priceInTicks, {
        side,
        priceInTicks: order.priceInTicks,
        quantityInLots: order.quantityInLots,
        orders: [order],
      });
    }
  }
  return [...levels.values()].sort((a, b) => {
    if (a.priceInTicks === b.priceInTicks) return 0;
    const asc = a.priceInTicks < b.priceInTicks ? -1 : 1;
    return side === 'buy' ? -asc : asc;
  });
}
