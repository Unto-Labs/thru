import { describe, expect, it } from 'vitest';
import { encodeAddress } from '@thru/sdk/helpers';
import { MULTICALL_PROGRAM_ADDRESS, MulticallArgs } from '../multicall';
import {
  CLOB_INSTRUCTION_CREATE_ORDER_ENTRY,
  CLOB_INSTRUCTION_MARKET_RECORD,
  CLOB_INSTRUCTION_SEAT_CREATE,
  CLOB_INSTRUCTION_TOKEN_DEPOSIT,
  CLOB_INSTRUCTION_TOKEN_WITHDRAW,
  CLOB_MAX_ATOMIC_FUNDING_SOURCES,
  CLOB_STATUS_FLAG_WITHDRAWALS_FROZEN,
  ClobExchangeError,
  aggregateClobExchangeBalances,
  buildClobExchangeDepositInstructionPlan,
  buildClobExchangeWithdrawalInstructionPlan,
  buildClobFundedOrderInstructionPlan,
  calculateClobOrderFundingAmount,
  planClobOrderFunding,
  validateClobOrderFundingPlanSeats,
  wrapClobPlanWithTokenAccountInitialization,
} from './index';
import type {
  ClobAssetBalanceAllocation,
  ClobInstructionPlan,
  ClobTradingMarket,
} from './index';

const AUTHORITY = address(1);
const TOKEN_PROGRAM = address(2);
const BASE_MINT = address(3);
const QUOTE_MINT = address(4);
const WALLET_QUOTE = address(5);
const EXCHANGE_META = address(250);

describe('CLOB exchange balance SDK', () => {
  it('aggregates compatible physical allocations without losing transferability', () => {
    const allocations = [
      allocation({ market: address(10), seatIndex: 2, tokenSide: 'base', mint: QUOTE_MINT, freeAmount: 5n }),
      allocation({
        market: address(11),
        seatIndex: 4,
        tokenSide: 'quote',
        mint: QUOTE_MINT,
        freeAmount: 7n,
        statusFlags: CLOB_STATUS_FLAG_WITHDRAWALS_FROZEN,
      }),
      allocation({
        market: address(12),
        seatIndex: 6,
        tokenSide: 'quote',
        mint: QUOTE_MINT,
        freeAmount: 9n,
        metadataReady: false,
      }),
    ];

    expect(aggregateClobExchangeBalances(allocations)).toEqual([{
      authority: AUTHORITY,
      mint: QUOTE_MINT,
      tokenProgram: TOKEN_PROGRAM,
      freeAmount: 12n,
      transferableAmount: 5n,
      allocations: [allocations[0], allocations[1]],
    }]);
  });

  it('uses another exchange allocation after target funds', () => {
    const target = market(20);
    const source = market(40);
    const plan = planClobOrderFunding({
      authority: AUTHORITY,
      targetMarket: target,
      side: 'buy',
      price: 2n,
      quantity: 200n,
      allocations: [
        allocation({
          market: target.address,
          seatIndex: 2,
          tokenSide: 'quote',
          mint: QUOTE_MINT,
          vault: target.quoteVault,
          freeAmount: 100n,
        }),
        allocation({
          market: source.address,
          seatIndex: 8,
          tokenSide: 'base',
          mint: QUOTE_MINT,
          vault: source.baseVault,
          freeAmount: 350n,
        }),
      ],
    });

    expect(plan.requiredAmount).toBe(400n);
    expect(plan.targetAmount).toBe(100n);
    expect(plan.sources[0]?.amount).toBe(300n);
    expect(plan.sources[0]?.allocation.market).toBe(source.address);
    expect(plan.shortfall).toBe(0n);
  });

  it('uses secondary target-market seats and validates them from the target read', () => {
    const target = market(20);
    const primary = allocation({
      market: target.address,
      seatIndex: 2,
      tokenSide: 'quote',
      mint: QUOTE_MINT,
      vault: target.quoteVault,
      freeAmount: 60n,
    });
    const secondary = allocation({
      market: target.address,
      seatIndex: 3,
      tokenSide: 'quote',
      mint: QUOTE_MINT,
      vault: target.quoteVault,
      freeAmount: 60n,
    });
    const plan = planClobOrderFunding({
      authority: AUTHORITY,
      targetMarket: target,
      side: 'buy',
      price: 1n,
      quantity: 100n,
      allocations: [primary, secondary],
    });

    expect(plan.targetSeatIndex).toBe(2);
    expect(plan.targetAmount).toBe(60n);
    expect(plan.sources).toEqual([{ allocation: secondary, amount: 40n }]);
    expect(plan.exchangeAvailableAmount).toBe(120n);
    expect(plan.shortfall).toBe(0n);
    expect(() => validateClobOrderFundingPlanSeats({
      plan,
      targetSeats: [seat(2, 0n, 60n), seat(3, 0n, 60n)],
    })).not.toThrow();
  });

  it('reports full eligible exchange funds independently of the current order size', () => {
    const target = market(20);
    const source = market(40);
    const plan = planClobOrderFunding({
      authority: AUTHORITY,
      targetMarket: target,
      side: 'buy',
      price: 1n,
      quantity: 100n,
      allocations: [
        allocation({
          market: target.address,
          seatIndex: 2,
          tokenSide: 'quote',
          mint: QUOTE_MINT,
          vault: target.quoteVault,
          freeAmount: 1_000n,
        }),
        allocation({
          market: source.address,
          seatIndex: 8,
          tokenSide: 'base',
          mint: QUOTE_MINT,
          vault: source.baseVault,
          freeAmount: 50n,
        }),
        allocation({
          market: address(60),
          seatIndex: 9,
          mint: QUOTE_MINT,
          freeAmount: 70n,
          statusFlags: CLOB_STATUS_FLAG_WITHDRAWALS_FROZEN,
        }),
      ],
    });

    expect(plan.targetAmount).toBe(100n);
    expect(plan.sources).toEqual([]);
    expect(plan.exchangeAvailableAmount).toBe(1_050n);
  });

  it('ignores a withdrawal-frozen secondary target-market seat', () => {
    const target = market(20);
    const plan = planClobOrderFunding({
      authority: AUTHORITY,
      targetMarket: target,
      side: 'buy',
      price: 1n,
      quantity: 100n,
      allocations: [
        allocation({
          market: target.address,
          seatIndex: 2,
          tokenSide: 'quote',
          mint: QUOTE_MINT,
          vault: target.quoteVault,
          freeAmount: 60n,
        }),
        allocation({
          market: target.address,
          seatIndex: 3,
          tokenSide: 'quote',
          mint: QUOTE_MINT,
          vault: target.quoteVault,
          freeAmount: 60n,
          statusFlags: CLOB_STATUS_FLAG_WITHDRAWALS_FROZEN,
        }),
      ],
    });

    expect(plan.sources).toEqual([]);
    expect(plan.exchangeAvailableAmount).toBe(60n);
    expect(plan.shortfall).toBe(40n);
  });

  it('reports the remaining shortfall after internal exchange funds', () => {
    const target = market(20);
    const source = market(40);
    const plan = planClobOrderFunding({
      authority: AUTHORITY,
      targetMarket: target,
      side: 'sell',
      price: 5n,
      quantity: 300n,
      allocations: [
        allocation({
          market: source.address,
          seatIndex: 8,
          tokenSide: 'quote',
          mint: BASE_MINT,
          vault: source.quoteVault,
          freeAmount: 200n,
        }),
      ],
    });

    expect(plan.targetTokenSide).toBe('base');
    expect(plan.sources[0]?.amount).toBe(200n);
    expect(plan.shortfall).toBe(100n);
  });

  it('stacks compatible allocations in their existing input order', () => {
    const target = market(20);
    const first = allocation({
      market: address(40),
      seatIndex: 8,
      mint: QUOTE_MINT,
      freeAmount: 100n,
    });
    const second = allocation({
      market: address(50),
      seatIndex: 9,
      mint: QUOTE_MINT,
      freeAmount: 500n,
    });
    const plan = planClobOrderFunding({
      authority: AUTHORITY,
      targetMarket: target,
      side: 'buy',
      price: 2n,
      quantity: 200n,
      allocations: [first, second],
    });

    expect(plan.sources).toEqual([
      { allocation: first, amount: 100n },
      { allocation: second, amount: 300n },
    ]);
  });

  it('reports a shortfall after every compatible exchange allocation', () => {
    const target = market(20);
    const first = allocation({ market: address(40), seatIndex: 8, mint: QUOTE_MINT, freeAmount: 100n });
    const second = allocation({ market: address(50), seatIndex: 9, mint: QUOTE_MINT, freeAmount: 150n });
    const plan = planClobOrderFunding({
      authority: AUTHORITY,
      targetMarket: target,
      side: 'buy',
      price: 1n,
      quantity: 300n,
      allocations: [first, second],
    });

    expect(plan.sources.map((source) => source.amount)).toEqual([100n, 150n]);
    expect(plan.shortfall).toBe(50n);
  });

  it('rejects funding fragmented beyond the atomic source limit', () => {
    const target = market(20);
    const allocations = Array.from(
      { length: CLOB_MAX_ATOMIC_FUNDING_SOURCES + 1 },
      (_, index) => allocation({
        market: address(40 + index),
        seatIndex: index + 2,
        mint: QUOTE_MINT,
        freeAmount: 1n,
      })
    );

    expect(() => planClobOrderFunding({
      authority: AUTHORITY,
      targetMarket: target,
      side: 'buy',
      price: 1n,
      quantity: BigInt(allocations.length),
      allocations,
    })).toThrowError(expect.objectContaining({ code: 'too_many_funding_sources' }));
  });

  it('rejects duplicate indexed source allocations', () => {
    const target = market(20);
    const duplicate = allocation({
      market: address(40),
      seatIndex: 8,
      mint: QUOTE_MINT,
      freeAmount: 50n,
    });

    expect(() => planClobOrderFunding({
      authority: AUTHORITY,
      targetMarket: target,
      side: 'buy',
      price: 1n,
      quantity: 100n,
      allocations: [duplicate, { ...duplicate }],
    })).toThrowError(expect.objectContaining({ code: 'funding_plan_mismatch' }));
  });

  it('matches currencies by mint and token program rather than token side', () => {
    const target = market(20);
    const compatible = allocation({
      market: address(40),
      seatIndex: 8,
      tokenSide: 'base',
      mint: QUOTE_MINT,
      freeAmount: 50n,
    });
    const wrongProgram = allocation({
      market: address(50),
      seatIndex: 9,
      tokenSide: 'quote',
      mint: QUOTE_MINT,
      tokenProgram: address(99),
      freeAmount: 100n,
    });
    const plan = planClobOrderFunding({
      authority: AUTHORITY,
      targetMarket: target,
      side: 'buy',
      price: 1n,
      quantity: 50n,
      allocations: [wrongProgram, compatible],
    });

    expect(plan.sources[0]?.allocation).toBe(compatible);
    expect(plan.shortfall).toBe(0n);
  });

  it('calculates conservative order funding and rejects u64 overflow', () => {
    expect(calculateClobOrderFundingAmount({ side: 'sell', price: 25n, quantity: 10n })).toBe(10n);
    expect(calculateClobOrderFundingAmount({ side: 'buy', price: 25n, quantity: 10n })).toBe(250n);
    expect(() => calculateClobOrderFundingAmount({
      side: 'buy',
      price: 0xffffffffffffffffn,
      quantity: 2n,
    })).toThrowError(ClobExchangeError);
  });

  it('rejects an indexed funding plan when an exact seat balance becomes stale', () => {
    const target = market(20);
    const source = market(40);
    const plan = planClobOrderFunding({
      authority: AUTHORITY,
      targetMarket: target,
      side: 'buy',
      price: 2n,
      quantity: 100n,
      allocations: [
        allocation({
          market: target.address,
          seatIndex: 2,
          tokenSide: 'quote',
          mint: QUOTE_MINT,
          vault: target.quoteVault,
          freeAmount: 50n,
        }),
        allocation({
          market: source.address,
          seatIndex: 8,
          tokenSide: 'base',
          mint: QUOTE_MINT,
          vault: source.baseVault,
          freeAmount: 150n,
        }),
      ],
    });

    expect(() => validateClobOrderFundingPlanSeats({
      plan,
      targetSeats: [seat(2, 0n, 50n)],
      sourceSeatsByMarket: { [source.address]: [seat(8, 149n, 0n)] },
    })).toThrowError(expect.objectContaining({ code: 'stale_balance' }));
  });

  it('rejects a cross-market plan when the target balance increases', () => {
    const target = market(20);
    const source = market(40);
    const plan = planClobOrderFunding({
      authority: AUTHORITY,
      targetMarket: target,
      side: 'buy',
      price: 1n,
      quantity: 100n,
      allocations: [
        allocation({
          market: target.address,
          seatIndex: 2,
          tokenSide: 'quote',
          mint: QUOTE_MINT,
          vault: target.quoteVault,
          freeAmount: 25n,
        }),
        allocation({
          market: source.address,
          seatIndex: 8,
          tokenSide: 'base',
          mint: QUOTE_MINT,
          vault: source.baseVault,
          freeAmount: 75n,
        }),
      ],
    });

    expect(() => validateClobOrderFundingPlanSeats({
      plan,
      targetSeats: [seat(2, 0n, 30n)],
      sourceSeatsByMarket: { [source.address]: [seat(8, 75n, 0n)] },
    })).toThrowError(expect.objectContaining({ code: 'stale_balance' }));
  });

  it('distinguishes omitted fresh source data from supplied stale state', () => {
    const target = market(20);
    const source = market(40);
    const plan = planClobOrderFunding({
      authority: AUTHORITY,
      targetMarket: target,
      side: 'buy',
      price: 1n,
      quantity: 100n,
      allocations: [allocation({
        market: source.address,
        seatIndex: 8,
        tokenSide: 'base',
        mint: QUOTE_MINT,
        vault: source.baseVault,
        freeAmount: 100n,
      })],
    });

    expect(() => validateClobOrderFundingPlanSeats({
      plan,
      targetSeats: [],
    })).toThrowError(expect.objectContaining({ code: 'funding_plan_mismatch' }));
    expect(() => validateClobOrderFundingPlanSeats({
      plan,
      targetSeats: [],
      sourceSeatsByMarket: { [source.address]: [] },
    })).toThrowError(expect.objectContaining({ code: 'stale_balance' }));
  });

  it('rejects offsetting negative amounts in a funded order plan', () => {
    const target = market(20);
    const source = market(40, { baseMint: QUOTE_MINT, quoteMint: address(6) });
    const plan = planClobOrderFunding({
      authority: AUTHORITY,
      targetMarket: target,
      side: 'buy',
      price: 1n,
      quantity: 100n,
      allocations: [
        allocation({
          market: source.address,
          seatIndex: 8,
          tokenSide: 'base',
          mint: QUOTE_MINT,
          vault: source.baseVault,
          freeAmount: 200n,
        }),
      ],
    });
    const invalidPlan = {
      ...plan,
      sources: [{
        allocation: plan.sources[0]!.allocation,
        amount: 101n,
      }],
      shortfall: -1n,
    };

    expect(() => buildClobFundedOrderInstructionPlan({
      plan: invalidPlan,
      targetMarket: target,
      sourceMarkets: [source],
      walletTokenAccount: WALLET_QUOTE,
      price: 1n,
      quantity: 100n,
      expirationTime: 999n,
    })).toThrowError(expect.objectContaining({ code: 'funding_plan_mismatch' }));
  });

  it('preserves insufficient-funds errors for valid positive shortfalls', () => {
    const target = market(20);
    const plan = planClobOrderFunding({
      authority: AUTHORITY,
      targetMarket: target,
      side: 'buy',
      price: 1n,
      quantity: 100n,
      allocations: [],
    });

    expect(() => buildClobFundedOrderInstructionPlan({
      plan,
      targetMarket: target,
      walletTokenAccount: WALLET_QUOTE,
      price: 1n,
      quantity: 100n,
      expirationTime: 999n,
    })).toThrowError(expect.objectContaining({ code: 'insufficient_funds' }));
  });

  it('builds source withdrawal, target deposit, and order with distinct market records', async () => {
    const target = market(20);
    const source = market(40, { baseMint: QUOTE_MINT, quoteMint: address(6) });
    const plan = planClobOrderFunding({
      authority: AUTHORITY,
      targetMarket: target,
      side: 'buy',
      price: 2n,
      quantity: 200n,
      allocations: [
        allocation({
          market: target.address,
          seatIndex: 2,
          tokenSide: 'quote',
          mint: QUOTE_MINT,
          vault: target.quoteVault,
          freeAmount: 100n,
        }),
        allocation({
          market: source.address,
          seatIndex: 8,
          tokenSide: 'base',
          mint: QUOTE_MINT,
          vault: source.baseVault,
          freeAmount: 300n,
        }),
      ],
    });
    const instructionPlan = buildClobFundedOrderInstructionPlan({
      plan,
      targetMarket: target,
      sourceMarkets: [source],
      walletTokenAccount: WALLET_QUOTE,
      price: 2n,
      quantity: 200n,
      expirationTime: 999n,
    });
    const bytes = await instructionPlan.instructionData(contextForPlan(instructionPlan));

    expect([
      bytes[0],
      bytes[32],
      bytes[56],
      bytes[88],
      bytes[112],
    ]).toEqual([
      CLOB_INSTRUCTION_MARKET_RECORD,
      CLOB_INSTRUCTION_TOKEN_WITHDRAW,
      CLOB_INSTRUCTION_MARKET_RECORD,
      CLOB_INSTRUCTION_TOKEN_DEPOSIT,
      CLOB_INSTRUCTION_CREATE_ORDER_ENTRY,
    ]);
    expect(bytes[1]).toBe(1);
    expect(bytes[33]).toBe(1);
    expect(bytes[57]).toBe(2);
    expect(bytes[89]).toBe(2);
    expect(bytes[114]).toBe(2);
    expect(readU16(bytes, 24)).toBe(0xffff);
    expect(readU16(bytes, 80)).toBe(0xffff);
    expect(instructionPlan.readWriteAccounts).toContain(source.address);
    expect(instructionPlan.readWriteAccounts).toContain(source.orderArena);
    expect(instructionPlan.readWriteAccounts).toContain(source.bidsCbook);
    expect(instructionPlan.readWriteAccounts).toContain(source.asksCbook);
    expect(instructionPlan.readWriteAccounts).toContain(target.orderArena);
    expect(instructionPlan.readWriteAccounts).toContain(WALLET_QUOTE);
    expect(instructionPlan.readOnlyAccounts).not.toContain(source.orderArena);
    expect(instructionPlan.readOnlyAccounts).not.toContain(source.bidsCbook);
    expect(instructionPlan.readOnlyAccounts).not.toContain(source.asksCbook);
    expect(instructionPlan.readOnlyAccounts).not.toContain(source.marketAuthority);
    expect(instructionPlan.readOnlyAccounts).not.toContain(target.marketAuthority);
    expect(instructionPlan.review.value).not.toHaveProperty('walletDeposit');
  });

  it('builds a secondary target-market withdrawal before the target deposit and order', async () => {
    const target = market(20);
    const plan = planClobOrderFunding({
      authority: AUTHORITY,
      targetMarket: target,
      side: 'buy',
      price: 1n,
      quantity: 100n,
      allocations: [
        allocation({
          market: target.address,
          seatIndex: 2,
          tokenSide: 'quote',
          mint: QUOTE_MINT,
          vault: target.quoteVault,
          freeAmount: 60n,
        }),
        allocation({
          market: target.address,
          seatIndex: 3,
          tokenSide: 'quote',
          mint: QUOTE_MINT,
          vault: target.quoteVault,
          freeAmount: 60n,
        }),
      ],
    });
    const instructionPlan = buildClobFundedOrderInstructionPlan({
      plan,
      targetMarket: target,
      walletTokenAccount: WALLET_QUOTE,
      price: 1n,
      quantity: 100n,
      expirationTime: 999n,
    });
    const bytes = await instructionPlan.instructionData(contextForPlan(instructionPlan));

    expect([bytes[0], bytes[32], bytes[56], bytes[88], bytes[112]]).toEqual([
      CLOB_INSTRUCTION_MARKET_RECORD,
      CLOB_INSTRUCTION_TOKEN_WITHDRAW,
      CLOB_INSTRUCTION_MARKET_RECORD,
      CLOB_INSTRUCTION_TOKEN_DEPOSIT,
      CLOB_INSTRUCTION_CREATE_ORDER_ENTRY,
    ]);
    expect(readU32(bytes, 12)).toBe(3);
    expect(readU32(bytes, 68)).toBe(2);
    expect(instructionPlan.readWriteAccounts.filter((account) => account === target.address))
      .toHaveLength(1);
  });

  it('builds withdrawals from multiple markets before one target deposit and order', async () => {
    const target = market(20);
    const first = market(40, { baseMint: QUOTE_MINT, quoteMint: address(46) });
    const second = market(60, { baseMint: QUOTE_MINT, quoteMint: address(66) });
    const plan = planClobOrderFunding({
      authority: AUTHORITY,
      targetMarket: target,
      side: 'buy',
      price: 1n,
      quantity: 300n,
      allocations: [
        allocation({
          market: first.address,
          seatIndex: 8,
          tokenSide: 'base',
          mint: QUOTE_MINT,
          vault: first.baseVault,
          freeAmount: 100n,
        }),
        allocation({
          market: second.address,
          seatIndex: 9,
          tokenSide: 'base',
          mint: QUOTE_MINT,
          vault: second.baseVault,
          freeAmount: 200n,
        }),
      ],
    });
    const instructionPlan = buildClobFundedOrderInstructionPlan({
      plan,
      targetMarket: target,
      sourceMarkets: [first, second],
      walletTokenAccount: WALLET_QUOTE,
      price: 1n,
      quantity: 300n,
      expirationTime: 999n,
    });
    const bytes = await instructionPlan.instructionData(contextForPlan(instructionPlan));

    expect([bytes[0], bytes[32], bytes[56], bytes[88], bytes[112], bytes[144], bytes[152], bytes[176]]).toEqual([
      CLOB_INSTRUCTION_MARKET_RECORD,
      CLOB_INSTRUCTION_TOKEN_WITHDRAW,
      CLOB_INSTRUCTION_MARKET_RECORD,
      CLOB_INSTRUCTION_TOKEN_WITHDRAW,
      CLOB_INSTRUCTION_MARKET_RECORD,
      CLOB_INSTRUCTION_SEAT_CREATE,
      CLOB_INSTRUCTION_TOKEN_DEPOSIT,
      CLOB_INSTRUCTION_CREATE_ORDER_ENTRY,
    ]);
    expect([bytes[1], bytes[33], bytes[57], bytes[89], bytes[113], bytes[153], bytes[178]])
      .toEqual([1, 1, 2, 2, 3, 3, 3]);
    expect(instructionPlan.review.value.sourceMarketCount).toBe('2');
    expect(instructionPlan.review.value.exchangeAmount).toBe('300');
  });

  it('rejects an order plan that tries to add wallet funds implicitly', () => {
    const target = market(20);
    const plan = planClobOrderFunding({
      authority: AUTHORITY,
      targetMarket: target,
      side: 'buy',
      price: 2n,
      quantity: 50n,
      allocations: [],
    });
    const walletFundedPlan = {
      ...plan,
      walletAmount: 100n,
      shortfall: 0n,
    };

    expect(() => buildClobFundedOrderInstructionPlan({
      plan: walletFundedPlan,
      targetMarket: target,
      walletTokenAccount: WALLET_QUOTE,
      price: 2n,
      quantity: 50n,
      expirationTime: 999n,
    })).toThrowError(expect.objectContaining({ code: 'funding_plan_mismatch' }));
  });

  it('uses exchange-level labels for deposit and withdrawal plans', async () => {
    const target = market(20);
    const deposit = buildClobExchangeDepositInstructionPlan({
      market: target,
      authority: AUTHORITY,
      walletTokenAccount: WALLET_QUOTE,
      tokenSide: 'quote',
      amount: 25n,
      seatIndex: null,
    });
    const depositBytes = await deposit.instructionData(contextForPlan(deposit));
    expect([depositBytes[0], depositBytes[32], depositBytes[40]]).toEqual([
      CLOB_INSTRUCTION_MARKET_RECORD,
      CLOB_INSTRUCTION_SEAT_CREATE,
      CLOB_INSTRUCTION_TOKEN_DEPOSIT,
    ]);
    expect(deposit.review.label).toBe('Deposit to CLOB exchange');

    const withdrawal = buildClobExchangeWithdrawalInstructionPlan({
      market: target,
      authority: AUTHORITY,
      walletTokenAccount: WALLET_QUOTE,
      tokenSide: 'quote',
      amount: 10n,
      seatIndex: 2,
    });
    const withdrawalBytes = await withdrawal.instructionData(contextForPlan(withdrawal));
    expect([withdrawalBytes[0], withdrawalBytes[32]]).toEqual([
      CLOB_INSTRUCTION_MARKET_RECORD,
      CLOB_INSTRUCTION_TOKEN_WITHDRAW,
    ]);
    expect(withdrawal.review.label).toBe('Withdraw from CLOB exchange');
  });

  it('wraps missing wallet token-account setup ahead of the CLOB action', async () => {
    const target = market(20);
    const source = market(40, { baseMint: QUOTE_MINT, quoteMint: address(6) });
    const clobProgram = address(90);
    const plan = planClobOrderFunding({
      authority: AUTHORITY,
      targetMarket: target,
      side: 'buy',
      price: 2n,
      quantity: 50n,
      allocations: [allocation({
        market: source.address,
        seatIndex: 8,
        tokenSide: 'base',
        mint: QUOTE_MINT,
        vault: source.baseVault,
        freeAmount: 100n,
      })],
    });
    const orderPlan = buildClobFundedOrderInstructionPlan({
      plan,
      targetMarket: target,
      sourceMarkets: [source],
      walletTokenAccount: WALLET_QUOTE,
      price: 2n,
      quantity: 50n,
      expirationTime: 999n,
    });
    const transactionPlan = wrapClobPlanWithTokenAccountInitialization({
      plan: orderPlan,
      clobProgram,
      initialization: {
        instructionData: async () => new Uint8Array([0xaa]),
        tokenProgram: TOKEN_PROGRAM,
        tokenAccount: WALLET_QUOTE,
        mint: QUOTE_MINT,
        owner: AUTHORITY,
      },
    });
    const bytes = await transactionPlan.instructionData(contextForPlan(transactionPlan));
    const multicall = MulticallArgs.from_array(bytes);

    expect(transactionPlan.programAddress).toBe(MULTICALL_PROGRAM_ADDRESS);
    expect(multicall?.get_calls_count()).toBe(2);
    expect(multicall?.get_calls()[0].get_data()).toEqual([0xaa]);
    expect(multicall?.get_calls()[1].get_data()[0]).toBe(CLOB_INSTRUCTION_MARKET_RECORD);
    expect(transactionPlan.readWriteAccounts).toContain(WALLET_QUOTE);
    expect(transactionPlan.readOnlyAccounts).toContain(clobProgram);
    expect(transactionPlan.review.value.initializesWalletTokenAccount).toBe('true');
  });
});

function market(
  id: number,
  overrides: Partial<ClobTradingMarket> = {}
): ClobTradingMarket {
  return {
    address: address(id),
    exchangeMeta: EXCHANGE_META,
    orderArena: address(id + 1),
    bidsCbook: address(id + 2),
    asksCbook: address(id + 3),
    tokenProgram: TOKEN_PROGRAM,
    baseMint: BASE_MINT,
    quoteMint: QUOTE_MINT,
    baseVault: address(id + 4),
    quoteVault: address(id + 5),
    marketAuthority: address(id + 6),
    statusFlags: 0,
    ...overrides,
  };
}

function allocation(
  overrides: Partial<ClobAssetBalanceAllocation> = {}
): ClobAssetBalanceAllocation {
  return {
    market: address(10),
    authority: AUTHORITY,
    seatIndex: 2,
    tokenSide: 'quote',
    mint: QUOTE_MINT,
    vault: address(15),
    freeAmount: 1n,
    statusFlags: 0,
    tokenProgram: TOKEN_PROGRAM,
    metadataReady: true,
    ...overrides,
  };
}

function seat(seatIndex: number, quantityBase: bigint, quantityQuote: bigint) {
  return {
    seatIndex,
    seatAuthority: AUTHORITY,
    quantityBase,
    quantityQuote,
    headOrderEntryIndex: 0,
  };
}

function contextForPlan(plan: ClobInstructionPlan) {
  const indexes = new Map<string, number>();
  [...plan.readWriteAccounts, ...plan.readOnlyAccounts].forEach((account, index) => {
    indexes.set(account, index + 2);
  });
  return {
    getAccountIndex(pubkey: Uint8Array): number {
      const account = encodeAddress(pubkey);
      const index = indexes.get(account);
      if (index === undefined) throw new Error('missing account ' + account);
      return index;
    },
  };
}

function key(id: number): Uint8Array {
  const bytes = new Uint8Array(32);
  bytes[0] = id;
  return bytes;
}

function address(id: number): string {
  return encodeAddress(key(id));
}

function readU16(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(offset, true);
}

function readU32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);
}
