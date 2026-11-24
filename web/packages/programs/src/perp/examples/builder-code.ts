/* Builder codes end to end: a builder registers its code, a
   trader approves it and sends a coded order, the builder reads and
   withdraws what it earned.

     PERPS_DEPLOYMENT=deployment.betanet.json \
     PERPS_BUILDER_KEY_FILE=builder.json PERPS_KEY_FILE=trader.json \
       npx tsx builder-code.ts [MARKET] [FEE_PPM]

   Two keys in the perps tools' key file format ({ "address": "ta...",
   "privateKeyHex": "..." }): the builder (used only for building: its
   empty seat becomes the fee seat) and a trader with quote collateral in
   the market.  A fresh builder key gets its account and its quote token
   account first (ensurePerpsAccounts): the withdrawal in step 3 pays into
   that token account.  FEE_PPM (default 100 = 0.01%) is capped by the market's
   builderFeeCapPpm, which is 0 until the market authority sets it
   (setFees): with a cap of 0 the code is valid but charges nothing.

   The trader takes 1 lot with an IOC at 1% through the mark, so it fills
   only when the book has an ask (or bid) there. */

import { readFileSync } from 'node:fs';
import {
  TransactionFailedError,
  createPerpsClient,
  ensurePerpsAccounts,
  formatPerpPrice,
  keypairSignerFromJSON,
  perpRoundPrice,
} from '@thru/programs/perps';

const deployment = JSON.parse(readFileSync(process.env.PERPS_DEPLOYMENT ?? 'deployment.betanet.json', 'utf8'));
const builderKey = JSON.parse(readFileSync(process.env.PERPS_BUILDER_KEY_FILE ?? 'builder.json', 'utf8'));
const builderSigner = keypairSignerFromJSON(builderKey);
const traderSigner = keypairSignerFromJSON(JSON.parse(readFileSync(process.env.PERPS_KEY_FILE ?? 'trader.json', 'utf8')));
const perps = await createPerpsClient({ deployment, indexerUrl: process.env.PERPS_INDEXER_URL });
const market = process.argv[2] ?? perps.deployment.markets[0]!.symbol;
const feePpm = Number(process.argv[3] ?? 100);
const record = perps.market(market);
const builder = builderSigner.address;
const trader = traderSigner.address;

await ensurePerpsAccounts(perps, builderKey, { quotes: [record.quoteSymbol] });
const fees = await perps.getFees(market);
console.log(`${market} fees (ppm): taker ${fees.rates.takerFeePpm}, maker rebate ${fees.rates.makerRebatePpm}, builder cap ${fees.rates.builderFeeCapPpm}`);

try {
  /* 1. The builder's code: one fee seat per market. */
  let code = await perps.getBuilderCode(market, builder, { source: 'rpc' });
  if (!code) {
    if (!(await perps.getSeats(market, builder, { source: 'rpc' })).length) {
      await perps.send(await perps.createSeat({ market, owner: builder }), builderSigner);
    }
    const built = await perps.registerBuilderCode({ market, owner: builder });
    await perps.send(built, builderSigner);
    code = await perps.getBuilderCode(market, builder, { source: 'rpc' });
  }
  console.log(`builder code in ${market}: ${code!.seatIndex} (earned so far: ${code!.balance} quote atoms)`);

  /* 2. The trader approves the builder for its resting orders (maker
        fills), then takes 1 lot with the code (a taker fee needs no
        approval: the trader signs the code with the order). */
  await perps.send(await perps.approveBuilder({ market, owner: trader, builder: code!.seatIndex, maxFeePpm: feePpm }), traderSigner);
  const { mark, error } = await perps.getMark(market);
  if (mark === null) throw new Error(`no mark for ${market}: ${error}`);
  const price = perpRoundPrice((mark * 101n) / 100n, BigInt(record.tickSize), 'up');
  const order = await perps.placeOrder({
    market,
    owner: trader,
    side: 'buy',
    priceAtoms: price,
    lots: '1',
    orderType: 'ioc',
    builder: { seatIndex: code!.seatIndex, feePpm },
  });
  const { signature } = await perps.send(order, traderSigner);
  console.log(`coded IOC buy at ${formatPerpPrice(price, record)}: ${signature}`);

  /* 3. The builder reads its earnings and withdraws them. */
  const after = await perps.getBuilderCode(market, builder, { source: 'rpc' });
  console.log(`builder earned ${after!.balance - code!.balance} quote atoms on that order (balance ${after!.balance})`);
  if (after!.balance > 0n) {
    const { signature: withdrawn } = await perps.send(
      await perps.withdraw({ market, owner: builder, amountAtoms: after!.balance, seatIndex: after!.seatIndex }),
      builderSigner,
    );
    console.log(`builder withdrew ${after!.balance} quote atoms: ${withdrawn}`);
  }
} catch (error) {
  if (error instanceof TransactionFailedError) {
    console.error(`refused: ${error.code ?? error.vmErrorName} (${error.kind}) ${error.message}`);
    process.exit(1);
  }
  throw error;
}
