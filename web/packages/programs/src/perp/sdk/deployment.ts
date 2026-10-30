import { Pubkey } from '@thru/sdk';

/* The deployment record (web/perps/deployment.<network>.json in the
   repository, written by the perps tools' deploy script) names the
   program, the collateral tokens and the markets: addresses and market
   parameters only, never keys.  Every client (the tools, the demo UI, the
   indexer, createPerpsClient) starts from one. */

export interface PerpDeploymentQuoteMint {
  /** Ticker, e.g. THRUSD. Markets reference it through `quoteSymbol`. */
  symbol: string;
  /** Display name, e.g. "Thru USD". */
  name: string;
  /** Currency glyph for the UI, e.g. "$". */
  glyph: string;
  address: string;
  decimals: number;
  mintAuthority: string | null;
  /** Where demo funds come from: `perps` means the deployer key is the mint
      authority and the tools/UI faucet mints directly; `thru` means the
      hosted Thru faucet (`thruFaucetUrl`) funds an existing token account. */
  faucet: 'perps' | 'thru';
  /** Mint seed when the deployer created the mint, else null. */
  seedHex: string | null;
}

export interface PerpDeploymentMarket {
  /** e.g. BTC-THRUSD */
  symbol: string;
  baseSymbol: string;
  quoteSymbol: string;
  /** Seat arena account; also the market address the program reports in events. */
  seatArena: string;
  orderArena: string;
  bidsCbook: string;
  asksCbook: string;
  quoteVault: string;
  marketAuthority: string;
  lotSize: string;
  tickSize: string;
  priceCap: string;
  maxPositionLots: string;
  /** Display decimals of the synthetic base (1 lot = 10^-baseDecimals base). */
  baseDecimals: number;
  quoteDecimals: number;
  /** Oracle feed whose USD price, times `indexFxRate`, is the index price. */
  oracleFeed: string;
  oracleFeedName: string;
  /** Quote units per USD as a decimal string ("1" for USD-quoted markets). */
  indexFxRate: string;
  /** Suggested order size in lots for the UI ticket and the market maker. */
  defaultOrderLots: string;
  /** Initial margin as a fraction of notional at the mark, in bps (250 = 40x;
      the display leverage is perpMaxLeverage(initialMarginBps)). */
  initialMarginBps: number;
  /** A seat whose equity drops below this fraction of notional is liquidatable. */
  maintenanceMarginBps: number;
  /** Fee the liquidated seat pays its liquidator, in bps of the transferred notional. */
  liquidationFeeBps: number;
  /** mark = min(feed.price * markNum / markDen, priceCap), as decimal strings. */
  markNum: string;
  markDen: string;
  /** Exponent of the oracle feed the market requires (price_usd = raw * 10^exponent). */
  oracleExponent: number;
  /** Set in memory for markets the record does not list: found through the
      program's MARKET_CREATED events (discovery.ts) or created from the
      browser. Never written to the record. */
  discovered?: boolean;
}

export interface PerpDeployment {
  network: string;
  rpcUrl: string;
  deployedAt: string;
  deployer: string;
  perpProgram: string;
  perpProgramMeta: string;
  perpAbi: string | null;
  exchangeMeta: string;
  tokenProgram: string;
  oracleProgram: string;
  /** Hosted Thru faucet used for mints with `faucet: 'thru'`. */
  thruFaucetUrl: string;
  quoteMints: PerpDeploymentQuoteMint[];
  markets: PerpDeploymentMarket[];
}

export function quoteMintFor(deployment: Pick<PerpDeployment, 'quoteMints'>, market: Pick<PerpDeploymentMarket, 'symbol' | 'quoteSymbol'>): PerpDeploymentQuoteMint {
  const mint = deployment.quoteMints.find((entry) => entry.symbol === market.quoteSymbol);
  if (!mint) throw new Error(`deployment has no quote mint ${market.quoteSymbol} for market ${market.symbol}`);
  return mint;
}

/** Market by symbol, case-insensitive; null when the symbol is unknown or absent. */
export function findMarket(deployment: Pick<PerpDeployment, 'markets'>, symbol: string | null | undefined): PerpDeploymentMarket | null {
  if (!symbol) return null;
  return deployment.markets.find((entry) => entry.symbol.toUpperCase() === symbol.toUpperCase()) ?? null;
}

/** findMarket for command lines: throws naming the known symbols. */
export function requireMarket(deployment: Pick<PerpDeployment, 'markets'>, symbol: string): PerpDeploymentMarket {
  const market = findMarket(deployment, symbol);
  if (!market) throw new Error(`unknown market ${symbol}; known: ${deployment.markets.map((entry) => entry.symbol).join(', ')}`);
  return market;
}

const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const address = (value: unknown): boolean => {
  if (!text(value)) return false;
  try { Pubkey.from(value); return true; } catch { return false; }
};
const integer = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
const positiveAtoms = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{1,20}$/.test(value) && BigInt(value) > 0n && BigInt(value) <= 0xffffffffffffffffn;

/** Validate every field consumed by the UI and tools before parsing numbers. */
export function isDeploymentMarket(value: unknown): value is PerpDeploymentMarket {
  if (!value || typeof value !== 'object') return false;
  const market = value as Partial<PerpDeploymentMarket>;
  return (
    ['symbol', 'baseSymbol', 'quoteSymbol', 'oracleFeedName'].every(key => text(market[key as keyof PerpDeploymentMarket])) &&
    ['seatArena', 'orderArena', 'bidsCbook', 'asksCbook', 'quoteVault', 'marketAuthority', 'oracleFeed']
      .every(key => address(market[key as keyof PerpDeploymentMarket])) &&
    ['lotSize', 'tickSize', 'priceCap', 'maxPositionLots', 'defaultOrderLots', 'markNum', 'markDen']
      .every(key => positiveAtoms(market[key as keyof PerpDeploymentMarket])) &&
    integer(market.baseDecimals, 0, 18) && integer(market.quoteDecimals, 0, 18) &&
    integer(market.initialMarginBps, 1, 10_000) &&
    integer(market.maintenanceMarginBps, 1, market.initialMarginBps - 1) &&
    integer(market.liquidationFeeBps, 0, 10_000) &&
    integer(market.oracleExponent, -18, 18) &&
    text(market.indexFxRate) && Number.isFinite(Number(market.indexFxRate)) && Number(market.indexFxRate) > 0 &&
    (market.discovered === undefined || typeof market.discovered === 'boolean')
  );
}

function isQuoteMint(value: unknown): value is PerpDeploymentQuoteMint {
  if (!value || typeof value !== 'object') return false;
  const mint = value as Partial<PerpDeploymentQuoteMint>;
  return ['symbol', 'name'].every(key => text(mint[key as keyof PerpDeploymentQuoteMint])) &&
    address(mint.address) && (address(mint.mintAuthority) || (mint.faucet === 'thru' && (mint.mintAuthority === null || mint.mintAuthority === ''))) &&
    typeof mint.glyph === 'string' && integer(mint.decimals, 0, 18) &&
    (mint.faucet === 'perps' || mint.faucet === 'thru') &&
    (mint.seedHex === null || (typeof mint.seedHex === 'string' && /^[0-9a-fA-F]{64}$/.test(mint.seedHex)));
}

/** Validates a parsed record (the JSON file, or anything claiming to be
    one). `source` names it in error messages. */
export function assertDeployment(value: unknown, source = 'deployment record'): PerpDeployment {
  const record = value as Partial<PerpDeployment> | null;
  if (!record || typeof record !== 'object') throw new Error(`${source} is not an object`);
  for (const key of ['network', 'rpcUrl', 'deployedAt', 'deployer', 'perpProgram', 'perpProgramMeta', 'exchangeMeta', 'tokenProgram', 'oracleProgram', 'thruFaucetUrl'] as const) {
    if (typeof record[key] !== 'string' || !record[key]) throw new Error(`${source} is missing ${key}`);
  }
  if (!Array.isArray(record.quoteMints) || record.quoteMints.length === 0) {
    throw new Error(`${source} has no quoteMints (it predates the multi-market format; rerun deploy)`);
  }
  if (!record.quoteMints.every(isQuoteMint)) throw new Error(`${source} has an invalid quote mint`);
  if (new Set(record.quoteMints.map(mint => mint.symbol)).size !== record.quoteMints.length)
    throw new Error(`${source} has duplicate quote symbols`);
  for (const key of ['deployer', 'perpProgram', 'perpProgramMeta', 'exchangeMeta', 'tokenProgram', 'oracleProgram'] as const)
    if (!address(record[key])) throw new Error(`${source} has an invalid ${key} address`);
  if (record.perpAbi !== null && !address(record.perpAbi)) throw new Error(`${source} has an invalid perpAbi`);
  if (!Array.isArray(record.markets) || record.markets.length === 0) throw new Error(`${source} has no markets`);
  for (const market of record.markets as Array<Partial<PerpDeploymentMarket>>) {
    if (!isDeploymentMarket(market)) throw new Error(`${source}: market ${market?.symbol ?? '?'} has invalid or missing market fields; rerun deploy`);
    const mint = record.quoteMints.find((mint) => mint.symbol === market.quoteSymbol);
    if (!mint) {
      throw new Error(`${source}: market ${market.symbol} references unknown quote mint ${market.quoteSymbol}`);
    }
    if (mint.decimals !== market.quoteDecimals) throw new Error(`${source}: market ${market.symbol} has mismatched quote decimals`);
  }
  if (new Set(record.markets.map(market => market.symbol)).size !== record.markets.length)
    throw new Error(`${source} has duplicate market symbols`);
  return record as PerpDeployment;
}

/* Loading **********************************************************************/

/** RPC endpoints of the public networks.  A network's deployment record is
    registered (registerPerpsDeployment) or loaded from a URL / object. */
export const PERPS_NETWORK_RPC_URLS: Readonly<Record<string, string>> = Object.freeze({
  alphanet: 'https://rpc.alphanet.thru.org',
  betanet: 'https://rpc.betanet.thru.org',
});

const registeredDeployments = new Map<string, PerpDeployment>();

/** Makes `deployment` the record loadPerpsDeployment returns for its
    network name (`deployment.network`, or `network`). */
export function registerPerpsDeployment(deployment: unknown, network?: string): PerpDeployment {
  const record = assertDeployment(deployment, `${network ?? 'registered'} deployment record`);
  registeredDeployments.set((network ?? record.network).toLowerCase(), record);
  return record;
}

export function registeredPerpsNetworks(): string[] {
  return [...registeredDeployments.keys()];
}

export type PerpsDeploymentSource =
  | PerpDeployment
  /** A registered network name ("betanet"), an http(s) URL of the JSON
      record, or the JSON text itself. */
  | string;

/** A validated deployment record from an object, a registered network
    name, a URL (fetched with the global fetch) or JSON text. */
export async function loadPerpsDeployment(source: PerpsDeploymentSource, options: { fetch?: typeof fetch } = {}): Promise<PerpDeployment> {
  if (typeof source !== 'string') return assertDeployment(source);
  const trimmed = source.trim();
  if (trimmed.startsWith('{')) return assertDeployment(JSON.parse(trimmed), 'deployment JSON');
  if (/^https?:\/\//i.test(trimmed)) {
    const fetcher = options.fetch ?? globalThis.fetch;
    if (!fetcher) throw new Error('no fetch available to load the deployment record');
    const response = await fetcher(trimmed);
    if (!response.ok) throw new Error(`deployment record ${trimmed}: HTTP ${response.status}`);
    return assertDeployment(await response.json(), trimmed);
  }
  const registered = registeredDeployments.get(trimmed.toLowerCase());
  if (registered) return registered;
  const known = registeredPerpsNetworks();
  throw new Error(
    `no deployment record registered for network "${trimmed}"` +
      (known.length ? ` (registered: ${known.join(', ')})` : '') +
      '; pass the record object, its URL, or call registerPerpsDeployment first',
  );
}
