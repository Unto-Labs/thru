import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { TransactionVmError } from '@thru/sdk/proto';
import { PERP_CBOOK_MAX_PRICE_IN_TICKS, derivePerpMarginAccountAddress, perpSettleFunding } from '../index';
import { PERP_ABI_V0_2, registerPerpProgramHash } from '../versions/registry';
import { createPerpsClient, type PerpsClient } from './client';
import {
  createPerpsIndexer,
  indexerAllItems,
  perpMarketFromIndexer,
  perpOpenOrderFromIndexer,
  perpSeatFromIndexer,
  PERPS_INDEXER_MAX_PAGES,
  PerpsIndexerError,
} from './indexer';
import { TransactionFailedError } from './errors';
import { createWalletSigner, type PerpsSigner, type PerpsWalletIntent } from './signers';
import { describePerpsActions, perpsToolDefinitions, runPerpsAction, validatePerpsActionParams } from './describe';
import {
  address,
  cbookBytes,
  fixtureDeployment,
  fixtureMarket,
  marginAccountBytes,
  oracleFeedBytes,
  orderArenaBytes,
  seatArenaBytes,
} from './test-fixtures';

const OWNER = address(40);
const OTHER = address(41);
const A = fixtureMarket(10);
const B = fixtureMarket(20);
const deployment = fixtureDeployment([
  { symbol: 'BTC-THRUSD', market: A },
  { symbol: 'ETH-THRUSD', market: B },
]);
const PROGRAM_CODE = new TextEncoder().encode('perp program build for the client tests');
registerPerpProgramHash(createHash('sha256').update(PROGRAM_CODE).digest('hex'), 'perp-abi@0.4.0');

/** The chain: OWNER is cross in BTC (seat 1, a resting bid) and ETH (seat 1),
    linked by margin account 0 on the shared vault; OTHER is isolated in BTC. */
async function chain() {
  const margin = await derivePerpMarginAccountAddress({ ownerAddress: OWNER, vaultAddress: A.quoteVault, accountId: 0, perpProgramAddress: deployment.perpProgram });
  const bestBid = PERP_CBOOK_MAX_PRICE_IN_TICKS - 84_000n;
  const accounts = new Map<string, Uint8Array>([
    [deployment.perpProgram, PROGRAM_CODE],
    [A.seatArena, seatArenaBytes(A, [
      { authority: OWNER, quantityQuote: -5_000n, openBidLots: 1n, openBidNotional: 84_000_000n, headOrderEntryIndex: 1, cross: true },
      { authority: OTHER, quantityQuote: 10_000_000n },
    ], { funding: true })],
    [B.seatArena, seatArenaBytes(B, [{ authority: OWNER, quantityQuote: 50_000_000n, cross: true }])],
    [A.orderArena, orderArenaBytes([{ seatIndex: 1, levelIndex: 0, lots: 1n, orderId: 4n }])],
    [A.bidsCbook, cbookBytes(10, bestBid, [[0, 1]])],
    [A.asksCbook, cbookBytes(10)],
    [B.orderArena, orderArenaBytes([])],
    [B.bidsCbook, cbookBytes(10)],
    [B.asksCbook, cbookBytes(10)],
    [margin.address, marginAccountBytes({ owner: OWNER, vault: A.quoteVault, accountId: 0, links: [{ market: B.seatArena, seatIndex: 1 }, { market: A.seatArena, seatIndex: 1 }] })],
  ]);
  const reads: string[] = [];
  const thru = {
    accounts: {
      get: vi.fn(async (addr: string) => {
        reads.push(addr);
        const data = accounts.get(addr);
        if (!data) throw new Error(`account ${addr} not found`);
        return { data: { data }, meta: { nonce: 3n } };
      }),
    },
    transactions: {
      sendAndTrack: vi.fn(),
      send: vi.fn(),
      getStatus: vi.fn(),
    },
    helpers: await import('@thru/sdk').then(({ deriveAddress, deriveProgramAddress }) => ({ deriveAddress, deriveProgramAddress })),
  };
  return { thru, accounts, reads, margin: margin.address };
}

async function client(extra: Record<string, unknown> = {}): Promise<{ client: PerpsClient; env: Awaited<ReturnType<typeof chain>> }> {
  const env = await chain();
  return { client: await createPerpsClient({ deployment, thru: env.thru as never, ...extra }), env };
}

describe('createPerpsClient', () => {
  it('loads the record and detects the ABI version from the program hash', async () => {
    const { client: perps } = await client();
    expect(perps.version.id).toBe('perp-abi@0.4.0');
    expect(perps.versionDetection?.source).toBe('program-hash');
    expect(perps.features.crossMargin).toBe(true);
    await expect(createPerpsClient({ network: 'nowhere' })).rejects.toThrow('no deployment record registered for network "nowhere"');
  });

  it('reads markets, seats, funding, margin accounts and open orders over RPC', async () => {
    const { client: perps, env } = await client();
    const market = await perps.getMarket('btc-thrusd');
    expect(market.state).toMatchObject({ tickSize: 1_000n, initialMarginBps: 500, crossUpnlHaircutBps: 0 });
    expect(await perps.getSeat('BTC-THRUSD', OWNER)).toMatchObject({ seatIndex: 1, cross: true, quantityQuote: -5_000n });
    expect(await perps.getSeat('ETH-THRUSD', OTHER)).toBeNull();
    expect(await perps.getFunding('BTC-THRUSD')).toMatchObject({ supported: true, enabled: true, nextRoundNs: 10_800_000_000_000n });
    expect((await perps.getFunding('ETH-THRUSD')).enabled).toBe(false);
    const accounts = await perps.getMarginAccounts(OWNER);
    expect(accounts).toEqual([{ address: env.margin, accountId: 0, owner: OWNER, vault: A.quoteVault, links: [{ market: B.seatArena, seatIndex: 1 }, { market: A.seatArena, seatIndex: 1 }] }]);
    const orders = await perps.getOpenOrders('BTC-THRUSD', OWNER);
    expect(orders).toEqual([
      expect.objectContaining({ orderId: 4n, orderEntryIndex: 1, seatIndex: 1, side: 'buy', price: 84_000_000n, priceTicks: 84_000n, lots: 1n, quantity: 1n }),
    ]);
    const book = await perps.getBook('BTC-THRUSD');
    expect(book.bids).toEqual([{ side: 'buy', price: 84_000_000n, priceTicks: 84_000n, lots: 1n, quantity: 1n, orderCount: 1 }]);
  });

  it('builds a cross order with the margin record and the state units the book needs', async () => {
    const { client: perps, env } = await client();
    const built = await perps.placeOrder({ market: 'ETH-THRUSD', owner: OWNER, side: 'buy', price: '42000', size: '0.001', postOnly: true });
    expect(built.meta).toMatchObject({ action: 'placeOrders', seatIndex: 1, cross: true, marginAccount: env.margin, abiVersion: 'perp-abi@0.4.0', stateUnits: 0 });
    expect(built.transaction.instructions.map((ix) => ix.ix)).toEqual(['margin_record', 'market_record', 'create_order_entry']);
    expect(built.transaction.instructions[2]).toMatchObject({ side: 'buy', orderType: 'alo', price: '42000000', quantity: '1' });
    expect(built.transaction.readOnly).toEqual([deployment.exchangeMeta, B.oracleFeed, env.margin, A.seatArena, A.oracleFeed]);
    await expect(perps.placeOrder({ market: 'ETH-THRUSD', owner: OWNER, side: 'buy', price: '42000.5', size: '0.001' })).rejects.toThrow('not a multiple of 1000');
    await expect(perps.placeOrder({ market: 'ETH-THRUSD', owner: OWNER, side: 'buy', price: '1', priceAtoms: '1000', size: '0.001' })).rejects.toThrow('exactly one of price, priceAtoms');
    await expect(perps.placeOrder({ market: 'ETH-THRUSD', owner: OTHER, side: 'buy', price: '1', size: '0.001' })).rejects.toThrow('has no seat');
  });

  it('cancels every open order, withdraws and settles through the right accounts', async () => {
    const { client: perps, env } = await client();
    const cancelAll = await perps.cancelAll({ market: 'BTC-THRUSD', owner: OWNER });
    expect(cancelAll.transaction.instructions.map((ix) => ix.ix)).toEqual(['margin_record', 'market_record', 'modify_order_entry']);
    expect(cancelAll.transaction.instructions[2]).toMatchObject({ orderEntryIndex: 1, orderId: '4', quantity: '0' });

    const withdraw = await perps.withdraw({ market: 'ETH-THRUSD', owner: OWNER, amount: '12.5' });
    expect(withdraw.transaction.instructions[2]).toMatchObject({ ix: 'token_withdraw', amount: '12500000', from: A.quoteVault });
    expect(withdraw.meta.cross).toBe(true);

    const settle = await perps.settleAccountFunding({ owner: OWNER });
    expect(settle.transaction.instructions).toEqual([
      expect.objectContaining({ ix: 'market_record', marketRecordIndex: 1, seatArena: B.seatArena }),
      { ix: 'settle_funding', marketRecordIndex: 1, targetSeatIndex: 1 },
      expect.objectContaining({ ix: 'market_record', marketRecordIndex: 2, seatArena: A.seatArena }),
      { ix: 'settle_funding', marketRecordIndex: 2, targetSeatIndex: 1 },
    ]);
    const unlink = await perps.unlinkMargin({ market: 'ETH-THRUSD', owner: OWNER });
    expect(unlink.transaction.readWrite).toContain(env.margin);

    const liquidate = await perps.liquidate({ market: 'BTC-THRUSD', owner: OTHER, targetSeatIndex: 1 });
    expect(liquidate.transaction.instructions.map((ix) => ix.ix)).toEqual(['margin_record', 'market_record', 'liquidate']);
    expect(liquidate.meta.cross).toBe(false);
  });

  it('gates cross margin on the ABI version', async () => {
    const { client: perps } = await client({ abiVersion: PERP_ABI_V0_2 });
    expect(perps.features.crossMargin).toBe(false);
    expect(await perps.getMarginAccounts(OWNER)).toEqual([]);
    await expect(perps.linkMargin({ market: 'BTC-THRUSD', owner: OWNER })).rejects.toThrow('crossMargin');
    await expect(perps.settleFunding({ market: 'BTC-THRUSD', seatIndexes: [1] })).rejects.toThrow('settleFunding');
  });

  it('reads through the indexer when given and falls back to RPC when it fails', async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url.endsWith(`/v1/markets/${A.seatArena}`)) {
        return new Response(JSON.stringify({
          data: {
            statusFlags: 0, exchangeStatusFlags: 0, lotSize: '1', tickSize: '5000', nextOrderId: '1', priceCap: '9', maxPositionLots: '9', openInterestLots: '0', badDebt: '0',
            orderArena: A.orderArena, bidsCbook: A.bidsCbook, asksCbook: A.asksCbook, quoteVault: A.quoteVault, marketAuthority: A.marketAuthority, oracleFeed: A.oracleFeed,
            markNum: '1', markDen: '1', initialMarginBps: 500, maintenanceMarginBps: 250, liquidationFeeBps: 100, oracleExponent: -8, maxMarkAgeNs: '0', crossUpnlHaircutBps: 1000,
          },
          meta: {},
        }), { status: 200 });
      }
      return new Response('{}', { status: 503 });
    });
    const { client: perps, env } = await client({ indexerUrl: 'https://indexer.example/', fetch });
    expect((await perps.getMarket('BTC-THRUSD')).state).toMatchObject({ tickSize: 5_000n, crossUpnlHaircutBps: 1000 });
    expect(env.reads).not.toContain(A.seatArena);
    expect((await perps.getMarket('ETH-THRUSD')).state.tickSize).toBe(1_000n);
    expect(env.reads).toContain(B.seatArena);
    /* Builders read the seat, its account and the market from the chain, never the indexer. */
    const fetched = fetch.mock.calls.length;
    const built = await perps.cancelAll({ market: 'BTC-THRUSD', owner: OWNER });
    expect(built.meta.cross).toBe(true);
    expect(fetch.mock.calls.length).toBe(fetched);
    expect(env.reads).toContain(A.seatArena);
  });

  /* An indexer serving `total` items in pages of the requested limit. */
  function pagedIndexer(routes: Record<string, { total: number; item: (i: number) => Record<string, unknown>; endless?: boolean }>) {
    const calls: URL[] = [];
    const fetch = vi.fn(async (input: string) => {
      const url = new URL(input);
      calls.push(url);
      const route = routes[url.pathname];
      if (!route) return new Response('{}', { status: 503 });
      const limit = Number(url.searchParams.get('limit') ?? 50);
      const start = Number(url.searchParams.get('cursor')?.replace('c', '') ?? 0);
      const end = Math.min(start + limit, route.total);
      const items = Array.from({ length: end - start }, (_, i) => route.item(start + i));
      return new Response(JSON.stringify({ data: { items, nextCursor: route.endless ? `c${start + limit}` : end < route.total ? `c${end}` : null }, meta: {} }), { status: 200 });
    });
    return { fetch, calls };
  }
  const orderJson = (i: number) => ({
    market: A.seatArena, orderId: String(i + 1), entryIndex: i, seatIndex: 1, side: i % 2 ? 'sell' : 'buy',
    priceAtoms: '84000000', priceTicks: '84000', lots: '1', baseAtoms: '1', clientIdHex: '', expirationNs: '0',
  });
  const marginJson = (i: number) => ({ address: address(100 + (i % 100)), accountId: i, owner: OWNER, vault: A.quoteVault, links: [] });

  it('reads every page of open orders and margin accounts from the indexer', async () => {
    const { fetch, calls } = pagedIndexer({
      [`/v1/owners/${OWNER}/orders`]: { total: 405, item: orderJson },
      [`/v1/owners/${OWNER}/margin`]: { total: 19, item: marginJson },
    });
    const { client: perps, env } = await client({ indexerUrl: 'https://indexer.example', fetch });
    const orders = await perps.getOpenOrders('BTC-THRUSD', OWNER);
    expect(orders).toHaveLength(405);
    expect(orders.map((order) => order.orderId)).toEqual(Array.from({ length: 405 }, (_, i) => BigInt(i + 1)));
    const orderCalls = calls.filter((url) => url.pathname.endsWith('/orders'));
    expect(orderCalls.map((url) => [url.searchParams.get('market'), url.searchParams.get('limit'), url.searchParams.get('cursor')])).toEqual([
      [A.seatArena, '200', null],
      [A.seatArena, '200', 'c200'],
      [A.seatArena, '200', 'c400'],
    ]);
    const accounts = await perps.getMarginAccounts(OWNER);
    expect(accounts.map((account) => account.accountId)).toEqual(Array.from({ length: 19 }, (_, i) => i));
    expect(calls.filter((url) => url.pathname.endsWith('/margin')).map((url) => url.searchParams.get('cursor'))).toEqual([null, 'c16']);
    /* All from the indexer: the chain's order arena and margin accounts were never read. */
    expect(env.reads).not.toContain(A.orderArena);
    expect(env.reads).not.toContain(env.margin);
  });

  it('reads the chain instead of returning a list the indexer cannot page to the end', async () => {
    const { fetch } = pagedIndexer({
      [`/v1/owners/${OWNER}/orders`]: { total: 0, item: orderJson, endless: true },
      [`/v1/owners/${OWNER}/margin`]: { total: 0, item: marginJson, endless: true },
    });
    const { client: perps, env } = await client({ indexerUrl: 'https://indexer.example', fetch });
    expect(await perps.getOpenOrders('BTC-THRUSD', OWNER)).toEqual([expect.objectContaining({ orderId: 4n, orderEntryIndex: 1 })]);
    expect(fetch.mock.calls.filter(([url]) => String(url).includes('/orders')).length).toBe(PERPS_INDEXER_MAX_PAGES);
    expect(env.reads).toContain(A.orderArena);
    expect(await perps.getMarginAccounts(OWNER)).toEqual([expect.objectContaining({ address: env.margin, accountId: 0 })]);
  });
});

describe('perpMarketFromIndexer', () => {
  const market = {
    statusFlags: 0, exchangeStatusFlags: 0, lotSize: '1', tickSize: '5000', nextOrderId: '1', priceCap: '9', maxPositionLots: '9', openInterestLots: '2', badDebt: '0',
    orderArena: A.orderArena, bidsCbook: A.bidsCbook, asksCbook: A.asksCbook, quoteVault: A.quoteVault, marketAuthority: A.marketAuthority, oracleFeed: A.oracleFeed,
    markNum: '1', markDen: '1', initialMarginBps: 500, maintenanceMarginBps: 250, liquidationFeeBps: 100, oracleExponent: -8, maxMarkAgeNs: '0',
  };
  const risk = {
    socializeCapBps: 300, ifEpochBudgetBps: 2000, bankruptLiqRewardBps: 50, feeBalance: '7', insuranceBalance: '5000', epochId: 3,
    epochIfDrawn: '10', epochSocTicks: '1000000', badDebtBoth: '0', lossOffsetLong: '1000000', lossOffsetShort: '-250000',
  };

  it('reads the loss waterfall state, so seats settle against the side index', () => {
    const m = perpMarketFromIndexer({ ...market, risk });
    expect(m.risk).toEqual({
      socializeCapBps: 300, ifEpochBudgetBps: 2000, bankruptLiqRewardBps: 50, feeBalance: 7n, insuranceBalance: 5_000n, epochId: 3,
      epochIfDrawn: 10n, epochSocTicks: 1_000_000n, badDebtBoth: 0n, lossOffsetLong: 1_000_000n, lossOffsetShort: -250_000n,
    });
    /* A long snapped before the charge pays it: 2 lots * 1e6 ticks = 2 atoms. */
    const seat = {
      quantityQuote: 100n, longLots: 2n, shortLots: 0n, openBidLots: 0n, openAskLots: 0n, entryNotional: 0n, openBidNotional: 0n, openAskNotional: 0n,
      cross: false, fundingSnapshot: 0n, fundingCarry: 0,
    };
    expect(perpSettleFunding(m, seat).seat.quantityQuote).toBe(98n);
    /* A long snapped after it owes nothing (without risk, its snapshot would read as 2 atoms owed to it). */
    expect(perpSettleFunding(m, { ...seat, fundingSnapshot: 1_000_000n }).seat.quantityQuote).toBe(100n);
  });

  it('has no risk state for a market without the waterfall', () => {
    expect('risk' in perpMarketFromIndexer({ ...market, risk: null })).toBe(false);
    expect('risk' in perpMarketFromIndexer(market)).toBe(false);
    expect(() => perpMarketFromIndexer({ ...market, risk: { ...risk, lossOffsetLong: 1.5 } })).toThrow('risk.lossOffsetLong');
    /* Malformed, not absent: refused rather than read as a market without the waterfall. */
    for (const bad of ['invalid', false, 0, [], true]) expect(() => perpMarketFromIndexer({ ...market, risk: bad })).toThrow('indexer field risk is not an object');
  });

  it('reads the fee rates, a seat\'s fee state and an order\'s builder code (0.5.0)', () => {
    const fees = {
      takerFeePpm: 300, makerRebatePpm: 100, builderFeeCapPpm: 50, feeInsuranceSharePpm: 250_000, liqInsuranceSharePpm: 0,
      pendingTakerFeePpm: 400, pendingBuilderFeeCapPpm: 0, pendingActivationNs: '7200000000000',
    };
    expect(perpMarketFromIndexer({ ...market, fees }).fees).toEqual({ ...fees, pendingActivationNs: 7_200_000_000_000n });
    expect('fees' in perpMarketFromIndexer({ ...market, fees: null })).toBe(false);
    expect('fees' in perpMarketFromIndexer(market)).toBe(false);
    expect(() => perpMarketFromIndexer({ ...market, fees: 'x' })).toThrow('indexer field fees is not an object');
    const seat = {
      seatIndex: 2, authority: A.marketAuthority, collateralAtoms: '0', cross: false, longLots: '0', shortLots: '0', openBidLots: '0', openAskLots: '0',
      headOrderEntryIndex: 0, entryNotionalAtoms: '0', openBidNotionalAtoms: '0', openAskNotionalAtoms: '0',
    };
    expect(perpSeatFromIndexer({ ...seat, feeReceiver: true, builderApproval: null })).toMatchObject({ feeReceiver: true });
    const approving = perpSeatFromIndexer({ ...seat, feeReceiver: false, builderApproval: { builderSeatIndex: 7, maxFeePpm: 20 } });
    expect(approving.builderApproval).toEqual({ builderSeatIndex: 7, maxFeePpm: 20 });
    expect('feeReceiver' in approving).toBe(false);
    expect('builderApproval' in perpSeatFromIndexer(seat)).toBe(false);
    const order = {
      market: A.seatArena, orderId: '5', entryIndex: 3, seatIndex: 2, side: 'buy', priceAtoms: '10000', priceTicks: '2', lots: '1', baseAtoms: '1',
      clientIdHex: '', expirationNs: '9',
    };
    expect(perpOpenOrderFromIndexer({ ...order, builder: { builderSeatIndex: 7, feePpm: 25 } }).builder).toEqual({ builderSeatIndex: 7, feePpm: 25 });
    expect('builder' in perpOpenOrderFromIndexer({ ...order, builder: null })).toBe(false);
  });
});

describe('indexerAllItems', () => {
  const indexerOf = (pages: Array<{ items: unknown[]; nextCursor?: unknown }>) => {
    const seen: Array<string | null> = [];
    const indexer = createPerpsIndexer({
      url: 'https://indexer.example',
      fetch: (async (input: string) => {
        const cursor = new URL(input).searchParams.get('cursor');
        seen.push(cursor);
        const page = pages[cursor === null ? 0 : Number(cursor)]!;
        return new Response(JSON.stringify({ data: page }), { status: 200 });
      }) as never,
    });
    return { indexer, seen };
  };

  it('follows nextCursor to a null cursor and keeps the query', async () => {
    const { indexer, seen } = indexerOf([{ items: [1, 2], nextCursor: '1' }, { items: [3], nextCursor: '2' }, { items: [4], nextCursor: null }]);
    expect(await indexerAllItems(indexer, '/v1/x', { limit: 2 })).toEqual([1, 2, 3, 4]);
    expect(seen).toEqual([null, '1', '2']);
    /* A bare array or a page without nextCursor is one page. */
    expect(await indexerAllItems(indexerOf([{ items: [9] }]).indexer, '/v1/x')).toEqual([9]);
  });

  it('throws past the page cap or on a repeated cursor instead of returning part of the list', async () => {
    const pages = [{ items: [1], nextCursor: '1' }, { items: [2], nextCursor: '2' }, { items: [3], nextCursor: null }];
    await expect(indexerAllItems(indexerOf(pages).indexer, '/v1/x', {}, { maxPages: 2 })).rejects.toThrow(new PerpsIndexerError('/v1/x', null, 'perps indexer /v1/x: more than 2 pages (2 items read); not returning a partial list'));
    expect(await indexerAllItems(indexerOf(pages).indexer, '/v1/x', {}, { maxPages: 3 })).toEqual([1, 2, 3]);
    await expect(indexerAllItems(indexerOf([{ items: [1], nextCursor: '1' }, { items: [2], nextCursor: '1' }]).indexer, '/v1/x')).rejects.toThrow('nextCursor repeated');
    await expect(indexerAllItems(indexerOf([{ items: [1], nextCursor: 7 }]).indexer, '/v1/x')).rejects.toThrow('nextCursor is not a string');
  });
});

describe('PerpsClient.getMark', () => {
  const NOW = 1_000_000_000_000n;
  async function markClient(feed: Parameters<typeof oracleFeedBytes>[0] | null, maxMarkAgeNs = 0n) {
    const env = await chain();
    env.accounts.set(A.seatArena, seatArenaBytes(A, [{ authority: OWNER, quantityQuote: 0n }], { maxMarkAgeNs }));
    if (feed) env.accounts.set(A.oracleFeed, oracleFeedBytes(feed));
    return createPerpsClient({ deployment, thru: env.thru as never, nowNs: () => NOW });
  }

  it('gives the mark of a fresh feed, up to and including the boundary age', async () => {
    for (const age of [0n, 5_000_000_000n]) {
      const perps = await markClient({ price: 84_000_000n, lastUpdateNs: NOW - age, maxStalenessNs: 5_000_000_000n });
      expect(await perps.getMark('BTC-THRUSD')).toEqual({
        market: A.seatArena, mark: 84_000_000n, feedPrice: 84_000_000n, exponent: -8, lastUpdateNs: NOW - age, maxAgeNs: 5_000_000_000n, stale: false, error: null,
      });
    }
  });

  it("is stale one nanosecond past the feed's max staleness when the market's max age is 0", async () => {
    const perps = await markClient({ price: 84_000_000n, lastUpdateNs: NOW - 5_000_000_001n, maxStalenessNs: 5_000_000_000n });
    expect(await perps.getMark('BTC-THRUSD')).toEqual({
      market: A.seatArena, mark: null, feedPrice: 84_000_000n, exponent: -8, lastUpdateNs: NOW - 5_000_000_001n, maxAgeNs: 5_000_000_000n, stale: true,
      error: 'oracle feed is stale: last updated 5000000001 ns ago, the market accepts at most 5000000000 ns',
    });
  });

  it("applies the market's maxMarkAgeNs over the feed's staleness when it is set", async () => {
    const feed = { price: 84_000_000n, maxStalenessNs: 60_000_000_000n };
    const atLimit = await (await markClient({ ...feed, lastUpdateNs: NOW - 2_000_000_000n }, 2_000_000_000n)).getMark('BTC-THRUSD');
    expect(atLimit).toMatchObject({ mark: 84_000_000n, maxAgeNs: 2_000_000_000n, stale: false, error: null });
    const past = await (await markClient({ ...feed, lastUpdateNs: NOW - 2_000_000_001n }, 2_000_000_000n)).getMark('BTC-THRUSD');
    expect(past).toMatchObject({ mark: null, maxAgeNs: 2_000_000_000n, stale: true });
    /* A shorter feed staleness does not apply once the market sets its own. */
    const longer = await (await markClient({ price: 84_000_000n, maxStalenessNs: 1n, lastUpdateNs: NOW - 1_000_000_000n }, 2_000_000_000n)).getMark('BTC-THRUSD');
    expect(longer).toMatchObject({ mark: 84_000_000n, stale: false });
  });

  it('is stale when the feed is stamped after the current time', async () => {
    const perps = await markClient({ price: 84_000_000n, lastUpdateNs: NOW + 1n, maxStalenessNs: 5_000_000_000n });
    expect(await perps.getMark('BTC-THRUSD')).toMatchObject({
      mark: null, stale: true, error: `oracle feed is stale: its last update (${NOW + 1n} ns) is after the current time (${NOW} ns)`,
    });
  });

  it("reports a feed of the wrong exponent before its age, as the program does, and a missing feed", async () => {
    const perps = await markClient({ price: 84_000_000n, lastUpdateNs: 0n, maxStalenessNs: 1n, exponent: -6 });
    expect(await perps.getMark('BTC-THRUSD')).toMatchObject({ mark: null, stale: false, error: expect.stringContaining('exponent -6 differs') });
    expect(await (await markClient(null)).getMark('BTC-THRUSD')).toMatchObject({ mark: null, stale: false, maxAgeNs: null, error: expect.stringContaining('not found') });
  });
});

describe('PerpsClient.send', () => {
  const signerFor = (results: Array<{ nonceCached?: boolean }>): PerpsSigner & { calls: Array<boolean | undefined> } => {
    const calls: Array<boolean | undefined> = [];
    return {
      kind: 'test',
      address: OWNER,
      calls,
      async sign({ fresh }) {
        calls.push(fresh);
        const raw = new Uint8Array(176);
        raw[175] = calls.length;
        return { raw, ...(results[calls.length - 1] ?? {}) };
      },
    };
  };
  const stream = (vmError: number, userErrorCode = 0n) =>
    async function* () {
      yield { status: 1 };
      yield { executionResult: { vmError, userErrorCode } };
    };

  it('returns the signature of an executed transaction', async () => {
    const { client: perps, env } = await client();
    env.thru.transactions.sendAndTrack.mockImplementation(stream(0));
    const built = await perps.createSeat({ market: 'ETH-THRUSD', owner: OTHER });
    const signer = signerFor([{}]);
    const result = await perps.send(built, signer);
    expect(result.label).toBe('create seat');
    expect(signer.calls).toEqual([false]);
    expect(env.thru.transactions.sendAndTrack).toHaveBeenCalledTimes(1);
  });

  it('names program errors and retries a stale cached nonce once with a fresh one', async () => {
    const { client: perps, env } = await client();
    env.thru.transactions.sendAndTrack.mockImplementationOnce(stream(-1, BigInt.asUintN(64, -213n)));
    const signer = signerFor([{}]);
    const error = await perps.send(await perps.createSeat({ market: 'ETH-THRUSD', owner: OTHER }), signer).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TransactionFailedError);
    expect(error).toMatchObject({ code: 'ORACLE_STALE', kind: 'oracle', retryable: true });
    expect((error as TransactionFailedError).message).toContain('oracle feed is stale');
    expect(signer.calls).toEqual([false]);

    env.thru.transactions.sendAndTrack.mockImplementationOnce(stream(TransactionVmError.TRANSACTION_VM_ERROR_NONCE_TOO_LOW)).mockImplementationOnce(stream(0));
    const retried = signerFor([{ nonceCached: true }, {}]);
    await perps.send(await perps.createSeat({ market: 'ETH-THRUSD', owner: OTHER }), retried);
    expect(retried.calls).toEqual([false, true]);

    env.thru.transactions.sendAndTrack.mockImplementationOnce(stream(TransactionVmError.TRANSACTION_VM_ERROR_SU_EXHAUSTED));
    const exhausted = signerFor([{ nonceCached: true }]);
    await expect(perps.send(await perps.createSeat({ market: 'ETH-THRUSD', owner: OTHER }), exhausted)).rejects.toMatchObject({ kind: 'state-units', vmErrorName: 'SU_EXHAUSTED' });
    expect(exhausted.calls).toEqual([false]);
  });

  it('a wallet signer hands the wallet an intent with the perp program first among the read-only accounts', async () => {
    const { client: perps, env } = await client();
    env.thru.transactions.sendAndTrack.mockImplementation(stream(0));
    const feePayer = address(70);
    const intents: PerpsWalletIntent[] = [];
    const wallet = {
      getSigningContext: async () => ({ feePayerPublicKey: feePayer }),
      signTransaction: async (intent: PerpsWalletIntent) => {
        intents.push(intent);
        return btoa(String.fromCharCode(...new Uint8Array(176)));
      },
    };
    const built = await perps.placeOrder({ market: 'ETH-THRUSD', owner: OWNER, side: 'sell', priceAtoms: 90_000_000n, lots: 2n });
    await perps.send(built, createWalletSigner({ wallet, walletAddress: OWNER }));
    expect(intents).toHaveLength(1);
    expect(intents[0]).toMatchObject({ walletAddress: OWNER, programAddress: deployment.perpProgram, stateUnits: built.transaction.stateUnits });
    expect(intents[0]!.readOnlyAddresses).toContain(deployment.perpProgram);
    expect(intents[0]!.readWriteAddresses).toContain(OWNER);
    expect(typeof intents[0]!.instructionData).toBe('string');
  });
});

describe('agent actions', () => {
  it('describes every action with a JSON Schema, filtered by the ABI version', async () => {
    const all = describePerpsActions();
    expect(all.map((action) => action.name)).toEqual([
      'getMarkets', 'getMarket', 'getBook', 'getMark', 'getFunding', 'getSeat', 'getMarginAccounts', 'getOpenOrders',
      'createSeat', 'placeOrder', 'placeOrders', 'cancel', 'cancelAll', 'modify', 'deposit', 'withdraw',
      'createMarginAccount', 'linkMargin', 'unlinkMargin', 'settleFunding', 'settleAccountFunding', 'liquidate',
    ]);
    for (const action of all) {
      expect(action.parameters.type).toBe('object');
      expect(action.parameters.additionalProperties).toBe(false);
      for (const required of action.parameters.required ?? []) expect(action.parameters.properties).toHaveProperty(required);
      expect(JSON.parse(JSON.stringify(action))).toEqual(action);
    }
    expect(all.find((action) => action.name === 'placeOrder')!.parameters).toMatchObject({
      required: ['market', 'owner', 'side'],
      properties: { side: { enum: ['buy', 'sell'] }, orderType: { enum: ['gtc', 'ioc', 'fok', 'alo', 'mtl'] } },
    });
    const { client: old } = await client({ abiVersion: PERP_ABI_V0_2 });
    const names = describePerpsActions(old).map((action) => action.name);
    expect(names).not.toContain('linkMargin');
    expect(names).not.toContain('settleFunding');
    expect(perpsToolDefinitions(old)[0]).toEqual({ name: 'perps_getMarkets', description: expect.any(String), input_schema: expect.objectContaining({ type: 'object' }) });
  });

  it('validates params and runs actions to JSON-safe results', async () => {
    const { client: perps, env } = await client();
    expect(validatePerpsActionParams('placeOrder', { market: 'BTC-THRUSD', owner: OWNER, side: 'hold', bogus: 1 })).toEqual([
      'params.side must be one of buy, sell',
      'params.bogus is not a parameter',
    ]);
    const seat = await runPerpsAction(perps, 'getSeat', { market: 'BTC-THRUSD', owner: OWNER });
    expect(seat).toMatchObject({ ok: true, result: { seatIndex: 1, quantityQuote: '-5000', cross: true } });
    expect(JSON.parse(JSON.stringify(seat))).toEqual(seat);

    const unsigned = await runPerpsAction(perps, 'placeOrder', { market: 'ETH-THRUSD', owner: OWNER, side: 'buy', price: '42000', size: '0.001' });
    expect(unsigned.ok && (unsigned.result as { transaction: { instructions: Array<{ ix: string }> } }).transaction.instructions.map((ix) => ix.ix)).toEqual([
      'margin_record', 'market_record', 'create_order_entry',
    ]);

    env.thru.transactions.sendAndTrack.mockImplementation(async function* () {
      yield { executionResult: { vmError: -1, userErrorCode: BigInt.asUintN(64, -403n) } };
    });
    const signer: PerpsSigner = { kind: 'test', address: OWNER, sign: async () => ({ raw: new Uint8Array(176) }) };
    const failed = await runPerpsAction(perps, 'placeOrder', { market: 'ETH-THRUSD', owner: OWNER, side: 'buy', price: '42000', size: '0.001' }, { signer });
    expect(failed).toMatchObject({ ok: false, error: { code: 'INSUFFICIENT_COLLATERAL', kind: 'insufficient-margin', retryable: false } });
    expect(await runPerpsAction(perps, 'placeOrder', { market: 'ETH-THRUSD', owner: OTHER, side: 'buy', price: '1', size: '1' }, { signer })).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining('has no seat') },
    });
    expect(await runPerpsAction(perps, 'nope', {})).toMatchObject({ ok: false, error: { message: 'invalid parameters: unknown action nope' } });
  });
});
