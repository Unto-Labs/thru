import { describe, expect, it } from 'vitest';
import { Pubkey } from '@thru/sdk';
import { PERP_CBOOK_EMPTY_PRICE_IN_TICKS, PERP_CBOOK_MAX_PRICE_IN_TICKS, estimatePerpOrderStateUnits } from '../index';
import { PerpInstruction } from '../abi/thru/program/perp/types';
import { PERP_ABI_V0_2, PERP_ABI_V0_4 } from '../versions/registry';
import {
  depositTx,
  liquidateTx,
  marginLinkTx,
  marginTransferTx,
  ordersTx,
  perpCrossAccountRef,
  perpTransactionFromJSON,
  perpTransactionToJSON,
  settleAccountFundingTx,
  settleFundingTx,
  withdrawTx,
  type CrossAccountRef,
  type MarketRef,
  type OrderBookState,
  type PerpTransaction,
} from './tx';

function key(id: number): Uint8Array {
  const bytes = new Uint8Array(32);
  bytes[0] = id;
  bytes[31] = 0xa0 + id;
  return bytes;
}
const address = (id: number) => Pubkey.from(key(id)).toThruFmt();

const deployment = { exchangeMeta: address(1), tokenProgram: address(2) };
const marketA = { seatArena: address(10), orderArena: address(11), bidsCbook: address(12), asksCbook: address(13), quoteVault: address(9), oracleFeed: address(14) };
const marketB = { seatArena: address(20), orderArena: address(21), bidsCbook: address(22), asksCbook: address(23), quoteVault: address(9), oracleFeed: address(24) };
const marketC = { seatArena: address(30), orderArena: address(31), bidsCbook: address(32), asksCbook: address(33), quoteVault: address(9), oracleFeed: address(34) };
const refA: MarketRef = { deployment, market: marketA };
const refB: MarketRef = { deployment, market: marketB };
const OWNER = address(40);
const OTHER = address(41);
const WALLET = address(42);
const ACCOUNT = address(50);
const OTHER_ACCOUNT = address(51);
const PROGRAM = address(61);

/* The owner's account links B then A then C (link order is the account's, not the market's). */
const account: CrossAccountRef = perpCrossAccountRef(
  ACCOUNT,
  { links: [{ market: marketB.seatArena, seatIndex: 4 }, { market: marketA.seatArena, seatIndex: 7 }, { market: marketC.seatArena, seatIndex: 2 }] },
  [marketA, marketB, marketC],
);

/** The instruction stream as the program walks it: tag, then the payload
    (a margin record's length follows from its link count; variable-size
    order instructions are not walked). */
function walk(bytes: Uint8Array, limit = Infinity): Array<{ name: string; payload: Uint8Array }> {
  const out: Array<{ name: string; payload: Uint8Array }> = [];
  let at = 0;
  while (at < bytes.length && out.length < limit) {
    const tag = bytes[at]!;
    const variant = PerpInstruction.payloadVariantDescriptors.find((entry) => entry.tag === tag);
    if (!variant) throw new Error(`unknown tag ${tag} at ${at}`);
    let size = variant.payloadSize ?? 0;
    if (variant.name === 'margin_record') {
      const links = bytes[at + 4]!;
      size = 7 + links * 4 + (links & 1) * 4;
    }
    out.push({ name: variant.name, payload: bytes.subarray(at + 1, at + 1 + size) });
    at += 1 + size;
  }
  return out;
}

/** Encodes as a keypair signer's transaction would order the accounts
    (the signer, the seat authority, is the fee payer). */
async function encode(tx: PerpTransaction, feePayer = OWNER, limit = Infinity): Promise<{ accounts: string[]; steps: Array<{ name: string; payload: Uint8Array }> }> {
  const accounts = [feePayer, PROGRAM, ...tx.readWrite, ...tx.readOnly];
  const bytes = await tx.instructionData({
    getAccountIndex(pubkey: Uint8Array) {
      const index = accounts.indexOf(Pubkey.from(pubkey).toThruFmt());
      if (index < 0) throw new Error(`account ${Pubkey.from(pubkey).toThruFmt()} is not in the transaction`);
      return index;
    },
  });
  return { accounts, steps: walk(bytes, limit) };
}

const u16 = (payload: Uint8Array, offset: number) => payload[offset]! | (payload[offset + 1]! << 8);

const book: OrderBookState = {
  tickSize: 1_000n,
  bidsCbook: { bestLevelIndex: 0, bestPriceInTicks: PERP_CBOOK_MAX_PRICE_IN_TICKS - 86_000n, levelCount: 10 },
  asksCbook: { bestLevelIndex: 0, bestPriceInTicks: PERP_CBOOK_EMPTY_PRICE_IN_TICKS, levelCount: 10 },
};
const farBid = { side: 'buy' as const, price: 43_000n * 1000n, quantity: 1n };

describe('cross seat transactions', () => {
  it('orders: the margin record first, every linked arena and feed read only, state units unchanged', async () => {
    const isolated = ordersTx(refA, OWNER, 7, [farBid], [{ orderEntryIndex: 3, orderId: 99n }], book);
    const cross = ordersTx(refA, OWNER, 7, [farBid], [{ orderEntryIndex: 3, orderId: 99n }], book, { margin: account, version: PERP_ABI_V0_4 });

    expect(cross.instructions.map((ix) => ix.ix)).toEqual(['margin_record', 'market_record', 'modify_order_entry', 'create_order_entry']);
    expect(cross.instructions[0]).toEqual({
      ix: 'margin_record',
      marginRecordIndex: 0,
      marginAccount: ACCOUNT,
      exchangeMeta: deployment.exchangeMeta,
      entries: [
        { seatArena: marketB.seatArena, oracleFeed: marketB.oracleFeed },
        { seatArena: marketA.seatArena, oracleFeed: marketA.oracleFeed },
        { seatArena: marketC.seatArena, oracleFeed: marketC.oracleFeed },
      ],
    });
    expect(cross.instructions.slice(1)).toEqual(isolated.instructions);
    expect(cross.readWrite).toEqual([marketA.seatArena, marketA.orderArena, marketA.bidsCbook, marketA.asksCbook]);
    expect(isolated.readOnly).toEqual([deployment.exchangeMeta, marketA.oracleFeed]);
    expect(cross.readOnly).toEqual([deployment.exchangeMeta, marketA.oracleFeed, ACCOUNT, marketB.seatArena, marketB.oracleFeed, marketC.seatArena, marketC.oracleFeed]);
    /* #5001's estimate: the far bid grows the 10 level bid book; the record adds nothing. */
    expect(cross.stateUnits).toBe(estimatePerpOrderStateUnits({ ...book, cancels: [{ orderEntryIndex: 3 }], orders: [farBid] }).stateUnits);
    expect(cross.stateUnits).toBe(isolated.stateUnits);
    expect(cross.stateUnits).toBeGreaterThan(0);

    /* The record's indexes resolve to the linked arenas and feeds. */
    const { accounts, steps } = await encode(cross, OWNER, 1);
    const record = steps[0]!;
    expect(record.name).toBe('margin_record');
    expect(record.payload[0]).toBe(0); /* margin_record_idx */
    expect(accounts[u16(record.payload, 1)]).toBe(ACCOUNT);
    expect(record.payload[3]).toBe(3); /* link_cnt */
    expect(accounts[u16(record.payload, 5)]).toBe(deployment.exchangeMeta);
    const entries = [0, 1, 2].map((i) => [accounts[u16(record.payload, 7 + i * 4)], accounts[u16(record.payload, 9 + i * 4)]]);
    expect(entries).toEqual([
      [marketB.seatArena, marketB.oracleFeed],
      [marketA.seatArena, marketA.oracleFeed],
      [marketC.seatArena, marketC.oracleFeed],
    ]);
    /* Behind the record: the isolated transaction's bytes, indexes resolved in the cross account list. */
    const ctx = { getAccountIndex: (pubkey: Uint8Array) => accounts.indexOf(Pubkey.from(pubkey).toThruFmt()) };
    const all = await cross.instructionData(ctx);
    expect(all.subarray(1 + record.payload.length)).toEqual(await isolated.instructionData(ctx));
  });

  it('withdraw and deposit carry the record, the wallet and the vault', async () => {
    const withdraw = withdrawTx(refB, OWNER, 4, { address: WALLET }, 1_000n, { margin: account });
    expect(withdraw.instructions.map((ix) => ix.ix)).toEqual(['margin_record', 'market_record', 'token_withdraw']);
    expect(withdraw.instructions[2]).toEqual({ ix: 'token_withdraw', marketRecordIndex: 1, tokenProgram: deployment.tokenProgram, from: marketB.quoteVault, to: WALLET, amount: '1000' });
    expect(withdraw.readWrite).toEqual([marketB.seatArena, marketB.orderArena, marketB.bidsCbook, marketB.asksCbook, WALLET, marketB.quoteVault]);
    expect(withdraw.readOnly).toEqual([deployment.exchangeMeta, marketB.oracleFeed, deployment.tokenProgram, ACCOUNT, marketA.seatArena, marketA.oracleFeed, marketC.seatArena, marketC.oracleFeed]);
    const deposit = depositTx(refB, OWNER, 4, { address: WALLET }, 1_000n, { margin: account });
    expect(deposit.instructions[2]).toMatchObject({ ix: 'token_deposit', from: WALLET, to: marketB.quoteVault });
    const { steps } = await encode(withdraw);
    expect(steps.map((step) => step.name)).toEqual(['margin_record', 'market_record', 'token_withdraw']);
  });

  it('a cross liquidation carries the target\'s record (0) and a cross liquidator\'s (1)', async () => {
    const liquidator = perpCrossAccountRef(OTHER_ACCOUNT, { links: [{ market: marketA.seatArena, seatIndex: 2 }] }, [marketA]);
    const tx = liquidateTx(refA, OTHER, 2, 7, { target: account, liquidator });
    expect(tx.instructions.map((ix) => (ix.ix === 'margin_record' ? `margin_record:${ix.marginRecordIndex}:${ix.marginAccount === ACCOUNT ? 'target' : 'liquidator'}` : ix.ix))).toEqual([
      'margin_record:0:target',
      'margin_record:1:liquidator',
      'market_record',
      'liquidate',
    ]);
    expect(tx.readOnly).toEqual([deployment.exchangeMeta, marketA.oracleFeed, OTHER_ACCOUNT, ACCOUNT, marketB.seatArena, marketB.oracleFeed, marketC.seatArena, marketC.oracleFeed]);
    expect((await encode(tx, OTHER)).steps.map((step) => step.name)).toEqual(['margin_record', 'margin_record', 'market_record', 'liquidate']);
    /* An isolated liquidation is unchanged. */
    expect(liquidateTx(refA, OTHER, 2, 7).instructions.map((ix) => ix.ix)).toEqual(['market_record', 'liquidate']);
  });

  it('link and unlink write the margin account', () => {
    const before = perpCrossAccountRef(ACCOUNT, { links: [{ market: marketB.seatArena, seatIndex: 4 }] }, [marketB]);
    const link = marginLinkTx(refA, OWNER, 7, before, true);
    expect(link.instructions.map((ix) => ix.ix)).toEqual(['margin_record', 'market_record', 'margin_link']);
    expect(link.instructions[2]).toEqual({ ix: 'margin_link', marginRecordIndex: 0, marketRecordIndex: 1 });
    expect(link.readWrite).toEqual([marketA.seatArena, marketA.orderArena, marketA.bidsCbook, marketA.asksCbook, ACCOUNT]);
    expect(link.readOnly).toEqual([deployment.exchangeMeta, marketA.oracleFeed, marketB.seatArena, marketB.oracleFeed]);
    const unlink = marginLinkTx(refA, OWNER, 7, account, false);
    expect(unlink.instructions.map((ix) => ix.ix)).toEqual(['margin_record', 'market_record', 'margin_unlink']);
    expect(unlink.readWrite).toContain(ACCOUNT);
    expect(unlink.readOnly).not.toContain(marketA.seatArena);
  });

  it('a margin transfer writes both linked arenas', () => {
    const tx = marginTransferTx(deployment, OWNER, account, 1, 0, 500n);
    expect(tx.instructions.map((ix) => ix.ix)).toEqual(['margin_record', 'margin_transfer']);
    expect(tx.instructions[1]).toEqual({ ix: 'margin_transfer', marginRecordIndex: 0, fromLink: 1, toLink: 0, owner: OWNER, amount: '500' });
    expect(tx.readWrite).toEqual([marketA.seatArena, marketB.seatArena]);
    expect(tx.readOnly).toEqual([ACCOUNT, marketB.oracleFeed, marketA.oracleFeed, marketC.seatArena, marketC.oracleFeed, deployment.exchangeMeta]);
    expect(() => marginTransferTx(deployment, OWNER, account, 1, 1, 5n)).toThrow('are not two links');
  });

  it('refuses a cross transaction for a market the account does not link, or on a version without cross margin', () => {
    const notA = perpCrossAccountRef(ACCOUNT, { links: [{ market: marketB.seatArena, seatIndex: 4 }] }, [marketB]);
    expect(() => ordersTx(refA, OWNER, 7, [farBid], [], undefined, { margin: notA })).toThrow('does not link market');
    expect(() => ordersTx(refA, OWNER, 7, [farBid], [], undefined, { margin: account, version: PERP_ABI_V0_2 })).toThrow('crossMargin');
    expect(() => perpCrossAccountRef(ACCOUNT, { links: [{ market: address(99), seatIndex: 1 }] }, [marketA])).toThrow('oracle feed is unknown');
  });
});

describe('funding settlement', () => {
  it('settles seats of one market behind an anonymous record', async () => {
    const tx = settleFundingTx(refA, [7, 9]);
    expect(tx.instructions).toEqual([
      { ix: 'market_record', marketRecordIndex: 1, seatArena: marketA.seatArena, orderArena: marketA.orderArena, bidsCbook: marketA.bidsCbook, asksCbook: marketA.asksCbook, exchangeMeta: deployment.exchangeMeta },
      { ix: 'settle_funding', marketRecordIndex: 1, targetSeatIndex: 7 },
      { ix: 'settle_funding', marketRecordIndex: 1, targetSeatIndex: 9 },
    ]);
    expect(tx.readWrite).toEqual([marketA.seatArena, marketA.orderArena, marketA.bidsCbook, marketA.asksCbook]);
    expect(tx.readOnly).toEqual([deployment.exchangeMeta]);
    expect((await encode(tx)).steps.map((step) => step.name)).toEqual(['market_record', 'settle_funding', 'settle_funding']);
    expect(() => settleFundingTx(refA, [7], { version: PERP_ABI_V0_2 })).toThrow('settleFunding');
  });

  it('settles every linked seat of an account, one market record each', () => {
    const tx = settleAccountFundingTx(deployment, { links: [{ market: marketB.seatArena, seatIndex: 4 }, { market: marketA.seatArena, seatIndex: 7 }] }, [marketA, marketB]);
    expect(tx.instructions.map((ix) => (ix.ix === 'settle_funding' ? `settle:${ix.marketRecordIndex}:${ix.targetSeatIndex}` : `${ix.ix}:${(ix as { marketRecordIndex: number }).marketRecordIndex}`))).toEqual([
      'market_record:1',
      'settle:1:4',
      'market_record:2',
      'settle:2:7',
    ]);
    expect(tx.readWrite).toEqual([marketB.seatArena, marketB.orderArena, marketB.bidsCbook, marketB.asksCbook, marketA.seatArena, marketA.orderArena, marketA.bidsCbook, marketA.asksCbook]);
  });
});

describe('transaction JSON', () => {
  it('round-trips through JSON to the same bytes', async () => {
    const tx = ordersTx(refA, OWNER, 7, [{ ...farBid, clientId: key(77).subarray(0, 16) }], [], book, { margin: account });
    const json = JSON.parse(JSON.stringify(perpTransactionToJSON(tx)));
    const back = perpTransactionFromJSON(json);
    const ctx = { getAccountIndex: (pubkey: Uint8Array) => [OWNER, PROGRAM, ...tx.readWrite, ...tx.readOnly].indexOf(Pubkey.from(pubkey).toThruFmt()) };
    expect(await back.instructionData(ctx)).toEqual(await tx.instructionData(ctx));
    expect(back.stateUnits).toBe(tx.stateUnits);
    expect(json.instructions[2].clientId).toBe(`4d${'00'.repeat(15)}`);
    expect(() => perpTransactionFromJSON({} as never)).toThrow('not a perp transaction');
  });
});
