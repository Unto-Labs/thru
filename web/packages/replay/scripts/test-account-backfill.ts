#!/usr/bin/env tsx

/**
 * Test script for the hybrid account backfill flow.
 *
 * The new flow:
 * 1. StreamAccountUpdates starts immediately (concurrent)
 * 2. ListAccounts with META_ONLY view to get addresses (no data)
 * 3. GetAccount for each address (skips if already seen from stream)
 *
 * Key behaviors to test:
 * - Stream events have source="stream" and are yielded immediately
 * - GetAccount events have source="backfill"
 * - Stream updates "win" - addresses seen from stream are skipped in GetAccount
 * - onBackfillComplete fires when the GetAccount queue is drained
 */
import { decodeAddress, encodeAddress } from "@thru/helpers";
import { AccountView, ChainClient, createAccountsByOwnerReplay } from "../src";

const BASE_URL = process.env.GRPC_URL || "https://grpc.alphanet.thruput.org";
const TOKEN_PROGRAM = "taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAKqq";

// Account data sizes from token_program.abi.yaml
const TOKEN_ACCOUNT_SIZE = 73;
const MINT_ACCOUNT_SIZE = 115;

function getAccountType(dataSize: number): string {
  if (dataSize === TOKEN_ACCOUNT_SIZE) return "TokenAccount";
  if (dataSize === MINT_ACCOUNT_SIZE) return "MintAccount";
  return `Unknown(${dataSize})`;
}

async function main(): Promise<void> {
  console.log("=== Hybrid Account Backfill Test ===");
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Token Program: ${TOKEN_PROGRAM}`);
  console.log();
  console.log("Flow: Stream (concurrent) + ListAccounts (META_ONLY) + GetAccount (sequential)");
  console.log("Stream updates 'win' - if seen from stream, GetAccount is skipped");
  console.log();

  const client = new ChainClient({ baseUrl: BASE_URL });

  // Get current height
  const height = await client.getHeight();
  console.log(`Chain height: finalized=${height.finalized}`);
  console.log();

  const tokenProgramBytes = new Uint8Array(decodeAddress(TOKEN_PROGRAM));

  // Test 1: Hybrid backfill for MintAccounts
  console.log("=== Test 1: Hybrid Backfill for MintAccounts (115 bytes) ===");
  console.log("Will stop after 20 accounts or 30 seconds.");
  console.log();

  try {
    let backfillQueueDrained = false;
    let highestBackfillSlot = 0n;

    const stream = createAccountsByOwnerReplay({
      client,
      owner: tokenProgramBytes,
      dataSizes: [MINT_ACCOUNT_SIZE],
      view: AccountView.FULL,
      pageSize: 10,
      maxRetries: 3,
      onBackfillComplete: (slot) => {
        backfillQueueDrained = true;
        highestBackfillSlot = slot;
        console.log();
        console.log(`>>> BACKFILL QUEUE DRAINED at slot ${slot} <<<`);
        console.log(">>> Continuing to stream live updates... <<<");
        console.log();
      },
    });

    let backfillCount = 0;  // source="backfill"
    let streamCount = 0;    // source="stream"
    let withDataCount = 0;
    let withoutDataCount = 0;
    const startTime = Date.now();

    for await (const event of stream) {
      if (event.type === "account") {
        const account = event.account;
        const accountType = getAccountType(account.meta.dataSize);
        const hasData = account.data.length > 0;

        // Track by source (the authoritative indicator)
        if (account.source === "backfill") {
          backfillCount++;
        } else if (account.source === "stream") {
          streamCount++;
        }

        if (hasData) {
          withDataCount++;
        } else {
          withoutDataCount++;
        }

        const queueStatus = backfillQueueDrained ? "QUEUE_DRAINED" : "BACKFILLING";
        console.log(
          `[${account.source.toUpperCase()}] [${queueStatus}] [${accountType}] ${encodeAddress(account.address).slice(0, 20)}...`
        );
        console.log(
          `  slot=${account.slot} seq=${account.seq}`
        );
        console.log(`  dataLen=${account.data.length} hasData=${hasData}`);

        // Parse mint data if available
        if (hasData && account.data.length >= 115) {
          const data = account.data;
          const decimals = data[0];
          const supply = new DataView(
            data.buffer,
            data.byteOffset + 1,
            8
          ).getBigUint64(0, true);
          const tickerLen = data[105];
          const ticker = new TextDecoder().decode(
            data.slice(106, 106 + tickerLen)
          );
          console.log(`  Parsed: decimals=${decimals} supply=${supply} ticker="${ticker}"`);
        } else if (!hasData) {
          console.log(`  WARNING: No data returned for this account!`);
        }
        console.log();

        // Stop after enough accounts
        const totalCount = backfillCount + streamCount;
        if (totalCount >= 20) {
          console.log(`(stopped after ${totalCount} accounts)`);
          break;
        }
      } else if (event.type === "blockFinished") {
        console.log(`[BlockFinished] slot=${event.block.slot}`);
      }

      // Timeout
      if (Date.now() - startTime > 30000) {
        console.log("(30s timeout reached)");
        break;
      }
    }

    const elapsed = Date.now() - startTime;
    console.log();
    console.log("--- Summary ---");
    console.log(`Backfill accounts (source=backfill): ${backfillCount}`);
    console.log(`Stream accounts (source=stream): ${streamCount}`);
    console.log(`With data: ${withDataCount}`);
    console.log(`Without data: ${withoutDataCount}`);
    console.log(`Highest backfill slot: ${highestBackfillSlot}`);
    console.log(`Elapsed: ${elapsed}ms`);

    if (withoutDataCount > 0 && withDataCount === 0) {
      console.log();
      console.log("FAIL: No accounts returned with data!");
      process.exitCode = 1;
    } else if ((backfillCount > 0 || streamCount > 0) && withDataCount > 0) {
      console.log();
      console.log("PASS: Accounts returned with data!");
      if (streamCount > 0) {
        console.log("NOTE: Some accounts came from stream (concurrent delivery working)");
      }
    }
  } catch (error) {
    console.error("Backfill failed:", error);
    process.exitCode = 1;
  }

  console.log();

  // Test 2: Resumable backfill with minUpdatedSlot
  console.log("=== Test 2: Resumable backfill with minUpdatedSlot ===");
  console.log("Testing resume from a checkpoint slot.");
  console.log();

  try {
    // Use a recent slot as the "checkpoint" (ensure non-negative)
    const finalized = BigInt(height.finalized);
    const minSlot = finalized > 100n ? finalized - 100n : 1n;
    console.log(`Using minUpdatedSlot=${minSlot} (resuming from ~100 slots ago)`);
    console.log();

    let backfillQueueDrained = false;

    const stream = createAccountsByOwnerReplay({
      client,
      owner: tokenProgramBytes,
      dataSizes: [MINT_ACCOUNT_SIZE],
      view: AccountView.FULL,
      minUpdatedSlot: minSlot,
      pageSize: 10,
      onBackfillComplete: (slot) => {
        backfillQueueDrained = true;
        console.log();
        console.log(`>>> RESUMABLE BACKFILL QUEUE DRAINED at slot ${slot} <<<`);
        console.log();
      },
    });

    let count = 0;
    let backfillCount = 0;
    let streamCount = 0;
    const startTime = Date.now();

    for await (const event of stream) {
      if (event.type === "account") {
        const account = event.account;

        if (account.source === "backfill") {
          backfillCount++;
        } else {
          streamCount++;
        }

        console.log(
          `[${account.source.toUpperCase()}] ${encodeAddress(account.address).slice(0, 20)}... slot=${account.slot} dataLen=${account.data.length}`
        );

        count++;
        if (count >= 10) {
          console.log(`(stopped after ${count} accounts)`);
          break;
        }
      }

      if (Date.now() - startTime > 20000) {
        console.log("(20s timeout reached)");
        break;
      }
    }

    console.log();
    console.log(`Received ${count} accounts (backfill=${backfillCount}, stream=${streamCount}) updated since slot ${minSlot}`);
  } catch (error) {
    console.error("Resumable backfill failed:", error);
  }

  console.log();
  console.log("=== Tests completed ===");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exitCode = 1;
});
