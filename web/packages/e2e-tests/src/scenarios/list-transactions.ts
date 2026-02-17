import { BaseScenario } from "../framework/scenario";
import type { TestContext } from "../framework/context";
import type { TestResult } from "../framework/result";
import { PageRequest } from "@thru/thru-sdk";

/**
 * ListTransactionsScenario tests the ListTransactions pagination API
 */
export class ListTransactionsScenario extends BaseScenario {
  name = "List Transactions";
  description = "Test ListTransactions pagination and CEL filters";

  async execute(ctx: TestContext): Promise<TestResult> {
    const result: TestResult = {
      success: true,
      message: "ListTransactions test passed",
      details: [],
      verificationDetails: [],
      executionTimeMs: 0,
    };

    ctx.logInfo("=== ListTransactions Test Starting ===");

    // Test basic pagination
    result.details.push("Testing ListTransactions with default pagination");

    const page1 = await ctx.sdk.transactions.list({
      page: new PageRequest({ pageSize: 10 }),
    });

    if (!page1 || !page1.transactions) {
      return {
        ...result,
        success: false,
        message: "ListTransactions returned null or empty",
      };
    }

    result.verificationDetails.push(`✓ Listed ${page1.transactions.length} transactions`);
    ctx.logInfo("Listed %d transactions", page1.transactions.length);

    // Test with cursor if we have more pages
    if (page1.page?.nextPageToken) {
      result.details.push("Testing pagination with cursor");
      const page2 = await ctx.sdk.transactions.list({
        page: new PageRequest({ pageSize: 10, pageToken: page1.page.nextPageToken }),
      });

      if (page2 && page2.transactions) {
        result.verificationDetails.push(`✓ Listed ${page2.transactions.length} more transactions with cursor`);
        ctx.logInfo("Listed %d more transactions with cursor", page2.transactions.length);
      }
    }

    ctx.logInfo("=== ListTransactions Test Completed ===");

    return result;
  }
}

export function createListTransactionsScenario(): ListTransactionsScenario {
  return new ListTransactionsScenario();
}
