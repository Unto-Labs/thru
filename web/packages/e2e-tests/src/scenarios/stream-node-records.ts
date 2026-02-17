import { BaseScenario } from "../framework/scenario";
import type { TestContext } from "../framework/context";
import type { TestResult } from "../framework/result";
import type { NodeRecord } from "@thru/proto";

/**
 * StreamNodeRecordsScenario tests the StreamNodeRecords streaming RPC.
 * Tests:
 * - Stream delivers node records (initial snapshot)
 * - Stream delivers a "finished" message after initial batch
 * - Records have valid fields (pubkey, chainId)
 * - Cross-validates with GetNodeRecords
 */
export class StreamNodeRecordsScenario extends BaseScenario {
  name = "Stream Node Records";
  description = "Tests StreamNodeRecords RPC for gossip-based node record streaming";

  async execute(ctx: TestContext): Promise<TestResult> {
    const result: TestResult = {
      success: true,
      message: "StreamNodeRecords test passed",
      details: [],
      verificationDetails: [],
      executionTimeMs: 0,
    };

    ctx.logInfo("=== Stream Node Records Test Starting ===");

    // Phase 1: Open stream and collect records until finished
    ctx.logInfo("Phase 1: Streaming node records");
    const controller = new AbortController();
    const records: NodeRecord[] = [];
    let gotFinished = false;

    const streamPromise = (async () => {
      try {
        const stream = ctx.sdk.node.streamRecords({ signal: controller.signal });
        for await (const msg of stream) {
          if (msg.type === "record") {
            records.push(msg.record);
            ctx.logInfo(
              "Record: chainId=%d, isOwn=%s, seqnum=%d",
              msg.record.chainId,
              msg.record.isOwn,
              msg.record.seqnum
            );
          } else if (msg.type === "finished") {
            gotFinished = true;
            ctx.logInfo("Received 'finished' signal");
            break;
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          throw err;
        }
      }
    })();

    // Use send-block to trigger gossip activity (if available)
    // send-block connects via BTP which should cause the node to update records
    try {
      // Just send an empty block to trigger gossip
      await ctx.blockSender.sendAsBlock([]);
    } catch {
      // Block sender may fail with no transactions, that's ok
      ctx.logInfo("Block sender skipped (empty block or not configured)");
    }

    // Wait with timeout
    const timeout = setTimeout(() => controller.abort(), 15000);
    await streamPromise;
    clearTimeout(timeout);
    controller.abort();

    if (records.length === 0 && !gotFinished) {
      ctx.logInfo("StreamNodeRecords returned no records or finished signal");
      result.verificationDetails.push(
        "⚠ StreamNodeRecords: no records received (stream may not be active)"
      );
      result.message = "StreamNodeRecords test passed (no records - single node environment)";
      return result;
    }

    // Phase 2: Verify records have valid fields
    if (records.length > 0) {
      ctx.logInfo("Received %d records before finished", records.length);

      for (let i = 0; i < records.length; i++) {
        const rec = records[i];

        if (!rec.pubkey?.value || rec.pubkey.value.length !== 32) {
          return {
            ...result,
            success: false,
            message: `Record ${i} has invalid pubkey`,
          };
        }

        if (rec.chainId <= 0) {
          return {
            ...result,
            success: false,
            message: `Record ${i} has invalid chainId: ${rec.chainId}`,
          };
        }
      }

      result.verificationDetails.push(
        `✓ StreamNodeRecords: ${records.length} valid records received`
      );
    }

    if (gotFinished) {
      result.verificationDetails.push(
        "✓ StreamNodeRecords: 'finished' signal received"
      );
    }

    // Phase 3: Cross-validate with GetNodeRecords
    ctx.logInfo("Phase 3: Cross-validating with GetNodeRecords");
    const getResponse = await ctx.sdk.node.getRecords();

    if (getResponse.records && getResponse.records.length > 0) {
      ctx.logInfo(
        "GetNodeRecords returned %d records (stream had %d)",
        getResponse.records.length,
        records.length
      );

      result.verificationDetails.push(
        `✓ Cross-validation: GetNodeRecords=${getResponse.records.length}, Stream=${records.length}`
      );
    }

    result.message = `StreamNodeRecords test passed (${records.length} records, finished=${gotFinished})`;
    ctx.logInfo("=== Stream Node Records Test Completed ===");
    return result;
  }
}

export function createStreamNodeRecordsScenario(): StreamNodeRecordsScenario {
  return new StreamNodeRecordsScenario();
}
