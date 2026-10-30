/* A minimal two-sided quoter: every few seconds it replaces its bid and ask
   around the oracle mark in one atomic transaction (cancels, then posts).

     PERPS_DEPLOYMENT=deployment.betanet.json PERPS_KEY_FILE=key.json \
       npx tsx market-maker-bot.ts BTC-THRUSD [SPREAD_BPS=20] [LOTS=1]

   It works the same on an isolated or a cross-margined seat: the client
   adds the margin record when the seat is cross.  Failures are handled by
   kind: a stale oracle or a frozen market waits, anything else stops. */

import { readFileSync } from 'node:fs';
import {
  TransactionFailedError,
  createPerpsClient,
  formatPerpPrice,
  keypairSignerFromJSON,
  perpRoundPrice,
  type PerpsOrderParams,
} from '@thru/programs/perps';

const [market = 'BTC-THRUSD', spreadArg = '20', lotsArg = '1'] = process.argv.slice(2);
const spreadBps = BigInt(spreadArg);
const deployment = JSON.parse(readFileSync(process.env.PERPS_DEPLOYMENT ?? 'deployment.betanet.json', 'utf8'));
const signer = keypairSignerFromJSON(JSON.parse(readFileSync(process.env.PERPS_KEY_FILE ?? 'key.json', 'utf8')));
const perps = await createPerpsClient({ deployment, indexerUrl: process.env.PERPS_INDEXER_URL });
const record = perps.market(market);
const tick = BigInt(record.tickSize);
const owner = signer.address;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

if (!(await perps.getSeat(market, owner))) await perps.send(await perps.createSeat({ market, owner }), signer);

for (;;) {
  try {
    const { mark, error } = await perps.getMark(market);
    if (mark === null) {
      console.log(`no mark (${error}); waiting`);
      await sleep(5_000);
      continue;
    }
    const half = (mark * spreadBps) / 20_000n;
    const quotes: PerpsOrderParams[] = [
      { side: 'buy', priceAtoms: perpRoundPrice(mark - half, tick, 'down'), lots: lotsArg, postOnly: true },
      { side: 'sell', priceAtoms: perpRoundPrice(mark + half, tick, 'up'), lots: lotsArg, postOnly: true },
    ];
    const open = await perps.getOpenOrders(market, owner);
    const built = await perps.placeOrders({
      market,
      owner,
      orders: quotes,
      cancels: open.map((order) => ({ orderId: order.orderId, orderEntryIndex: order.orderEntryIndex })),
    });
    const { signature } = await perps.send(built, signer);
    console.log(`quoted ${formatPerpPrice(BigInt(quotes[0]!.priceAtoms!), record)} / ${formatPerpPrice(BigInt(quotes[1]!.priceAtoms!), record)} (replaced ${open.length}) ${signature}`);
  } catch (error) {
    if (error instanceof TransactionFailedError && (error.kind === 'oracle' || error.kind === 'market-status')) {
      console.log(`${error.code}: ${error.message}; waiting`);
    } else if (error instanceof TransactionFailedError && error.kind === 'invalid-order' && error.code === 'MARKET_POSTONLY_MODE') {
      console.log('market is post-only; quotes are post-only already, retrying');
    } else {
      throw error;
    }
  }
  await sleep(5_000);
}
