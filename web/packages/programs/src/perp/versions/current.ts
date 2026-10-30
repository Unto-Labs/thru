import type { Account } from '@thru/sdk';
import {
  parsePerpCbookAccount,
  parsePerpCbookHeader,
  parsePerpEvent,
  parsePerpExchangeMetaAccount,
  parsePerpMarginAccount,
  parsePerpMarketAccount,
  parsePerpOrderArenaAccount,
  parsePerpSeatArenaAccount,
  perpSeatFeeFields,
  perpSeatIsCross,
  type ParsedPerpEvent,
  type PerpArenaSlots,
  type PerpMarket,
  type PerpOrderEntry,
  type PerpSeatEntry,
} from '../index';
import { SeatEntry as SeatEntryView } from '../abi/thru/program/perp/types';
import { accountData } from '../../utils/helpers';
import { pubkeyViewToAddress } from '../../utils/orderbook';
import type { PerpAbiDecoder, PerpAbiLayout, PerpSeatArenaState } from './model';

/* Decoders of the ABI the SDK's generated types are built from (the
   current one, thru-perps/abi/tn_perp_program.abi.yaml).  The SDK's
   parsePerp* functions are these decoders; the versions that share the
   layout (0.3.0, 0.4.0 and 0.5.0) build on them: 0.5.0 grew the market
   header from 448 to 512 bytes into bytes the earlier versions held at
   zero, so their markets read through it with the waterfall off. */

/* Literal offsets, not the PERP_* constants: perp/index re-exports this
   module, so nothing here may read its bindings while modules load (the
   test checks the two agree). */
export const PERP_CURRENT_LAYOUT: Readonly<PerpAbiLayout> = Object.freeze({
  marketHeaderSize: 512,
  seatArenaReservedSize: 512,
  seatArenaHeaderSize: 128,
  seatArenaEntriesOffset: 640,
  seatEntrySize: 128,
  orderArenaEntriesOffset: 72,
  orderEntrySize: 64,
  cbookHeaderSize: 16,
  cbookLevelSize: 8,
  exchangeMetaSize: 96,
  marginAccountSize: 433,
});

/** The version byte of a margin account (margin_account_t.version), the
    one per-account version field the program has. */
export const PERP_MARGIN_ACCOUNT_VERSION = 1;

/** One seat entry of the current layout, as parsePerpSeatArenaAccount reads it. */
export function decodeCurrentSeatEntry(accountOrData: Account | Uint8Array, seatIndex: number): PerpSeatEntry | null {
  const data = accountData(accountOrData, 'perp seat entry');
  if (data.length !== PERP_CURRENT_LAYOUT.seatEntrySize) throw new Error(`perp seat entry must be ${PERP_CURRENT_LAYOUT.seatEntrySize} bytes`);
  const view = SeatEntryView.from_array(data);
  if (!view) throw new Error('perp seat entry data is malformed');
  const flags = view.get_flags();
  if (flags === 0n) return null;
  const cross = perpSeatIsCross(flags);
  return {
    seatIndex,
    seatAuthority: pubkeyViewToAddress(view.get_seat_authority_pubkey()),
    quantityQuote: cross ? BigInt.asIntN(64, view.get_quantity_quote()) : view.get_quantity_quote(),
    cross,
    longLots: view.get_long_lots(),
    shortLots: view.get_short_lots(),
    openBidLots: view.get_open_bid_lots(),
    openAskLots: view.get_open_ask_lots(),
    headOrderEntryIndex: view.get_head_order_entry_idx(),
    entryNotional: view.get_entry_notional(),
    openBidNotional: view.get_open_bid_notional(),
    openAskNotional: view.get_open_ask_notional(),
    fundingSnapshot: BigInt.asIntN(128, (view.get_funding_snapshot_hi() << 64n) | view.get_funding_snapshot_lo()),
    fundingCarry: view.get_funding_carry(),
    ...perpSeatFeeFields(flags),
  };
}

/** The current decoders, unchanged: 0.5.0 (the loss waterfall, trading fees). */
export const currentPerpDecoder: PerpAbiDecoder = {
  exchangeMeta: (data) => parsePerpExchangeMetaAccount(data),
  market: (data) => parsePerpMarketAccount(data),
  seatArena: (data) => parsePerpSeatArenaAccount(data),
  seatEntry: (data, seatIndex) => decodeCurrentSeatEntry(data, seatIndex),
  orderArena: (data) => parsePerpOrderArenaAccount(data),
  cbook: (data) => parsePerpCbookAccount(data),
  cbookHeader: (data) => parsePerpCbookHeader(data),
  marginAccount: (data) => {
    /* margin_fetch_account refuses any other version (TN_PERP_MARGIN_VERSION). */
    const bytes = data instanceof Uint8Array ? data : data.data?.data;
    if (bytes && bytes.length > 1 && bytes[1] !== PERP_MARGIN_ACCOUNT_VERSION) {
      throw new Error(`perp margin account version ${bytes[1]} is not ${PERP_MARGIN_ACCOUNT_VERSION}`);
    }
    return parsePerpMarginAccount(data);
  },
  event: (data) => parsePerpEvent(data),
};

/** A version without cross margin read through the current layout: the
    seat's last word was `non_nullable_reserved` (always 1, so the cross bit
    is never set and balances stay unsigned) and bytes 404..408 of the
    market were reserved (the haircut field reads 0); both are dropped from
    the model so the version reads as what it is. */
export function withoutCrossMargin(decoder: PerpAbiDecoder, abiPackageVersion: string): PerpAbiDecoder {
  const market = (m: PerpMarket): PerpMarket => {
    const { crossUpnlHaircutBps: _haircut, ...rest } = m;
    return rest;
  };
  const seat = (s: PerpSeatEntry): PerpSeatEntry => {
    if (s.cross) throw new Error(`a cross seat cannot exist under perp ABI ${abiPackageVersion}`);
    return { ...s, cross: false };
  };
  const arena = (a: PerpSeatArenaState): PerpSeatArenaState => {
    const seats = a.seats.map(seat);
    const slots: PerpSeatArenaState['slots'] = new Array(a.slots.length);
    for (const s of seats) slots[s.seatIndex - 1] = { index: s.seatIndex, active: true, entry: s };
    return { ...a, market: market(a.market), slots, seats };
  };
  return {
    ...decoder,
    market: (data) => market(decoder.market(data)),
    seatArena: (data) => arena(decoder.seatArena(data)),
    seatEntry: (data, seatIndex) => {
      const s = decoder.seatEntry(data, seatIndex);
      return s && seat(s);
    },
    marginAccount: () => {
      throw new Error(`perp ABI ${abiPackageVersion} has no margin accounts`);
    },
    event: (data) => onlyEvents(decoder.event(data), abiPackageVersion, ['margin']),
  };
}

/** The market header of the versions before 0.5.0. */
export const PERP_PRE_WATERFALL_MARKET_HEADER_SIZE = 448;

/** A version without the loss waterfall and trading fees (both 0.5.0) read
    through the current layout: the bytes they use were reserved and zero,
    so its markets read with no risk state and no fee rates (both dropped
    from the model), its seats settle against the funding index alone and
    are never fee seats nor approve a builder, its orders carry no builder
    code; a LOSS, INSURANCE or FEE event is refused.  A market header read
    alone may be the version's 448 bytes: the 64 the waterfall grew it into
    are read as the zeros they were. */
export function withoutLossWaterfall(decoder: PerpAbiDecoder, abiPackageVersion: string): PerpAbiDecoder {
  const market = (m: PerpMarket): PerpMarket => {
    const { risk: _risk, fees: _fees, ...rest } = m;
    return rest;
  };
  const seat = (s: PerpSeatEntry): PerpSeatEntry => {
    const { feeReceiver: _feeReceiver, builderApproval: _builderApproval, ...rest } = s;
    return rest;
  };
  const order = (o: PerpOrderEntry): PerpOrderEntry => {
    const { builder: _builder, ...rest } = o;
    return rest;
  };
  const header = (accountOrData: Account | Uint8Array): Uint8Array => {
    const data = accountData(accountOrData, 'perp market account');
    if (data.length >= PERP_CURRENT_LAYOUT.marketHeaderSize) return data;
    if (data.length < PERP_PRE_WATERFALL_MARKET_HEADER_SIZE) {
      throw new Error(`perp market account must be at least ${PERP_PRE_WATERFALL_MARKET_HEADER_SIZE} bytes under perp ABI ${abiPackageVersion}`);
    }
    const padded = new Uint8Array(PERP_CURRENT_LAYOUT.marketHeaderSize);
    padded.set(data);
    return padded;
  };
  return {
    ...decoder,
    market: (data) => market(decoder.market(header(data))),
    seatArena: (data) => {
      const a = decoder.seatArena(data);
      const { slots, entries } = rebuildSlots(a.slots.length, a.seats.map(seat), (s) => s.seatIndex);
      return { ...a, market: market(a.market), slots, seats: entries };
    },
    seatEntry: (data, seatIndex) => {
      const s = decoder.seatEntry(data, seatIndex);
      return s && seat(s);
    },
    orderArena: (data) => {
      const a = decoder.orderArena(data);
      const { slots, entries } = rebuildSlots(a.slots.length, a.orders.map(order), (o) => o.orderEntryIndex);
      return { ...a, slots, orders: entries };
    },
    event: (data) => onlyEvents(decoder.event(data), abiPackageVersion, ['loss', 'insurance', 'fee']),
  };
}

/** Arena slots (holes for inactive entries) rebuilt around mapped entries. */
function rebuildSlots<T>(capacity: number, entries: T[], indexOf: (entry: T) => number): { slots: PerpArenaSlots<T>; entries: T[] } {
  const slots: PerpArenaSlots<T> = new Array(capacity);
  for (const entry of entries) slots[indexOf(entry) - 1] = { index: indexOf(entry), active: true, entry };
  return { slots, entries };
}

/** Refuses an event variant the version does not emit (a tag outside its
    ABI is malformed data for that version, not a newer event). */
export function onlyEvents(event: ParsedPerpEvent, abiPackageVersion: string, absent: readonly string[]): ParsedPerpEvent {
  if (absent.includes(event.variant)) throw new Error(`perp ABI ${abiPackageVersion} has no ${event.variant} event`);
  return event;
}
