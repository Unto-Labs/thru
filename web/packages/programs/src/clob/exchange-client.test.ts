import { describe, expect, it } from 'vitest';
import { Pubkey } from '@thru/sdk';
import { encodeAddress } from '@thru/sdk/helpers';
import type { Thru } from '@thru/sdk/client';
import { deriveTokenAccountAddress } from '../token';
import {
  TickerFieldBuilder,
  TokenAccountBuilder,
  TokenMintAccountBuilder,
} from '../token/abi/thru/program/token/types';
import {
  CLOB_PROGRAM_ADDRESS,
  CLOB_STATUS_FLAG_DEPOSITS_FROZEN,
  CLOB_STATUS_FLAG_PAUSED,
  SeatEntryBuilder,
} from './index';
import {
  ClobExchangeClientError,
  createClobExchangeClient,
  type ClobExchangeDataSource,
} from './exchange-client';
import type { ClobAssetBalanceAllocation, ClobTradingMarket } from './exchange';

const AUTHORITY = address(10);
const TOKEN_PROGRAM = address(11);
const EXCHANGE_META = address(12);
const BTC = address(20);
const ETH = address(21);
const USD = address(22);
const OTHER = address(23);

describe('ClobExchangeClient', () => {
  it('discovers assets by mint and token program and reads each canonical account once', async () => {
    const markets = [market(30, BTC, USD), market(31, USD, ETH)];
    const harness = createHarness({
      markets,
      allocations: [
        balance(markets[0]!, USD, 'quote', 40n),
        balance(markets[1]!, USD, 'base', 60n),
      ],
    });
    harness.setMint(USD, 6, 'USD');

    const snapshot = await harness.client.getAccountSnapshot({ authority: AUTHORITY });

    expect(snapshot.assets.map((asset) => asset.mint)).toEqual([BTC, ETH, USD].sort());
    expect(snapshot.assets.find((asset) => asset.mint === USD)?.exchange.freeAmount).toBe(100n);
    expect(snapshot.assets.find((asset) => asset.mint === USD)).toMatchObject({
      symbol: 'USD',
      decimals: 6,
    });
    expect(snapshot.unavailableMarkets).toEqual([]);
    for (const asset of snapshot.assets) {
      expect(asset.discoveryComplete).toBe(true);
      expect(asset.wallet).toMatchObject({ amount: 0n, exists: false });
      expect(harness.reads.get(asset.wallet.tokenAccount)).toBe(1);
    }
  });

  it('returns healthy assets when an unrelated market is unavailable', async () => {
    const healthy = market(32, BTC, USD);
    const unavailable = market(33, ETH, OTHER);
    const harness = createHarness({
      markets: [healthy],
      unavailableMarkets: [{
        market: unavailable.address,
        baseMint: unavailable.baseMint,
        quoteMint: unavailable.quoteMint,
        reason: 'detail request failed',
      }],
    });

    const snapshot = await harness.client.getAccountSnapshot({ authority: AUTHORITY });

    expect(snapshot.assets.map((asset) => asset.mint)).toEqual([BTC, USD].sort());
    expect(snapshot.assets.every((asset) => asset.discoveryComplete)).toBe(true);
    expect(snapshot.unavailableMarkets).toHaveLength(1);
  });

  it('keeps allocation-only assets visible and marks their balances partial', async () => {
    const healthy = market(34, BTC, USD);
    const unavailable = market(35, ETH, OTHER);
    const harness = createHarness({
      markets: [healthy],
      allocations: [balance(unavailable, ETH, 'base', 7n)],
      unavailableMarkets: [{
        market: unavailable.address,
        baseMint: unavailable.baseMint,
        quoteMint: unavailable.quoteMint,
        reason: 'detail request failed',
      }],
    });

    const snapshot = await harness.client.getAccountSnapshot({ authority: AUTHORITY });
    const eth = snapshot.assets.find((asset) => asset.mint === ETH);

    expect(eth).toMatchObject({
      discoveryComplete: false,
      exchange: { freeAmount: 7n },
    });
    expect(snapshot.assets.find((asset) => asset.mint === BTC)?.discoveryComplete).toBe(true);
  });

  it('marks every returned asset partial when unavailable metadata has unknown mints', async () => {
    const healthy = market(36, BTC, USD);
    const harness = createHarness({
      markets: [healthy],
      unavailableMarkets: [{
        market: address(37),
        baseMint: null,
        quoteMint: null,
        reason: 'metadata is unavailable',
      }],
    });

    const snapshot = await harness.client.getAccountSnapshot({ authority: AUTHORITY });

    expect(snapshot.assets).not.toHaveLength(0);
    expect(snapshot.assets.every((asset) => !asset.discoveryComplete)).toBe(true);
  });

  it('selects a deterministic fallback market and creates a seat when none exists', async () => {
    const later = market(81, BTC, USD);
    const earlier = market(80, BTC, USD);
    const harness = createHarness({ markets: [later, earlier] });
    harness.setWalletBalance(BTC, 100n);
    harness.setSeats(later, []);
    harness.setSeats(earlier, []);

    const prepared = await harness.client.prepareDeposit({
      authority: AUTHORITY,
      mint: BTC,
      amount: 10n,
    });

    expect(prepared.market.address).toBe(earlier.address);
    expect(prepared.seatIndex).toBeNull();
  });

  it('prefers a market with an existing seat and returns authoritative balance effects', async () => {
    const first = market(40, BTC, USD);
    const second = market(41, BTC, USD);
    const allocation = balance(second, BTC, 'base', 25n);
    const harness = createHarness({ markets: [first, second], allocations: [allocation] });
    harness.setWalletBalance(BTC, 100n);
    harness.setSeats(second, [{ authority: AUTHORITY, base: 25n, quote: 0n }]);

    const prepared = await harness.client.prepareDeposit({
      authority: AUTHORITY,
      mint: BTC,
      amount: 10n,
    });

    expect(prepared.market.address).toBe(second.address);
    expect(prepared.seatIndex).toBe(2);
    expect(prepared.tokenSide).toBe('base');
    expect(prepared.effects).toEqual([
      { location: 'wallet', mint: BTC, tokenProgram: TOKEN_PROGRAM, delta: -10n },
      { location: 'exchange', mint: BTC, tokenProgram: TOKEN_PROGRAM, delta: 10n, market: second.address },
    ]);
  });

  it('skips a frozen existing market when another market accepts deposits', async () => {
    const frozen = { ...market(42, BTC, USD), statusFlags: CLOB_STATUS_FLAG_DEPOSITS_FROZEN };
    const available = market(43, BTC, USD);
    const harness = createHarness({
      markets: [frozen, available],
      allocations: [balance(frozen, BTC, 'base', 25n)],
    });
    harness.setWalletBalance(BTC, 100n);
    harness.setSeats(available, []);

    const prepared = await harness.client.prepareDeposit({
      authority: AUTHORITY,
      mint: BTC,
      amount: 10n,
    });

    expect(prepared.market.address).toBe(available.address);
  });

  it('skips a paused existing market when an active market accepts deposits', async () => {
    const paused = { ...market(44, BTC, USD), statusFlags: CLOB_STATUS_FLAG_PAUSED };
    const active = market(45, BTC, USD);
    const harness = createHarness({
      markets: [paused, active],
      allocations: [balance(paused, BTC, 'base', 25n)],
    });
    harness.setWalletBalance(BTC, 100n);
    harness.setSeats(active, []);

    const prepared = await harness.client.prepareDeposit({
      authority: AUTHORITY,
      mint: BTC,
      amount: 10n,
    });

    expect(prepared.market.address).toBe(active.address);
  });

  it('rejects deposits when every compatible market is paused', async () => {
    const paused = { ...market(46, BTC, USD), statusFlags: CLOB_STATUS_FLAG_PAUSED };
    const harness = createHarness({ markets: [paused] });

    await expect(harness.client.prepareDeposit({
      authority: AUTHORITY,
      mint: BTC,
      amount: 10n,
    })).rejects.toMatchObject({ code: 'market_paused' });
  });

  it('keeps paused markets available for withdrawals', async () => {
    const paused = { ...market(48, BTC, USD), statusFlags: CLOB_STATUS_FLAG_PAUSED };
    const harness = createHarness({
      markets: [paused],
      allocations: [balance(paused, BTC, 'base', 25n)],
    });
    harness.setSeats(paused, [{ authority: AUTHORITY, base: 25n, quote: 0n }]);

    await expect(harness.client.prepareWithdrawal({
      authority: AUTHORITY,
      mint: BTC,
      amount: 10n,
    })).resolves.toMatchObject({ market: { address: paused.address } });
  });

  it('rejects a selected vault whose on-chain mint does not match', async () => {
    const target = market(47, BTC, USD);
    const harness = createHarness({ markets: [target] });
    harness.setWalletBalance(BTC, 100n);
    harness.setSeats(target, []);
    harness.setVaultMint(target.baseVault, OTHER);

    await expect(harness.client.prepareDeposit({
      authority: AUTHORITY,
      mint: BTC,
      amount: 10n,
    })).rejects.toMatchObject({
      code: 'invalid_token_account',
      details: {
        market: target.address,
        vault: target.baseVault,
        expectedMint: BTC,
        actualMint: OTHER,
      },
    });
  });

  it('uses fresh seat balances for withdrawals and reports fragmented funds', async () => {
    const first = market(50, BTC, USD);
    const second = market(51, BTC, USD);
    const harness = createHarness({
      markets: [first, second],
      allocations: [balance(first, BTC, 'base', 60n), balance(second, BTC, 'base', 60n)],
    });
    harness.setSeats(first, [{ authority: AUTHORITY, base: 60n, quote: 0n }]);
    harness.setSeats(second, [{ authority: AUTHORITY, base: 60n, quote: 0n }]);

    await expect(harness.client.prepareWithdrawal({
      authority: AUTHORITY,
      mint: BTC,
      amount: 100n,
    })).rejects.toMatchObject<Partial<ClobExchangeClientError>>({ code: 'fragmented_balance' });

    const prepared = await harness.client.prepareWithdrawal({
      authority: AUTHORITY,
      mint: BTC,
      amount: 50n,
    });
    expect(prepared.market.address).toBe(first.address);
    expect(prepared.effects.map((effect) => effect.delta)).toEqual([-50n, 50n]);
  });

  it('rejects an indexed funded-order plan when a source seat changed on chain', async () => {
    const target = market(60, BTC, USD);
    const source = market(61, ETH, USD);
    const harness = createHarness({
      markets: [target, source],
      allocations: [
        balance(target, USD, 'quote', 30n),
        balance(source, USD, 'quote', 80n),
      ],
    });
    harness.setSeats(target, [{ authority: AUTHORITY, base: 0n, quote: 30n }]);
    harness.setSeats(source, [{ authority: AUTHORITY, base: 0n, quote: 20n }]);

    await expect(harness.client.prepareOrder({
      authority: AUTHORITY,
      market: target.address,
      side: 'buy',
      orderType: 'gtc',
      price: 10n,
      quantity: 10n,
    })).rejects.toMatchObject({ code: 'stale_balance' });
  });

  it('prepares one funded order from multiple compatible market allocations', async () => {
    const target = market(90, BTC, USD);
    const firstSource = market(91, ETH, USD);
    const secondSource = market(92, BTC, USD);
    const harness = createHarness({
      markets: [target, firstSource, secondSource],
      allocations: [
        balance(target, USD, 'quote', 30n),
        balance(firstSource, USD, 'quote', 40n),
        balance(secondSource, USD, 'quote', 40n),
      ],
    });
    harness.setSeats(target, [{ authority: AUTHORITY, base: 0n, quote: 30n }]);
    harness.setSeats(firstSource, [{ authority: AUTHORITY, base: 0n, quote: 40n }]);
    harness.setSeats(secondSource, [{ authority: AUTHORITY, base: 0n, quote: 40n }]);

    const prepared = await harness.client.prepareOrder({
      authority: AUTHORITY,
      market: target.address,
      side: 'buy',
      orderType: 'gtc',
      price: 10n,
      quantity: 10n,
    });

    expect(prepared.funding.sources).toHaveLength(2);
    expect(prepared.sourceMarkets.map((entry) => entry.address)).toEqual([
      firstSource.address,
      secondSource.address,
    ]);
    expect(prepared.effects).toEqual([{
      location: 'exchange',
      mint: USD,
      tokenProgram: TOKEN_PROGRAM,
      delta: -100n,
      market: target.address,
    }]);
  });

  it('rejects a canonical account owned by another wallet', async () => {
    const onlyMarket = market(70, BTC, USD);
    const harness = createHarness({ markets: [onlyMarket] });
    harness.setWalletBalance(BTC, 10n, address(99));

    await expect(harness.client.getAccountSnapshot({ authority: AUTHORITY })).rejects.toMatchObject({
      code: 'invalid_token_account',
    });
  });

  it('allows an operation when unavailable market metadata is unrelated to its asset', async () => {
    const healthy = market(71, BTC, USD);
    const unavailable = market(72, ETH, OTHER);
    const harness = createHarness({
      markets: [healthy],
      unavailableMarkets: [{
        market: unavailable.address,
        baseMint: unavailable.baseMint,
        quoteMint: unavailable.quoteMint,
        reason: 'detail request failed',
      }],
    });
    harness.setWalletBalance(BTC, 10n);
    harness.setSeats(healthy, []);

    await expect(harness.client.prepareDeposit({
      authority: AUTHORITY,
      mint: BTC,
      amount: 1n,
    })).resolves.toMatchObject({ market: { address: healthy.address } });
  });

  it('rejects an operation when unavailable market metadata may affect its asset', async () => {
    const healthy = market(73, BTC, USD);
    const unavailable = market(74, BTC, ETH);
    const harness = createHarness({
      markets: [healthy],
      unavailableMarkets: [{
        market: unavailable.address,
        baseMint: unavailable.baseMint,
        quoteMint: unavailable.quoteMint,
        reason: 'detail request failed',
      }],
    });

    await expect(harness.client.prepareDeposit({
      authority: AUTHORITY,
      mint: BTC,
      amount: 1n,
    })).rejects.toMatchObject({
      code: 'data_source_unavailable',
      details: { unavailableMarkets: unavailable.address, mint: BTC },
    });
  });

  it('reports an unavailable target market specifically', async () => {
    const unavailable = market(75, BTC, USD);
    const harness = createHarness({
      markets: [],
      unavailableMarkets: [{
        market: unavailable.address,
        baseMint: unavailable.baseMint,
        quoteMint: unavailable.quoteMint,
        reason: 'market account metadata is unavailable',
      }],
    });

    await expect(harness.client.prepareOrder({
      authority: AUTHORITY,
      market: unavailable.address,
      side: 'buy',
      price: 1n,
      quantity: 1n,
    })).rejects.toMatchObject({
      code: 'incomplete_market_metadata',
      details: { market: unavailable.address },
    });
  });
});

function createHarness({
  markets,
  allocations = [],
  unavailableMarkets = [],
}: {
  markets: ClobTradingMarket[];
  allocations?: ClobAssetBalanceAllocation[];
  unavailableMarkets?: Array<{
    market: string;
    baseMint: string | null;
    quoteMint: string | null;
    reason: string;
  }>;
}) {
  const accounts = new Map<string, Uint8Array>();
  const reads = new Map<string, number>();
  const thruClient = {
    accounts: {
      get: async (accountAddress: string) => {
        reads.set(accountAddress, (reads.get(accountAddress) ?? 0) + 1);
        const data = accounts.get(accountAddress);
        if (!data) throw Object.assign(new Error('not found'), { code: 5 });
        return { data: { data } };
      },
    },
    proofs: {
      generate: async () => ({ proof: new Uint8Array([1]) }),
    },
    helpers: {
      deriveAddress: (seeds: Uint8Array[]) => {
        const bytes = hashBytes(seeds);
        return { address: encodeAddress(bytes), bytes };
      },
      deriveProgramAddress: ({ programAddress, seed }: {
        programAddress: string;
        seed: Uint8Array;
      }) => {
        const bytes = hashBytes([bytesFor(programAddress), seed]);
        return { address: encodeAddress(bytes), bytes };
      },
    },
  } as unknown as Thru;
  const dataSource: ClobExchangeDataSource = {
    getMarkets: async () => ({ markets, unavailableMarkets }),
    getAssetAllocations: async () => allocations,
  };
  const client = createClobExchangeClient({
    thruClient,
    dataSource,
    tokenProgramAddress: TOKEN_PROGRAM,
  });

  for (const target of markets) {
    accounts.set(target.baseVault, tokenAccount(target.baseMint, CLOB_PROGRAM_ADDRESS));
    accounts.set(target.quoteVault, tokenAccount(target.quoteMint, CLOB_PROGRAM_ADDRESS));
  }

  return {
    client,
    reads,
    setMint(mint: string, decimals: number, symbol: string) {
      const symbolBytes = new TextEncoder().encode(symbol);
      const paddedSymbol = new Uint8Array(8);
      paddedSymbol.set(symbolBytes);
      const ticker = new TickerFieldBuilder()
        .set_length(symbolBytes.length)
        .set_bytes(Array.from(paddedSymbol))
        .build();
      accounts.set(mint, new TokenMintAccountBuilder()
        .set_decimals(decimals)
        .set_ticker(ticker)
        .build());
    },
    setWalletBalance(mint: string, amount: bigint, owner = AUTHORITY) {
      const tokenAccount = deriveTokenAccountAddress(
        thruClient,
        AUTHORITY,
        mint,
        TOKEN_PROGRAM
      ).address;
      accounts.set(tokenAccount, new TokenAccountBuilder()
        .set_mint(bytesFor(mint))
        .set_owner(bytesFor(owner))
        .set_amount(amount)
        .set_is_frozen(0)
        .build());
    },
    setVaultMint(vault: string, mint: string) {
      accounts.set(vault, tokenAccount(mint, CLOB_PROGRAM_ADDRESS));
    },
    setSeats(target: ClobTradingMarket, seats: Array<{
      authority: string;
      base: bigint;
      quote: bigint;
    }>) {
      const data = new Uint8Array(320 + (seats.length + 1) * 64);
      seats.forEach((seat, index) => {
        data.set(new SeatEntryBuilder()
          .set_seat_authority_pubkey(bytesFor(seat.authority))
          .set_quantity_base(seat.base)
          .set_quantity_quote(seat.quote)
          .set_head_order_entry_idx(0)
          .set_reserved0(0)
          .set_non_nullable_reserved(1n)
          .build(), 320 + (index + 1) * 64);
      });
      accounts.set(target.address, data);
    },
  };
}

function tokenAccount(mint: string, owner: string): Uint8Array {
  return new TokenAccountBuilder()
    .set_mint(bytesFor(mint))
    .set_owner(bytesFor(owner))
    .set_amount(0n)
    .set_is_frozen(0)
    .build();
}

function market(id: number, baseMint: string, quoteMint: string): ClobTradingMarket {
  return {
    address: address(id),
    orderArena: address(id + 40),
    bidsCbook: address(id + 80),
    asksCbook: address(id + 120),
    exchangeMeta: EXCHANGE_META,
    tokenProgram: TOKEN_PROGRAM,
    baseMint,
    quoteMint,
    baseVault: address(id + 160),
    quoteVault: address(id + 180),
    marketAuthority: address(id + 200),
    statusFlags: 0,
  };
}

function balance(
  target: ClobTradingMarket,
  mint: string,
  tokenSide: 'base' | 'quote',
  freeAmount: bigint
): ClobAssetBalanceAllocation {
  return {
    market: target.address,
    authority: AUTHORITY,
    seatIndex: 2,
    tokenSide,
    mint,
    vault: tokenSide === 'base' ? target.baseVault : target.quoteVault,
    freeAmount,
    statusFlags: 0,
    tokenProgram: TOKEN_PROGRAM,
    metadataReady: true,
  };
}

function address(id: number): string {
  const bytes = new Uint8Array(32);
  bytes[0] = id & 0xff;
  bytes[1] = (id >> 8) & 0xff;
  return encodeAddress(bytes);
}

function bytesFor(value: string): Uint8Array {
  return Pubkey.from(value).toBytes();
}

function hashBytes(seeds: Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(32);
  seeds.forEach((seed, seedIndex) => seed.forEach((value, index) => {
    bytes[(index + seedIndex * 7) % bytes.length] = (
      bytes[(index + seedIndex * 7) % bytes.length]! + value + seedIndex + 1
    ) & 0xff;
  }));
  return bytes;
}
