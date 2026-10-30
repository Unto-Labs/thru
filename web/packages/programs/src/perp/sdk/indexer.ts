import {
  PERP_MARKET_MAGIC,
  type PerpBuilderApproval,
  type PerpFunding,
  type PerpMarginAccount,
  type PerpMarket,
  type PerpMarketFees,
  type PerpMarketRisk,
  type PerpOrderBuilder,
  type PerpSeatEntry,
} from '../index';

/* The perps indexer's HTTP API (web/indexers/perps, also served through
   the demo app's same-origin /v1 proxy) and its JSON mapped onto the
   SDK's domain model.  Every GET returns { data, meta }; integers are
   decimal strings.  Only the fields the domain model needs are read, so a
   newer indexer with more fields still maps. */

export interface PerpsIndexerOptions {
  /** Base URL: the indexer API origin, or the app origin when it proxies
      /v1 (e.g. https://perps.example.org). */
  url: string;
  fetch?: typeof fetch;
  /** Extra headers (e.g. an API key). */
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export class PerpsIndexerError extends Error {
  constructor(
    readonly path: string,
    readonly status: number | null,
    message: string,
  ) {
    super(message);
    this.name = 'PerpsIndexerError';
  }
}

export interface PerpsIndexer {
  get<T = unknown>(path: string, query?: Record<string, string | number | undefined>): Promise<T>;
}

export function createPerpsIndexer(options: PerpsIndexerOptions): PerpsIndexer {
  const base = options.url.replace(/\/+$/, '');
  const fetcher = options.fetch ?? globalThis.fetch;
  if (!fetcher) throw new Error('no fetch available for the perps indexer');
  return {
    async get<T>(path: string, query: Record<string, string | number | undefined> = {}): Promise<T> {
      const params = Object.entries(query).filter(([, value]) => value !== undefined);
      const url = `${base}${path}${params.length ? `?${new URLSearchParams(params.map(([k, v]) => [k, String(v)])).toString()}` : ''}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);
      let response: Response;
      try {
        response = await fetcher(url, { headers: { accept: 'application/json', ...options.headers }, signal: controller.signal });
      } catch (error) {
        throw new PerpsIndexerError(path, null, `perps indexer ${path}: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        clearTimeout(timer);
      }
      if (!response.ok) throw new PerpsIndexerError(path, response.status, `perps indexer ${path}: HTTP ${response.status}`);
      const body = (await response.json()) as { data?: T };
      if (!body || typeof body !== 'object' || !('data' in body)) throw new PerpsIndexerError(path, response.status, `perps indexer ${path}: no data envelope`);
      return body.data as T;
    },
  };
}

/* Indexer JSON → domain model ***************************************************/

type Json = Record<string, unknown>;

const big = (value: unknown, label: string): bigint => {
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return BigInt(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value);
  throw new Error(`indexer field ${label} is not an integer`);
};
const int = (value: unknown, label: string): number => {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  throw new Error(`indexer field ${label} is not a number`);
};
const obj = (value: unknown, label: string): Json => {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) return value as Json;
  throw new Error(`indexer field ${label} is not an object`);
};
const str = (value: unknown, label: string): string => {
  if (typeof value === 'string') return value;
  throw new Error(`indexer field ${label} is not a string`);
};

export function perpFundingFromIndexer(json: Json): PerpFunding {
  return {
    index: big(json.index, 'funding.index'),
    balance: big(json.balance, 'funding.balance'),
    rate: big(json.rateTicks, 'funding.rateTicks'),
    premiumSum: big(json.premiumSum, 'funding.premiumSum'),
    sampleCount: int(json.sampleCount, 'funding.sampleCount'),
    lastRoundNs: big(json.lastRoundNs, 'funding.lastRoundNs'),
    lastSampleNs: big(json.lastSampleNs, 'funding.lastSampleNs'),
    interestRate: int(json.interestRate, 'funding.interestRate'),
    clampSmall: int(json.clampSmall, 'funding.clampSmall'),
    clampBig: int(json.clampBig, 'funding.clampBig'),
    premiumMultiplier: int(json.premiumMultiplier, 'funding.premiumMultiplier'),
    impactNotional: big(json.impactNotional, 'funding.impactNotional'),
  };
}

/** An indexer market's risk state (marketRiskSchema) as PerpMarketRisk. */
export function perpRiskFromIndexer(json: Json): PerpMarketRisk {
  return {
    socializeCapBps: int(json.socializeCapBps, 'risk.socializeCapBps'),
    ifEpochBudgetBps: int(json.ifEpochBudgetBps, 'risk.ifEpochBudgetBps'),
    bankruptLiqRewardBps: int(json.bankruptLiqRewardBps, 'risk.bankruptLiqRewardBps'),
    feeBalance: big(json.feeBalance, 'risk.feeBalance'),
    insuranceBalance: big(json.insuranceBalance, 'risk.insuranceBalance'),
    epochId: int(json.epochId, 'risk.epochId'),
    epochIfDrawn: big(json.epochIfDrawn, 'risk.epochIfDrawn'),
    epochSocTicks: big(json.epochSocTicks, 'risk.epochSocTicks'),
    badDebtBoth: big(json.badDebtBoth, 'risk.badDebtBoth'),
    lossOffsetLong: big(json.lossOffsetLong, 'risk.lossOffsetLong'),
    lossOffsetShort: big(json.lossOffsetShort, 'risk.lossOffsetShort'),
  };
}

/** An indexer market's fee rates (marketFeesSchema) as PerpMarketFees. */
export function perpFeesFromIndexer(json: Json): PerpMarketFees {
  return {
    takerFeePpm: int(json.takerFeePpm, 'fees.takerFeePpm'),
    makerRebatePpm: int(json.makerRebatePpm, 'fees.makerRebatePpm'),
    builderFeeCapPpm: int(json.builderFeeCapPpm, 'fees.builderFeeCapPpm'),
    feeInsuranceSharePpm: int(json.feeInsuranceSharePpm, 'fees.feeInsuranceSharePpm'),
    liqInsuranceSharePpm: int(json.liqInsuranceSharePpm, 'fees.liqInsuranceSharePpm'),
    pendingTakerFeePpm: int(json.pendingTakerFeePpm, 'fees.pendingTakerFeePpm'),
    pendingBuilderFeeCapPpm: int(json.pendingBuilderFeeCapPpm, 'fees.pendingBuilderFeeCapPpm'),
    pendingActivationNs: big(json.pendingActivationNs, 'fees.pendingActivationNs'),
  };
}

/** An indexer market (marketSchema) as the domain model's PerpMarket.  Its
    `risk` (null on a market without the loss waterfall) is what seats settle
    against: without it a loss offset in a seat's snapshot would read as
    funding, so any other value is refused (and the client reads the chain). */
export function perpMarketFromIndexer(json: Json): PerpMarket {
  return {
    magic: PERP_MARKET_MAGIC,
    statusFlags: int(json.statusFlags, 'statusFlags'),
    exchangeStatusFlags: int(json.exchangeStatusFlags, 'exchangeStatusFlags'),
    lotSize: big(json.lotSize, 'lotSize'),
    tickSize: big(json.tickSize, 'tickSize'),
    nextOrderId: big(json.nextOrderId, 'nextOrderId'),
    priceCap: big(json.priceCap, 'priceCap'),
    maxPositionLots: big(json.maxPositionLots, 'maxPositionLots'),
    openInterestLots: big(json.openInterestLots, 'openInterestLots'),
    badDebt: big(json.badDebt, 'badDebt'),
    orderArena: str(json.orderArena, 'orderArena'),
    bidsCbook: str(json.bidsCbook, 'bidsCbook'),
    asksCbook: str(json.asksCbook, 'asksCbook'),
    quoteVault: str(json.quoteVault, 'quoteVault'),
    marketAuthority: str(json.marketAuthority, 'marketAuthority'),
    oracleFeed: str(json.oracleFeed, 'oracleFeed'),
    markNum: big(json.markNum, 'markNum'),
    markDen: big(json.markDen, 'markDen'),
    initialMarginBps: int(json.initialMarginBps, 'initialMarginBps'),
    maintenanceMarginBps: int(json.maintenanceMarginBps, 'maintenanceMarginBps'),
    liquidationFeeBps: int(json.liquidationFeeBps, 'liquidationFeeBps'),
    oracleExponent: int(json.oracleExponent, 'oracleExponent'),
    maxMarkAgeNs: big(json.maxMarkAgeNs, 'maxMarkAgeNs'),
    ...(json.funding && typeof json.funding === 'object' ? { funding: perpFundingFromIndexer(json.funding as Json) } : {}),
    ...(typeof json.crossUpnlHaircutBps === 'number' ? { crossUpnlHaircutBps: json.crossUpnlHaircutBps } : {}),
    ...(json.risk === null || json.risk === undefined ? {} : { risk: perpRiskFromIndexer(obj(json.risk, 'risk')) }),
    /* Fee rates (0.5.0): null or missing on a market without them. */
    ...(json.fees === null || json.fees === undefined ? {} : { fees: perpFeesFromIndexer(obj(json.fees, 'fees')) }),
  };
}

/** An indexer seat (seatSchema) as the domain model's PerpSeatEntry. */
export function perpSeatFromIndexer(json: Json): PerpSeatEntry {
  return {
    seatIndex: int(json.seatIndex, 'seatIndex'),
    seatAuthority: str(json.authority, 'authority'),
    quantityQuote: big(json.collateralAtoms, 'collateralAtoms'),
    cross: json.cross === true,
    longLots: big(json.longLots, 'longLots'),
    shortLots: big(json.shortLots, 'shortLots'),
    openBidLots: big(json.openBidLots, 'openBidLots'),
    openAskLots: big(json.openAskLots, 'openAskLots'),
    headOrderEntryIndex: int(json.headOrderEntryIndex, 'headOrderEntryIndex'),
    entryNotional: big(json.entryNotionalAtoms, 'entryNotionalAtoms'),
    openBidNotional: big(json.openBidNotionalAtoms, 'openBidNotionalAtoms'),
    openAskNotional: big(json.openAskNotionalAtoms, 'openAskNotionalAtoms'),
    ...(json.fundingSnapshot !== undefined ? { fundingSnapshot: big(json.fundingSnapshot, 'fundingSnapshot') } : {}),
    ...(json.fundingCarry !== undefined ? { fundingCarry: int(json.fundingCarry, 'fundingCarry') } : {}),
    ...(json.feeReceiver === true ? { feeReceiver: true } : {}),
    ...(json.builderApproval === null || json.builderApproval === undefined
      ? {}
      : { builderApproval: builderApprovalFromIndexer(obj(json.builderApproval, 'builderApproval')) }),
  };
}

function builderApprovalFromIndexer(json: Json): PerpBuilderApproval {
  return { builderSeatIndex: int(json.builderSeatIndex, 'builderApproval.builderSeatIndex'), maxFeePpm: int(json.maxFeePpm, 'builderApproval.maxFeePpm') };
}

/** An indexer margin account (marginAccountSchema / crossAccountSchema). */
export function perpMarginAccountFromIndexer(json: Json): PerpMarginAccount & { address: string } {
  const links = Array.isArray(json.links) ? (json.links as Json[]) : [];
  return {
    address: str(json.address, 'address'),
    accountId: int(json.accountId, 'accountId'),
    owner: str(json.owner, 'owner'),
    vault: str(json.vault, 'vault'),
    links: links.map((link) => ({ market: str(link.market, 'links.market'), seatIndex: int(link.seatIndex, 'links.seatIndex') })),
  };
}

/** A resting order as clients see it (both read paths produce this). */
export interface PerpsOpenOrder {
  market: string;
  orderId: bigint;
  orderEntryIndex: number;
  seatIndex: number;
  side: 'buy' | 'sell';
  /** Quote atoms per base atom. */
  price: bigint;
  priceTicks: bigint;
  lots: bigint;
  /** Base atoms. */
  quantity: bigint;
  clientIdHex: string;
  expirationTime: bigint;
  /** The order's builder code (0.5.0); absent when it has none. */
  builder?: PerpOrderBuilder;
}

export function perpOpenOrderFromIndexer(json: Json): PerpsOpenOrder {
  return {
    market: str(json.market, 'market'),
    orderId: big(json.orderId, 'orderId'),
    orderEntryIndex: int(json.entryIndex, 'entryIndex'),
    seatIndex: int(json.seatIndex, 'seatIndex'),
    side: json.side === 'sell' ? 'sell' : 'buy',
    price: big(json.priceAtoms, 'priceAtoms'),
    priceTicks: big(json.priceTicks, 'priceTicks'),
    lots: big(json.lots, 'lots'),
    quantity: big(json.baseAtoms, 'baseAtoms'),
    clientIdHex: typeof json.clientIdHex === 'string' ? json.clientIdHex : '',
    expirationTime: big(json.expirationNs, 'expirationNs'),
    ...(json.builder === null || json.builder === undefined
      ? {}
      : (() => {
          const builder = obj(json.builder, 'builder');
          return { builder: { builderSeatIndex: int(builder.builderSeatIndex, 'builder.builderSeatIndex'), feePpm: int(builder.feePpm, 'builder.feePpm') } };
        })()),
  };
}

/** One price level of a book, both read paths. */
export interface PerpsBookLevel {
  side: 'buy' | 'sell';
  price: bigint;
  priceTicks: bigint;
  lots: bigint;
  quantity: bigint;
  orderCount: number;
}

export interface PerpsBook {
  market: string;
  bids: PerpsBookLevel[];
  asks: PerpsBookLevel[];
}

export function perpBookLevelFromIndexer(json: Json): PerpsBookLevel {
  return {
    side: json.side === 'sell' ? 'sell' : 'buy',
    price: big(json.priceAtoms, 'priceAtoms'),
    priceTicks: big(json.priceTicks, 'priceTicks'),
    lots: big(json.lots, 'lots'),
    quantity: big(json.baseAtoms, 'baseAtoms'),
    orderCount: int(json.orderCount, 'orderCount'),
  };
}

/** The most pages indexerAllItems follows before it gives up. */
export const PERPS_INDEXER_MAX_PAGES = 100;

/** Every item of a paged indexer list ({ items, nextCursor }): follows
    nextCursor until it is null. Past `maxPages` pages, or when a cursor
    repeats, it throws a PerpsIndexerError instead of returning part of the
    list as if it were all of it. `keys` name older list fields, as for
    indexerItems. */
export async function indexerAllItems(
  indexer: PerpsIndexer,
  path: string,
  query: Record<string, string | number | undefined> = {},
  options: { keys?: string[]; maxPages?: number } = {},
): Promise<Json[]> {
  const maxPages = options.maxPages ?? PERPS_INDEXER_MAX_PAGES;
  const items: Json[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (let pages = 0; ; pages++) {
    if (pages === maxPages) {
      throw new PerpsIndexerError(path, null, `perps indexer ${path}: more than ${maxPages} pages (${items.length} items read); not returning a partial list`);
    }
    const data = await indexer.get<unknown>(path, { ...query, cursor });
    items.push(...indexerItems(data, ...(options.keys ?? [])));
    const next = data && typeof data === 'object' && !Array.isArray(data) ? (data as Json).nextCursor : null;
    if (next === null || next === undefined) return items;
    if (typeof next !== 'string' || next === '') throw new PerpsIndexerError(path, null, `perps indexer ${path}: nextCursor is not a string`);
    if (seen.has(next)) throw new PerpsIndexerError(path, null, `perps indexer ${path}: nextCursor repeated`);
    seen.add(next);
    cursor = next;
  }
}

/** The list inside an indexer page or array response. */
export function indexerItems(data: unknown, ...keys: string[]): Json[] {
  if (Array.isArray(data)) return data as Json[];
  if (data && typeof data === 'object') {
    for (const key of ['items', ...keys]) {
      const value = (data as Json)[key];
      if (Array.isArray(value)) return value as Json[];
    }
  }
  return [];
}
