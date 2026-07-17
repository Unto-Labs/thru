import { Pubkey } from '@thru/sdk';
import { encodeAddress } from '@thru/sdk/helpers';
import type { Account } from '@thru/sdk';
import {
  ArenaHeader,
  CbookAccount,
  CbookHeader,
  CbookLevel,
  ClobEvent,
  ClobInstructionBuilder,
  ClobProgramAccount,
  CreateOrderEntryInstructionBuilder,
  CreateSeatlessOrderEntryInstructionBuilder,
  MarketAccount as MarketAccountView,
  MarketCreateInstructionBuilder,
  MarketRecordInstructionBuilder,
  MarketSetStatusInstructionBuilder,
  ModifyOrderEntryInstructionBuilder,
  OrderArenaAccount,
  OrderEntry as OrderEntryView,
  SeatArenaAccount,
  SeatCreateInstructionBuilder,
  SeatEntry as SeatEntryView,
  TokenTransferInstructionBuilder,
} from './abi/thru/program/clob/types';

export {
  ArenaHeader,
  ArenaHeaderBuilder,
  CbookAccount,
  CbookHeader,
  CbookHeaderBuilder,
  CbookLevel,
  CbookLevelBuilder,
  ClientId,
  ClobError,
  ClobErrorBuilder,
  ClobEvent,
  ClobEventBuilder,
  ClobInstruction,
  ClobInstructionBuilder,
  ClobProgramAccount,
  ClobProgramAccountBuilder,
  CreateOrderEntryInstruction,
  CreateOrderEntryInstructionBuilder,
  CreateSeatlessOrderEntryInstruction,
  CreateSeatlessOrderEntryInstructionBuilder,
  MarketAccount as MarketAccountView,
  MarketAccountBuilder,
  MarketCreateInstruction,
  MarketCreateInstructionBuilder,
  MarketCreatedEvent,
  MarketCreatedEventBuilder,
  MarketRecordInstruction,
  MarketRecordInstructionBuilder,
  MarketSetStatusInstruction,
  MarketSetStatusInstructionBuilder,
  ModifyOrderEntryInstruction,
  ModifyOrderEntryInstructionBuilder,
  OrderArenaAccount,
  OrderCancelledEvent,
  OrderCancelledEventBuilder,
  OrderEntry as OrderEntryView,
  OrderEntryBuilder,
  OrderEntryRemovedEvent,
  OrderEntryRemovedEventBuilder,
  OrderFilledEvent,
  OrderFilledEventBuilder,
  OrderModifiedEvent,
  OrderModifiedEventBuilder,
  OrderPostedEvent,
  OrderPostedEventBuilder,
  SeatArenaAccount,
  SeatAssignedEvent,
  SeatAssignedEventBuilder,
  SeatCreateInstruction,
  SeatCreateInstructionBuilder,
  SeatEntry as SeatEntryView,
  SeatEntryBuilder,
  TokenBalanceEvent,
  TokenBalanceEventBuilder,
  TokenTransferInstruction,
  TokenTransferInstructionBuilder,
} from './abi/thru/program/clob/types';

export const CLOB_INSTRUCTION_MARKET_RECORD = 0;
export const CLOB_INSTRUCTION_SEAT_CREATE = 1;
export const CLOB_INSTRUCTION_TOKEN_DEPOSIT = 2;
export const CLOB_INSTRUCTION_TOKEN_WITHDRAW = 3;
export const CLOB_INSTRUCTION_CREATE_ORDER_ENTRY = 4;
export const CLOB_INSTRUCTION_MODIFY_ORDER_ENTRY = 5;
export const CLOB_INSTRUCTION_MARKET_SET_STATUS = 8;
export const CLOB_INSTRUCTION_MARKET_CREATE = 9;
export const CLOB_INSTRUCTION_CREATE_SEATLESS_ORDER_ENTRY = 10;

export const CLOB_EVENT_SEAT_ASSIGNED = 1;
export const CLOB_EVENT_ORDER_CANCELLED = 2;
export const CLOB_EVENT_MARKET_CREATED = 3;
export const CLOB_EVENT_ORDER_FILLED = 4;
export const CLOB_EVENT_ORDER_POSTED = 5;
export const CLOB_EVENT_ORDER_ENTRY_REMOVED = 6;
export const CLOB_EVENT_ORDER_MODIFIED = 7;
export const CLOB_EVENT_TOKEN_DEPOSIT = 8;
export const CLOB_EVENT_TOKEN_WITHDRAW = 9;
export const CLOB_EVENT_MARKET_STATUS = 10;

export const CLOB_EVENT_SIDE_BUY = 0;
export const CLOB_EVENT_SIDE_SELL = 1;
export const CLOB_EVENT_TOKEN_SIDE_BASE = 0;
export const CLOB_EVENT_TOKEN_SIDE_QUOTE = 1;
export const CLOB_EVENT_REMOVE_REASON_FILLED = 0;
export const CLOB_EVENT_REMOVE_REASON_EXPIRED = 1;
export const CLOB_EVENT_REMOVE_REASON_EVICTED = 2;
export const CLOB_EVENT_REMOVE_REASON_USER = 3;

export const CLOB_STATUS_FLAG_PAUSED = 1 << 0;
export const CLOB_STATUS_FLAG_POST_ONLY = 1 << 1;
export const CLOB_STATUS_FLAG_WITHDRAWALS_FROZEN = 1 << 2;
export const CLOB_STATUS_FLAG_DEPOSITS_FROZEN = 1 << 3;

export const CLOB_ORDER_TYPE_GTC = 0;
export const CLOB_ORDER_TYPE_MTL = 1;
export const CLOB_ORDER_TYPE_ALO = 2;
export const CLOB_ORDER_TYPE_IOC = 3;
export const CLOB_ORDER_TYPE_FOK = 4;

export const CLOB_ORDER_FLAG_BUY = 1 << 0;
export const CLOB_ORDER_FLAG_HAS_CLIENT_ID = 1 << 6;
export const CLOB_MODIFY_FLAG_FAIL_IF_OUT_OF_RANGE = 1 << 0;
export const CLOB_MODIFY_FLAG_HAS_CLIENT_ID = 1 << 1;
export const CLOB_MODIFY_FLAG_HAS_ORDER_ID = 1 << 2;

export const CLOB_MARKET_ACCOUNT_SIZE = 256;
export const CLOB_ARENA_HEADER_SIZE = 64;
export const CLOB_ORDER_ENTRY_SIZE = 64;
export const CLOB_SEAT_ENTRY_SIZE = 64;
export const CLOB_CBOOK_HEADER_SIZE = 16;
export const CLOB_CBOOK_LEVEL_SIZE = 8;
export const CLOB_CBOOK_MAX_SIZE = ((1 << 24) - CLOB_CBOOK_HEADER_SIZE) / CLOB_CBOOK_LEVEL_SIZE;
export const CLOB_CBOOK_EMPTY_PRICE_IN_TICKS = (1n << 64n) - 1n;
export const CLOB_CBOOK_MAX_PRICE_IN_TICKS = CLOB_CBOOK_EMPTY_PRICE_IN_TICKS - 2n - BigInt(CLOB_CBOOK_MAX_SIZE);
export const CLOB_CLIENT_ID_SIZE = 16;
export const CLOB_SEATLESS_SEAT_IDX = 1;
export const CLOB_NULL_INDEX = 0xfffff;

type ClobInstructionVariant =
  | 'market_record'
  | 'seat_create'
  | 'token_deposit'
  | 'token_withdraw'
  | 'create_order_entry'
  | 'modify_order_entry'
  | 'market_set_status'
  | 'market_create'
  | 'create_seatless_order_entry';

export type ClobOrderSide = 'buy' | 'sell';
export type ClobOrderType = 'gtc' | 'mtl' | 'alo' | 'ioc' | 'fok';

export type AccountLookupContext = {
  getAccountIndex: (pubkey: Uint8Array) => number;
};

export type InstructionData = (context: AccountLookupContext) => Promise<Uint8Array>;

export interface MarketRecordArgs {
  marketRecordIndex: number;
  seatArenaAccountBytes: Uint8Array;
  orderArenaAccountBytes: Uint8Array;
  bidsCbookAccountBytes: Uint8Array;
  asksCbookAccountBytes: Uint8Array;
  seatAuthorityAccountBytes?: Uint8Array;
  seatIndex?: number;
  tokenProgramAccountBytes: Uint8Array;
  baseVaultAccountBytes: Uint8Array;
  quoteVaultAccountBytes: Uint8Array;
  marketAuthorityAccountBytes: Uint8Array;
}

export interface MarketCreateArgs extends MarketRecordArgs {
  lotSize: bigint;
  tickSize: bigint;
  baseMintAccountBytes: Uint8Array;
  quoteMintAccountBytes: Uint8Array;
  seatArenaStateProof: Uint8Array;
  orderArenaStateProof: Uint8Array;
  bidsCbookStateProof: Uint8Array;
  asksCbookStateProof: Uint8Array;
  baseVaultStateProof: Uint8Array;
  quoteVaultStateProof: Uint8Array;
}

export interface SeatCreateArgs {
  marketRecordIndex: number;
  seatAuthorityAccountBytes: Uint8Array;
}

export interface TokenTransferArgs {
  marketRecordIndex: number;
  tokenProgramAccountBytes: Uint8Array;
  fromAccountBytes: Uint8Array;
  toAccountBytes: Uint8Array;
  amount: bigint;
}

export interface CreateOrderArgs {
  marketRecordIndex: number;
  side: ClobOrderSide;
  orderType?: ClobOrderType;
  price: bigint;
  quantity: bigint;
  expirationTime: bigint;
  clientId?: Uint8Array;
  discardAfterMatch?: boolean;
  failIfOutsideBook?: boolean;
}

export interface CreateSeatlessOrderArgs {
  marketRecordIndex: number;
  side: ClobOrderSide;
  orderType: 'ioc' | 'fok';
  price: bigint;
  quantity: bigint;
  quoteWalletBytes: Uint8Array;
  baseWalletBytes: Uint8Array;
  clientId?: Uint8Array;
}

export interface ModifyOrderArgs {
  marketRecordIndex: number;
  orderEntryIndex: number;
  quantity: bigint;
  expirationTime: bigint;
  failIfOutOfRange?: boolean;
  clientId?: Uint8Array;
  orderId?: bigint;
}

export interface MarketSetStatusArgs {
  marketRecordIndex: number;
  statusFlags: number;
}

export interface ClobMarket {
  magic: number;
  statusFlags: number;
  lotSize: bigint;
  tickSize: bigint;
  nextOrderId: bigint;
  orderEntry: string;
  bidsCbook: string;
  asksCbook: string;
  tokenProgram: string;
  baseVault: string;
  quoteVault: string;
  marketAuthority: string;
}

export interface ClobArenaHeader {
  nextEntryIndex: number;
  freeMagic: bigint;
}

export interface ClobArenaSlot<T> {
  index: number;
  active: boolean;
  entry: T;
}

export interface ClobSeatEntry {
  seatIndex: number;
  seatAuthority: string;
  quantityBase: bigint;
  quantityQuote: bigint;
  headOrderEntryIndex: number;
}

export interface ClobOrderEntry {
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

export interface ClobCbookLevel {
  levelIndex: number;
  headOrderEntryIndex: number;
  tailOrderEntryIndex: number;
}

export interface ClobCbook {
  bestLevelIndex: number;
  bestPriceInTicks: bigint;
  levels: ClobCbookLevel[];
}

export interface ClobOrderBookOrder {
  side: ClobOrderSide;
  priceInTicks: bigint;
  quantityInLots: bigint;
  orderId: bigint;
  orderEntryIndex: number;
  seatIndex: number;
  clientId: Uint8Array;
  expirationTime: bigint;
}

export interface ClobOrderBookLevel {
  side: ClobOrderSide;
  priceInTicks: bigint;
  quantityInLots: bigint;
  orders: ClobOrderBookOrder[];
}

export interface ClobOrderBookSnapshot {
  bids: ClobOrderBookLevel[];
  asks: ClobOrderBookLevel[];
  bestBid: ClobOrderBookLevel | null;
  bestAsk: ClobOrderBookLevel | null;
}


export type ClobTokenSide = 'base' | 'quote';
export type ClobOrderRemovalReason = 'filled' | 'expired' | 'evicted' | 'user';

export interface ParsedClobEventBase {
  eventType: bigint;
  variant: string;
  payload: Uint8Array;
}

export type ParsedClobEvent =
  | (ParsedClobEventBase & {
      variant: 'seat_assigned';
      seatIndex: number;
      seatAuthority: string;
      market: string;
    })
  | (ParsedClobEventBase & {
      variant: 'order_cancelled';
      seatIndex: number;
      side: ClobOrderSide;
      orderType: ClobOrderType;
      price: bigint;
      quantity: bigint;
      clientId: Uint8Array;
      market: string;
      seatAuthority: string;
    })
  | (ParsedClobEventBase & {
      variant: 'market_created';
      lotSize: bigint;
      tickSize: bigint;
      baseMint: string;
      quoteMint: string;
      marketAuthority: string;
      market: string;
      orderArena: string;
      bidsCbook: string;
      asksCbook: string;
      baseVault: string;
      quoteVault: string;
    })
  | (ParsedClobEventBase & {
      variant: 'order_filled';
      takerSeatIndex: number;
      makerSeatIndex: number;
      takerSide: ClobOrderSide;
      price: bigint;
      quantity: bigint;
      makerOrderId: bigint;
      makerClientId: Uint8Array;
      market: string;
      takerSeatAuthority: string;
      makerSeatAuthority: string;
    })
  | (ParsedClobEventBase & {
      variant: 'order_posted';
      seatIndex: number;
      side: ClobOrderSide;
      orderType: ClobOrderType;
      price: bigint;
      quantity: bigint;
      orderId: bigint;
      clientId: Uint8Array;
      market: string;
      seatAuthority: string;
    })
  | (ParsedClobEventBase & {
      variant: 'order_entry_removed';
      seatIndex: number;
      side: ClobOrderSide;
      reason: ClobOrderRemovalReason;
      price: bigint;
      quantity: bigint;
      orderId: bigint;
      clientId: Uint8Array;
      market: string;
      seatAuthority: string;
    })
  | (ParsedClobEventBase & {
      variant: 'order_modified';
      seatIndex: number;
      side: ClobOrderSide;
      price: bigint;
      quantity: bigint;
      orderId: bigint;
      clientId: Uint8Array;
      expirationTime: bigint;
      market: string;
      seatAuthority: string;
    })
  | (ParsedClobEventBase & {
      variant: 'token_deposit' | 'token_withdraw';
      seatIndex: number;
      tokenSide: ClobTokenSide;
      amount: bigint;
      quantityBase: bigint;
      quantityQuote: bigint;
      market: string;
      seatAuthority: string;
      wallet: string;
      vault: string;
    })
  | (ParsedClobEventBase & {
      variant: 'market_status';
      statusFlags: number;
      market: string;
      marketAuthority: string;
    });

export function createMarketRecordInstruction(args: MarketRecordArgs): InstructionData {
  return async (context) => {
    const payload = new MarketRecordInstructionBuilder()
      .set_market_record_idx(assertU8(args.marketRecordIndex, 'marketRecordIndex'))
      .set_seat_arena_account_idx(accountIndex(context, args.seatArenaAccountBytes))
      .set_order_arena_account_idx(accountIndex(context, args.orderArenaAccountBytes))
      .set_bids_cbook_account_idx(accountIndex(context, args.bidsCbookAccountBytes))
      .set_asks_cbook_account_idx(accountIndex(context, args.asksCbookAccountBytes))
      .set_seat_authority_account_idx(optionalAccountIndex(context, args.seatAuthorityAccountBytes))
      .set_seat_idx(args.seatIndex ?? CLOB_NULL_INDEX)
      .set_token_program_idx(accountIndex(context, args.tokenProgramAccountBytes))
      .set_base_vault_account_idx(accountIndex(context, args.baseVaultAccountBytes))
      .set_quote_vault_account_idx(accountIndex(context, args.quoteVaultAccountBytes))
      .set_market_authority_account_idx(accountIndex(context, args.marketAuthorityAccountBytes))
      .build();
    return buildClobInstruction('market_record', payload);
  };
}

export function createMarketCreateInstruction(args: MarketCreateArgs): InstructionData {
  return async (context) => {
    assertU64(args.lotSize, 'lotSize');
    assertU64(args.tickSize, 'tickSize');
    const builder = new MarketCreateInstructionBuilder()
      .set_market_record_idx(assertU8(args.marketRecordIndex, 'marketRecordIndex'))
      .set_reserved0([0, 0, 0, 0, 0, 0])
      .set_lot_size(args.lotSize)
      .set_tick_size(args.tickSize)
      .set_token_program_idx(accountIndex(context, args.tokenProgramAccountBytes))
      .set_base_mint_idx(accountIndex(context, args.baseMintAccountBytes))
      .set_quote_mint_idx(accountIndex(context, args.quoteMintAccountBytes))
      .set_seat_arena_account_idx(accountIndex(context, args.seatArenaAccountBytes))
      .set_order_arena_account_idx(accountIndex(context, args.orderArenaAccountBytes))
      .set_bids_cbook_account_idx(accountIndex(context, args.bidsCbookAccountBytes))
      .set_asks_cbook_account_idx(accountIndex(context, args.asksCbookAccountBytes))
      .set_base_vault_account_idx(accountIndex(context, args.baseVaultAccountBytes))
      .set_quote_vault_account_idx(accountIndex(context, args.quoteVaultAccountBytes))
      .set_market_authority_account_idx(accountIndex(context, args.marketAuthorityAccountBytes));
    builder.proof_seat_arena().write(args.seatArenaStateProof).finish();
    builder.proof_order_arena().write(args.orderArenaStateProof).finish();
    builder.proof_bids_cbook().write(args.bidsCbookStateProof).finish();
    builder.proof_asks_cbook().write(args.asksCbookStateProof).finish();
    builder.proof_base_vault().write(args.baseVaultStateProof).finish();
    builder.proof_quote_vault().write(args.quoteVaultStateProof).finish();
    return buildClobInstruction('market_create', builder.build());
  };
}

export function createSeatCreateInstruction(args: SeatCreateArgs): InstructionData {
  return async (context) => {
    const payload = new SeatCreateInstructionBuilder()
      .set_market_record_idx(assertU8(args.marketRecordIndex, 'marketRecordIndex'))
      .set_seat_authority_account_idx(accountIndex(context, args.seatAuthorityAccountBytes))
      .set_reserved0([0, 0, 0, 0])
      .build();
    return buildClobInstruction('seat_create', payload);
  };
}

export function createTokenDepositInstruction(args: TokenTransferArgs): InstructionData {
  return createTokenTransferInstruction('token_deposit', args);
}

export function createTokenWithdrawInstruction(args: TokenTransferArgs): InstructionData {
  return createTokenTransferInstruction('token_withdraw', args);
}

export function createOrderEntryInstruction(args: CreateOrderArgs): InstructionData {
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
      .set_exp_time(args.expirationTime);
    if (args.clientId) builder.client_id().write(assertClientId(args.clientId)).finish();
    return buildClobInstruction('create_order_entry', builder.build());
  };
}

export function createSeatlessOrderEntryInstruction(args: CreateSeatlessOrderArgs): InstructionData {
  return async (context) => {
    const flags = orderFlags(args);
    assertU64(args.price, 'price');
    assertU64(args.quantity, 'quantity');
    const builder = new CreateSeatlessOrderEntryInstructionBuilder()
      .set_instruction_flags(flags)
      .set_market_record_idx(assertU8(args.marketRecordIndex, 'marketRecordIndex'))
      .set_reserved0([0, 0, 0, 0, 0])
      .set_price(args.price)
      .set_quantity(args.quantity)
      .set_quote_wallet_idx(accountIndex(context, args.quoteWalletBytes))
      .set_base_wallet_idx(accountIndex(context, args.baseWalletBytes))
      .set_reserved1([0, 0, 0, 0]);
    if (args.clientId) builder.client_id().write(assertClientId(args.clientId)).finish();
    return buildClobInstruction('create_seatless_order_entry', builder.build());
  };
}

export function createModifyOrderEntryInstruction(args: ModifyOrderArgs): InstructionData {
  return async () => {
    let flags = args.failIfOutOfRange ? CLOB_MODIFY_FLAG_FAIL_IF_OUT_OF_RANGE : 0;
    if (args.clientId) flags |= CLOB_MODIFY_FLAG_HAS_CLIENT_ID;
    if (args.orderId !== undefined) flags |= CLOB_MODIFY_FLAG_HAS_ORDER_ID;
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
    return buildClobInstruction('modify_order_entry', builder.build());
  };
}

export function createMarketSetStatusInstruction(args: MarketSetStatusArgs): InstructionData {
  return async () => {
    const payload = new MarketSetStatusInstructionBuilder()
      .set_market_record_idx(assertU8(args.marketRecordIndex, 'marketRecordIndex'))
      .set_status_flags(assertU8(args.statusFlags, 'statusFlags'))
      .set_reserved0([0, 0, 0, 0, 0])
      .build();
    return buildClobInstruction('market_set_status', payload);
  };
}

export function parseClobProgramAccount(accountOrData: Account | Uint8Array): ClobMarket {
  const data = accountData(accountOrData, 'CLOB program account');
  const parsed = ClobProgramAccount.from_array(data);
  if (!parsed) throw new Error('CLOB program account data is malformed');
  return marketFromView(parsed.get_market());
}

export function parseMarketAccount(accountOrData: Account | Uint8Array): ClobMarket {
  const data = accountData(accountOrData, 'CLOB market account');
  const parsed = MarketAccountView.from_array(data);
  if (!parsed) throw new Error('CLOB market account data is malformed');
  return marketFromView(parsed);
}

export function parseSeatArenaAccount(accountOrData: Account | Uint8Array): {
  market: ClobMarket;
  header: ClobArenaHeader;
  slots: ClobArenaSlot<ClobSeatEntry>[];
  seats: ClobSeatEntry[];
  seatlessSeat: ClobArenaSlot<ClobSeatEntry> | null;
} {
  const data = accountData(accountOrData, 'CLOB seat arena account');
  const parsed = SeatArenaAccount.from_array(data);
  if (!parsed) throw new Error('CLOB seat arena account data is malformed');
  const slots = parsed.get_entries().map((entry, idx) => {
    const arenaIndex = idx + 1;
    return {
      index: arenaIndex,
      active: isActiveSeatEntry(entry),
      entry: seatEntryFromView(entry, arenaIndex),
    };
  });
  const seatlessSeat = slots.find((slot) => slot.index === CLOB_SEATLESS_SEAT_IDX && slot.active) ?? null;
  return {
    market: marketFromView(parsed.get_market()),
    header: arenaHeaderFromView(parsed.get_header()),
    slots,
    seats: slots
      .filter((slot) => slot.active && slot.index !== CLOB_SEATLESS_SEAT_IDX)
      .map((slot) => slot.entry),
    seatlessSeat,
  };
}

export function parseOrderArenaAccount(accountOrData: Account | Uint8Array): {
  header: ClobArenaHeader;
  slots: ClobArenaSlot<ClobOrderEntry>[];
  orders: ClobOrderEntry[];
} {
  const data = accountData(accountOrData, 'CLOB order arena account');
  const parsed = OrderArenaAccount.from_array(data);
  if (!parsed) throw new Error('CLOB order arena account data is malformed');
  const slots = parsed.get_entries().map((entry, idx) => {
    const arenaIndex = idx + 1;
    return {
      index: arenaIndex,
      active: isActiveOrderEntry(entry),
      entry: orderEntryFromView(entry, arenaIndex),
    };
  });
  return {
    header: arenaHeaderFromView(parsed.get_header()),
    slots,
    orders: slots.filter((slot) => slot.active).map((slot) => slot.entry),
  };
}

export function parseCbookAccount(accountOrData: Account | Uint8Array): ClobCbook {
  const data = accountData(accountOrData, 'CLOB cbook account');
  const parsed = CbookAccount.from_array(data);
  if (!parsed) throw new Error('CLOB cbook account data is malformed');
  const header = parsed.get_header();
  return {
    bestLevelIndex: header.get_best_level_idx(),
    bestPriceInTicks: header.get_best_price_in_ticks(),
    levels: parsed.get_levels().map((level, idx) => cbookLevelFromView(level, idx)),
  };
}

export function buildOrderBookSnapshot(args: {
  bids: Array<ClobOrderBookOrder | ClobOrderEntry>;
  asks: Array<ClobOrderBookOrder | ClobOrderEntry>;
  bidsCbook?: ClobCbook;
  asksCbook?: ClobCbook;
  bidPrices?: Map<number, bigint> | Record<number, bigint>;
  askPrices?: Map<number, bigint> | Record<number, bigint>;
}): ClobOrderBookSnapshot {
  const bids = groupByPrice(args.bids.map((order) => normalizeBookOrder(order, 'buy', args.bidsCbook, args.bidPrices)), 'buy');
  const asks = groupByPrice(args.asks.map((order) => normalizeBookOrder(order, 'sell', args.asksCbook, args.askPrices)), 'sell');
  return {
    bids,
    asks,
    bestBid: bids[0] ?? null,
    bestAsk: asks[0] ?? null,
  };
}

export function parseClobEvent(data: Uint8Array): ParsedClobEvent {
  const parsed = ClobEvent.from_array(data);
  if (!parsed) throw new Error('CLOB event data is malformed');
  const variant = parsed.payloadVariant();
  if (!variant) throw new Error('CLOB event type is unknown');

  const eventType = parsed.get_event_type();
  const payload = parsed.payload();
  const base = {
    eventType,
    variant: variant.name,
    payload: payload.bytes(),
  };

  switch (variant.name) {
    case 'seat_assigned': {
      const event = payload.asSeatAssigned();
      if (!event) throw new Error('CLOB seat_assigned event payload is malformed');
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
      if (!event) throw new Error('CLOB order_cancelled event payload is malformed');
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
      if (!event) throw new Error('CLOB market_created event payload is malformed');
      return {
        ...base,
        variant: 'market_created',
        lotSize: event.get_lot_size(),
        tickSize: event.get_tick_size(),
        baseMint: pubkeyViewToAddress(event.get_base_mint()),
        quoteMint: pubkeyViewToAddress(event.get_quote_mint()),
        marketAuthority: pubkeyViewToAddress(event.get_market_authority()),
        market: pubkeyViewToAddress(event.get_market()),
        orderArena: pubkeyViewToAddress(event.get_order_arena()),
        bidsCbook: pubkeyViewToAddress(event.get_bids_cbook()),
        asksCbook: pubkeyViewToAddress(event.get_asks_cbook()),
        baseVault: pubkeyViewToAddress(event.get_base_vault()),
        quoteVault: pubkeyViewToAddress(event.get_quote_vault()),
      };
    }
    case 'order_filled': {
      const event = payload.asOrderFilled();
      if (!event) throw new Error('CLOB order_filled event payload is malformed');
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
        market: pubkeyViewToAddress(event.get_market()),
        takerSeatAuthority: pubkeyViewToAddress(event.get_taker_seat_authority()),
        makerSeatAuthority: pubkeyViewToAddress(event.get_maker_seat_authority()),
      };
    }
    case 'order_posted': {
      const event = payload.asOrderPosted();
      if (!event) throw new Error('CLOB order_posted event payload is malformed');
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
      if (!event) throw new Error('CLOB order_entry_removed event payload is malformed');
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
      if (!event) throw new Error('CLOB order_modified event payload is malformed');
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
      if (!event) throw new Error(`CLOB ${variant.name} event payload is malformed`);
      return {
        ...base,
        variant: variant.name,
        seatIndex: event.get_seat_idx(),
        tokenSide: tokenSideFromValue(event.get_token_side()),
        amount: event.get_amount(),
        quantityBase: event.get_quantity_base(),
        quantityQuote: event.get_quantity_quote(),
        market: pubkeyViewToAddress(event.get_market()),
        seatAuthority: pubkeyViewToAddress(event.get_seat_authority()),
        wallet: pubkeyViewToAddress(event.get_wallet()),
        vault: pubkeyViewToAddress(event.get_vault()),
      };
    }
    case 'market_status': {
      const event = payload.asMarketStatus();
      if (!event) throw new Error('CLOB market_status event payload is malformed');
      return {
        ...base,
        variant: 'market_status',
        statusFlags: event.get_status_flags(),
        market: pubkeyViewToAddress(event.get_market()),
        marketAuthority: pubkeyViewToAddress(event.get_market_authority()),
      };
    }
    default:
      throw new Error('CLOB event type is unsupported');
  }
}

export function encodeOrderFlags(args: {
  side: ClobOrderSide;
  orderType?: ClobOrderType;
  clientId?: Uint8Array;
  discardAfterMatch?: boolean;
  failIfOutsideBook?: boolean;
}): number {
  return orderFlags(args);
}

function buildModifyOrderMetadata(args: ModifyOrderArgs): Uint8Array {
  const metadata = new Uint8Array((args.clientId ? CLOB_CLIENT_ID_SIZE : 0) + (args.orderId !== undefined ? 8 : 0));
  let offset = 0;
  if (args.clientId) {
    metadata.set(assertClientId(args.clientId), offset);
    offset += CLOB_CLIENT_ID_SIZE;
  }
  if (args.orderId !== undefined) {
    assertU64(args.orderId, 'orderId');
    new DataView(metadata.buffer).setBigUint64(offset, args.orderId, true);
  }
  return metadata;
}

function createTokenTransferInstruction(
  variant: 'token_deposit' | 'token_withdraw',
  args: TokenTransferArgs
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
    return buildClobInstruction(variant, payload);
  };
}

function buildClobInstruction(variant: ClobInstructionVariant, payload: Uint8Array): Uint8Array {
  const builder = new ClobInstructionBuilder();
  builder.payload().select(variant).writePayload(payload).finish();
  return builder.build();
}

function orderFlags(args: {
  side: ClobOrderSide;
  orderType?: ClobOrderType;
  clientId?: Uint8Array;
  discardAfterMatch?: boolean;
  failIfOutsideBook?: boolean;
}): number {
  let flags = args.side === 'buy' ? CLOB_ORDER_FLAG_BUY : 0;
  flags |= orderTypeValue(args.orderType ?? 'gtc') << 1;
  if (args.discardAfterMatch) flags |= 1 << 4;
  if (args.failIfOutsideBook) flags |= 1 << 5;
  if (args.clientId) flags |= CLOB_ORDER_FLAG_HAS_CLIENT_ID;
  return flags;
}

function orderTypeValue(orderType: ClobOrderType): number {
  switch (orderType) {
    case 'gtc': return CLOB_ORDER_TYPE_GTC;
    case 'mtl': return CLOB_ORDER_TYPE_MTL;
    case 'alo': return CLOB_ORDER_TYPE_ALO;
    case 'ioc': return CLOB_ORDER_TYPE_IOC;
    case 'fok': return CLOB_ORDER_TYPE_FOK;
  }
}

function marketFromView(view: MarketAccountView): ClobMarket {
  return {
    magic: view.get_magic(),
    statusFlags: view.get_status_flags(),
    lotSize: view.get_lot_size(),
    tickSize: view.get_tick_size(),
    nextOrderId: view.get_next_order_id(),
    orderEntry: pubkeyViewToAddress(view.get_order_entry_pubkey()),
    bidsCbook: pubkeyViewToAddress(view.get_bids_cbook_pubkey()),
    asksCbook: pubkeyViewToAddress(view.get_asks_cbook_pubkey()),
    tokenProgram: pubkeyViewToAddress(view.get_token_program_pubkey()),
    baseVault: pubkeyViewToAddress(view.get_base_vault_pubkey()),
    quoteVault: pubkeyViewToAddress(view.get_quote_vault_pubkey()),
    marketAuthority: pubkeyViewToAddress(view.get_market_authority_pubkey()),
  };
}

function arenaHeaderFromView(view: ArenaHeader): ClobArenaHeader {
  return {
    nextEntryIndex: view.get_next_entry_idx(),
    freeMagic: view.get_free_magic(),
  };
}

function isActiveSeatEntry(view: SeatEntryView): boolean {
  return view.get_non_nullable_reserved() !== 0n;
}

function isActiveOrderEntry(view: OrderEntryView): boolean {
  return view.get_expiry() !== 0n;
}

function seatEntryFromView(view: SeatEntryView, seatIndex: number): ClobSeatEntry {
  return {
    seatIndex,
    seatAuthority: pubkeyViewToAddress(view.get_seat_authority_pubkey()),
    quantityBase: view.get_quantity_base(),
    quantityQuote: view.get_quantity_quote(),
    headOrderEntryIndex: view.get_head_order_entry_idx(),
  };
}

function orderEntryFromView(view: OrderEntryView, orderEntryIndex: number): ClobOrderEntry {
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

function cbookLevelFromView(view: CbookLevel, levelIndex: number): ClobCbookLevel {
  return {
    levelIndex,
    headOrderEntryIndex: view.get_head_entry_idx(),
    tailOrderEntryIndex: view.get_tail_entry_idx(),
  };
}

function normalizeBookOrder(
  order: ClobOrderBookOrder | ClobOrderEntry,
  side: ClobOrderSide,
  cbook?: ClobCbook,
  prices?: Map<number, bigint> | Record<number, bigint>
): ClobOrderBookOrder {
  if ('priceInTicks' in order) return order;
  return {
    side,
    priceInTicks: priceForLevel(order.levelIndex, side, cbook, prices),
    quantityInLots: order.quantityInLots,
    orderId: order.orderId,
    orderEntryIndex: order.orderEntryIndex,
    seatIndex: order.seatIndex,
    clientId: order.clientId,
    expirationTime: order.expirationTime,
  };
}

function groupByPrice(orders: ClobOrderBookOrder[], side: ClobOrderSide): ClobOrderBookLevel[] {
  const levels = new Map<bigint, ClobOrderBookLevel>();
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

function priceForLevel(
  levelIndex: number,
  side: ClobOrderSide,
  cbook?: ClobCbook,
  prices?: Map<number, bigint> | Record<number, bigint>
): bigint {
  if (cbook) return priceForCbookLevel(levelIndex, side, cbook);
  const mappedPrice = priceFromMap(levelIndex, prices);
  if (mappedPrice !== undefined) return mappedPrice;
  throw new Error('Missing CLOB ' + side + ' price for cbook level ' + levelIndex);
}

function priceFromMap(
  levelIndex: number,
  prices?: Map<number, bigint> | Record<number, bigint>
): bigint | undefined {
  if (!prices) return undefined;
  return prices instanceof Map ? prices.get(levelIndex) : prices[levelIndex];
}

function priceForCbookLevel(levelIndex: number, side: ClobOrderSide, cbook: ClobCbook): bigint {
  const levelCount = cbook.levels.length;
  if (levelCount === 0) throw new Error('Cannot derive CLOB ' + side + ' price from an empty cbook');
  if (!Number.isInteger(levelIndex) || levelIndex < 0 || levelIndex >= levelCount) {
    throw new Error('CLOB ' + side + ' level index ' + levelIndex + ' is outside cbook level count ' + levelCount);
  }
  if (cbook.bestPriceInTicks === CLOB_CBOOK_EMPTY_PRICE_IN_TICKS) {
    throw new Error('Cannot derive CLOB ' + side + ' price from an empty cbook');
  }

  const distance = levelIndex >= cbook.bestLevelIndex
    ? levelIndex - cbook.bestLevelIndex
    : levelCount - cbook.bestLevelIndex + levelIndex;
  const cbookPriceInTicks = cbook.bestPriceInTicks + BigInt(distance);
  return side === 'buy' ? CLOB_CBOOK_MAX_PRICE_IN_TICKS - cbookPriceInTicks : cbookPriceInTicks;
}

function accountData(accountOrData: Account | Uint8Array, label: string): Uint8Array {
  const data = accountOrData instanceof Uint8Array ? accountOrData : accountOrData.data?.data;
  if (!data) throw new Error(`${label} data is missing`);
  return data;
}

function optionalAccountIndex(context: AccountLookupContext, pubkey?: Uint8Array): number {
  return pubkey ? accountIndex(context, pubkey) : 0xffff;
}

function accountIndex(context: AccountLookupContext, pubkey: Uint8Array): number {
  const index = context.getAccountIndex(pubkey);
  return assertU16(index, 'account index');
}

function assertU8(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 0xff) {
    throw new Error(`${label} must be an integer between 0 and 255`);
  }
  return value;
}

function assertU16(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
    throw new Error(`${label} must be an integer between 0 and 65535`);
  }
  return value;
}

function assertU64(value: bigint, label: string): void {
  if (value < 0n || value > 0xffffffffffffffffn) {
    throw new Error(`${label} must be between 0 and 18446744073709551615`);
  }
}

function assertClientId(value: Uint8Array): Uint8Array {
  if (value.length !== CLOB_CLIENT_ID_SIZE) {
    throw new Error(`clientId must be ${CLOB_CLIENT_ID_SIZE} bytes`);
  }
  return value;
}

function bitField(value: bigint, begin: bigint, end: bigint): number {
  const mask = (1n << (end - begin)) - 1n;
  return Number((value >> begin) & mask);
}

function eventSideFromValue(value: number): ClobOrderSide {
  if (value === CLOB_EVENT_SIDE_BUY) return 'buy';
  if (value === CLOB_EVENT_SIDE_SELL) return 'sell';
  throw new Error(`unknown CLOB event side: ${value}`);
}

function tokenSideFromValue(value: number): ClobTokenSide {
  if (value === CLOB_EVENT_TOKEN_SIDE_BASE) return 'base';
  if (value === CLOB_EVENT_TOKEN_SIDE_QUOTE) return 'quote';
  throw new Error(`unknown CLOB token side: ${value}`);
}

function removalReasonFromValue(value: number): ClobOrderRemovalReason {
  switch (value) {
    case CLOB_EVENT_REMOVE_REASON_FILLED: return 'filled';
    case CLOB_EVENT_REMOVE_REASON_EXPIRED: return 'expired';
    case CLOB_EVENT_REMOVE_REASON_EVICTED: return 'evicted';
    case CLOB_EVENT_REMOVE_REASON_USER: return 'user';
    default: throw new Error(`unknown CLOB removal reason: ${value}`);
  }
}

function orderTypeFromValue(value: number): ClobOrderType {
  switch (value) {
    case CLOB_ORDER_TYPE_GTC: return 'gtc';
    case CLOB_ORDER_TYPE_MTL: return 'mtl';
    case CLOB_ORDER_TYPE_ALO: return 'alo';
    case CLOB_ORDER_TYPE_IOC: return 'ioc';
    case CLOB_ORDER_TYPE_FOK: return 'fok';
    default: throw new Error(`unknown CLOB order type: ${value}`);
  }
}

function pubkeyViewToAddress(pubkey: unknown): string {
  return encodeAddress(bytesFromView(pubkey));
}

function bytesFromView(value: unknown): Uint8Array {
  const buffer = (value as { buffer?: Uint8Array }).buffer;
  if (buffer instanceof Uint8Array) return new Uint8Array(buffer);
  if (value instanceof Pubkey) return value.toBytes();
  throw new Error('generated view did not expose a byte buffer');
}
