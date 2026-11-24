# @thru/programs/perps

This is the TypeScript SDK for the Thru perpetual futures program. It reads
a deployment, builds its transactions (isolated and cross-margined seats),
signs them with any signer and sends them on the fast confirm path. It runs
in Node and in the browser. Bots, apps, the perps indexer and LLM agents use
the same code.

```sh
pnpm add @thru/programs @thru/sdk
```

```ts
import { createPerpsClient } from '@thru/programs/perps';
```

`@thru/programs/perp` is an alias of the same module, so older imports keep
working.

## Contents

- [Quickstart](#quickstart)
- [A new key](#a-new-key)
- [Clients and deployments](#clients-and-deployments)
- [Reading](#reading)
- [Actions](#actions)
- [Fees and builder codes](#fees-and-builder-codes)
- [Loss waterfall](#loss-waterfall)
- [Cross margin](#cross-margin)
- [Funding](#funding)
- [State units](#state-units)
- [Signers](#signers)
- [Sending and errors](#sending-and-errors)
- [Units](#units)
- [Agents](#agents)
- [ABI evolution](#abi-evolution)
- [Low-level builders](#low-level-builders)
- [Examples](#examples)

## Quickstart

```ts
import { readFileSync } from 'node:fs';
import { createPerpsClient, ensurePerpsAccounts, keypairSignerFromJSON } from '@thru/programs/perps';

const perps = await createPerpsClient({
  deployment: JSON.parse(readFileSync('deployment.betanet.json', 'utf8')),
  indexerUrl: 'https://perps-api.example.org', // optional
});
const key = JSON.parse(readFileSync('key.json', 'utf8')); // { address, privateKeyHex }
await ensurePerpsAccounts(perps, key); // a new key: its account and its quote token account
const signer = keypairSignerFromJSON(key);
const owner = signer.address;

await perps.send(await perps.createSeat({ market: 'BTC-UUSD', owner }), signer);
await perps.send(await perps.deposit({ market: 'BTC-UUSD', owner, amount: '1000' }), signer);

const order = await perps.placeOrder({ market: 'BTC-UUSD', owner, side: 'buy', price: '84000', size: '0.01', postOnly: true });
console.log(order.meta); // { action, seatIndex, cross, marginAccount, stateUnits, programAddress, ... }
const { signature } = await perps.send(order, signer);

await perps.send(await perps.cancelAll({ market: 'BTC-UUSD', owner }), signer);
```

Every builder returns `{ transaction, meta }`:

- `transaction` is an unsigned `PerpTransaction`: the instruction specs, the
  read-write and read-only accounts, and the state units to request. Its
  JSON form is `perpTransactionToJSON`.
- `meta` says which seat it uses, whether the seat is cross and which
  margin account it carries.

`send(tx, signer)` signs the transaction, sends it and resolves when it has
executed.

## A new key

A fresh key has nothing on chain. Before it can trade it needs:

- **its own account**, because a key pays for its transactions (the fee
  payer);
- **its canonical token account for the quote mint** (UUSD), which
  `deposit` draws from and `withdraw` pays into.

`ensurePerpsAccounts(perps, key)` creates both, and is safe to run at every
start:

```ts
const setup = await ensurePerpsAccounts(perps, { address, privateKeyHex });
// { feePayer: { address, status: 'existing' | 'created' | 'restored' },
//   tokenAccounts: [{ symbol: 'UUSD', mint, owner, address, status: 'existing' | 'created' | 'restored', amount }] }
```

- `key` is `{ address, privateKeyHex }` (the key file `keypairSignerFromJSON`
  reads) or `{ address, privateKey }`.
- The key signs its own account's creation. An account that state
  compression archived (the fee payer or a token account) is restored
  instead, signed by the key.
- It creates a token account for every quote mint the deployment's markets
  use, or for `{ quotes: ['UUSD'] }`.
- It does not fund the token account. Send quote tokens to
  `tokenAccounts[0].address` (on Betanet, the faucet in the deployment
  record funds an existing token account).

The parts are exported too. `ensureFeePayerAccount(thru, key)` creates or
restores the account. `ensureQuoteTokenAccount(perps, payer, { owner?,
quote?, submit? })` creates one token account and works with any signer, so a
wallet can pay for its own; it restores an archived one only with
`submit.archived` (the restore's signer), and refuses it otherwise.
`readQuoteTokenAccount(perps, owner, quote?)` returns the account's address,
balance and whether it is archived.

## Clients and deployments

```ts
createPerpsClient({
  deployment,        // a record object, a registered network name, an http(s) URL of the JSON, or the JSON text
  network,           // shorthand for deployment: '<name>' (registerPerpsDeployment first)
  thru, rpcUrl,      // an existing @thru/sdk client, or an RPC URL (default: the record's rpcUrl)
  indexerUrl,        // the perps indexer API, or an app origin that proxies its /v1 routes
  indexer,           // { headers, timeoutMs, fetch } for the indexer
  marginAccountIds,  // ids searched for an owner's margin accounts over RPC (default 0..3)
});
```

The deployment record is the JSON that the perps tools' `deploy` writes
(`web/perps/deployment.<network>.json`): the program, exchange meta, token
and oracle programs, quote mints and markets.

- `loadPerpsDeployment(source)` validates a record and
  `registerPerpsDeployment(record)` registers one under its network name.
- `PERPS_NETWORK_RPC_URLS` lists the public RPC endpoints.

## Reading

| Method | Returns |
| --- | --- |
| `getMarkets()` / `getMarket(market)` | `{ symbol, address, record, state: PerpMarket }` |
| `getBook(market, depth = 20)` | `{ bids, asks }` levels: `price` (quote atoms per base atom), `priceTicks`, `lots`, `quantity`, `orderCount` |
| `getMark(market)` | `{ mark, feedPrice, exponent, lastUpdateNs, maxAgeNs, stale, error }`; `mark` is null with an `error` when the feed gives none: wrong type or exponent, or `stale` by the program's rule (older than the market's `maxMarkAgeNs`, else the feed's `maxStalenessNs`, or stamped in the future: what the program rejects as ORACLE_STALE) |
| `getFunding(market)` | `{ enabled, funding: PerpFunding, nextRoundNs }` |
| `getSeat(market, owner)` | `PerpSeatEntry` or null |
| `getMarginAccounts(owner)` | the owner's margin accounts: `{ address, accountId, owner, vault, links }` |
| `getOpenOrders(market, owner)` | `{ orderId, orderEntryIndex, side, price, priceTicks, lots, quantity, clientIdHex, expirationTime }` |

`market` is a symbol (case-insensitive) or the seat arena address.

With `indexerUrl`, reads go to the indexer (`/v1/markets/...`,
`/v1/owners/...`). Any indexer failure falls back to RPC, and RPC reads
decode accounts with the SDK's parsers. The results are the same
domain types either way.

Pass `{ source: 'rpc' }` to read the chain directly. The builders always
read the seat, its margin account, the market and the open orders from the
chain, so that an indexer a block behind cannot shape a transaction. The indexer JSON mappers
(`perpMarketFromIndexer`, `perpSeatFromIndexer`, ...) are exported too.

## Actions

All take one object, so they are JSON friendly. `owner` is the seat
authority and must be the signer.

| Action | Parameters | Notes |
| --- | --- | --- |
| `createSeat` | `market, owner` | Once per market. |
| `placeOrder` | `market, owner, side, orderType?, postOnly?, price \| priceAtoms, size \| quantityAtoms \| lots, clientId?, expiresAtNs?, rounding?, builder?` | `orderType`: `gtc` (default), `ioc`, `fok`, `alo` (post-only), `mtl`. Requests the state units the order needs. |
| `placeOrders` | `market, owner, orders[], cancels?[], builder?` | Cancels first, then orders, in one atomic transaction. `builder: { seatIndex, feePpm }` puts a builder code on every order. |
| `cancel` | `market, owner, orderId, orderEntryIndex?` | Looks up the entry index when it is not given. |
| `cancelAll` | `market, owner` | Every resting order of the seat. |
| `modify` | `market, owner, orderId, size \| quantityAtoms \| lots` | Can only reduce an order. |
| `deposit` / `withdraw` | `market, owner, amount \| amountAtoms, seatIndex?` | Moves funds between the owner's canonical token account for the quote mint and the market's current vault. `seatIndex` picks one of the owner's seats (a builder's fee seat). |
| `createMarginAccount` | `market, owner, accountId?` | On the market's quote vault. |
| `linkMargin` / `unlinkMargin` | `market, owner, accountId?` | Makes the seat cross, or isolated again (only a flat seat with a nonnegative balance). |
| `settleFunding` | `market, seatIndexes? \| owner` | Optional (see [Funding](#funding)). |
| `settleAccountFunding` | `owner, marginAccount?` | Every linked seat of the account. |
| `liquidate` | `market, owner, targetSeatIndex` | The owner's seat takes the target's position. Cross targets and cross liquidators get their margin records. |
| `registerBuilderCode` | `market, owner, seatIndex?` | The owner's empty seat becomes its builder fee seat; the seat index is the builder code. Irreversible. |
| `approveBuilder` / `revokeBuilder` | `market, owner, builder, maxFeePpm` / `market, owner` | Lets one builder charge the seat's resting orders as maker. |
| `setFees` | `market, authority, takerFeePpm, makerRebatePpm, builderFeeCapPpm, feeInsuranceSharePpm, liqInsuranceSharePpm` | Market authority. Increases of the taker fee and builder cap wait an hour. |
| `claimFees` | `market, authority, amountAtoms?, seatIndex?` | Market authority. Moves protocol fees (default all) into its own seat. Refused while the market has bad debt. |
| `depositInsurance` | `market, owner, amount \| amountAtoms, seatIndex?` | Moves free collateral of the seat into the market's insurance balance. Allowed while the market is frozen for bad debt. |
| `resolveBadDebt` | `market` | Permissionless. Runs the market's bad debt through the loss waterfall. Refused when nothing could cover any of it. |
| `setRiskParams` | `market, authority, socializeCapBps, ifEpochBudgetBps, bankruptLiqRewardBps` | Market authority. The loss waterfall's parameters. |

Prices and sizes take either human units or atoms, never both:

- `price` is quote per base unit, as a string (`"84250.5"`);
- `priceAtoms` is quote atoms per base atom;
- `size` is base units, as a string;
- `quantityAtoms` is base atoms;
- `lots` is a number of lots.

A value off the tick or lot grid fails unless you pass `rounding: 'down' |
'up' | 'nearest'`.

## Fees and builder codes

The program charges trading fees and pays builder codes
(`thru-perps/PLAN-FEES.md`). Every rate starts at 0; the market authority
turns them on with `setFees`.

`getFees(market)` returns the rates in effect, a pending increase and the
fee and insurance balances. All rates are ppm of filled notional (10,000 =
1%):

- the taker pays `takerFeePpm` (rounded up), the maker of each fill gets
  `makerRebatePpm` (rounded down) out of it;
- a builder code adds the builder's rate, at most 1% and at most the
  market's `builderFeeCapPpm`.

**A builder code is a fee seat index in one market.** A builder gets one
per market:

```ts
await perps.send(await perps.createSeat({ market, owner: builder }), builderSigner);
const code = await perps.registerBuilderCode({ market, owner: builder });
await perps.send(code, builderSigner);
console.log('builder code', code.meta.seatIndex);
```

The fee seat never trades again; fees are credited to it and the builder
withdraws them with `withdraw({ market, owner, amount, seatIndex })`
(`getBuilderCode(market, owner)` gives the index and the balance). Use a
key kept for building: `registerBuilderCode` without `seatIndex` converts
only an empty seat, and `getSeat` returns an owner's trading seat before
its fee seat.

A trader (or an app that builds the trader's transactions) puts the code
on an order transaction:

```ts
await perps.send(
  await perps.placeOrder({ market, owner, side: 'buy', price: '84000', size: '0.01', orderType: 'ioc', builder: { seatIndex: 12, feePpm: 500 } }),
  signer,
);
```

- **As taker**, the trader pays `floor(N * rate / 1e6)` of its filled
  notional `N` with no approval: the trader signs the code with the
  transaction.
- **As maker**, a resting order keeps the code, but a fill charges it only
  if the seat approved that builder: `approveBuilder({ market, owner,
  builder: 12, maxFeePpm: 500 })` (one approval per seat, replaced by the
  next; `revokeBuilder` removes it at once). The rate is the lowest of the
  order's, the approval's and the market cap. It is waived when it would
  put an isolated maker under margin, when a cross maker's price
  improvement does not cover it, and on a self-match.

The FEE event (type 18, `parsePerpEvent`) reports every charge.

## Loss waterfall

The program covers losses with a waterfall (`thru-perps/PLAN-WATERFALL.md`).
When a liquidation leaves a loss that the seat's collateral cannot cover, the
market covers it from, in order:

1. its fee balance;
2. its insurance balance, at most `ifEpochBudgetBps` of it per 8 hour
   epoch (0: no cap);
3. a per-lot charge on the open positions, at most `socializeCapBps` of a
   lot's notional per epoch, priced at the oracle mark.

What is left stays in `state.badDebt`. While it is nonzero the market's
withdrawals are frozen (`MARKET_WITHDRAWALS_FROZEN`).

- `depositInsurance({ market, owner, amount })` moves free collateral of
  the owner's seat into the insurance balance. It cannot be withdrawn
  again. It is allowed while the market is frozen, which is how a frozen
  market recovers. The program settles funding first and moves at most what
  a withdrawal could take.
- `resolveBadDebt({ market })` runs the outstanding bad debt through the
  waterfall again. Anyone may send it. The client refuses it when nothing
  could cover any of it (no fee balance, no insurance and no
  socialization); the program fails with `NOTHING_RESOLVED` when the bad
  debt does not fall.
- `setRiskParams({ market, authority, socializeCapBps, ifEpochBudgetBps,
  bankruptLiqRewardBps })` is for the market authority. `socializeCapBps`
  is at most the gap between initial and maintenance margin, and
  `bankruptLiqRewardBps` at most the liquidation fee
  (`perpRiskParamsProblem`).

`getFees(market)` returns the fee and insurance balances; `state.risk`
(from `getMarket`) holds the parameters and the epoch counters. The LOSS
(type 19) and INSURANCE (type 20) events report every draw and deposit.

## Cross margin

A seat linked into a margin account (`seat.cross`) is margined on the
account's sums across up to eight markets that share one quote vault. The
program needs the account's **margin record** in every transaction that
takes a margin decision about the seat, otherwise it fails with
`MARGIN_ACCOUNT_MISSING`. The record names every link in the account's
order, with that market's seat arena and oracle feed.

You do not handle this yourself: `seatContext` finds the seat's account and
every builder that acts on the seat adds it. The margin record comes first
(index 0). The account, the other linked markets' seat arenas and every
linked market's feed are added read-only. In detail:

- a liquidation of a cross target carries the target's record (index 0),
  and a cross liquidator's own record goes at index 1;
- link and unlink write the margin account;
- `marginTransferTx` writes both seat arenas.

With the low-level builders, pass `{ margin: perpCrossAccountRef(address,
parsedAccount, deployment.markets) }`.

A cross seat's balance can go negative. Use `perpCrossTotals`,
`perpCrossWithdrawable` and `perpCrossLiquidationTotals` over the account's
seats for its numbers. Per-seat margin figures of a cross seat are partial.

## Funding

Funding moves quote between longs and shorts every hour through a
cumulative index per lot. Seats settle lazily.

**You never need to settle before trading or withdrawing.** The program
settles a seat itself before it reads the seat's equity: orders,
withdrawals (`token_withdraw` settles first, then checks free margin),
liquidations and links. For a cross seat, the other linked seats are valued
settled.

`settleFunding` and `settleAccountFunding` only bring the stored balance up
to date, for example before you display it. Settling is permissionless and
any seat can be settled.

To compute the settled value without a transaction, use
`perpSettleFunding(market, seat)`. `fundingUpdateTx` is the crank, which
nobody else can share a transaction with.

## State units

A transaction pays state units for the account growth it causes. An order
that rests outside a side's current level range grows that cbook.
`placeOrder`, `placeOrders` and `ordersTx` with a book read
(`readOrderBookState`) request exactly what `estimatePerpOrderStateUnits`
computes. A transaction that asks for too few units fails as a whole with
`SU_EXHAUSTED`. The margin record adds no units.

## Signers

| Signer | Use |
| --- | --- |
| `createKeypairSigner({ address, privateKey })`, `keypairSignerFromJSON({ address, privateKeyHex })` | Bots, agents and scripts. The key is the fee payer. Nonce, start slot and chain id come from a per-client cache, so the next transaction needs no reads after a confirmed one. |
| `createWalletSigner({ wallet, walletAddress })` | Browser wallets. `wallet` is anything with `getSigningContext()` and `signTransaction(intent)` (`@thru/wallet`'s `IThruChain`). The wallet's managed fee payer pays and the perp program goes first among the read-only accounts. |
| `createSessionSigner({ session, wallet })` | A `@thru/wallet` signing session. Its key signs without a prompt per transaction until it expires. |

A custom signer implements `{ kind, address, sign({ thru, programAddress,
tx, fresh }) => { raw, nonceCached?, confirmed?, failed? } }`, and optionally
`prepare(thru)` (start the reads `sign` needs) and `invalidate(thru)`.

## Sending and errors

`client.send(tx, signer)` and the lower-level `sendAndConfirm(thru, raw,
label)` use the fast confirm path:

- One `sendAndTrack` stream carries the transaction. The RPC subscribes
  before it forwards the bytes, so the execution result arrives as soon as
  it exists.
- A fallback status poll starts after 1.5 s.
- If the stream fails before the node acknowledged anything, the identical
  bytes are resent once. Nothing is ever re-signed, so an order cannot be
  placed twice.
- A nonce the cache had wrong (`NONCE_TOO_LOW` or `NONCE_TOO_HIGH`: nothing
  executed) is retried once with a freshly read nonce.

`client.send` goes through `submitPerpTransaction(thru, signer, { programAddress,
tx }, options)`, which you can call directly. Before signing, the signer's
header reads, `options.checkChain` (for example a chain id check over
`rpcChainId`, read once per client) and, with `options.archived`, the state
compression status reads of every account the transaction touches run in
parallel. Archived accounts are restored first, after the chain check and
signed by `options.archived.signer`; a restore moves the fee payer's nonce,
so it is read again. An executed transaction refreshes the cached statuses
of its accounts, a failed one drops them (`noteAccountsActive`,
`forgetAccountStatuses`).

`@thru/programs/perps/testing` exports `simulatedRpc`, a client stand-in
with modelled latency (and archived accounts) for testing code that sends
perp transactions under fake timers.

Failures throw `TransactionFailedError` with:

- `code`: the `errors.h` name, e.g. `ORACLE_STALE`;
- `kind`: see the table below;
- `userErrorCode`, the signed code;
- `vmError` and `vmErrorName`, e.g. `SU_EXHAUSTED`;
- `retryable`;
- `toJSON()`.

A missing result throws `TransactionTimeoutError`. Look the signature up
before you send again.

| `kind` | Codes | What to do |
| --- | --- | --- |
| `insufficient-margin` | `INSUFFICIENT_COLLATERAL` (-403), `INSUFFICIENT_FUNDS_QUOTE` (-401) | Deposit, or reduce the size or the withdrawal. |
| `oracle` | `ORACLE_MISSING` (-210), `ORACLE_MISMATCH` (-211), `ORACLE_INVALID` (-212), `ORACLE_STALE` (-213) | Wait for the feed (stale), or fix the account list. |
| `state-units` | VM `SU_EXHAUSTED` (-763) | Rebuild with a fresh book read (`placeOrder` does). |
| `nonce` | VM `NONCE_TOO_LOW` (-511), `NONCE_TOO_HIGH` (-510) | Retried once by `send`. |
| `market-status` | `MARKET_DEPOSITS_FROZEN` (-501), `MARKET_WITHDRAWALS_FROZEN` (-502), `MARKET_PAUSED` (-503), `MARKET_POSTONLY_MODE` (-504) | Wait, or post only. |
| `margin-account` | `MARGIN_ACCOUNT_MISSING` (-220), `MARGIN_LINK_MISMATCH` (-221), `MARGIN_LINK_LIMIT` (-222), `MARGIN_ALREADY_LINKED` (-223), `MARGIN_VAULT_MISMATCH` (-224), `MARGIN_SEAT_NOT_FLAT` (-225), `MARGIN_ACCOUNT_INVALID` (-226) | Use the client builders: they read the account. A vault mismatch means the market is not on the account's vault. |
| `invalid-order` | `INDIVISIBLE_PRICE_TICKS` (-201), `INDIVISIBLE_QTY_LOTS` (-202), `OVER_MAX_PRICE` (-203), `PRICE_ABOVE_CAP` (-205), `MODIFY_INCREASE_NOT_ALLOWED` (-304), `CBOOK_FULL` (-306), `ARENA_FULL` (-607), `ARITH_OVERFLOW` (-209) | Fix the order. |
| `position-limit` | `POSITION_LIMIT` (-208) | Reduce the size. |
| `order-not-found` | `ORDER_ID_NOT_FOUND` (-302), `CLIENT_ID_NOT_FOUND` (-303), `ARENA_ENTRY_NOT_ACTIVE` (-606), `GTT_ORDER_EXPIRED` (-301) | The order already filled or was cancelled. |
| `funding` | `FUNDING_DISABLED` (-217), `INVALID_FUNDING_PARAMS` (-218), `FUNDING_UPDATE_NOT_ALONE` (-219) | |
| `liquidation` | `NOT_LIQUIDATABLE` (-215), `SELF_LIQUIDATION` (-216) | |
| `unauthorized` | `UNAUTHORIZED_SEAT_AUTH` (-901), `MARGIN_UNAUTHORIZED` (-227), ... | Sign as the owner. |
| `seat` | `SEAT_NOT_FOUND` (-601), `SEAT_ARENA_FULL` (-603), `FEE_SEAT` (-232) | Create a seat. A fee seat only withdraws. |
| `fees` | `FEE_PARAM_INVALID` (-231), `BUILDER_INVALID` (-233), `FEE_CLAIM_BLOCKED` (-234) | Check the builder code (a fee seat of another wallet in this market, at most 1%), the rates, or the market's bad debt. |
| `loss-waterfall` | `NOTHING_RESOLVED` (-229), `RISK_PARAM_INVALID` (-230) | |

`PERP_ERROR_CODES` holds the full table, which a test checks against
`errors.h`. The helpers are `perpErrorName(code)`, `perpErrorText(code)` and
`perpVmErrorName(vmError)`.

## Units

On chain, everything is an integer:

- a price is quote atoms per base atom, on the tick grid;
- a quantity is base atoms, on the lot grid;
- positions and orders are stored in lots.

The helpers:

- `perpPriceToTicks` / `perpTicksToPrice`
- `perpSizeToLots` / `perpLotsToSize`
- `perpRoundPrice`
- `parsePerpPrice('84250.5', market, rounding?)` and
  `parsePerpSize('0.25', market, rounding?)`, which take a deployment
  market record
- `formatPerpPrice` / `formatPerpSize`
- `parseUnits` / `formatUnits`

## Agents

```ts
import { describePerpsActions, perpsToolDefinitions, runPerpsAction } from '@thru/programs/perps';

describePerpsActions();  // [{ name, kind: 'read' | 'transaction', description, parameters: JSON Schema }]
perpsToolDefinitions();  // [{ name: 'perps_placeOrder', description, input_schema }] for an LLM's tools
await runPerpsAction(client, 'placeOrder', { market: 'BTC-UUSD', owner, side: 'buy', price: '84000', size: '0.01' }, { signer });
// { ok: true, result: { signature, label, meta } } or { ok: false, error: { message, kind, code, retryable } }
```

The actions:

- have their params validated against the schema (unknown keys are
  refused);
- return JSON-safe output, with bigints as strings.

A transaction action returns the unsigned transaction when no signer is
given. See `examples/agent-tools.ts`.

## ABI evolution

The SDK decodes with the program's latest ABI only. There are no version
catalogs, feature flags or program-hash detection. Byte 0 of every account
the program owns is a one-byte discriminator, and a deployed layout is
never edited in place: a changed layout or a new kind of account takes the
next unused discriminator value, so the latest bindings decode every
account from its bytes alone.

## Low-level builders

The client's builders sit on plain functions you can use with your own
reads. Each takes a `MarketRef` (`{ deployment: { exchangeMeta,
tokenProgram }, market: { seatArena, orderArena, bidsCbook, asksCbook,
quoteVault, oracleFeed } }`):

- `ordersTx`, `cancelOrdersTx`, `modifyOrderTx`
- `depositTx`, `withdrawTx`
- `liquidateTx`
- `seatCreateTx`
- `marginAccountCreateTx`, `marginLinkTx`, `marginTransferTx`,
  `withMarginRecord`
- `settleFundingTx`, `settleAccountFundingTx`, `fundingUpdateTx`
- fees and builder codes: `seatSetFeeReceiverTx`, `seatSetBuilderApprovalTx`,
  `marketSetFeesTx`, `feeClaimTx`
- loss waterfall: `insuranceDepositTx`, `resolveBadDebtTx`,
  `marketSetRiskParamsTx`
- admin: `setFundingTx`, `marketSetStatusTx`, `marketSetCrossTx`,
  `marketSetVaultTx`, `exchangeSetStatusTx`

Each returns a `PerpTransaction`:

- `instructions` is JSON specs (`PerpInstructionSpec`);
- `readWrite` / `readOnly` are the account lists;
- `stateUnits` is set when known;
- `instructionData` is an encoder that `@thru/sdk`'s `transactions.build`
  takes.

Related helpers:

- `encodePerpTransaction(tx, feePayer, program)` gives the bytes and account
  order that a key signs.
- `perpTransactionFromJSON` rebuilds a transaction from its JSON.
- Below these are the instruction encoders `createPerp*Instruction`, the
  account parsers `parsePerp*`, the event parser `parsePerpEvent` and the
  margin math (`perpEquity`, `perpFreeCollateral`, `perpCrossTotals`, ...).

## Examples

- [`examples/read-book.ts`](./examples/read-book.ts): read-only; every
  market's mark, funding, fees and top of book (no key needed).
- [`examples/place-and-cancel.ts`](./examples/place-and-cancel.ts): creates
  the key's accounts and a seat if needed, places a post-only bid, lists it
  and cancels it.
- [`examples/market-maker-bot.ts`](./examples/market-maker-bot.ts): a
  two-sided quoter that replaces its quotes atomically and handles errors by
  `kind`.
- [`examples/agent-tools.ts`](./examples/agent-tools.ts): the actions as LLM
  tools.
- [`examples/builder-code.ts`](./examples/builder-code.ts): a builder
  registers its code, a trader approves it and sends a coded order, the
  builder reads and withdraws its earnings (two keys,
  `PERPS_BUILDER_KEY_FILE` and `PERPS_KEY_FILE`).
- [`examples/keeper.ts`](./examples/keeper.ts): a permissionless keeper that
  cranks funding when it is due and liquidates isolated seats below their
  maintenance margin into its own seat.

Run them with `npx tsx <file>`, with `PERPS_DEPLOYMENT`, `PERPS_KEY_FILE`
and, optionally, `PERPS_INDEXER_URL` set.
