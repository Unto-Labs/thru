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
- [Clients and deployments](#clients-and-deployments)
- [Reading](#reading)
- [Actions](#actions)
- [Cross margin](#cross-margin)
- [Funding](#funding)
- [State units](#state-units)
- [Signers](#signers)
- [Sending and errors](#sending-and-errors)
- [Units](#units)
- [Agents](#agents)
- [ABI versions and feature flags](#abi-versions-and-feature-flags)
- [Low-level builders](#low-level-builders)
- [Examples](#examples)

## Quickstart

```ts
import { readFileSync } from 'node:fs';
import { createPerpsClient, keypairSignerFromJSON } from '@thru/programs/perps';

const perps = await createPerpsClient({
  deployment: JSON.parse(readFileSync('deployment.betanet.json', 'utf8')),
  indexerUrl: 'https://perps-api.example.org', // optional
});
const signer = keypairSignerFromJSON(JSON.parse(readFileSync('key.json', 'utf8')));
const owner = signer.address;

await perps.send(await perps.createSeat({ market: 'BTC-THRUSD', owner }), signer);
await perps.send(await perps.deposit({ market: 'BTC-THRUSD', owner, amount: '1000' }), signer);

const order = await perps.placeOrder({ market: 'BTC-THRUSD', owner, side: 'buy', price: '84000', size: '0.01', postOnly: true });
console.log(order.meta); // { action, seatIndex, cross, marginAccount, stateUnits, abiVersion, ... }
const { signature } = await perps.send(order, signer);

await perps.send(await perps.cancelAll({ market: 'BTC-THRUSD', owner }), signer);
```

Every builder returns `{ transaction, meta }`:

- `transaction` is an unsigned `PerpTransaction`: the instruction specs, the
  read-write and read-only accounts, and the state units to request. Its
  JSON form is `perpTransactionToJSON`.
- `meta` says which seat it uses, whether the seat is cross, which margin
  account it carries and which ABI version it targets.

`send(tx, signer)` signs the transaction, sends it and resolves when it has
executed.

## Clients and deployments

```ts
createPerpsClient({
  deployment,        // a record object, a registered network name, an http(s) URL of the JSON, or the JSON text
  network,           // shorthand for deployment: '<name>' (registerPerpsDeployment first)
  thru, rpcUrl,      // an existing @thru/sdk client, or an RPC URL (default: the record's rpcUrl)
  indexerUrl,        // the perps indexer API, or an app origin that proxies its /v1 routes
  indexer,           // { headers, timeoutMs, fetch } for the indexer
  abiVersion,        // skip detection: a PerpAbiVersion or '0.4.0'
  assumeLatest,      // unknown program hash and no ABI account: assume the latest version (default true)
  marginAccountIds,  // ids searched for an owner's margin accounts over RPC (default 0..3)
});
```

The deployment record is the JSON that the perps tools' `deploy` writes
(`web/perps/deployment.<network>.json`): the program, exchange meta, token
and oracle programs, quote mints and markets.

- `loadPerpsDeployment(source)` validates a record and
  `registerPerpsDeployment(record)` registers one under its network name.
- `PERPS_NETWORK_RPC_URLS` lists the public RPC endpoints.

The client detects the deployment's ABI version when it connects (see
[ABI versions](#abi-versions-and-feature-flags)). The result is in
`client.version`, `client.features` and `client.versionDetection`.

## Reading

| Method | Returns |
| --- | --- |
| `getMarkets()` / `getMarket(market)` | `{ symbol, address, record, state: PerpMarket }` |
| `getBook(market, depth = 20)` | `{ bids, asks }` levels: `price` (quote atoms per base atom), `priceTicks`, `lots`, `quantity`, `orderCount` |
| `getMark(market)` | `{ mark, feedPrice, exponent, lastUpdateNs, maxAgeNs, stale, error }`; `mark` is null with an `error` when the feed gives none: wrong type or exponent, or `stale` by the program's rule (older than the market's `maxMarkAgeNs`, else the feed's `maxStalenessNs`, or stamped in the future: what the program rejects as ORACLE_STALE) |
| `getFunding(market)` | `{ supported, enabled, funding: PerpFunding, nextRoundNs }` |
| `getSeat(market, owner)` | `PerpSeatEntry` or null |
| `getMarginAccounts(owner)` | the owner's margin accounts: `{ address, accountId, owner, vault, links }` |
| `getOpenOrders(market, owner)` | `{ orderId, orderEntryIndex, side, price, priceTicks, lots, quantity, clientIdHex, expirationTime }` |

`market` is a symbol (case-insensitive) or the seat arena address.

With `indexerUrl`, reads go to the indexer (`/v1/markets/...`,
`/v1/owners/...`). Any indexer failure falls back to RPC, and RPC reads
decode accounts with the deployment's ABI version. The results are the same
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
| `placeOrder` | `market, owner, side, orderType?, postOnly?, price \| priceAtoms, size \| quantityAtoms \| lots, clientId?, rounding?` | `orderType`: `gtc` (default), `ioc`, `fok`, `alo` (post-only), `mtl`. Requests the state units the order needs. |
| `placeOrders` | `market, owner, orders[], cancels?[]` | Cancels first, then orders, in one atomic transaction. |
| `cancel` | `market, owner, orderId, orderEntryIndex?` | Looks up the entry index when it is not given. |
| `cancelAll` | `market, owner` | Every resting order of the seat. |
| `modify` | `market, owner, orderId, size \| quantityAtoms \| lots` | Can only reduce an order. |
| `deposit` / `withdraw` | `market, owner, amount \| amountAtoms` | Moves funds between the owner's canonical token account for the quote mint and the market's current vault. |
| `createMarginAccount` | `market, owner, accountId?` | On the market's quote vault. |
| `linkMargin` / `unlinkMargin` | `market, owner, accountId?` | Makes the seat cross, or isolated again (only a flat seat with a nonnegative balance). |
| `settleFunding` | `market, seatIndexes? \| owner` | Optional (see [Funding](#funding)). |
| `settleAccountFunding` | `owner, marginAccount?` | Every linked seat of the account. |
| `liquidate` | `market, owner, targetSeatIndex` | The owner's seat takes the target's position. Cross targets and cross liquidators get their margin records. |

Prices and sizes take either human units or atoms, never both:

- `price` is quote per base unit, as a string (`"84250.5"`);
- `priceAtoms` is quote atoms per base atom;
- `size` is base units, as a string;
- `quantityAtoms` is base atoms;
- `lots` is a number of lots.

A value off the tick or lot grid fails unless you pass `rounding: 'down' |
'up' | 'nearest'`.

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
| `seat` | `SEAT_NOT_FOUND` (-601), `SEAT_ARENA_FULL` (-603) | Create a seat. |

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

describePerpsActions(client);  // [{ name, kind: 'read' | 'transaction', description, parameters: JSON Schema, requires? }]
perpsToolDefinitions(client);  // [{ name: 'perps_placeOrder', description, input_schema }] for an LLM's tools
await runPerpsAction(client, 'placeOrder', { market: 'BTC-THRUSD', owner, side: 'buy', price: '84000', size: '0.01' }, { signer });
// { ok: true, result: { signature, label, meta } } or { ok: false, error: { message, kind, code, retryable } }
```

The actions:

- are filtered to what the deployment's ABI version supports;
- have their params validated against the schema (unknown keys are
  refused);
- return JSON-safe output, with bigints as strings.

A transaction action returns the unsigned transaction when no signer is
given. See `examples/agent-tools.ts`.

## ABI versions and feature flags

Each program release has its own ABI version: `perp-abi@0.2.0`, `0.3.0` and
`0.4.0`. Each version has its own decoders into one domain model, and its
own feature flags:

- `oracleMargin`
- `liquidation`
- `funding`
- `settleFunding`
- `crossMargin`
- `sharedVaults`
- `crossUpnlHaircut`

The version is detected from the program code hash first and the on-chain
ABI account second. Gate UI on `client.features`. Builders refuse an
instruction the version lacks.

[VERSIONS.md](./VERSIONS.md) covers the registry and detection, and how to
add a version.

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

- [`examples/place-and-cancel.ts`](./examples/place-and-cancel.ts): creates a
  seat if needed, places a post-only bid, lists it and cancels it.
- [`examples/market-maker-bot.ts`](./examples/market-maker-bot.ts): a
  two-sided quoter that replaces its quotes atomically and handles errors by
  `kind`.
- [`examples/agent-tools.ts`](./examples/agent-tools.ts): the actions as LLM
  tools.

Run them with `npx tsx <file>`, with `PERPS_DEPLOYMENT`, `PERPS_KEY_FILE`
and, optionally, `PERPS_INDEXER_URL` set.
