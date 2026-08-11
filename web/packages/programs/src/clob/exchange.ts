import { Pubkey } from '@thru/sdk';
import { MULTICALL_PROGRAM_ADDRESS, buildMulticallInstruction } from '../multicall';
import {
  CLOB_STATUS_FLAG_DEPOSITS_FROZEN,
  CLOB_STATUS_FLAG_PAUSED,
  CLOB_STATUS_FLAG_POST_ONLY,
  CLOB_STATUS_FLAG_WITHDRAWALS_FROZEN,
  assertClobActiveSeatIndex,
  createMarketRecordInstruction,
  createOrderEntryInstruction,
  createSeatCreateInstruction,
  createTokenDepositInstruction,
  createTokenWithdrawInstruction,
} from './index';
import type {
  ClobOrderSide,
  ClobOrderType,
  ClobSeatEntry,
  ClobTokenSide,
  InstructionData,
} from './index';

/**
 * Exchange-facing helpers keep market seats as an implementation detail.
 * Indexed allocations are used to discover funds; callers re-read the
 * selected seats from chain before submitting a prepared plan.
 */
export interface ClobAssetBalanceAllocation {
  market: string;
  authority: string;
  seatIndex: number;
  tokenSide: ClobTokenSide;
  mint: string | null;
  vault: string;
  freeAmount: bigint;
  statusFlags: number;
  tokenProgram: string;
  metadataReady: boolean;
}

export interface ClobExchangeAssetBalance {
  authority: string;
  mint: string;
  tokenProgram: string;
  freeAmount: bigint;
  transferableAmount: bigint;
  allocations: ClobAssetBalanceAllocation[];
}

export interface ClobTradingMarket {
  address: string;
  orderArena: string;
  bidsCbook: string;
  asksCbook: string;
  tokenProgram: string;
  baseMint: string | null;
  quoteMint: string | null;
  baseVault: string;
  quoteVault: string;
  marketAuthority: string;
  statusFlags: number;
}

export interface ClobFundingSource {
  allocation: ClobAssetBalanceAllocation;
  amount: bigint;
}

/**
 * Keep enough headroom inside the 32 KiB transaction MTU for wallet/session
 * wrapping and target-market accounts. The CLOB program's market-record
 * table allows more records, but a single signed transaction is the
 * practical limit.
 *
 * TODO: Add multi-layer consolidation so balances fragmented across more
 * than this many source markets can be consolidated in bounded stages
 * before placing the final order.
 */
export const CLOB_MAX_ATOMIC_FUNDING_SOURCES = 64;

export interface ClobOrderFundingPlan {
  authority: string;
  targetMarket: string;
  targetTokenSide: ClobTokenSide;
  targetSeatIndex: number | null;
  mint: string;
  tokenProgram: string;
  requiredAmount: bigint;
  targetAmount: bigint;
  exchangeAvailableAmount: bigint;
  sources: ClobFundingSource[];
  shortfall: bigint;
}

export interface PlanClobOrderFundingArgs {
  authority: string;
  targetMarket: ClobTradingMarket;
  side: ClobOrderSide;
  orderType?: ClobOrderType;
  price: bigint;
  quantity: bigint;
  allocations: ClobAssetBalanceAllocation[];
  targetSeatIndex?: number;
}

export interface ClobInstructionPlanReview {
  instruction: 'exchange_deposit' | 'exchange_withdrawal' | 'funded_order';
  label: string;
  value: Record<string, string>;
}

export interface ClobInstructionPlan {
  instructionData: InstructionData;
  readWriteAccounts: string[];
  readOnlyAccounts: string[];
  review: ClobInstructionPlanReview;
}

export interface ClobTransactionPlan extends ClobInstructionPlan {
  programAddress: string;
}

export interface ClobTokenAccountInitialization {
  instructionData: InstructionData;
  tokenProgram: string;
  tokenAccount: string;
  mint: string;
  owner: string;
}

export interface WrapClobPlanWithTokenAccountInitializationArgs {
  plan: ClobInstructionPlan;
  clobProgram: string;
  initialization: ClobTokenAccountInitialization;
}

export interface BuildClobExchangeDepositArgs {
  market: ClobTradingMarket;
  authority: string;
  walletTokenAccount: string;
  tokenSide: ClobTokenSide;
  amount: bigint;
  seatIndex: number | null;
}

export interface BuildClobExchangeWithdrawalArgs {
  market: ClobTradingMarket;
  authority: string;
  walletTokenAccount: string;
  tokenSide: ClobTokenSide;
  amount: bigint;
  seatIndex: number;
}

export interface BuildClobFundedOrderArgs {
  plan: ClobOrderFundingPlan;
  targetMarket: ClobTradingMarket;
  sourceMarkets?: ClobTradingMarket[];
  walletTokenAccount: string;
  price: bigint;
  quantity: bigint;
  orderType?: ClobOrderType;
  expirationTime: bigint;
  clientId?: Uint8Array;
  discardAfterMatch?: boolean;
  failIfOutsideBook?: boolean;
}

export type ClobExchangeErrorCode =
  | 'invalid_funding_amount'
  | 'market_paused'
  | 'market_post_only'
  | 'deposits_frozen'
  | 'withdrawals_frozen'
  | 'insufficient_funds'
  | 'too_many_funding_sources'
  | 'stale_balance'
  | 'funding_plan_mismatch';

export class ClobExchangeError extends Error {
  readonly code: ClobExchangeErrorCode;

  constructor(code: ClobExchangeErrorCode, message: string) {
    super(message);
    this.name = 'ClobExchangeError';
    this.code = code;
  }
}

/**
 * Groups physical market seats into the exchange-level asset balances
 * presented to applications.
 */
export function aggregateClobExchangeBalances(
  allocations: ClobAssetBalanceAllocation[]
): ClobExchangeAssetBalance[] {
  const groups = new Map<string, ClobExchangeAssetBalance>();
  for (const allocation of allocations) {
    validateAllocation(allocation);
    if (!allocation.metadataReady || !allocation.mint || allocation.freeAmount === 0n) continue;
    const key = allocation.authority + '\u0000' + allocation.mint + '\u0000' + allocation.tokenProgram;
    let balance = groups.get(key);
    if (!balance) {
      balance = {
        authority: allocation.authority,
        mint: allocation.mint,
        tokenProgram: allocation.tokenProgram,
        freeAmount: 0n,
        transferableAmount: 0n,
        allocations: [],
      };
      groups.set(key, balance);
    }
    balance.freeAmount += allocation.freeAmount;
    if (!(allocation.statusFlags & CLOB_STATUS_FLAG_WITHDRAWALS_FROZEN)) {
      balance.transferableAmount += allocation.freeAmount;
    }
    balance.allocations.push(allocation);
  }

  return [...groups.values()]
    .map((balance) => ({
      ...balance,
      allocations: balance.allocations.slice().sort(compareAllocationIdentity),
    }))
    .sort((a, b) => compareText(a.mint, b.mint) || compareText(a.tokenProgram, b.tokenProgram));
}

/**
 * Mirrors the CLOB's conservative maximum funding requirement.
 * A buy can spend at most price * quantity quote units, while a sell can spend
 * at most quantity base units.
 */
export function calculateClobOrderFundingAmount(args: {
  side: ClobOrderSide;
  price: bigint;
  quantity: bigint;
}): bigint {
  assertPositiveU64(args.price, 'price');
  assertPositiveU64(args.quantity, 'quantity');
  const amount = args.side === 'buy' ? args.price * args.quantity : args.quantity;
  if (amount > 0xffffffffffffffffn) {
    throw new ClobExchangeError(
      'invalid_funding_amount',
      'order funding amount exceeds the CLOB u64 balance range'
    );
  }
  return amount;
}

/**
 * Uses only funds that the user has explicitly deposited into the exchange.
 * It prioritizes the target seat and then compatible free allocations in their
 * existing input order. Wallet deposits are a separate, explicit operation.
 */
export function planClobOrderFunding(args: PlanClobOrderFundingArgs): ClobOrderFundingPlan {
  assertMarketCanTrade(args.targetMarket, args.orderType ?? 'gtc');

  const targetTokenSide: ClobTokenSide = args.side === 'buy' ? 'quote' : 'base';
  const mint = targetTokenSide === 'base'
    ? args.targetMarket.baseMint
    : args.targetMarket.quoteMint;
  if (!mint) {
    throw new ClobExchangeError(
      'funding_plan_mismatch',
      'target market is missing ' + targetTokenSide + ' mint metadata'
    );
  }

  const requiredAmount = calculateClobOrderFundingAmount(args);
  const compatible = args.allocations.filter((allocation) => {
    validateAllocation(allocation);
    return allocation.authority === args.authority
      && allocation.metadataReady
      && allocation.mint === mint
      && allocation.tokenProgram === args.targetMarket.tokenProgram;
  });
  assertUniqueAllocationIdentities(compatible);
  const targetAllocations = compatible
    .filter((allocation) => allocation.market === args.targetMarket.address
      && allocation.tokenSide === targetTokenSide
      && allocation.vault === vaultForSide(args.targetMarket, targetTokenSide))
    .sort(compareTargetAllocation);
  const target = args.targetSeatIndex === undefined
    ? targetAllocations[0] ?? null
    : targetAllocations.find((allocation) => allocation.seatIndex === args.targetSeatIndex) ?? null;
  if (args.targetSeatIndex !== undefined && !target) {
    throw new ClobExchangeError(
      'funding_plan_mismatch',
      'requested target seat is not present in the indexed allocations'
    );
  }

  const targetAmount = minBigInt(requiredAmount, target?.freeAmount ?? 0n);
  let remaining = requiredAmount - targetAmount;
  const targetAllocationIdentity = target ? sourceAllocationIdentity(target) : null;
  const sourceCandidates = compatible.filter((allocation) =>
    sourceAllocationIdentity(allocation) !== targetAllocationIdentity
    && allocation.freeAmount > 0n
    && !(allocation.statusFlags & CLOB_STATUS_FLAG_WITHDRAWALS_FROZEN)
  );
  const sources: ClobFundingSource[] = [];
  for (const allocation of sourceCandidates) {
    if (remaining === 0n) break;
    if (sources.length >= CLOB_MAX_ATOMIC_FUNDING_SOURCES) {
      throw new ClobExchangeError(
        'too_many_funding_sources',
        'exchange balance is fragmented across more than '
          + CLOB_MAX_ATOMIC_FUNDING_SOURCES.toString()
          + ' source allocations for one atomic order'
      );
    }
    const amount = minBigInt(remaining, allocation.freeAmount);
    sources.push({ allocation, amount });
    remaining -= amount;
  }

  if (requiredAmount > targetAmount
      && args.targetMarket.statusFlags & CLOB_STATUS_FLAG_DEPOSITS_FROZEN) {
    throw new ClobExchangeError(
      'deposits_frozen',
      'target market deposits are frozen and its existing allocation cannot fund the order'
    );
  }

  return {
    authority: args.authority,
    targetMarket: args.targetMarket.address,
    targetTokenSide,
    targetSeatIndex: target?.seatIndex ?? null,
    mint,
    tokenProgram: args.targetMarket.tokenProgram,
    requiredAmount,
    targetAmount,
    exchangeAvailableAmount: (target?.freeAmount ?? 0n) + sourceCandidates.reduce(
      (sum, allocation) => sum + allocation.freeAmount,
      0n
    ),
    sources,
    shortfall: remaining,
  };
}

/**
 * Checks indexed selections against fresh seat-arena reads immediately before
 * transaction construction. Missing source-market reads are a caller mismatch;
 * only supplied state that no longer matches the plan is classified as stale.
 * 
 * [SECURITY PATCH]: Fails closed if the fresh withdrawable capacity exceeds 
 * the indexed free balance. A violation means our seat-field assumption is wrong —
 * this surfaces it loudly rather than silently quoting an inflated capacity.
 */
export function validateClobOrderFundingPlanSeats(args: {
  plan: ClobOrderFundingPlan;
  targetSeats: ClobSeatEntry[];
  sourceSeatsByMarket?: Readonly<Record<string, ClobSeatEntry[]>>;
}): void {
  if (args.plan.targetSeatIndex === null) {
    if (args.targetSeats.some((seat) => seat.seatAuthority === args.plan.authority)) {
      throw new ClobExchangeError('stale_balance', 'a target seat appeared after funding was planned');
    }
  } else {
    const seat = args.targetSeats.find((entry) =>
      entry.seatIndex === args.plan.targetSeatIndex
      && entry.seatAuthority === args.plan.authority
    );
    // [SECURITY PATCH]: Replaced raw quantity reads with the strict `seatWithdrawableQuantity` accessor
    const currentAmount = seat ? seatWithdrawableQuantity(seat, args.plan.targetTokenSide) : null;
    if (currentAmount === null
        || currentAmount < args.plan.targetAmount
        || (args.plan.sources.length > 0 && currentAmount !== args.plan.targetAmount)) {
      throw new ClobExchangeError('stale_balance', 'target seat balance changed after funding was planned');
    }
  }

  const hasExternalSources = args.plan.sources.some(
    (source) => source.allocation.market !== args.plan.targetMarket
  );
  if (hasExternalSources && !args.sourceSeatsByMarket) {
    throw new ClobExchangeError(
      'funding_plan_mismatch',
      'fresh source seat data is required for every planned funding market'
    );
  }

  for (const source of args.plan.sources) {
    const isTargetMarketSource = source.allocation.market === args.plan.targetMarket;
    if (!isTargetMarketSource
        && !Object.prototype.hasOwnProperty.call(args.sourceSeatsByMarket, source.allocation.market)) {
      throw new ClobExchangeError(
        'funding_plan_mismatch',
        'fresh source seat data is missing for market ' + source.allocation.market
      );
    }
    const sourceSeats = isTargetMarketSource
      ? args.targetSeats
      : args.sourceSeatsByMarket![source.allocation.market];
    
    const seat = sourceSeats.find((entry) =>
      entry.seatIndex === source.allocation.seatIndex
      && entry.seatAuthority === args.plan.authority
    );
    
    if (!seat) {
      throw new ClobExchangeError(
        'stale_balance',
        'source seat balance changed after funding was planned for market '
          + source.allocation.market
      );
    }

    // [SECURITY PATCH]: Securely calculate withdrawable capacity 
    const amount = seatWithdrawableQuantity(seat, source.allocation.tokenSide);

    // [SECURITY PATCH]: Fail closed on indexer/chain disagreement. The capacity must never exceed free amount.
    if (amount > source.allocation.freeAmount) {
      throw new ClobExchangeError(
        'stale_balance',
        'fresh seat balance exceeds indexed free allocation for market ' 
          + source.allocation.market
      );
    }

    if (amount < source.amount) {
      throw new ClobExchangeError(
        'stale_balance',
        'source seat balance changed after funding was planned for market '
          + source.allocation.market
      );
    }
  }
}

/**
 * Prepares an unsigned deposit into the exchange abstraction, creating 
 * the selected market seat if needed.
 */
export function buildClobExchangeDepositInstructionPlan(
  args: BuildClobExchangeDepositArgs
): ClobInstructionPlan {
  assertPositiveU64(args.amount, 'amount');
  if (args.market.statusFlags & CLOB_STATUS_FLAG_DEPOSITS_FROZEN) {
    throw new ClobExchangeError('deposits_frozen', 'market deposits are frozen');
  }
  const marketRecordIndex = 1;
  const opensSeat = args.seatIndex === null;
  const instructions = [
    marketRecordInstruction(args.market, marketRecordIndex, opensSeat ? null : args.authority, args.seatIndex),
    ...(opensSeat
      ? [createSeatCreateInstruction({
          marketRecordIndex,
          seatAuthorityAccountBytes: addressBytes(args.authority),
        })]
      : []),
    createTokenDepositInstruction({
      marketRecordIndex,
      tokenProgramAccountBytes: addressBytes(args.market.tokenProgram),
      fromAccountBytes: addressBytes(args.walletTokenAccount),
      toAccountBytes: addressBytes(vaultForSide(args.market, args.tokenSide)),
      amount: args.amount,
    }),
  ];
  const accounts = new AccountPlan();
  addTargetMarketAccounts(accounts, args.market);
  accounts.addWrite(args.walletTokenAccount);
  accounts.addWrite(vaultForSide(args.market, args.tokenSide));
  accounts.addRead(args.authority);
  accounts.addRead(args.market.tokenProgram);
  return accounts.finish(concatClobInstructions(...instructions), {
    instruction: 'exchange_deposit',
    label: 'Deposit to CLOB exchange',
    value: {
      market: args.market.address,
      mint: mintForSide(args.market, args.tokenSide),
      amount: args.amount.toString(),
    },
  });
}

/**
 * Prepares an unsigned exchange withdrawal from an exact indexed allocation.
 */
export function buildClobExchangeWithdrawalInstructionPlan(
  args: BuildClobExchangeWithdrawalArgs
): ClobInstructionPlan {
  assertPositiveU64(args.amount, 'amount');
  if (args.market.statusFlags & CLOB_STATUS_FLAG_WITHDRAWALS_FROZEN) {
    throw new ClobExchangeError('withdrawals_frozen', 'market withdrawals are frozen');
  }
  const marketRecordIndex = 1;
  const vault = vaultForSide(args.market, args.tokenSide);
  const instructionData = concatClobInstructions(
    marketRecordInstruction(args.market, marketRecordIndex, args.authority, args.seatIndex),
    createTokenWithdrawInstruction({
      marketRecordIndex,
      tokenProgramAccountBytes: addressBytes(args.market.tokenProgram),
      fromAccountBytes: addressBytes(vault),
      toAccountBytes: addressBytes(args.walletTokenAccount),
      amount: args.amount,
    })
  );
  const accounts = new AccountPlan();
  addSourceMarketAccounts(accounts, args.market, vault);
  accounts.addWrite(args.walletTokenAccount);
  accounts.addRead(args.authority);
  accounts.addRead(args.market.tokenProgram);
  return accounts.finish(instructionData, {
    instruction: 'exchange_withdrawal',
    label: 'Withdraw from CLOB exchange',
    value: {
      market: args.market.address,
      mint: mintForSide(args.market, args.tokenSide),
      amount: args.amount.toString(),
    },
  });
}

/**
 * Combines internal exchange rebalances from every planned source and the 
 * target order in one CLOB program invocation. It never consumes funds that 
 * have not already been deposited into the exchange.
 */
export function buildClobFundedOrderInstructionPlan(
  args: BuildClobFundedOrderArgs
): ClobInstructionPlan {
  validateFundedOrderPlan(args);
  const instructions: InstructionData[] = [];
  const accounts = new AccountPlan();
  const sourceMarkets = indexSourceMarkets(args.sourceMarkets ?? []);

  args.plan.sources.forEach((source, index) => {
    const sourceMarket = source.allocation.market === args.targetMarket.address
      ? args.targetMarket
      : sourceMarkets.get(source.allocation.market)!;
    const sourceRecordIndex = index + 1;
    instructions.push(
      marketRecordInstruction(
        sourceMarket,
        sourceRecordIndex,
        args.plan.authority,
        source.allocation.seatIndex
      ),
      createTokenWithdrawInstruction({
        marketRecordIndex: sourceRecordIndex,
        tokenProgramAccountBytes: addressBytes(args.plan.tokenProgram),
        fromAccountBytes: addressBytes(source.allocation.vault),
        toAccountBytes: addressBytes(args.walletTokenAccount),
        amount: source.amount,
      })
    );
    addSourceMarketAccounts(accounts, sourceMarket, source.allocation.vault);
  });

  const targetRecordIndex = args.plan.sources.length + 1;
  const opensSeat = args.plan.targetSeatIndex === null;
  instructions.push(
    marketRecordInstruction(
      args.targetMarket,
      targetRecordIndex,
      opensSeat ? null : args.plan.authority,
      args.plan.targetSeatIndex
    )
  );
  if (opensSeat) {
    instructions.push(createSeatCreateInstruction({
      marketRecordIndex: targetRecordIndex,
      seatAuthorityAccountBytes: addressBytes(args.plan.authority),
    }));
  }

  const sourceAmount = fundingSourcesAmount(args.plan.sources);
  if (sourceAmount > 0n) {
    instructions.push(createTokenDepositInstruction({
      marketRecordIndex: targetRecordIndex,
      tokenProgramAccountBytes: addressBytes(args.plan.tokenProgram),
      fromAccountBytes: addressBytes(args.walletTokenAccount),
      toAccountBytes: addressBytes(vaultForSide(args.targetMarket, args.plan.targetTokenSide)),
      amount: sourceAmount,
    }));
    accounts.addWrite(args.walletTokenAccount);
    accounts.addWrite(vaultForSide(args.targetMarket, args.plan.targetTokenSide));
  }

  instructions.push(createOrderEntryInstruction({
    marketRecordIndex: targetRecordIndex,
    side: args.plan.targetTokenSide === 'quote' ? 'buy' : 'sell',
    orderType: args.orderType,
    price: args.price,
    quantity: args.quantity,
    expirationTime: args.expirationTime,
    clientId: args.clientId,
    discardAfterMatch: args.discardAfterMatch,
    failIfOutsideBook: args.failIfOutsideBook,
  }));
  addTargetMarketAccounts(accounts, args.targetMarket);
  accounts.addRead(args.plan.authority);
  accounts.addRead(args.plan.tokenProgram);

  return accounts.finish(concatClobInstructions(...instructions), {
    instruction: 'funded_order',
    label: 'Place order using CLOB exchange balance',
    value: {
      targetMarket: args.targetMarket.address,
      mint: args.plan.mint,
      requiredAmount: args.plan.requiredAmount.toString(),
      exchangeAmount: (args.plan.targetAmount + sourceAmount).toString(),
      sourceMarketCount: args.plan.sources.length.toString(),
      ...(args.plan.sources.length > 0
        ? {
            sourceMarkets: args.plan.sources
              .map((source) => source.allocation.market + ':' + source.amount.toString())
              .join(','),
          }
        : {}),
    },
  });
}

export function concatClobInstructions(...instructions: InstructionData[]): InstructionData {
  return async (context) => {
    const chunks = await Promise.all(instructions.map((instruction) => instruction(context)));
    const output = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0));
    let offset = 0;
    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.length;
    }
    return output;
  };
}

/**
 * Executes token-account setup before the CLOB invocation through multicall.
 * The caller supplies the token instruction so state-proof acquisition stays outside this package.
 */
export function wrapClobPlanWithTokenAccountInitialization(
  args: WrapClobPlanWithTokenAccountInitializationArgs
): ClobTransactionPlan {
  const instructionData: InstructionData = async (context) => {
    const [initializeAccountData, clobData] = await Promise.all([
      args.initialization.instructionData(context),
      args.plan.instructionData(context),
    ]);
    return buildMulticallInstruction([
      {
        programIdx: context.getAccountIndex(addressBytes(args.initialization.tokenProgram)),
        instructionData: initializeAccountData,
      },
      {
        programIdx: context.getAccountIndex(addressBytes(args.clobProgram)),
        instructionData: clobData,
      },
    ]);
  };
  const accounts = new AccountPlan();
  for (const account of args.plan.readWriteAccounts) accounts.addWrite(account);
  for (const account of args.plan.readOnlyAccounts) accounts.addRead(account);
  accounts.addWrite(args.initialization.tokenAccount);
  accounts.addRead(args.initialization.mint);
  accounts.addRead(args.initialization.owner);
  accounts.addRead(args.initialization.tokenProgram);
  accounts.addRead(args.clobProgram);
  const plan = accounts.finish(instructionData, {
    ...args.plan.review,
    value: {
      ...args.plan.review.value,
      initializesWalletTokenAccount: 'true',
    },
  });
  return {
    ...plan,
    programAddress: MULTICALL_PROGRAM_ADDRESS,
  };
}

function validateAllocation(allocation: ClobAssetBalanceAllocation): void {
  assertU64(allocation.freeAmount, 'allocation.freeAmount');
  assertClobActiveSeatIndex(allocation.seatIndex, 'allocation.seatIndex');
}

function assertMarketCanTrade(market: ClobTradingMarket, orderType: ClobOrderType): void {
  if (market.statusFlags & CLOB_STATUS_FLAG_PAUSED) {
    throw new ClobExchangeError('market_paused', 'target market is paused');
  }
  if (market.statusFlags & CLOB_STATUS_FLAG_POST_ONLY && orderType !== 'alo') {
    throw new ClobExchangeError(
      'market_post_only',
      'target market is post-only and requires an ALO order'
    );
  }
}

function validateFundedOrderPlan(args: BuildClobFundedOrderArgs): void {
  const plan = args.plan;
  if (!Array.isArray(plan.sources)) {
    throw new ClobExchangeError('funding_plan_mismatch', 'funding sources must be an array');
  }
  if (plan.sources.length > CLOB_MAX_ATOMIC_FUNDING_SOURCES) {
    throw new ClobExchangeError(
      'too_many_funding_sources',
      'funding plan exceeds the atomic source allocation limit'
    );
  }
  assertFundingPlanU64(plan.requiredAmount, 'requiredAmount');
  assertFundingPlanU64(plan.targetAmount, 'targetAmount');
  assertFundingPlanU64(plan.shortfall, 'shortfall');
  assertUniqueAllocationIdentities(plan.sources.map((source) => source.allocation));
  plan.sources.forEach((source, index) => {
    validateAllocation(source.allocation);
    assertFundingPlanU64(source.amount, 'sources[' + index.toString() + '].amount');
    if (source.amount === 0n || source.amount > source.allocation.freeAmount) {
      throw new ClobExchangeError(
        'funding_plan_mismatch',
        'funding source amount must be positive and no greater than its free allocation'
      );
    }
  });
  if (plan.shortfall > 0n) {
    throw new ClobExchangeError(
      'insufficient_funds',
      'order funding plan is short ' + plan.shortfall.toString() + ' units'
    );
  }
  assertMarketCanTrade(args.targetMarket, args.orderType ?? 'gtc');
  const expectedAmount = calculateClobOrderFundingAmount({
    side: plan.targetTokenSide === 'quote' ? 'buy' : 'sell',
    price: args.price,
    quantity: args.quantity,
  });
  const plannedAmount = plan.targetAmount
    + fundingSourcesAmount(plan.sources);
  if (plannedAmount !== plan.requiredAmount) {
    throw new ClobExchangeError(
      'funding_plan_mismatch',
      'funding plan amounts do not add up to the required order funding'
    );
  }
  if (plan.targetMarket !== args.targetMarket.address
      || plan.tokenProgram !== args.targetMarket.tokenProgram
      || plan.mint !== mintForSide(args.targetMarket, plan.targetTokenSide)
      || plan.requiredAmount !== expectedAmount) {
    throw new ClobExchangeError(
      'funding_plan_mismatch',
      'funding plan does not match the target market or order'
    );
  }

  const sourceMarkets = indexSourceMarkets(args.sourceMarkets ?? []);
  const plannedExternalSourceMarkets = new Set(
    plan.sources
      .map((source) => source.allocation.market)
      .filter((market) => market !== args.targetMarket.address)
  );
  if (sourceMarkets.size !== plannedExternalSourceMarkets.size) {
    throw new ClobExchangeError(
      'funding_plan_mismatch',
      'prepared source markets do not exactly match the funding plan'
    );
  }
  for (const source of plan.sources) {
    const isTargetMarketSource = source.allocation.market === args.targetMarket.address;
    const sourceMarket = isTargetMarketSource
      ? args.targetMarket
      : sourceMarkets.get(source.allocation.market);
    if (!sourceMarket
        || sourceMarket.tokenProgram !== plan.tokenProgram
        || source.allocation.authority !== plan.authority
        || source.allocation.mint !== plan.mint
        || source.allocation.tokenSide !== sideForVault(sourceMarket, source.allocation.vault)
        || (isTargetMarketSource
          && plan.targetSeatIndex !== null
          && source.allocation.seatIndex === plan.targetSeatIndex
          && source.allocation.tokenSide === plan.targetTokenSide)) {
      throw new ClobExchangeError(
        'funding_plan_mismatch',
        'funding source does not match its prepared source market allocation'
      );
    }
    if (sourceMarket.statusFlags & CLOB_STATUS_FLAG_WITHDRAWALS_FROZEN) {
      throw new ClobExchangeError('withdrawals_frozen', 'source market withdrawals are frozen');
    }
  }
  if (plan.sources.length > 0
      && args.targetMarket.statusFlags & CLOB_STATUS_FLAG_DEPOSITS_FROZEN) {
    throw new ClobExchangeError('deposits_frozen', 'target market deposits are frozen');
  }
}

function assertFundingPlanU64(value: bigint, label: string): void {
  if (value < 0n || value > 0xffffffffffffffffn) {
    throw new ClobExchangeError(
      'funding_plan_mismatch',
      label + ' must be between 0 and 18446744073709551615'
    );
  }
}

function marketRecordInstruction(
  market: ClobTradingMarket,
  marketRecordIndex: number,
  authority: string | null,
  seatIndex: number | null
): InstructionData {
  return createMarketRecordInstruction({
    marketRecordIndex,
    seatArenaAccountBytes: addressBytes(market.address),
    orderArenaAccountBytes: addressBytes(market.orderArena),
    bidsCbookAccountBytes: addressBytes(market.bidsCbook),
    asksCbookAccountBytes: addressBytes(market.asksCbook),
    seatAuthorityAccountBytes: authority ? addressBytes(authority) : undefined,
    seatIndex: seatIndex ?? undefined,
    tokenProgramAccountBytes: addressBytes(market.tokenProgram),
    baseVaultAccountBytes: addressBytes(market.baseVault),
    quoteVaultAccountBytes: addressBytes(market.quoteVault),
  });
}

function addTargetMarketAccounts(accounts: AccountPlan, market: ClobTradingMarket): void {
  accounts.addWrite(market.address);
  accounts.addWrite(market.orderArena);
  accounts.addWrite(market.bidsCbook);
  accounts.addWrite(market.asksCbook);
  accounts.addRead(market.baseVault);
  accounts.addRead(market.quoteVault);
}

function addSourceMarketAccounts(
  accounts: AccountPlan,
  market: ClobTradingMarket,
  sourceVault: string
): void {
  accounts.addWrite(market.address);
  accounts.addWrite(sourceVault);
  /* The CLOB's market_record instruction currently validates all three
     orderbook accounts through tsys_set_account_data_writable(), even when
     the record is only used as a withdrawal source. Passing them read-only
     makes that validation revert before the cross-market withdrawal. */
  accounts.addWrite(market.orderArena);
  accounts.addWrite(market.bidsCbook);
  accounts.addWrite(market.asksCbook);
  accounts.addRead(market.baseVault);
  accounts.addRead(market.quoteVault);
}

class AccountPlan {
  readonly writes = new Set<string>();
  readonly reads = new Set<string>();

  addWrite(address: string): void {
    this.writes.add(address);
    this.reads.delete(address);
  }

  addRead(address: string): void {
    if (!this.writes.has(address)) this.reads.add(address);
  }

  finish(instructionData: InstructionData, review: ClobInstructionPlanReview): ClobInstructionPlan {
    return {
      instructionData,
      readWriteAccounts: [...this.writes],
      readOnlyAccounts: [...this.reads],
      review,
    };
  }
}

function addressBytes(address: string): Uint8Array {
  return Pubkey.from(address).toBytes();
}

function mintForSide(market: ClobTradingMarket, side: ClobTokenSide): string {
  const mint = side === 'base' ? market.baseMint : market.quoteMint;
  if (!mint) {
    throw new ClobExchangeError(
      'funding_plan_mismatch',
      'market is missing ' + side + ' mint metadata'
    );
  }
  return mint;
}

function vaultForSide(market: ClobTradingMarket, side: ClobTokenSide): string {
  return side === 'base' ? market.baseVault : market.quoteVault;
}

function sideForVault(market: ClobTradingMarket, vault: string): ClobTokenSide | null {
  if (vault === market.baseVault) return 'base';
  if (vault === market.quoteVault) return 'quote';
  return null;
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

function compareAllocationIdentity(
  a: ClobAssetBalanceAllocation,
  b: ClobAssetBalanceAllocation
): number {
  return compareText(a.market, b.market)
    || a.seatIndex - b.seatIndex
    || compareText(a.tokenSide, b.tokenSide);
}

function compareTargetAllocation(
  a: ClobAssetBalanceAllocation,
  b: ClobAssetBalanceAllocation
): number {
  return compareBigIntDescending(a.freeAmount, b.freeAmount) || a.seatIndex - b.seatIndex;
}

function compareBigIntDescending(a: bigint, b: bigint): number {
  return a > b ? -1 : a < b ? 1 : 0;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sourceAllocationIdentity(allocation: ClobAssetBalanceAllocation): string {
  return allocation.market + '\u0000' + allocation.seatIndex.toString() + '\u0000' + allocation.tokenSide;
}

function assertUniqueAllocationIdentities(allocations: ClobAssetBalanceAllocation[]): void {
  const identities = new Set<string>();
  for (const allocation of allocations) {
    const identity = sourceAllocationIdentity(allocation);
    if (identities.has(identity)) {
      throw new ClobExchangeError(
        'funding_plan_mismatch',
        'duplicate indexed allocation for market ' + allocation.market
          + ' seat ' + allocation.seatIndex.toString()
      );
    }
    identities.add(identity);
  }
}

function fundingSourcesAmount(sources: ClobFundingSource[]): bigint {
  return sources.reduce((amount, source) => amount + source.amount, 0n);
}

function indexSourceMarkets(markets: ClobTradingMarket[]): Map<string, ClobTradingMarket> {
  const byAddress = new Map<string, ClobTradingMarket>();
  for (const market of markets) {
    if (byAddress.has(market.address)) {
      throw new ClobExchangeError(
        'funding_plan_mismatch',
        'duplicate prepared source market ' + market.address
      );
    }
    byAddress.set(market.address, market);
  }
  return byAddress;
}

function minBigInt(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

function assertPositiveU64(value: bigint, label: string): void {
  assertU64(value, label);
  if (value === 0n) {
    throw new ClobExchangeError('invalid_funding_amount', label + ' must be positive');
  }
}

function assertU64(value: bigint, label: string): void {
  if (value < 0n || value > 0xffffffffffffffffn) {
    throw new Error(label + ' must be between 0 and 18446744073709551615');
  }
}