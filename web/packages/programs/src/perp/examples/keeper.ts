/* A permissionless keeper: cranks funding when a premium sample or an
   hourly round is due, and liquidates isolated seats below their
   maintenance margin.  Anyone may run one; the venue's own keeper does the
   same (web/perps/tools market-maker with MM_LEVELS=0).

     PERPS_DEPLOYMENT=deployment.betanet.json PERPS_KEY_FILE=keeper.json \
       npx tsx keeper.ts [INTERVAL_SECONDS]

   PERPS_KEY_FILE is { "address": "ta...", "privateKeyHex": "..." }.  The
   funding crank needs only a fee payer.  A liquidation moves the target's
   position into the keeper's own seat in that market (with the
   liquidation fee as reward), so the keeper needs a seat with enough
   collateral to margin it there; without one it only cranks funding.
   Cross seats are left out here: see perpCrossIsLiquidatable and the
   client's liquidate, which adds their margin records. */

import { readFileSync } from 'node:fs';
import {
  TransactionFailedError,
  createPerpsClient,
  formatPerpPrice,
  fundingUpdateTx,
  keypairSignerFromJSON,
  parsePerpSeatArenaAccount,
  perpFundingEnabled,
  perpFundingRoundDue,
  perpFundingSampleDue,
  perpIsLiquidatable,
  perpSettleFunding,
  readAccount,
} from '@thru/programs/perps';

const deployment = JSON.parse(readFileSync(process.env.PERPS_DEPLOYMENT ?? 'deployment.betanet.json', 'utf8'));
const signer = keypairSignerFromJSON(JSON.parse(readFileSync(process.env.PERPS_KEY_FILE ?? 'keeper.json', 'utf8')));
const perps = await createPerpsClient({ deployment });
const intervalMs = Number(process.argv[2] ?? 10) * 1000;
const keeper = signer.address;

async function tick(symbol: string): Promise<void> {
  const record = perps.market(symbol);
  const { state } = await perps.getMarket(symbol, { source: 'rpc' });
  const { mark, error } = await perps.getMark(symbol);
  if (mark === null) {
    console.log(`${symbol}: no mark (${error}); nothing to do until the feed is fresh`);
    return;
  }

  /* Funding: the program refuses the crank unless a sample or a round is due. */
  const nowNs = BigInt(Date.now()) * 1_000_000n;
  if (perpFundingEnabled(state) && (perpFundingRoundDue(state.funding, nowNs) || perpFundingSampleDue(state.funding, nowNs))) {
    const { signature } = await perps.send(fundingUpdateTx(perps.marketRef(symbol, state)), signer);
    console.log(`${symbol}: funding update ${signature}`);
  }

  /* Liquidations: the program settles funding before its check, so do the same. */
  const own = await perps.getSeat(symbol, keeper, { source: 'rpc' });
  if (!own || own.feeReceiver) return;
  const arena = parsePerpSeatArenaAccount(await readAccount(perps.thru, record.seatArena));
  for (const raw of arena.seats) {
    const seat = perpSettleFunding(state, raw).seat;
    if (seat.cross || seat.seatIndex === own.seatIndex || !perpIsLiquidatable(state, seat, mark)) continue;
    try {
      const { signature } = await perps.send(await perps.liquidate({ market: symbol, owner: keeper, targetSeatIndex: seat.seatIndex }), signer);
      console.log(`${symbol}: liquidated seat #${seat.seatIndex} at mark ${formatPerpPrice(mark, record)}: ${signature}`);
    } catch (failure) {
      /* Someone else got there first, or the keeper's seat cannot margin it. */
      if (!(failure instanceof TransactionFailedError)) throw failure;
      console.log(`${symbol}: seat #${seat.seatIndex} not liquidated: ${failure.code ?? failure.vmErrorName} (${failure.kind})`);
    }
  }
}

for (;;) {
  for (const { symbol } of perps.deployment.markets) {
    try {
      await tick(symbol);
    } catch (failure) {
      console.error(`${symbol}: ${failure instanceof Error ? failure.message : String(failure)}`);
    }
  }
  await new Promise((resolve) => setTimeout(resolve, intervalMs));
}
