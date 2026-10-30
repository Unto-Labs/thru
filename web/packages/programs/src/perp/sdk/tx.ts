import { Pubkey, type Account } from '@thru/sdk';
import {
  PERP_DEFAULT_MARKET_RECORD_INDEX,
  PERP_MARGIN_MAX_RECORDS,
  estimatePerpOrderStateUnits,
  parsePerpCbookHeader,
  parsePerpOrderArenaAccount,
  perpMarketAccountAddresses,
  perpMarketReadOnlyAddresses,
  type InstructionData,
  type PerpCbookHeader,
  type PerpFeeParams,
  type PerpFundingParams,
  type PerpMarginAccount,
  type PerpOrderEntry,
  type PerpOrderSide,
  type PerpOrderType,
} from '../index';
import type { PerpAbiVersion } from '../versions/model';
import { assertPerpSupports } from '../versions/registry';
import { bytesToHex, encodePerpInstructions, type PerpInstructionSpec } from './instructions';
import { readAccount, type ReadAccountOptions, type ThruClient } from './rpc';

/* Perp transactions as instruction specs plus their account lists.

   Every builder returns a PerpTransaction: the instructions (JSON specs,
   see instructions.ts), the read-write and read-only accounts besides the
   fee payer and the program, and the state units to request.  Its
   `instructionData` encodes the specs against whatever account order the
   signer settles on, so the same transaction signs with a local key
   (transactions.build: fee payer, program, sorted read-write, sorted
   read-only) or through a wallet (its fee payer and wallet program first,
   the perp program among the read-only accounts).

   Every trading instruction shares one market record at
   PERP_DEFAULT_MARKET_RECORD_INDEX that names the market's oracle feed.

   Cross margin: a seat linked into a margin account (seat.cross) needs the
   account's margin record in every transaction that takes a margin
   decision about it, and the program reads every linked market's seat
   arena and oracle feed through it.  Pass `{ margin }` (a
   PerpCrossAccountRef: the account and its links in link order, each with
   its market's feed; perpCrossAccountRef builds it from the parsed
   account) to ordersTx, depositTx, withdrawTx, modifyOrderTx and
   liquidateTx: the margin record (index 0) goes first and the account,
   the other markets' seat arenas and every feed join the read-only
   accounts.  A cancel, a deposit or a reducing modify takes no margin
   decision, but carrying the record is harmless and keeps one shape for
   every cross transaction. */

export interface MarketRef {
  deployment: { exchangeMeta: string; tokenProgram: string };
  market: { seatArena: string; orderArena: string; bidsCbook: string; asksCbook: string; quoteVault: string; oracleFeed: string };
}

/** The parts every perp transaction has (the tools' and the app's submit paths take this). */
export interface PerpTxParts {
  instructionData: InstructionData;
  readWrite: string[];
  readOnly: string[];
  /** State growth to reserve, in 4 KiB units per account; the runtime
      default (1) when absent. */
  stateUnits?: number;
}

/** An unsigned perp transaction: JSON-serialisable but for instructionData,
    which JSON.stringify drops (rebuild it with perpTransactionFromJSON). */
export interface PerpTransaction extends PerpTxParts {
  /** What it does, e.g. "buy 2 lots of BTC-THRUSD at 84250". */
  label: string;
  instructions: PerpInstructionSpec[];
}

/** JSON form of a PerpTransaction. */
export interface PerpTransactionJSON {
  label: string;
  instructions: PerpInstructionSpec[];
  readWrite: string[];
  readOnly: string[];
  stateUnits?: number;
}

export interface OrderRequest {
  side: PerpOrderSide;
  /** Default gtc; alo is post-only. */
  orderType?: PerpOrderType;
  /** Quote atoms per base atom, multiple of the tick size. */
  price: bigint;
  /** Base atoms, multiple of the lot size. */
  quantity: bigint;
  clientId?: Uint8Array;
  /** Default: never (i64 max). */
  expirationTime?: bigint;
}

export interface CancelRequest {
  orderEntryIndex: number;
  orderId: bigint;
}

/** A margin account as a margin record names it: every link in the
    account's order, the market's seat arena and its oracle feed. */
export interface CrossAccountRef {
  address: string;
  links: Array<{ seatArena: string; oracleFeed?: string }>;
}

export type PerpCrossAccountRef = CrossAccountRef;

/** A builder code (0.5.0): the fee seat an order transaction's market record
    names and the rate it pays it, ppm of filled notional (capped by the
    market's builder cap).  The seat authority signs it with the record. */
export interface PerpBuilderCode {
  builderSeatIndex: number;
  feePpm: number;
}

export interface PerpTxOptions {
  /** The seat's margin account, when the seat is cross. */
  margin?: CrossAccountRef;
  /** ordersTx only: the builder its orders pay as taker, and that its
      resting orders carry as maker. */
  builder?: PerpBuilderCode;
  /** Refuse an instruction this program version does not have. */
  version?: PerpAbiVersion;
  label?: string;
}

/** A margin account's record shape from its parsed account
    (parsePerpMarginAccount / decode.marginAccount) and the markets it may
    link: every link's oracle feed is required (the program reads the mark
    of every linked market with a position or orders). */
export function perpCrossAccountRef(
  address: string,
  account: { links: readonly Pick<PerpMarginAccount['links'][number], 'market'>[] },
  markets: Iterable<{ seatArena: string; oracleFeed: string }> | ((seatArena: string) => string | undefined),
): CrossAccountRef {
  const feedOf =
    typeof markets === 'function'
      ? markets
      : (() => {
          const map = new Map<string, string>();
          for (const market of markets) map.set(market.seatArena, market.oracleFeed);
          return (seatArena: string) => map.get(seatArena);
        })();
  return {
    address,
    links: account.links.map((link) => {
      const oracleFeed = feedOf(link.market);
      if (!oracleFeed) throw new Error(`margin account ${address} links market ${link.market}, whose oracle feed is unknown`);
      return { seatArena: link.market, oracleFeed };
    }),
  };
}

export function marketAccountAddresses(market: MarketRef['market']): string[] {
  return perpMarketAccountAddresses(market);
}

/** Read-only accounts every trading transaction carries: the exchange meta
    and the oracle feed. */
export function marketReadOnlyAddresses(ref: MarketRef): string[] {
  return perpMarketReadOnlyAddresses({ exchangeMeta: ref.deployment.exchangeMeta, oracleFeed: ref.market.oracleFeed });
}

/** A transaction from specs. */
export function perpTransaction(label: string, instructions: PerpInstructionSpec[], readWrite: string[], readOnly: string[], stateUnits?: number): PerpTransaction {
  return {
    label,
    instructions,
    readWrite: dedupe(readWrite),
    readOnly: dedupe(readOnly).filter((address) => !readWrite.includes(address)),
    ...(stateUnits === undefined ? {} : { stateUnits }),
    instructionData: encodePerpInstructions(instructions),
  };
}

export function perpTransactionToJSON(tx: PerpTransaction): PerpTransactionJSON {
  return {
    label: tx.label,
    instructions: tx.instructions,
    readWrite: tx.readWrite,
    readOnly: tx.readOnly,
    ...(tx.stateUnits === undefined ? {} : { stateUnits: tx.stateUnits }),
  };
}

export function perpTransactionFromJSON(json: PerpTransactionJSON): PerpTransaction {
  if (!json || !Array.isArray(json.instructions) || !Array.isArray(json.readWrite) || !Array.isArray(json.readOnly)) {
    throw new Error('not a perp transaction JSON object (label, instructions, readWrite, readOnly)');
  }
  return perpTransaction(json.label ?? 'perp transaction', json.instructions, json.readWrite, json.readOnly, json.stateUnits);
}

/** The account order of a transaction a key signs (transactions.build, and
    the LiteVM builder): the fee payer, the program, then the read-write
    and the read-only accounts each sorted by their bytes. */
export function perpTransactionAccountOrder(tx: Pick<PerpTxParts, 'readWrite' | 'readOnly'>, feePayer: string, programAddress: string): string[] {
  const sorted = (addresses: string[]) =>
    dedupe(addresses)
      .filter((address) => address !== feePayer && address !== programAddress)
      .map((address) => ({ address, bytes: Pubkey.from(address).toBytes() }))
      .sort((a, b) => {
        for (let i = 0; i < 32; i++) if (a.bytes[i] !== b.bytes[i]) return a.bytes[i]! - b.bytes[i]!;
        return 0;
      })
      .map((entry) => entry.address);
  const readWrite = sorted(tx.readWrite);
  return [feePayer, programAddress, ...readWrite, ...sorted(tx.readOnly.filter((address) => !readWrite.includes(address)))];
}

/** The instruction bytes of a transaction a key signs (fee payer
    `feePayer`), and its account order. */
export async function encodePerpTransaction(tx: PerpTxParts, feePayer: string, programAddress: string): Promise<{ accounts: string[]; data: Uint8Array }> {
  const accounts = perpTransactionAccountOrder(tx, feePayer, programAddress);
  const data = await tx.instructionData({
    getAccountIndex(pubkey: Uint8Array) {
      const index = accounts.indexOf(Pubkey.from(pubkey).toThruFmt());
      if (index < 0) throw new Error(`account ${Pubkey.from(pubkey).toThruFmt()} is not in the transaction`);
      return index;
    },
  });
  return { accounts, data };
}

/* Records ************************************************************************/

type MarketRecordSpec = Extract<PerpInstructionSpec, { ix: 'market_record' }>;

function baseRecord(ref: MarketRef, marketRecordIndex = PERP_DEFAULT_MARKET_RECORD_INDEX): MarketRecordSpec {
  return {
    ix: 'market_record',
    marketRecordIndex,
    seatArena: ref.market.seatArena,
    orderArena: ref.market.orderArena,
    bidsCbook: ref.market.bidsCbook,
    asksCbook: ref.market.asksCbook,
    exchangeMeta: ref.deployment.exchangeMeta,
  };
}

/** The market record of a seat's trading instruction; `withVault` adds the
    token program and quote vault for deposits and withdrawals. */
export function marketRecordSpec(ref: MarketRef, seatAuthority: string, seatIndex: number, withVault: boolean): MarketRecordSpec {
  return {
    ...baseRecord(ref),
    seatAuthority,
    seatIndex,
    ...(withVault ? { tokenProgram: ref.deployment.tokenProgram, quoteVault: ref.market.quoteVault } : {}),
    oracleFeed: ref.market.oracleFeed,
  };
}

/** marketRecordSpec as instruction data (kept for callers of the old API). */
export function marketRecord(ref: MarketRef, seatAuthority: string, seatIndex: number, withVault: boolean): InstructionData {
  return encodePerpInstructions([marketRecordSpec(ref, seatAuthority, seatIndex, withVault)]);
}

function marginRecordSpec(exchangeMeta: string, account: CrossAccountRef, marginRecordIndex: number): PerpInstructionSpec {
  if (marginRecordIndex < 0 || marginRecordIndex >= PERP_MARGIN_MAX_RECORDS) throw new Error(`margin record index must be 0..${PERP_MARGIN_MAX_RECORDS - 1}`);
  return {
    ix: 'margin_record',
    marginRecordIndex,
    marginAccount: account.address,
    exchangeMeta,
    entries: account.links.map((link) => (link.oracleFeed ? { seatArena: link.seatArena, oracleFeed: link.oracleFeed } : { seatArena: link.seatArena })),
  };
}

/** `tx` preceded by `account`'s margin record (index `marginRecordIndex`,
    default 0).  The account, its linked markets and feeds and the exchange
    meta join the read-only accounts (the account read-write when `writable`: link and
    unlink write it). */
export function withMarginRecord(tx: PerpTransaction, ref: { deployment: Pick<MarketRef['deployment'], 'exchangeMeta'> }, account: CrossAccountRef, writable = false, marginRecordIndex = 0): PerpTransaction {
  const readWrite = [...tx.readWrite];
  const readOnly = [...tx.readOnly];
  const seen = new Set([...readWrite, ...readOnly]);
  if (writable && !seen.has(account.address)) {
    readWrite.push(account.address);
    seen.add(account.address);
  }
  /* The record verifies the exchange meta (its status flags gate the
     account's withdrawals, links and transfers). */
  for (const address of [account.address, ...account.links.flatMap((link) => (link.oracleFeed ? [link.seatArena, link.oracleFeed] : [link.seatArena])), ref.deployment.exchangeMeta]) {
    if (seen.has(address)) continue;
    seen.add(address);
    readOnly.push(address);
  }
  return perpTransaction(tx.label, [marginRecordSpec(ref.deployment.exchangeMeta, account, marginRecordIndex), ...tx.instructions], readWrite, readOnly, tx.stateUnits);
}

function crossAware(tx: PerpTransaction, ref: MarketRef, options: PerpTxOptions): PerpTransaction {
  const labelled = options.label ? { ...tx, label: options.label } : tx;
  if (!options.margin) return labelled;
  if (options.version) assertPerpSupports(options.version, 'crossMargin', 'a cross seat transaction');
  if (!options.margin.links.some((link) => link.seatArena === ref.market.seatArena)) {
    throw new Error(`margin account ${options.margin.address} does not link market ${ref.market.seatArena}`);
  }
  return withMarginRecord(labelled, ref, options.margin);
}

/* Seats and collateral **********************************************************/

/** Seat creation: the record names the authority but has no seat index yet. */
export function seatCreateTx(ref: MarketRef, authority: string): PerpTransaction {
  return perpTransaction(
    'create seat',
    [baseRecord(ref), { ix: 'seat_create', marketRecordIndex: PERP_DEFAULT_MARKET_RECORD_INDEX, seatAuthority: authority }],
    marketAccountAddresses(ref.market),
    [ref.deployment.exchangeMeta],
  );
}

function collateralTx(ref: MarketRef, authority: string, seatIndex: number, wallet: { address: string }, deposit: boolean, amount: bigint, options: PerpTxOptions): PerpTransaction {
  const spec: PerpInstructionSpec = {
    ix: deposit ? 'token_deposit' : 'token_withdraw',
    marketRecordIndex: PERP_DEFAULT_MARKET_RECORD_INDEX,
    tokenProgram: ref.deployment.tokenProgram,
    from: deposit ? wallet.address : ref.market.quoteVault,
    to: deposit ? ref.market.quoteVault : wallet.address,
    amount: amount.toString(),
  };
  return crossAware(
    perpTransaction(
      `${deposit ? 'deposit' : 'withdraw'} ${amount}`,
      [marketRecordSpec(ref, authority, seatIndex, true), spec],
      [...marketAccountAddresses(ref.market), wallet.address, ref.market.quoteVault],
      [...marketReadOnlyAddresses(ref), ref.deployment.tokenProgram],
    ),
    ref,
    options,
  );
}

/** Moves `amount` quote atoms from the wallet's token account into the seat. */
export function depositTx(ref: MarketRef, authority: string, seatIndex: number, wallet: { address: string }, amount: bigint, options: PerpTxOptions = {}): PerpTransaction {
  return collateralTx(ref, authority, seatIndex, wallet, true, amount, options);
}

/** Moves `amount` quote atoms from the seat to the wallet's token account.
    The program settles the seat's funding first and checks free margin
    (over the whole account for a cross seat, whose balance may go
    negative): no settle_funding is needed before it. */
export function withdrawTx(ref: MarketRef, authority: string, seatIndex: number, wallet: { address: string }, amount: bigint, options: PerpTxOptions = {}): PerpTransaction {
  return collateralTx(ref, authority, seatIndex, wallet, false, amount, options);
}

/* Orders ************************************************************************/

/** The book an order transaction is sized against: the market's tick size,
    both cbooks (null when unreadable) and, when the transaction cancels,
    the order arena's active entries. See readOrderBookState. */
export interface OrderBookState {
  tickSize: bigint;
  bidsCbook: PerpCbookHeader | null;
  asksCbook: PerpCbookHeader | null;
  restingOrders?: PerpOrderEntry[];
}

/** Reads what ordersTx needs to request state units: both cbooks and, with
    `withOrders`, the order arena. A side that cannot be read is null (its
    growth is then not counted) rather than failing the order: the program
    is the authority and the estimate only has to cover the growth. */
export async function readOrderBookState(
  sdk: Pick<ThruClient, 'accounts'>,
  market: { tickSize: string | bigint; bidsCbook: string; asksCbook: string; orderArena: string },
  options: ReadAccountOptions & { withOrders?: boolean } = {},
): Promise<OrderBookState> {
  const read = async <T>(address: string, parse: (account: Account) => T): Promise<T | null> => {
    try {
      return parse(await readAccount(sdk, address, options));
    } catch {
      return null;
    }
  };
  const [bidsCbook, asksCbook, arena] = await Promise.all([
    read(market.bidsCbook, parsePerpCbookHeader),
    read(market.asksCbook, parsePerpCbookHeader),
    options.withOrders ? read(market.orderArena, parsePerpOrderArenaAccount) : Promise.resolve(null),
  ]);
  return { tickSize: BigInt(market.tickSize), bidsCbook, asksCbook, ...(arena ? { restingOrders: arena.orders } : {}) };
}

/** Cancels then new orders, atomically, each preceded by the one record.
    With `book` the transaction requests the state units resting the orders
    grows the cbooks by (estimatePerpOrderStateUnits); without it none, so
    an order outside a side's level range fails with SU_EXHAUSTED. */
export function ordersTx(
  ref: MarketRef,
  authority: string,
  seatIndex: number,
  orders: OrderRequest[],
  cancels: CancelRequest[] = [],
  book?: OrderBookState,
  options: PerpTxOptions = {},
): PerpTransaction {
  if (options.builder && options.version) assertPerpSupports(options.version, 'tradingFees', 'a builder code');
  const record = marketRecordSpec(ref, authority, seatIndex, false);
  const instructions: PerpInstructionSpec[] = [
    options.builder ? { ...record, builderSeatIndex: options.builder.builderSeatIndex, builderFeePpm: options.builder.feePpm } : record,
  ];
  for (const cancel of cancels) instructions.push(cancelSpec(cancel));
  for (const order of orders) {
    instructions.push({
      ix: 'create_order_entry',
      marketRecordIndex: PERP_DEFAULT_MARKET_RECORD_INDEX,
      side: order.side,
      orderType: order.orderType ?? 'gtc',
      price: order.price.toString(),
      quantity: order.quantity.toString(),
      ...(order.expirationTime === undefined ? {} : { expirationTime: order.expirationTime.toString() }),
      ...(order.clientId ? { clientId: bytesToHex(order.clientId) } : {}),
    });
  }
  const label =
    [
      ...cancels.map((cancel) => `cancel #${cancel.orderId}`),
      ...orders.map((order) => `${order.side} ${order.orderType ?? 'gtc'} ${order.quantity} @ ${order.price}`),
    ].join(', ') || 'no-op';
  const stateUnits = book ? estimatePerpOrderStateUnits({ ...book, cancels, orders }).stateUnits : undefined;
  return crossAware(perpTransaction(label, instructions, marketAccountAddresses(ref.market), marketReadOnlyAddresses(ref), stateUnits), ref, options);
}

function cancelSpec(cancel: CancelRequest): PerpInstructionSpec {
  return {
    ix: 'modify_order_entry',
    marketRecordIndex: PERP_DEFAULT_MARKET_RECORD_INDEX,
    orderEntryIndex: cancel.orderEntryIndex,
    quantity: '0',
    expirationTime: '0',
    orderId: cancel.orderId.toString(),
  };
}

/** Cancels the given resting orders of the seat (ordersTx without orders). */
export function cancelOrdersTx(ref: MarketRef, authority: string, seatIndex: number, cancels: CancelRequest[], options: PerpTxOptions = {}): PerpTransaction {
  if (!cancels.length) throw new Error('nothing to cancel');
  return ordersTx(ref, authority, seatIndex, [], cancels, undefined, options);
}

export interface ModifyRequest extends CancelRequest {
  /** The new quantity in base atoms: at most the order's current one (0 cancels). */
  quantity: bigint;
  /** The new expiration time (default: never). */
  expirationTime?: bigint;
  /** Fail instead of clamping when quantity is out of range. */
  failIfOutOfRange?: boolean;
}

/** Reduces (or re-dates) resting orders; the program refuses an increase. */
export function modifyOrderTx(ref: MarketRef, authority: string, seatIndex: number, modifies: ModifyRequest[], options: PerpTxOptions = {}): PerpTransaction {
  if (!modifies.length) throw new Error('nothing to modify');
  const instructions: PerpInstructionSpec[] = [marketRecordSpec(ref, authority, seatIndex, false)];
  for (const modify of modifies) {
    instructions.push({
      ix: 'modify_order_entry',
      marketRecordIndex: PERP_DEFAULT_MARKET_RECORD_INDEX,
      orderEntryIndex: modify.orderEntryIndex,
      quantity: modify.quantity.toString(),
      expirationTime: (modify.expirationTime ?? 9_223_372_036_854_775_807n).toString(),
      orderId: modify.orderId.toString(),
      ...(modify.failIfOutOfRange ? { failIfOutOfRange: true } : {}),
    });
  }
  const label = modifies.map((modify) => `modify #${modify.orderId} to ${modify.quantity}`).join(', ');
  return crossAware(perpTransaction(label, instructions, marketAccountAddresses(ref.market), marketReadOnlyAddresses(ref)), ref, options);
}

/* Liquidation *********************************************************************/

export interface LiquidateOptions extends PerpTxOptions {
  /** The target's margin account when the target seat is cross (margin record 0). */
  target?: CrossAccountRef;
  /** The liquidator's own account when the liquidator's seat is cross
      (margin record 1; `margin` is accepted as an alias). */
  liquidator?: CrossAccountRef;
}

/** The signer's seat liquidates `targetSeatIndex`: the target's resting
    orders are cancelled and its position moves to the liquidator at the
    mark (clamped to an isolated target's bankruptcy price), plus the
    liquidation fee.  A cross target needs its account's margin record, a
    cross liquidator its own.  Fails with NOT_LIQUIDATABLE (-215) while the
    target's equity covers its maintenance margin, INSUFFICIENT_COLLATERAL
    (-403) when the liquidator cannot carry the position. */
export function liquidateTx(ref: MarketRef, authority: string, seatIndex: number, targetSeatIndex: number, options: LiquidateOptions = {}): PerpTransaction {
  let tx = perpTransaction(
    options.label ?? `liquidate seat #${targetSeatIndex}`,
    [
      marketRecordSpec(ref, authority, seatIndex, false),
      { ix: 'liquidate', marketRecordIndex: PERP_DEFAULT_MARKET_RECORD_INDEX, targetSeatIndex },
    ],
    marketAccountAddresses(ref.market),
    marketReadOnlyAddresses(ref),
  );
  const liquidator = options.liquidator ?? options.margin;
  if (options.target || liquidator) {
    if (options.version) assertPerpSupports(options.version, 'crossMargin', 'a cross liquidation');
  }
  if (liquidator) tx = withMarginRecord(tx, ref, liquidator, false, 1);
  if (options.target) tx = withMarginRecord(tx, ref, options.target, false, 0);
  return tx;
}

/** Liquidation of a cross seat: the target's margin record (index 0), the
    liquidator's market record and the liquidation. */
export function crossLiquidateTx(ref: MarketRef, authority: string, seatIndex: number, targetSeatIndex: number, account: CrossAccountRef): PerpTransaction {
  return liquidateTx(ref, authority, seatIndex, targetSeatIndex, { target: account });
}

/* Margin accounts **********************************************************************/

/** Creates margin account `accountId` of `owner` on `vault` (its address
    derivePerpMarginAccountAddress); `proof` is the account's creation proof. */
export function marginAccountCreateTx(
  deployment: { exchangeMeta: string },
  owner: string,
  vault: string,
  margin: { address: string },
  accountId: number,
  proof: Uint8Array,
): PerpTransaction {
  void deployment;
  return perpTransaction(
    `create margin account ${accountId}`,
    [{ ix: 'margin_account_create', owner, marginAccount: margin.address, vault, accountId, proof: bytesToHex(proof) }],
    [margin.address],
    [vault],
    1,
  );
}

/** Links (or unlinks) the owner's seat in `ref` into (out of) the margin
    account, whose record lists its links before the change.  A link needs
    the market on the account's vault (MARGIN_VAULT_MISMATCH otherwise) and
    the account with the new seat to meet initial margin; an unlink a flat
    seat with a nonnegative balance. */
export function marginLinkTx(ref: MarketRef, owner: string, seatIndex: number, account: CrossAccountRef, link: boolean): PerpTransaction {
  const spec: PerpInstructionSpec = { ix: link ? 'margin_link' : 'margin_unlink', marginRecordIndex: 0, marketRecordIndex: PERP_DEFAULT_MARKET_RECORD_INDEX };
  return withMarginRecord(
    perpTransaction(
      `${link ? 'link' : 'unlink'} seat #${seatIndex}`,
      [marketRecordSpec(ref, owner, seatIndex, false), spec],
      marketAccountAddresses(ref.market),
      marketReadOnlyAddresses(ref),
    ),
    ref,
    account,
    true,
  );
}

/** Moves collateral between two linked seats of the account (a ledger move
    in the shared vault): both seat arenas are written. */
export function marginTransferTx(
  deployment: { exchangeMeta: string },
  owner: string,
  account: CrossAccountRef,
  fromLink: number,
  toLink: number,
  amount: bigint,
): PerpTransaction {
  const from = account.links[fromLink];
  const to = account.links[toLink];
  if (!from || !to || fromLink === toLink) throw new Error(`margin transfer links ${fromLink} -> ${toLink} are not two links of the account`);
  const base = perpTransaction(
    `move ${amount} from link ${fromLink} to link ${toLink}`,
    [{ ix: 'margin_transfer', marginRecordIndex: 0, fromLink, toLink, owner, amount: amount.toString() }],
    [from.seatArena, to.seatArena],
    [],
  );
  return withMarginRecord(base, { deployment }, account);
}

/* Funding ******************************************************************************/

/** The record funding needs: the market accounts and the oracle feed, no
    seat (funding_update and settle_funding are permissionless), plus the
    market authority for market_set_funding. */
function fundingRecord(ref: MarketRef, marketAuthority?: string, marketRecordIndex = PERP_DEFAULT_MARKET_RECORD_INDEX): MarketRecordSpec {
  return {
    ...baseRecord(ref, marketRecordIndex),
    ...(marketAuthority ? { marketAuthority } : {}),
    oracleFeed: ref.market.oracleFeed,
  };
}

/** Funding crank: runs a due hourly round and a due premium sample; anyone
    may send it.  `settleSeats` then settles those seats in the same
    transaction (settle_funding, also permissionless), so seats that never
    trade still pay.  No order instruction may share the transaction
    (FUNDING_UPDATE_NOT_ALONE).  Rejected with FUNDING_DISABLED (-217) on a
    market without funding, ORACLE_STALE while the feed is stale. */
export function fundingUpdateTx(ref: MarketRef, settleSeats: number[] = []): PerpTransaction {
  return perpTransaction(
    'funding update',
    [
      fundingRecord(ref),
      { ix: 'funding_update', marketRecordIndex: PERP_DEFAULT_MARKET_RECORD_INDEX },
      ...settleSeats.map((targetSeatIndex): PerpInstructionSpec => ({ ix: 'settle_funding', marketRecordIndex: PERP_DEFAULT_MARKET_RECORD_INDEX, targetSeatIndex })),
    ],
    marketAccountAddresses(ref.market),
    marketReadOnlyAddresses(ref),
  );
}

/** Settles seats' funding in one market (settle_funding, permissionless:
    any seat).  The program settles a seat itself before it reads its
    equity (orders, withdrawals, liquidations, links), so this is never
    required; it brings the on-chain balance (and an indexer's view of it)
    up to date, e.g. before showing a withdrawable amount. */
export function settleFundingTx(ref: MarketRef, seatIndexes: number[], options: PerpTxOptions = {}): PerpTransaction {
  if (!seatIndexes.length) throw new Error('no seats to settle');
  if (options.version) assertPerpSupports(options.version, 'settleFunding', 'settle_funding');
  return perpTransaction(
    options.label ?? `settle funding of seat${seatIndexes.length > 1 ? 's' : ''} ${seatIndexes.map((seat) => `#${seat}`).join(', ')}`,
    [
      baseRecord(ref),
      ...seatIndexes.map((targetSeatIndex): PerpInstructionSpec => ({ ix: 'settle_funding', marketRecordIndex: PERP_DEFAULT_MARKET_RECORD_INDEX, targetSeatIndex })),
    ],
    marketAccountAddresses(ref.market),
    [ref.deployment.exchangeMeta],
  );
}

/** Settles the funding of every seat a margin account links, in one
    transaction: one market record per linked market (indexes 1..n), each
    followed by settle_funding of the account's seat there.  `markets`
    resolves a linked seat arena to its market's accounts. */
export function settleAccountFundingTx(
  deployment: MarketRef['deployment'],
  account: Pick<PerpMarginAccount, 'links'>,
  markets: Iterable<MarketRef['market']> | ((seatArena: string) => MarketRef['market'] | undefined),
  options: PerpTxOptions = {},
): PerpTransaction {
  if (options.version) assertPerpSupports(options.version, 'settleFunding', 'settle_funding');
  const marketOf =
    typeof markets === 'function'
      ? markets
      : (() => {
          const map = new Map<string, MarketRef['market']>();
          for (const market of markets) map.set(market.seatArena, market);
          return (seatArena: string) => map.get(seatArena);
        })();
  if (!account.links.length) throw new Error('the margin account links no seat');
  const instructions: PerpInstructionSpec[] = [];
  const readWrite: string[] = [];
  account.links.forEach((link, i) => {
    const market = marketOf(link.market);
    if (!market) throw new Error(`linked market ${link.market} is not known`);
    const ref = { deployment, market };
    instructions.push(baseRecord(ref, i + 1), { ix: 'settle_funding', marketRecordIndex: i + 1, targetSeatIndex: link.seatIndex });
    readWrite.push(...marketAccountAddresses(market));
  });
  return perpTransaction(options.label ?? `settle funding of ${account.links.length} linked seat(s)`, instructions, readWrite, [deployment.exchangeMeta]);
}

/** Market authority: set the funding parameters (premiumMultiplier 0 turns
    funding off). */
export function setFundingTx(ref: MarketRef, marketAuthority: string, params: PerpFundingParams): PerpTransaction {
  return perpTransaction(
    'set funding',
    [
      fundingRecord(ref, marketAuthority),
      { ix: 'market_set_funding', marketRecordIndex: PERP_DEFAULT_MARKET_RECORD_INDEX, ...params, impactNotional: params.impactNotional.toString() },
    ],
    marketAccountAddresses(ref.market),
    marketReadOnlyAddresses(ref),
  );
}

/* Exchange and market administration *********************************/

/** Exchange-wide status flags (PERP_STATUS_FLAG_*), OR-ed into every
    market's: the exchange admin signs. */
export function exchangeSetStatusTx(deployment: { exchangeMeta: string }, exchangeAdmin: string, statusFlags: number): PerpTransaction {
  return perpTransaction('set exchange status', [{ ix: 'exchange_set_status', exchangeMeta: deployment.exchangeMeta, exchangeAdmin, statusFlags }], [deployment.exchangeMeta], []);
}

/** One market's status flags: the market authority signs. */
export function marketSetStatusTx(ref: MarketRef, marketAuthority: string, statusFlags: number): PerpTransaction {
  return perpTransaction(
    'set market status',
    [fundingRecord(ref, marketAuthority), { ix: 'market_set_status', marketRecordIndex: PERP_DEFAULT_MARKET_RECORD_INDEX, statusFlags }],
    marketAccountAddresses(ref.market),
    marketReadOnlyAddresses(ref),
  );
}

/** The share of cross seats' positive unrealized pnl initial margin does
    not count (basis points): the market authority signs. */
export function marketSetCrossTx(ref: MarketRef, marketAuthority: string, crossUpnlHaircutBps: number): PerpTransaction {
  return perpTransaction(
    'set cross haircut',
    [fundingRecord(ref, marketAuthority), { ix: 'market_set_cross', marketRecordIndex: PERP_DEFAULT_MARKET_RECORD_INDEX, crossUpnlHaircutBps }],
    marketAccountAddresses(ref.market),
    marketReadOnlyAddresses(ref),
  );
}

/** Moves the market's own ledger share from its quote vault to newVault (a
    token account of the same mint this program owns) and repoints it: the
    exchange admin signs.  Refused while the market has a cross seat. */
export function marketSetVaultTx(ref: MarketRef, exchangeAdmin: string, newVault: string): PerpTransaction {
  return perpTransaction(
    'set market vault',
    [
      { ...baseRecord(ref), tokenProgram: ref.deployment.tokenProgram, quoteVault: ref.market.quoteVault },
      { ix: 'market_set_vault', marketRecordIndex: PERP_DEFAULT_MARKET_RECORD_INDEX, exchangeAdmin, newVault },
    ],
    [...marketAccountAddresses(ref.market), ref.market.quoteVault, newVault],
    [ref.deployment.exchangeMeta, ref.deployment.tokenProgram],
  );
}

/* Trading fees and builder codes (0.5.0) *************************************/

/** Market authority: set the fee rates (ppm).  A taker fee or builder cap
    increase is pending for PERP_FEE_INCREASE_DELAY_NS; perpFeesAfterSet
    previews the result.  Rejected with FEE_PARAM_INVALID (-231). */
export function marketSetFeesTx(ref: MarketRef, marketAuthority: string, params: PerpFeeParams, options: PerpTxOptions = {}): PerpTransaction {
  if (options.version) assertPerpSupports(options.version, 'tradingFees', 'market_set_fees');
  return perpTransaction(
    options.label ?? 'set fees',
    [fundingRecord(ref, marketAuthority), { ix: 'market_set_fees', marketRecordIndex: PERP_DEFAULT_MARKET_RECORD_INDEX, ...params }],
    marketAccountAddresses(ref.market),
    marketReadOnlyAddresses(ref),
  );
}

/** Market authority: moves `amount` of the market's protocol fees into its
    own seat `seatIndex`, which then withdraws it normally.  The program needs
    both the market authority and the seat authority to authorize the record,
    and a transaction here has one authorizing fee payer, so the seat must
    belong to the market authority.  Refused with FEE_CLAIM_BLOCKED (-234)
    while the market has bad debt or for more than its fee balance. */
export function feeClaimTx(ref: MarketRef, authority: string, seatIndex: number, amount: bigint, options: PerpTxOptions = {}): PerpTransaction {
  if (options.version) assertPerpSupports(options.version, 'tradingFees', 'fee_claim');
  return perpTransaction(
    options.label ?? `claim ${amount} protocol fees`,
    [
      { ...marketRecordSpec(ref, authority, seatIndex, false), marketAuthority: authority },
      { ix: 'fee_claim', marketRecordIndex: PERP_DEFAULT_MARKET_RECORD_INDEX, amount: amount.toString() },
    ],
    marketAccountAddresses(ref.market),
    marketReadOnlyAddresses(ref),
  );
}

/** The seat (isolated, flat, no resting orders) becomes a builder's fee
    seat: irreversible, it never trades again.  Refused with FEE_SEAT (-232). */
export function seatSetFeeReceiverTx(ref: MarketRef, authority: string, seatIndex: number, options: PerpTxOptions = {}): PerpTransaction {
  if (options.version) assertPerpSupports(options.version, 'tradingFees', 'seat_set_fee_receiver');
  return perpTransaction(
    options.label ?? `make seat #${seatIndex} a fee seat`,
    [marketRecordSpec(ref, authority, seatIndex, false), { ix: 'seat_set_fee_receiver', marketRecordIndex: PERP_DEFAULT_MARKET_RECORD_INDEX }],
    marketAccountAddresses(ref.market),
    marketReadOnlyAddresses(ref),
  );
}

/** The seat approves the fee seat builderSeatIndex to charge its resting
    orders up to maxFeePpm as maker (replacing any approval); 0 / 0 revokes. */
export function seatSetBuilderApprovalTx(
  ref: MarketRef,
  authority: string,
  seatIndex: number,
  approval: { builderSeatIndex: number; maxFeePpm: number },
  options: PerpTxOptions = {},
): PerpTransaction {
  if (options.version) assertPerpSupports(options.version, 'tradingFees', 'seat_set_builder_approval');
  const label = approval.builderSeatIndex ? `approve builder #${approval.builderSeatIndex} up to ${approval.maxFeePpm} ppm` : 'revoke builder approval';
  return perpTransaction(
    options.label ?? label,
    [
      marketRecordSpec(ref, authority, seatIndex, false),
      { ix: 'seat_set_builder_approval', marketRecordIndex: PERP_DEFAULT_MARKET_RECORD_INDEX, builderSeatIndex: approval.builderSeatIndex, maxFeePpm: approval.maxFeePpm },
    ],
    marketAccountAddresses(ref.market),
    marketReadOnlyAddresses(ref),
  );
}

function dedupe(addresses: string[]): string[] {
  return [...new Set(addresses)];
}
