#!/usr/bin/env tsx
/**
 * Test script for listing and streaming token events.
 * Mirrors the replay package's token event filtering to verify SDK works correctly.
 *
 * Run with: pnpm test-token-events
 */

import { createThruClient } from "../client";
import { Filter, FilterParamValue } from "../domain/filters";
import { PageRequest } from "../domain/pagination";
import { Pubkey } from "../domain/primitives";

interface MaybeNodeProcess {
    env?: Record<string, string | undefined>;
    exitCode?: number;
}

const nodeProcess: MaybeNodeProcess | undefined = (globalThis as { process?: MaybeNodeProcess }).process;

const BASE_URL = nodeProcess?.env?.THRU_BASE_URL ?? "https://grpc-web.alphanet.thruput.org";
const TOKEN_PROGRAM = nodeProcess?.env?.TOKEN_PROGRAM ?? "taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAKqq";

const sdk = createThruClient({ baseUrl: BASE_URL });

function formatError(error: unknown): string {
    if (error instanceof Error) {
        return `${error.name}: ${error.message}`;
    }
    return String(error);
}

async function main(): Promise<void> {
    console.log("=== Token Events Test (SDK with gRPC-Web) ===");
    console.log(`Base URL: ${BASE_URL}`);
    console.log(`Token Program: ${TOKEN_PROGRAM}`);
    console.log();

    // Get current height for reference
    const height = await sdk.blocks.getBlockHeight();
    console.log(`Chain height: finalized=${height.finalized}`);
    console.log();

    // Create filter for token program events with InitializeMint tag (0)
    const tokenProgramBytes = Pubkey.from(TOKEN_PROGRAM).toBytes();
    const filter = new Filter({
        expression: "event.program.value == params.address && first1Byte(event.payload) == uint(0)",
        params: {
            address: FilterParamValue.bytes(tokenProgramBytes),
        },
    });

    // Also test simpler filter (just program, no payload check)
    const programOnlyFilter = new Filter({
        expression: "event.program.value == params.address",
        params: {
            address: FilterParamValue.bytes(tokenProgramBytes),
        },
    });

    // Test 1: List events with program-only filter
    console.log("=== Test 1: List events (program filter only) ===");
    try {
        const response = await sdk.events.list({
            filter: programOnlyFilter,
            page: new PageRequest({ pageSize: 5 }),
        });
        console.log(`Found ${response.events.length} events from token program`);
        for (const event of response.events) {
            const payloadPreview = event.payload ? `${event.payload.length} bytes, tag=${event.payload[0]}` : "no payload";
            console.log(`  - slot=${event.slot} callIdx=${event.callIndex} payload=(${payloadPreview})`);
        }
    } catch (error) {
        console.error(`List events failed: ${formatError(error)}`);
    }
    console.log();

    // Test 2: List events with full filter (program + InitializeMint tag)
    console.log("=== Test 2: List events (program + InitializeMint tag=0) ===");
    try {
        const response = await sdk.events.list({
            filter,
            page: new PageRequest({ pageSize: 5 }),
        });
        console.log(`Found ${response.events.length} InitializeMint events`);
        for (const event of response.events) {
            const payloadPreview = event.payload ? `${event.payload.length} bytes, tag=${event.payload[0]}` : "no payload";
            console.log(`  - slot=${event.slot} callIdx=${event.callIndex} payload=(${payloadPreview})`);
        }
    } catch (error) {
        console.error(`List events failed: ${formatError(error)}`);
    }
    console.log();

    // Test 3: Stream events with program-only filter (5 events, 30s timeout)
    console.log("=== Test 3: Stream events (program filter only, limit 5) ===");
    try {
        const stream = sdk.events.stream({
            filter: programOnlyFilter,
            signal: AbortSignal.timeout(30000),
        });

        let count = 0;
        const startTime = Date.now();
        for await (const { event } of stream) {
            const payloadPreview = event.payload ? `${event.payload.length} bytes, tag=${event.payload[0]}` : "no payload";
            console.log(`  - slot=${event.slot} callIdx=${event.callIndex} payload=(${payloadPreview})`);
            count++;
            if (count >= 5) {
                console.log(`  (stopped after ${count} events)`);
                break;
            }
        }
        const elapsed = Date.now() - startTime;
        console.log(`Received ${count} events in ${elapsed}ms`);
    } catch (error) {
        if ((error as Error).name === "AbortError" || (error as Error).name === "TimeoutError") {
            console.log("Stream timed out (expected if no events)");
        } else {
            console.error(`Stream events failed: ${formatError(error)}`);
        }
    }
    console.log();

    // Test 4: Stream events with full filter (program + InitializeMint tag)
    console.log("=== Test 4: Stream events (program + InitializeMint tag=0, limit 5) ===");
    try {
        const stream = sdk.events.stream({
            filter,
            signal: AbortSignal.timeout(30000),
        });

        let count = 0;
        const startTime = Date.now();
        for await (const { event } of stream) {
            const payloadPreview = event.payload ? `${event.payload.length} bytes, tag=${event.payload[0]}` : "no payload";
            console.log(`  - slot=${event.slot} callIdx=${event.callIndex} payload=(${payloadPreview})`);
            count++;
            if (count >= 5) {
                console.log(`  (stopped after ${count} events)`);
                break;
            }
        }
        const elapsed = Date.now() - startTime;
        console.log(`Received ${count} events in ${elapsed}ms`);
    } catch (error) {
        if ((error as Error).name === "AbortError" || (error as Error).name === "TimeoutError") {
            console.log("Stream timed out (expected if no new InitializeMint events)");
        } else {
            console.error(`Stream events failed: ${formatError(error)}`);
        }
    }

    console.log();

    // Test 5: Stream ALL events (no filter) to verify streaming works
    console.log("=== Test 5: Stream ALL events (no filter, limit 5) ===");
    try {
        const stream = sdk.events.stream({
            signal: AbortSignal.timeout(30000),
        });

        let count = 0;
        const startTime = Date.now();
        for await (const { event } of stream) {
            const program = event.program ? Pubkey.from(event.program).toThruFmt().slice(0, 20) + "..." : "N/A";
            const payloadPreview = event.payload ? `${event.payload.length} bytes, tag=${event.payload[0]}` : "no payload";
            console.log(`  - slot=${event.slot} program=${program} payload=(${payloadPreview})`);
            count++;
            if (count >= 5) {
                console.log(`  (stopped after ${count} events)`);
                break;
            }
        }
        const elapsed = Date.now() - startTime;
        console.log(`Received ${count} events in ${elapsed}ms`);
    } catch (error) {
        if ((error as Error).name === "AbortError" || (error as Error).name === "TimeoutError") {
            console.log("Stream timed out");
        } else {
            console.error(`Stream events failed: ${formatError(error)}`);
        }
    }

    console.log();
    console.log("=== Tests completed ===");
}

main().catch((error) => {
    console.error(`Fatal error: ${formatError(error)}`);
    if (nodeProcess) {
        nodeProcess.exitCode = 1;
    }
});
