import type { Account } from '@thru/sdk';
import {
  PERP_MARKET_MAGIC,
  assertPerpMarketHeader,
  type PerpArenaSlots,
  type PerpMarket,
  type PerpSeatEntry,
} from '../../index';
import { accountData } from '../../../utils/helpers';
import { pubkeyViewToAddress } from '../../../utils/orderbook';
import type { PerpAbiDecoder, PerpAbiLayout } from '../model';
import { PERP_CURRENT_LAYOUT, currentPerpDecoder, onlyEvents } from '../current';
import {
  MarketAccount as MarketAccountV02,
  PerpEvent as PerpEventV02,
  SeatArenaAccount as SeatArenaAccountV02,
  SeatEntry as SeatEntryV02,
} from './abi/thru/program/perp/types';

/* ABI 0.2.0 (milestone 2: oracle mark, margins, liquidation), the
   program Betanet ran until 2026-10-15 (code sha256 691a5046...) and the
   Alphanet demo of 2026-09-22.  Generated types: ./abi, from
   ./tn_perp_program.abi.yaml.

   What differs from the current layout:
     - the market header is 320 bytes (no funding words, no cross haircut);
     - a seat's words at 76 and 104..120 are reserved (no funding), its last
       word is non_nullable_reserved (always 1, no cross bit) and its
       quantity_quote is unsigned;
     - no margin accounts, no funding or margin events.
   The order arena, both cbooks and the exchange meta are unchanged, so
   their decoders are the current ones; the event payloads 0.2.0 has kept
   their encoding, so events decode through 0.2.0's envelope (an event type
   0.2.0 does not have is refused) and then the shared mapper. */

const MARKET_HEADER_SIZE = 320;

export const PERP_V0_2_LAYOUT: Readonly<PerpAbiLayout> = Object.freeze({
  ...PERP_CURRENT_LAYOUT,
  marketHeaderSize: MARKET_HEADER_SIZE,
  marginAccountSize: null,
});

function marketFromV02(view: MarketAccountV02): PerpMarket {
  return assertPerpMarketHeader({
    magic: view.get_magic(),
    statusFlags: view.get_status_flags(),
    exchangeStatusFlags: view.get_exchange_status_flags(),
    lotSize: view.get_lot_size(),
    tickSize: view.get_tick_size(),
    nextOrderId: view.get_next_order_id(),
    priceCap: view.get_price_cap(),
    maxPositionLots: view.get_max_position_lots(),
    openInterestLots: view.get_open_interest_lots(),
    badDebt: view.get_bad_debt(),
    orderArena: pubkeyViewToAddress(view.get_order_entry_pubkey()),
    bidsCbook: pubkeyViewToAddress(view.get_bids_cbook_pubkey()),
    asksCbook: pubkeyViewToAddress(view.get_asks_cbook_pubkey()),
    quoteVault: pubkeyViewToAddress(view.get_quote_vault_pubkey()),
    marketAuthority: pubkeyViewToAddress(view.get_market_authority_pubkey()),
    oracleFeed: pubkeyViewToAddress(view.get_oracle_feed_pubkey()),
    markNum: view.get_mark_num(),
    markDen: view.get_mark_den(),
    initialMarginBps: view.get_initial_margin_bps(),
    maintenanceMarginBps: view.get_maintenance_margin_bps(),
    liquidationFeeBps: view.get_liquidation_fee_bps(),
    oracleExponent: view.get_oracle_exponent(),
    maxMarkAgeNs: view.get_max_mark_age_ns(),
  });
}

/** A 0.2.0 seat: no funding words, no cross bit, an unsigned balance. */
function seatFromV02(view: SeatEntryV02, seatIndex: number): PerpSeatEntry | null {
  if (view.get_non_nullable_reserved() === 0n) return null;
  return {
    seatIndex,
    seatAuthority: pubkeyViewToAddress(view.get_seat_authority_pubkey()),
    quantityQuote: view.get_quantity_quote(),
    cross: false,
    longLots: view.get_long_lots(),
    shortLots: view.get_short_lots(),
    openBidLots: view.get_open_bid_lots(),
    openAskLots: view.get_open_ask_lots(),
    headOrderEntryIndex: view.get_head_order_entry_idx(),
    entryNotional: view.get_entry_notional(),
    openBidNotional: view.get_open_bid_notional(),
    openAskNotional: view.get_open_ask_notional(),
  };
}

function marketV02(accountOrData: Account | Uint8Array): PerpMarket {
  const data = accountData(accountOrData, 'perp market account');
  if (data[0] !== PERP_MARKET_MAGIC) throw new Error('account is not a perp market account');
  if (data.length < MARKET_HEADER_SIZE) throw new Error(`perp 0.2.0 market account must be at least ${MARKET_HEADER_SIZE} bytes`);
  const view = MarketAccountV02.from_array(data.subarray(0, MARKET_HEADER_SIZE));
  if (!view) throw new Error('perp market account data is malformed');
  return marketFromV02(view);
}

export const perpV02Decoder: PerpAbiDecoder = {
  ...currentPerpDecoder,
  market: marketV02,
  seatArena(accountOrData) {
    const data = accountData(accountOrData, 'perp seat arena account');
    if (data[0] !== PERP_MARKET_MAGIC) throw new Error('account is not a perp seat arena');
    if (data.length < PERP_V0_2_LAYOUT.seatArenaEntriesOffset) {
      throw new Error(`perp seat arena must be at least ${PERP_V0_2_LAYOUT.seatArenaEntriesOffset} bytes`);
    }
    const view = SeatArenaAccountV02.from_array(data);
    if (!view) throw new Error('perp seat arena account data is malformed');
    const count = view.get_entries_length();
    const slots: PerpArenaSlots<PerpSeatEntry> = new Array(count);
    const seats: PerpSeatEntry[] = [];
    for (let idx = 0; idx < count; idx++) {
      const seat = seatFromV02(view.get_entries_at(idx), idx + 1);
      if (!seat) continue;
      slots[idx] = { index: idx + 1, active: true, entry: seat };
      seats.push(seat);
    }
    const header = view.get_header();
    return {
      market: marketFromV02(view.get_market()),
      header: { nextEntryIndex: header.get_next_entry_idx(), freeMagic: header.get_free_magic() },
      slots,
      seats,
    };
  },
  seatEntry(accountOrData, seatIndex) {
    const data = accountData(accountOrData, 'perp seat entry');
    if (data.length !== PERP_V0_2_LAYOUT.seatEntrySize) throw new Error(`perp seat entry must be ${PERP_V0_2_LAYOUT.seatEntrySize} bytes`);
    const view = SeatEntryV02.from_array(data);
    if (!view) throw new Error('perp seat entry data is malformed');
    return seatFromV02(view, seatIndex);
  },
  marginAccount() {
    throw new Error('perp ABI 0.2.0 has no margin accounts');
  },
  event(data) {
    const envelope = PerpEventV02.from_array(data);
    const variant = envelope?.payloadVariant();
    if (!envelope || !variant) throw new Error('perp event type is not in ABI 0.2.0');
    return onlyEvents(currentPerpDecoder.event(data), '0.2.0', ['funding_round', 'margin']);
  },
};
