#!/usr/bin/env tsx

/**
 * Test script mirroring the SDK token events tests but using native gRPC transport.
 * Tests both ListEvents and StreamEvents with various filters.
 * Uses proto Filter directly (not thru-sdk).
 */
import { decodeAddress, encodeAddress } from "@thru/helpers";
import { Filter, FilterParamValue, PageRequest } from "@thru/proto";
import { ListEventsRequest, StreamEventsRequest } from "@thru/proto";
import { ChainClient } from "../src";

const BASE_URL = "https://grpc.alphanet.thruput.org";
// const BASE_URL = 'http://34.186.178.127:8080'
const TOKEN_PROGRAM = "taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAKqq";

async function main(): Promise<void> {
  console.log("=== Token Events Test (Replay with native gRPC, proto Filter) ===");
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Token Program: ${TOKEN_PROGRAM}`);
  console.log();

  const client = new ChainClient({ baseUrl: BASE_URL });

  // Get current height
  const height = await client.getHeight();
  console.log(`Chain height: finalized=${height.finalized}`);
  console.log();

  // Create filters using proto classes directly
  const tokenProgramBytes = new Uint8Array(decodeAddress(TOKEN_PROGRAM));

  const programOnlyFilter = new Filter({
    expression: "event.program.value == params.address",
    params: {
      address: new FilterParamValue({
        kind: { case: "bytesValue", value: tokenProgramBytes },
      }),
    },
  });

  const fullFilter = new Filter({
    // expression: "event.program.value == params.address && first1Byte(event.payload) == uint(0)",
    expression: "first1Byte(event.payload) == uint(0)",
    params: {
      address: new FilterParamValue({
        kind: { case: "bytesValue", value: tokenProgramBytes },
      }),
    },
  });

  // Test 1: List events (program filter only)
  console.log("=== Test 1: List events (program filter only) ===");
  try {
    const response = await client.listEvents(
      new ListEventsRequest({
        filter: programOnlyFilter,
        page: new PageRequest({ pageSize: 5 }),
      })
    );
    console.log(`Found ${response.events.length} events from token program`);
    for (const event of response.events) {
      const payload = event.payload;
      const payloadPreview = payload?.length ? `${payload.length} bytes, tag=${payload[0]}` : "no payload";
      console.log(`  - slot=${event.slot} callIdx=${event.callIdx} payload=(${payloadPreview})`);
    }
  } catch (error) {
    console.error(`List events failed:`, error);
  }
  console.log();

  // Test 2: List events (program + first1Byte filter)
  console.log("=== Test 2: List events (program + first1Byte tag=1) ===");
  try {
    const response = await client.listEvents(
      new ListEventsRequest({
        filter: fullFilter,
        page: new PageRequest({ pageSize: 5 }),
      })
    );
    console.log(`Found ${response.events.length} InitializeMint events`);
    for (const event of response.events) {
      const payload = event.payload;
      const payloadPreview = payload?.length ? `${payload.length} bytes, tag=${payload[0]}` : "no payload";
      console.log(`  - slot=${event.slot} callIdx=${event.callIdx} payload=(${payloadPreview})`);
    }
  } catch (error) {
    console.error(`List events failed:`, error);
  }
  console.log();

  // Test 3: Stream events (program filter only, limit 5, 30s timeout)
  console.log("=== Test 3: Stream events (program filter only, limit 5) ===");
  try {
    const stream = client.streamEvents(
      new StreamEventsRequest({
        filter: programOnlyFilter,
      })
    );

    let count = 0;
    const startTime = Date.now();
    const timeout = setTimeout(() => {
      console.log("  (30s timeout reached)");
    }, 30000);

    for await (const response of stream) {
      const payload = response.payload;
      const payloadPreview = payload?.length ? `${payload.length} bytes, tag=${payload[0]}` : "no payload";
      console.log(`  - slot=${response.slot} callIdx=${response.callIdx} payload=(${payloadPreview})`);
      count++;
      if (count >= 5) {
        console.log(`  (stopped after ${count} events)`);
        break;
      }
      if (Date.now() - startTime > 30000) {
        console.log("  (30s timeout)");
        break;
      }
    }
    clearTimeout(timeout);
    const elapsed = Date.now() - startTime;
    console.log(`Received ${count} events in ${elapsed}ms`);
  } catch (error) {
    console.error(`Stream events failed:`, error);
  }
  console.log();

  // Test 4: Stream events (program + first1Byte filter, limit 5)
  console.log("=== Test 4: Stream events (program + first1Byte tag=1, limit 5) ===");
  try {
    const stream = client.streamEvents(
      new StreamEventsRequest({
        filter: fullFilter,
      })
    );

    let count = 0;
    const startTime = Date.now();

    for await (const response of stream) {
      const payload = response.payload;
      const payloadPreview = payload?.length ? `${payload.length} bytes, tag=${payload[0]}` : "no payload";
      console.log(`  - slot=${response.slot} callIdx=${response.callIdx} payload=(${payloadPreview})`);
      count++;
      if (count >= 5) {
        console.log(`  (stopped after ${count} events)`);
        break;
      }
      if (Date.now() - startTime > 30000) {
        console.log("  (30s timeout)");
        break;
      }
    }
    const elapsed = Date.now() - startTime;
    console.log(`Received ${count} events in ${elapsed}ms`);
  } catch (error) {
    console.error(`Stream events failed:`, error);
  }
  console.log();

  // Test 5: Stream ALL events (no filter, limit 5)
  console.log("=== Test 5: Stream ALL events (no filter, limit 5) ===");
  try {
    const stream = client.streamEvents(new StreamEventsRequest({}));

    let count = 0;
    const startTime = Date.now();

    for await (const response of stream) {
      const program = response.program?.value
        ? encodeAddress(response.program.value).slice(0, 20) + "..."
        : "N/A";
      const payload = response.payload;
      const payloadPreview = payload?.length ? `${payload.length} bytes, tag=${payload[0]}` : "no payload";
      console.log(`  - slot=${response.slot} program=${program} payload=(${payloadPreview})`);
      count++;
      if (count >= 5) {
        console.log(`  (stopped after ${count} events)`);
        break;
      }
      if (Date.now() - startTime > 30000) {
        console.log("  (30s timeout)");
        break;
      }
    }
    const elapsed = Date.now() - startTime;
    console.log(`Received ${count} events in ${elapsed}ms`);
  } catch (error) {
    console.error(`Stream events failed:`, error);
  }

  console.log();
  console.log("=== Tests completed ===");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exitCode = 1;
});
