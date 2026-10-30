import { createThruClient } from '@thru/sdk/client';
import { parseOracleFeedAccount } from '../../oracle/accounts';
import { deriveTokenAccountAddress } from '../../token/derivation';
import {
  buildPerpOrderBookSnapshot,
  derivePerpMarginAccountAddress,
  perpMarkFromFeed,
  perpNextFundingRoundNs,
  perpOracleFeedIsFresh,
  perpOracleMaxAgeNs,
  perpSeatOrders,
  type PerpMarginAccount,
  type PerpMarket,
  type PerpOrderBookLevel,
  type PerpOrderType,
  type PerpSeatEntry,
} from '../index';
import { fetchPerpAbiVersion } from '../versions/detect';
import type { PerpAbiVersion, PerpAbiVersionDetection, PerpFeatureFlags } from '../versions/model';
import { assertPerpSupports, getPerpAbiVersion } from '../versions/registry';
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
  liquidateTx,
  marginAccountCreateTx,
  marginLinkTx,
  modifyOrderTx,
  ordersTx,
  perpCrossAccountRef,
  readOrderBookState,
  seatCreateTx,
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
   any indexer failure; RPC reads decode accounts with the deployment's ABI
   version (detected from the program hash, see versions/).  Builders
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
  /** Use this ABI version instead of detecting it from the program account. */
  abiVersion?: PerpAbiVersion | string;
  /** When the program hash and ABI account are both unknown, assume the
      latest version (default true) instead of failing. */
  assumeLatest?: boolean;
  /** Margin account ids searched for an owner's accounts (default 0..3). */
  marginAccountIds?: number[];
  /** The current time in nanoseconds, against which getMark applies the
      program's oracle freshness rule (default: the wall clock, which block
      times track). */
  nowNs?: () => bigint;
}

/* Page sizes for the indexer's owner lists: the largest each route serves. */
const INDEXER_ORDERS_PAGE = 200;
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
  /** Round a human price / size onto the grid instead of failing (default exact). */
  rounding?: PerpRounding;
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
    abiVersion: string;
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
  supported: boolean;
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
    readonly version: PerpAbiVersion,
    readonly versionDetection: PerpAbiVersionDetection | null,
    readonly indexer: PerpsIndexer | null,
    private readonly marginAccountIds: number[],
    private readonly nowNs: () => bigint = () => BigInt(Date.now()) * 1_000_000n,
  ) {}

  get features(): Readonly<PerpFeatureFlags> {
    return this.version.features;
  }

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
      async () => this.version.decode.market(await readAccount(this.thru, record.seatArena)),
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
          orders: this.version.decode.orderArena(arena).orders,
          bidsCbook: this.version.decode.cbook(bids),
          asksCbook: this.version.decode.cbook(asks),
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
    const supported = this.version.features.funding;
    const funding = supported ? (state.funding ?? null) : null;
    const enabled = !!funding && funding.premiumMultiplier !== 0;
    return { market: record.seatArena, supported, enabled, funding, nextRoundNs: enabled && funding ? perpNextFundingRoundNs(funding) : null };
  }

  /** The owner's seat in the market, or null. */
  async getSeat(market: string, owner: string, options: PerpsReadOptions = {}): Promise<PerpSeatEntry | null> {
    const record = this.market(market);
    const authority = normalizeAddress(owner);
    return this.viaIndexer(options,
      async (indexer) => {
        const page = await indexer.get(`/v1/owners/${authority}/portfolio`, { market: record.seatArena });
        const entry = indexerItems(page).find((item) => (item.seat as Record<string, unknown> | undefined)?.market === record.seatArena);
        return entry ? perpSeatFromIndexer(entry.seat as Record<string, unknown>) : null;
      },
      async () => this.version.decode.seatArena(await readAccount(this.thru, record.seatArena)).seats.find((seat) => seat.seatAuthority === authority) ?? null,
    );
  }

  /** The owner's margin accounts (none on a version without cross margin).
      From the indexer, every page of them; a list the indexer cannot page
      to the end (indexerAllItems) is read from the chain instead. */
  async getMarginAccounts(owner: string, options: PerpsReadOptions = {}): Promise<PerpsMarginAccountInfo[]> {
    if (!this.version.features.crossMargin) return [];
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
              found.push({ address, ...this.version.decode.marginAccount(await readAccount(this.thru, address)) });
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
        const arena = this.version.decode.orderArena(arenaAccount);
        const mine = new Map(perpSeatOrders(seat, arena).map((order) => [order.orderEntryIndex, order]));
        const snapshot = buildPerpOrderBookSnapshot({ orders: arena.orders, bidsCbook: this.version.decode.cbook(bids), asksCbook: this.version.decode.cbook(asks) });
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
  async seatContext(market: string, owner: string): Promise<{ ref: MarketRef; seat: PerpSeatEntry; margin?: CrossAccountRef; state: PerpMarket }> {
    const rpc = { source: 'rpc' } as const;
    const { state } = await this.getMarket(market, rpc);
    const ref = this.marketRef(market, state);
    const seat = await this.getSeat(market, owner, rpc);
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

  private built(action: string, transaction: PerpTransaction, meta: Omit<PerpsBuilt['meta'], 'action' | 'abiVersion' | 'programAddress' | 'stateUnits'>): PerpsBuilt {
    return {
      transaction,
      meta: {
        action,
        ...meta,
        ...(transaction.stateUnits === undefined ? {} : { stateUnits: transaction.stateUnits }),
        abiVersion: this.version.id,
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
  async placeOrder(params: PerpsOrderParams & { market: string; owner: string }): Promise<PerpsBuilt> {
    const { market, owner, ...order } = params;
    return this.placeOrders({ market, owner, orders: [order] });
  }

  /** Cancels, then orders, atomically, on the owner's seat (isolated or
      cross).  The transaction requests the state units resting the orders
      grows the books by. */
  async placeOrders(params: { market: string; owner: string; orders: PerpsOrderParams[]; cancels?: Array<{ orderId: PerpsAmount; orderEntryIndex?: number }> }): Promise<PerpsBuilt> {
    const owner = normalizeAddress(params.owner);
    const { ref, seat, margin } = await this.seatContext(params.market, owner);
    const record = this.market(params.market);
    const orders = params.orders.map((order) => this.orderRequest(record, order));
    const cancels = await this.cancelRequests(params.market, owner, params.cancels ?? []);
    const book = await readOrderBookState(this.thru, record, { withOrders: cancels.length > 0, attempts: 2 });
    const tx = ordersTx(ref, owner, seat.seatIndex, orders, cancels, book, { margin, version: this.version });
    return this.built('placeOrders', tx, { market: record.seatArena, owner, seatIndex: seat.seatIndex, cross: !!margin, marginAccount: margin?.address });
  }

  async cancel(params: { market: string; owner: string; orderId: PerpsAmount; orderEntryIndex?: number }): Promise<PerpsBuilt> {
    const owner = normalizeAddress(params.owner);
    const { ref, seat, margin } = await this.seatContext(params.market, owner);
    const cancels = await this.cancelRequests(params.market, owner, [params]);
    const tx = cancelOrdersTx(ref, owner, seat.seatIndex, cancels, { margin, version: this.version });
    return this.built('cancel', tx, { market: ref.market.seatArena, owner, seatIndex: seat.seatIndex, cross: !!margin, marginAccount: margin?.address });
  }

  async cancelAll(params: { market: string; owner: string }): Promise<PerpsBuilt> {
    const owner = normalizeAddress(params.owner);
    const orders = await this.getOpenOrders(params.market, owner, { source: 'rpc' });
    if (!orders.length) throw new Error(`${owner} has no open orders in ${this.market(params.market).symbol}`);
    const { ref, seat, margin } = await this.seatContext(params.market, owner);
    const tx = cancelOrdersTx(ref, owner, seat.seatIndex, orders.map((order) => ({ orderId: order.orderId, orderEntryIndex: order.orderEntryIndex })), { margin, version: this.version });
    return this.built('cancelAll', tx, { market: ref.market.seatArena, owner, seatIndex: seat.seatIndex, cross: !!margin, marginAccount: margin?.address });
  }

  /** Reduces an order to `size` (human) / `quantityAtoms` / `lots`: the program refuses an increase. */
  async modify(params: { market: string; owner: string; orderId: PerpsAmount; orderEntryIndex?: number; size?: string; quantityAtoms?: PerpsAmount; lots?: PerpsAmount }): Promise<PerpsBuilt> {
    const owner = normalizeAddress(params.owner);
    const record = this.market(params.market);
    const { ref, seat, margin } = await this.seatContext(params.market, owner);
    const [cancel] = await this.cancelRequests(params.market, owner, [params]);
    const quantity = this.quantity(record, params, 'exact');
    const tx = modifyOrderTx(ref, owner, seat.seatIndex, [{ ...cancel!, quantity }], { margin, version: this.version });
    return this.built('modify', tx, { market: record.seatArena, owner, seatIndex: seat.seatIndex, cross: !!margin, marginAccount: margin?.address });
  }

  /** `amount` human quote units ("100.5") or `amountAtoms`. */
  async deposit(params: { market: string; owner: string; amount?: string; amountAtoms?: PerpsAmount }): Promise<PerpsBuilt> {
    return this.collateral('deposit', params);
  }

  /** The program settles funding and checks free margin itself: no settle needed first. */
  async withdraw(params: { market: string; owner: string; amount?: string; amountAtoms?: PerpsAmount }): Promise<PerpsBuilt> {
    return this.collateral('withdraw', params);
  }

  private async collateral(action: 'deposit' | 'withdraw', params: { market: string; owner: string; amount?: string; amountAtoms?: PerpsAmount }): Promise<PerpsBuilt> {
    const owner = normalizeAddress(params.owner);
    const record = this.market(params.market);
    const mint = this.deployment.quoteMints.find((entry) => entry.symbol === record.quoteSymbol);
    if (!mint) throw new Error(`no quote mint ${record.quoteSymbol}`);
    const amount = exactlyOne({ amount: params.amount, amountAtoms: params.amountAtoms }, (key, value) =>
      key === 'amount' ? parseUnits(String(value), mint.decimals) : toAtoms(value as PerpsAmount, 'amountAtoms'),
    );
    if (amount <= 0n) throw new Error('amount must be positive');
    const { ref, seat, margin } = await this.seatContext(params.market, owner);
    const wallet = deriveTokenAccountAddress(this.thru, owner, mint.address, this.deployment.tokenProgram);
    const build = action === 'deposit' ? depositTx : withdrawTx;
    const tx = build(ref, owner, seat.seatIndex, wallet, amount, { margin, version: this.version });
    return this.built(action, tx, { market: record.seatArena, owner, seatIndex: seat.seatIndex, cross: !!margin, marginAccount: margin?.address });
  }

  /** Creates margin account `accountId` (default 0) of the owner on the
      market's quote vault (every market it links must share that vault). */
  async createMarginAccount(params: { owner: string; market: string; accountId?: number }): Promise<PerpsBuilt> {
    assertPerpSupports(this.version, 'crossMargin', 'createMarginAccount');
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
    assertPerpSupports(this.version, 'crossMargin', link ? 'linkMargin' : 'unlinkMargin');
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
    assertPerpSupports(this.version, 'settleFunding', 'settleFunding');
    const ref = this.marketRef(params.market);
    let seatIndexes = params.seatIndexes ?? [];
    if (!seatIndexes.length) {
      if (!params.owner) throw new Error('settleFunding needs seatIndexes or owner');
      const seat = await this.getSeat(params.market, params.owner, { source: 'rpc' });
      if (!seat) throw new Error(`${params.owner} has no seat in ${this.market(params.market).symbol}`);
      seatIndexes = [seat.seatIndex];
    }
    return this.built('settleFunding', settleFundingTx(ref, seatIndexes, { version: this.version }), { market: ref.market.seatArena, owner: params.owner });
  }

  /** Settles funding of every seat a margin account of the owner links (the
      account given by address, or the only / first one). */
  async settleAccountFunding(params: { owner: string; marginAccount?: string }): Promise<PerpsBuilt> {
    const owner = normalizeAddress(params.owner);
    const accounts = await this.getMarginAccounts(owner, { source: 'rpc' });
    const account = params.marginAccount ? accounts.find((entry) => entry.address === params.marginAccount) : accounts.find((entry) => entry.links.length > 0);
    if (!account) throw new Error(`no margin account of ${owner} with links`);
    const tx = settleAccountFundingTx(this.marketRef(this.deployment.markets[0]!.symbol).deployment, account, this.deployment.markets, { version: this.version });
    return this.built('settleAccountFunding', tx, { owner, marginAccount: account.address });
  }

  /** The owner's seat liquidates seat `targetSeatIndex` of `market`; the
      target's (and the liquidator's) margin records are added when cross. */
  async liquidate(params: { market: string; owner: string; targetSeatIndex: number }): Promise<PerpsBuilt> {
    const owner = normalizeAddress(params.owner);
    const { ref, seat, margin } = await this.seatContext(params.market, owner);
    const arena = this.version.decode.seatArena(await readAccount(this.thru, ref.market.seatArena));
    const target = arena.seats.find((entry) => entry.seatIndex === params.targetSeatIndex);
    if (!target) throw new Error(`no seat #${params.targetSeatIndex} in ${this.market(params.market).symbol}`);
    let targetAccount: CrossAccountRef | undefined;
    if (target.cross) {
      const accounts = await this.getMarginAccounts(target.seatAuthority, { source: 'rpc' });
      const account = accounts.find((entry) => entry.links.some((link) => link.market === ref.market.seatArena && link.seatIndex === target.seatIndex));
      if (!account) throw new Error(`target seat #${target.seatIndex} is cross but its margin account was not found`);
      targetAccount = this.crossRef(account);
    }
    const tx = liquidateTx(ref, owner, seat.seatIndex, params.targetSeatIndex, { target: targetAccount, liquidator: margin, version: this.version });
    return this.built('liquidate', tx, { market: ref.market.seatArena, owner, seatIndex: seat.seatIndex, cross: !!margin, marginAccount: margin?.address });
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

/** Connects to a perps deployment: loads its record, detects its ABI
    version and, with `indexerUrl`, reads through the indexer. */
export async function createPerpsClient(options: PerpsClientOptions): Promise<PerpsClient> {
  const source = options.deployment ?? options.network;
  if (!source) throw new Error('createPerpsClient needs a deployment (object, network name, URL or JSON) or network');
  const deployment = await loadPerpsDeployment(source, { fetch: options.fetch });
  const rpcUrl = options.rpcUrl ?? deployment.rpcUrl ?? PERPS_NETWORK_RPC_URLS[deployment.network];
  const thru = options.thru ?? createThruClient({ baseUrl: rpcUrl });
  let version: PerpAbiVersion;
  let detection: PerpAbiVersionDetection | null = null;
  if (options.abiVersion) {
    version = typeof options.abiVersion === 'string' ? getPerpAbiVersion(options.abiVersion) : options.abiVersion;
  } else {
    detection = await fetchPerpAbiVersion(thru as never, {
      programAddress: deployment.perpProgram,
      abiAccountAddress: deployment.perpAbi ?? undefined,
      assumeLatest: options.assumeLatest ?? true,
    });
    version = detection.version;
  }
  const indexer = options.indexerUrl ? createPerpsIndexer({ ...options.indexer, url: options.indexerUrl, fetch: options.indexer?.fetch ?? options.fetch }) : null;
  return new PerpsClient(thru, deployment, version, detection, indexer, options.marginAccountIds ?? [0, 1, 2, 3], options.nowNs);
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

