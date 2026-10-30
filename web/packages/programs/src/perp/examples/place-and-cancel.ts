/* Place a post-only bid 2% under the mark, list it, cancel it.

     PERPS_DEPLOYMENT=deployment.betanet.json PERPS_KEY_FILE=key.json \
       npx tsx place-and-cancel.ts [MARKET]

   PERPS_KEY_FILE is { "address": "ta...", "privateKeyHex": "..." } (the
   perps tools' key file format); the key pays for its transactions and
   needs quote collateral in the market (deposit) to post. */

import { readFileSync } from 'node:fs';
import {
  TransactionFailedError,
  createPerpsClient,
  formatPerpPrice,
  keypairSignerFromJSON,
  perpRoundPrice,
} from '@thru/programs/perps';

const deployment = JSON.parse(readFileSync(process.env.PERPS_DEPLOYMENT ?? 'deployment.betanet.json', 'utf8'));
const signer = keypairSignerFromJSON(JSON.parse(readFileSync(process.env.PERPS_KEY_FILE ?? 'key.json', 'utf8')));
const perps = await createPerpsClient({ deployment, indexerUrl: process.env.PERPS_INDEXER_URL });
const market = process.argv[2] ?? perps.deployment.markets[0]!.symbol;
const record = perps.market(market);
const owner = signer.address;

console.log(`ABI ${perps.version.abiPackageVersion} (${perps.versionDetection?.source}), cross margin: ${perps.features.crossMargin}`);

if (!(await perps.getSeat(market, owner))) {
  const { signature } = await perps.send(await perps.createSeat({ market, owner }), signer);
  console.log(`created a seat in ${market}: ${signature}`);
}

const { mark, error } = await perps.getMark(market);
if (mark === null) throw new Error(`no mark for ${market}: ${error}`);
const price = perpRoundPrice((mark * 98n) / 100n, BigInt(record.tickSize), 'down');

try {
  const built = await perps.placeOrder({ market, owner, side: 'buy', priceAtoms: price, lots: '1', postOnly: true });
  console.log(`placing ${built.transaction.label} (${built.meta.cross ? 'cross' : 'isolated'} seat, ${built.meta.stateUnits ?? 0} state units)`);
  const { signature } = await perps.send(built, signer);
  console.log(`bid at ${formatPerpPrice(price, record)}: ${signature}`);
} catch (error) {
  if (error instanceof TransactionFailedError) {
    console.error(`refused: ${error.code ?? error.vmErrorName} (${error.kind}) ${error.message}`);
    process.exit(1);
  }
  throw error;
}

for (const order of await perps.getOpenOrders(market, owner)) {
  console.log(`open: #${order.orderId} ${order.side} ${order.lots} lot(s) at ${formatPerpPrice(order.price, record)}`);
}
const { signature } = await perps.send(await perps.cancelAll({ market, owner }), signer);
console.log(`cancelled: ${signature}`);
