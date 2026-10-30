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
  assertU32,
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
  CbookHeader,
  CreateOrderEntryInstructionBuilder,
  ExchangeInitializeInstructionBuilder,
  ExchangeMetaAccount,
  ExchangeSetAdminInstructionBuilder,
  ExchangeSetStatusInstructionBuilder,
  FeeClaimInstructionBuilder,
  FundingUpdateInstructionBuilder,
  LiquidateInstructionBuilder,
  MarginAccount as MarginAccountView,
  MarginAccountCreateInstructionBuilder,
  MarginLinkInstructionBuilder,
  MarginRecordEntryBuilder,
  MarginTransferInstructionBuilder,
  MarketAccount as MarketAccountView,
  MarketSetCrossInstructionBuilder,
  MarketSetFeesInstructionBuilder,
  MarketSetVaultInstructionBuilder,
  MarketCreateInstructionBuilder,
  MarketRecordInstructionBuilder,
  MarketSetFundingInstructionBuilder,
  SettleFundingInstructionBuilder,
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
  SeatSetBuilderApprovalInstructionBuilder,
  SeatSetFeeReceiverInstructionBuilder,
  TokenTransferInstructionBuilder,
} from './abi/thru/program/perp/types';

export * from './abi/thru/program/perp/types';

/* The perp program is a copy of the spot CLOB with the base asset replaced by
   a synthetic position (see thru-perps/README.md in the repository). Prices
   are quote atoms per base atom; quantities are base atoms; positions and
   resting orders are stored in lots. Nothing is locked: every position and
   resting order needs a fraction of its notional at the oracle mark

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
   more than its collateral leaves market.bad_debt.

   Funding (Lighter's model) moves quote between longs and shorts every hour
   through a cumulative index per lot; seats settle lazily, and the program
   settles a seat before it reads its equity.  The margin functions below take
   a settled seat: pass a seat through perpSettleFunding first (a no-op on a
   market without funding).

   A seat is margined alone (isolated, the default) or linked into a margin
   account (cross; see thru-perps/PLAN-CROSS-MARGIN.md): the account links up
   to eight seats, one per market, in markets sharing one quote vault, a
   linked seat's quantity_quote is a signed balance, and the account is
   margined on the sums over its links (perpCrossTotals).  Positive
   unrealized PnL of a cross seat counts toward initial margin less the
   market's cross_upnl_haircut_bps.  A transaction that needs a cross seat's
   account carries a margin record naming every link
   (createPerpMarginRecordInstruction).  The demo deployment on
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
export const PERP_INSTRUCTION_FUNDING_UPDATE = 0x12;
export const PERP_INSTRUCTION_MARKET_SET_FUNDING = 0x13;
export const PERP_INSTRUCTION_SETTLE_FUNDING = 0x14;
export const PERP_INSTRUCTION_MARGIN_ACCOUNT_CREATE = 0x15;
export const PERP_INSTRUCTION_MARGIN_RECORD = 0x16;
export const PERP_INSTRUCTION_MARGIN_LINK = 0x17;
export const PERP_INSTRUCTION_MARGIN_UNLINK = 0x18;
export const PERP_INSTRUCTION_MARGIN_TRANSFER = 0x19;
export const PERP_INSTRUCTION_MARKET_SET_VAULT = 0x1a;
export const PERP_INSTRUCTION_MARKET_SET_CROSS = 0x1b;
/* The loss waterfall (0.5.0). */
export const PERP_INSTRUCTION_INSURANCE_DEPOSIT = 0x1e;
export const PERP_INSTRUCTION_RESOLVE_BAD_DEBT = 0x21;
export const PERP_INSTRUCTION_MARKET_SET_RISK_PARAMS = 0x22;
/* Trading fees and builder codes (0.5.0). */
export const PERP_INSTRUCTION_MARKET_SET_FEES = 0x1c;
export const PERP_INSTRUCTION_FEE_CLAIM = 0x1d;
export const PERP_INSTRUCTION_SEAT_SET_FEE_RECEIVER = 0x1f;
export const PERP_INSTRUCTION_SEAT_SET_BUILDER_APPROVAL = 0x20;
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
export const PERP_ERR_FUNDING_DISABLED = -217n;
export const PERP_ERR_INVALID_FUNDING_PARAMS = -218n;
/** funding_update shared its transaction with an instruction that could move the book. */
export const PERP_ERR_FUNDING_UPDATE_NOT_ALONE = -219n;
/** A cross seat needs its account and no margin record lists it. */
export const PERP_ERR_MARGIN_ACCOUNT_MISSING = -220n;
/** A margin record does not name every link in order, or a link is not the owner's cross seat. */
export const PERP_ERR_MARGIN_LINK_MISMATCH = -221n;
export const PERP_ERR_MARGIN_LINK_LIMIT = -222n;
export const PERP_ERR_MARGIN_ALREADY_LINKED = -223n;
export const PERP_ERR_MARGIN_VAULT_MISMATCH = -224n;
export const PERP_ERR_MARGIN_SEAT_NOT_FLAT = -225n;
export const PERP_ERR_MARGIN_ACCOUNT_INVALID = -226n;
export const PERP_ERR_MARGIN_UNAUTHORIZED = -227n;
export const PERP_ERR_INVALID_CROSS_PARAMS = -228n;
/** Fee rates out of range (taker fee or builder cap above PERP_FEE_MAX_PPM,
    rebate above the taker fee, a share above 100%), or a fee claim of 0. */
export const PERP_ERR_FEE_PARAM_INVALID = -231n;
/** A fee seat cannot trade, rest, link or liquidate; a seat with a
    position, orders or a margin link cannot become one. */
export const PERP_ERR_FEE_SEAT = -232n;
/** A builder is not a fee seat of the market, belongs to the trader's own
    authority, or its rate is above PERP_FEE_MAX_PPM. */
export const PERP_ERR_BUILDER_INVALID = -233n;
/** fee_claim while the market has bad debt, or for more than its fee balance. */
export const PERP_ERR_FEE_CLAIM_BLOCKED = -234n;
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
export const PERP_EVENT_FUNDING_ROUND = 16;
export const PERP_EVENT_MARGIN = 17;
export const PERP_EVENT_FEE = 18;
export const PERP_EVENT_LOSS = 19;
export const PERP_EVENT_INSURANCE = 20;
/* Kinds of a FEE event (utils/fees.h). */
export const PERP_EVENT_FEE_TRADE = 0;
export const PERP_EVENT_FEE_CLAIM = 1;
/* Kinds of an INSURANCE event (process/event_emission.h). */
export const PERP_EVENT_INSURANCE_DEPOSIT = 0;
/** The insurance share of a liquidation fee (liqInsuranceSharePpm). */
export const PERP_EVENT_INSURANCE_LIQUIDATION = 1;
export const PERP_EVENT_INSURANCE_REWARD = 2;

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
export const PERP_MARKET_ACCOUNT_SIZE = 512;

/* Funding: mirrors thru-perps/tn_perp_program/utils/funding.h.  Rates are integer ticks of 1e-6. */
export const PERP_FUNDING_RATE_TICK = 1_000_000n;
export const PERP_FUNDING_SAMPLE_NS = 60_000_000_000n;
export const PERP_FUNDING_ROUND_NS = 3_600_000_000_000n;
export const PERP_FUNDING_PREMIUM_DIVISOR = 60n;
export const PERP_FUNDING_HOURS_PER_RATE = 8n;
export const PERP_FUNDING_PARAM_MAX = 1_000_000;
export const PERP_FUNDING_MULTIPLIER_ONE = 100;
export const PERP_FUNDING_PREMIUM_MAX = 1_000_000n;

/* Trading fees: mirrors thru-perps/tn_perp_program/utils/fees.h.  Rates are
   parts per million of filled notional. */
export const PERP_PPM_DENOMINATOR = 1_000_000n;
/** The highest taker fee and builder fee (cap, record rate, approval): 1%. */
export const PERP_FEE_MAX_PPM = 10_000;
/** How long an increase of the taker fee or of the builder cap waits. */
export const PERP_FEE_INCREASE_DELAY_NS = 3_600_000_000_000n;
/** The seat arena's header entry starts here; seat index 1 follows it. */
export const PERP_SEAT_MANAGER_RESERVED_SIZE = 512;
/** Seat flags word: bit 0 always set (an active arena entry), bit 1 cross. */
export const PERP_SEAT_FLAG_ACTIVE = 1n;
export const PERP_SEAT_FLAG_CROSS = 2n;
/** A builder's fee seat (0.5.0): isolated, flat, never trades; irreversible. */
export const PERP_SEAT_FLAG_FEE = 4n;
/* A seat's builder approval lives in its flags (utils/fees.h): bits 8-21
   the highest rate approved (ppm), bits 22-41 the builder's seat index
   (0 = no approval). */
export const PERP_SEAT_APPROVAL_PPM_SHIFT = 8n;
export const PERP_SEAT_APPROVAL_PPM_MASK = (1n << 14n) - 1n;
export const PERP_SEAT_APPROVAL_SEAT_SHIFT = 22n;
export const PERP_SEAT_APPROVAL_SEAT_MASK = (1n << 20n) - 1n;
export const PERP_MARGIN_MAGIC = 0x7a;
/** margin_account_t (432 bytes) plus one reserved byte: a length no other
    account of the program has (every other layout is a multiple of 8; see
    TN_PERP_MARGIN_ACCOUNT_SZ).  The leading byte is PERP_MARGIN_MAGIC. */
export const PERP_MARGIN_ACCOUNT_SIZE = 433;
export const PERP_MARGIN_MAX_LINKS = 8;
export const PERP_MARGIN_MAX_RECORDS = 4;
export const PERP_MARGIN_SEED_PREFIX = 'perp_margin';
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
  | 'market_set_oracle'
  | 'funding_update'
  | 'market_set_funding'
  | 'settle_funding'
  | 'margin_account_create'
  | 'margin_record'
  | 'margin_link'
  | 'margin_unlink'
  | 'margin_transfer'
  | 'market_set_vault'
  | 'market_set_cross'
  | 'market_set_fees'
  | 'fee_claim'
  | 'seat_set_fee_receiver'
  | 'seat_set_builder_approval';

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
  /** Builder code (0.5.0): every order the record's seat sends pays the fee
      seat builderSeatIndex builderFeePpm of its filled notional as taker
      (capped by the market's builder cap), and its resting orders carry
      the terms.  Needs a seat in the record; absent (0) = no builder. */
  builderSeatIndex?: number;
  /** At most PERP_FEE_MAX_PPM; 0 without a builder. */
  builderFeePpm?: number;
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

export interface PerpFundingUpdateArgs {
  marketRecordIndex: number;
}

export interface PerpSettleFundingArgs {
  marketRecordIndex: number;
  /** The seat to settle (any seat: settle_funding is permissionless). */
  targetSeatIndex: number;
}

/** Rates in ticks of 1e-6 per 8 hours (Lighter's units: 100 = 0.01%). */
export interface PerpFundingParams {
  interestRate: number;
  clampSmall: number;
  clampBig: number;
  /** 0 disables funding; 1..100 scales the premium (100 = 1x). */
  premiumMultiplier: number;
  /** Quote atoms walked into each side of the book for the impact prices. */
  impactNotional: bigint;
}

export interface PerpMarketSetFundingArgs extends PerpFundingParams {
  marketRecordIndex: number;
}

/** A market's funding state. */
export interface PerpFunding extends PerpFundingParams {
  /** Cumulative funding per lot, quote atoms * PERP_FUNDING_RATE_TICK (signed). */
  index: bigint;
  /** Net quote atoms the market collected from settlements. */
  balance: bigint;
  lastRoundNs: bigint;
  lastSampleNs: bigint;
  /** Premium samples of the current hour, ticks. */
  premiumSum: bigint;
  sampleCount: number;
  /** Hourly rate of the last round, ticks; positive: longs pay. */
  rate: bigint;
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
  /** Quote the vault is short of what the seats are owed, not yet resolved
      by the loss waterfall (0.5.0): while nonzero the market's withdrawals
      are frozen.  Before 0.5.0 it was only recorded (cumulative). */
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
  /** Optional so callers can build markets without funding (funding off). */
  funding?: PerpFunding;
  /** Share of a cross seat's positive unrealized PnL left out of initial
      margin, bps (0 = counted in full; absent reads as 0). */
  crossUpnlHaircutBps?: number;
  /** The loss waterfall's state (absent before 0.5.0: no insurance, no
      loss charges, nothing frozen for bad debt). */
  risk?: PerpMarketRisk;
  /** Trading fee rates (absent before 0.5.0: no fees, no builder codes).
      Every rate 0 charges nothing. */
  fees?: PerpMarketFees;
}

/** A market's trading fee rates, parts per million of filled notional
    (thru-perps/PLAN-FEES.md, utils/fees.h).  The rates in effect at a time
    are perpEffectiveFeeRates: a pending increase applies once the block
    time reaches pendingActivationNs. */
export interface PerpMarketFees extends PerpFeeParams {
  /** A pending increase of the taker fee (0: none). */
  pendingTakerFeePpm: number;
  /** A pending increase of the builder cap (0: none). */
  pendingBuilderFeeCapPpm: number;
  /** Block time (ns) the pending increases take effect (0: nothing pending). */
  pendingActivationNs: bigint;
}

/** The loss waterfall's market state (thru-perps/PLAN-WATERFALL.md). */
export interface PerpMarketRisk {
  /** Per-lot loss charge cap per 8 hour epoch, bps of a lot's notional at
      the mark (0: nothing is socialized). */
  socializeCapBps: number;
  /** Insurance draws per epoch, bps of the epoch's opening balance (0: no cap). */
  ifEpochBudgetBps: number;
  /** Paid from insurance to the liquidator of an isolated seat beyond its
      bankruptcy price, bps of the notional at the mark. */
  bankruptLiqRewardBps: number;
  feeBalance: bigint;
  insuranceBalance: bigint;
  epochId: number;
  epochIfDrawn: bigint;
  epochSocTicks: bigint;
  /** Part of badDebt charged to both sides (the rest is charged to longs). */
  badDebtBoth: bigint;
  /** Cumulative per-lot loss charges (quote atoms * 1e6) added to the
      funding index for longs (>= 0) and shorts (<= 0). */
  lossOffsetLong: bigint;
  lossOffsetShort: bigint;
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
      withdrawable amount; see perpFreeCollateral. Signed (may be negative)
      on a cross seat. */
  quantityQuote: bigint;
  /** Linked into a margin account (seat flags bit 1, PERP_SEAT_FLAG_CROSS). */
  cross?: boolean;
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
  /** The market's funding index at the seat's last settlement. */
  fundingSnapshot?: bigint;
  /** Sub-atom funding credit carried to the next settlement, [0, 1e6). */
  fundingCarry?: number;
  /** A builder's fee seat (seat flags bit 2, PERP_SEAT_FLAG_FEE, 0.5.0):
      builders are paid into it; it never trades, rests orders or links.
      Absent on any other seat and before 0.5.0. */
  feeReceiver?: boolean;
  /** The one builder the seat lets charge its resting orders as maker, up
      to maxFeePpm (seat flags bits 8-41, 0.5.0).  Absent when the seat
      approves none and before 0.5.0. */
  builderApproval?: PerpBuilderApproval;
}

export interface PerpBuilderApproval {
  builderSeatIndex: number;
  maxFeePpm: number;
}

export interface PerpMarginLink {
  /** The market's seat arena address. */
  market: string;
  seatIndex: number;
}

export interface PerpMarginAccount {
  accountId: number;
  owner: string;
  /** The quote vault every linked market uses. */
  vault: string;
  links: PerpMarginLink[];
}

/** Account totals over linked seats (see perpCrossTotals). */
export interface PerpCrossTotals {
  /** collateral + unrealized pnl */
  equity: bigint;
  /** margin equity - initial margin of positions and resting orders */
  free: bigint;
  maintenance: bigint;
  /** signed balances */
  collateral: bigint;
  hasPosition: boolean;
}

export interface PerpMarginAccountCreateArgs {
  ownerAccountBytes: Uint8Array;
  marginAccountBytes: Uint8Array;
  /** The quote vault the account's markets share. */
  vaultAccountBytes: Uint8Array;
  accountId: number;
  proof: Uint8Array;
}

export interface PerpMarginRecordEntry {
  seatArenaAccountBytes: Uint8Array;
  /** Needed only for a market where the seat has a position or resting orders. */
  oracleFeedAccountBytes?: Uint8Array;
}

export interface PerpMarginRecordArgs {
  marginRecordIndex: number;
  marginAccountBytes: Uint8Array;
  /** The exchange meta (its status flags, with each market's, gate
      withdrawals, links and transfers). */
  exchangeMetaAccountBytes: Uint8Array;
  /** Every link of the account, in the account's link order. */
  entries: PerpMarginRecordEntry[];
}

export interface PerpMarginLinkArgs {
  marginRecordIndex: number;
  marketRecordIndex: number;
}

export interface PerpMarginTransferArgs {
  marginRecordIndex: number;
  fromLink: number;
  toLink: number;
  ownerAccountBytes: Uint8Array;
  amount: bigint;
}

export interface PerpMarketSetVaultArgs {
  marketRecordIndex: number;
  exchangeAdminAccountBytes: Uint8Array;
  newVaultAccountBytes: Uint8Array;
}

export interface PerpMarketSetCrossArgs {
  marketRecordIndex: number;
  crossUpnlHaircutBps: number;
}

/** A market's fee rates, ppm of filled notional (market_set_fees; see
    PerpMarketFees for what each one charges). */
export interface PerpFeeParams {
  /** Charged to the taker: ceil(N * rate / 1e6) per create_order, N its
      cumulative filled notional.  At most PERP_FEE_MAX_PPM. */
  takerFeePpm: number;
  /** Paid to the maker of each fill: floor(n * rate / 1e6), out of the
      taker fee (at most takerFeePpm). */
  makerRebatePpm: number;
  /** The highest builder rate the market lets a record or an order charge
      (at most PERP_FEE_MAX_PPM). */
  builderFeeCapPpm: number;
  /** Share of the protocol's fees (taker fees - rebates) that goes to the
      insurance balance; the rest goes to the fee balance.  At most 1e6. */
  feeInsuranceSharePpm: number;
  /** Share of each liquidation fee that goes to the insurance balance (the
      rest to the liquidator).  At most 1e6. */
  liqInsuranceSharePpm: number;
}

export interface PerpMarketSetFeesArgs extends PerpFeeParams {
  marketRecordIndex: number;
}

export interface PerpFeeClaimArgs {
  marketRecordIndex: number;
  /** Quote atoms moved from the market's fee balance into the record's seat (> 0). */
  amount: bigint;
}

export interface PerpSeatSetFeeReceiverArgs {
  marketRecordIndex: number;
}

export interface PerpSeatSetBuilderApprovalArgs {
  marketRecordIndex: number;
  /** The builder's fee seat; 0 (with maxFeePpm 0) revokes the approval. */
  builderSeatIndex: number;
  /** 1..PERP_FEE_MAX_PPM, or 0 to revoke. */
  maxFeePpm: number;
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
  /** The builder code the order was posted with (0.5.0): a maker fill pays
      the builder min(feePpm, the seat's approval for it, the market's cap).
      Absent when the order has none and before 0.5.0. */
  builder?: PerpOrderBuilder;
}

/** An order's builder code, snapshotted from its market record at post. */
export interface PerpOrderBuilder {
  builderSeatIndex: number;
  feePpm: number;
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

/** A cbook's header and level count, without decoding its levels. */
export interface PerpCbookHeader {
  bestLevelIndex: number;
  bestPriceInTicks: bigint;
  levelCount: number;
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
      variant: 'funding_round';
      market: string;
      /** Hourly rate, ticks of 1e-6; positive: longs pay. */
      rate: bigint;
      premiumSum: bigint;
      sampleCount: number;
      /** Oracle index the round priced at, quote atoms per base atom. */
      indexPrice: bigint;
      fundingIndex: bigint;
      roundNs: bigint;
    })
  | (ParsedPerpEventBase & {
      /** The loss waterfall took a deficit (0.5.0). */
      variant: 'loss';
      market: string;
      deficit: bigint;
      feeCover: bigint;
      insuranceCover: bigint;
      socializedCover: bigint;
      /** Left outstanding in badDebt (the market stays frozen). */
      residual: bigint;
      /** Per-lot charge on the charged side, quote atoms * 1e6. */
      delta: bigint;
      oiLots: bigint;
      mark: bigint;
      badDebtAfter: bigint;
      insuranceAfter: bigint;
      epochId: number;
      chargedSide: 'long' | 'short' | 'both';
      cause: 'isolated' | 'write_off' | 'resolve';
    })
  | (ParsedPerpEventBase & {
      /** The insurance balance changed outside a loss (0.5.0). */
      variant: 'insurance';
      market: string;
      amount: bigint;
      balanceAfter: bigint;
      /** The depositor (deposit) or the liquidator (liquidation: the
          liquidator's seat in the record; reward: the liquidator paid). */
      seatIndex: number;
      /** liquidation: the insurance share of a liquidation fee. */
      kind: 'deposit' | 'liquidation' | 'reward';
    })
  | (ParsedPerpEventBase & {
      /** The fees of one create_order instruction (kind trade) or a
          protocol fee claim (kind claim: the amount in protocolFee, the
          claiming seat in seatIndex, every other amount 0) (0.5.0). */
      variant: 'fee';
      market: string;
      kind: 'trade' | 'claim';
      /** trade: how many ORDER_FILLED events of the instruction precede
          this one (the fills the maps below index); 0 for a claim. */
      fillCount: number;
      /** The taker's seat (trade) or the seat credited (claim). */
      seatIndex: number;
      /** The taker's builder (0: none). */
      builderSeatIndex: number;
      /** The rates applied (builderFeePpm already capped by the market). */
      takerFeePpm: number;
      makerRebatePpm: number;
      builderFeePpm: number;
      /** The instruction's cumulative filled notional. */
      notional: bigint;
      takerFee: bigint;
      /** Due and not paid: a strictly reducing fill the fee would have
          put below margin. */
      takerFeeWaived: bigint;
      makerRebates: bigint;
      builderFee: bigint;
      builderFeeWaived: bigint;
      /** Paid by the makers to their orders' builders. */
      makerBuilderFees: bigint;
      /** Credited to the fee balance (claim: taken from it). */
      protocolFee: bigint;
      /** Credited to the insurance balance. */
      insurance: bigint;
      /** The market's balances after the event. */
      feeBalance: bigint;
      insuranceBalance: bigint;
      /** The instruction's fills (0-based, in ORDER_FILLED order) whose
          taker fees were waived (the event's waived_map bits), ascending. */
      waivedFills: number[];
      /** The fills whose maker paid its order's builder (maker_fee_map). */
      makerBuilderFeeFills: number[];
    })
  | (ParsedPerpEventBase & {
      variant: 'margin';
      action: 'create' | 'link' | 'unlink' | 'transfer';
      linkCount: number;
      accountId: number;
      seatIndex: number;
      toSeatIndex: number;
      amount: bigint;
      marginAccount: string;
      owner: string;
      market: string;
      toMarket: string;
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

/** Mirrors margin_account_create: seed = sha256("perp_margin" || owner[32] ||
    vault[32] || account_id u32le), address = the program-defined address of
    that seed. */
export async function derivePerpMarginAccountAddress(args: {
  ownerAddress: string;
  vaultAddress: string;
  accountId: number;
  perpProgramAddress?: string;
}): Promise<{ address: string; bytes: Uint8Array; seed: Uint8Array }> {
  assertU32(args.accountId, 'accountId');
  const id = new Uint8Array(4);
  new DataView(id.buffer).setUint32(0, args.accountId, true);
  const seed = await sha256(
    new TextEncoder().encode(PERP_MARGIN_SEED_PREFIX),
    Pubkey.from(args.ownerAddress).toBytes(),
    Pubkey.from(args.vaultAddress).toBytes(),
    id,
  );
  const derived = deriveProgramAddress({ programAddress: args.perpProgramAddress ?? PERP_PROGRAM_ADDRESS, seed, ephemeral: false });
  return { address: derived.address, bytes: derived.bytes, seed };
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
> &
  Partial<Pick<PerpSeatEntry, 'cross'>>;

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

/** The oracle age the program accepts for a market's feed
    (oracle_feed_is_fresh): the market's maxMarkAgeNs, or the feed's
    maxStalenessNs when that is 0. */
export function perpOracleMaxAgeNs(market: Pick<PerpMarket, 'maxMarkAgeNs'>, feed: Pick<OracleFeed, 'common'>): bigint {
  return market.maxMarkAgeNs !== 0n ? market.maxMarkAgeNs : feed.common.maxStalenessNs;
}

/** The program's freshness rule (oracle_feed_is_fresh): a feed is fresh at
    nowNs when its last update is not after nowNs and at most
    perpOracleMaxAgeNs old (the boundary is fresh). A stale feed fails the
    program's mark reads with ORACLE_STALE. */
export function perpOracleFeedIsFresh(feed: Pick<OracleFeed, 'common'>, market: Pick<PerpMarket, 'maxMarkAgeNs'>, nowNs: bigint): boolean {
  const { lastUpdateNs } = feed.common;
  return lastUpdateNs <= nowNs && nowNs - lastUpdateNs <= perpOracleMaxAgeNs(market, feed);
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

/** What free margin reads of a market: lot size, initial margin and the
    cross haircut (absent: no haircut). */
export type PerpFreeMarket = Pick<PerpMarket, 'lotSize' | 'initialMarginBps'> & Partial<Pick<PerpMarket, 'crossUpnlHaircutBps'>>;

/** Equity initial margin decisions use: on a cross seat, positive
    unrealized pnl less ceil(upnl * crossUpnlHaircutBps / 10000); otherwise
    perpEquity. Mirrors seat_margin_equity. */
export function perpMarginEquity(
  market: Pick<PerpMarket, 'lotSize'> & Partial<Pick<PerpMarket, 'crossUpnlHaircutBps'>>,
  seat: PerpMarginSeat,
  mark: bigint,
): bigint {
  let upnl = perpUnrealizedPnl(market, seat, mark);
  const haircut = market.crossUpnlHaircutBps ?? 0;
  if (upnl > 0n && seat.cross && haircut > 0) upnl -= perpCeilBps(upnl, haircut);
  return seat.quantityQuote + upnl;
}

/** Signed: margin equity - im_position - im_orders (a cross seat's
    contribution to its account's free margin). Withdrawable when >= 0; a
    post that would make it negative fails with INSUFFICIENT_COLLATERAL. */
export function perpFreeCollateral(
  market: PerpFreeMarket,
  seat: PerpMarginSeat,
  mark: bigint,
): bigint {
  return perpMarginEquity(market, seat, mark) - perpInitialMargin(market, seat, mark);
}

/* Cross margin (mirrors thru-perps/tn_perp_program/utils/margin.h) ***********/

/** Whether a seat's flags word marks it cross (linked into a margin account). */
export function perpSeatIsCross(flags: bigint): boolean {
  return (flags & PERP_SEAT_FLAG_CROSS) !== 0n;
}

/** Whether a seat's margin depends on the mark (a position or resting orders). */
export function perpSeatHasExposure(seat: PerpMarginSeat): boolean {
  return seat.longLots + seat.shortLots + seat.openBidLots + seat.openAskLots > 0n;
}

export type PerpCrossMarket = PerpFreeMarket & Pick<PerpMarket, 'maintenanceMarginBps'>;

/** Account totals over linked seats, each already settled
    (perpSettleFunding) and valued at its market's mark.  A seat with neither
    a position nor resting orders needs no mark (the program reads none);
    any other seat without one throws. Mirrors margin_totals_add. */
export function perpCrossTotals(links: Array<{ market: PerpCrossMarket; seat: PerpMarginSeat; mark?: bigint }>): PerpCrossTotals {
  const totals: PerpCrossTotals = { equity: 0n, free: 0n, maintenance: 0n, collateral: 0n, hasPosition: false };
  for (const { market, seat, mark } of links) {
    if (mark === undefined && perpSeatHasExposure(seat)) {
      throw new Error("a linked seat with a position or resting orders needs its market's mark");
    }
    /* A flat seat's terms do not depend on the mark: any value will do. */
    const at = mark ?? 0n;
    totals.collateral += seat.quantityQuote;
    totals.equity += perpEquity(market, seat, at);
    totals.free += perpFreeCollateral(market, seat, at);
    totals.maintenance += perpMaintenanceMargin(market, seat, at);
    if (seat.longLots + seat.shortLots > 0n) totals.hasPosition = true;
  }
  return totals;
}

/** The account is liquidatable (in a market where it holds a position): it
    has a position and its equity is below its maintenance margin. */
export function perpCrossIsLiquidatable(totals: PerpCrossTotals): boolean {
  return totals.hasPosition && totals.equity < totals.maintenance;
}

/** Flat everywhere with a negative collateral sum: a liquidation writes the
    deficit off as bad debt. */
export function perpCrossIsBankruptFlat(totals: PerpCrossTotals): boolean {
  return !totals.hasPosition && totals.collateral < 0n;
}

/** A liquidation's view of an account (mirrors margin_liq_t): equity and
    maintenance margin only.  A seat without a position needs no mark; a
    seat with a position and no readable mark (stale or missing feed) is
    bounded over every mark its market can have, 0 to priceCap.  Exact when
    nothing is bounded. */
export interface PerpCrossLiquidationTotals {
  equityLow: bigint;
  equityHigh: bigint;
  /** Lower bound of the maintenance margin (an unread market adds 0). */
  maintenanceLow: bigint;
  collateral: bigint;
  hasPosition: boolean;
  /** Some market with a position had no mark. */
  bounded: boolean;
}

export type PerpCrossLiquidationMarket = Pick<PerpMarket, 'lotSize' | 'maintenanceMarginBps' | 'priceCap'>;

/** Liquidation totals over an account's seats, each settled
    (perpSettleFunding); `mark` undefined means its market's feed gives no
    mark.  Mirrors margin_liq_rest / margin_liq_add_bounded. */
export function perpCrossLiquidationTotals(
  links: Array<{ market: PerpCrossLiquidationMarket; seat: PerpMarginSeat; mark?: bigint }>,
): PerpCrossLiquidationTotals {
  const totals: PerpCrossLiquidationTotals = {
    equityLow: 0n,
    equityHigh: 0n,
    maintenanceLow: 0n,
    collateral: 0n,
    hasPosition: false,
    bounded: false,
  };
  for (const { market, seat, mark } of links) {
    const collateral = seat.quantityQuote;
    const lots = seat.longLots + seat.shortLots;
    totals.collateral += collateral;
    if (lots === 0n) {
      totals.equityLow += collateral;
      totals.equityHigh += collateral;
      continue;
    }
    totals.hasPosition = true;
    if (mark !== undefined) {
      const equity = perpEquity(market, seat, mark);
      totals.equityLow += equity;
      totals.equityHigh += equity;
      totals.maintenanceLow += perpMaintenanceMargin(market, seat, mark);
      continue;
    }
    const top = perpNotional(market, lots, market.priceCap);
    if (seat.longLots > 0n) {
      totals.equityLow += collateral - seat.entryNotional;
      totals.equityHigh += collateral + top - seat.entryNotional;
    } else {
      totals.equityLow += collateral + seat.entryNotional - top;
      totals.equityHigh += collateral + seat.entryNotional;
    }
    totals.bounded = true;
  }
  return totals;
}

/** What a liquidation of a cross seat does, given its (settled) seat in the
    liquidation's market, that market's mark (undefined: no fresh mark) and
    its account's liquidation totals (which include the seat): move the
    position at the mark ('liquidate'), cancel its resting orders there
    ('cancel'), write a flat account's deficit off ('write-off'), or nothing
    (the program refuses with NOT_LIQUIDATABLE).  Mirrors
    process_program_liquidate_instr. */
export function perpCrossLiquidationAction(
  seat: PerpMarginSeat,
  mark: bigint | undefined,
  totals: PerpCrossLiquidationTotals,
): 'liquidate' | 'cancel' | 'write-off' | null {
  const liquidatable = totals.hasPosition && totals.equityHigh < totals.maintenanceLow;
  if (seat.longLots + seat.shortLots > 0n) return mark !== undefined && liquidatable ? 'liquidate' : null;
  if (!totals.hasPosition) return totals.collateral < 0n ? 'write-off' : null;
  return seat.openBidLots + seat.openAskLots > 0n && liquidatable ? 'cancel' : null;
}

/** The most a cross liquidation pays the liquidator: the fee on the moved
    notional capped at the account's equity (its lower bound when a market
    is bounded); 0 for a bankrupt account. */
export function perpCrossLiquidationFee(market: Pick<PerpMarket, 'lotSize' | 'liquidationFeeBps'>, lots: bigint, mark: bigint, totals: PerpCrossLiquidationTotals): bigint {
  const fee = (perpNotional(market, lots, mark) * BigInt(market.liquidationFeeBps)) / PERP_BPS_DENOMINATOR;
  return minBig(fee, maxBig(totals.equityLow, 0n));
}

/** What the account can withdraw (from any linked seat): its free margin,
    bounded by its realized collateral; 0 when either is negative. */
export function perpCrossWithdrawable(totals: PerpCrossTotals): bigint {
  return maxBig(minBig(totals.free, totals.collateral), 0n);
}

/** A cross maker's fill is accepted only at or better than the mark: a
    resting bid filled at a price at or below the mark, a resting ask at or
    above it (then the seat's equity at the mark does not drop).  Mirrors
    tn_perp_maker_fill_ok; an isolated maker uses the free-margin rule. */
export function perpCrossMakerFillAllowed(makerSide: PerpOrderSide, price: bigint, mark: bigint): boolean {
  return makerSide === 'buy' ? price <= mark : price >= mark;
}

/** Collateral that can leave an isolated seat at `mark`: free collateral
    floored at zero and capped at the seat's quote balance (a cross seat:
    perpCrossWithdrawable over its account). */
export function perpWithdrawable(
  market: PerpFreeMarket,
  seat: PerpMarginSeat,
  mark: bigint,
): bigint {
  const free = perpFreeCollateral(market, seat, mark);
  return free < 0n ? 0n : free > seat.quantityQuote ? seat.quantityQuote : free;
}

/** Initial margin one lot needs at price p: ceil(lotSize * p * initialMarginBps / 10000). */
export function perpLotInitialMargin(market: Pick<PerpMarket, 'lotSize' | 'initialMarginBps'>, price: bigint): bigint {
  return perpCeilBps(market.lotSize * price, market.initialMarginBps);
}

/** Taker capacity (seat_max_buy_lots_given): closing short lots are
    always allowed; opening lots are limited by the position limit and by
    max(free, 0) / ceil(lotSize * price * initialMarginBps / 10000).  With
    trading fees (0.5.0) pass `feePerLot` (perpFeePerLot at the price): every
    lot of the fill, the closing ones included, may be charged up to it, so
    the closing lots' fees come out of free first and each opened lot needs
    its margin plus its fee.  0 (the default, and any market without fees)
    is the bound without fees. */
export function perpMaxBuyLots(market: PerpMarginMarket, seat: PerpMarginSeat, price: bigint, mark: bigint, feePerLot = 0n): bigint {
  const capacity = maxBig(market.maxPositionLots - seat.longLots - seat.openBidLots, 0n);
  return seat.shortLots + minBig(capacity, affordableLots(market, seat, price, mark, seat.shortLots, feePerLot));
}

export function perpMaxSellLots(market: PerpMarginMarket, seat: PerpMarginSeat, price: bigint, mark: bigint, feePerLot = 0n): bigint {
  const capacity = maxBig(market.maxPositionLots - seat.shortLots - seat.openAskLots, 0n);
  return seat.longLots + minBig(capacity, affordableLots(market, seat, price, mark, seat.longLots, feePerLot));
}

/* Funding (bigint exact): mirrors thru-perps/tn_perp_program/utils/funding.h */

export type PerpFundingSeat = PerpMarginSeat & Pick<PerpSeatEntry, 'fundingSnapshot' | 'fundingCarry'>;

export function perpFundingEnabled(market: Pick<PerpMarket, 'funding'>): boolean {
  return (market.funding?.premiumMultiplier ?? 0) !== 0;
}

/** The hourly rate (ticks) a round turns premiumSum into. */
export function perpFundingHourlyRate(
  premiumSum: bigint,
  params: Pick<PerpFundingParams, 'interestRate' | 'clampSmall' | 'clampBig' | 'premiumMultiplier'>,
): bigint {
  const one = BigInt(PERP_FUNDING_MULTIPLIER_ONE);
  const multiplier = BigInt(params.premiumMultiplier);
  const avg = ((premiumSum / PERP_FUNDING_PREMIUM_DIVISOR) * multiplier) / one;
  const small = (BigInt(params.clampSmall) * multiplier) / one;
  const big = BigInt(params.clampBig);
  const r8 = clampBig(avg + clampBig(BigInt(params.interestRate) - avg, -small, small), -big, big);
  return r8 / PERP_FUNDING_HOURS_PER_RATE;
}

/** One premium sample (ticks); a zero impact price counts as the index.
    Mirrors thru-perps/tn_perp_program/utils/funding.h. */
export function perpFundingPremiumSample(index: bigint, impactBid: bigint, impactAsk: bigint): bigint {
  if (index <= 0n) return 0n;
  const bid = impactBid > 0n ? impactBid : index;
  const ask = impactAsk > 0n ? impactAsk : index;
  const above = bid > index ? bid - index : 0n;
  const below = ask < index ? index - ask : 0n;
  return clampBig(((above - below) * PERP_FUNDING_RATE_TICK) / index, -PERP_FUNDING_PREMIUM_MAX, PERP_FUNDING_PREMIUM_MAX);
}

/** Why market_set_funding would reject params, or null. */
export function perpFundingParamsProblem(
  market: Pick<PerpMarket, 'initialMarginBps' | 'maintenanceMarginBps'>,
  params: PerpFundingParams,
): string | null {
  const { interestRate, clampSmall, clampBig: big, premiumMultiplier, impactNotional } = params;
  if (!Number.isInteger(premiumMultiplier) || premiumMultiplier < 0 || premiumMultiplier > PERP_FUNDING_MULTIPLIER_ONE) {
    return `premiumMultiplier must be 0 (off) or 1..${PERP_FUNDING_MULTIPLIER_ONE}`;
  }
  if (premiumMultiplier === 0) return null;
  if (impactNotional <= 0n) return 'impactNotional must be positive';
  for (const [label, value] of [['interestRate', interestRate], ['clampSmall', clampSmall], ['clampBig', big]] as const) {
    if (!Number.isInteger(value) || value < 0 || value > PERP_FUNDING_PARAM_MAX) return `${label} must be 0..${PERP_FUNDING_PARAM_MAX}`;
  }
  const gapTicks = (market.initialMarginBps - market.maintenanceMarginBps) * 100;
  const hourlyCap = Math.floor(big / Number(PERP_FUNDING_HOURS_PER_RATE));
  if (hourlyCap > gapTicks) {
    return `clampBig / ${PERP_FUNDING_HOURS_PER_RATE} (${hourlyCap} ticks per hour) exceeds the initial - maintenance margin gap (${gapTicks} ticks)`;
  }
  return null;
}

/** The largest clampBig the market's margins allow: one hour at the cap
    moves a seat by at most the initial - maintenance margin gap. */
export function perpFundingMaxClampBig(market: Pick<PerpMarket, 'initialMarginBps' | 'maintenanceMarginBps'>): number {
  const gapTicks = Math.max(market.initialMarginBps - market.maintenanceMarginBps, 0) * 100;
  return Math.min(gapTicks * Number(PERP_FUNDING_HOURS_PER_RATE), PERP_FUNDING_PARAM_MAX);
}

/** Block time (ns) of the next hour boundary: the earliest the next round runs. */
export function perpNextFundingRoundNs(funding: Pick<PerpFunding, 'lastRoundNs'>): bigint {
  return (funding.lastRoundNs / PERP_FUNDING_ROUND_NS + 1n) * PERP_FUNDING_ROUND_NS;
}

export function perpFundingRoundDue(funding: Pick<PerpFunding, 'lastRoundNs'>, nowNs: bigint): boolean {
  return nowNs / PERP_FUNDING_ROUND_NS > funding.lastRoundNs / PERP_FUNDING_ROUND_NS;
}

export function perpFundingSampleDue(funding: Pick<PerpFunding, 'lastSampleNs'>, nowNs: bigint): boolean {
  return nowNs / PERP_FUNDING_SAMPLE_NS > funding.lastSampleNs / PERP_FUNDING_SAMPLE_NS;
}

/** The index a seat settles against: the funding index plus the loss
    offset of its side (0.5.0; a flat seat's is the funding index). */
export function perpSeatSideIndex(market: Pick<PerpMarket, 'funding' | 'risk'>, seat: Pick<PerpSeatEntry, 'longLots' | 'shortLots'>): bigint {
  const index = market.funding?.index ?? 0n;
  if (seat.longLots > 0n) return index + (market.risk?.lossOffsetLong ?? 0n);
  if (seat.shortLots > 0n) return index + (market.risk?.lossOffsetShort ?? 0n);
  return index;
}

/** Unsettled funding credit (loss charges included) plus carry, quote
    atoms * 1e6 (positive: receives). */
export function perpSeatFundingCredit(market: Pick<PerpMarket, 'funding' | 'risk'>, seat: PerpFundingSeat): bigint {
  const index = perpSeatSideIndex(market, seat);
  const net = seat.longLots - seat.shortLots;
  return BigInt(seat.fundingCarry ?? 0) - net * (index - (seat.fundingSnapshot ?? 0n));
}

export interface PerpFundingSettlement<T> {
  /** The seat as the program sees it after settling. */
  seat: T;
  /** Atoms paid to the seat (negative: charged). */
  paid: bigint;
  /** Part of a charge that neither the collateral nor the position (a
      short's entry proceeds) could cover, written off as bad debt. */
  badDebt: bigint;
}

/** Settles the seat's funding and loss charges exactly as the program does
    before it reads a seat's equity.  Pure: returns a settled copy.  A cross seat's signed
    balance takes the whole charge (its account nets it). */
export function perpSettleFunding<T extends PerpFundingSeat>(
  market: Pick<PerpMarket, 'funding' | 'risk'>,
  seat: T,
): PerpFundingSettlement<T & Required<Pick<PerpSeatEntry, 'fundingSnapshot' | 'fundingCarry'>>> {
  const index = perpSeatSideIndex(market, seat);
  const credit = perpSeatFundingCredit(market, seat);
  const paid = floorDiv(credit, PERP_FUNDING_RATE_TICK);
  const carry = credit - paid * PERP_FUNDING_RATE_TICK;
  let quantityQuote = seat.quantityQuote + paid;
  let entryNotional = seat.entryNotional;
  let badDebt = 0n;
  if (quantityQuote < 0n && !seat.cross) {
    /* The shortfall comes out of the open position: a long's cost basis
       rises, a short's entry proceeds fall; only what a short's entry
       cannot absorb is written off. */
    const shortfall = -quantityQuote;
    quantityQuote = 0n;
    if (seat.longLots > 0n) {
      entryNotional += shortfall;
    } else {
      const absorbed = seat.shortLots > 0n ? minBig(shortfall, entryNotional) : 0n;
      entryNotional -= absorbed;
      badDebt = shortfall - absorbed;
    }
  }
  return { seat: { ...seat, quantityQuote, entryNotional, fundingSnapshot: index, fundingCarry: Number(carry) }, paid, badDebt };
}

/* Trading fees (bigint exact): mirrors thru-perps/tn_perp_program/utils/fees.h */

/** floor(x * ppm / 1e6) for x >= 0 (perp_floor_ppm). */
export function perpFloorPpm(x: bigint, ppm: number | bigint): bigint {
  return (x * BigInt(ppm)) / PERP_PPM_DENOMINATOR;
}

/** ceil(x * ppm / 1e6) for x >= 0 (perp_ceil_ppm). */
export function perpCeilPpm(x: bigint, ppm: number | bigint): bigint {
  return (x * BigInt(ppm) + PERP_PPM_DENOMINATOR - 1n) / PERP_PPM_DENOMINATOR;
}

/** Whether a seat's flags word marks it a builder's fee seat. */
export function perpSeatIsFeeReceiver(flags: bigint): boolean {
  return (flags & PERP_SEAT_FLAG_FEE) !== 0n;
}

/** The builder approval in a seat's flags word, or undefined for none. */
export function perpSeatBuilderApproval(flags: bigint): PerpBuilderApproval | undefined {
  const builderSeatIndex = Number((flags >> PERP_SEAT_APPROVAL_SEAT_SHIFT) & PERP_SEAT_APPROVAL_SEAT_MASK);
  if (builderSeatIndex === 0) return undefined;
  return { builderSeatIndex, maxFeePpm: Number((flags >> PERP_SEAT_APPROVAL_PPM_SHIFT) & PERP_SEAT_APPROVAL_PPM_MASK) };
}

const NO_FEES: Readonly<PerpFeeParams> = Object.freeze({
  takerFeePpm: 0,
  makerRebatePpm: 0,
  builderFeeCapPpm: 0,
  feeInsuranceSharePpm: 0,
  liqInsuranceSharePpm: 0,
});

/** Whether the market's pending increases have taken effect at nowNs (fee_pending_due). */
export function perpFeesPendingDue(fees: Pick<PerpMarketFees, 'pendingActivationNs'>, nowNs: bigint): boolean {
  return fees.pendingActivationNs !== 0n && nowNs >= fees.pendingActivationNs;
}

/** The rates in effect at block time nowNs (fee_taker_ppm,
    fee_builder_cap_ppm): a pending increase replaces its rate once due.
    A market without fees (before 0.5.0) charges nothing. */
export function perpEffectiveFeeRates(market: Pick<PerpMarket, 'fees'>, nowNs: bigint): PerpFeeParams {
  const fees = market.fees;
  if (!fees) return { ...NO_FEES };
  const due = perpFeesPendingDue(fees, nowNs);
  return {
    takerFeePpm: due && fees.pendingTakerFeePpm ? fees.pendingTakerFeePpm : fees.takerFeePpm,
    makerRebatePpm: fees.makerRebatePpm,
    builderFeeCapPpm: due && fees.pendingBuilderFeeCapPpm ? fees.pendingBuilderFeeCapPpm : fees.builderFeeCapPpm,
    feeInsuranceSharePpm: fees.feeInsuranceSharePpm,
    liqInsuranceSharePpm: fees.liqInsuranceSharePpm,
  };
}

/** Why market_set_fees would reject params (fee_params_valid), or null. */
export function perpFeeParamsProblem(params: PerpFeeParams): string | null {
  const ppm = Number(PERP_PPM_DENOMINATOR);
  for (const [label, value, max] of [
    ['takerFeePpm', params.takerFeePpm, PERP_FEE_MAX_PPM],
    ['builderFeeCapPpm', params.builderFeeCapPpm, PERP_FEE_MAX_PPM],
    ['makerRebatePpm', params.makerRebatePpm, PERP_FEE_MAX_PPM],
    ['feeInsuranceSharePpm', params.feeInsuranceSharePpm, ppm],
    ['liqInsuranceSharePpm', params.liqInsuranceSharePpm, ppm],
  ] as const) {
    if (!Number.isInteger(value) || value < 0 || value > max) return `${label} must be 0..${max}`;
  }
  if (params.makerRebatePpm > params.takerFeePpm) return 'makerRebatePpm must not exceed takerFeePpm';
  return null;
}

/** The market's fee state after market_set_fees(params) at nowNs (fee_set),
    or null when the program refuses it: an increase of the taker fee or of
    the builder cap over the rate in effect becomes pending for
    PERP_FEE_INCREASE_DELAY_NS (restarting the delay), a rate at or below it
    applies at once and drops its pending increase; the rebate must not
    exceed the taker fee in effect after the change. */
export function perpFeesAfterSet(fees: PerpMarketFees | undefined, nowNs: bigint, params: PerpFeeParams): PerpMarketFees | null {
  if (perpFeeParamsProblem(params)) return null;
  const current: PerpMarketFees = fees ?? { ...NO_FEES, pendingTakerFeePpm: 0, pendingBuilderFeeCapPpm: 0, pendingActivationNs: 0n };
  const effective = perpEffectiveFeeRates({ fees: current }, nowNs);
  const due = perpFeesPendingDue(current, nowNs);
  let taker = effective.takerFeePpm;
  let cap = effective.builderFeeCapPpm;
  let pendingTaker = due ? 0 : current.pendingTakerFeePpm;
  let pendingCap = due ? 0 : current.pendingBuilderFeeCapPpm;
  let at = pendingTaker || pendingCap ? current.pendingActivationNs : 0n;
  let restart = false;
  if (params.takerFeePpm <= taker) {
    taker = params.takerFeePpm;
    pendingTaker = 0;
  } else {
    pendingTaker = params.takerFeePpm;
    restart = true;
  }
  if (params.builderFeeCapPpm <= cap) {
    cap = params.builderFeeCapPpm;
    pendingCap = 0;
  } else {
    pendingCap = params.builderFeeCapPpm;
    restart = true;
  }
  if (params.makerRebatePpm > taker) return null;
  if (restart) at = nowNs + PERP_FEE_INCREASE_DELAY_NS;
  if (!pendingTaker && !pendingCap) at = 0n;
  return {
    takerFeePpm: taker,
    makerRebatePpm: params.makerRebatePpm,
    builderFeeCapPpm: cap,
    feeInsuranceSharePpm: params.feeInsuranceSharePpm,
    liqInsuranceSharePpm: params.liqInsuranceSharePpm,
    pendingTakerFeePpm: pendingTaker,
    pendingBuilderFeeCapPpm: pendingCap,
    pendingActivationNs: at,
  };
}

/** The most one lot at price can be charged as taker (fee_per_lot):
    ceil(lot * price * taker) + ceil(lot * price * builder), an upper bound
    of any fill's telescoped charge per lot.  Pass it to perpMaxBuyLots /
    perpMaxSellLots; builderFeePpm is the record's rate capped by the market
    (0 without a builder). */
export function perpFeePerLot(market: Pick<PerpMarket, 'lotSize'>, price: bigint, takerFeePpm: number, builderFeePpm = 0): bigint {
  const lot = market.lotSize * price;
  return perpCeilPpm(lot, takerFeePpm) + perpCeilPpm(lot, builderFeePpm);
}

/** One fill of a taker fee quote. */
export interface PerpFeeQuoteFill {
  /** The fill's notional (lots * lotSize * price). */
  notional: bigint;
  /** Telescoped: ceil(N_i * taker) - ceil(N_{i-1} * taker). */
  takerFee: bigint;
  /** Telescoped: floor(N_i * builder) - floor(N_{i-1} * builder). */
  builderFee: bigint;
  /** floor(notional * rebate), credited to the fill's maker. */
  makerRebate: bigint;
}

/** What one create_order instruction's fills pay as taker. */
export interface PerpTakerFeeQuote {
  /** N, the cumulative filled notional. */
  notional: bigint;
  /** The rates applied (builderFeePpm capped by the market's cap). */
  takerFeePpm: number;
  makerRebatePpm: number;
  builderFeePpm: number;
  fills: PerpFeeQuoteFill[];
  /** ceil(N * taker): the sum of the fills' taker fees. */
  takerFee: bigint;
  /** floor(N * builder), paid to the record's builder. */
  builderFee: bigint;
  makerRebates: bigint;
  /** floor((takerFee - makerRebates) * feeInsuranceShare), to insurance. */
  insurance: bigint;
  /** takerFee - makerRebates - insurance, to the fee balance. */
  protocolFee: bigint;
  /** What the taker pays: takerFee + builderFee. */
  total: bigint;
}

/** Quotes the fees of one create_order instruction's fills (notionals, in
    match order) at `rates` (perpEffectiveFeeRates at the block time) with
    the record's builder rate (0 without a builder; capped by the market's
    builder cap), as the program charges them when every charge is paid
    (a strictly reducing fill the fee would put below margin waives it on
    chain).  The totals do not depend on how the notional splits into
    fills; each maker's rebate is floored per fill. */
export function perpQuoteTakerFees(rates: PerpFeeParams, fillNotionals: readonly bigint[], builderFeePpm = 0): PerpTakerFeeQuote {
  const builder = Math.min(builderFeePpm, rates.builderFeeCapPpm);
  const fills: PerpFeeQuoteFill[] = [];
  let notional = 0n;
  let makerRebates = 0n;
  for (const n of fillNotionals) {
    if (n < 0n) throw new Error('a fill notional must be nonnegative');
    const next = notional + n;
    const fill: PerpFeeQuoteFill = {
      notional: n,
      takerFee: perpCeilPpm(next, rates.takerFeePpm) - perpCeilPpm(notional, rates.takerFeePpm),
      builderFee: perpFloorPpm(next, builder) - perpFloorPpm(notional, builder),
      makerRebate: perpFloorPpm(n, rates.makerRebatePpm),
    };
    fills.push(fill);
    makerRebates += fill.makerRebate;
    notional = next;
  }
  const takerFee = perpCeilPpm(notional, rates.takerFeePpm);
  const builderFee = perpFloorPpm(notional, builder);
  const residual = takerFee - makerRebates;
  const insurance = perpFloorPpm(residual, rates.feeInsuranceSharePpm);
  return {
    notional,
    takerFeePpm: rates.takerFeePpm,
    makerRebatePpm: rates.makerRebatePpm,
    builderFeePpm: builder,
    fills,
    takerFee,
    builderFee,
    makerRebates,
    insurance,
    protocolFee: residual - insurance,
    total: takerFee + builderFee,
  };
}

/** A maker fill's builder fee (tn_perp_maker_builder_fee, before its
    waivers): floor(notional * min(order rate, the seat's approval for that
    builder, the market's cap)); 0 when the order has no builder or the seat
    approves another one (or none). */
export function perpMakerBuilderFee(
  order: Pick<PerpOrderEntry, 'builder'>,
  seat: Pick<PerpSeatEntry, 'builderApproval'>,
  rates: Pick<PerpFeeParams, 'builderFeeCapPpm'>,
  notional: bigint,
): bigint {
  const builder = order.builder;
  const approval = seat.builderApproval;
  if (!builder || !approval || approval.builderSeatIndex !== builder.builderSeatIndex) return 0n;
  return perpFloorPpm(notional, Math.min(builder.feePpm, approval.maxFeePpm, rates.builderFeeCapPpm));
}

/** seat_open_capacity_lots: the lots free margin opens when each needs its
    initial margin plus feePerLot and the closeLots closed first may be
    charged feePerLot each. */
function affordableLots(market: PerpMarginMarket, seat: PerpMarginSeat, price: bigint, mark: bigint, closeLots = 0n, feePerLot = 0n): bigint {
  const perLot = perpLotInitialMargin(market, price) + feePerLot;
  let free = maxBig(perpFreeCollateral(market, seat, mark), 0n);
  if (feePerLot > 0n) free = maxBig(free - closeLots * feePerLot, 0n);
  return perLot === 0n ? market.maxPositionLots : free / perLot;
}

/** Whether a post of `lots` at `price` on `side` passes the margin check:
    free recomputed with the order's lots and notional added to the side's
    open lots and notional (so the netting against the position applies to
    the new order too), plus extFree, must stay >= 0.  For a cross seat
    extFree is perpCrossTotals(...).free over the account's other links (and
    market carries crossUpnlHaircutBps); an isolated seat leaves it out.
    Position limits are not checked here. */
export function perpCanPostOrder(
  market: PerpFreeMarket,
  seat: PerpMarginSeat,
  side: PerpOrderSide,
  lots: bigint,
  price: bigint,
  mark: bigint,
  extFree = 0n,
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
  return perpFreeCollateral(market, after, mark) + extFree >= 0n;
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
    target pays, min(notional_at_p_liq * liquidationFeeBps / 10000,
    target.quantityQuote after the transfer).  Of that fee, floor(fee *
    liqInsuranceSharePpm / 1e6) goes to insurance (0.5.0) and the liquidator
    receives the rest (liquidatorFee).  Preview only; the program is
    authoritative. */
export function perpLiquidationPreview(
  market: PerpMarginMarket & { fees?: Pick<PerpMarketFees, 'liqInsuranceSharePpm'> },
  target: PerpMarginSeat,
  mark: bigint,
): { side: 'long' | 'short'; lots: bigint; price: bigint; fee: bigint; insurance: bigint; liquidatorFee: bigint; targetQuoteAfter: bigint } | null {
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
  const insurance = perpFloorPpm(fee, market.fees?.liqInsuranceSharePpm ?? 0);
  return { side: long ? 'long' : 'short', lots, price, fee, insurance, liquidatorFee: fee - insurance, targetQuoteAfter: quoteAfterClose - fee };
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
  const builder = recordBuilderTerms(args);
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
      .set_builder_seat_idx(builder.builderSeatIndex)
      .set_builder_fee_ppm(builder.builderFeePpm)
      .set_reserved0([0, 0])
      .build();
    return buildPerpInstruction('market_record', payload);
  };
}

/** State units a market_create transaction must request. The runtime charges
    ceil((64 + data_sz) / 4096) per new account, and market_create creates five:
    the seat arena (128640 bytes: 32), the order arena (64072 bytes: 16), the
    bids and asks cbooks (96 bytes: 1 each) and the quote vault token account
    (73 bytes: 1). Requesting fewer fails with SU_EXHAUSTED. */
export const PERP_MARKET_CREATE_STATE_UNITS = 51;

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

/** Permissionless funding crank: runs a due hourly round and a due premium
    sample of the record's market (the record needs the oracle feed, not a
    seat).  A call with nothing due changes nothing. */
export function createPerpFundingUpdateInstruction(args: PerpFundingUpdateArgs): InstructionData {
  return async () => {
    const payload = new FundingUpdateInstructionBuilder()
      .set_market_record_idx(assertU8(args.marketRecordIndex, 'marketRecordIndex'))
      .set_reserved0(0)
      .set_reserved1(0)
      .build();
    return buildPerpInstruction('funding_update', payload);
  };
}

/** Permissionless: settles one seat's funding, so a seat that never trades
    still pays what it owes.  Several may follow one market record, and they
    may share a transaction with funding_update (no book instruction may). */
export function createPerpSettleFundingInstruction(args: PerpSettleFundingArgs): InstructionData {
  const targetSeatIndex = assertPerpSeatIndex(args.targetSeatIndex, 'targetSeatIndex');
  return async () => {
    const payload = new SettleFundingInstructionBuilder()
      .set_market_record_idx(assertU8(args.marketRecordIndex, 'marketRecordIndex'))
      .set_reserved0(0)
      .set_target_seat_idx(targetSeatIndex)
      .build();
    return buildPerpInstruction('settle_funding', payload);
  };
}

/** Market authority only: sets the funding parameters (premiumMultiplier 0
    disables funding).  Validated as the program does: see
    perpFundingParamsProblem. */
export function createPerpMarketSetFundingInstruction(args: PerpMarketSetFundingArgs): InstructionData {
  for (const label of ['interestRate', 'clampSmall', 'clampBig', 'premiumMultiplier'] as const) assertU32(args[label], label);
  assertU64(args.impactNotional, 'impactNotional');
  return async () => {
    const payload = new MarketSetFundingInstructionBuilder()
      .set_market_record_idx(assertU8(args.marketRecordIndex, 'marketRecordIndex'))
      .set_reserved0(0)
      .set_interest_rate(args.interestRate)
      .set_clamp_small(args.clampSmall)
      .set_clamp_big(args.clampBig)
      .set_premium_multiplier(args.premiumMultiplier)
      .set_reserved1(0)
      .set_impact_notional(args.impactNotional)
      .build();
    return buildPerpInstruction('market_set_funding', payload);
  };
}

/** The owner signs; creates the margin account at
    derivePerpMarginAccountAddress(owner, vault, accountId) with a state proof. */
export function createPerpMarginAccountCreateInstruction(args: PerpMarginAccountCreateArgs): InstructionData {
  assertU32(args.accountId, 'accountId');
  return async (context) => {
    const builder = new MarginAccountCreateInstructionBuilder()
      .set_reserved0(0)
      .set_owner_account_idx(accountIndex(context, args.ownerAccountBytes))
      .set_margin_account_idx(accountIndex(context, args.marginAccountBytes))
      .set_vault_account_idx(accountIndex(context, args.vaultAccountBytes))
      .set_account_id(args.accountId);
    builder.proof().write(args.proof).finish();
    return buildPerpInstruction('margin_account_create', builder.build());
  };
}

/** Binds a margin account for the rest of the transaction to every one of
    its linked seat arenas and their oracle feeds, in the account's link
    order (a record with a link missing, extra, reordered or substituted is
    rejected), and to the exchange meta.  One record per account per
    transaction.  Entries are zero padded to 8 bytes. */
export function createPerpMarginRecordInstruction(args: PerpMarginRecordArgs): InstructionData {
  if (!Number.isInteger(args.marginRecordIndex) || args.marginRecordIndex < 0 || args.marginRecordIndex >= PERP_MARGIN_MAX_RECORDS) {
    throw new Error(`marginRecordIndex must be 0..${PERP_MARGIN_MAX_RECORDS - 1}`);
  }
  if (args.entries.length > PERP_MARGIN_MAX_LINKS) throw new Error(`a margin account has at most ${PERP_MARGIN_MAX_LINKS} links`);
  return async (context) => {
    /* The payload after the tag: the 7 byte header, the entries, and 4
       bytes of padding when the count is odd (the instruction is a whole
       number of 8 byte words). */
    const entries = args.entries.map((entry) =>
      new MarginRecordEntryBuilder()
        .set_seat_arena_account_idx(accountIndex(context, entry.seatArenaAccountBytes))
        .set_oracle_feed_account_idx(optionalAccountIndex(context, entry.oracleFeedAccountBytes))
        .build(),
    );
    const payload = new Uint8Array(7 + entries.length * 4 + (entries.length & 1) * 4);
    const view = new DataView(payload.buffer);
    view.setUint8(0, args.marginRecordIndex);
    view.setUint16(1, accountIndex(context, args.marginAccountBytes), true);
    view.setUint8(3, entries.length);
    view.setUint16(5, accountIndex(context, args.exchangeMetaAccountBytes), true);
    entries.forEach((entry, i) => payload.set(entry, 7 + i * 4));
    return buildPerpInstruction('margin_record', payload);
  };
}

/** The seat of the market record (signed for by its authority, the margin
    account's owner) joins the account of the margin record.  The account
    with the new seat must meet initial margin. */
export function createPerpMarginLinkInstruction(args: PerpMarginLinkArgs): InstructionData {
  return createMarginLinkInstruction('margin_link', args);
}

/** The flat seat (no position, no resting orders, nonnegative balance) of
    the market record leaves the account; the rest must keep initial margin
    and a nonnegative collateral sum. */
export function createPerpMarginUnlinkInstruction(args: PerpMarginLinkArgs): InstructionData {
  return createMarginLinkInstruction('margin_unlink', args);
}

/** The owner moves collateral between two linked seats (a ledger move in
    the shared vault; the account's totals do not change). */
export function createPerpMarginTransferInstruction(args: PerpMarginTransferArgs): InstructionData {
  assertU64(args.amount, 'amount');
  return async (context) => {
    const payload = new MarginTransferInstructionBuilder()
      .set_margin_record_idx(assertU8(args.marginRecordIndex, 'marginRecordIndex'))
      .set_from_link(assertU8(args.fromLink, 'fromLink'))
      .set_to_link(assertU8(args.toLink, 'toLink'))
      .set_owner_account_idx(accountIndex(context, args.ownerAccountBytes))
      .set_reserved0(0)
      .set_amount(args.amount)
      .build();
    return buildPerpInstruction('margin_transfer', payload);
  };
}

/** Exchange admin only: moves the market's share of its quote vault (the
    tokens its ledger accounts for; other markets sharing the vault keep
    theirs) into a vault of the same mint owned by the program and points
    the market at it, so markets can share one vault.  The record carries
    the token program and the current vault.  Refused while a seat of the
    market is cross. */
export function createPerpMarketSetVaultInstruction(args: PerpMarketSetVaultArgs): InstructionData {
  return async (context) => {
    const payload = new MarketSetVaultInstructionBuilder()
      .set_market_record_idx(assertU8(args.marketRecordIndex, 'marketRecordIndex'))
      .set_exchange_admin_account_idx(accountIndex(context, args.exchangeAdminAccountBytes))
      .set_new_vault_account_idx(accountIndex(context, args.newVaultAccountBytes))
      .set_reserved0(0)
      .build();
    return buildPerpInstruction('market_set_vault', payload);
  };
}

/** Market authority only: the share of cross seats' positive unrealized PnL
    left out of initial margin (bps, at most 10000). */
export function createPerpMarketSetCrossInstruction(args: PerpMarketSetCrossArgs): InstructionData {
  const haircut = assertBps(args.crossUpnlHaircutBps, 'crossUpnlHaircutBps');
  return async () => {
    const payload = new MarketSetCrossInstructionBuilder()
      .set_market_record_idx(assertU8(args.marketRecordIndex, 'marketRecordIndex'))
      .set_reserved0(0)
      .set_cross_upnl_haircut_bps(haircut)
      .build();
    return buildPerpInstruction('market_set_cross', payload);
  };
}

/** Market authority only: sets the market's fee rates (ppm).  An increase
    of the taker fee or of the builder cap waits PERP_FEE_INCREASE_DELAY_NS
    (it is pending until then); a decrease, the rebate and the shares apply
    at once.  Validated as the program does: see perpFeeParamsProblem (the
    rebate must also stay at most the taker fee in effect after the
    change, perpFeesAfterSet). */
export function createPerpMarketSetFeesInstruction(args: PerpMarketSetFeesArgs): InstructionData {
  const problem = perpFeeParamsProblem(args);
  if (problem) throw new Error(problem);
  return async () => {
    const payload = new MarketSetFeesInstructionBuilder()
      .set_market_record_idx(assertU8(args.marketRecordIndex, 'marketRecordIndex'))
      .set_reserved0(0)
      .set_taker_fee_ppm(args.takerFeePpm)
      .set_maker_rebate_ppm(args.makerRebatePpm)
      .set_builder_fee_cap_ppm(args.builderFeeCapPpm)
      .set_fee_insurance_share_ppm(args.feeInsuranceSharePpm)
      .set_liq_insurance_share_ppm(args.liqInsuranceSharePpm)
      .build();
    return buildPerpInstruction('market_set_fees', payload);
  };
}

/** Market authority only: moves `amount` of the market's protocol fees (its
    fee balance) into the record's seat, whose authority also signs; the
    seat then withdraws it normally.  The record carries both the market
    authority and the seat.  Refused (FEE_CLAIM_BLOCKED) while the market
    has bad debt or for more than the fee balance. */
export function createPerpFeeClaimInstruction(args: PerpFeeClaimArgs): InstructionData {
  assertU64(args.amount, 'amount');
  if (args.amount === 0n) throw new Error('amount must be positive');
  return async () => {
    const payload = new FeeClaimInstructionBuilder()
      .set_market_record_idx(assertU8(args.marketRecordIndex, 'marketRecordIndex'))
      .set_reserved0(0)
      .set_reserved1(0)
      .set_amount(args.amount)
      .build();
    return buildPerpInstruction('fee_claim', payload);
  };
}

/** The record's seat (isolated, flat, without resting orders) becomes a fee
    seat builders are paid into.  Irreversible; a fee seat never trades. */
export function createPerpSeatSetFeeReceiverInstruction(args: PerpSeatSetFeeReceiverArgs): InstructionData {
  return async () => {
    const payload = new SeatSetFeeReceiverInstructionBuilder()
      .set_market_record_idx(assertU8(args.marketRecordIndex, 'marketRecordIndex'))
      .set_reserved0(0)
      .set_reserved1(0)
      .build();
    return buildPerpInstruction('seat_set_fee_receiver', payload);
  };
}

/** The record's seat approves the fee seat builderSeatIndex to charge its
    resting orders up to maxFeePpm as maker, replacing any earlier
    approval; 0 / 0 revokes.  The next fill reads it (no cancels needed). */
export function createPerpSeatSetBuilderApprovalInstruction(args: PerpSeatSetBuilderApprovalArgs): InstructionData {
  const revoke = args.builderSeatIndex === 0;
  if (revoke) {
    if (args.maxFeePpm !== 0) throw new Error('maxFeePpm must be 0 when builderSeatIndex is 0 (a revocation)');
  } else {
    assertPerpSeatIndex(args.builderSeatIndex, 'builderSeatIndex');
    assertFeePpm(args.maxFeePpm, 'maxFeePpm');
    if (args.maxFeePpm === 0) throw new Error('maxFeePpm must be positive for an approval (0 / 0 revokes)');
  }
  return async () => {
    const payload = new SeatSetBuilderApprovalInstructionBuilder()
      .set_market_record_idx(assertU8(args.marketRecordIndex, 'marketRecordIndex'))
      .set_max_fee_ppm(args.maxFeePpm)
      .set_builder_seat_idx(args.builderSeatIndex)
      .build();
    return buildPerpInstruction('seat_set_builder_approval', payload);
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

export function parsePerpMarginAccount(accountOrData: Account | Uint8Array): PerpMarginAccount {
  const data = accountData(accountOrData, 'perp margin account');
  if (data[0] !== PERP_MARGIN_MAGIC) throw new Error('account is not a perp margin account');
  if (data.length !== PERP_MARGIN_ACCOUNT_SIZE) throw new Error(`perp margin account must be ${PERP_MARGIN_ACCOUNT_SIZE} bytes`);
  const view = MarginAccountView.from_array(data);
  if (!view) throw new Error('perp margin account data is malformed');
  const linkCount = view.get_link_cnt();
  if (linkCount > PERP_MARGIN_MAX_LINKS) throw new Error(`perp margin account has ${linkCount} links`);
  return {
    accountId: view.get_account_id(),
    owner: pubkeyViewToAddress(view.get_owner()),
    vault: pubkeyViewToAddress(view.get_vault()),
    links: view
      .get_links()
      .slice(0, linkCount)
      .map((link) => ({ market: pubkeyViewToAddress(link.get_market()), seatIndex: link.get_seat_idx() })),
  };
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
    return entry.get_flags() === 0n ? null : seatEntryFromView(entry, idx + 1);
  });
  return {
    market: marketFromView(parsed.get_market()),
    header: arenaHeaderFromView(parsed.get_header()),
    slots,
    seats,
  };
}

/** Byte offset of seat `seatIndex` (1-based, as in PerpSeatEntry) in a
    seat arena account; the entry is PERP_SEAT_ENTRY_SIZE bytes long. */
export function perpSeatEntryOffset(seatIndex: number): number {
  return PERP_SEAT_ARENA_ENTRIES_OFFSET + (seatIndex - 1) * PERP_SEAT_ENTRY_SIZE;
}

/** Decodes one seat entry read on its own (a PERP_SEAT_ENTRY_SIZE slice at
    perpSeatEntryOffset), as parsePerpSeatArenaAccount would; null for a
    free slot. */
export function parsePerpSeatEntry(accountOrData: Account | Uint8Array, seatIndex: number): PerpSeatEntry | null {
  const data = accountData(accountOrData, 'perp seat entry');
  if (data.length !== PERP_SEAT_ENTRY_SIZE) {
    throw new Error(`perp seat entry must be ${PERP_SEAT_ENTRY_SIZE} bytes`);
  }
  const entry = SeatEntryView.from_array(data);
  if (!entry) throw new Error('perp seat entry data is malformed');
  return entry.get_flags() === 0n ? null : seatEntryFromView(entry, seatIndex);
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

/** Reads only the header; the level count follows from the account size,
    so a book of millions of levels costs no per-level allocation. */
export function parsePerpCbookHeader(accountOrData: Account | Uint8Array): PerpCbookHeader {
  const data = accountData(accountOrData, 'perp cbook account');
  if (data.length < PERP_CBOOK_HEADER_SIZE || (data.length - PERP_CBOOK_HEADER_SIZE) % PERP_CBOOK_LEVEL_SIZE) {
    throw new Error('perp cbook account data is malformed');
  }
  const header = CbookHeader.from_array(data.subarray(0, PERP_CBOOK_HEADER_SIZE));
  if (!header) throw new Error('perp cbook account data is malformed');
  return {
    bestLevelIndex: header.get_best_level_idx(),
    bestPriceInTicks: header.get_best_price_in_ticks(),
    levelCount: (data.length - PERP_CBOOK_HEADER_SIZE) / PERP_CBOOK_LEVEL_SIZE,
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
    case 'funding_round': {
      const event = payload.asFundingRound();
      if (!event) throw new Error('perp funding_round event payload is malformed');
      return {
        ...base,
        variant: 'funding_round',
        market: pubkeyViewToAddress(event.get_market()),
        rate: event.get_rate(),
        premiumSum: event.get_premium_sum(),
        sampleCount: event.get_sample_cnt(),
        indexPrice: event.get_index_price(),
        fundingIndex: joinI128(event.get_funding_index_lo(), event.get_funding_index_hi()),
        roundNs: event.get_round_ns(),
      };
    }
    case 'loss': {
      const event = payload.asLoss();
      if (!event) throw new Error('perp loss event payload is malformed');
      const sides = { 1: 'long', 2: 'short', 3: 'both' } as const;
      const causes = ['isolated', 'write_off', 'resolve'] as const;
      const chargedSide = sides[event.get_side() as 1 | 2 | 3];
      const cause = causes[event.get_cause()];
      if (!chargedSide) throw new Error(`unknown perp loss side ${event.get_side()}`);
      if (!cause) throw new Error(`unknown perp loss cause ${event.get_cause()}`);
      return {
        ...base,
        variant: 'loss',
        market: pubkeyViewToAddress(event.get_market()),
        deficit: event.get_deficit(),
        feeCover: event.get_fee_cover(),
        insuranceCover: event.get_ins_cover(),
        socializedCover: event.get_soc_cover(),
        residual: event.get_residual(),
        delta: event.get_delta(),
        oiLots: event.get_oi_lots(),
        mark: event.get_mark(),
        badDebtAfter: event.get_bad_debt_after(),
        insuranceAfter: event.get_insurance_after(),
        epochId: event.get_epoch_id(),
        chargedSide,
        cause,
      };
    }
    case 'insurance': {
      const event = payload.asInsurance();
      if (!event) throw new Error('perp insurance event payload is malformed');
      const kinds = { 0: 'deposit', 1: 'liquidation', 2: 'reward' } as const;
      const kind = kinds[event.get_kind() as 0 | 1 | 2];
      if (!kind) throw new Error(`unknown perp insurance kind ${event.get_kind()}`);
      return {
        ...base,
        variant: 'insurance',
        market: pubkeyViewToAddress(event.get_market()),
        amount: event.get_amount(),
        balanceAfter: event.get_balance_after(),
        seatIndex: event.get_seat_idx(),
        kind,
      };
    }
    case 'fee': {
      const event = payload.asFee();
      if (!event) throw new Error('perp fee event payload is malformed');
      const kinds = ['trade', 'claim'] as const;
      const kind = kinds[event.get_kind()];
      if (!kind) throw new Error(`unknown perp fee kind ${event.get_kind()}`);
      return {
        ...base,
        variant: 'fee',
        market: pubkeyViewToAddress(event.get_market()),
        kind,
        fillCount: event.get_fill_cnt(),
        seatIndex: event.get_seat_idx(),
        builderSeatIndex: event.get_builder_seat_idx(),
        takerFeePpm: event.get_taker_fee_ppm(),
        makerRebatePpm: event.get_maker_rebate_ppm(),
        builderFeePpm: event.get_builder_fee_ppm(),
        notional: event.get_notional(),
        takerFee: event.get_taker_fee(),
        takerFeeWaived: event.get_taker_fee_waived(),
        makerRebates: event.get_maker_rebates(),
        builderFee: event.get_builder_fee(),
        builderFeeWaived: event.get_builder_fee_waived(),
        makerBuilderFees: event.get_maker_builder_fees(),
        protocolFee: event.get_protocol_fee(),
        insurance: event.get_insurance(),
        feeBalance: event.get_fee_balance(),
        insuranceBalance: event.get_insurance_balance(),
        waivedFills: fillIndexes(event.get_waived_map()),
        makerBuilderFeeFills: fillIndexes(event.get_maker_fee_map()),
      };
    }
    case 'margin': {
      const event = payload.asMargin();
      if (!event) throw new Error('perp margin event payload is malformed');
      const actions = ['create', 'link', 'unlink', 'transfer'] as const;
      const action = actions[event.get_action()];
      if (!action) throw new Error(`unknown perp margin action ${event.get_action()}`);
      return {
        ...base,
        variant: 'margin',
        action,
        linkCount: event.get_link_cnt(),
        accountId: event.get_account_id(),
        seatIndex: event.get_seat_idx(),
        toSeatIndex: event.get_to_seat_idx(),
        amount: event.get_amount(),
        marginAccount: pubkeyViewToAddress(event.get_margin_account()),
        owner: pubkeyViewToAddress(event.get_owner()),
        market: pubkeyViewToAddress(event.get_market()),
        toMarket: pubkeyViewToAddress(event.get_to_market()),
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

/* State units ****************************************************************

   A transaction pays state units (SU) for the account footprint it adds:
   the runtime charges every writable account
   ceil((PERP_ACCOUNT_META_SIZE + data_sz) / PERP_STATE_UNIT_SIZE) after
   minus before (tn_account_state_units, tn_compute_state_unit_consumption)
   and fails the transaction with SU_EXHAUSTED when the sum exceeds the
   requested units.  An order transaction creates no account (seats and
   order entries live in fixed-size arenas), but resting an order outside
   a side's circular book grows that cbook account (obook_post_tmpl.h):

     - an empty side (best price unset) takes the price as its best, no growth;
     - a price p ticks behind the best grows when p >= level count, to p + 1 levels;
     - a price p ticks ahead of the best grows when p >= level count, to
       level count + p levels (the resting orders keep their prices);
     - growth is to max(required, 2 * level count), capped at
       PERP_CBOOK_MAX_SIZE; a price that needs more fails with
       OVER_MAX_PRICE.

   Prices are in cbook ticks: price / tick size for asks and
   PERP_CBOOK_MAX_PRICE_IN_TICKS - price / tick size for bids, so "behind
   the best" is a lower bid or a higher ask.  The cbook never shrinks. */

/** Bytes of account metadata every account footprint includes. */
export const PERP_ACCOUNT_META_SIZE = 64;
/** Bytes of account footprint one state unit pays for. */
export const PERP_STATE_UNIT_SIZE = 4096;

/** State units an account of `dataSize` bytes occupies. */
export function perpAccountStateUnits(dataSize: number): number {
  return Math.ceil((PERP_ACCOUNT_META_SIZE + dataSize) / PERP_STATE_UNIT_SIZE);
}

export function perpCbookAccountSize(levelCount: number): number {
  return PERP_CBOOK_HEADER_SIZE + levelCount * PERP_CBOOK_LEVEL_SIZE;
}

/** One side of the book as the post path sees it: its level count and best
    price in cbook ticks (PERP_CBOOK_EMPTY_PRICE_IN_TICKS when empty). */
export interface PerpCbookSideState {
  levelCount: number;
  bestPriceInTicks: bigint;
}

/** The side after resting one order at `priceInTicks` (cbook ticks), as
    bids_post_order_entry / asks_post_order_entry leave it. Matching is not
    modelled: the order rests in full, which never needs fewer levels. */
export function perpCbookAfterPost(side: PerpCbookSideState, priceInTicks: bigint): PerpCbookSideState {
  const { levelCount, bestPriceInTicks: best } = side;
  if (best === PERP_CBOOK_EMPTY_PRICE_IN_TICKS) return { levelCount, bestPriceInTicks: priceInTicks };
  const count = BigInt(levelCount);
  let required = 0n;
  if (priceInTicks >= best) {
    const offset = priceInTicks - best;
    if (offset >= count) required = offset + 1n;
  } else {
    const offset = best - priceInTicks;
    if (offset >= count) required = count + offset;
  }
  let next = levelCount;
  if (required > 0n) {
    const max = BigInt(PERP_CBOOK_MAX_SIZE);
    if (required > max) {
      throw new Error(`order price is ${required} levels from the book, more than a cbook can hold (${PERP_CBOOK_MAX_SIZE})`);
    }
    const doubled = levelCount ? minBig(count * 2n, max) : 1n;
    next = Number(required > doubled ? required : doubled);
  }
  return { levelCount: next, bestPriceInTicks: minBig(best, priceInTicks) };
}

/** A cbook price in ticks for an order price in quote atoms. */
export function perpCbookPriceInTicks(side: PerpOrderSide, price: bigint, tickSize: bigint): bigint {
  if (tickSize <= 0n) throw new Error('tickSize must be positive');
  const ticks = price / tickSize;
  return side === 'buy' ? PERP_CBOOK_MAX_PRICE_IN_TICKS - ticks : ticks;
}

/** Order types that can leave a resting order (IOC and FOK never rest). */
export function perpOrderTypeCanRest(orderType: PerpOrderType): boolean {
  return orderType === 'gtc' || orderType === 'alo' || orderType === 'mtl';
}

export interface PerpOrderStateUnitsArgs {
  /** The market's tick size in quote atoms. */
  tickSize: bigint;
  /** Current cbooks; null when a side could not be read, which then adds
      no units and marks the estimate incomplete. */
  bidsCbook: PerpCbookHeader | null;
  asksCbook: PerpCbookHeader | null;
  /** The order arena's active entries. Needed to model `cancels`: a cancel
      that empties the best level moves the best price, which changes how
      far a later order is from it. Without them cancels are ignored. */
  restingOrders?: readonly PerpOrderEntry[];
  /** Cancels that run before the orders, as in one order transaction. */
  cancels?: readonly { orderEntryIndex: number }[];
  /** Orders in transaction order: side, type (default gtc) and price in quote atoms. */
  orders: readonly { side: PerpOrderSide; orderType?: PerpOrderType; price: bigint }[];
}

export interface PerpOrderStateUnitsEstimate {
  /** State units to request. */
  stateUnits: number;
  /** Level counts before and after, per side (null when unread). */
  bids: { levelsBefore: number; levelsAfter: number } | null;
  asks: { levelsBefore: number; levelsAfter: number } | null;
  /** False when a side the orders rest on could not be read. */
  complete: boolean;
}

/** State units an order transaction needs to grow the cbooks: the
    footprint growth of each side after the cancels and then every order
    rest in transaction order. Throws when an order is further from the
    book than a cbook can hold (the program fails it with OVER_MAX_PRICE). */
export function estimatePerpOrderStateUnits(args: PerpOrderStateUnitsArgs): PerpOrderStateUnitsEstimate {
  const cancelled = new Set((args.cancels ?? []).map((cancel) => cancel.orderEntryIndex));
  const restingOrders = args.restingOrders;
  let complete = true;
  const side = (orderSide: PerpOrderSide, cbook: PerpCbookHeader | null) => {
    const orders = args.orders.filter((order) => order.side === orderSide && perpOrderTypeCanRest(order.orderType ?? 'gtc'));
    if (!cbook) {
      if (orders.length) complete = false;
      return null;
    }
    const levelAccountIndex = orderSide === 'buy' ? 0 : 1;
    const start: PerpCbookSideState = restingOrders && cancelled.size
      ? perpCbookAfterCancels(cbook, restingOrders.filter((order) => order.levelAccountIndex === levelAccountIndex), cancelled)
      : { levelCount: cbook.levelCount, bestPriceInTicks: cbook.bestPriceInTicks };
    let state = start;
    for (const order of orders) state = perpCbookAfterPost(state, perpCbookPriceInTicks(orderSide, order.price, args.tickSize));
    return { levelsBefore: start.levelCount, levelsAfter: state.levelCount };
  };
  const bids = side('buy', args.bidsCbook);
  const asks = side('sell', args.asksCbook);
  const growth = (levels: { levelsBefore: number; levelsAfter: number } | null) =>
    levels
      ? perpAccountStateUnits(perpCbookAccountSize(levels.levelsAfter)) - perpAccountStateUnits(perpCbookAccountSize(levels.levelsBefore))
      : 0;
  return { stateUnits: growth(bids) + growth(asks), bids, asks, complete };
}

/** The side's best after `cancelled` entries leave it: when the best level
    empties, the best moves to the next populated level behind it, or the
    side becomes empty (cbook_remove). Levels are populated by the active
    entries of that side. */
function perpCbookAfterCancels(cbook: PerpCbookHeader, sideOrders: readonly PerpOrderEntry[], cancelled: ReadonlySet<number>): PerpCbookSideState {
  const levelCount = cbook.levelCount;
  const empty = { levelCount, bestPriceInTicks: PERP_CBOOK_EMPTY_PRICE_IN_TICKS };
  if (cbook.bestPriceInTicks === PERP_CBOOK_EMPTY_PRICE_IN_TICKS || levelCount === 0) return { ...empty };
  const populatedBefore = new Set<number>();
  const populated = new Set<number>();
  for (const order of sideOrders) {
    populatedBefore.add(order.levelIndex);
    if (!cancelled.has(order.orderEntryIndex)) populated.add(order.levelIndex);
  }
  const best = cbook.bestLevelIndex;
  if (!populatedBefore.has(best) || populated.has(best)) {
    return { levelCount, bestPriceInTicks: cbook.bestPriceInTicks };
  }
  for (let step = 1; step < levelCount; step++) {
    if (populated.has((best + step) % levelCount)) {
      return { levelCount, bestPriceInTicks: cbook.bestPriceInTicks + BigInt(step) };
    }
  }
  return empty;
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

function createMarginLinkInstruction(variant: 'margin_link' | 'margin_unlink', args: PerpMarginLinkArgs): InstructionData {
  return async () => {
    const payload = new MarginLinkInstructionBuilder()
      .set_margin_record_idx(assertU8(args.marginRecordIndex, 'marginRecordIndex'))
      .set_market_record_idx(assertU8(args.marketRecordIndex, 'marketRecordIndex'))
      .set_reserved0([0, 0, 0, 0, 0])
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
    funding: {
      index: joinI128(view.get_funding_index_lo(), view.get_funding_index_hi()),
      balance: view.get_funding_balance(),
      lastRoundNs: view.get_funding_last_round_ns(),
      lastSampleNs: view.get_funding_last_sample_ns(),
      premiumSum: view.get_funding_premium_sum(),
      sampleCount: view.get_funding_sample_cnt(),
      rate: view.get_funding_rate(),
      interestRate: view.get_funding_interest_rate(),
      clampSmall: view.get_funding_clamp_small(),
      clampBig: view.get_funding_clamp_big(),
      premiumMultiplier: view.get_funding_premium_multiplier(),
      impactNotional: view.get_funding_impact_notional(),
    },
    crossUpnlHaircutBps: view.get_cross_upnl_haircut_bps(),
    risk: {
      socializeCapBps: view.get_socialize_cap_bps(),
      ifEpochBudgetBps: view.get_if_epoch_budget_bps(),
      bankruptLiqRewardBps: view.get_bankrupt_liq_reward_bps(),
      feeBalance: view.get_fee_balance(),
      insuranceBalance: view.get_insurance_balance(),
      epochId: view.get_epoch_id(),
      epochIfDrawn: view.get_epoch_if_drawn(),
      epochSocTicks: view.get_epoch_soc_ticks(),
      badDebtBoth: view.get_bad_debt_both(),
      lossOffsetLong: joinI128(view.get_loss_offset_long_lo(), view.get_loss_offset_long_hi()),
      lossOffsetShort: joinI128(view.get_loss_offset_short_lo(), view.get_loss_offset_short_hi()),
    },
    fees: {
      takerFeePpm: view.get_taker_fee_ppm(),
      makerRebatePpm: view.get_maker_rebate_ppm(),
      builderFeeCapPpm: view.get_builder_fee_cap_ppm(),
      feeInsuranceSharePpm: view.get_fee_insurance_share_ppm(),
      liqInsuranceSharePpm: view.get_liq_insurance_share_ppm(),
      pendingTakerFeePpm: view.get_pending_taker_fee_ppm(),
      pendingBuilderFeeCapPpm: view.get_pending_builder_fee_cap_ppm(),
      pendingActivationNs: view.get_pending_activation_ns(),
    },
  });
}

/** The set bits of a fill bitmap (bit i of word i / 64 = fill i), ascending. */
function fillIndexes(words: readonly bigint[]): number[] {
  const out: number[] = [];
  words.forEach((word, w) => {
    for (let bit = 0; bit < 64; bit++) if ((word >> BigInt(bit)) & 1n) out.push(w * 64 + bit);
  });
  return out;
}

/** A signed 128-bit value stored as two little-endian u64 words. */
function joinI128(lo: bigint, hi: bigint): bigint {
  return BigInt.asIntN(128, (hi << 64n) | lo);
}

/** 1 <= maintenance < initial <= 10000, liquidationFeeBps <= 10000, markNum
    and markDen > 0: a decoded header is a margined market (every ABI
    version's decoder checks this). */
export function assertPerpMarketHeader(market: PerpMarket): PerpMarket {
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
  const cross = perpSeatIsCross(view.get_flags());
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
    fundingSnapshot: joinI128(view.get_funding_snapshot_lo(), view.get_funding_snapshot_hi()),
    fundingCarry: view.get_funding_carry(),
    ...perpSeatFeeFields(view.get_flags()),
  };
}

/** A seat's fee seat mark and builder approval (0.5.0), set only when
    present, from its flags word. */
export function perpSeatFeeFields(flags: bigint): Pick<PerpSeatEntry, 'feeReceiver' | 'builderApproval'> {
  const builderApproval = perpSeatBuilderApproval(flags);
  return {
    ...(perpSeatIsFeeReceiver(flags) ? { feeReceiver: true } : {}),
    ...(builderApproval ? { builderApproval } : {}),
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
    ...(view.get_builder_seat_idx() ? { builder: { builderSeatIndex: view.get_builder_seat_idx(), feePpm: view.get_builder_fee_ppm() } } : {}),
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

function assertFeePpm(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0 || value > PERP_FEE_MAX_PPM) {
    throw new Error(`${label} must be an integer between 0 and ${PERP_FEE_MAX_PPM}`);
  }
  return value;
}

/** A record's builder terms, refused as market_record refuses them: a
    builder needs a seat in the record (its authority signs the terms), a
    rate needs a builder, and the rate is at most PERP_FEE_MAX_PPM.  The
    builder's seat index is a u16 in the record. */
function recordBuilderTerms(args: Pick<PerpMarketRecordArgs, 'seatIndex' | 'seatAuthorityAccountBytes' | 'builderSeatIndex' | 'builderFeePpm'>): { builderSeatIndex: number; builderFeePpm: number } {
  const builderSeatIndex = args.builderSeatIndex ?? 0;
  const builderFeePpm = assertFeePpm(args.builderFeePpm ?? 0, 'builderFeePpm');
  if (builderSeatIndex === 0) {
    if (builderFeePpm !== 0) throw new Error('builderFeePpm needs a builderSeatIndex');
    return { builderSeatIndex, builderFeePpm };
  }
  assertPerpSeatIndex(builderSeatIndex, 'builderSeatIndex');
  if (builderSeatIndex > 0xffff) throw new Error('builderSeatIndex must fit the record (at most 65535)');
  if (args.seatIndex === undefined || !args.seatAuthorityAccountBytes) {
    throw new Error('a builder code needs the seat it charges (seatIndex and seatAuthorityAccountBytes)');
  }
  return { builderSeatIndex, builderFeePpm };
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

function floorDiv(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  return numerator % denominator !== 0n && numerator < 0n !== denominator < 0n ? quotient - 1n : quotient;
}

function clampBig(value: bigint, low: bigint, high: bigint): bigint {
  return value < low ? low : value > high ? high : value;
}

function minBig(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

