import { describe, expect, it } from 'vitest';
import { Pubkey } from '@thru/sdk';
import {
  PERP_INSTRUCTION_INSURANCE_DEPOSIT,
  PERP_INSTRUCTION_MARKET_SET_RISK_PARAMS,
  PERP_INSTRUCTION_RESOLVE_BAD_DEBT,
  createPerpInsuranceDepositInstruction,
  createPerpMarketSetRiskParamsInstruction,
  createPerpResolveBadDebtInstruction,
  perpResolveBadDebtProblem,
  perpRiskParamsProblem,
} from './index';
import { encodePerpInstruction, insuranceDepositTx, marketSetRiskParamsTx, perpTransactionFromJSON, perpTransactionToJSON, resolveBadDebtTx, type MarketRef } from './sdk';

/* The loss waterfall's instructions: thru-perps/PLAN-WATERFALL.md,
   tn_perp_program/utils/instructions.h (the wire layouts) and
   process/risk.c (what the program checks). */

const address = (id: number) => {
  const bytes = new Uint8Array(32);
  bytes[0] = id;
  bytes[31] = 0xa0 + id;
  return Pubkey.from(bytes).toThruFmt();
};
const ctx = { getAccountIndex: () => 0 };

describe('perp loss waterfall instruction builders', () => {
  it('insurance deposit is 16 bytes with the amount at offset 8', async () => {
    const bytes = await createPerpInsuranceDepositInstruction({ marketRecordIndex: 1, amount: 2_500_000n })(ctx);
    expect([...bytes.subarray(0, 8)]).toEqual([PERP_INSTRUCTION_INSURANCE_DEPOSIT, 1, 0, 0, 0, 0, 0, 0]);
    expect(bytes.length).toBe(16);
    expect(new DataView(bytes.buffer, bytes.byteOffset).getBigUint64(8, true)).toBe(2_500_000n);
    /* The program refuses 0 with RISK_PARAM_INVALID. */
    expect(() => createPerpInsuranceDepositInstruction({ marketRecordIndex: 1, amount: 0n })).toThrow(/positive/);
  });

  it('resolve bad debt is 8 bytes', async () => {
    const bytes = await createPerpResolveBadDebtInstruction({ marketRecordIndex: 2 })(ctx);
    expect([...bytes]).toEqual([PERP_INSTRUCTION_RESOLVE_BAD_DEBT, 2, 0, 0, 0, 0, 0, 0]);
  });

  it('market set risk params is 8 bytes: three u16 after the record index', async () => {
    const bytes = await createPerpMarketSetRiskParamsInstruction({ marketRecordIndex: 1, socializeCapBps: 0x0102, ifEpochBudgetBps: 10_000, bankruptLiqRewardBps: 50 })(ctx);
    expect([...bytes]).toEqual([PERP_INSTRUCTION_MARKET_SET_RISK_PARAMS, 1, 0x02, 0x01, 0x10, 0x27, 50, 0]);
    expect(() => createPerpMarketSetRiskParamsInstruction({ marketRecordIndex: 1, socializeCapBps: 0, ifEpochBudgetBps: 10_001, bankruptLiqRewardBps: 0 })).toThrow(/ifEpochBudgetBps/);
    expect(() => createPerpMarketSetRiskParamsInstruction({ marketRecordIndex: 1, socializeCapBps: 65_536, ifEpochBudgetBps: 0, bankruptLiqRewardBps: 0 })).toThrow(/socializeCapBps/);
  });
});

describe('perp loss waterfall rules', () => {
  const market = { initialMarginBps: 500, maintenanceMarginBps: 250, liquidationFeeBps: 100 };

  it('validates risk params like risk_params_valid', () => {
    expect(perpRiskParamsProblem(market, { socializeCapBps: 250, ifEpochBudgetBps: 10_000, bankruptLiqRewardBps: 100 })).toBeNull();
    expect(perpRiskParamsProblem(market, { socializeCapBps: 251, ifEpochBudgetBps: 0, bankruptLiqRewardBps: 0 })).toMatch(/socializeCapBps/);
    expect(perpRiskParamsProblem(market, { socializeCapBps: 0, ifEpochBudgetBps: 10_001, bankruptLiqRewardBps: 0 })).toMatch(/ifEpochBudgetBps/);
    expect(perpRiskParamsProblem(market, { socializeCapBps: 0, ifEpochBudgetBps: 0, bankruptLiqRewardBps: 101 })).toMatch(/bankruptLiqRewardBps/);
    /* Without a margin gap the program takes no parameters, not even zeros. */
    expect(perpRiskParamsProblem({ ...market, maintenanceMarginBps: 500 }, { socializeCapBps: 0, ifEpochBudgetBps: 0, bankruptLiqRewardBps: 0 })).toMatch(/initial margin does not exceed/);
  });

  it('says when resolve_bad_debt cannot resolve anything', () => {
    const risk = {
      socializeCapBps: 0, ifEpochBudgetBps: 0, bankruptLiqRewardBps: 0, feeBalance: 0n, insuranceBalance: 0n, epochId: 0, epochIfDrawn: 0n,
      epochSocTicks: 0n, badDebtBoth: 0n, lossOffsetLong: 0n, lossOffsetShort: 0n,
    };
    expect(perpResolveBadDebtProblem({ badDebt: 0n, openInterestLots: 4n, risk: { ...risk, feeBalance: 5n } })).toMatch(/no bad debt/);
    expect(perpResolveBadDebtProblem({ badDebt: 9n, openInterestLots: 4n, risk })).toMatch(/socializeCapBps is 0/);
    expect(perpResolveBadDebtProblem({ badDebt: 9n, openInterestLots: 0n, risk: { ...risk, socializeCapBps: 10 } })).toMatch(/no open interest/);
    expect(perpResolveBadDebtProblem({ badDebt: 9n, openInterestLots: 0n, risk: { ...risk, feeBalance: 1n } })).toBeNull();
    expect(perpResolveBadDebtProblem({ badDebt: 9n, openInterestLots: 0n, risk: { ...risk, insuranceBalance: 1n } })).toBeNull();
    expect(perpResolveBadDebtProblem({ badDebt: 9n, openInterestLots: 4n, risk: { ...risk, socializeCapBps: 10 } })).toBeNull();
  });
});

describe('perp loss waterfall transactions', () => {
  const ref: MarketRef = {
    deployment: { exchangeMeta: address(1), tokenProgram: address(2) },
    market: { seatArena: address(3), orderArena: address(4), bidsCbook: address(5), asksCbook: address(6), quoteVault: address(7), oracleFeed: address(8) },
  };
  const trader = address(10);
  const admin = address(11);

  it('builds the deposit, resolve and risk param transactions', async () => {
    const deposit = insuranceDepositTx(ref, trader, 3, 45n);
    expect(deposit.instructions[0]).toMatchObject({ ix: 'market_record', seatAuthority: trader, seatIndex: 3, oracleFeed: ref.market.oracleFeed });
    expect(deposit.instructions[1]).toEqual({ ix: 'insurance_deposit', marketRecordIndex: 1, amount: '45' });
    expect(deposit.readWrite).toContain(ref.market.seatArena);
    expect(deposit.readOnly).toEqual([ref.deployment.exchangeMeta, ref.market.oracleFeed]);
    const cross = insuranceDepositTx(ref, trader, 3, 45n, { margin: { address: address(12), links: [{ seatArena: ref.market.seatArena, oracleFeed: ref.market.oracleFeed }] } });
    expect(cross.instructions.map((spec) => spec.ix)).toEqual(['margin_record', 'market_record', 'insurance_deposit']);

    const resolve = resolveBadDebtTx(ref);
    expect(resolve.instructions[0]).not.toHaveProperty('seatAuthority');
    expect(resolve.instructions[0]).toMatchObject({ ix: 'market_record', oracleFeed: ref.market.oracleFeed });
    expect(resolve.instructions[1]).toEqual({ ix: 'resolve_bad_debt', marketRecordIndex: 1 });

    const params = { socializeCapBps: 100, ifEpochBudgetBps: 2_000, bankruptLiqRewardBps: 25 };
    const set = marketSetRiskParamsTx(ref, admin, params);
    expect(set.instructions[0]).toMatchObject({ marketAuthority: admin });
    expect(set.instructions[1]).toEqual({ ix: 'market_set_risk_params', marketRecordIndex: 1, ...params });
    expect(perpTransactionFromJSON(JSON.parse(JSON.stringify(perpTransactionToJSON(set)))).instructions).toEqual(set.instructions);
    /* The specs encode as the createPerp* encoders do. */
    expect([...(await encodePerpInstruction(set.instructions[1]!)(ctx))]).toEqual([
      ...(await createPerpMarketSetRiskParamsInstruction({ marketRecordIndex: 1, ...params })(ctx)),
    ]);
  });
});
