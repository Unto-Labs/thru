import { Pubkey } from '@thru/sdk';
import type { Thru } from '@thru/sdk/client';
import {
  createInitializeAccountInstruction,
  deriveTokenAccountAddress,
  isAccountNotFoundError,
  parseMintAccountData,
  parseTokenAccountData,
} from '../token';
import {
  aggregateClobExchangeBalances,
  buildClobExchangeDepositInstructionPlan,
  buildClobExchangeWithdrawalInstructionPlan,
  buildClobFundedOrderInstructionPlan,
  planClobOrderFunding,
  validateClobOrderFundingPlanSeats,
  wrapClobPlanWithTokenAccountInitialization,
  type ClobAssetBalanceAllocation,
  type ClobInstructionPlan,
  type ClobOrderFundingPlan,
  type ClobTradingMarket,
  type ClobTransactionPlan,
} from './exchange';
import {
  CLOB_PROGRAM_ADDRESS,
  CLOB_STATUS_FLAG_DEPOSITS_FROZEN,
  CLOB_STATUS_FLAG_WITHDRAWALS_FROZEN,
  parseSeatArenaAccount,
  type ClobOrderSide,
  type ClobOrderType,
  type ClobSeatEntry,
  type ClobTokenSide,
} from './index';

const TOKEN_ACCOUNT_DEFAULT_SEED = new Uint8Array(32);
const STATE_PROOF_TYPE_CREATING = 1;
const DEFAULT_ORDER_EXPIRATION_TIME = 9_223_372_036_854_775_807n;

export interface ClobExchangeDataSource {
  getMarkets(): Promise<ClobMarketDiscovery>;
  getAssetAllocations(authority: string): Promise<ClobAssetBalanceAllocation[]>;
}

export interface ClobUnavailableMarket {
  market: string;
  baseMint: string | null;
  quoteMint: string | null;
  reason: string;
}

export interface ClobMarketDiscovery {
  markets: ClobTradingMarket[];
  unavailableMarkets: ClobUnavailableMarket[];
}

export interface ClobWalletTokenAccountSnapshot {
  tokenAccount: string;
  amount: bigint;
  exists: boolean;
}

export interface ClobExchangeAssetSnapshot {
  mint: string;
  tokenProgram: string;
  symbol: string | null;
  discoveryComplete: boolean;
  exchange: {
    freeAmount: bigint;
    transferableAmount: bigint;
    allocations: ClobAssetBalanceAllocation[];
  };
  wallet: ClobWalletTokenAccountSnapshot;
}

export interface ClobExchangeAccountSnapshot {
  authority: string;
  assets: ClobExchangeAssetSnapshot[];
  unavailableMarkets: ClobUnavailableMarket[];
}

export interface ClobBalanceEffect {
  location: 'wallet' | 'exchange';
  mint: string;
  tokenProgram: string;
  delta: bigint;
  market?: string;
}

export interface ClobPreparedOperation {
  plan: ClobTransactionPlan;
  effects: ClobBalanceEffect[];
}

export interface ClobPreparedDeposit extends ClobPreparedOperation {
  market: ClobTradingMarket;
  tokenSide: ClobTokenSide;
  seatIndex: number | null;
  walletTokenAccount: ClobWalletTokenAccountSnapshot;
}

export interface ClobPreparedWithdrawal extends ClobPreparedOperation {
  market: ClobTradingMarket;
  tokenSide: ClobTokenSide;
  seatIndex: number;
  walletTokenAccount: ClobWalletTokenAccountSnapshot;
}

export interface ClobPreparedOrder extends ClobPreparedOperation {
  market: ClobTradingMarket;
  funding: ClobOrderFundingPlan;
  sourceMarkets: ClobTradingMarket[];
  walletTokenAccount: ClobWalletTokenAccountSnapshot;
}

export type ClobExchangeClientErrorCode =
  | 'data_source_unavailable'
  | 'incomplete_market_metadata'
  | 'asset_not_found'
  | 'ambiguous_asset'
  | 'invalid_amount'
  | 'insufficient_wallet_balance'
  | 'insufficient_exchange_balance'
  | 'fragmented_balance'
  | 'invalid_token_account';

export class ClobExchangeClientError extends Error {
  readonly code: ClobExchangeClientErrorCode;
  readonly details?: Readonly<Record<string, string>>;

  constructor(
    code: ClobExchangeClientErrorCode,
    message: string,
    details?: Readonly<Record<string, string>>
  ) {
    super(message);
    this.name = 'ClobExchangeClientError';
    this.code = code;
    this.details = details;
  }
}

export interface CreateClobExchangeClientArgs {
  thruClient: Thru;
  dataSource: ClobExchangeDataSource;
  tokenProgramAddress: string;
  clobProgramAddress?: string;
}

export interface PrepareClobDepositArgs {
  authority: string;
  mint: string;
  amount: bigint;
}

export interface PrepareClobWithdrawalArgs extends PrepareClobDepositArgs {}

export interface PrepareClobOrderArgs {
  authority: string;
  market: string | ClobTradingMarket;
  side: ClobOrderSide;
  orderType?: ClobOrderType;
  price: bigint;
  quantity: bigint;
  expirationTime?: bigint;
  clientId?: Uint8Array;
  discardAfterMatch?: boolean;
  failIfOutsideBook?: boolean;
  targetSeatIndex?: number;
}

export interface ClobWithdrawalCapacity {
  mint: string;
  tokenProgram: string;
  total: bigint;
  maximumSingleAllocation: bigint;
}

export interface ClobExchangeClient {
  getAccountSnapshot(args: { authority: string }): Promise<ClobExchangeAccountSnapshot>;
  getWithdrawalCapacity(args: { authority: string; mint: string }): Promise<ClobWithdrawalCapacity>;
  prepareDeposit(args: PrepareClobDepositArgs): Promise<ClobPreparedDeposit>;
  prepareWithdrawal(args: PrepareClobWithdrawalArgs): Promise<ClobPreparedWithdrawal>;
  prepareOrder(args: PrepareClobOrderArgs): Promise<ClobPreparedOrder>;
}

export function createClobExchangeClient(
  args: CreateClobExchangeClientArgs
): ClobExchangeClient {
  const clobProgramAddress = args.clobProgramAddress ?? CLOB_PROGRAM_ADDRESS;

  async function loadState(authority: string): Promise<{
    markets: ClobTradingMarket[];
    allocations: ClobAssetBalanceAllocation[];
    unavailableMarkets: ClobUnavailableMarket[];
  }> {
    try {
      const [discovery, allocations] = await Promise.all([
        args.dataSource.getMarkets(),
        args.dataSource.getAssetAllocations(authority),
      ]);
      for (const market of discovery.markets) validateMarketMetadata(market);
      return {
        markets: sortMarkets(discovery.markets),
        allocations,
        unavailableMarkets: discovery.unavailableMarkets,
      };
    } catch (error) {
      if (error instanceof ClobExchangeClientError) throw error;
      throw new ClobExchangeClientError(
        'data_source_unavailable',
        'CLOB exchange data source is unavailable',
        { cause: errorMessage(error) }
      );
    }
  }

  /**
   * Retrieves a comprehensive snapshot of the user's canonical wallet accounts
   * and current allocations across the CLOB exchange.
   */
  async function getAccountSnapshot(
    snapshotArgs: { authority: string }
  ): Promise<ClobExchangeAccountSnapshot> {
    const { authority } = snapshotArgs;
    const { markets, allocations, unavailableMarkets } = await loadState(authority);
    const balances = new Map(
      aggregateClobExchangeBalances(allocations)
        .filter((balance) => balance.authority === authority)
        .map((balance) => [assetKey(balance.mint, balance.tokenProgram), balance])
    );
    const assets = uniqueSnapshotAssets(markets, allocations, authority);
    const snapshots = await Promise.all(assets.map(async ({ mint, tokenProgram }) => {
      const balance = balances.get(assetKey(mint, tokenProgram));
      const [wallet, symbol] = await Promise.all([
        readCanonicalWalletAccount(authority, mint, tokenProgram),
        readMintSymbol(mint),
      ]);
      return {
        mint,
        tokenProgram,
        symbol,
        discoveryComplete: isAssetDiscoveryComplete(
          unavailableMarkets,
          balance?.allocations ?? [],
          mint
        ),
        exchange: {
          freeAmount: balance?.freeAmount ?? 0n,
          transferableAmount: balance?.transferableAmount ?? 0n,
          allocations: balance?.allocations ?? [],
        },
        wallet,
      } satisfies ClobExchangeAssetSnapshot;
    }));
    return { authority, assets: snapshots, unavailableMarkets };
  }

  /**
   * Calculates the withdrawal capacity for a given mint.
   * Leverages fresh seat readings to accurately determine maximum available funds.
   */
  async function getWithdrawalCapacity(
    capacityArgs: { authority: string; mint: string }
  ): Promise<ClobWithdrawalCapacity> {
    const { markets, allocations, unavailableMarkets } = await loadState(capacityArgs.authority);
    assertAssetDiscoveryComplete(
      unavailableMarkets,
      allocations,
      capacityArgs.authority,
      capacityArgs.mint
    );
    const candidates = withdrawalAllocations(
      allocations,
      markets,
      capacityArgs.authority,
      capacityArgs.mint,
      args.tokenProgramAddress
    );
    const fresh = await freshWithdrawalAllocations(
      candidates,
      markets,
      capacityArgs.authority,
      readMarketSeats
    );
    return {
      mint: capacityArgs.mint,
      tokenProgram: args.tokenProgramAddress,
      total: fresh.reduce((sum, entry) => sum + entry.amount, 0n),
      maximumSingleAllocation: fresh.reduce(
        (maximum, entry) => entry.amount > maximum ? entry.amount : maximum,
        0n
      ),
    };
  }

  async function prepareDeposit(
    depositArgs: PrepareClobDepositArgs
  ): Promise<ClobPreparedDeposit> {
    assertPositiveAmount(depositArgs.amount);
    const { markets, allocations, unavailableMarkets } = await loadState(depositArgs.authority);
    assertAssetDiscoveryComplete(
      unavailableMarkets,
      allocations,
      depositArgs.authority,
      depositArgs.mint
    );
    const eligible = marketsForAsset(markets, depositArgs.mint, args.tokenProgramAddress);
    if (eligible.length === 0) throw assetNotFound(depositArgs.mint);
    const acceptingDeposits = eligible.filter(
      (market) => !(market.statusFlags & CLOB_STATUS_FLAG_DEPOSITS_FROZEN)
    );
    /* Preserve the builder's deposits_frozen error when every compatible
       market is frozen, but never prefer a frozen existing allocation over
       another market that can actually accept the deposit. */
    const market = chooseDepositMarket(
      acceptingDeposits.length > 0 ? acceptingDeposits : eligible,
      allocations,
      depositArgs.authority,
      depositArgs.mint
    );
    const tokenSide = tokenSideForMint(market, depositArgs.mint);
    const seats = await readMarketSeats(market);
    const existingSeat = seats
      .filter((seat) => seat.seatAuthority === depositArgs.authority)
      .sort((a, b) => a.seatIndex - b.seatIndex)[0] ?? null;
    const wallet = await readCanonicalWalletAccount(
      depositArgs.authority,
      depositArgs.mint,
      args.tokenProgramAddress
    );
    if (wallet.amount < depositArgs.amount) {
      throw new ClobExchangeClientError(
        'insufficient_wallet_balance',
        'wallet balance is insufficient for this deposit',
        { available: wallet.amount.toString(), required: depositArgs.amount.toString() }
      );
    }
    const plan = withClobProgram(buildClobExchangeDepositInstructionPlan({
      market,
      authority: depositArgs.authority,
      walletTokenAccount: wallet.tokenAccount,
      tokenSide,
      amount: depositArgs.amount,
      seatIndex: existingSeat?.seatIndex ?? null,
    }));
    return {
      plan,
      effects: transferEffects(
        depositArgs.mint,
        args.tokenProgramAddress,
        depositArgs.amount,
        market.address,
        'wallet'
      ),
      market,
      tokenSide,
      seatIndex: existingSeat?.seatIndex ?? null,
      walletTokenAccount: wallet,
    };
  }

  async function prepareWithdrawal(
    withdrawalArgs: PrepareClobWithdrawalArgs
  ): Promise<ClobPreparedWithdrawal> {
    assertPositiveAmount(withdrawalArgs.amount);
    const { markets, allocations, unavailableMarkets } = await loadState(withdrawalArgs.authority);
    assertAssetDiscoveryComplete(
      unavailableMarkets,
      allocations,
      withdrawalArgs.authority,
      withdrawalArgs.mint
    );
    const indexed = withdrawalAllocations(
      allocations,
      markets,
      withdrawalArgs.authority,
      withdrawalArgs.mint,
      args.tokenProgramAddress
    );
    const fresh = await freshWithdrawalAllocations(
      indexed,
      markets,
      withdrawalArgs.authority,
      readMarketSeats
    );
    const selected = fresh
      .filter((candidate) => candidate.amount >= withdrawalArgs.amount)
      .sort((a, b) => compareBigInt(a.amount, b.amount)
        || compareText(a.allocation.market, b.allocation.market)
        || a.allocation.seatIndex - b.allocation.seatIndex)[0];
    if (!selected) {
      const total = fresh.reduce((sum, candidate) => sum + candidate.amount, 0n);
      if (total >= withdrawalArgs.amount) {
        throw new ClobExchangeClientError(
          'fragmented_balance',
          'withdrawal amount is split across multiple market seats',
          { available: total.toString(), required: withdrawalArgs.amount.toString() }
        );
      }
      throw new ClobExchangeClientError(
        'insufficient_exchange_balance',
        'exchange balance is insufficient for this withdrawal',
        { available: total.toString(), required: withdrawalArgs.amount.toString() }
      );
    }
    const market = marketByAddress(markets, selected.allocation.market);
    const wallet = await readCanonicalWalletAccount(
      withdrawalArgs.authority,
      withdrawalArgs.mint,
      args.tokenProgramAddress
    );
    let plan = withClobProgram(buildClobExchangeWithdrawalInstructionPlan({
      market,
      authority: withdrawalArgs.authority,
      walletTokenAccount: wallet.tokenAccount,
      tokenSide: selected.allocation.tokenSide,
      amount: withdrawalArgs.amount,
      seatIndex: selected.allocation.seatIndex,
    }));
    if (!wallet.exists) {
      plan = await wrapWithWalletTokenAccountInitialization({
        authority: withdrawalArgs.authority,
        mint: withdrawalArgs.mint,
        tokenProgram: args.tokenProgramAddress,
        walletTokenAccount: wallet.tokenAccount,
        plan,
      });
    }
    return {
      plan,
      effects: transferEffects(
        withdrawalArgs.mint,
        args.tokenProgramAddress,
        withdrawalArgs.amount,
        market.address,
        'exchange'
      ),
      market,
      tokenSide: selected.allocation.tokenSide,
      seatIndex: selected.allocation.seatIndex,
      walletTokenAccount: wallet,
    };
  }

  async function prepareOrder(orderArgs: PrepareClobOrderArgs): Promise<ClobPreparedOrder> {
    const { markets, allocations, unavailableMarkets } = await loadState(orderArgs.authority);
    if (typeof orderArgs.market === 'string') {
      assertTargetMarketAvailable(unavailableMarkets, orderArgs.market);
    }
    const market = typeof orderArgs.market === 'string'
      ? marketByAddress(markets, orderArgs.market)
      : orderArgs.market;
    validateMarketMetadata(market);
    const fundingMint = (orderArgs.side === 'buy' ? market.quoteMint : market.baseMint)!;
    assertAssetDiscoveryComplete(
      unavailableMarkets,
      allocations,
      orderArgs.authority,
      fundingMint,
      market.address
    );
    const funding = planClobOrderFunding({
      authority: orderArgs.authority,
      targetMarket: market,
      side: orderArgs.side,
      orderType: orderArgs.orderType,
      price: orderArgs.price,
      quantity: orderArgs.quantity,
      allocations,
      targetSeatIndex: orderArgs.targetSeatIndex,
    });
    if (funding.shortfall > 0n) {
      throw new ClobExchangeClientError(
        'insufficient_exchange_balance',
        'exchange balance is insufficient for this order',
        {
          available: funding.exchangeAvailableAmount.toString(),
          required: funding.requiredAmount.toString(),
          shortfall: funding.shortfall.toString(),
        }
      );
    }
    const sourceMarkets = [...new Set(
      funding.sources
        .map((source) => source.allocation.market)
        .filter((address) => address !== market.address)
    )].map((address) => marketByAddress(markets, address));
    const [targetSeats, sourceSeatEntries] = await Promise.all([
      readMarketSeats(market),
      Promise.all(sourceMarkets.map(async (source) => [
        source.address,
        await readMarketSeats(source),
      ] as const)),
    ]);
    validateClobOrderFundingPlanSeats({
      plan: funding,
      targetSeats,
      sourceSeatsByMarket: Object.fromEntries(sourceSeatEntries),
    });
    const wallet = await readCanonicalWalletAccount(
      orderArgs.authority,
      funding.mint,
      funding.tokenProgram
    );
    let plan = withClobProgram(buildClobFundedOrderInstructionPlan({
      plan: funding,
      targetMarket: market,
      sourceMarkets,
      walletTokenAccount: wallet.tokenAccount,
      price: orderArgs.price,
      quantity: orderArgs.quantity,
      orderType: orderArgs.orderType,
      expirationTime: orderArgs.expirationTime ?? DEFAULT_ORDER_EXPIRATION_TIME,
      clientId: orderArgs.clientId,
      discardAfterMatch: orderArgs.discardAfterMatch,
      failIfOutsideBook: orderArgs.failIfOutsideBook,
    }));
    if (funding.sources.length > 0 && !wallet.exists) {
      plan = await wrapWithWalletTokenAccountInitialization({
        authority: orderArgs.authority,
        mint: funding.mint,
        tokenProgram: funding.tokenProgram,
        walletTokenAccount: wallet.tokenAccount,
        plan,
      });
    }
    return {
      plan,
      /* Internal source-seat withdrawals and target-seat deposits cancel
         at the exchange-account level. Fill effects arrive from indexed
         chain state, so preparation must not predict them. */
      effects: [{
        location: 'exchange',
        mint: funding.mint,
        tokenProgram: funding.tokenProgram,
        delta: -funding.requiredAmount,
        market: market.address,
      }],
      market,
      funding,
      sourceMarkets,
      walletTokenAccount: wallet,
    };
  }

  async function readCanonicalWalletAccount(
    authority: string,
    mint: string,
    tokenProgram: string
  ): Promise<ClobWalletTokenAccountSnapshot> {
    const derived = deriveTokenAccountAddress(
      args.thruClient,
      authority,
      mint,
      tokenProgram,
      TOKEN_ACCOUNT_DEFAULT_SEED
    );
    try {
      const account = await args.thruClient.accounts.get(derived.address);
      const parsed = parseTokenAccountData(account);
      if (parsed.mint !== mint || parsed.owner !== authority) {
        throw new ClobExchangeClientError(
          'invalid_token_account',
          'canonical token account does not match the requested owner and mint',
          { tokenAccount: derived.address }
        );
      }
      return { tokenAccount: derived.address, amount: parsed.amount, exists: true };
    } catch (error) {
      if (isAccountNotFoundError(error)) {
        return { tokenAccount: derived.address, amount: 0n, exists: false };
      }
      throw error;
    }
  }

  /**
   * Reads the cosmetic ticker symbol for a given mint.
   * [SECURITY PATCH]: Removed the dead branch. Swallows all errors (missing account, RPC fault, 
   * decode error) to prevent failing the entire snapshot request.
   */
  async function readMintSymbol(mint: string): Promise<string | null> {
    try {
      return parseMintAccountData(await args.thruClient.accounts.get(mint)).ticker || null;
    } catch {
      // Ticker is display-only metadata. A missing account, a transient RPC
      // fault, or a decode error must never fail the surrounding snapshot
      // (both reads share one Promise.all), so every failure yields null.
      return null;
    }
  }

  async function readMarketSeats(market: ClobTradingMarket): Promise<ClobSeatEntry[]> {
    return parseSeatArenaAccount(await args.thruClient.accounts.get(market.address)).seats;
  }

  async function wrapWithWalletTokenAccountInitialization(initArgs: {
    authority: string;
    mint: string;
    tokenProgram: string;
    walletTokenAccount: string;
    plan: ClobInstructionPlan;
  }): Promise<ClobTransactionPlan> {
    const derived = deriveTokenAccountAddress(
      args.thruClient,
      initArgs.authority,
      initArgs.mint,
      initArgs.tokenProgram,
      TOKEN_ACCOUNT_DEFAULT_SEED
    );
    if (derived.address !== initArgs.walletTokenAccount) {
      throw new ClobExchangeClientError(
        'invalid_token_account',
        'wallet token account is not canonical'
      );
    }
    const proof = await args.thruClient.proofs.generate({
      address: derived.address,
      proofType: STATE_PROOF_TYPE_CREATING,
    });
    if (!proof.proof?.length) {
      throw new ClobExchangeClientError(
        'invalid_token_account',
        'state proof is required to initialize the wallet token account'
      );
    }
    return wrapClobPlanWithTokenAccountInitialization({
      plan: initArgs.plan,
      clobProgram: clobProgramAddress,
      initialization: {
        instructionData: createInitializeAccountInstruction({
          tokenAccountBytes: derived.bytes,
          mintAccountBytes: Pubkey.from(initArgs.mint).toBytes(),
          ownerAccountBytes: Pubkey.from(initArgs.authority).toBytes(),
          seedBytes: TOKEN_ACCOUNT_DEFAULT_SEED,
          stateProof: proof.proof,
        }),
        tokenProgram: initArgs.tokenProgram,
        tokenAccount: derived.address,
        mint: initArgs.mint,
        owner: initArgs.authority,
      },
    });
  }

  function withClobProgram(plan: ClobInstructionPlan): ClobTransactionPlan {
    return { ...plan, programAddress: clobProgramAddress };
  }

  return {
    getAccountSnapshot,
    getWithdrawalCapacity,
    prepareDeposit,
    prepareWithdrawal,
    prepareOrder,
  };
}

function uniqueMarketAssets(markets: ClobTradingMarket[]): Array<{
  mint: string;
  tokenProgram: string;
}> {
  const assets = new Map<string, { mint: string; tokenProgram: string }>();
  for (const market of markets) {
    for (const mint of [market.baseMint, market.quoteMint]) {
      if (!mint) continue;
      assets.set(assetKey(mint, market.tokenProgram), { mint, tokenProgram: market.tokenProgram });
    }
  }
  return [...assets.values()].sort((a, b) =>
    compareText(a.mint, b.mint) || compareText(a.tokenProgram, b.tokenProgram)
  );
}

function uniqueSnapshotAssets(
  markets: ClobTradingMarket[],
  allocations: ClobAssetBalanceAllocation[],
  authority: string
): Array<{ mint: string; tokenProgram: string }> {
  const assets = new Map(
    uniqueMarketAssets(markets).map((asset) => [
      assetKey(asset.mint, asset.tokenProgram),
      asset,
    ])
  );
  for (const allocation of allocations) {
    if (allocation.authority !== authority || !allocation.metadataReady || !allocation.mint) {
      continue;
    }
    assets.set(assetKey(allocation.mint, allocation.tokenProgram), {
      mint: allocation.mint,
      tokenProgram: allocation.tokenProgram,
    });
  }
  return [...assets.values()].sort((a, b) =>
    compareText(a.mint, b.mint) || compareText(a.tokenProgram, b.tokenProgram)
  );
}

function marketsForAsset(
  markets: ClobTradingMarket[],
  mint: string,
  tokenProgram: string
): ClobTradingMarket[] {
  return markets.filter((market) =>
    market.tokenProgram === tokenProgram
    && (market.baseMint === mint || market.quoteMint === mint)
  );
}

function chooseDepositMarket(
  markets: ClobTradingMarket[],
  allocations: ClobAssetBalanceAllocation[],
  authority: string,
  mint: string
): ClobTradingMarket {
  const existingMarkets = new Set(allocations
    .filter((allocation) => allocation.authority === authority
      && allocation.mint === mint
      && allocation.metadataReady)
    .map((allocation) => allocation.market));
  return markets.slice().sort((a, b) =>
    Number(existingMarkets.has(b.address)) - Number(existingMarkets.has(a.address))
      || compareText(a.address, b.address)
  )[0]!;
}

function withdrawalAllocations(
  allocations: ClobAssetBalanceAllocation[],
  markets: ClobTradingMarket[],
  authority: string,
  mint: string,
  tokenProgram: string
): ClobAssetBalanceAllocation[] {
  const marketAddresses = new Set(markets.map((market) => market.address));
  const compatible = allocations.filter((allocation) =>
    allocation.authority === authority
    && allocation.mint === mint
    && allocation.tokenProgram === tokenProgram
    && allocation.metadataReady
    && allocation.freeAmount > 0n
    && !(allocation.statusFlags & CLOB_STATUS_FLAG_WITHDRAWALS_FROZEN)
    && marketAddresses.has(allocation.market)
  );
  if (compatible.length === 0 && marketsForAsset(markets, mint, tokenProgram).length === 0) {
    throw assetNotFound(mint);
  }
  return compatible;
}

/**
 * [SECURITY PATCH]
 * NOTE: the `<= freeAmount` invariant assumes seat quantities are the FREE
 * (withdrawable) balance. VERIFY against the CLOB seat definition before merge;
 * if seat quantity is gross-of-resting-orders this assertion is the correct
 * place to instead subtract locked amounts.
 */
function seatWithdrawableQuantity(seat: ClobSeatEntry, side: ClobTokenSide): bigint {
  return side === 'base' ? seat.quantityBase : seat.quantityQuote;
}

/**
 * Retrieves the fresh withdrawal allocations utilizing strict withdrawal capacity boundaries.
 */
async function freshWithdrawalAllocations(
  allocations: ClobAssetBalanceAllocation[],
  markets: ClobTradingMarket[],
  authority: string,
  readSeats: (market: ClobTradingMarket) => Promise<ClobSeatEntry[]>
): Promise<Array<{ allocation: ClobAssetBalanceAllocation; amount: bigint }>> {
  const seatsByMarket = new Map<string, ClobSeatEntry[]>();
  await Promise.all([...new Set(allocations.map((allocation) => allocation.market))]
    .map(async (address) => {
      const market = marketByAddress(markets, address);
      seatsByMarket.set(address, await readSeats(market));
    }));
  return allocations.flatMap((allocation) => {
    const seat = seatsByMarket.get(allocation.market)?.find((candidate) =>
      candidate.seatIndex === allocation.seatIndex
      && candidate.seatAuthority === authority
    );
    if (!seat) return [];

    // [SECURITY PATCH]: Replaced raw quantity reads with the strict accessor
    const amount = seatWithdrawableQuantity(seat, allocation.tokenSide);

    // [SECURITY PATCH]: Fail closed on indexer/chain disagreement. 
    // The fresh withdrawable capacity must never exceed the indexed free balance.
    if (amount > allocation.freeAmount) {
      throw new ClobExchangeClientError(
        'invalid_token_account',
        'fresh seat balance exceeds indexed free allocation',
        {
          market: allocation.market,
          seatIndex: String(allocation.seatIndex),
          freshAmount: amount.toString(),
          indexedFreeAmount: allocation.freeAmount.toString(),
        },
      );
    }

    return amount > 0n ? [{ allocation, amount }] : [];
  });
}

function tokenSideForMint(market: ClobTradingMarket, mint: string): ClobTokenSide {
  const isBase = market.baseMint === mint;
  const isQuote = market.quoteMint === mint;
  if (isBase === isQuote) {
    throw new ClobExchangeClientError(
      isBase ? 'ambiguous_asset' : 'asset_not_found',
      isBase
        ? 'market uses the same mint for both token sides'
        : 'asset is not present in the selected market',
      { market: market.address, mint }
    );
  }
  return isBase ? 'base' : 'quote';
}

function marketByAddress(markets: ClobTradingMarket[], address: string): ClobTradingMarket {
  const market = markets.find((candidate) => candidate.address === address);
  if (!market) {
    throw new ClobExchangeClientError(
      'incomplete_market_metadata',
      'market metadata is unavailable',
      { market: address }
    );
  }
  return market;
}

function validateMarketMetadata(market: ClobTradingMarket): void {
  if (!market.address || !market.orderArena || !market.bidsCbook || !market.asksCbook
      || !market.tokenProgram || !market.baseMint || !market.quoteMint
      || !market.baseVault || !market.quoteVault || !market.marketAuthority) {
    throw new ClobExchangeClientError(
      'incomplete_market_metadata',
      'market metadata is incomplete',
      { market: market.address || '<unknown>' }
    );
  }
}

function transferEffects(
  mint: string,
  tokenProgram: string,
  amount: bigint,
  market: string,
  from: 'wallet' | 'exchange'
): ClobBalanceEffect[] {
  const to = from === 'wallet' ? 'exchange' : 'wallet';
  return [
    { location: from, mint, tokenProgram, delta: -amount, ...(from === 'exchange' ? { market } : {}) },
    { location: to, mint, tokenProgram, delta: amount, ...(to === 'exchange' ? { market } : {}) },
  ];
}

function assetNotFound(mint: string): ClobExchangeClientError {
  return new ClobExchangeClientError(
    'asset_not_found',
    'asset is not available in any CLOB market',
    { mint }
  );
}

function assertTargetMarketAvailable(
  unavailableMarkets: ClobUnavailableMarket[],
  targetMarket: string
): void {
  const unavailable = unavailableMarkets.find((entry) => entry.market === targetMarket);
  if (!unavailable) return;
  throw new ClobExchangeClientError(
    'incomplete_market_metadata',
    'target market metadata is unavailable',
    { market: targetMarket, cause: unavailable.reason }
  );
}

function isAssetDiscoveryComplete(
  unavailableMarkets: ClobUnavailableMarket[],
  allocations: ClobAssetBalanceAllocation[],
  mint: string
): boolean {
  const allocationMarkets = new Set(allocations.map((allocation) => allocation.market));
  return !unavailableMarkets.some((entry) =>
    !entry.baseMint
    || !entry.quoteMint
    || entry.baseMint === mint
    || entry.quoteMint === mint
    || allocationMarkets.has(entry.market)
  );
}

function assertAssetDiscoveryComplete(
  unavailableMarkets: ClobUnavailableMarket[],
  allocations: ClobAssetBalanceAllocation[],
  authority: string,
  mint: string,
  ignoredMarket?: string
): void {
  const allocationMarkets = new Set(allocations
    .filter((allocation) => allocation.authority === authority && allocation.mint === mint)
    .map((allocation) => allocation.market));
  const relevant = unavailableMarkets.filter((entry) =>
    entry.market !== ignoredMarket
    && (
      !entry.baseMint
      || !entry.quoteMint
      || entry.baseMint === mint
      || entry.quoteMint === mint
      || allocationMarkets.has(entry.market)
    )
  );
  if (relevant.length > 0) throw incompleteDiscovery(relevant, mint);
}

function incompleteDiscovery(
  unavailableMarkets: ClobUnavailableMarket[],
  mint?: string
): ClobExchangeClientError {
  return new ClobExchangeClientError(
    'data_source_unavailable',
    'CLOB market discovery is incomplete',
    {
      unavailableMarkets: unavailableMarkets.map((entry) => entry.market).join(','),
      ...(mint ? { mint } : {}),
    }
  );
}

function assertPositiveAmount(amount: bigint): void {
  if (amount <= 0n || amount > 0xffffffffffffffffn) {
    throw new ClobExchangeClientError(
      'invalid_amount',
      'amount must be between 1 and 18446744073709551615'
    );
  }
}

function sortMarkets(markets: ClobTradingMarket[]): ClobTradingMarket[] {
  return markets.slice().sort((a, b) => compareText(a.address, b.address));
}

function assetKey(mint: string, tokenProgram: string): string {
  return mint + '\u0000' + tokenProgram;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareBigInt(a: bigint, b: bigint): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}