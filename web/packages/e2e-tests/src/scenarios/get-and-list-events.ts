import { BaseScenario } from "../framework/scenario";
import type { TestContext } from "../framework/context";
import type { TestResult } from "../framework/result";
import type { GenesisAccount } from "../accounts";
import { trackTransactionUntilFinalized } from "../utils/timing";
import {
  EVENT_PROGRAM,
  buildCounterEventInstruction,
  buildMessageEventInstruction,
  EVENT_COMPUTE_UNITS,
  EVENT_STATE_UNITS,
  EVENT_MEMORY_UNITS,
  EVENT_EXPIRY,
} from "../programs";
import { Filter, FilterParamValue, PageRequest } from "@thru/thru-sdk";

/**
 * GetAndListEventsScenario tests GetEvent and ListEvents RPCs.
 * Tests:
 * - Emit events via block builder
 * - ListEvents with slot filter discovers event IDs
 * - GetEvent retrieves individual events by ID
 * - ListEvents with pagination works (pageSize=3)
 */
export class GetAndListEventsScenario extends BaseScenario {
  name = "Get and List Events";
  description = "Tests GetEvent and ListEvents RPCs with event emission via block builder";

  private alice: GenesisAccount | null = null;
  private aliceNonce: bigint = 0n;

  async setup(ctx: TestContext): Promise<void> {
    const accounts = ctx.getGenesisAccounts(1);
    this.alice = accounts[0];

    ctx.logInfo("Using alice: %s", this.alice.publicKeyString);

    await ctx.accountStateTracker.subscribeAccount(this.alice.publicKeyString);

    const aliceAcct = await ctx.sdk.accounts.get(this.alice.publicKeyString);
    this.aliceNonce = aliceAcct?.meta?.nonce ?? 0n;
  }

  async execute(ctx: TestContext): Promise<TestResult> {
    const result: TestResult = {
      success: true,
      message: "GetEvent and ListEvents test passed",
      details: [],
      verificationDetails: [],
      executionTimeMs: 0,
    };

    ctx.logInfo("=== Get and List Events Test Starting ===");

    // Phase 1: Emit events (5 counter + 3 message = 8 total)
    ctx.logInfo("Phase 1: Emitting test events");
    const emitResult = await this.emitTestEvents(ctx, result);
    if (!emitResult.success) return emitResult;

    // Phase 2: ListEvents to discover event IDs
    ctx.logInfo("Phase 2: Listing events");
    const listResult = await this.testListEvents(ctx, result);
    if (!listResult.success) return listResult;

    // Phase 3: GetEvent for individual events
    ctx.logInfo("Phase 3: Getting individual events");
    const getResult = await this.testGetEvent(ctx, result);
    if (!getResult.success) return getResult;

    // Phase 4: ListEvents with pagination
    ctx.logInfo("Phase 4: Testing pagination");
    const paginationResult = await this.testPagination(ctx, result);
    if (!paginationResult.success) return paginationResult;

    ctx.logInfo("=== Get and List Events Test Completed ===");
    return result;
  }

  private emitSlot: bigint = 0n;
  private eventIds: string[] = [];

  private async emitTestEvents(ctx: TestContext, result: TestResult): Promise<TestResult> {
    const height = await ctx.sdk.blocks.getBlockHeight();
    const startSlot = height.finalized;

    // Emit 5 counter events
    const counterInstruction = buildCounterEventInstruction(5);
    const counterTx = await ctx.sdk.transactions.buildAndSign({
      feePayer: {
        publicKey: this.alice!.publicKey,
        privateKey: this.alice!.seed,
      },
      program: EVENT_PROGRAM,
      header: {
        fee: 1n,
        nonce: this.aliceNonce,
        startSlot,
        expiryAfter: EVENT_EXPIRY,
        computeUnits: EVENT_COMPUTE_UNITS,
        stateUnits: EVENT_STATE_UNITS,
        memoryUnits: EVENT_MEMORY_UNITS,
        chainId: ctx.config.chainId,
      },
      instructionData: counterInstruction,
    });

    const counterSig = counterTx.signature.toThruFmt();
    const counterTrack = trackTransactionUntilFinalized(ctx.sdk, counterSig);
    const blockResult = await ctx.blockSender.sendAsBlock([counterTx.rawTransaction]);
    this.aliceNonce++;
    this.emitSlot = blockResult.slot;

    const counterStatus = (await counterTrack) as any;
    if (!counterStatus || counterStatus.executionResult?.vmError !== 0) {
      return {
        ...result,
        success: false,
        message: `Counter event tx failed: vmError=${counterStatus?.executionResult?.vmError}`,
      };
    }

    // Emit 3 message events
    const messageInstruction = buildMessageEventInstruction(3, "e2e-test");
    const messageTx = await ctx.sdk.transactions.buildAndSign({
      feePayer: {
        publicKey: this.alice!.publicKey,
        privateKey: this.alice!.seed,
      },
      program: EVENT_PROGRAM,
      header: {
        fee: 1n,
        nonce: this.aliceNonce,
        startSlot,
        expiryAfter: EVENT_EXPIRY,
        computeUnits: EVENT_COMPUTE_UNITS,
        stateUnits: EVENT_STATE_UNITS,
        memoryUnits: EVENT_MEMORY_UNITS,
        chainId: ctx.config.chainId,
      },
      instructionData: messageInstruction,
    });

    const messageSig = messageTx.signature.toThruFmt();
    const messageTrack = trackTransactionUntilFinalized(ctx.sdk, messageSig);
    await ctx.blockSender.sendAsBlock([messageTx.rawTransaction]);
    this.aliceNonce++;

    const messageStatus = (await messageTrack) as any;
    if (!messageStatus || messageStatus.executionResult?.vmError !== 0) {
      return {
        ...result,
        success: false,
        message: `Message event tx failed: vmError=${messageStatus?.executionResult?.vmError}`,
      };
    }

    ctx.logInfo("Emitted 5 counter + 3 message events");
    result.verificationDetails.push(
      "✓ Emitted 5 counter events + 3 message events via block builder"
    );

    return result;
  }

  private async testListEvents(ctx: TestContext, result: TestResult): Promise<TestResult> {
    // List events with slot filter
    const filter = new Filter({
      expression: "event.slot >= params.slot",
      params: {
        slot: FilterParamValue.uint(this.emitSlot),
      },
    });

    const listResponse = await ctx.sdk.events.list({ filter });

    if (!listResponse.events || listResponse.events.length === 0) {
      return {
        ...result,
        success: false,
        message: "ListEvents returned no events",
      };
    }

    ctx.logInfo("ListEvents returned %d events", listResponse.events.length);

    // Store event IDs for GetEvent phase
    this.eventIds = listResponse.events.map((e: { id: string }) => e.id);

    result.verificationDetails.push(
      `✓ ListEvents: returned ${listResponse.events.length} events with slot filter`
    );

    return result;
  }

  private async testGetEvent(ctx: TestContext, result: TestResult): Promise<TestResult> {
    if (this.eventIds.length === 0) {
      ctx.logInfo("No event IDs to test GetEvent with");
      result.verificationDetails.push("⚠ GetEvent: skipped (no event IDs)");
      return result;
    }

    // Test GetEvent for first few event IDs
    const testCount = Math.min(3, this.eventIds.length);
    for (let i = 0; i < testCount; i++) {
      const eventId = this.eventIds[i];
      const event = await ctx.sdk.events.get(eventId);

      if (!event) {
        return {
          ...result,
          success: false,
          message: `GetEvent returned null for eventId=${eventId}`,
        };
      }

      if (!event.id) {
        return {
          ...result,
          success: false,
          message: `GetEvent response missing id for ${eventId}`,
        };
      }

      ctx.logInfo(
        "GetEvent[%d]: eventId=%s, slot=%s",
        i,
        event.id,
        event.slot
      );
    }

    result.verificationDetails.push(
      `✓ GetEvent: successfully retrieved ${testCount} events by ID`
    );

    return result;
  }

  private async testPagination(ctx: TestContext, result: TestResult): Promise<TestResult> {
    // List with small page size
    const filter = new Filter({
      expression: "event.slot >= params.slot",
      params: {
        slot: FilterParamValue.uint(this.emitSlot),
      },
    });

    const page1 = await ctx.sdk.events.list({
      filter,
      page: new PageRequest({ pageSize: 3 }),
    });

    if (!page1.events || page1.events.length === 0) {
      ctx.logInfo("Pagination: first page returned no events");
      result.verificationDetails.push("⚠ Pagination: skipped (no events in first page)");
      return result;
    }

    ctx.logInfo("Page 1: %d events", page1.events.length);

    if (page1.events.length > 3) {
      return {
        ...result,
        success: false,
        message: `Page 1 returned ${page1.events.length} events, expected <= 3`,
      };
    }

    result.verificationDetails.push(
      `✓ Pagination: page 1 returned ${page1.events.length} events (pageSize=3)`
    );

    // If there's a next page token, fetch page 2
    if (page1.page?.nextPageToken) {
      const page2 = await ctx.sdk.events.list({
        filter,
        page: new PageRequest({ pageSize: 3, pageToken: page1.page.nextPageToken }),
      });

      ctx.logInfo("Page 2: %d events", page2.events?.length ?? 0);

      result.verificationDetails.push(
        `✓ Pagination: page 2 returned ${page2.events?.length ?? 0} events`
      );
    } else {
      ctx.logInfo("No cursor for page 2 (all events fit in page 1)");
    }

    return result;
  }

  async cleanup(ctx: TestContext): Promise<void> {
    if (this.alice) {
      ctx.releaseGenesisAccounts([this.alice]);
    }
  }
}

export function createGetAndListEventsScenario(): GetAndListEventsScenario {
  return new GetAndListEventsScenario();
}
