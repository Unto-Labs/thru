import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Pubkey, deriveProgramAddress } from '@thru/sdk';
import { derivePerpExchangeMetaAddress, derivePerpMarginAccountAddress } from '../index';
import {
  depositTx,
  encodePerpTransaction,
  marginLinkTx,
  ordersTx,
  perpCrossAccountRef,
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
   A change to a builder changes the header: rerun with
   PERPS_UPDATE_LITEVM_FIXTURE=1 and rerun the LiteVM suite
   (env -u NIX_ENFORCE_NO_NATIVE make -C thru-perps test). */

const HEADER = fileURLToPath(new URL('../../../../../../thru-perps/tests/test_txn_perp_program/fixtures/sdk_cross_txns.h', import.meta.url));

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

const hex = (data: Uint8Array) => Array.from(data, (byte) => `0x${byte.toString(16).padStart(2, '0')}`);
const cBytes = (data: Uint8Array, indent = '  ') => {
  const values = hex(data);
  const lines: string[] = [];
  for (let i = 0; i < values.length; i += 12) lines.push(indent + values.slice(i, i + 12).join(', '));
  return lines.join(',\n');
};

async function render(): Promise<string> {
  const { txns, pubkeys } = await session();
  const parts: string[] = [
    '/* Generated by web/packages/programs/src/perp/sdk/litevm-fixture.test.ts',
    '   (PERPS_UPDATE_LITEVM_FIXTURE=1): perp SDK transactions on the accounts of',
    '   the cross margin harness (cross.h), encoded as a key signs them.  Do not',
    '   edit. */',
    '',
    '#ifndef TN_PERP_TEST_SDK_CROSS_TXNS_H',
    '#define TN_PERP_TEST_SDK_CROSS_TXNS_H',
    '',
    'typedef struct {',
    '  char const *  name;',
    '  uchar const * rw;        /* rw_cnt pubkeys */',
    '  ulong         rw_cnt;',
    '  uchar const * ro;        /* ro_cnt pubkeys */',
    '  ulong         ro_cnt;',
    '  uchar const * data;      /* instruction bytes */',
    '  ulong         data_sz;',
    '  uint          state_units;',
    '} sdk_cross_txn_t;',
    '',
  ];
  for (const [name, address] of Object.entries(pubkeys)) {
    parts.push(`static uchar const sdk_cross_${name}[ 32 ] __attribute__(( aligned( 8 ) )) = {\n${cBytes(Pubkey.from(address).toBytes())}\n};`, '');
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
    parts.push(`static uchar const sdk_cross_txn_${i}_rw[] __attribute__(( aligned( 8 ) )) = {\n${cBytes(pack(rw))}\n};`);
    parts.push(`static uchar const sdk_cross_txn_${i}_ro[] __attribute__(( aligned( 8 ) )) = {\n${cBytes(pack(ro))}\n};`);
    parts.push(`static uchar const sdk_cross_txn_${i}_data[] = {\n${cBytes(data)}\n};`, '');
    entries.push(
      `  { "${name}", sdk_cross_txn_${i}_rw, ${rw.length}UL, sdk_cross_txn_${i}_ro, ${ro.length}UL, sdk_cross_txn_${i}_data, ${data.length}UL, ${tx.stateUnits ?? 0}U }`,
    );
  }
  parts.push(`#define SDK_CROSS_TXN_CNT (${txns.length}UL)`, '', 'static sdk_cross_txn_t const sdk_cross_txns[ SDK_CROSS_TXN_CNT ] = {', entries.join(',\n'), '};', '', '#endif /* TN_PERP_TEST_SDK_CROSS_TXNS_H */', '');
  return parts.join('\n');
}

describe('LiteVM fixture of the SDK cross transactions', () => {
  it('matches the checked-in C header (PERPS_UPDATE_LITEVM_FIXTURE=1 regenerates it)', async () => {
    const rendered = await render();
    if (process.env.PERPS_UPDATE_LITEVM_FIXTURE === '1' || !existsSync(HEADER)) writeFileSync(HEADER, rendered);
    expect(readFileSync(HEADER, 'utf8')).toBe(rendered);
  });

  it('carries the margin record wherever the program needs it', async () => {
    const { txns } = await session();
    const shapes = txns.map(({ name, tx }) => [name, tx.instructions.map((ix) => ix.ix).join(' ')]);
    expect(shapes).toEqual([
      ['link market 0', 'margin_record market_record margin_link'],
      ['link market 1', 'margin_record market_record margin_link'],
      ['bid without the margin record', 'market_record create_order_entry'],
      ['cross bid in market 1', 'margin_record market_record create_order_entry'],
      ['cancel the bid', 'margin_record market_record modify_order_entry'],
      ['withdraw 5000 through market 1', 'margin_record market_record token_withdraw'],
      ['deposit 5000 into market 1', 'margin_record market_record token_deposit'],
      ['unlink market 1', 'margin_record market_record margin_unlink'],
      ['settle funding of seat 0 in market 0', 'market_record settle_funding'],
      ['settle funding of the account', 'market_record settle_funding'],
      ['cross withdraw 1000 through market 0', 'margin_record market_record token_withdraw'],
    ]);
  });
});
