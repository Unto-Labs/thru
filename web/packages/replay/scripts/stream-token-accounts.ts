#!/usr/bin/env tsx

/**
 * Test script for streaming all token program accounts using createAccountsByOwnerReplay.
 *
 * This demonstrates streaming:
 * - TokenAccount (73 bytes) - token holdings
 * - TokenMintAccount (115 bytes) - mint definitions
 *
 * All accounts owned by the token program.
 */
import { decodeAddress, encodeAddress } from "@thru/helpers";
import { AccountView, ChainClient, createAccountsByOwnerReplay } from "../src";

// const BASE_URL = "https://grpc.alphanet.thruput.org";
const BASE_URL = 'http://unto-tsw-slc1-3:8473'
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
  console.log("=== Token Program Account Stream Test ===");
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Token Program: ${TOKEN_PROGRAM}`);
  console.log(`TokenAccount size: ${TOKEN_ACCOUNT_SIZE} bytes`);
  console.log(`MintAccount size: ${MINT_ACCOUNT_SIZE} bytes`);
  console.log();

  const client = new ChainClient({ baseUrl: BASE_URL });

  // Get current height
  const height = await client.getHeight();
  console.log(`Chain height: finalized=${height.finalized}`);
  console.log();

  const tokenProgramBytes = new Uint8Array(decodeAddress(TOKEN_PROGRAM));

  // Test 1: Stream all token accounts (both types)
  console.log("=== Test 1: Stream all token accounts (TokenAccount + MintAccount) ===");
  console.log("Waiting for account updates... (30s timeout, max 10 events)");
  console.log();

  try {
    const stream = createAccountsByOwnerReplay({
      client,
      owner: tokenProgramBytes,
      dataSizes: [TOKEN_ACCOUNT_SIZE, MINT_ACCOUNT_SIZE],
      view: AccountView.FULL,
    });

    let accountCount = 0;
    let blockFinishedCount = 0;
    const startTime = Date.now();
    const seenAddresses = new Set<string>();

    for await (const event of stream) {
      if (event.type === "account") {
        const account = event.account;
        const accountType = getAccountType(account.meta.dataSize);
        const isNew = !seenAddresses.has(account.addressHex);
        seenAddresses.add(account.addressHex);

        console.log(`[${accountType}] ${isNew ? "NEW" : "UPDATE"}`);
        console.log(`  Address: ${encodeAddress(account.address)}`);
        console.log(`  Slot: ${account.slot}, Seq: ${account.seq}`);
        console.log(`  Balance: ${account.meta.balance}`);
        console.log(`  Data size: ${account.meta.dataSize} bytes`);
        console.log(`  Source: ${account.source}`);

        if (account.data.length > 0) {
          // Parse based on account type
          if (accountType === "TokenAccount" && account.data.length >= 73) {
            const mint = encodeAddress(account.data.slice(0, 32));
            const owner = encodeAddress(account.data.slice(32, 64));
            const amount = new DataView(account.data.buffer, account.data.byteOffset + 64, 8).getBigUint64(0, true);
            const isFrozen = account.data[72] !== 0;
            console.log(`  Parsed: mint=${mint.slice(0, 20)}... owner=${owner.slice(0, 20)}... amount=${amount} frozen=${isFrozen}`);
          } else if (accountType === "MintAccount" && account.data.length >= 115) {
            const decimals = account.data[0];
            const supply = new DataView(account.data.buffer, account.data.byteOffset + 1, 8).getBigUint64(0, true);
            const tickerLen = account.data[105];
            const ticker = new TextDecoder().decode(account.data.slice(106, 106 + tickerLen));
            console.log(`  Parsed: decimals=${decimals} supply=${supply} ticker="${ticker}"`);
          }
        }
        console.log();

        accountCount++;
        if (accountCount >= 10) {
          console.log(`(stopped after ${accountCount} account events)`);
          break;
        }
      } else if (event.type === "blockFinished") {
        blockFinishedCount++;
        console.log(`[BlockFinished] slot=${event.block.slot}`);
      }

      if (Date.now() - startTime > 30000) {
        console.log("(30s timeout reached)");
        break;
      }
    }

    const elapsed = Date.now() - startTime;
    console.log();
    console.log(`Summary: ${accountCount} account events, ${blockFinishedCount} block finished events in ${elapsed}ms`);
    console.log(`Unique addresses seen: ${seenAddresses.size}`);
  } catch (error) {
    console.error("Stream failed:", error);
  }

  console.log();

  // Test 2: Stream only MintAccounts
  console.log("=== Test 2: Stream only MintAccounts (115 bytes) ===");
  console.log("Waiting for mint account updates... (30s timeout, max 5 events)");
  console.log();

  try {
    const stream = createAccountsByOwnerReplay({
      client,
      owner: tokenProgramBytes,
      dataSizes: [MINT_ACCOUNT_SIZE],
      view: AccountView.FULL,
    });

    let count = 0;
    const startTime = Date.now();

    for await (const event of stream) {
      if (event.type === "account") {
        const account = event.account;
        console.log(`[MintAccount] ${encodeAddress(account.address)}`);
        console.log(`  Slot: ${account.slot}, Seq: ${account.seq}, Source: ${account.source}`);

        if (account.data.length >= 115) {
          const decimals = account.data[0];
          const supply = new DataView(account.data.buffer, account.data.byteOffset + 1, 8).getBigUint64(0, true);
          const tickerLen = account.data[105];
          const ticker = new TextDecoder().decode(account.data.slice(106, 106 + tickerLen));
          console.log(`  Decimals: ${decimals}, Supply: ${supply}, Ticker: "${ticker}"`);
        }
        console.log();

        count++;
        if (count >= 5) {
          console.log(`(stopped after ${count} events)`);
          break;
        }
      }

      if (Date.now() - startTime > 30000) {
        console.log("(30s timeout reached)");
        break;
      }
    }

    const elapsed = Date.now() - startTime;
    console.log(`Received ${count} MintAccount events in ${elapsed}ms`);
  } catch (error) {
    console.error("Stream failed:", error);
  }

  console.log();
  console.log("=== Tests completed ===");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exitCode = 1;
});
