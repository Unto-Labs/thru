#!/usr/bin/env tsx
import { TOKEN_PROGRAM_ADDRESS } from "@thru/sdk";

/**
 * Test script to verify ListAccounts behavior with different AccountView options.
 *
 * Tests:
 * 1. META_ONLY view - should return address + metadata, no data (used for hybrid backfill)
 * 2. FULL view - should return address + metadata + data
 * 3. Filter by last_updated_slot - for resumable backfill
 */
import { decodeAddress, encodeAddress } from "@thru/sdk/helpers";
import {
  AccountView,
  FilterSchema,
  FilterParamValueSchema,
  PageRequestSchema,
} from "@thru/sdk/proto";
import { create } from "@bufbuild/protobuf";
import { ChainClient } from "../src";

const BASE_URL = process.env.GRPC_URL || "https://rpc.betanet.thru.org";
const TOKEN_PROGRAM = process.env.TOKEN_PROGRAM ?? TOKEN_PROGRAM_ADDRESS;

// Byte 0 of every token program account is the account type (TokenProgramAccount
// root in token_program.abi.yaml); sizes are only a server-side prefilter.
const MINT_ACCOUNT_TYPE = 1;
const TOKEN_ACCOUNT_TYPE = 2;
const TOKEN_ACCOUNT_SIZE = 74;
const MINT_ACCOUNT_SIZE = 116;

function getAccountType(data: Uint8Array | undefined): string {
  if (!data) return "Unknown(no data)";
  if (data[0] === TOKEN_ACCOUNT_TYPE && data.length === TOKEN_ACCOUNT_SIZE) return "TokenAccount";
  if (data[0] === MINT_ACCOUNT_TYPE && data.length === MINT_ACCOUNT_SIZE) return "MintAccount";
  return `Unknown(type=${data[0]}, size=${data.length})`;
}

function describeMint(data: Uint8Array): string {
  const decimals = data[1];
  const supply = new DataView(data.buffer, data.byteOffset + 2, 8).getBigUint64(0, true);
  const tickerLen = data[107];
  const ticker = new TextDecoder().decode(data.slice(108, 108 + tickerLen));
  return `decimals=${decimals} supply=${supply} ticker="${ticker}"`;
}

async function main(): Promise<void> {
  console.log("=== ListAccounts View Test ===");
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Token Program: ${TOKEN_PROGRAM}`);
  console.log();

  const client = new ChainClient({ baseUrl: BASE_URL });

  // Get current height
  const height = await client.getHeight();
  console.log(`Chain height: finalized=${height.finalized}`);
  console.log();

  const tokenProgramBytes = new Uint8Array(decodeAddress(TOKEN_PROGRAM));

  // Test 0: ListAccounts with AccountView.META_ONLY (for hybrid backfill)
  console.log("=== Test 0: ListAccounts with AccountView.META_ONLY ===");
  console.log("Expecting: hasAddress=true, hasMeta=true, hasData=false (used for address collection)");
  console.log();

  try {
    const filter = create(FilterSchema, {
      expression: "account.meta.owner.value == params.owner_bytes",
      params: {
        owner_bytes: create(FilterParamValueSchema, {
          kind: { case: "bytesValue", value: tokenProgramBytes },
        }),
      },
    });

    const response = await client.listAccounts({
      view: AccountView.META_ONLY,  // Address + metadata only
      filter,
      page: create(PageRequestSchema, { pageSize: 5 }),
    });

    console.log(`Received ${response.accounts.length} accounts with META_ONLY view`);

    let hasAddressCount = 0;
    let hasMetaCount = 0;
    let hasDataCount = 0;

    for (const account of response.accounts) {
      const hasAddress = !!account.address?.value;
      const hasMeta = !!account.meta;
      const hasData = !!account.data?.data && account.data.data.length > 0;

      if (hasAddress) hasAddressCount++;
      if (hasMeta) hasMetaCount++;
      if (hasData) hasDataCount++;

      const address = hasAddress
        ? encodeAddress(account.address!.value)
        : "N/A";

      console.log(`  ${address.slice(0, 20)}... hasAddr=${hasAddress} hasMeta=${hasMeta} hasData=${hasData} metaDataSize=${account.meta?.dataSize ?? 0}`);
    }

    console.log();
    console.log(`Summary: ${hasAddressCount} with address, ${hasMetaCount} with meta, ${hasDataCount} with data`);

    if (hasAddressCount > 0 && hasMetaCount > 0 && hasDataCount === 0) {
      console.log("PASS: META_ONLY returns address + metadata without data (as expected)");
    } else if (hasDataCount > 0) {
      console.log("NOTE: META_ONLY returned data - server may not distinguish views");
    }
  } catch (error) {
    console.error("META_ONLY test failed:", error);
  }

  console.log();

  // Test 1: ListAccounts with AccountView.FULL - should return data
  console.log("=== Test 1: ListAccounts with AccountView.FULL ===");
  console.log("Expecting: hasData=true, data.length > 0");
  console.log();

  try {
    const filter = create(FilterSchema, {
      expression: "account.meta.owner.value == params.owner_bytes",
      params: {
        owner_bytes: create(FilterParamValueSchema, {
          kind: { case: "bytesValue", value: tokenProgramBytes },
        }),
      },
    });

    const response = await client.listAccounts({
      view: AccountView.FULL,
      filter,
      page: create(PageRequestSchema, { pageSize: 10 }),
    });

    console.log(`Received ${response.accounts.length} accounts`);
    console.log();

    let hasDataCount = 0;
    let noDataCount = 0;

    for (const account of response.accounts) {
      const hasAddress = !!account.address?.value;
      const hasMeta = !!account.meta;
      const hasData = !!account.data?.data && account.data.data.length > 0;
      const dataLen = account.data?.data?.length ?? 0;
      const metaDataSize = account.meta?.dataSize ?? 0;
      const accountType = getAccountType(account.data?.data);

      if (hasData) {
        hasDataCount++;
      } else {
        noDataCount++;
      }

      const address = hasAddress
        ? encodeAddress(account.address!.value)
        : "N/A";

      console.log(`[${accountType}] ${address.slice(0, 20)}...`);
      console.log(`  hasAddress: ${hasAddress}`);
      console.log(`  hasMeta: ${hasMeta}`);
      console.log(`  hasData: ${hasData}`);
      console.log(`  data.length: ${dataLen}`);
      console.log(`  meta.dataSize: ${metaDataSize}`);

      // Parse the data if available
      if (hasData && account.data?.data) {
        const data = account.data.data;
        if (accountType === "TokenAccount") {
          const mint = encodeAddress(data.slice(1, 33));
          const owner = encodeAddress(data.slice(33, 65));
          const amount = new DataView(
            data.buffer,
            data.byteOffset + 65,
            8
          ).getBigUint64(0, true);
          const isFrozen = data[73] !== 0;
          console.log(
            `  Parsed: mint=${mint.slice(0, 16)}... owner=${owner.slice(0, 16)}... amount=${amount} frozen=${isFrozen}`
          );
        } else if (accountType === "MintAccount") {
          console.log(`  Parsed: ${describeMint(data)}`);
        }
      }
      console.log();
    }

    console.log("--- Summary ---");
    console.log(`Accounts with data: ${hasDataCount}`);
    console.log(`Accounts without data: ${noDataCount}`);

    if (noDataCount > 0 && hasDataCount === 0) {
      console.log();
      console.log("FAIL: ListAccounts is not returning account data!");
      console.log("The server may still have the bug where view is ignored.");
      process.exitCode = 1;
    } else if (hasDataCount > 0) {
      console.log();
      console.log("PASS: ListAccounts is returning account data!");
    }
  } catch (error) {
    console.error("ListAccounts failed:", error);
    process.exitCode = 1;
  }

  console.log();

  // Test 2: ListAccounts with data size filter
  console.log("=== Test 2: ListAccounts with data size filter (MintAccount only) ===");

  try {
    const filter = create(FilterSchema, {
      expression:
        `account.meta.owner.value == params.owner_bytes && account.meta.data_size == uint(${MINT_ACCOUNT_SIZE})`,
      params: {
        owner_bytes: create(FilterParamValueSchema, {
          kind: { case: "bytesValue", value: tokenProgramBytes },
        }),
      },
    });

    const response = await client.listAccounts({
      view: AccountView.FULL,
      filter,
      page: create(PageRequestSchema, { pageSize: 5 }),
    });

    console.log(`Received ${response.accounts.length} MintAccounts`);

    for (const account of response.accounts) {
      const dataLen = account.data?.data?.length ?? 0;
      const address = account.address?.value
        ? encodeAddress(account.address.value)
        : "N/A";

      console.log(`  ${address.slice(0, 20)}... dataLen=${dataLen}`);

      if (account.data?.data && getAccountType(account.data.data) === "MintAccount") {
        console.log(`    ${describeMint(account.data.data)}`);
      }
    }
  } catch (error) {
    console.error("ListAccounts with size filter failed:", error);
  }

  console.log();

  // Test 3: ListAccounts with last_updated_slot filter (for resumable backfill)
  console.log("=== Test 3: ListAccounts with last_updated_slot filter ===");

  try {
    // Use a slot from the past to test the filter works (ensure non-negative)
    const finalized = BigInt(height.finalized);
    const minSlot = finalized > 100n ? finalized - 100n : 1n;

    const filter = create(FilterSchema, {
      expression:
        "account.meta.owner.value == params.owner_bytes && account.meta.last_updated_slot >= params.min_slot",
      params: {
        owner_bytes: create(FilterParamValueSchema, {
          kind: { case: "bytesValue", value: tokenProgramBytes },
        }),
        min_slot: create(FilterParamValueSchema, {
          kind: { case: "uintValue", value: minSlot },
        }),
      },
    });

    const response = await client.listAccounts({
      view: AccountView.FULL,
      filter,
      page: create(PageRequestSchema, { pageSize: 5 }),
    });

    console.log(
      `Received ${response.accounts.length} accounts updated since slot ${minSlot}`
    );

    for (const account of response.accounts) {
      const address = account.address?.value
        ? encodeAddress(account.address.value)
        : "N/A";
      const lastUpdatedSlot = account.meta?.lastUpdatedSlot ?? 0n;
      const dataLen = account.data?.data?.length ?? 0;

      console.log(
        `  ${address.slice(0, 20)}... lastUpdatedSlot=${lastUpdatedSlot} dataLen=${dataLen}`
      );
    }
  } catch (error) {
    console.error("ListAccounts with slot filter failed:", error);
  }

  console.log();
  console.log("=== Tests completed ===");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exitCode = 1;
});
