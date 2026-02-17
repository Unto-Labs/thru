import { BaseScenario } from "../framework/scenario";
import type { TestContext } from "../framework/context";
import type { TestResult } from "../framework/result";
import { Filter, FilterParamValue } from "@thru/thru-sdk";

/**
 * StreamErrorPathsScenario tests error handling for streaming RPCs.
 * Tests:
 * - Invalid CEL filter on StreamTransactions → gRPC error
 * - Invalid CEL filter on StreamEvents → gRPC error
 * - Cancelled stream on StreamBlocks → clean cancellation
 */
export class StreamErrorPathsScenario extends BaseScenario {
  name = "Stream Error Paths";
  description = "Tests error paths for streaming RPCs (invalid filters, cancellation)";

  async execute(ctx: TestContext): Promise<TestResult> {
    const result: TestResult = {
      success: true,
      message: "Stream error paths test passed",
      details: [],
      verificationDetails: [],
      executionTimeMs: 0,
    };

    ctx.logInfo("=== Stream Error Paths Test Starting ===");

    // Phase 1: Invalid CEL filter on StreamTransactions
    ctx.logInfo("Phase 1: Invalid filter on StreamTransactions");
    const txFilterResult = await this.testInvalidTransactionFilter(ctx, result);
    if (!txFilterResult.success) return txFilterResult;

    // Phase 2: Invalid CEL filter on StreamEvents
    ctx.logInfo("Phase 2: Invalid filter on StreamEvents");
    const eventFilterResult = await this.testInvalidEventFilter(ctx, result);
    if (!eventFilterResult.success) return eventFilterResult;

    // Phase 3: Clean stream cancellation
    ctx.logInfo("Phase 3: Clean stream cancellation");
    const cancelResult = await this.testStreamCancellation(ctx, result);
    if (!cancelResult.success) return cancelResult;

    ctx.logInfo("=== Stream Error Paths Test Completed ===");
    return result;
  }

  private async testInvalidTransactionFilter(
    ctx: TestContext,
    result: TestResult
  ): Promise<TestResult> {
    const invalidFilter = new Filter({
      expression: "this.is.not.a.valid.field == params.bad",
      params: {
        bad: FilterParamValue.uint(0n),
      },
    });

    try {
      const stream = ctx.sdk.transactions.stream({ filter: invalidFilter });
      // Try to consume the first item - this should fail
      for await (const _ of stream) {
        // If we get here, the filter wasn't rejected
        return {
          ...result,
          success: false,
          message: "StreamTransactions did not reject invalid filter",
        };
      }
      // Empty stream is also acceptable (server may close immediately)
      result.verificationDetails.push(
        "✓ StreamTransactions with invalid filter: stream closed without data"
      );
    } catch (err) {
      const errMsg = (err as Error).message || String(err);
      ctx.logInfo("StreamTransactions error: %s", errMsg);
      result.verificationDetails.push(
        "✓ StreamTransactions with invalid filter: gRPC error received"
      );
    }

    return result;
  }

  private async testInvalidEventFilter(
    ctx: TestContext,
    result: TestResult
  ): Promise<TestResult> {
    const invalidFilter = new Filter({
      expression: "nonexistent_field.foo.bar == params.bad",
      params: {
        bad: FilterParamValue.uint(0n),
      },
    });

    try {
      const stream = ctx.sdk.events.stream({ filter: invalidFilter });
      for await (const _ of stream) {
        return {
          ...result,
          success: false,
          message: "StreamEvents did not reject invalid filter",
        };
      }
      result.verificationDetails.push(
        "✓ StreamEvents with invalid filter: stream closed without data"
      );
    } catch (err) {
      const errMsg = (err as Error).message || String(err);
      ctx.logInfo("StreamEvents error: %s", errMsg);
      result.verificationDetails.push(
        "✓ StreamEvents with invalid filter: gRPC error received"
      );
    }

    return result;
  }

  private async testStreamCancellation(
    ctx: TestContext,
    result: TestResult
  ): Promise<TestResult> {
    const controller = new AbortController();
    let receivedItems = 0;
    let cleanExit = false;

    try {
      const stream = ctx.sdk.blocks.stream({ signal: controller.signal });

      // Abort after a short delay
      setTimeout(() => controller.abort(), 500);

      for await (const _ of stream) {
        receivedItems++;
        // If we get items, that's fine - abort is async
        if (receivedItems >= 2) {
          // Force abort if we're getting too many
          controller.abort();
          break;
        }
      }
      cleanExit = true;
    } catch (err) {
      const errName = (err as Error).name;
      if (errName === "AbortError") {
        cleanExit = true;
      } else {
        // ConnectError with [canceled] is also a clean cancellation
        const errMsg = (err as Error).message || "";
        if (errMsg.includes("abort") || errMsg.includes("cancel")) {
          cleanExit = true;
        } else {
          return {
            ...result,
            success: false,
            message: `StreamBlocks cancellation produced unexpected error: ${errMsg}`,
          };
        }
      }
    }

    if (!cleanExit) {
      return {
        ...result,
        success: false,
        message: "StreamBlocks cancellation did not exit cleanly",
      };
    }

    ctx.logInfo("StreamBlocks cancelled cleanly (received %d items before cancel)", receivedItems);
    result.verificationDetails.push(
      `✓ StreamBlocks cancellation: clean exit (${receivedItems} items before cancel)`
    );

    return result;
  }
}

export function createStreamErrorPathsScenario(): StreamErrorPathsScenario {
  return new StreamErrorPathsScenario();
}
