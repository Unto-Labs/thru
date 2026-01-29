/**
 * Indexer runtime class.
 *
 * Orchestrates running multiple event and account streams concurrently
 * with graceful shutdown support.
 *
 * @example
 * ```ts
 * import { Indexer } from "@thru/indexer";
 * import { ChainClient } from "@thru/replay";
 * import { transfers } from "./streams/transfers";
 * import { tokenAccounts } from "./account-streams/token-accounts";
 *
 * const indexer = new Indexer({
 *   db,
 *   clientFactory: () => new ChainClient({ baseUrl: RPC_URL }),
 *   eventStreams: [transfers],
 *   accountStreams: [tokenAccounts],
 *   defaultStartSlot: 0n,
 *   safetyMargin: 64,
 * });
 *
 * // Handle graceful shutdown
 * process.on("SIGINT", () => indexer.stop());
 * process.on("SIGTERM", () => indexer.stop());
 *
 * // Start indexing
 * await indexer.start();
 * ```
 */

import { sql } from "drizzle-orm";
import type { IndexerConfig } from "./config";
import { runEventStreamProcessor, type ProcessorStats } from "../streams/processor";
import { runAccountStreamProcessor, type AccountProcessorStats } from "../accounts/processor";

// ============================================================
// Types
// ============================================================

export interface IndexerResult {
  /** Results from event stream processors */
  eventStreams: Array<{
    name: string;
    status: "fulfilled" | "rejected";
    result?: ProcessorStats;
    error?: Error;
  }>;
  /** Results from account stream processors */
  accountStreams: Array<{
    name: string;
    status: "fulfilled" | "rejected";
    result?: AccountProcessorStats;
    error?: Error;
  }>;
}

// ============================================================
// Indexer Class
// ============================================================

/**
 * Indexer runtime that orchestrates event and account streams.
 */
export class Indexer {
  private config: IndexerConfig;
  private abortController: AbortController | null = null;
  private running = false;
  private shutdownRequested = false;

  constructor(config: IndexerConfig) {
    this.config = {
      defaultStartSlot: 0n,
      safetyMargin: 64,
      pageSize: 512,
      logLevel: "info",
      ...config,
    };
  }

  /**
   * Check if the checkpoint table exists in the database.
   * Logs a warning if it doesn't exist (user may have forgotten to export it in schema).
   */
  private async checkCheckpointTable(): Promise<void> {
    try {
      // Try to query the checkpoint table
      await this.config.db.execute(
        sql`SELECT 1 FROM indexer_checkpoints LIMIT 1`
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Check if error is about missing table
      if (message.includes("does not exist") || message.includes("relation")) {
        console.warn(
          `[indexer] WARNING: Checkpoint table "indexer_checkpoints" not found.
[indexer] Make sure to export checkpointTable from your Drizzle schema:

  // db/schema.ts
  export { checkpointTable } from "@thru/indexer";

[indexer] Then run: pnpm drizzle-kit push (or generate + migrate)
`
        );
      }
      // Re-throw so startup fails
      throw err;
    }
  }

  /**
   * Start the indexer.
   *
   * Runs all configured event and account streams concurrently.
   * Returns when all streams complete or when stop() is called.
   *
   * @returns Results from all stream processors
   */
  async start(): Promise<IndexerResult> {
    if (this.running) {
      throw new Error("Indexer is already running");
    }

    // Check that checkpoint table exists before starting
    await this.checkCheckpointTable();

    this.running = true;
    this.shutdownRequested = false;
    this.abortController = new AbortController();

    const {
      db,
      clientFactory,
      eventStreams = [],
      accountStreams = [],
      defaultStartSlot,
      safetyMargin,
      pageSize,
      logLevel,
      validateParse,
    } = this.config;

    console.log("[indexer] Starting indexer...");
    console.log(
      `[indexer] Running ${eventStreams.length} event stream(s): ${eventStreams.map((s) => s.name).join(", ") || "none"}`
    );
    console.log(
      `[indexer] Running ${accountStreams.length} account stream(s): ${accountStreams.map((s) => s.name).join(", ") || "none"}`
    );

    try {
      // Processor options
      const eventProcessorOptions = {
        clientFactory,
        db,
        defaultStartSlot: defaultStartSlot!,
        safetyMargin,
        pageSize,
        logLevel,
        validateParse,
      };

      const accountProcessorOptions = {
        clientFactory,
        db,
        logLevel,
        validateParse,
      };

      // Start all processors concurrently
      const eventStreamPromises = eventStreams.map((stream) =>
        runEventStreamProcessor(
          stream,
          eventProcessorOptions,
          this.abortController!.signal
        )
      );

      const accountStreamPromises = accountStreams.map((stream) =>
        runAccountStreamProcessor(
          stream,
          accountProcessorOptions,
          this.abortController!.signal
        )
      );

      const [eventResults, accountResults] = await Promise.all([
        Promise.allSettled(eventStreamPromises),
        Promise.allSettled(accountStreamPromises),
      ]);

      // Build result
      const result: IndexerResult = {
        eventStreams: eventStreams.map((stream, i) => {
          const r = eventResults[i];
          if (r.status === "fulfilled") {
            console.log(
              `[indexer] Event stream "${stream.name}" completed: ${r.value.eventsProcessed} events in ${r.value.batchesCommitted} batches`
            );
            return {
              name: stream.name,
              status: "fulfilled" as const,
              result: r.value,
            };
          } else {
            console.error(
              `[indexer] Event stream "${stream.name}" failed:`,
              r.reason
            );
            return {
              name: stream.name,
              status: "rejected" as const,
              error: r.reason,
            };
          }
        }),
        accountStreams: accountStreams.map((stream, i) => {
          const r = accountResults[i];
          if (r.status === "fulfilled") {
            console.log(
              `[indexer] Account stream "${stream.name}" completed: ${r.value.accountsUpdated} accounts updated, ${r.value.accountsDeleted} deleted`
            );
            return {
              name: stream.name,
              status: "fulfilled" as const,
              result: r.value,
            };
          } else {
            console.error(
              `[indexer] Account stream "${stream.name}" failed:`,
              r.reason
            );
            return {
              name: stream.name,
              status: "rejected" as const,
              error: r.reason,
            };
          }
        }),
      };

      console.log("[indexer] All streams stopped.");
      return result;
    } finally {
      this.running = false;
      this.abortController = null;
    }
  }

  /**
   * Stop the indexer gracefully.
   *
   * Signals all streams to finish their current batch and stop.
   * The start() promise will resolve once all streams have stopped.
   */
  stop(): void {
    if (!this.running || !this.abortController) {
      console.log("[indexer] Not running");
      return;
    }

    if (this.shutdownRequested) {
      console.log("[indexer] Force shutdown...");
      process.exit(1);
    }

    console.log("[indexer] Shutdown requested, finishing current batches...");
    this.shutdownRequested = true;
    this.abortController.abort();
  }

  /**
   * Check if the indexer is currently running.
   */
  isRunning(): boolean {
    return this.running;
  }
}
