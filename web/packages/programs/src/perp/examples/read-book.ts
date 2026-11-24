/* Read-only: every market's mark, funding, fees and top of book.  No key
   needed.

     PERPS_DEPLOYMENT=deployment.betanet.json npx tsx read-book.ts [DEPTH]

   With PERPS_INDEXER_URL set, reads go through the perps indexer and fall
   back to RPC on any indexer failure. */

import { readFileSync } from 'node:fs';
import { createPerpsClient, formatPerpPrice } from '@thru/programs/perps';

const deployment = JSON.parse(readFileSync(process.env.PERPS_DEPLOYMENT ?? 'deployment.betanet.json', 'utf8'));
const perps = await createPerpsClient({ deployment, indexerUrl: process.env.PERPS_INDEXER_URL });
const depth = Number(process.argv[2] ?? 5);

console.log(`program ${perps.programAddress}`);
for (const { symbol } of perps.deployment.markets) {
  const record = perps.market(symbol);
  const { mark, stale, error } = await perps.getMark(symbol);
  const funding = await perps.getFunding(symbol);
  console.log(`\n${symbol}: mark ${mark === null ? `none (${error})` : formatPerpPrice(mark, record)}${stale ? ' (stale)' : ''}`);
  if (funding.enabled && funding.funding) {
    console.log(`  funding rate ${funding.funding.rate} ticks of 1e-6 per hour (positive: longs pay), next round ${new Date(Number(funding.nextRoundNs! / 1_000_000n)).toISOString()}`);
  }
  const { rates } = await perps.getFees(symbol);
  console.log(`  fees (ppm): taker ${rates.takerFeePpm}, maker rebate ${rates.makerRebatePpm}, builder cap ${rates.builderFeeCapPpm}`);
  const book = await perps.getBook(symbol, depth);
  for (const level of [...book.asks].reverse()) console.log(`  ask ${formatPerpPrice(level.price, record).padStart(14)}  ${level.lots} lot(s), ${level.orderCount} order(s)`);
  console.log('  ' + '-'.repeat(40));
  for (const level of book.bids) console.log(`  bid ${formatPerpPrice(level.price, record).padStart(14)}  ${level.lots} lot(s), ${level.orderCount} order(s)`);
}
