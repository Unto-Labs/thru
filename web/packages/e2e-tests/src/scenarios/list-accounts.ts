import { BaseScenario } from "../framework/scenario";
import type { TestContext } from "../framework/context";
import type { TestResult } from "../framework/result";
import { PageRequest, Filter } from "@thru/thru-sdk";

/**
 * ListAccountsScenario tests the ListAccounts pagination API
 */
export class ListAccountsScenario extends BaseScenario {
  name = "List Accounts";
  description = "Test ListAccounts pagination and owner filters";

  async execute(ctx: TestContext): Promise<TestResult> {
    const result: TestResult = {
      success: true,
      message: "ListAccounts test passed",
      details: [],
      verificationDetails: [],
      executionTimeMs: 0,
    };

    ctx.logInfo("=== ListAccounts Test Starting ===");

    // Test basic pagination with required filter
    result.details.push("Testing ListAccounts with filter");

    // List accounts requires a filter expression
    const page1 = await ctx.sdk.accounts.list({
      filter: new Filter({ expression: "true" }), // Match all accounts
      page: new PageRequest({ pageSize: 10 }),
    });

    if (!page1 || !page1.accounts) {
      return {
        ...result,
        success: false,
        message: "ListAccounts returned null or empty",
      };
    }

    result.verificationDetails.push(`✓ Listed ${page1.accounts.length} accounts`);
    ctx.logInfo("Listed %d accounts", page1.accounts.length);

    // Test with cursor if we have more pages
    if (page1.page?.nextPageToken) {
      result.details.push("Testing pagination with cursor");
      const page2 = await ctx.sdk.accounts.list({
        filter: new Filter({ expression: "true" }),
        page: new PageRequest({ pageSize: 10, pageToken: page1.page.nextPageToken }),
      });

      if (page2 && page2.accounts) {
        result.verificationDetails.push(`✓ Listed ${page2.accounts.length} more accounts with cursor`);
        ctx.logInfo("Listed %d more accounts with cursor", page2.accounts.length);
      }
    }

    ctx.logInfo("=== ListAccounts Test Completed ===");

    return result;
  }
}

export function createListAccountsScenario(): ListAccountsScenario {
  return new ListAccountsScenario();
}
