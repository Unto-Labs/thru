import { createThruClient } from '@thru/sdk/client';
import { parseOracleFeedAccount } from '../../oracle/accounts';
import { deriveTokenAccountAddress } from '../../token/derivation';
import {
  buildPerpOrderBookSnapshot,
  derivePerpMarginAccountAddress,
  PERP_FEE_MAX_PPM,
  perpEffectiveFeeRates,
  perpFeeParamsProblem,
  perpFeesPendingDue,
  perpMarkFromFeed,
  perpNextFundingRoundNs,
  perpOracleFeedIsFresh,
  perpOracleMaxAgeNs,
  parsePerpCbookAccount,
  parsePerpMarginAccount,
  parsePerpMarketAccount,
  parsePerpOrderArenaAccount,
  parsePerpSeatArenaAccount,
  perpResolveBadDebtProblem,
  perpRiskParamsProblem,
  perpSeatOrders,
  perpSettleFunding,
  type PerpFeeParams,
  type PerpMarginAccount,
  type PerpMarket,
  type PerpOrderBookLevel,
  type PerpOrderType,
  type PerpRiskParams,
  type PerpSeatEntry,
} from '../index';
import { loadPerpsDeployment, PERPS_NETWORK_RPC_URLS, type PerpDeployment, type PerpDeploymentMarket, type PerpsDeploymentSource } from './deployment';
import { hexToBytes } from './instructions';
import {
  createPerpsIndexer,
  indexerAllItems,
  indexerItems,
  perpBookLevelFromIndexer,
  perpFundingFromIndexer,
  perpMarginAccountFromIndexer,
  perpMarketFromIndexer,
  perpOpenOrderFromIndexer,
  perpSeatFromIndexer,
  type PerpsBook,
  type PerpsBookLevel,
  type PerpsIndexer,
  type PerpsIndexerOptions,
  type PerpsOpenOrder,
} from './indexer';
import { getStateProof, isNotFound, normalizeAddress, readAccount, type ThruClient } from './rpc';
import { submitPerpTransaction, type PerpSubmitOptions } from './submit';
import type { PerpsSigner } from './signers';
import {
  cancelOrdersTx,
  depositTx,
  feeClaimTx,
  insuranceDepositTx,
  liquidateTx,
  marginAccountCreateTx,
  marginLinkTx,
  marketSetFeesTx,
  marketSetRiskParamsTx,
  modifyOrderTx,
  ordersTx,
  perpCrossAccountRef,
  readOrderBookState,
  resolveBadDebtTx,
  seatCreateTx,
  seatSetBuilderApprovalTx,
  seatSetFeeReceiverTx,
  settleAccountFundingTx,
  settleFundingTx,
  withdrawTx,
  type CancelRequest,
  type CrossAccountRef,
  type MarketRef,
  type OrderRequest,
  type PerpTransaction,
} from './tx';
import { parsePerpPrice, parsePerpSize, parseUnits, type PerpRounding } from './units';

/* createPerpsClient: one object for reading a perps deployment and building
   and sending its transactions.

   Reads come from the perps indexer when `indexerUrl` is given (the
   indexer, or an app that proxies its /v1 routes) and fall back to RPC on
   any indexer failure; RPC reads decode accounts with the SDK's parsers
   (the program's current ABI).  Builders
   return an unsigned PerpTransaction plus metadata; `send` signs it with
   any PerpsSigner and waits for execution on the fast confirm path. */

export interface PerpsClientOptions {
  /** A Thru client, or `rpcUrl` to create one (default: the deployment's rpcUrl). */
  thru?: ThruClient;
  rpcUrl?: string;
  /** The deployment record: an object, a registered network name, a URL or JSON text. */
  deployment?: PerpsDeploymentSource;
  /** Shorthand for `deployment: network` (a registered record). */
  network?: string;
  /** Perps indexer (or app /v1 proxy) base URL. */
  indexerUrl?: string;
  indexer?: Omit<PerpsIndexerOptions, 'url'>;
  fetch?: typeof fetch;
  /** Margin account ids searched for an owner's accounts (default 0..3). */
  marginAccountIds?: number[];
  /** The current time in nanoseconds, against which getMark applies the
      program's oracle freshness rule (default: the wall clock, which block
      times track). */
  nowNs?: () => bigint;
}

/* Page sizes for the indexer's owner lists: the largest each route serves. */
const INDEXER_ORDERS_PAGE = 200;
const INDEXER_OWNER_SEATS_PAGE = 200;
const INDEXER_MARGIN_PAGE = 16;

/** A price or size: on-chain atoms (bigint, or a decimal string of atoms
    with `*Atoms` fields), or human units (`price`, `size`, `amount`). */
export type PerpsAmount = bigint | string;

export interface PerpsOrderParams {
  side: 'buy' | 'sell';
  /** gtc (default), ioc, fok, alo (post-only) or mtl. */
  orderType?: PerpOrderType;
  /** Same as orderType 'alo'. */
  postOnly?: boolean;
  /** Human price, quote per base unit ("84250.5"); or priceAtoms. */
  price?: string;
  priceAtoms?: PerpsAmount;
  /** Human size in base units ("0.25"); or quantityAtoms, or lots. */
  size?: string;
  quantityAtoms?: PerpsAmount;
  lots?: PerpsAmount;
  /** 16 bytes as hex, echoed in events. */
  clientId?: string;
  /** Block time (ns since the epoch) at which a resting order expires; the
      program skips and drops it from then on (GTT_ORDER_EXPIRED).  Default:
      never. */
  expiresAtNs?: PerpsAmount;
  /** Round a human price / size onto the grid instead of failing (default exact). */
  rounding?: PerpRounding;
}

/** A builder code on an order transaction: the builder's fee seat
    in the market and the rate it charges, ppm of filled notional (at most
    PERP_FEE_MAX_PPM = 1%; the market's builderFeeCapPpm caps what is
    charged).  The trader signs it with the transaction's market record, so
    it applies to every order of that transaction: as taker on what fills
    at once, and as maker on what rests, if the seat approves the builder
    (approveBuilder). */
export interface PerpsBuilderTerms {
  seatIndex: number;
  feePpm: number;
}

/** A market's trading fees (getFees). */
export interface PerpsFeesInfo {
  market: string;
  /** The rates in effect now (a pending increase that is due included). */
  rates: PerpFeeParams;
  /** An increase that has not taken effect yet (market_set_fees waits an hour). */
  pending: { takerFeePpm: number; builderFeeCapPpm: number; activationNs: bigint } | null;
  /** Protocol fees the market authority can claim (claimFees). */
  feeBalance: bigint;
  insuranceBalance: bigint;
}

/** A builder's fee seat in a market (getBuilderCode). */
export interface PerpsBuilderCodeInfo {
  market: string;
  owner: string;
  /** The builder code: put it on orders as `builder.seatIndex`. */
  seatIndex: number;
  /** Earned fees (and any deposit) in quote atoms: withdraw with
      withdraw({ ..., seatIndex }). */
  balance: bigint;
}

export interface PerpsBuilt {
  transaction: PerpTransaction;
  meta: {
    action: string;
    market?: string;
    owner?: string;
    seatIndex?: number;
    /** The seat is cross: the transaction carries its margin record. */
    cross?: boolean;
    marginAccount?: string;
    stateUnits?: number;
    programAddress: string;
  };
}

export interface PerpsMarketInfo {
  symbol: string;
  /** The seat arena address (the market's address in events and the indexer). */
  address: string;
  record: PerpDeploymentMarket;
  state: PerpMarket;
}

export interface PerpsMark {
  market: string;
  /** Quote atoms per base atom; null when the feed gives no mark (stale, wrong type). */
  mark: bigint | null;
  feedPrice: bigint | null;
  exponent: number | null;
  lastUpdateNs: bigint | null;
  /** The feed age the program accepts (the market's maxMarkAgeNs, else the
      feed's maxStalenessNs); null when the feed was not read. */
  maxAgeNs: bigint | null;
  /** The program would reject the feed as ORACLE_STALE now: older than
      maxAgeNs or stamped in the future. `mark` is then null. */
  stale: boolean;
  error: string | null;
}

export interface PerpsFundingInfo {
  market: string;
  enabled: boolean;
  funding: PerpMarket['funding'] | null;
  nextRoundNs: bigint | null;
}

export type PerpsMarginAccountInfo = PerpMarginAccount & { address: string };

/** Where a read comes from: 'auto' (the indexer when configured, else RPC)
    or 'rpc' (the chain, as the builders read seats, margin accounts and
    orders: an indexer a block behind must not shape a transaction). */
export interface PerpsReadOptions {
  source?: 'auto' | 'rpc';
}

export interface PerpsSendResult {
  signature: string;
  label: string;
}

export class PerpsClient {
  constructor(
    readonly thru: ThruClient,
    readonly deployment: PerpDeployment,
    readonly indexer: PerpsIndexer | null,
    private readonly marginAccountIds: number[],
    private readonly nowNs: () => bigint = () => BigInt(Date.now()) * 1_000_000n,
  ) {}

  get programAddress(): string {
    return this.deployment.perpProgram;
  }

  /* Markets *******************************************************************/

  /** A market of the deployment by symbol (case-insensitive) or seat arena address. */
  market(market: string): PerpDeploymentMarket {
    const found = this.deployment.markets.find((entry) => entry.symbol.toUpperCase() === market.toUpperCase() || entry.seatArena === market);
    if (!found) throw new Error(`unknown market ${market}; known: ${this.deployment.markets.map((entry) => entry.symbol).join(', ')}`);
    return found;
  }

  /** The accounts a market's transactions carry, with its current quote
      vault (market_set_vault may have moved it since the record was written). */
  marketRef(market: string, state?: Pick<PerpMarket, 'quoteVault'>): MarketRef {
    const record = this.market(market);
    return {
      deployment: { exchangeMeta: this.deployment.exchangeMeta, tokenProgram: this.deployment.tokenProgram },
      market: { ...record, quoteVault: state?.quoteVault ?? record.quoteVault },
    };
  }

  async getMarkets(): Promise<PerpsMarketInfo[]> {
    return Promise.all(this.deployment.markets.map((record) => this.getMarket(record.symbol)));
  }

  async getMarket(market: string, options: PerpsReadOptions = {}): Promise<PerpsMarketInfo> {
    const record = this.market(market);
    const state = await this.viaIndexer(options,
      async (indexer) => perpMarketFromIndexer(await indexer.get(`/v1/markets/${record.seatArena}`)),
      async () => parsePerpMarketAccount(await readAccount(this.thru, record.seatArena)),
    );
    return { symbol: record.symbol, address: record.seatArena, record, state };
  }

  async getBook(market: string, depth = 20): Promise<PerpsBook> {
    const record = this.market(market);
    return this.viaIndexer({},
      async (indexer) => {
        const book = await indexer.get<Record<string, unknown>>(`/v1/markets/${record.seatArena}/book`, { depth });
        return { market: record.seatArena, bids: indexerItems(book.bids).map(perpBookLevelFromIndexer), asks: indexerItems(book.asks).map(perpBookLevelFromIndexer) };
      },
      async () => {
        const [arena, bids, asks] = await Promise.all([
          readAccount(this.thru, record.orderArena),
          readAccount(this.thru, record.bidsCbook),
          readAccount(this.thru, record.asksCbook),
        ]);
        const snapshot = buildPerpOrderBookSnapshot({
          orders: parsePerpOrderArenaAccount(arena).orders,
          bidsCbook: parsePerpCbookAccount(bids),
          asksCbook: parsePerpCbookAccount(asks),
        });
        const tick = BigInt(record.tickSize);
        const lot = BigInt(record.lotSize);
        const level = (entry: PerpOrderBookLevel): PerpsBookLevel => ({
          side: entry.side,
          price: entry.priceInTicks * tick,
          priceTicks: entry.priceInTicks,
          lots: entry.quantityInLots,
          quantity: entry.quantityInLots * lot,
          orderCount: entry.orders.length,
        });
        return { market: record.seatArena, bids: snapshot.bids.slice(0, depth).map(level), asks: snapshot.asks.slice(0, depth).map(level) };
      },
    );
  }

  /** The mark the program would use now (from the market's oracle feed):
      null with an error when the feed is not the market's price feed or is
      stale by the program's rule (perpOracleFeedIsFresh, ORACLE_STALE). */
  async getMark(market: string): Promise<PerpsMark> {
    const { record, state } = await this.getMarket(market);
    const base = { market: record.seatArena, stale: false };
    try {
      const feed = parseOracleFeedAccount(await readAccount(this.thru, state.oracleFeed));
      const read = { lastUpdateNs: feed.common.lastUpdateNs, maxAgeNs: perpOracleMaxAgeNs(state, feed) };
      if (feed.kind !== 'price') return { ...base, ...read, mark: null, feedPrice: null, exponent: null, error: 'not a price feed' };
      const priced = { ...base, ...read, feedPrice: feed.price, exponent: feed.exponent };
      const nowNs = this.nowNs();
      /* The program's order: the feed's structure (ORACLE_INVALID, which
         perpMarkFromFeed reports), then its freshness, then the mark. */
      if (feed.exponent === state.oracleExponent && !perpOracleFeedIsFresh(feed, state, nowNs)) {
        const error = read.lastUpdateNs > nowNs
          ? `oracle feed is stale: its last update (${read.lastUpdateNs} ns) is after the current time (${nowNs} ns)`
          : `oracle feed is stale: last updated ${nowNs - read.lastUpdateNs} ns ago, the market accepts at most ${read.maxAgeNs} ns`;
        return { ...priced, mark: null, stale: true, error };
      }
      try {
        return { ...priced, mark: perpMarkFromFeed(feed, state), error: null };
      } catch (error) {
        return { ...priced, mark: null, error: (error as Error).message };
      }
    } catch (error) {
      return { ...base, mark: null, feedPrice: null, exponent: null, lastUpdateNs: null, maxAgeNs: null, error: (error as Error).message };
    }
  }

  async getFunding(market: string): Promise<PerpsFundingInfo> {
    const { record, state } = await this.getMarket(market);
    const funding = state.funding;
    const enabled = funding.premiumMultiplier !== 0;
    return { market: record.seatArena, enabled, funding, nextRoundNs: enabled ? perpNextFundingRoundNs(funding) : null };
  }

  /** The owner's trading seat in the market, or null: its first seat that
      is not a builder's fee seat, else its fee seat (which only withdraws). */
  async getSeat(market: string, owner: string, options: PerpsReadOptions = {}): Promise<PerpSeatEntry | null> {
    const seats = await this.getSeats(market, owner, options);
    return seats.find((seat) => !seat.feeReceiver) ?? seats[0] ?? null;
  }

  /** Every seat of the owner in the market (a key may hold several, e.g. a
      trading seat and a builder's fee seat). From the indexer, every page of
      the owner's portfolio in the market; a list the indexer cannot page to
      the end (indexerAllItems) is read from the chain instead. */
  async getSeats(market: string, owner: string, options: PerpsReadOptions = {}): Promise<PerpSeatEntry[]> {
    const record = this.market(market);
    const authority = normalizeAddress(owner);
    return this.viaIndexer(options,
      async (indexer) =>
        (await indexerAllItems(indexer, `/v1/owners/${authority}`, { market: record.seatArena, limit: INDEXER_OWNER_SEATS_PAGE }))
          .filter((item) => (item.seat as Record<string, unknown> | undefined)?.market === record.seatArena)
          .map((item) => perpSeatFromIndexer(item.seat as Record<string, unknown>)),
      async () => parsePerpSeatArenaAccount(await readAccount(this.thru, record.seatArena)).seats.filter((seat) => seat.seatAuthority === authority),
    );
  }

  /* Fees and builder codes ********************************************************/

  /** The market's fee rates in effect now, a pending increase, and its fee
      and insurance balances.  Every rate starts at 0. */
  async getFees(market: string, options: PerpsReadOptions = {}): Promise<PerpsFeesInfo> {
    const { address, state } = await this.getMarket(market, options);
    const fees = state.fees;
    const pending = fees.pendingActivationNs !== 0n && !perpFeesPendingDue(fees, this.nowNs())
      ? { takerFeePpm: fees.pendingTakerFeePpm, builderFeeCapPpm: fees.pendingBuilderFeeCapPpm, activationNs: fees.pendingActivationNs }
      : null;
    return {
      market: address,
      rates: perpEffectiveFeeRates(state, this.nowNs()),
      pending,
      feeBalance: state.risk.feeBalance,
      insuranceBalance: state.risk.insuranceBalance,
    };
  }

  /** The owner's builder code in the market (its fee seat), or null.  A
      code belongs to one market: a builder registers one per market. */
  async getBuilderCode(market: string, owner: string, options: PerpsReadOptions = {}): Promise<PerpsBuilderCodeInfo | null> {
    const fee = (await this.getSeats(market, owner, options)).find((seat) => seat.feeReceiver);
    if (!fee) return null;
    return { market: this.market(market).seatArena, owner: normalizeAddress(owner), seatIndex: fee.seatIndex, balance: fee.quantityQuote };
  }

  /** The owner's margin accounts.  From the indexer, every page of them; a list the indexer cannot page
      to the end (indexerAllItems) is read from the chain instead. */
  async getMarginAccounts(owner: string, options: PerpsReadOptions = {}): Promise<PerpsMarginAccountInfo[]> {
    const authority = normalizeAddress(owner);
    return this.viaIndexer(options,
      async (indexer) =>
        (await indexerAllItems(indexer, `/v1/owners/${authority}/margin`, { limit: INDEXER_MARGIN_PAGE }, { keys: ['marginAccounts', 'accounts'] })).map(perpMarginAccountFromIndexer),
      async () => {
        const vaults = new Set((await Promise.all(this.deployment.markets.map((record) => this.getMarket(record.symbol, options)))).map((info) => info.state.quoteVault));
        const found: PerpsMarginAccountInfo[] = [];
        for (const vault of vaults) {
          for (const accountId of this.marginAccountIds) {
            const { address } = await derivePerpMarginAccountAddress({ ownerAddress: authority, vaultAddress: vault, accountId, perpProgramAddress: this.programAddress });
            try {
              found.push({ address, ...parsePerpMarginAccount(await readAccount(this.thru, address)) });
            } catch (error) {
              if (!isNotFound(error)) throw error;
            }
          }
        }
        return found;
      },
    );
  }

  /** The owner's resting orders in a market. From the indexer, every page
      of them; a list the indexer cannot page to the end (indexerAllItems)
      is read from the chain instead. */
  async getOpenOrders(market: string, owner: string, options: PerpsReadOptions = {}): Promise<PerpsOpenOrder[]> {
    const record = this.market(market);
    const authority = normalizeAddress(owner);
    return this.viaIndexer(options,
      async (indexer) =>
        (await indexerAllItems(indexer, `/v1/owners/${authority}/orders`, { market: record.seatArena, limit: INDEXER_ORDERS_PAGE })).map(perpOpenOrderFromIndexer),
      async () => {
        const seat = await this.getSeat(market, authority, { source: 'rpc' });
        if (!seat) return [];
        const [arenaAccount, bids, asks] = await Promise.all([
          readAccount(this.thru, record.orderArena),
          readAccount(this.thru, record.bidsCbook),
          readAccount(this.thru, record.asksCbook),
        ]);
        const arena = parsePerpOrderArenaAccount(arenaAccount);
        const mine = new Map(perpSeatOrders(seat, arena).map((order) => [order.orderEntryIndex, order]));
        const snapshot = buildPerpOrderBookSnapshot({ orders: arena.orders, bidsCbook: parsePerpCbookAccount(bids), asksCbook: parsePerpCbookAccount(asks) });
        const tick = BigInt(record.tickSize);
        const lot = BigInt(record.lotSize);
        return [...snapshot.bids, ...snapshot.asks].flatMap((level) =>
          level.orders
            .filter((order) => mine.has(order.orderEntryIndex))
            .map((order) => ({
              market: record.seatArena,
              orderId: order.orderId,
              orderEntryIndex: order.orderEntryIndex,
              seatIndex: order.seatIndex,
              side: order.side,
              price: order.priceInTicks * tick,
              priceTicks: order.priceInTicks,
              lots: order.quantityInLots,
              quantity: order.quantityInLots * lot,
              clientIdHex: Array.from(order.clientId, (byte) => byte.toString(16).padStart(2, '0')).join(''),
              expirationTime: order.expirationTime,
              ...(mine.get(order.orderEntryIndex)!.builder ? { builder: { ...mine.get(order.orderEntryIndex)!.builder! } } : {}),
            })),
        );
      },
    );
  }

  /* Seat context ********************************************************************/

  /** The owner's seat in the market and, when it is cross, its margin
      account as a margin record names it. */
  async seatContext(market: string, owner: string, seatIndex?: number): Promise<{ ref: MarketRef; seat: PerpSeatEntry; margin?: CrossAccountRef; state: PerpMarket }> {
    const rpc = { source: 'rpc' } as const;
    const { state } = await this.getMarket(market, rpc);
    const ref = this.marketRef(market, state);
    const seat = seatIndex === undefined
      ? await this.getSeat(market, owner, rpc)
      : (await this.getSeats(market, owner, rpc)).find((entry) => entry.seatIndex === seatIndex) ?? null;
    if (!seat && seatIndex !== undefined) throw new Error(`seat #${seatIndex} in ${this.market(market).symbol} is not a seat of ${owner}`);
    if (!seat) throw new Error(`${owner} has no seat in ${this.market(market).symbol}; create one first (createSeat)`);
    if (!seat.cross) return { ref, seat, state };
    const account = (await this.getMarginAccounts(owner, rpc)).find((entry) => entry.links.some((link) => link.market === ref.market.seatArena && link.seatIndex === seat.seatIndex));
    if (!account) throw new Error(`seat #${seat.seatIndex} in ${this.market(market).symbol} is cross but no margin account of ${owner} links it`);
    return { ref, seat, state, margin: this.crossRef(account) };
  }

  /** A margin account's record shape, with each linked market's feed from the deployment. */
  crossRef(account: PerpsMarginAccountInfo): CrossAccountRef {
    return perpCrossAccountRef(account.address, account, this.deployment.markets);
  }

  /* Builders ************************************************************************/

  private built(action: string, transaction: PerpTransaction, meta: Omit<PerpsBuilt['meta'], 'action' | 'programAddress' | 'stateUnits'>): PerpsBuilt {
    return {
      transaction,
      meta: {
        action,
        ...meta,
        ...(transaction.stateUnits === undefined ? {} : { stateUnits: transaction.stateUnits }),
        programAddress: this.programAddress,
      },
    };
  }

  async createSeat(params: { market: string; owner: string }): Promise<PerpsBuilt> {
    const owner = normalizeAddress(params.owner);
    const ref = this.marketRef(params.market);
    return this.built('createSeat', seatCreateTx(ref, owner), { market: ref.market.seatArena, owner });
  }

  /** One order (see placeOrders). */
  async placeOrder(params: PerpsOrderParams & { market: string; owner: string; builder?: PerpsBuilderTerms }): Promise<PerpsBuilt> {
    const { market, owner, builder, ...order } = params;
    return this.placeOrders({ market, owner, orders: [order], builder });
  }

  /** Cancels, then orders, atomically, on the owner's seat (isolated or
      cross).  The transaction requests the state units resting the orders
      grows the books by.  `builder` puts a builder code on every order of
      the transaction. */
  async placeOrders(params: { market: string; owner: string; orders: PerpsOrderParams[]; cancels?: Array<{ orderId: PerpsAmount; orderEntryIndex?: number }>; builder?: PerpsBuilderTerms }): Promise<PerpsBuilt> {
    const owner = normalizeAddress(params.owner);
    if (params.builder) checkBuilderRate(params.builder.seatIndex, params.builder.feePpm, 'builder.feePpm');
    const { ref, seat, margin } = await this.seatContext(params.market, owner);
    const record = this.market(params.market);
    const orders = params.orders.map((order) => this.orderRequest(record, order));
    const cancels = await this.cancelRequests(params.market, owner, params.cancels ?? []);
    const book = await readOrderBookState(this.thru, record, { withOrders: cancels.length > 0, attempts: 2 });
    const builder = params.builder ? { builderSeatIndex: params.builder.seatIndex, feePpm: params.builder.feePpm } : undefined;
    const tx = ordersTx(ref, owner, seat.seatIndex, orders, cancels, book, { margin, builder });
    return this.built('placeOrders', tx, { market: record.seatArena, owner, seatIndex: seat.seatIndex, cross: !!margin, marginAccount: margin?.address });
  }

  async cancel(params: { market: string; owner: string; orderId: PerpsAmount; orderEntryIndex?: number }): Promise<PerpsBuilt> {
    const owner = normalizeAddress(params.owner);
    const { ref, seat, margin } = await this.seatContext(params.market, owner);
    const cancels = await this.cancelRequests(params.market, owner, [params]);
    const tx = cancelOrdersTx(ref, owner, seat.seatIndex, cancels, { margin });
    return this.built('cancel', tx, { market: ref.market.seatArena, owner, seatIndex: seat.seatIndex, cross: !!margin, marginAccount: margin?.address });
  }

  async cancelAll(params: { market: string; owner: string }): Promise<PerpsBuilt> {
    const owner = normalizeAddress(params.owner);
    const orders = await this.getOpenOrders(params.market, owner, { source: 'rpc' });
    if (!orders.length) throw new Error(`${owner} has no open orders in ${this.market(params.market).symbol}`);
    const { ref, seat, margin } = await this.seatContext(params.market, owner);
    const tx = cancelOrdersTx(ref, owner, seat.seatIndex, orders.map((order) => ({ orderId: order.orderId, orderEntryIndex: order.orderEntryIndex })), { margin });
    return this.built('cancelAll', tx, { market: ref.market.seatArena, owner, seatIndex: seat.seatIndex, cross: !!margin, marginAccount: margin?.address });
  }

  /** Reduces an order to `size` (human) / `quantityAtoms` / `lots`: the program refuses an increase. */
  async modify(params: { market: string; owner: string; orderId: PerpsAmount; orderEntryIndex?: number; size?: string; quantityAtoms?: PerpsAmount; lots?: PerpsAmount }): Promise<PerpsBuilt> {
    const owner = normalizeAddress(params.owner);
    const record = this.market(params.market);
    const { ref, seat, margin } = await this.seatContext(params.market, owner);
    const [cancel] = await this.cancelRequests(params.market, owner, [params]);
    const quantity = this.quantity(record, params, 'exact');
    const tx = modifyOrderTx(ref, owner, seat.seatIndex, [{ ...cancel!, quantity }], { margin });
    return this.built('modify', tx, { market: record.seatArena, owner, seatIndex: seat.seatIndex, cross: !!margin, marginAccount: margin?.address });
  }

  /** `amount` human quote units ("100.5") or `amountAtoms`.  `seatIndex`
      picks one of the owner's seats (default: its trading seat, getSeat). */
  async deposit(params: { market: string; owner: string; amount?: string; amountAtoms?: PerpsAmount; seatIndex?: number }): Promise<PerpsBuilt> {
    return this.collateral('deposit', params);
  }

  /** The program settles funding and checks free margin itself: no settle
      needed first.  A builder withdraws its earnings with the fee seat's
      `seatIndex` (getBuilderCode). */
  async withdraw(params: { market: string; owner: string; amount?: string; amountAtoms?: PerpsAmount; seatIndex?: number }): Promise<PerpsBuilt> {
    return this.collateral('withdraw', params);
  }

  private async collateral(action: 'deposit' | 'withdraw', params: { market: string; owner: string; amount?: string; amountAtoms?: PerpsAmount; seatIndex?: number }): Promise<PerpsBuilt> {
    const owner = normalizeAddress(params.owner);
    const record = this.market(params.market);
    const { mint, amount } = this.quoteAmount(record, params);
    const { ref, seat, margin } = await this.seatContext(params.market, owner, params.seatIndex);
    const wallet = deriveTokenAccountAddress(this.thru, owner, mint.address, this.deployment.tokenProgram);
    const build = action === 'deposit' ? depositTx : withdrawTx;
    const tx = build(ref, owner, seat.seatIndex, wallet, amount, { margin });
    return this.built(action, tx, { market: record.seatArena, owner, seatIndex: seat.seatIndex, cross: !!margin, marginAccount: margin?.address });
  }

  /** Creates margin account `accountId` (default 0) of the owner on the
      market's quote vault (every market it links must share that vault). */
  async createMarginAccount(params: { owner: string; market: string; accountId?: number }): Promise<PerpsBuilt> {
    const owner = normalizeAddress(params.owner);
    const { state } = await this.getMarket(params.market, { source: 'rpc' });
    const accountId = params.accountId ?? 0;
    const margin = await derivePerpMarginAccountAddress({ ownerAddress: owner, vaultAddress: state.quoteVault, accountId, perpProgramAddress: this.programAddress });
    const proof = await getStateProof(this.thru, margin.address, 'margin account');
    const tx = marginAccountCreateTx(this.deployment, owner, state.quoteVault, margin, accountId, proof);
    return this.built('createMarginAccount', tx, { owner, marginAccount: margin.address });
  }

  /** Links the owner's seat in `market` into margin account `accountId`
      (default 0, on the market's vault). */
  async linkMargin(params: { market: string; owner: string; accountId?: number }): Promise<PerpsBuilt> {
    return this.link(params, true);
  }

  /** Unlinks the owner's (flat) seat in `market` from its margin account. */
  async unlinkMargin(params: { market: string; owner: string }): Promise<PerpsBuilt> {
    return this.link(params, false);
  }

  private async link(params: { market: string; owner: string; accountId?: number }, link: boolean): Promise<PerpsBuilt> {
    const owner = normalizeAddress(params.owner);
    const rpc = { source: 'rpc' } as const;
    const { state } = await this.getMarket(params.market, rpc);
    const ref = this.marketRef(params.market, state);
    const seat = await this.getSeat(params.market, owner, rpc);
    if (!seat) throw new Error(`${owner} has no seat in ${this.market(params.market).symbol}`);
    const accounts = await this.getMarginAccounts(owner, rpc);
    let account: PerpsMarginAccountInfo | undefined;
    if (link) {
      const { address } = await derivePerpMarginAccountAddress({ ownerAddress: owner, vaultAddress: state.quoteVault, accountId: params.accountId ?? 0, perpProgramAddress: this.programAddress });
      account = accounts.find((entry) => entry.address === address);
      if (!account) throw new Error(`margin account ${params.accountId ?? 0} of ${owner} on vault ${state.quoteVault} does not exist (createMarginAccount)`);
      if (seat.cross) throw new Error(`seat #${seat.seatIndex} is already cross`);
    } else {
      account = accounts.find((entry) => entry.links.some((entryLink) => entryLink.market === ref.market.seatArena && entryLink.seatIndex === seat.seatIndex));
      if (!account) throw new Error(`seat #${seat.seatIndex} is not linked into a margin account of ${owner}`);
    }
    const tx = marginLinkTx(ref, owner, seat.seatIndex, this.crossRef(account), link);
    return this.built(link ? 'linkMargin' : 'unlinkMargin', tx, { market: ref.market.seatArena, owner, seatIndex: seat.seatIndex, cross: true, marginAccount: account.address });
  }

  /** Settles funding of `seatIndexes` in `market`, or of the owner's seat
      there.  Never required (the program settles before it reads a seat's
      equity); it updates the stored balance. */
  async settleFunding(params: { market: string; seatIndexes?: number[]; owner?: string }): Promise<PerpsBuilt> {
    const ref = this.marketRef(params.market);
    let seatIndexes = params.seatIndexes ?? [];
    if (!seatIndexes.length) {
      if (!params.owner) throw new Error('settleFunding needs seatIndexes or owner');
      const seat = await this.getSeat(params.market, params.owner, { source: 'rpc' });
      if (!seat) throw new Error(`${params.owner} has no seat in ${this.market(params.market).symbol}`);
      seatIndexes = [seat.seatIndex];
    }
    return this.built('settleFunding', settleFundingTx(ref, seatIndexes), { market: ref.market.seatArena, owner: params.owner });
  }

  /** Settles funding of every seat a margin account of the owner links (the
      account given by address, or the only / first one). */
  async settleAccountFunding(params: { owner: string; marginAccount?: string }): Promise<PerpsBuilt> {
    const owner = normalizeAddress(params.owner);
    const accounts = await this.getMarginAccounts(owner, { source: 'rpc' });
    const account = params.marginAccount ? accounts.find((entry) => entry.address === params.marginAccount) : accounts.find((entry) => entry.links.length > 0);
    if (!account) throw new Error(`no margin account of ${owner} with links`);
    const tx = settleAccountFundingTx(this.marketRef(this.deployment.markets[0]!.symbol).deployment, account, this.deployment.markets);
    return this.built('settleAccountFunding', tx, { owner, marginAccount: account.address });
  }

  /** The owner's seat liquidates seat `targetSeatIndex` of `market`; the
      target's (and the liquidator's) margin records are added when cross. */
  async liquidate(params: { market: string; owner: string; targetSeatIndex: number }): Promise<PerpsBuilt> {
    const owner = normalizeAddress(params.owner);
    const { ref, seat, margin } = await this.seatContext(params.market, owner);
    const arena = parsePerpSeatArenaAccount(await readAccount(this.thru, ref.market.seatArena));
    const target = arena.seats.find((entry) => entry.seatIndex === params.targetSeatIndex);
    if (!target) throw new Error(`no seat #${params.targetSeatIndex} in ${this.market(params.market).symbol}`);
    let targetAccount: CrossAccountRef | undefined;
    if (target.cross) {
      const accounts = await this.getMarginAccounts(target.seatAuthority, { source: 'rpc' });
      const account = accounts.find((entry) => entry.links.some((link) => link.market === ref.market.seatArena && link.seatIndex === target.seatIndex));
      if (!account) throw new Error(`target seat #${target.seatIndex} is cross but its margin account was not found`);
      targetAccount = this.crossRef(account);
    }
    const tx = liquidateTx(ref, owner, seat.seatIndex, params.targetSeatIndex, { target: targetAccount, liquidator: margin });
    return this.built('liquidate', tx, { market: ref.market.seatArena, owner, seatIndex: seat.seatIndex, cross: !!margin, marginAccount: margin?.address });
  }

  /* Fee and builder code actions ****************************************************/

  /** A builder turns one of its seats into its fee seat in the market: the
      seat's index becomes its builder code, and fees on coded orders are
      paid into it.  Irreversible: the seat never trades, rests orders or
      links again; it only withdraws.  The seat must be isolated, flat and
      without orders.  Without `seatIndex`, the owner's only empty seat (no
      collateral, as createSeat leaves it) is used, so a trading seat is
      never converted by accident: createSeat, then registerBuilderCode,
      from a key kept for building. */
  async registerBuilderCode(params: { market: string; owner: string; seatIndex?: number }): Promise<PerpsBuilt> {
    const owner = normalizeAddress(params.owner);
    const record = this.market(params.market);
    const rpc = { source: 'rpc' } as const;
    const { state } = await this.getMarket(params.market, rpc);
    const seats = await this.getSeats(params.market, owner, rpc);
    const existing = seats.find((seat) => seat.feeReceiver);
    if (existing) throw new Error(`${owner} already has builder code #${existing.seatIndex} in ${record.symbol}`);
    const unused = (seat: PerpSeatEntry) => !seat.cross && seat.longLots === 0n && seat.shortLots === 0n && seat.headOrderEntryIndex === 0;
    let seat: PerpSeatEntry | undefined;
    if (params.seatIndex !== undefined) {
      seat = seats.find((entry) => entry.seatIndex === params.seatIndex);
      if (!seat) throw new Error(`seat #${params.seatIndex} in ${record.symbol} is not a seat of ${owner}`);
      if (!unused(seat)) throw new Error(`seat #${seat.seatIndex} must be isolated, flat and without orders to become a fee seat`);
    } else {
      const empty = seats.filter((entry) => unused(entry) && entry.quantityQuote === 0n);
      if (empty.length !== 1) {
        throw new Error(empty.length
          ? `${owner} has ${empty.length} empty seats in ${record.symbol}; pass seatIndex`
          : `${owner} has no empty seat in ${record.symbol}; createSeat first (or pass the seatIndex of a flat, isolated seat to convert)`);
      }
      seat = empty[0]!;
    }
    const tx = seatSetFeeReceiverTx(this.marketRef(params.market, state), owner, seat.seatIndex);
    return this.built('registerBuilderCode', tx, { market: record.seatArena, owner, seatIndex: seat.seatIndex });
  }

  /** The owner's seat lets builder code `builder` (a fee seat in this
      market) charge its resting orders up to maxFeePpm when they fill as
      maker.  One approval per seat: this replaces the previous one.  A
      taker builder fee needs no approval (the signed order carries it). */
  async approveBuilder(params: { market: string; owner: string; builder: number; maxFeePpm: number; seatIndex?: number }): Promise<PerpsBuilt> {
    checkBuilderRate(params.builder, params.maxFeePpm, 'maxFeePpm');
    const owner = normalizeAddress(params.owner);
    const { ref, seat } = await this.seatContext(params.market, owner, params.seatIndex);
    const arena = parsePerpSeatArenaAccount(await readAccount(this.thru, ref.market.seatArena));
    const builder = arena.seats.find((entry) => entry.seatIndex === params.builder);
    if (!builder?.feeReceiver) throw new Error(`seat #${params.builder} in ${this.market(params.market).symbol} is not a builder's fee seat`);
    if (builder.seatAuthority === owner) throw new Error('a seat cannot approve its own authority\'s builder code');
    const tx = seatSetBuilderApprovalTx(ref, owner, seat.seatIndex, { builderSeatIndex: params.builder, maxFeePpm: params.maxFeePpm });
    return this.built('approveBuilder', tx, { market: ref.market.seatArena, owner, seatIndex: seat.seatIndex, cross: !!seat.cross });
  }

  /** Removes the owner's seat's builder approval: the next fill of a
      resting order charges no maker builder fee (no cancel needed). */
  async revokeBuilder(params: { market: string; owner: string; seatIndex?: number }): Promise<PerpsBuilt> {
    const owner = normalizeAddress(params.owner);
    const { ref, seat } = await this.seatContext(params.market, owner, params.seatIndex);
    const tx = seatSetBuilderApprovalTx(ref, owner, seat.seatIndex, { builderSeatIndex: 0, maxFeePpm: 0 });
    return this.built('revokeBuilder', tx, { market: ref.market.seatArena, owner, seatIndex: seat.seatIndex, cross: !!seat.cross });
  }

  /** Market authority: sets the fee rates (ppm).  An increase of the taker
      fee or the builder cap takes effect an hour later (getFees shows it
      pending); decreases, the rebate and the insurance shares apply at once. */
  async setFees(params: PerpFeeParams & { market: string; authority: string }): Promise<PerpsBuilt> {
    const { market, authority: rawAuthority, ...rates } = params;
    const problem = perpFeeParamsProblem(rates);
    if (problem) throw new Error(problem);
    const authority = normalizeAddress(rawAuthority);
    const { state } = await this.getMarket(market, { source: 'rpc' });
    this.requireMarketAuthority(market, state, authority);
    const tx = marketSetFeesTx(this.marketRef(market, state), authority, rates);
    return this.built('setFees', tx, { market: this.market(market).seatArena, owner: authority });
  }

  /** Market authority: moves protocol fees (default: the whole fee
      balance) into its own seat in the market, which then withdraws them.
      Refused while the market has bad debt. */
  async claimFees(params: { market: string; authority: string; amountAtoms?: PerpsAmount; seatIndex?: number }): Promise<PerpsBuilt> {
    const authority = normalizeAddress(params.authority);
    const { ref, seat, state } = await this.seatContext(params.market, authority, params.seatIndex);
    this.requireMarketAuthority(params.market, state, authority);
    const { symbol } = this.market(params.market);
    const balance = state.risk.feeBalance;
    const amount = params.amountAtoms === undefined ? balance : toAtoms(params.amountAtoms, 'amountAtoms');
    if (amount <= 0n) throw new Error(`no protocol fees to claim in ${symbol}`);
    if (amount > balance) throw new Error(`amount ${amount} exceeds the fee balance ${balance}`);
    if (state.badDebt) throw new Error(`${symbol} has bad debt: fee claims are refused until it is resolved`);
    const tx = feeClaimTx(ref, authority, seat.seatIndex, amount);
    return this.built('claimFees', tx, { market: ref.market.seatArena, owner: authority, seatIndex: seat.seatIndex });
  }

  /* Loss waterfall ******************************************************************/

  /** Moves `amount` (human quote units) or `amountAtoms` of the owner's
      seat's free collateral into the market's insurance balance, which
      covers the market's losses before they are charged to open positions.
      Not withdrawable: insurance belongs to the market.  The program
      settles the seat's funding first and moves at most what a withdrawal
      could take; an isolated seat is refused up front beyond its settled
      collateral.  Allowed while the market is frozen for bad debt (it is
      how a frozen market recovers).  `seatIndex` picks one of the owner's
      seats (a builder can pay in from its fee seat). */
  async depositInsurance(params: { market: string; owner: string; amount?: string; amountAtoms?: PerpsAmount; seatIndex?: number }): Promise<PerpsBuilt> {
    const owner = normalizeAddress(params.owner);
    const record = this.market(params.market);
    const { amount } = this.quoteAmount(record, params);
    const { ref, seat, margin, state } = await this.seatContext(params.market, owner, params.seatIndex);
    if (!seat.cross) {
      const collateral = perpSettleFunding(state, seat).seat.quantityQuote;
      if (amount > collateral) throw new Error(`amount ${amount} exceeds the collateral of seat #${seat.seatIndex} (${collateral} after funding)`);
    }
    const tx = insuranceDepositTx(ref, owner, seat.seatIndex, amount, { margin });
    return this.built('depositInsurance', tx, { market: record.seatArena, owner, seatIndex: seat.seatIndex, cross: !!margin, marginAccount: margin?.address });
  }

  /** Permissionless: runs the market's bad debt (state.badDebt; while it
      is nonzero withdrawals are frozen) through the loss waterfall: the
      fee balance, then insurance within its epoch budget, then a per-lot
      charge on open positions.  Any key may send it.  Refused up front
      when nothing could cover any of it (perpResolveBadDebtProblem); the
      program fails with NOTHING_RESOLVED when the bad debt does not fall. */
  async resolveBadDebt(params: { market: string }): Promise<PerpsBuilt> {
    const record = this.market(params.market);
    const { state } = await this.getMarket(params.market, { source: 'rpc' });
    const problem = perpResolveBadDebtProblem(state);
    if (problem) throw new Error(`${record.symbol}: ${problem}`);
    const tx = resolveBadDebtTx(this.marketRef(params.market, state));
    return this.built('resolveBadDebt', tx, { market: record.seatArena });
  }

  /** Market authority: sets the loss waterfall parameters (bps): the
      per-lot loss charge cap per 8 hour epoch, the insurance draw budget
      per epoch and the reward for liquidating a bankrupt isolated seat.
      Refused up front outside the market's limits (perpRiskParamsProblem). */
  async setRiskParams(params: PerpRiskParams & { market: string; authority: string }): Promise<PerpsBuilt> {
    const { market, authority: rawAuthority, ...risk } = params;
    const authority = normalizeAddress(rawAuthority);
    const record = this.market(market);
    const { state } = await this.getMarket(market, { source: 'rpc' });
    this.requireMarketAuthority(market, state, authority);
    const problem = perpRiskParamsProblem(state, risk);
    if (problem) throw new Error(problem);
    const tx = marketSetRiskParamsTx(this.marketRef(market, state), authority, risk);
    return this.built('setRiskParams', tx, { market: record.seatArena, owner: authority });
  }

  /* Sending *************************************************************************/

  /** Signs the transaction with `signer` and waits for its execution
      (submitPerpTransaction: a keypair signer's header reads overlap
      `options.checkChain` and, with `options.archived`, the restore of
      archived accounts).  Throws TransactionFailedError (with .code /
      .kind) on a failure; a nonce rejected because a cached nonce was stale
      is retried once with a fresh one (nothing executed, so it cannot
      double-place). */
  async send(tx: PerpTransaction | PerpsBuilt, signer: PerpsSigner, options: PerpSubmitOptions = {}): Promise<PerpsSendResult> {
    const transaction = 'transaction' in tx ? tx.transaction : tx;
    const signature = await submitPerpTransaction(this.thru, signer, { programAddress: this.programAddress, tx: transaction }, options);
    return { signature, label: transaction.label };
  }

  /* Internals ************************************************************************/

  /** Refuses up front what the program refuses with UNAUTHORIZED_MARKET_AUTH. */
  private requireMarketAuthority(market: string, state: PerpMarket, authority: string): void {
    if (state.marketAuthority !== authority) throw new Error(`${authority} is not the market authority of ${this.market(market).symbol}`);
  }

  private async viaIndexer<T>(options: PerpsReadOptions, indexed: (indexer: PerpsIndexer) => Promise<T>, rpc: () => Promise<T>): Promise<T> {
    if (this.indexer && options.source !== 'rpc') {
      try {
        return await indexed(this.indexer);
      } catch {
        /* The indexer is an accelerator: any failure reads the chain. */
      }
    }
    return rpc();
  }

  /** A positive quote amount: `amount` in the market's quote units or `amountAtoms`. */
  private quoteAmount(record: PerpDeploymentMarket, params: { amount?: string; amountAtoms?: PerpsAmount }): { mint: PerpDeployment['quoteMints'][number]; amount: bigint } {
    const mint = this.deployment.quoteMints.find((entry) => entry.symbol === record.quoteSymbol);
    if (!mint) throw new Error(`no quote mint ${record.quoteSymbol}`);
    const amount = exactlyOne({ amount: params.amount, amountAtoms: params.amountAtoms }, (key, value) =>
      key === 'amount' ? parseUnits(String(value), mint.decimals) : toAtoms(value as PerpsAmount, 'amountAtoms'),
    );
    if (amount <= 0n) throw new Error('amount must be positive');
    return { mint, amount };
  }

  private orderRequest(record: PerpDeploymentMarket, order: PerpsOrderParams): OrderRequest {
    const rounding = order.rounding ?? 'exact';
    const price = exactlyOne({ price: order.price, priceAtoms: order.priceAtoms }, (key, value) =>
      key === 'price' ? parsePerpPrice(String(value), record, rounding) : toAtoms(value as PerpsAmount, 'priceAtoms'),
    );
    const orderType: PerpOrderType = order.postOnly ? 'alo' : (order.orderType ?? 'gtc');
    if (order.postOnly && order.orderType && order.orderType !== 'alo') throw new Error('postOnly conflicts with orderType ' + order.orderType);
    return {
      side: order.side,
      orderType,
      price,
      quantity: this.quantity(record, order, rounding),
      ...(order.clientId ? { clientId: clientIdBytes(order.clientId) } : {}),
      ...(order.expiresAtNs === undefined ? {} : { expirationTime: positiveAtoms(order.expiresAtNs, 'expiresAtNs') }),
    };
  }

  private quantity(record: PerpDeploymentMarket, params: { size?: string; quantityAtoms?: PerpsAmount; lots?: PerpsAmount }, rounding: PerpRounding): bigint {
    const quantity = exactlyOne({ size: params.size, quantityAtoms: params.quantityAtoms, lots: params.lots }, (key, value) =>
      key === 'size'
        ? parsePerpSize(String(value), record, rounding)
        : key === 'lots'
          ? toAtoms(value as PerpsAmount, 'lots') * BigInt(record.lotSize)
          : toAtoms(value as PerpsAmount, 'quantityAtoms'),
    );
    if (quantity % BigInt(record.lotSize) !== 0n) throw new Error(`quantity ${quantity} is not a multiple of the lot size ${record.lotSize}`);
    return quantity;
  }

  private async cancelRequests(market: string, owner: string, cancels: Array<{ orderId: PerpsAmount; orderEntryIndex?: number }>): Promise<CancelRequest[]> {
    if (!cancels.length) return [];
    const missing = cancels.some((cancel) => cancel.orderEntryIndex === undefined);
    const open = missing ? await this.getOpenOrders(market, owner, { source: 'rpc' }) : [];
    return cancels.map((cancel) => {
      const orderId = toAtoms(cancel.orderId, 'orderId');
      if (cancel.orderEntryIndex !== undefined) return { orderId, orderEntryIndex: cancel.orderEntryIndex };
      const order = open.find((entry) => entry.orderId === orderId);
      if (!order) throw new Error(`order ${orderId} is not an open order of ${owner} in ${this.market(market).symbol}`);
      return { orderId, orderEntryIndex: order.orderEntryIndex };
    });
  }
}

/** Connects to a perps deployment: loads its record and, with
    `indexerUrl`, reads through the indexer. */
export async function createPerpsClient(options: PerpsClientOptions): Promise<PerpsClient> {
  const source = options.deployment ?? options.network;
  if (!source) throw new Error('createPerpsClient needs a deployment (object, network name, URL or JSON) or network');
  const deployment = await loadPerpsDeployment(source, { fetch: options.fetch });
  const rpcUrl = options.rpcUrl ?? deployment.rpcUrl ?? PERPS_NETWORK_RPC_URLS[deployment.network];
  const thru = options.thru ?? createThruClient({ baseUrl: rpcUrl });
  const indexer = options.indexerUrl ? createPerpsIndexer({ ...options.indexer, url: options.indexerUrl, fetch: options.indexer?.fetch ?? options.fetch }) : null;
  return new PerpsClient(thru, deployment, indexer, options.marginAccountIds ?? [0, 1, 2, 3], options.nowNs);
}

/** A builder code's seat and rate as the program accepts them: a seat, and
    a rate in (0, PERP_FEE_MAX_PPM]. */
function checkBuilderRate(seatIndex: number, ppm: number, label: string): void {
  if (!Number.isInteger(seatIndex) || seatIndex <= 0) throw new Error(`builder seat index must be a positive integer, got ${seatIndex}`);
  if (!Number.isInteger(ppm) || ppm <= 0 || ppm > PERP_FEE_MAX_PPM) throw new Error(`${label} must be an integer in 1..${PERP_FEE_MAX_PPM} (1%), got ${ppm}`);
}

function positiveAtoms(value: PerpsAmount, label: string): bigint {
  const atoms = toAtoms(value, label);
  if (atoms <= 0n || atoms > 9_223_372_036_854_775_807n) throw new Error(`${label} must be in 1..2^63-1`);
  return atoms;
}

function toAtoms(value: PerpsAmount, label: string): bigint {
  if (typeof value === 'bigint') {
    if (value < 0n) throw new Error(`${label} must not be negative`);
    return value;
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return BigInt(value.trim());
  throw new Error(`${label} must be a non-negative integer (bigint or decimal string), got ${JSON.stringify(String(value))}`);
}

function exactlyOne<T>(fields: Record<string, unknown>, convert: (key: string, value: unknown) => T): T {
  const given = Object.entries(fields).filter(([, value]) => value !== undefined && value !== null && value !== '');
  if (given.length !== 1) throw new Error(`give exactly one of ${Object.keys(fields).join(', ')}`);
  const [key, value] = given[0]!;
  return convert(key, value);
}

function clientIdBytes(hex: string): Uint8Array {
  const bytes = hexToBytes(hex);
  if (bytes.length !== 16) throw new Error('clientId must be 16 bytes of hex');
  return bytes;
}

