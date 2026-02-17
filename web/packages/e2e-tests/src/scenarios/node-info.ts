import { BaseScenario } from "../framework/scenario";
import type { TestContext } from "../framework/context";
import type { TestResult } from "../framework/result";

/**
 * NodeInfoScenario tests GetNodePubkey and GetNodeRecords RPCs.
 * Tests:
 * - GetNodePubkey returns a valid 32-byte pubkey
 * - GetNodeRecords returns at least 1 record
 * - At least one record has isOwn === true
 * - Cross-validates pubkey from GetNodePubkey matches the isOwn record
 */
export class NodeInfoScenario extends BaseScenario {
  name = "Node Info";
  description = "Tests GetNodePubkey and GetNodeRecords RPCs";

  async execute(ctx: TestContext): Promise<TestResult> {
    const result: TestResult = {
      success: true,
      message: "Node info test passed",
      details: [],
      verificationDetails: [],
      executionTimeMs: 0,
    };

    ctx.logInfo("=== Node Info Test Starting ===");

    // Phase 1: Test GetNodePubkey
    ctx.logInfo("Phase 1: Testing GetNodePubkey");
    const pubkeyResponse = await ctx.sdk.node.getPubkey();

    if (!pubkeyResponse.pubkey?.value) {
      return {
        ...result,
        success: false,
        message: "GetNodePubkey returned no pubkey",
      };
    }

    const pubkeyBytes = pubkeyResponse.pubkey.value;

    if (pubkeyBytes.length !== 32) {
      return {
        ...result,
        success: false,
        message: `GetNodePubkey returned ${pubkeyBytes.length}-byte pubkey, expected 32`,
      };
    }

    // Verify non-zero
    const isAllZero = pubkeyBytes.every((b: number) => b === 0);
    if (isAllZero) {
      return {
        ...result,
        success: false,
        message: "GetNodePubkey returned all-zero pubkey",
      };
    }

    ctx.logInfo("GetNodePubkey returned valid 32-byte pubkey");
    result.verificationDetails.push(
      "✓ GetNodePubkey: returned valid 32-byte non-zero pubkey"
    );

    // Phase 2: Test GetNodeRecords
    ctx.logInfo("Phase 2: Testing GetNodeRecords");
    const recordsResponse = await ctx.sdk.node.getRecords();

    if (!recordsResponse.records || recordsResponse.records.length === 0) {
      return {
        ...result,
        success: false,
        message: "GetNodeRecords returned no records",
      };
    }

    ctx.logInfo("GetNodeRecords returned %d records", recordsResponse.records.length);
    result.verificationDetails.push(
      `✓ GetNodeRecords: returned ${recordsResponse.records.length} record(s)`
    );

    // Phase 3: Verify at least one record has isOwn === true
    const ownRecord = recordsResponse.records.find((r: any) => r.isOwn === true);
    if (!ownRecord) {
      return {
        ...result,
        success: false,
        message: "GetNodeRecords: no record with isOwn=true found",
      };
    }

    result.verificationDetails.push(
      "✓ GetNodeRecords: found own node record (isOwn=true)"
    );

    // Phase 4: Validate own record fields
    if (!ownRecord.pubkey?.value || ownRecord.pubkey.value.length !== 32) {
      return {
        ...result,
        success: false,
        message: "Own node record has invalid pubkey",
      };
    }

    if (ownRecord.chainId <= 0) {
      return {
        ...result,
        success: false,
        message: `Own node record has invalid chainId: ${ownRecord.chainId}`,
      };
    }

    result.verificationDetails.push(
      `✓ Own record: chainId=${ownRecord.chainId}, seqnum=${ownRecord.seqnum}, contacts=${ownRecord.contacts.length}`
    );

    // Phase 5: Cross-validate pubkeys
    const ownPubkey = ownRecord.pubkey.value;
    if (pubkeyBytes.length !== ownPubkey.length) {
      return {
        ...result,
        success: false,
        message: "GetNodePubkey and own record pubkey lengths differ",
      };
    }

    for (let i = 0; i < pubkeyBytes.length; i++) {
      if (pubkeyBytes[i] !== ownPubkey[i]) {
        return {
          ...result,
          success: false,
          message: "GetNodePubkey does not match own record pubkey",
        };
      }
    }

    result.verificationDetails.push(
      "✓ Cross-validation: GetNodePubkey matches own record pubkey"
    );

    result.message = `Node info test passed (${recordsResponse.records.length} records, own record validated)`;
    ctx.logInfo("=== Node Info Test Completed ===");
    return result;
  }
}

export function createNodeInfoScenario(): NodeInfoScenario {
  return new NodeInfoScenario();
}
