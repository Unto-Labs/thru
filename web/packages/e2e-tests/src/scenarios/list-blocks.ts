import { BaseScenario } from "../framework/scenario";
import type { TestContext } from "../framework/context";
import type { TestResult } from "../framework/result";
import { PageRequest } from "@thru/thru-sdk";

/**
 * ListBlocksScenario tests the ListBlocks pagination API
 */
export class ListBlocksScenario extends BaseScenario {
  name = "List Blocks";
  description = "Test ListBlocks pagination";

  async execute(ctx: TestContext): Promise<TestResult> {
    const result: TestResult = {
      success: true,
      message: "ListBlocks test passed",
      details: [],
      verificationDetails: [],
      executionTimeMs: 0,
    };

    ctx.logInfo("=== ListBlocks Test Starting ===");

    // Test basic pagination
    result.details.push("Testing ListBlocks with default pagination");

    const page1 = await ctx.sdk.blocks.list({
      page: new PageRequest({ pageSize: 10 }),
    });

    if (!page1 || !page1.blocks) {
      return {
        ...result,
        success: false,
        message: "ListBlocks returned null or empty",
      };
    }

    result.verificationDetails.push(`✓ Listed ${page1.blocks.length} blocks`);
    ctx.logInfo("Listed %d blocks", page1.blocks.length);

    // Test with cursor if we have more pages
    if (page1.page?.nextPageToken) {
      result.details.push("Testing pagination with cursor");
      const page2 = await ctx.sdk.blocks.list({
        page: new PageRequest({ pageSize: 10, pageToken: page1.page.nextPageToken }),
      });

      if (page2 && page2.blocks) {
        result.verificationDetails.push(`✓ Listed ${page2.blocks.length} more blocks with cursor`);
        ctx.logInfo("Listed %d more blocks with cursor", page2.blocks.length);
      }
    }

    ctx.logInfo("=== ListBlocks Test Completed ===");

    return result;
  }
}

export function createListBlocksScenario(): ListBlocksScenario {
  return new ListBlocksScenario();
}
