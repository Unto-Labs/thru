import { Pubkey, deriveProgramAddress } from '@thru/sdk';
import type { Account } from '@thru/sdk';
import type { Thru } from '@thru/sdk/client';
import { deriveManagedProgramAddresses } from '../manager/derivation';
import type { OracleFeed } from '../oracle/types';
import { deriveTokenAccountAddress } from '../token/derivation';
import {
  accountData,
  accountIndex,
  assertU16,
  type AccountLookupContext,
  type InstructionData,
} from '../utils/helpers';
import {
  CLIENT_ID_SIZE,
  EVENT_REMOVE_REASON_EVICTED,
  EVENT_REMOVE_REASON_EXPIRED,
  EVENT_REMOVE_REASON_FILLED,
  EVENT_REMOVE_REASON_USER,
  EVENT_SIDE_BUY,
  EVENT_SIDE_SELL,
  NULL_ACCOUNT_INDEX,
  ORDER_FLAG_BUY,
  ORDER_FLAG_HAS_CLIENT_ID,
  ORDER_TYPE_ALO,
  ORDER_TYPE_FOK,
  ORDER_TYPE_GTC,
  ORDER_TYPE_IOC,
  ORDER_TYPE_MTL,
  STATUS_FLAG_DEPOSITS_FROZEN,
  STATUS_FLAG_MASK,
  STATUS_FLAG_PAUSED,
  STATUS_FLAG_POST_ONLY,
  STATUS_FLAG_WITHDRAWALS_FROZEN,
  assertClientId,
  assertStatusFlags,
  assertU64,
  assertU8,
  buildModifyOrderMetadata,
  bitField,
  bytesFromView,
  cbookLevelFromView,
  eventSideFromValue,
  fixedSeed,
  groupByPrice,
  optionalAccountIndex,
  orderFlags,
  orderTypeFromValue,
  pubkeyViewToAddress,
  removalReasonFromValue,
  type OrderRemovalReason,
  type OrderSide,
  type OrderType,
} from '../utils/orderbook';
import {
  CbookAccount,
  CreateOrderEntryInstructionBuilder,
  ExchangeInitializeInstructionBuilder,
  ExchangeMetaAccount,
  ExchangeSetAdminInstructionBuilder,
  ExchangeSetStatusInstructionBuilder,
  LiquidateInstructionBuilder,
  MarketAccount as MarketAccountView,
  MarketCreateInstructionBuilder,
  MarketRecordInstructionBuilder,
  MarketSetOracleInstructionBuilder,
  MarketSetStatusInstructionBuilder,
  ModifyOrderEntryInstructionBuilder,
  OrderArenaAccount,
  OrderArenaHeader,
  OrderEntry as OrderEntryView,
  PerpEvent,
  PerpInstructionBuilder,
  SeatArenaAccount,
  SeatArenaHeader,
  SeatCreateInstructionBuilder,
  SeatEntry as SeatEntryView,
  TokenTransferInstructionBuilder,
} from './abi/thru/program/perp/types';

export * from './abi/thru/program/perp/types';

/* The perp program is a copy of the spot CLOB with the base asset replaced by
   a synthetic position (see thru-perps/README.md in the repository). Prices
   are quote atoms per base atom; quantities are base atoms; positions and
   resting orders are stored in lots. The perp is cross-margined: nothing is
   locked, every position and resting order needs a fraction of its notional
   at the oracle mark

     mark            = min(feed.price * mark_num / mark_den, price_cap)
     notional_mark   = lots * lot_size * mark
     upnl            = long: notional_mark - entry_notional, short: the negative
     equity          = quantity_quote + upnl
     im_position     = ceil(notional_mark * initial_margin_bps / 10000)
     mm_position     = ceil(notional_mark * maintenance_margin_bps / 10000)
     im_orders       = ceil((side(bids) + side(asks)) * initial_margin_bps / 10000), where resting
                       orders are netted against the position they would reduce:
                       side(lots, notional, reducible) = ceil(notional * (lots - reducible) / lots),
                       bid_reducible = min(open_bid_lots, short_lots), ask_reducible = min(open_ask_lots, long_lots)
     free            = equity - im_position - im_orders   (withdrawable, must stay >= 0)
     liquidatable    = has a position and equity < mm_position

   Realized PnL settles into quantity_quote on every fill; a seat that loses
   more than its collateral leaves market.bad_debt. The demo deployment on
   Alphanet is not a bootstrap program: it is managed by the deployer's key
   under PERP_PROGRAM_SEED. */

export const PERP_PROGRAM_SEED = 'perps-demo';
export const PERP_PROGRAM_ADDRESSES = deriveManagedProgramAddresses(PERP_PROGRAM_SEED);
export const PERP_PROGRAM_ADDRESS = PERP_PROGRAM_ADDRESSES.programAccountAddress;
export const PERP_PROGRAM_META_ADDRESS = PERP_PROGRAM_ADDRESSES.programMetaAccountAddress;

export const PERP_INSTRUCTION_MARKET_RECORD = 0;
export const PERP_INSTRUCTION_SEAT_CREATE = 1;
export const PERP_INSTRUCTION_TOKEN_DEPOSIT = 2;
export const PERP_INSTRUCTION_TOKEN_WITHDRAW = 3;
export const PERP_INSTRUCTION_CREATE_ORDER_ENTRY = 4;
export const PERP_INSTRUCTION_MODIFY_ORDER_ENTRY = 5;
export const PERP_INSTRUCTION_MARKET_SET_STATUS = 8;
export const PERP_INSTRUCTION_MARKET_CREATE = 9;
export const PERP_INSTRUCTION_EXCHANGE_INITIALIZE = 11;
export const PERP_INSTRUCTION_EXCHANGE_SET_STATUS = 12;
export const PERP_INSTRUCTION_EXCHANGE_SET_ADMIN = 13;
export const PERP_INSTRUCTION_EXCHANGE_RECOVER_ADMIN = 14;
export const PERP_INSTRUCTION_MARKET_SET_EXCHANGE_STATUS = 15;
export const PERP_INSTRUCTION_LIQUIDATE = 0x10;
export const PERP_INSTRUCTION_MARKET_SET_ORACLE = 0x11;
/** Market record slot the demo tooling uses for its single market per transaction. */
export const PERP_DEFAULT_MARKET_RECORD_INDEX = 1;

/* Program specific user error codes (signed; the transaction status carries
   them as u64 two's complement). The rest of the table is shared with the
   spot CLOB. */
export const PERP_ERR_PRICE_ABOVE_CAP = -205n;
export const PERP_ERR_INVALID_PRICE_CAP = -206n;
export const PERP_ERR_INVALID_POSITION_LIMIT = -207n;
export const PERP_ERR_POSITION_LIMIT = -208n;
export const PERP_ERR_ARITH_OVERFLOW = -209n;
export const PERP_ERR_ORACLE_MISSING = -210n;
export const PERP_ERR_ORACLE_MISMATCH = -211n;
export const PERP_ERR_ORACLE_INVALID = -212n;
export const PERP_ERR_ORACLE_STALE = -213n;
export const PERP_ERR_INVALID_MARGIN_PARAMS = -214n;
export const PERP_ERR_NOT_LIQUIDATABLE = -215n;
export const PERP_ERR_SELF_LIQUIDATION = -216n;
export const PERP_ERR_INSUFFICIENT_COLLATERAL = -403n;
export const PERP_ERR_INSUFFICIENT_FUNDS_QUOTE = -401n;

export const PERP_EVENT_SEAT_ASSIGNED = 1;
export const PERP_EVENT_ORDER_CANCELLED = 2;
export const PERP_EVENT_MARKET_CREATED = 3;
export const PERP_EVENT_ORDER_FILLED = 4;
export const PERP_EVENT_ORDER_POSTED = 5;
export const PERP_EVENT_ORDER_ENTRY_REMOVED = 6;
export const PERP_EVENT_ORDER_MODIFIED = 7;
export const PERP_EVENT_TOKEN_DEPOSIT = 8;
export const PERP_EVENT_TOKEN_WITHDRAW = 9;
export const PERP_EVENT_MARKET_STATUS = 10;
export const PERP_EVENT_EXCHANGE_INITIALIZED = 11;
export const PERP_EVENT_EXCHANGE_STATUS = 12;
export const PERP_EVENT_EXCHANGE_ADMIN = 13;
export const PERP_EVENT_MARKET_EXCHANGE_STATUS = 14;
export const PERP_EVENT_LIQUIDATION = 15;

export const PERP_BPS_DENOMINATOR = 10_000n;

/* Book, flag and event encodings shared with the spot CLOB (utils/orderbook). */
export const PERP_EVENT_SIDE_BUY = EVENT_SIDE_BUY;
export const PERP_EVENT_SIDE_SELL = EVENT_SIDE_SELL;
export const PERP_EVENT_REMOVE_REASON_FILLED = EVENT_REMOVE_REASON_FILLED;
export const PERP_EVENT_REMOVE_REASON_EXPIRED = EVENT_REMOVE_REASON_EXPIRED;
export const PERP_EVENT_REMOVE_REASON_EVICTED = EVENT_REMOVE_REASON_EVICTED;
export const PERP_EVENT_REMOVE_REASON_USER = EVENT_REMOVE_REASON_USER;

export const PERP_STATUS_FLAG_PAUSED = STATUS_FLAG_PAUSED;
export const PERP_STATUS_FLAG_POST_ONLY = STATUS_FLAG_POST_ONLY;
export const PERP_STATUS_FLAG_WITHDRAWALS_FROZEN = STATUS_FLAG_WITHDRAWALS_FROZEN;
export const PERP_STATUS_FLAG_DEPOSITS_FROZEN = STATUS_FLAG_DEPOSITS_FROZEN;
export const PERP_STATUS_FLAG_MASK = STATUS_FLAG_MASK;

export const PERP_ORDER_TYPE_GTC = ORDER_TYPE_GTC;
export const PERP_ORDER_TYPE_MTL = ORDER_TYPE_MTL;
export const PERP_ORDER_TYPE_ALO = ORDER_TYPE_ALO;
export const PERP_ORDER_TYPE_IOC = ORDER_TYPE_IOC;
export const PERP_ORDER_TYPE_FOK = ORDER_TYPE_FOK;

export const PERP_ORDER_FLAG_BUY = ORDER_FLAG_BUY;
export const PERP_ORDER_FLAG_HAS_CLIENT_ID = ORDER_FLAG_HAS_CLIENT_ID;
export const PERP_MODIFY_FLAG_FAIL_IF_OUT_OF_RANGE = 1 << 0;
export const PERP_MODIFY_FLAG_HAS_CLIENT_ID = 1 << 1;
export const PERP_MODIFY_FLAG_HAS_ORDER_ID = 1 << 2;

export const PERP_MARKET_MAGIC = 0x79;
export const PERP_MARKET_ACCOUNT_SIZE = 320;
/** The seat arena's header entry starts here; seat index 1 follows it. */
export const PERP_SEAT_MANAGER_RESERVED_SIZE = 512;
export const PERP_EXCHANGE_META_ACCOUNT_SIZE = 96;
export const PERP_EXCHANGE_META_MAGIC = 0xf17eda2c9e290078n;
export const PERP_EXCHANGE_META_VERSION = 1;
export const PERP_EXCHANGE_META_SEED = fixedSeed('exchange_meta');
export const PERP_SEAT_ARENA_HEADER_SIZE = 128;
export const PERP_SEAT_ENTRY_SIZE = 128;
export const PERP_SEAT_ARENA_ENTRIES_OFFSET =
  PERP_SEAT_MANAGER_RESERVED_SIZE + PERP_SEAT_ARENA_HEADER_SIZE;
export const PERP_ORDER_ARENA_HEADER_SIZE = 64;
/** 8 reserved bytes, the arena header, then order entry 1. */
export const PERP_ORDER_ARENA_ENTRIES_OFFSET = 8 + PERP_ORDER_ARENA_HEADER_SIZE;
export const PERP_ORDER_ENTRY_SIZE = 64;
export const PERP_CBOOK_HEADER_SIZE = 16;
export const PERP_CBOOK_LEVEL_SIZE = 8;
export const PERP_CBOOK_MAX_SIZE = ((1 << 24) - PERP_CBOOK_HEADER_SIZE) / PERP_CBOOK_LEVEL_SIZE;
export const PERP_CBOOK_EMPTY_PRICE_IN_TICKS = (1n << 64n) - 1n;
export const PERP_CBOOK_MAX_PRICE_IN_TICKS =
  PERP_CBOOK_EMPTY_PRICE_IN_TICKS - 2n - BigInt(PERP_CBOOK_MAX_SIZE);
export const PERP_CLIENT_ID_SIZE = CLIENT_ID_SIZE;
export const PERP_NULL_INDEX = 0xfffff;
export const PERP_NULL_ACCOUNT_INDEX = NULL_ACCOUNT_INDEX;
export const PERP_MAX_ORDER_EXPIRATION_TIME = 9_223_372_036_854_775_807n;

type PerpInstructionVariant =
  | 'market_record'
  | 'seat_create'
  | 'token_deposit'
  | 'token_withdraw'
  | 'create_order_entry'
  | 'modify_order_entry'
  | 'market_set_status'
  | 'market_create'
  | 'exchange_initialize'
  | 'exchange_set_status'
  | 'exchange_set_admin'
  | 'exchange_recover_admin'
  | 'market_set_exchange_status'
  | 'liquidate'
  | 'market_set_oracle';

export type PerpOrderSide = OrderSide;
export type PerpOrderType = OrderType;
export type PerpOrderRemovalReason = OrderRemovalReason;

export type { AccountLookupContext, InstructionData };

export interface PerpMarketRecordArgs {
  marketRecordIndex: number;
  seatArenaAccountBytes: Uint8Array;
  orderArenaAccountBytes: Uint8Array;
  bidsCbookAccountBytes: Uint8Array;
  asksCbookAccountBytes: Uint8Array;
  seatAuthorityAccountBytes?: Uint8Array;
  seatIndex?: number;
  exchangeMetaAccountBytes: Uint8Array;
  tokenProgramAccountBytes?: Uint8Array;
  quoteVaultAccountBytes?: Uint8Array;
  marketAuthorityAccountBytes?: Uint8Array;
  /** Oracle feed account (read-only). Required by every instruction that
      needs the mark: post/match, withdraw and liquidate. Absent = 0xffff. */
  oracleFeedAccountBytes?: Uint8Array;
}

export interface PerpMarginParams {
  /** Initial margin as a fraction of notional at the mark, 1..10000. */
  initialMarginBps: number;
  /** Maintenance margin, 1 <= maintenance < initial. */
  maintenanceMarginBps: number;
  /** Fee the liquidated seat pays its liquidator, <= 10000. */
  liquidationFeeBps: number;
}

export interface PerpOracleParams {
  /** mark = min(feed.price * markNum / markDen, priceCap) */
  markNum: bigint;
  markDen: bigint;
  /** The feed's exponent the market requires (feeds with another exponent are rejected). */
  oracleExponent: number;
  /** 0 = use the feed's own max_staleness_ns. */
  maxMarkAgeNs: bigint;
}

export interface PerpMarketCreateArgs extends PerpMarginParams, PerpOracleParams {
  marketRecordIndex: number;
  tokenProgramAccountBytes: Uint8Array;
  exchangeMetaAccountBytes: Uint8Array;
  quoteMintAccountBytes: Uint8Array;
  lotSize: bigint;
  tickSize: bigint;
  priceCap: bigint;
  maxPositionLots: bigint;
  oracleFeedAccountBytes: Uint8Array;
  seatArenaAccountBytes: Uint8Array;
  orderArenaAccountBytes: Uint8Array;
  bidsCbookAccountBytes: Uint8Array;
  asksCbookAccountBytes: Uint8Array;
  quoteVaultAccountBytes: Uint8Array;
  marketAuthorityAccountBytes: Uint8Array;
  seatArenaStateProof: Uint8Array;
  orderArenaStateProof: Uint8Array;
  bidsCbookStateProof: Uint8Array;
  asksCbookStateProof: Uint8Array;
  quoteVaultStateProof: Uint8Array;
}

export interface PerpExchangeInitializeArgs {
  exchangeMetaAccountBytes: Uint8Array;
  programMetaAccountBytes: Uint8Array;
  authorityAccountBytes: Uint8Array;
  tokenProgramAccountBytes: Uint8Array;
  exchangeAdminAccountBytes: Uint8Array;
  stateProof: Uint8Array;
}

export interface PerpExchangeSetStatusArgs {
  exchangeMetaAccountBytes: Uint8Array;
  exchangeAdminAccountBytes: Uint8Array;
  statusFlags: number;
}

export interface PerpExchangeSetAdminArgs {
  exchangeMetaAccountBytes: Uint8Array;
  authorityAccountBytes: Uint8Array;
  newAdminAccountBytes: Uint8Array;
}

export interface PerpSeatCreateArgs {
  marketRecordIndex: number;
  seatAuthorityAccountBytes: Uint8Array;
}

export interface PerpTokenTransferArgs {
  marketRecordIndex: number;
  tokenProgramAccountBytes: Uint8Array;
  fromAccountBytes: Uint8Array;
  toAccountBytes: Uint8Array;
  amount: bigint;
}

export interface PerpCreateOrderArgs {
  marketRecordIndex: number;
  side: PerpOrderSide;
  orderType?: PerpOrderType;
  price: bigint;
  quantity: bigint;
  expirationTime?: bigint;
  clientId?: Uint8Array;
  discardAfterMatch?: boolean;
  failIfOutsideBook?: boolean;
}

export interface PerpModifyOrderArgs {
  marketRecordIndex: number;
  orderEntryIndex: number;
  quantity: bigint;
  expirationTime: bigint;
  failIfOutOfRange?: boolean;
  clientId?: Uint8Array;
  orderId?: bigint;
}

export interface PerpMarketSetStatusArgs {
  marketRecordIndex: number;
  statusFlags: number;
}

export interface PerpLiquidateArgs {
  marketRecordIndex: number;
  /** Seat to liquidate; the signer's seat (in the market record) is the liquidator. */
  targetSeatIndex: number;
}

export interface PerpMarketSetOracleArgs extends PerpOracleParams {
  marketRecordIndex: number;
  /** The new feed account; also has to be the record's oracle feed account. */
  oracleFeedAccountBytes: Uint8Array;
}

export interface PerpMarket {
  magic: number;
  statusFlags: number;
  exchangeStatusFlags: number;
  lotSize: bigint;
  tickSize: bigint;
  nextOrderId: bigint;
  priceCap: bigint;
  maxPositionLots: bigint;
  openInterestLots: bigint;
  /** Quote written off at bankrupt fills (recorded only, no insurance fund). */
  badDebt: bigint;
  orderArena: string;
  bidsCbook: string;
  asksCbook: string;
  quoteVault: string;
  marketAuthority: string;
  oracleFeed: string;
  markNum: bigint;
  markDen: bigint;
  initialMarginBps: number;
  maintenanceMarginBps: number;
  liquidationFeeBps: number;
  oracleExponent: number;
  maxMarkAgeNs: bigint;
}

export interface PerpExchangeMeta {
  magic: bigint;
  version: number;
  statusFlags: number;
  tokenProgram: string;
  exchangeAdmin: string;
}

export interface PerpArenaHeader {
  nextEntryIndex: number;
  freeMagic: bigint;
}

export interface PerpArenaSlot<T> {
  index: number;
  active: boolean;
  entry: T;
}

/** Arena slots by arena index - 1. Inactive slots are holes (`slots[i]` is
    undefined), so `length` is the arena capacity while `map`/`filter`/
    `forEach` visit the active entries only. */
export type PerpArenaSlots<T> = Array<PerpArenaSlot<T> | undefined>;

export interface PerpSeatEntry {
  seatIndex: number;
  seatAuthority: string;
  /** Collateral: deposits - withdrawals + realized pnl - fees. Not the
      withdrawable amount; see perpFreeCollateral. */
  quantityQuote: bigint;
  longLots: bigint;
  shortLots: bigint;
  openBidLots: bigint;
  openAskLots: bigint;
  headOrderEntryIndex: number;
  /** Quote paid (long) or received (short) for the open lots; average
      entry = entryNotional / (lots * lotSize). */
  entryNotional: bigint;
  /** Sum of lots * lotSize * price over resting bids / asks. */
  openBidNotional: bigint;
  openAskNotional: bigint;
}

export interface PerpOrderEntry {
  orderEntryIndex: number;
  seatNextOrderEntryIndex: number;
  seatPreviousOrderEntryIndex: number;
  seatIndex: number;
  levelNextOrderEntryIndex: number;
  levelPreviousOrderEntryIndex: number;
  levelIndex: number;
  levelAccountIndex: number;
  quantityInLots: bigint;
  orderId: bigint;
  clientId: Uint8Array;
  expirationTime: bigint;
}

export interface PerpCbookLevel {
  levelIndex: number;
  headOrderEntryIndex: number;
  tailOrderEntryIndex: number;
}

export interface PerpCbook {
  bestLevelIndex: number;
  bestPriceInTicks: bigint;
  levels: PerpCbookLevel[];
}

export interface PerpOrderBookOrder {
  side: PerpOrderSide;
  priceInTicks: bigint;
  quantityInLots: bigint;
  orderId: bigint;
  orderEntryIndex: number;
  seatIndex: number;
  clientId: Uint8Array;
  expirationTime: bigint;
}

export interface PerpOrderBookLevel {
  side: PerpOrderSide;
  priceInTicks: bigint;
  quantityInLots: bigint;
  orders: PerpOrderBookOrder[];
}

export interface PerpOrderBookSnapshot {
  bids: PerpOrderBookLevel[];
  asks: PerpOrderBookLevel[];
  bestBid: PerpOrderBookLevel | null;
  bestAsk: PerpOrderBookLevel | null;
}

export interface PerpMarketAccounts {
  seatArena: { address: string; bytes: Uint8Array };
  orderArena: { address: string; bytes: Uint8Array };
  bidsCbook: { address: string; bytes: Uint8Array };
  asksCbook: { address: string; bytes: Uint8Array };
  quoteVault: { address: string; bytes: Uint8Array };
}

export interface ParsedPerpEventBase {
  eventType: bigint;
  variant: string;
  payload: Uint8Array;
}

export type ParsedPerpEvent =
  | (ParsedPerpEventBase & {
      variant: 'seat_assigned';
      seatIndex: number;
      seatAuthority: string;
      market: string;
    })
  | (ParsedPerpEventBase & {
      variant: 'order_cancelled';
      seatIndex: number;
      side: PerpOrderSide;
      orderType: PerpOrderType;
      price: bigint;
      quantity: bigint;
      clientId: Uint8Array;
      market: string;
      seatAuthority: string;
    })
  | (ParsedPerpEventBase & {
      variant: 'market_created';
      lotSize: bigint;
      tickSize: bigint;
      priceCap: bigint;
      maxPositionLots: bigint;
      quoteMint: string;
      marketAuthority: string;
      market: string;
      orderArena: string;
      bidsCbook: string;
      asksCbook: string;
      quoteVault: string;
    })
  | (ParsedPerpEventBase & {
      variant: 'order_filled';
      takerSeatIndex: number;
      makerSeatIndex: number;
      takerSide: PerpOrderSide;
      price: bigint;
      quantity: bigint;
      makerOrderId: bigint;
      makerClientId: Uint8Array;
      takerLongLots: bigint;
      takerShortLots: bigint;
      makerLongLots: bigint;
      makerShortLots: bigint;
      market: string;
      takerSeatAuthority: string;
      makerSeatAuthority: string;
    })
  | (ParsedPerpEventBase & {
      variant: 'order_posted';
      seatIndex: number;
      side: PerpOrderSide;
      orderType: PerpOrderType;
      price: bigint;
      quantity: bigint;
      orderId: bigint;
      clientId: Uint8Array;
      market: string;
      seatAuthority: string;
    })
  | (ParsedPerpEventBase & {
      variant: 'order_entry_removed';
      seatIndex: number;
      side: PerpOrderSide;
      reason: PerpOrderRemovalReason;
      price: bigint;
      quantity: bigint;
      orderId: bigint;
      clientId: Uint8Array;
      market: string;
      seatAuthority: string;
    })
  | (ParsedPerpEventBase & {
      variant: 'order_modified';
      seatIndex: number;
      side: PerpOrderSide;
      price: bigint;
      quantity: bigint;
      orderId: bigint;
      clientId: Uint8Array;
      expirationTime: bigint;
      market: string;
      seatAuthority: string;
    })
  | (ParsedPerpEventBase & {
      variant: 'token_deposit' | 'token_withdraw';
      seatIndex: number;
      amount: bigint;
      quantityQuote: bigint;
      longLots: bigint;
      shortLots: bigint;
      market: string;
      seatAuthority: string;
      wallet: string;
      vault: string;
    })
  | (ParsedPerpEventBase & {
      variant: 'liquidation';
      market: string;
      liquidator: string;
      target: string;
      liquidatorSeatIndex: number;
      targetSeatIndex: number;
      lots: bigint;
      /** Transfer price: the mark clamped to the target's bankruptcy price. */
      markPrice: bigint;
      fee: bigint;
      badDebt: bigint;
      targetQuoteAfter: bigint;
      liquidatorQuoteAfter: bigint;
      /** Side of the target's position before the transfer. */
      targetSide: 'long' | 'short';
    })
  | (ParsedPerpEventBase & {
      variant:
        | 'market_status'
        | 'exchange_initialized'
        | 'exchange_status'
        | 'exchange_admin'
        | 'market_exchange_status';
    });

/* Derivation ***************************************************************/

export function derivePerpExchangeMetaAddress(
  perpProgramAddress: string | Uint8Array | Pubkey = PERP_PROGRAM_ADDRESS,
) {
  return deriveProgramAddress({
    programAddress: perpProgramAddress,
    seed: PERP_EXCHANGE_META_SEED,
    ephemeral: false,
  });
}

/** Mirrors derive_seed / derive_seed_unique in tn_perp_program/process/market_manager.c:

      base = sha256(authority[32] || lot_size u64le || tick_size u64le ||
                    price_cap u64le || quote_mint[32] || initial_margin_bps u16le)

    then one byte id per account ('s', 'o', 'b', 'a'). The quote vault is a
    token account owned by the perp program with
    new_account_seed = sha256(base || 'Q'). The u16 initial_margin_bps
    (milestone 2, appended last, little-endian, 2 bytes) keeps margined
    markets from colliding with milestone 1 markets. */
export async function derivePerpMarketAccounts(args: {
  thru: Thru;
  perpProgramAddress?: string;
  tokenProgramAddress: string;
  marketAuthorityAddress: string;
  quoteMintAddress: string;
  lotSize: bigint;
  tickSize: bigint;
  priceCap: bigint;
  initialMarginBps: number;
}): Promise<PerpMarketAccounts> {
  const perpProgram = args.perpProgramAddress ?? PERP_PROGRAM_ADDRESS;
  const baseSeed = await sha256(
    Pubkey.from(args.marketAuthorityAddress).toBytes(),
    u64le(args.lotSize),
    u64le(args.tickSize),
    u64le(args.priceCap),
    Pubkey.from(args.quoteMintAddress).toBytes(),
    u16le(assertBps(args.initialMarginBps, 'initialMarginBps')),
  );
  const unique = async (id: string) => sha256(baseSeed, new TextEncoder().encode(id));
  const pda = (seed: Uint8Array) => {
    const derived = deriveProgramAddress({ programAddress: perpProgram, seed, ephemeral: false });
    return { address: derived.address, bytes: derived.bytes };
  };
  const vault = deriveTokenAccountAddress(
    args.thru,
    perpProgram,
    args.quoteMintAddress,
    args.tokenProgramAddress,
    await unique('Q'),
  );
  return {
    seatArena: pda(await unique('s')),
    orderArena: pda(await unique('o')),
    bidsCbook: pda(await unique('b')),
    asksCbook: pda(await unique('a')),
    quoteVault: { address: vault.address, bytes: vault.bytes },
  };
}

/* Market accounts ***********************************************************/

/** Read-write accounts of a market in market record order: seat arena,
    order arena, bids and asks cbooks. */
export function perpMarketAccountAddresses<T>(market: {
  seatArena: T;
  orderArena: T;
  bidsCbook: T;
  asksCbook: T;
}): T[] {
  return [market.seatArena, market.orderArena, market.bidsCbook, market.asksCbook];
}

/** Read-only accounts every trading transaction carries: the exchange meta
    and the oracle feed the program reads the mark from. */
export function perpMarketReadOnlyAddresses<T>(market: { exchangeMeta: T; oracleFeed: T }): T[] {
  return [market.exchangeMeta, market.oracleFeed];
}

/* Margin math (bigint exact, mirrors utils/perp_math.h, utils/market.h and
   utils/seat_entry.h). Every function takes the mark in quote atoms per base
   atom as produced by perpMarkPrice. */

export type PerpMarginMarket = Pick<
  PerpMarket,
  'lotSize' | 'priceCap' | 'maxPositionLots' | 'initialMarginBps' | 'maintenanceMarginBps' | 'liquidationFeeBps'
>;
export type PerpMarkMarket = Pick<PerpMarket, 'priceCap' | 'markNum' | 'markDen'>;
export type PerpMarginSeat = Pick<
  PerpSeatEntry,
  'quantityQuote' | 'longLots' | 'shortLots' | 'openBidLots' | 'openAskLots' | 'entryNotional' | 'openBidNotional' | 'openAskNotional'
>;

/** mark = min(feed.price * markNum / markDen, priceCap); the program rejects
    a zero mark (ORACLE_INVALID) and so does this. `feedPrice` is the raw
    feed value (price_usd = feedPrice * 10^exponent). */
export function perpMarkPrice(feedPrice: bigint, market: PerpMarkMarket): bigint {
  if (market.markNum <= 0n) throw new Error('markNum must be positive');
  if (market.markDen <= 0n) throw new Error('markDen must be positive');
  const mark = minBig((feedPrice * market.markNum) / market.markDen, market.priceCap);
  if (mark <= 0n) throw new Error('mark price is zero');
  return mark;
}

/** The mark from a parsed oracle feed (parseOracleFeedAccount): the feed has
    to be a price feed with the exponent the market pins, as the program
    checks (ORACLE_INVALID / ORACLE_MISMATCH), then perpMarkPrice. */
export function perpMarkFromFeed(feed: OracleFeed, market: PerpMarkMarket & Pick<PerpMarket, 'oracleExponent'>): bigint {
  if (feed.kind !== 'price') {
    throw new Error(`oracle feed "${feed.common.feedName}" is a ${feed.kind} feed, not a price feed`);
  }
  if (feed.exponent !== market.oracleExponent) {
    throw new Error(`oracle feed "${feed.common.feedName}" exponent ${feed.exponent} differs from the market's ${market.oracleExponent}`);
  }
  return perpMarkPrice(feed.price, market);
}

/** markNum / markDen such that mark = feed.price * markNum / markDen is the
    oracle price in quote atoms per base atom: price_usd = raw * 10^exponent
    and atoms = price_usd * 10^(quoteDecimals - baseDecimals), so the fraction
    is 10^(quoteDecimals - baseDecimals + exponent); a negative power goes in
    the denominator. */
export function perpMarkFraction(quoteDecimals: number, baseDecimals: number, exponent: number): { markNum: bigint; markDen: bigint } {
  for (const [label, value] of [['quoteDecimals', quoteDecimals], ['baseDecimals', baseDecimals], ['exponent', exponent]] as const) {
    if (!Number.isInteger(value)) throw new Error(`${label} must be an integer`);
  }
  const power = quoteDecimals - baseDecimals + exponent;
  return power >= 0 ? { markNum: 10n ** BigInt(power), markDen: 1n } : { markNum: 1n, markDen: 10n ** BigInt(-power) };
}

/** Display leverage of a market: floor(10000 / initialMarginBps). */
export function perpMaxLeverage(initialMarginBps: number): number {
  if (!Number.isInteger(initialMarginBps) || initialMarginBps < 1 || initialMarginBps > Number(PERP_BPS_DENOMINATOR)) {
    throw new Error(`initialMarginBps must be an integer between 1 and ${PERP_BPS_DENOMINATOR}`);
  }
  return Math.floor(Number(PERP_BPS_DENOMINATOR) / initialMarginBps);
}


/** lots * lotSize * price */
export function perpNotional(market: Pick<PerpMarket, 'lotSize'>, lots: bigint, price: bigint): bigint {
  return lots * market.lotSize * price;
}

/** ceil(amount * bps / 10000) */
export function perpCeilBps(amount: bigint, bps: number | bigint): bigint {
  return ceilDiv(amount * BigInt(bps), PERP_BPS_DENOMINATOR);
}

/** Signed: long notional_mark - entryNotional, short entryNotional - notional_mark, flat 0. */
export function perpUnrealizedPnl(market: Pick<PerpMarket, 'lotSize'>, seat: PerpMarginSeat, mark: bigint): bigint {
  if (seat.longLots > 0n) return perpNotional(market, seat.longLots, mark) - seat.entryNotional;
  if (seat.shortLots > 0n) return seat.entryNotional - perpNotional(market, seat.shortLots, mark);
  return 0n;
}

/** Signed: quantityQuote + unrealized pnl. */
export function perpEquity(market: Pick<PerpMarket, 'lotSize'>, seat: PerpMarginSeat, mark: bigint): bigint {
  return seat.quantityQuote + perpUnrealizedPnl(market, seat, mark);
}

/** im_position = ceil(notional_mark * initialMarginBps / 10000) */
export function perpPositionInitialMargin(
  market: Pick<PerpMarket, 'lotSize' | 'initialMarginBps'>,
  seat: PerpMarginSeat,
  mark: bigint,
): bigint {
  return perpCeilBps(perpNotional(market, seat.longLots + seat.shortLots, mark), market.initialMarginBps);
}

/** The part of one side's open notional that needs margin: resting orders
    are netted against the position they would reduce, so of `lots` at
    `notional` only `lots - reducible` count, pro rata and rounded up:
    ceil(notional * (lots - reducible) / lots); 0 when the side is empty or
    fully reducing. Mirrors seat_side_margin_notional. */
export function perpSideMarginNotional(lots: bigint, notional: bigint, reducible: bigint): bigint {
  if (lots <= 0n) return 0n;
  const margined = lots > reducible ? lots - reducible : 0n;
  if (margined === 0n) return 0n;
  if (margined === lots) return notional;
  return ceilDiv(notional * margined, lots);
}

/** im_orders = ceil((side(bids) + side(asks)) * initialMarginBps / 10000) with
    bid_reducible = min(openBidLots, shortLots) and ask_reducible =
    min(openAskLots, longLots). Mirrors seat_im_orders. */
export function perpOrderInitialMargin(market: Pick<PerpMarket, 'initialMarginBps'>, seat: PerpMarginSeat): bigint {
  const bids = perpSideMarginNotional(seat.openBidLots, seat.openBidNotional, minBig(seat.openBidLots, seat.shortLots));
  const asks = perpSideMarginNotional(seat.openAskLots, seat.openAskNotional, minBig(seat.openAskLots, seat.longLots));
  return perpCeilBps(bids + asks, market.initialMarginBps);
}

/** Initial margin of the position and every resting order. */
export function perpInitialMargin(
  market: Pick<PerpMarket, 'lotSize' | 'initialMarginBps'>,
  seat: PerpMarginSeat,
  mark: bigint,
): bigint {
  return perpPositionInitialMargin(market, seat, mark) + perpOrderInitialMargin(market, seat);
}

/** mm_position = ceil(notional_mark * maintenanceMarginBps / 10000) */
export function perpMaintenanceMargin(
  market: Pick<PerpMarket, 'lotSize' | 'maintenanceMarginBps'>,
  seat: PerpMarginSeat,
  mark: bigint,
): bigint {
  return perpCeilBps(perpNotional(market, seat.longLots + seat.shortLots, mark), market.maintenanceMarginBps);
}

/** Signed: equity - im_position - im_orders. Withdrawable when >= 0; a
    post that would make it negative fails with INSUFFICIENT_COLLATERAL. */
export function perpFreeCollateral(
  market: Pick<PerpMarket, 'lotSize' | 'initialMarginBps'>,
  seat: PerpMarginSeat,
  mark: bigint,
): bigint {
  return perpEquity(market, seat, mark) - perpInitialMargin(market, seat, mark);
}

/** Initial margin one lot needs at price p: ceil(lotSize * p * initialMarginBps / 10000). */
export function perpLotInitialMargin(market: Pick<PerpMarket, 'lotSize' | 'initialMarginBps'>, price: bigint): bigint {
  return perpCeilBps(market.lotSize * price, market.initialMarginBps);
}

/** Taker capacity (seat_max_buy_lots): closing short lots are always
    allowed; opening lots are limited by the position limit and by
    max(free, 0) / ceil(lotSize * price * initialMarginBps / 10000). */
export function perpMaxBuyLots(market: PerpMarginMarket, seat: PerpMarginSeat, price: bigint, mark: bigint): bigint {
  const capacity = maxBig(market.maxPositionLots - seat.longLots - seat.openBidLots, 0n);
  return seat.shortLots + minBig(capacity, affordableLots(market, seat, price, mark));
}

export function perpMaxSellLots(market: PerpMarginMarket, seat: PerpMarginSeat, price: bigint, mark: bigint): bigint {
  const capacity = maxBig(market.maxPositionLots - seat.shortLots - seat.openAskLots, 0n);
  return seat.longLots + minBig(capacity, affordableLots(market, seat, price, mark));
}

function affordableLots(market: PerpMarginMarket, seat: PerpMarginSeat, price: bigint, mark: bigint): bigint {
  const perLot = perpLotInitialMargin(market, price);
  const free = maxBig(perpFreeCollateral(market, seat, mark), 0n);
  return perLot === 0n ? market.maxPositionLots : free / perLot;
}

/** Whether a post of `lots` at `price` on `side` passes the margin check:
    free recomputed with the order's lots and notional added to the side's
    open lots and notional (so the netting against the position applies to
    the new order too) must stay >= 0. Position limits are not checked here. */
export function perpCanPostOrder(
  market: PerpMarginMarket,
  seat: PerpMarginSeat,
  side: PerpOrderSide,
  lots: bigint,
  price: bigint,
  mark: bigint,
): boolean {
  const notional = perpNotional(market, lots, price);
  const buy = side === 'buy';
  const after: PerpMarginSeat = {
    ...seat,
    openBidLots: seat.openBidLots + (buy ? lots : 0n),
    openAskLots: seat.openAskLots + (buy ? 0n : lots),
    openBidNotional: seat.openBidNotional + (buy ? notional : 0n),
    openAskNotional: seat.openAskNotional + (buy ? 0n : notional),
  };
  return perpFreeCollateral(market, after, mark) >= 0n;
}

/** Price at which the seat's equity is exactly zero: long
    ceil((entryNotional - quantityQuote) / (lots * lotSize)) (0 when the
    collateral covers the whole entry), short
    floor((entryNotional + quantityQuote) / (lots * lotSize)) capped at
    priceCap. null for a flat seat. */
export function perpBankruptcyPrice(market: Pick<PerpMarket, 'lotSize' | 'priceCap'>, seat: PerpMarginSeat): bigint | null {
  if (seat.longLots > 0n) {
    if (seat.quantityQuote >= seat.entryNotional) return 0n;
    return ceilDiv(seat.entryNotional - seat.quantityQuote, seat.longLots * market.lotSize);
  }
  if (seat.shortLots > 0n) {
    return minBig((seat.entryNotional + seat.quantityQuote) / (seat.shortLots * market.lotSize), market.priceCap);
  }
  return null;
}

/** Liquidatable iff the seat has a position and equity < mm_position. */
export function perpIsLiquidatable(
  market: Pick<PerpMarket, 'lotSize' | 'maintenanceMarginBps'>,
  seat: PerpMarginSeat,
  mark: bigint,
): boolean {
  if (seat.longLots === 0n && seat.shortLots === 0n) return false;
  return perpEquity(market, seat, mark) < perpMaintenanceMargin(market, seat, mark);
}

/** Display helper: the mark at which equity crosses the maintenance margin,
    i.e. the highest mark (long) or lowest mark (short) at which the seat is
    liquidatable. Solving equity = notional_mark * mm / 10000:

      long   m* = 10000 * (entryNotional - quantityQuote) / (L * (10000 - mm))
      short  m* = 10000 * (entryNotional + quantityQuote) / (L * (10000 + mm))

    with L = lots * lotSize; a long is liquidatable below m*, a short above
    it. null when the seat is flat or no mark in [1, priceCap] liquidates it
    (a long whose collateral exceeds the maintenance requirement at any
    price, or a short whose threshold is at or above the cap, where the mark
    is clamped). */
export function perpLiquidationPrice(
  market: Pick<PerpMarket, 'lotSize' | 'priceCap' | 'maintenanceMarginBps'>,
  seat: PerpMarginSeat,
): bigint | null {
  const mm = BigInt(market.maintenanceMarginBps);
  if (seat.longLots > 0n) {
    const numerator = PERP_BPS_DENOMINATOR * (seat.entryNotional - seat.quantityQuote);
    if (numerator <= 0n) return null;
    const denominator = seat.longLots * market.lotSize * (PERP_BPS_DENOMINATOR - mm);
    /* highest integer m with m < numerator / denominator */
    const price = ceilDiv(numerator, denominator) - 1n;
    return price >= 1n ? minBig(price, market.priceCap) : null;
  }
  if (seat.shortLots > 0n) {
    const numerator = PERP_BPS_DENOMINATOR * (seat.entryNotional + seat.quantityQuote);
    const denominator = seat.shortLots * market.lotSize * (PERP_BPS_DENOMINATOR + mm);
    /* lowest integer m with m > numerator / denominator */
    const price = numerator / denominator + 1n;
    return price <= market.priceCap ? price : null;
  }
  return null;
}

/** Leverage = notional at the mark / equity, in basis points (10000 = 1x).
    null when the seat has no position or its equity is not positive. */
export function perpLeverageBps(market: Pick<PerpMarket, 'lotSize'>, seat: PerpMarginSeat, mark: bigint): bigint | null {
  const lots = seat.longLots + seat.shortLots;
  if (lots === 0n) return null;
  const equity = perpEquity(market, seat, mark);
  if (equity <= 0n) return null;
  return (perpNotional(market, lots, mark) * PERP_BPS_DENOMINATOR) / equity;
}

/** Average entry price of the open position (entryNotional / (lots * lotSize)), null when flat. */
export function perpAverageEntryPrice(market: Pick<PerpMarket, 'lotSize'>, seat: PerpMarginSeat): bigint | null {
  const lots = seat.longLots + seat.shortLots;
  if (lots === 0n) return null;
  return seat.entryNotional / (lots * market.lotSize);
}

/** Liquidation transfer price: the mark clamped to the target's bankruptcy
    price (max for a long target, min for a short one), and the fee the
    liquidator receives, min(notional_at_p_liq * liquidationFeeBps / 10000,
    target.quantityQuote after the transfer). Preview only; the program is
    authoritative. */
export function perpLiquidationPreview(
  market: PerpMarginMarket,
  target: PerpMarginSeat,
  mark: bigint,
): { side: 'long' | 'short'; lots: bigint; price: bigint; fee: bigint; targetQuoteAfter: bigint } | null {
  const bankruptcy = perpBankruptcyPrice(market, target);
  if (bankruptcy === null) return null;
  const long = target.longLots > 0n;
  const lots = long ? target.longLots : target.shortLots;
  const price = long ? maxBig(mark, bankruptcy) : minBig(mark, bankruptcy);
  const notional = perpNotional(market, lots, price);
  /* Closing at price realizes the whole position. */
  const realized = long ? notional - target.entryNotional : target.entryNotional - notional;
  const quoteAfterClose = maxBig(target.quantityQuote + realized, 0n);
  const fee = minBig((notional * BigInt(market.liquidationFeeBps)) / PERP_BPS_DENOMINATOR, quoteAfterClose);
  return { side: long ? 'long' : 'short', lots, price, fee, targetQuoteAfter: quoteAfterClose - fee };
}


/* Instruction builders *****************************************************/

export function createPerpExchangeInitializeInstruction(args: PerpExchangeInitializeArgs): InstructionData {
  return async (context) => {
    const builder = new ExchangeInitializeInstructionBuilder()
      .set_reserved0(0)
      .set_exchange_meta_account_idx(accountIndex(context, args.exchangeMetaAccountBytes))
      .set_program_meta_account_idx(accountIndex(context, args.programMetaAccountBytes))
      .set_authority_account_idx(accountIndex(context, args.authorityAccountBytes))
      .set_token_program_idx(accountIndex(context, args.tokenProgramAccountBytes))
      .set_exchange_admin_account_idx(accountIndex(context, args.exchangeAdminAccountBytes));
    builder.proof().write(args.stateProof).finish();
    return buildPerpInstruction('exchange_initialize', builder.build());
  };
}

export function createPerpExchangeSetStatusInstruction(args: PerpExchangeSetStatusArgs): InstructionData {
  return async (context) => {
    const payload = new ExchangeSetStatusInstructionBuilder()
      .set_status_flags(assertStatusFlags(args.statusFlags))
      .set_exchange_meta_account_idx(accountIndex(context, args.exchangeMetaAccountBytes))
      .set_exchange_admin_account_idx(accountIndex(context, args.exchangeAdminAccountBytes))
      .set_reserved0(0)
      .build();
    return buildPerpInstruction('exchange_set_status', payload);
  };
}

export function createPerpExchangeSetAdminInstruction(args: PerpExchangeSetAdminArgs): InstructionData {
  return async (context) => {
    const payload = new ExchangeSetAdminInstructionBuilder()
      .set_reserved0(0)
      .set_exchange_meta_account_idx(accountIndex(context, args.exchangeMetaAccountBytes))
      .set_authority_account_idx(accountIndex(context, args.authorityAccountBytes))
      .set_new_admin_account_idx(accountIndex(context, args.newAdminAccountBytes))
      .build();
    return buildPerpInstruction('exchange_set_admin', payload);
  };
}

export function createPerpMarketRecordInstruction(args: PerpMarketRecordArgs): InstructionData {
  const seatIndex = args.seatIndex === undefined ? PERP_NULL_INDEX : assertPerpSeatIndex(args.seatIndex);
  return async (context) => {
    const payload = new MarketRecordInstructionBuilder()
      .set_market_record_idx(assertU8(args.marketRecordIndex, 'marketRecordIndex'))
      .set_seat_arena_account_idx(accountIndex(context, args.seatArenaAccountBytes))
      .set_order_arena_account_idx(accountIndex(context, args.orderArenaAccountBytes))
      .set_bids_cbook_account_idx(accountIndex(context, args.bidsCbookAccountBytes))
      .set_asks_cbook_account_idx(accountIndex(context, args.asksCbookAccountBytes))
      .set_seat_authority_account_idx(optionalAccountIndex(context, args.seatAuthorityAccountBytes))
      .set_seat_idx(seatIndex)
      .set_exchange_meta_account_idx(accountIndex(context, args.exchangeMetaAccountBytes))
      .set_token_program_idx(optionalAccountIndex(context, args.tokenProgramAccountBytes))
      .set_quote_vault_account_idx(args.quoteVaultAccountBytes ? accountIndex(context, args.quoteVaultAccountBytes) : 0)
      .set_market_authority_account_idx(optionalAccountIndex(context, args.marketAuthorityAccountBytes))
      .set_oracle_feed_account_idx(optionalAccountIndex(context, args.oracleFeedAccountBytes))
      .set_reserved0([0, 0, 0, 0, 0, 0])
      .build();
    return buildPerpInstruction('market_record', payload);
  };
}

/** The named market authority must authorize the transaction. */
export function createPerpMarketCreateInstruction(args: PerpMarketCreateArgs): InstructionData {
  return async (context) => {
    assertU64(args.lotSize, 'lotSize');
    assertU64(args.tickSize, 'tickSize');
    assertU64(args.priceCap, 'priceCap');
    assertU64(args.maxPositionLots, 'maxPositionLots');
    assertMarginParams(args);
    assertOracleParams(args);
    const builder = new MarketCreateInstructionBuilder()
      .set_market_record_idx(assertU8(args.marketRecordIndex, 'marketRecordIndex'))
      .set_token_program_idx(accountIndex(context, args.tokenProgramAccountBytes))
      .set_exchange_meta_account_idx(accountIndex(context, args.exchangeMetaAccountBytes))
      .set_quote_mint_idx(accountIndex(context, args.quoteMintAccountBytes))
      .set_lot_size(args.lotSize)
      .set_tick_size(args.tickSize)
      .set_price_cap(args.priceCap)
      .set_max_position_lots(args.maxPositionLots)
      .set_seat_arena_account_idx(accountIndex(context, args.seatArenaAccountBytes))
      .set_order_arena_account_idx(accountIndex(context, args.orderArenaAccountBytes))
      .set_bids_cbook_account_idx(accountIndex(context, args.bidsCbookAccountBytes))
      .set_asks_cbook_account_idx(accountIndex(context, args.asksCbookAccountBytes))
      .set_quote_vault_account_idx(accountIndex(context, args.quoteVaultAccountBytes))
      .set_market_authority_account_idx(accountIndex(context, args.marketAuthorityAccountBytes))
      .set_oracle_feed_account_idx(accountIndex(context, args.oracleFeedAccountBytes))
      .set_initial_margin_bps(args.initialMarginBps)
      .set_maintenance_margin_bps(args.maintenanceMarginBps)
      .set_liquidation_fee_bps(args.liquidationFeeBps)
      .set_mark_num(args.markNum)
      .set_mark_den(args.markDen)
      .set_oracle_exponent(args.oracleExponent)
      .set_reserved1(0)
      .set_max_mark_age_ns(args.maxMarkAgeNs);
    builder.proof_seat_arena().write(args.seatArenaStateProof).finish();
    builder.proof_order_arena().write(args.orderArenaStateProof).finish();
    builder.proof_bids_cbook().write(args.bidsCbookStateProof).finish();
    builder.proof_asks_cbook().write(args.asksCbookStateProof).finish();
    builder.proof_quote_vault().write(args.quoteVaultStateProof).finish();
    return buildPerpInstruction('market_create', builder.build());
  };
}

export function createPerpSeatCreateInstruction(args: PerpSeatCreateArgs): InstructionData {
  return async (context) => {
    const payload = new SeatCreateInstructionBuilder()
      .set_market_record_idx(assertU8(args.marketRecordIndex, 'marketRecordIndex'))
      .set_seat_authority_account_idx(accountIndex(context, args.seatAuthorityAccountBytes))
      .set_reserved0([0, 0, 0, 0])
      .build();
    return buildPerpInstruction('seat_create', payload);
  };
}

export function createPerpTokenDepositInstruction(args: PerpTokenTransferArgs): InstructionData {
  return createTokenTransferInstruction('token_deposit', args);
}

export function createPerpTokenWithdrawInstruction(args: PerpTokenTransferArgs): InstructionData {
  return createTokenTransferInstruction('token_withdraw', args);
}

export function createPerpOrderEntryInstruction(args: PerpCreateOrderArgs): InstructionData {
  return async () => {
    const flags = orderFlags(args);
    assertU64(args.price, 'price');
    assertU64(args.quantity, 'quantity');
    const builder = new CreateOrderEntryInstructionBuilder()
      .set_instruction_flags(flags)
      .set_market_record_idx(assertU8(args.marketRecordIndex, 'marketRecordIndex'))
      .set_reserved0([0, 0, 0, 0, 0])
      .set_price(args.price)
      .set_quantity(args.quantity)
      .set_exp_time(args.expirationTime ?? PERP_MAX_ORDER_EXPIRATION_TIME);
    if (args.clientId) builder.client_id().write(assertClientId(args.clientId)).finish();
    return buildPerpInstruction('create_order_entry', builder.build());
  };
}

export function createPerpModifyOrderEntryInstruction(args: PerpModifyOrderArgs): InstructionData {
  return async () => {
    let flags = args.failIfOutOfRange ? PERP_MODIFY_FLAG_FAIL_IF_OUT_OF_RANGE : 0;
    if (args.clientId) flags |= PERP_MODIFY_FLAG_HAS_CLIENT_ID;
    if (args.orderId !== undefined) flags |= PERP_MODIFY_FLAG_HAS_ORDER_ID;
    const metadata = buildModifyOrderMetadata(args);
    assertU64(args.quantity, 'quantity');
    const builder = new ModifyOrderEntryInstructionBuilder()
      .set_instruction_flags(flags)
      .set_market_record_idx(assertU8(args.marketRecordIndex, 'marketRecordIndex'))
      .set_reserved0(0)
      .set_order_entry_idx(args.orderEntryIndex)
      .set_quantity(args.quantity)
      .set_exp_time(args.expirationTime);
    if (metadata.length) builder.metadata().write(metadata).finish();
    return buildPerpInstruction('modify_order_entry', builder.build());
  };
}

/** Cancel is modify with quantity 0. */
export function createPerpCancelOrderInstruction(args: {
  marketRecordIndex: number;
  orderEntryIndex: number;
  orderId?: bigint;
}): InstructionData {
  return createPerpModifyOrderEntryInstruction({
    marketRecordIndex: args.marketRecordIndex,
    orderEntryIndex: args.orderEntryIndex,
    quantity: 0n,
    expirationTime: 0n,
    orderId: args.orderId,
  });
}

export function createPerpMarketSetStatusInstruction(args: PerpMarketSetStatusArgs): InstructionData {
  return async () => {
    const payload = new MarketSetStatusInstructionBuilder()
      .set_market_record_idx(assertU8(args.marketRecordIndex, 'marketRecordIndex'))
      .set_status_flags(assertStatusFlags(args.statusFlags))
      .set_reserved0([0, 0, 0, 0, 0])
      .build();
    return buildPerpInstruction('market_set_status', payload);
  };
}

/** Liquidate `targetSeatIndex`; the signer's seat from the market record is
    the liquidator and takes over the position at the mark clamped to the
    target's bankruptcy price. The record needs the oracle feed account. */
export function createPerpLiquidateInstruction(args: PerpLiquidateArgs): InstructionData {
  return async () => {
    const payload = new LiquidateInstructionBuilder()
      .set_market_record_idx(assertU8(args.marketRecordIndex, 'marketRecordIndex'))
      .set_reserved0(0)
      .set_target_seat_idx(assertPerpSeatIndex(args.targetSeatIndex, 'targetSeatIndex'))
      .build();
    return buildPerpInstruction('liquidate', payload);
  };
}

/** Market authority only: replaces the feed pubkey, mark fraction, required
    exponent and max mark age. The record must carry the market authority
    and the new feed account. */
export function createPerpMarketSetOracleInstruction(args: PerpMarketSetOracleArgs): InstructionData {
  return async (context) => {
    assertOracleParams(args);
    const payload = new MarketSetOracleInstructionBuilder()
      .set_market_record_idx(assertU8(args.marketRecordIndex, 'marketRecordIndex'))
      .set_oracle_feed_account_idx(accountIndex(context, args.oracleFeedAccountBytes))
      .set_oracle_exponent(args.oracleExponent)
      .set_mark_num(args.markNum)
      .set_mark_den(args.markDen)
      .set_max_mark_age_ns(args.maxMarkAgeNs)
      .set_reserved0(0n)
      .build();
    return buildPerpInstruction('market_set_oracle', payload);
  };
}

/** The perp entrypoint accepts several instructions concatenated in one
    payload; every trading instruction is preceded by a market_record. */
export function concatPerpInstructions(...instructions: InstructionData[]): InstructionData {
  return async (context) => {
    const chunks: Uint8Array[] = [];
    for (const instruction of instructions) chunks.push(await instruction(context));
    const size = chunks.reduce((total, chunk) => total + chunk.length, 0);
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return bytes;
  };
}

/* Account parsers **********************************************************/

export function parsePerpExchangeMetaAccount(accountOrData: Account | Uint8Array): PerpExchangeMeta {
  const data = accountData(accountOrData, 'perp exchange metadata account');
  if (data.length !== PERP_EXCHANGE_META_ACCOUNT_SIZE) {
    throw new Error(`perp exchange metadata account must be ${PERP_EXCHANGE_META_ACCOUNT_SIZE} bytes`);
  }
  const parsed = ExchangeMetaAccount.from_array(data);
  if (!parsed) throw new Error('perp exchange metadata account data is malformed');
  if (parsed.get_magic() !== PERP_EXCHANGE_META_MAGIC) {
    throw new Error('perp exchange metadata account has an invalid magic value');
  }
  if (parsed.get_version() !== PERP_EXCHANGE_META_VERSION) {
    throw new Error('perp exchange metadata account has an unsupported version');
  }
  return {
    magic: parsed.get_magic(),
    version: parsed.get_version(),
    statusFlags: parsed.get_status_flags(),
    tokenProgram: pubkeyViewToAddress(parsed.get_token_program_pubkey()),
    exchangeAdmin: pubkeyViewToAddress(parsed.get_exchange_admin_pubkey()),
  };
}

export function parsePerpMarketAccount(accountOrData: Account | Uint8Array): PerpMarket {
  const data = accountData(accountOrData, 'perp market account');
  if (data[0] !== PERP_MARKET_MAGIC) throw new Error('account is not a perp market account');
  if (data.length < PERP_MARKET_ACCOUNT_SIZE) {
    throw new Error(`perp market account must be at least ${PERP_MARKET_ACCOUNT_SIZE} bytes`);
  }
  const parsed = MarketAccountView.from_array(data);
  if (!parsed) throw new Error('perp market account data is malformed');
  return marketFromView(parsed);
}

export function parsePerpSeatArenaAccount(accountOrData: Account | Uint8Array): {
  market: PerpMarket;
  header: PerpArenaHeader;
  slots: PerpArenaSlots<PerpSeatEntry>;
  seats: PerpSeatEntry[];
} {
  const data = accountData(accountOrData, 'perp seat arena account');
  if (data[0] !== PERP_MARKET_MAGIC) throw new Error('account is not a perp seat arena');
  if (data.length < PERP_SEAT_ARENA_ENTRIES_OFFSET) {
    throw new Error(`perp seat arena must be at least ${PERP_SEAT_ARENA_ENTRIES_OFFSET} bytes`);
  }
  const parsed = SeatArenaAccount.from_array(data);
  if (!parsed) throw new Error('perp seat arena account data is malformed');
  const { slots, entries: seats } = activeArenaSlots(parsed.get_entries_length(), (idx) => {
    const entry = parsed.get_entries_at(idx);
    return entry.get_non_nullable_reserved() === 0n ? null : seatEntryFromView(entry, idx + 1);
  });
  return {
    market: marketFromView(parsed.get_market()),
    header: arenaHeaderFromView(parsed.get_header()),
    slots,
    seats,
  };
}

export function parsePerpOrderArenaAccount(accountOrData: Account | Uint8Array): {
  header: PerpArenaHeader;
  slots: PerpArenaSlots<PerpOrderEntry>;
  orders: PerpOrderEntry[];
} {
  const data = accountData(accountOrData, 'perp order arena account');
  const parsed = OrderArenaAccount.from_array(data);
  if (!parsed) throw new Error('perp order arena account data is malformed');
  const { slots, entries: orders } = activeArenaSlots(parsed.get_entries_length(), (idx) => {
    const entry = parsed.get_entries_at(idx);
    return entry.get_expiry() === 0n ? null : orderEntryFromView(entry, idx + 1);
  });
  return {
    header: arenaHeaderFromView(parsed.get_header()),
    slots,
    orders,
  };
}

/** Preserve arena indexes while only decoding active entries. The generated
    ABI accessors own entry sizes, offsets, and activity marker reads. */
function activeArenaSlots<T>(
  count: number,
  decode: (idx: number) => T | null,
): { slots: PerpArenaSlots<T>; entries: T[] } {
  const slots: PerpArenaSlots<T> = new Array(count);
  const entries: T[] = [];
  for (let idx = 0; idx < count; idx++) {
    const entry = decode(idx);
    if (entry === null) continue;
    slots[idx] = { index: idx + 1, active: true, entry };
    entries.push(entry);
  }
  return { slots, entries };
}


export function parsePerpCbookAccount(accountOrData: Account | Uint8Array): PerpCbook {
  const data = accountData(accountOrData, 'perp cbook account');
  const parsed = CbookAccount.from_array(data);
  if (!parsed) throw new Error('perp cbook account data is malformed');
  const header = parsed.get_header();
  return {
    bestLevelIndex: header.get_best_level_idx(),
    bestPriceInTicks: header.get_best_price_in_ticks(),
    levels: parsed.get_levels().map((level, idx) => cbookLevelFromView(level, idx)),
  };
}

/** Rebuild the visible book from the order arena plus both cbooks. Orders
    on level account 0 are bids, on 1 asks. Prices are in ticks. */
export function buildPerpOrderBookSnapshot(args: {
  orders: PerpOrderEntry[];
  bidsCbook: PerpCbook;
  asksCbook: PerpCbook;
}): PerpOrderBookSnapshot {
  const bids: PerpOrderBookOrder[] = [];
  const asks: PerpOrderBookOrder[] = [];
  for (const order of args.orders) {
    if (order.levelAccountIndex === 0) bids.push(bookOrder(order, 'buy', args.bidsCbook));
    else if (order.levelAccountIndex === 1) asks.push(bookOrder(order, 'sell', args.asksCbook));
  }
  const bidLevels = groupByPrice(bids, 'buy');
  const askLevels = groupByPrice(asks, 'sell');
  return {
    bids: bidLevels,
    asks: askLevels,
    bestBid: bidLevels[0] ?? null,
    bestAsk: askLevels[0] ?? null,
  };
}

/** Orders that belong to one seat, walking its linked list. */
export function perpSeatOrders(seat: PerpSeatEntry, arena: { slots: PerpArenaSlots<PerpOrderEntry> }): PerpOrderEntry[] {

  const orders: PerpOrderEntry[] = [];
  let index = seat.headOrderEntryIndex;
  let guard = 0;
  while (index !== 0 && guard++ < arena.slots.length) {
    const slot = arena.slots[index - 1];
    if (!slot || !slot.active) break;
    orders.push(slot.entry);
    index = slot.entry.seatNextOrderEntryIndex;
  }
  return orders;
}

export function parsePerpEvent(data: Uint8Array): ParsedPerpEvent {
  const parsed = PerpEvent.from_array(data);
  if (!parsed) throw new Error('perp event data is malformed');
  const variant = parsed.payloadVariant();
  if (!variant) throw new Error('perp event type is unknown');
  const eventType = parsed.get_event_type();
  const payload = parsed.payload();
  const base = { eventType, variant: variant.name, payload: payload.bytes() };

  switch (variant.name) {
    case 'seat_assigned': {
      const event = payload.asSeatAssigned();
      if (!event) throw new Error('perp seat_assigned event payload is malformed');
      return {
        ...base,
        variant: 'seat_assigned',
        seatIndex: event.get_seat_idx(),
        seatAuthority: pubkeyViewToAddress(event.get_seat_authority()),
        market: pubkeyViewToAddress(event.get_market()),
      };
    }
    case 'order_cancelled': {
      const event = payload.asOrderCancelled();
      if (!event) throw new Error('perp order_cancelled event payload is malformed');
      return {
        ...base,
        variant: 'order_cancelled',
        seatIndex: event.get_seat_idx(),
        side: eventSideFromValue(event.get_side()),
        orderType: orderTypeFromValue(event.get_order_type()),
        price: event.get_price(),
        quantity: event.get_qty(),
        clientId: bytesFromView(event.get_client_id()),
        market: pubkeyViewToAddress(event.get_market()),
        seatAuthority: pubkeyViewToAddress(event.get_seat_authority()),
      };
    }
    case 'market_created': {
      const event = payload.asMarketCreated();
      if (!event) throw new Error('perp market_created event payload is malformed');
      return {
        ...base,
        variant: 'market_created',
        lotSize: event.get_lot_size(),
        tickSize: event.get_tick_size(),
        priceCap: event.get_price_cap(),
        maxPositionLots: event.get_max_position_lots(),
        quoteMint: pubkeyViewToAddress(event.get_quote_mint()),
        marketAuthority: pubkeyViewToAddress(event.get_market_authority()),
        market: pubkeyViewToAddress(event.get_market()),
        orderArena: pubkeyViewToAddress(event.get_order_arena()),
        bidsCbook: pubkeyViewToAddress(event.get_bids_cbook()),
        asksCbook: pubkeyViewToAddress(event.get_asks_cbook()),
        quoteVault: pubkeyViewToAddress(event.get_quote_vault()),
      };
    }
    case 'order_filled': {
      const event = payload.asOrderFilled();
      if (!event) throw new Error('perp order_filled event payload is malformed');
      return {
        ...base,
        variant: 'order_filled',
        takerSeatIndex: event.get_taker_seat_idx(),
        makerSeatIndex: event.get_maker_seat_idx(),
        takerSide: eventSideFromValue(event.get_taker_side()),
        price: event.get_price(),
        quantity: event.get_qty(),
        makerOrderId: event.get_maker_order_id(),
        makerClientId: bytesFromView(event.get_maker_client_id()),
        takerLongLots: event.get_taker_long_lots(),
        takerShortLots: event.get_taker_short_lots(),
        makerLongLots: event.get_maker_long_lots(),
        makerShortLots: event.get_maker_short_lots(),
        market: pubkeyViewToAddress(event.get_market()),
        takerSeatAuthority: pubkeyViewToAddress(event.get_taker_seat_authority()),
        makerSeatAuthority: pubkeyViewToAddress(event.get_maker_seat_authority()),
      };
    }
    case 'order_posted': {
      const event = payload.asOrderPosted();
      if (!event) throw new Error('perp order_posted event payload is malformed');
      return {
        ...base,
        variant: 'order_posted',
        seatIndex: event.get_seat_idx(),
        side: eventSideFromValue(event.get_side()),
        orderType: orderTypeFromValue(event.get_order_type()),
        price: event.get_price(),
        quantity: event.get_qty(),
        orderId: event.get_order_id(),
        clientId: bytesFromView(event.get_client_id()),
        market: pubkeyViewToAddress(event.get_market()),
        seatAuthority: pubkeyViewToAddress(event.get_seat_authority()),
      };
    }
    case 'order_entry_removed': {
      const event = payload.asOrderEntryRemoved();
      if (!event) throw new Error('perp order_entry_removed event payload is malformed');
      return {
        ...base,
        variant: 'order_entry_removed',
        seatIndex: event.get_seat_idx(),
        side: eventSideFromValue(event.get_side()),
        reason: removalReasonFromValue(event.get_reason()),
        price: event.get_price(),
        quantity: event.get_qty(),
        orderId: event.get_order_id(),
        clientId: bytesFromView(event.get_client_id()),
        market: pubkeyViewToAddress(event.get_market()),
        seatAuthority: pubkeyViewToAddress(event.get_seat_authority()),
      };
    }
    case 'order_modified': {
      const event = payload.asOrderModified();
      if (!event) throw new Error('perp order_modified event payload is malformed');
      return {
        ...base,
        variant: 'order_modified',
        seatIndex: event.get_seat_idx(),
        side: eventSideFromValue(event.get_side()),
        price: event.get_price(),
        quantity: event.get_qty(),
        orderId: event.get_order_id(),
        clientId: bytesFromView(event.get_client_id()),
        expirationTime: event.get_exp_time(),
        market: pubkeyViewToAddress(event.get_market()),
        seatAuthority: pubkeyViewToAddress(event.get_seat_authority()),
      };
    }
    case 'token_deposit':
    case 'token_withdraw': {
      const event = variant.name === 'token_deposit' ? payload.asTokenDeposit() : payload.asTokenWithdraw();
      if (!event) throw new Error(`perp ${variant.name} event payload is malformed`);
      return {
        ...base,
        variant: variant.name,
        seatIndex: event.get_seat_idx(),
        amount: event.get_amount(),
        quantityQuote: event.get_quantity_quote(),
        longLots: event.get_long_lots(),
        shortLots: event.get_short_lots(),
        market: pubkeyViewToAddress(event.get_market()),
        seatAuthority: pubkeyViewToAddress(event.get_seat_authority()),
        wallet: pubkeyViewToAddress(event.get_wallet()),
        vault: pubkeyViewToAddress(event.get_vault()),
      };
    }
    case 'liquidation': {
      const event = payload.asLiquidation();
      if (!event) throw new Error('perp liquidation event payload is malformed');
      return {
        ...base,
        variant: 'liquidation',
        market: pubkeyViewToAddress(event.get_market()),
        liquidator: pubkeyViewToAddress(event.get_liquidator()),
        target: pubkeyViewToAddress(event.get_target()),
        liquidatorSeatIndex: event.get_liquidator_seat_idx(),
        targetSeatIndex: event.get_target_seat_idx(),
        lots: event.get_lots(),
        markPrice: event.get_mark_price(),
        fee: event.get_fee(),
        badDebt: event.get_bad_debt(),
        targetQuoteAfter: event.get_target_quote_after(),
        liquidatorQuoteAfter: event.get_liquidator_quote_after(),
        targetSide: liquidationSideFromValue(event.get_side()),
      };
    }
    case 'market_status':
    case 'exchange_initialized':
    case 'exchange_status':
    case 'exchange_admin':
    case 'market_exchange_status':
      return { ...base, variant: variant.name };
    default:
      throw new Error('perp event type is unsupported');
  }
}


export function assertPerpSeatIndex(value: number, label = 'seatIndex'): number {
  if (!Number.isSafeInteger(value) || value < 1 || value >= PERP_NULL_INDEX) {
    throw new Error(`${label} must be an integer between 1 and ${PERP_NULL_INDEX - 1}`);
  }
  return value;
}

/* Internals *****************************************************************/

function createTokenTransferInstruction(
  variant: 'token_deposit' | 'token_withdraw',
  args: PerpTokenTransferArgs,
): InstructionData {
  return async (context) => {
    assertU64(args.amount, 'amount');
    const payload = new TokenTransferInstructionBuilder()
      .set_market_record_idx(assertU8(args.marketRecordIndex, 'marketRecordIndex'))
      .set_token_program_idx(accountIndex(context, args.tokenProgramAccountBytes))
      .set_reserved0([0, 0, 0, 0])
      .set_amount(args.amount)
      .set_from_account_idx(accountIndex(context, args.fromAccountBytes))
      .set_to_account_idx(accountIndex(context, args.toAccountBytes))
      .set_reserved1([0, 0, 0, 0])
      .build();
    return buildPerpInstruction(variant, payload);
  };
}

function buildPerpInstruction(variant: PerpInstructionVariant, payload: Uint8Array): Uint8Array {
  const builder = new PerpInstructionBuilder();
  builder.payload().select(variant).writePayload(payload).finish();
  return builder.build();
}

function liquidationSideFromValue(value: number): 'long' | 'short' {
  if (value === 0) return 'long';
  if (value === 1) return 'short';
  throw new Error(`unknown perp liquidation side ${value}`);
}

/** Every parser goes through here, so an arena with the market magic but an
    older, shorter header (whose margin fields decode as nonsense) fails to
    parse instead of yielding a market nothing can margin against. */
function marketFromView(view: MarketAccountView): PerpMarket {
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

/** 1 <= maintenance < initial <= 10000, liquidationFeeBps <= 10000, markNum and markDen > 0. */
function assertPerpMarketHeader(market: PerpMarket): PerpMarket {
  const { initialMarginBps: initial, maintenanceMarginBps: maintenance, liquidationFeeBps: fee, markNum, markDen } = market;
  const problem = !(initial >= 1 && initial <= PERP_BPS_DENOMINATOR)
    ? `initialMarginBps ${initial} is not in 1..${PERP_BPS_DENOMINATOR}`
    : !(maintenance >= 1 && maintenance < initial)
      ? `maintenanceMarginBps ${maintenance} is not in 1..${initial - 1}`
      : fee > PERP_BPS_DENOMINATOR
        ? `liquidationFeeBps ${fee} is above ${PERP_BPS_DENOMINATOR}`
        : markDen <= 0n
          ? `markDen ${markDen} is not positive`
          : markNum <= 0n
            ? `markNum ${markNum} is not positive`
            : null;
  if (problem) throw new Error(`perp market header is not a margined market: ${problem}`);
  return market;
}


function arenaHeaderFromView(view: SeatArenaHeader | OrderArenaHeader): PerpArenaHeader {
  return { nextEntryIndex: view.get_next_entry_idx(), freeMagic: view.get_free_magic() };
}

function seatEntryFromView(view: SeatEntryView, seatIndex: number): PerpSeatEntry {
  return {
    seatIndex,
    seatAuthority: pubkeyViewToAddress(view.get_seat_authority_pubkey()),
    quantityQuote: view.get_quantity_quote(),
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

function orderEntryFromView(view: OrderEntryView, orderEntryIndex: number): PerpOrderEntry {
  const seatPtrs = view.get_seat_ptrs();
  const levelPtrs = view.get_level_ptrs();
  return {
    orderEntryIndex,
    seatNextOrderEntryIndex: bitField(seatPtrs, 0n, 20n),
    seatPreviousOrderEntryIndex: bitField(seatPtrs, 20n, 40n),
    seatIndex: bitField(seatPtrs, 40n, 60n),
    levelNextOrderEntryIndex: bitField(levelPtrs, 0n, 20n),
    levelPreviousOrderEntryIndex: bitField(levelPtrs, 20n, 40n),
    levelIndex: bitField(levelPtrs, 40n, 60n),
    levelAccountIndex: bitField(levelPtrs, 60n, 64n),
    quantityInLots: view.get_qty_in_lots(),
    orderId: view.get_order_id(),
    clientId: bytesFromView(view.get_client_id()),
    expirationTime: view.get_expiry(),
  };
}

function bookOrder(order: PerpOrderEntry, side: PerpOrderSide, cbook: PerpCbook): PerpOrderBookOrder {
  return {
    side,
    priceInTicks: priceForCbookLevel(order.levelIndex, side, cbook),
    quantityInLots: order.quantityInLots,
    orderId: order.orderId,
    orderEntryIndex: order.orderEntryIndex,
    seatIndex: order.seatIndex,
    clientId: order.clientId,
    expirationTime: order.expirationTime,
  };
}

function priceForCbookLevel(levelIndex: number, side: PerpOrderSide, cbook: PerpCbook): bigint {
  const levelCount = cbook.levels.length;
  if (levelCount === 0 || cbook.bestPriceInTicks === PERP_CBOOK_EMPTY_PRICE_IN_TICKS) {
    throw new Error(`cannot derive perp ${side} price from an empty cbook`);
  }
  if (!Number.isInteger(levelIndex) || levelIndex < 0 || levelIndex >= levelCount) {
    throw new Error(`perp ${side} level index ${levelIndex} is outside cbook level count ${levelCount}`);
  }
  const distance = levelIndex >= cbook.bestLevelIndex
    ? levelIndex - cbook.bestLevelIndex
    : levelCount - cbook.bestLevelIndex + levelIndex;
  const cbookPriceInTicks = cbook.bestPriceInTicks + BigInt(distance);
  return side === 'buy' ? PERP_CBOOK_MAX_PRICE_IN_TICKS - cbookPriceInTicks : cbookPriceInTicks;
}

function u64le(value: bigint): Uint8Array {
  assertU64(value, 'value');
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, value, true);
  return bytes;
}

function u16le(value: number): Uint8Array {
  assertU16(value, 'value');
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value, true);
  return bytes;
}


function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error('division by a non-positive denominator');
  if (numerator <= 0n) return -((-numerator) / denominator);
  return (numerator + denominator - 1n) / denominator;
}

function maxBig(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}

function assertBps(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0 || value > Number(PERP_BPS_DENOMINATOR)) {
    throw new Error(`${label} must be an integer between 0 and ${PERP_BPS_DENOMINATOR}`);
  }
  return value;
}

/** 1 <= maintenance < initial <= 10000, liquidation fee <= 10000 (market create validation). */
function assertMarginParams(params: PerpMarginParams): void {
  assertBps(params.initialMarginBps, 'initialMarginBps');
  assertBps(params.maintenanceMarginBps, 'maintenanceMarginBps');
  assertBps(params.liquidationFeeBps, 'liquidationFeeBps');
  if (params.maintenanceMarginBps < 1 || params.maintenanceMarginBps >= params.initialMarginBps) {
    throw new Error('maintenanceMarginBps must satisfy 1 <= maintenance < initialMarginBps');
  }
}

function assertOracleParams(params: PerpOracleParams): void {
  assertU64(params.markNum, 'markNum');
  assertU64(params.markDen, 'markDen');
  if (params.markNum === 0n) throw new Error('markNum must be positive');
  if (params.markDen === 0n) throw new Error('markDen must be positive');
  assertU64(params.maxMarkAgeNs, 'maxMarkAgeNs');
  if (!Number.isInteger(params.oracleExponent) || params.oracleExponent < -0x80000000 || params.oracleExponent > 0x7fffffff) {
    throw new Error('oracleExponent must be a 32-bit integer');
  }
}

async function sha256(...parts: Uint8Array[]): Promise<Uint8Array> {
  const size = parts.reduce((total, part) => total + part.length, 0);
  const joined = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  const digest = await globalThis.crypto.subtle.digest('SHA-256', joined);
  return new Uint8Array(digest);
}

function minBig(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

