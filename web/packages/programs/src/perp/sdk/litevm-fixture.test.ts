import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Pubkey, deriveProgramAddress } from '@thru/sdk';
import { derivePerpExchangeMetaAddress, derivePerpMarginAccountAddress } from '../index';
import {
  depositTx,
  encodePerpTransaction,
  feeClaimTx,
  insuranceDepositTx,
  marginLinkTx,
  marketSetFeesTx,
  marketSetRiskParamsTx,
  ordersTx,
  perpCrossAccountRef,
  resolveBadDebtTx,
  seatSetBuilderApprovalTx,
  seatSetFeeReceiverTx,
  settleAccountFundingTx,
  settleFundingTx,
  withdrawTx,
  type MarketRef,
  type PerpTransaction,
} from './tx';

/* The SDK's cross seat transactions, replayed on the program in LiteVM.

   This test builds the transactions of a cross margin session with the
   SDK's builders, against the accounts of the LiteVM cross margin harness
   (thru-perps/tests/test_txn_perp_program/cross.h: markets 0..2 on one
   vault, three seats each owned by user A), and encodes them as a key
   signs them: fee payer, program, sorted read-write, sorted read-only
   accounts, the same order tn_litevm_txn_builder uses.  The result is
   checked in as a C header (fixtures/sdk_cross_txns.h) that test_cross.c
   ("Cross SDK transactions") executes in order, checking every outcome.
   The builder code session (fixtures/sdk_fee_txns.h, test_cross.c "SDK
   builder code transactions") does the same for the fee and builder code
   builders on market 0 of that harness, and the loss waterfall session
   (fixtures/sdk_risk_txns.h, test_cross.c "SDK loss waterfall
   transactions") for insurance deposits, bad debt resolution and the risk
   parameters.
   A change to a builder changes the header: rerun with
   PERPS_UPDATE_LITEVM_FIXTURE=1 and rerun the LiteVM suite
   (env -u NIX_ENFORCE_NO_NATIVE make -C thru-perps test). */

const fixture = (name: string) => fileURLToPath(new URL(`../../../../../../thru-perps/tests/test_txn_perp_program/fixtures/${name}`, import.meta.url));
const HEADER = fixture('sdk_cross_txns.h');
const FEE_HEADER = fixture('sdk_fee_txns.h');
const RISK_HEADER = fixture('sdk_risk_txns.h');

const bytes = (...values: number[]) => {
  const out = new Uint8Array(32);
  out.set(values);
  return out;
};
const at = (raw: Uint8Array) => Pubkey.from(raw).toThruFmt();

/* utils.h / cross.h constants. */
const USER = at(Uint8Array.from([0x6c, 0xf3, 0x3a, 0x5d, 0x23, 0x0a, 0x2f, 0x47, 0xc1, 0x1d, 0x96, 0x25, 0x55, 0xa3, 0x6b, 0xd4, 0x3a, 0x6b, 0x6e, 0x9a, 0x77, 0xec, 0x23, 0xa1, 0x5d, 0x9d, 0xd8, 0xe6, 0xd1, 0x67, 0x28, 0x9c]));
const PROGRAM = at(bytes(0x02));
const TOKEN_PROGRAM = (() => {
  const raw = new Uint8Array(32);
  const view = new DataView(raw.buffer);
  [0n, 1n, 2n, 3n].forEach((word, i) => view.setBigUint64(i * 8, word, true));
  return at(raw);
})();
const QUOTE_MINT = bytes(0x11);
const xm = (kind: string, n: number) => at(bytes(0x5a, kind.charCodeAt(0), n));
const VAULT = xm('V', 0);
/* The harness's arenas hand out their last entry first (the free list is a
   stack): seat 0 of every market is entry 15 of 16, the first order entry
   255 of 256; the first order id is 1. */
const SEAT = 15;
const FIRST_ORDER_ENTRY = 255;

const market = (m: number) => ({
  seatArena: xm('s', m),
  orderArena: xm('o', m),
  bidsCbook: xm('b', m),
  asksCbook: xm('a', m),
  quoteVault: VAULT,
  oracleFeed: xm('f', m),
});

/** The wallet derive_user_token_account_address gives user A for the quote mint. */
function harnessWallet(): string {
  const seed = createHash('sha256').update(Pubkey.from(USER).toBytes()).update(QUOTE_MINT).digest();
  return deriveProgramAddress({ programAddress: TOKEN_PROGRAM, seed: new Uint8Array(seed), ephemeral: false }).address;
}

interface FixtureTxn {
  name: string;
  tx: PerpTransaction;
}

async function session(): Promise<{ txns: FixtureTxn[]; pubkeys: Record<string, string> }> {
  const exchangeMeta = derivePerpExchangeMetaAddress(PROGRAM).address;
  const deployment = { exchangeMeta, tokenProgram: TOKEN_PROGRAM };
  const ref = (m: number): MarketRef => ({ deployment, market: market(m) });
  const margin = (await derivePerpMarginAccountAddress({ ownerAddress: USER, vaultAddress: VAULT, accountId: 0, perpProgramAddress: PROGRAM })).address;
  const markets = [0, 1, 2].map(market);
  const account = (links: number[]) => perpCrossAccountRef(margin, { links: links.map((m) => ({ market: market(m).seatArena, seatIndex: SEAT })) }, markets);
  const wallet = { address: harnessWallet() };
  const bid = { side: 'buy' as const, orderType: 'gtc' as const, price: 98n * 2n, quantity: 97n };
  const txns: FixtureTxn[] = [
    { name: 'link market 0', tx: marginLinkTx(ref(0), USER, SEAT, account([]), true) },
    { name: 'link market 1', tx: marginLinkTx(ref(1), USER, SEAT, account([0]), true) },
    /* The isolated shape on a cross seat: the program refuses it (MARGIN_ACCOUNT_MISSING). */
    { name: 'bid without the margin record', tx: ordersTx(ref(1), USER, SEAT, [bid]) },
    { name: 'cross bid in market 1', tx: ordersTx(ref(1), USER, SEAT, [bid], [], undefined, { margin: account([0, 1]) }) },
    { name: 'cancel the bid', tx: ordersTx(ref(1), USER, SEAT, [], [{ orderEntryIndex: FIRST_ORDER_ENTRY, orderId: 1n }], undefined, { margin: account([0, 1]) }) },
    { name: 'withdraw 5000 through market 1', tx: withdrawTx(ref(1), USER, SEAT, wallet, 5_000n, { margin: account([0, 1]) }) },
    { name: 'deposit 5000 into market 1', tx: depositTx(ref(1), USER, SEAT, wallet, 5_000n, { margin: account([0, 1]) }) },
    { name: 'unlink market 1', tx: marginLinkTx(ref(1), USER, SEAT, account([0, 1]), false) },
    { name: 'settle funding of seat 0 in market 0', tx: settleFundingTx(ref(0), [SEAT]) },
    { name: 'settle funding of the account', tx: settleAccountFundingTx(deployment, { links: [{ market: market(0).seatArena, seatIndex: SEAT }] }, markets) },
    { name: 'cross withdraw 1000 through market 0', tx: withdrawTx(ref(0), USER, SEAT, wallet, 1_000n, { margin: account([0]) }) },
  ];
  return { txns, pubkeys: { user: USER, program: PROGRAM, exchange_meta: exchangeMeta, wallet: wallet.address, margin, vault: VAULT } };
}

/* The builder code session on market 0, all signed by user A, who owns
   seats 15 (taker), 14 (maker) and 13 and is the market authority.  The
   test adds seat 12, a fee seat of another key (the program refuses a
   builder the trader owns), and sets the market's rates: taker 300 ppm,
   rebate 100, builder cap 1000, 25% of protocol fees to insurance. */
const TAKER = 15;
const MAKER = 14;
const SPARE = 13;
const BUILDER = 12;

async function feeSession(): Promise<{ txns: FixtureTxn[]; pubkeys: Record<string, string> }> {
  const exchangeMeta = derivePerpExchangeMetaAddress(PROGRAM).address;
  const deployment = { exchangeMeta, tokenProgram: TOKEN_PROGRAM };
  const ref: MarketRef = { deployment, market: market(0) };
  const lots = (n: bigint) => n * 97n;
  const txns: FixtureTxn[] = [
    { name: 'make seat 13 a fee seat', tx: seatSetFeeReceiverTx(ref, USER, SPARE) },
    { name: 'maker approves builder 12 up to 300 ppm', tx: seatSetBuilderApprovalTx(ref, USER, MAKER, { builderSeatIndex: BUILDER, maxFeePpm: 300 }) },
    {
      name: 'maker rests 10 lots under builder 12 at 400 ppm',
      tx: ordersTx(ref, USER, MAKER, [{ side: 'sell', orderType: 'gtc', price: 100n * 2n, quantity: lots(10n) }], [], undefined, { builder: { builderSeatIndex: BUILDER, feePpm: 400 } }),
    },
    {
      name: 'taker buys 5 lots under builder 12 at 500 ppm',
      tx: ordersTx(ref, USER, TAKER, [{ side: 'buy', orderType: 'ioc', price: 100n * 2n, quantity: lots(5n) }], [], undefined, { builder: { builderSeatIndex: BUILDER, feePpm: 500 } }),
    },
    { name: 'claim 16 of protocol fees into seat 15', tx: feeClaimTx(ref, USER, TAKER, 16n) },
    { name: 'maker revokes its approval', tx: seatSetBuilderApprovalTx(ref, USER, MAKER, { builderSeatIndex: 0, maxFeePpm: 0 }) },
    {
      name: 'lower the rates',
      tx: marketSetFeesTx(ref, USER, { takerFeePpm: 200, makerRebatePpm: 50, builderFeeCapPpm: 800, feeInsuranceSharePpm: 500_000, liqInsuranceSharePpm: 100_000 }),
    },
  ];
  return { txns, pubkeys: { user: USER, program: PROGRAM, exchange_meta: exchangeMeta, arena: market(0).seatArena } };
}

/* The loss waterfall session on market 0 (initial 10%, maintenance 5%,
   liquidation fee 1%), signed by user A, the market authority: the risk
   parameters, an insurance deposit from seat 15, a resolve (the test books
   bad debt before it and sends it three times) and a deposit from seat 14
   while the market is frozen. */
async function riskSession(): Promise<{ txns: FixtureTxn[]; pubkeys: Record<string, string> }> {
  const exchangeMeta = derivePerpExchangeMetaAddress(PROGRAM).address;
  const ref: MarketRef = { deployment: { exchangeMeta, tokenProgram: TOKEN_PROGRAM }, market: market(0) };
  const txns: FixtureTxn[] = [
    {
      name: 'risk params: charge cap 100 bps, insurance budget 5000 bps, reward 50 bps',
      tx: marketSetRiskParamsTx(ref, USER, { socializeCapBps: 100, ifEpochBudgetBps: 5_000, bankruptLiqRewardBps: 50 }),
    },
    { name: 'seat 15 deposits 1000 into insurance', tx: insuranceDepositTx(ref, USER, TAKER, 1_000n) },
    { name: 'resolve bad debt', tx: resolveBadDebtTx(ref) },
    { name: 'seat 14 deposits 200 into insurance', tx: insuranceDepositTx(ref, USER, MAKER, 200n) },
  ];
  return { txns, pubkeys: { user: USER, program: PROGRAM, exchange_meta: exchangeMeta, arena: market(0).seatArena } };
}

const hex = (data: Uint8Array) => Array.from(data, (byte) => `0x${byte.toString(16).padStart(2, '0')}`);
const cBytes = (data: Uint8Array, indent = '  ') => {
  const values = hex(data);
  const lines: string[] = [];
  for (let i = 0; i < values.length; i += 12) lines.push(indent + values.slice(i, i + 12).join(', '));
  return lines.join(',\n');
};

/* The C header of a session: `prefix` names its symbols (sdk_<prefix>_*,
   SDK_<PREFIX>_TXN_CNT). */
async function render(prefix: string, what: string, { txns, pubkeys }: { txns: FixtureTxn[]; pubkeys: Record<string, string> }): Promise<string> {
  const PREFIX = prefix.toUpperCase();
  const parts: string[] = [
    '/* Generated by web/packages/programs/src/perp/sdk/litevm-fixture.test.ts',
    `   (PERPS_UPDATE_LITEVM_FIXTURE=1): ${what}, encoded as a key signs them.`,
    '   Do not edit. */',
    '',
    `#ifndef TN_PERP_TEST_SDK_${PREFIX}_TXNS_H`,
    `#define TN_PERP_TEST_SDK_${PREFIX}_TXNS_H`,
    '',
    '#ifndef TN_PERP_TEST_SDK_TXN_T',
    '#define TN_PERP_TEST_SDK_TXN_T',
    'struct sdk_txn {',
    '  char const *  name;',
    '  uchar const * rw;        /* rw_cnt pubkeys */',
    '  ulong         rw_cnt;',
    '  uchar const * ro;        /* ro_cnt pubkeys */',
    '  ulong         ro_cnt;',
    '  uchar const * data;      /* instruction bytes */',
    '  ulong         data_sz;',
    '  uint          state_units;',
    '};',
    'typedef struct sdk_txn sdk_txn_t;',
    '#endif',
    '',
  ];
  for (const [name, address] of Object.entries(pubkeys)) {
    parts.push(`static uchar const sdk_${prefix}_${name}[ 32 ] __attribute__(( aligned( 8 ) )) = {\n${cBytes(Pubkey.from(address).toBytes())}\n};`, '');
  }
  const entries: string[] = [];
  for (const [i, { name, tx }] of txns.entries()) {
    const { accounts, data } = await encodePerpTransaction(tx, USER, PROGRAM);
    const rwCount = new Set(tx.readWrite).size;
    const rw = accounts.slice(2, 2 + rwCount);
    const ro = accounts.slice(2 + rwCount);
    const pack = (list: string[]) => {
      const out = new Uint8Array(Math.max(list.length, 1) * 32);
      list.forEach((address, j) => out.set(Pubkey.from(address).toBytes(), j * 32));
      return out;
    };
    parts.push(`/* ${name}: ${tx.instructions.map((ix) => ix.ix).join(', ')} */`);
    parts.push(`static uchar const sdk_${prefix}_txn_${i}_rw[] __attribute__(( aligned( 8 ) )) = {\n${cBytes(pack(rw))}\n};`);
    parts.push(`static uchar const sdk_${prefix}_txn_${i}_ro[] __attribute__(( aligned( 8 ) )) = {\n${cBytes(pack(ro))}\n};`);
    parts.push(`static uchar const sdk_${prefix}_txn_${i}_data[] = {\n${cBytes(data)}\n};`, '');
    entries.push(
      `  { "${name}", sdk_${prefix}_txn_${i}_rw, ${rw.length}UL, sdk_${prefix}_txn_${i}_ro, ${ro.length}UL, sdk_${prefix}_txn_${i}_data, ${data.length}UL, ${tx.stateUnits ?? 0}U }`,
    );
  }
  parts.push(
    `#define SDK_${PREFIX}_TXN_CNT (${txns.length}UL)`,
    '',
    `static sdk_txn_t const sdk_${prefix}_txns[ SDK_${PREFIX}_TXN_CNT ] = {`,
    entries.join(',\n'),
    '};',
    '',
    `#endif /* TN_PERP_TEST_SDK_${PREFIX}_TXNS_H */`,
    '',
  );
  return parts.join('\n');
}

function check(header: string, rendered: string): void {
  if (process.env.PERPS_UPDATE_LITEVM_FIXTURE === '1' || !existsSync(header)) writeFileSync(header, rendered);
  expect(readFileSync(header, 'utf8')).toBe(rendered);
}

describe('LiteVM fixture of the SDK cross transactions', () => {
  it('matches the checked-in C header (PERPS_UPDATE_LITEVM_FIXTURE=1 regenerates it)', async () => {
    check(HEADER, await render('cross', 'perp SDK transactions on the accounts of\n   the cross margin harness (cross.h)', await session()));
  });
});

describe('LiteVM fixture of the SDK builder code transactions', () => {
  it('matches the checked-in C header (PERPS_UPDATE_LITEVM_FIXTURE=1 regenerates it)', async () => {
    check(FEE_HEADER, await render('fee', 'perp SDK fee and builder code transactions\n   on market 0 of the cross margin harness (cross.h)', await feeSession()));
  });
});

describe('LiteVM fixture of the SDK loss waterfall transactions', () => {
  it('matches the checked-in C header (PERPS_UPDATE_LITEVM_FIXTURE=1 regenerates it)', async () => {
    check(RISK_HEADER, await render('risk', 'perp SDK loss waterfall transactions\n   on market 0 of the cross margin harness (cross.h)', await riskSession()));
  });
});
