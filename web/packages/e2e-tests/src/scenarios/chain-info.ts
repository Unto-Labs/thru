import { BaseScenario } from "../framework/scenario";
import type { TestContext } from "../framework/context";
import type { TestResult } from "../framework/result";

/**
 * ChainInfoScenario tests the GetChainInfo RPC.
 * Tests:
 * - GetChainInfo returns a valid response
 * - chainId matches the configured chain ID
 * - chainId is a positive integer
 */
export class ChainInfoScenario extends BaseScenario {
  name = "Chain Info";
  description = "Tests GetChainInfo RPC for retrieving chain-level information";

  async execute(ctx: TestContext): Promise<TestResult> {
    const result: TestResult = {
      success: true,
      message: "GetChainInfo RPC test passed",
      details: [],
      verificationDetails: [],
      executionTimeMs: 0,
    };

    ctx.logInfo("=== Chain Info Test Starting ===");

    // Phase 1: Call GetChainInfo
    ctx.logInfo("Phase 1: Testing GetChainInfo");
    const chainInfo = await ctx.sdk.chain.getChainInfo();

    if (!chainInfo) {
      return {
        ...result,
        success: false,
        message: "GetChainInfo returned null response",
      };
    }

    ctx.logInfo("GetChainInfo returned chainId=%d", chainInfo.chainId);

    // Phase 2: Verify chainId is positive
    if (chainInfo.chainId <= 0) {
      return {
        ...result,
        success: false,
        message: `GetChainInfo returned non-positive chainId: ${chainInfo.chainId}`,
      };
    }

    result.verificationDetails.push(
      `✓ GetChainInfo: chainId=${chainInfo.chainId} (positive integer)`
    );

    // Phase 3: Verify chainId matches config
    if (chainInfo.chainId !== ctx.config.chainId) {
      return {
        ...result,
        success: false,
        message: `GetChainInfo chainId mismatch: got ${chainInfo.chainId}, expected ${ctx.config.chainId}`,
      };
    }

    result.verificationDetails.push(
      `✓ GetChainInfo: chainId matches config (${ctx.config.chainId})`
    );

    // Phase 4: Cross-validate with getChainId convenience method
    const chainId = await ctx.sdk.chain.getChainId();
    if (chainId !== chainInfo.chainId) {
      return {
        ...result,
        success: false,
        message: `getChainId (${chainId}) doesn't match getChainInfo.chainId (${chainInfo.chainId})`,
      };
    }

    result.verificationDetails.push(
      "✓ getChainId matches getChainInfo.chainId"
    );

    result.message = `GetChainInfo RPC test passed (chainId=${chainInfo.chainId})`;
    ctx.logInfo("=== Chain Info Test Completed ===");
    return result;
  }
}

export function createChainInfoScenario(): ChainInfoScenario {
  return new ChainInfoScenario();
}
