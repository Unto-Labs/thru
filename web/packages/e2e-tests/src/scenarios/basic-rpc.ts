import { BaseScenario } from "../framework/scenario";
import type { TestContext } from "../framework/context";
import type { TestResult } from "../framework/result";
import { sleep } from "../utils/retry";

/**
 * BasicRPCScenario tests basic query APIs:
 * - GetHeight
 * - GetVersion
 * - GetAccount
 */
export class BasicRPCScenario extends BaseScenario {
  name = "Basic RPC APIs";
  description = "Tests basic query APIs: GetHeight, GetVersion, GetAccount";

  async execute(ctx: TestContext): Promise<TestResult> {
    const result: TestResult = {
      success: true,
      message: "All basic RPC APIs working correctly",
      details: [],
      verificationDetails: [],
      executionTimeMs: 0,
    };

    // Test 1: GetHeight
    result.details.push("Testing GetHeight API");
    let height = await ctx.sdk.blocks.getBlockHeight();

    // Retry until finalized > 0
    for (let i = 0; i < 10 && height.finalized === 0n; i++) {
      await sleep(1000);
      height = await ctx.sdk.blocks.getBlockHeight();
    }

    if (height.finalized === 0n) {
      return {
        ...result,
        success: false,
        message: "GetHeight returned finalized=0",
      };
    }

    if (height.locallyExecuted < height.finalized) {
      return {
        ...result,
        success: false,
        message: "locally_executed < finalized (invalid state)",
      };
    }

    result.verificationDetails.push(
      `✓ GetHeight: finalized=${height.finalized}, locally_executed=${height.locallyExecuted}, cluster_executed=${height.clusterExecuted}`
    );
    ctx.logInfo(
      "GetHeight: finalized=%d, locally_executed=%d, cluster_executed=%d",
      height.finalized,
      height.locallyExecuted,
      height.clusterExecuted
    );

    // Test 2: GetVersion
    result.details.push("Testing GetVersion API");
    const version = await ctx.sdk.version.get();

    if (!version) {
      return {
        ...result,
        success: false,
        message: "GetVersion returned null",
      };
    }

    // SDK uses 'components' property
    const components = version.components ?? {};
    const versionCount = Object.keys(components).length;

    if (versionCount === 0) {
      return {
        ...result,
        success: false,
        message: "GetVersion returned empty versions map",
      };
    }

    result.verificationDetails.push(`✓ GetVersion returned ${versionCount} version(s)`);
    ctx.logInfo("GetVersion: %s", JSON.stringify(components));

    // Test 3: GetAccount - query the genesis account
    result.details.push("Testing GetAccount API");
    const account = await ctx.sdk.accounts.get(ctx.genesisAccount.publicKeyString);

    if (!account) {
      return {
        ...result,
        success: false,
        message: `GetAccount returned null for account ${ctx.genesisAccount.publicKeyString}`,
      };
    }

    const balance = account.meta?.balance ?? 0n;
    const nonce = account.meta?.nonce ?? 0n;

    if (balance === 0n) {
      return {
        ...result,
        success: false,
        message: `Genesis account ${ctx.genesisAccount.publicKeyString} has zero balance`,
      };
    }

    result.verificationDetails.push(
      `✓ GetAccount: balance=${balance}, nonce=${nonce} for account ${ctx.genesisAccount.publicKeyString}`
    );
    ctx.logInfo(
      "GetAccount: balance=%d, nonce=%d for account %s",
      balance,
      nonce,
      ctx.genesisAccount.publicKeyString
    );

    return result;
  }
}

export function createBasicRPCScenario(): BasicRPCScenario {
  return new BasicRPCScenario();
}
