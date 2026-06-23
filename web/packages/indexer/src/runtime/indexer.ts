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
import {
  cloneStreamStatus,
  emptyStreamCounters,
  normalizeIndexerError,
  type IndexerStatus,
  type IndexerStreamKind,
  type IndexerStreamStatus,
  type ProcessorStatusObserver,
} from "./status";
import type { EventStream } from "../streams/types";
import type { AccountStream } from "../accounts/types";

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
  private startedAtMs: number | null = null;
  private streamStatuses = new Map<string, IndexerStreamStatus>();

  constructor(config: IndexerConfig) {
    this.config = {
      defaultStartSlot: 0n,
      safetyMargin: 64,
      pageSize: 512,
      logLevel: "info",
      supervisorInitialBackoffMs: 1000,
      supervisorMaxBackoffMs: 30000,
      streamStaleMs: 300000,
      ...config,
    };

    this.initializeStreamStatuses();
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
      // drizzle-orm >= 0.44 wraps driver errors in DrizzleQueryError;
      // the original DB message lives in .cause
      const message = err instanceof Error
        ? (err.cause instanceof Error ? err.cause.message : err.message)
        : String(err);
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
    this.startedAtMs = Date.now();
    this.abortController = new AbortController();
    this.initializeStreamStatuses();

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
      endpointLabel,
      supervisorInitialBackoffMs = 1000,
      supervisorMaxBackoffMs = 30000,
    } = this.config;

    console.log("[indexer] Starting indexer...");
    console.log(
      `[indexer] Running ${eventStreams.length} event stream(s): ${eventStreams.map((s) => s.name).join(", ") || "none"}`
    );
    console.log(
      `[indexer] Running ${accountStreams.length} account stream(s): ${accountStreams.map((s) => s.name).join(", ") || "none"}`
    );

    try {
      const supervisorOptions = {
        endpointLabel,
        initialBackoffMs: supervisorInitialBackoffMs,
        maxBackoffMs: supervisorMaxBackoffMs,
      };

      const eventSupervisors = eventStreams.map((stream) =>
        this.runEventStreamSupervisor(stream, {
          clientFactory,
          db,
          defaultStartSlot: defaultStartSlot!,
          safetyMargin,
          pageSize,
          logLevel,
          validateParse,
        }, supervisorOptions)
      );

      const accountSupervisors = accountStreams.map((stream) =>
        this.runAccountStreamSupervisor(stream, {
          clientFactory,
          db,
          logLevel,
          validateParse,
        }, supervisorOptions)
      );

      await Promise.all([...eventSupervisors, ...accountSupervisors]);

      const result: IndexerResult = {
        eventStreams: eventStreams.map((stream) => this.resultForStream(stream.name)),
        accountStreams: accountStreams.map((stream) => this.resultForStream(stream.name)),
      };

      console.log("[indexer] All streams stopped.");
      return result;
    } finally {
      this.running = false;
      this.abortController = null;
      this.startedAtMs = null;
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

  /**
   * Get the current in-memory runtime status for every configured stream.
   */
  getStatus(): IndexerStatus {
    const now = Date.now();
    const streams = Array.from(this.streamStatuses.values()).map((status) => {
      const stream = cloneStreamStatus(status);
      stream.stale = this.isStreamStale(stream, now);
      return stream;
    });
    const healthy =
      this.running &&
      !this.shutdownRequested &&
      streams.length > 0 &&
      streams.every((stream) => stream.state === "running" && !stream.stale);

    return {
      running: this.running,
      shutdownRequested: this.shutdownRequested,
      startedAt: this.startedAtMs === null ? null : new Date(this.startedAtMs).toISOString(),
      uptimeMs: this.startedAtMs === null ? 0 : now - this.startedAtMs,
      healthy,
      streams,
    };
  }

  private initializeStreamStatuses(): void {
    this.streamStatuses = new Map();
    for (const stream of this.config.eventStreams ?? []) {
      this.streamStatuses.set(this.statusKey("event", stream.name), this.createInitialStreamStatus("event", stream.name));
    }
    for (const stream of this.config.accountStreams ?? []) {
      this.streamStatuses.set(this.statusKey("account", stream.name), this.createInitialStreamStatus("account", stream.name));
    }
  }

  private createInitialStreamStatus(kind: IndexerStreamKind, name: string): IndexerStreamStatus {
    return {
      name,
      kind,
      state: "idle",
      checkpointSlot: null,
      lastProcessedSlot: null,
      lastEventAt: null,
      stale: false,
      restartCount: 0,
      lastStartedAt: null,
      lastErrorAt: null,
      lastError: null,
      counters: emptyStreamCounters(),
    };
  }

  private statusKey(kind: IndexerStreamKind, name: string): string {
    return `${kind}:${name}`;
  }

  private statusFor(kind: IndexerStreamKind, name: string): IndexerStreamStatus {
    const key = this.statusKey(kind, name);
    let status = this.streamStatuses.get(key);
    if (!status) {
      status = this.createInitialStreamStatus(kind, name);
      this.streamStatuses.set(key, status);
    }
    return status;
  }

  private resultForStream(name: string): {
    name: string;
    status: "fulfilled" | "rejected";
    error?: Error;
  } {
    return {
      name,
      status: "fulfilled",
    };
  }

  private createObserver(kind: IndexerStreamKind, name: string, endpointLabel?: string): ProcessorStatusObserver {
    const status = this.statusFor(kind, name);
    let startSlot: bigint | null = null;
    let checkpointSlot: bigint | null = null;

    return {
      onStart: (info) => {
        startSlot = info.startSlot ?? null;
        checkpointSlot = info.checkpointSlot ?? null;
        status.state = "running";
        status.checkpointSlot = checkpointSlot === null ? null : checkpointSlot.toString();
        status.lastStartedAt = new Date().toISOString();
      },
      onRecord: (info) => {
        status.counters.eventsReceived++;
        status.lastEventAt = new Date().toISOString();
        if (info.slot !== undefined && info.slot !== null) {
          status.lastProcessedSlot = info.slot.toString();
        }
      },
      onParserNull: () => {
        status.counters.parserNulls++;
      },
      onParserError: () => {
        status.counters.parserErrors++;
      },
      onParseValidationError: () => {
        status.counters.parseValidationErrors++;
      },
      onBatchCommitted: (info) => {
        status.counters.batchesCommitted++;
        status.counters.recordsProcessed += info.count;
        status.lastProcessedSlot = info.slot.toString();
        status.lastEventAt = new Date().toISOString();
      },
      onCheckpoint: (info) => {
        status.checkpointSlot = info.slot.toString();
        status.lastProcessedSlot = info.slot.toString();
      },
      onError: (phase, error) => {
        if (phase === "commit") status.counters.commitErrors++;
        if (phase === "filterBatch") status.counters.filterBatchErrors++;
        if (phase === "onCommit") status.counters.onCommitErrors++;
        status.lastErrorAt = new Date().toISOString();
        status.lastError = normalizeIndexerError({
          error,
          phase,
          streamName: name,
          streamKind: kind,
          startSlot,
          checkpointSlot,
          endpointLabel,
        });
      },
    };
  }

  private async runEventStreamSupervisor(
    stream: EventStream,
    processorOptions: Omit<Parameters<typeof runEventStreamProcessor>[1], "observer">,
    supervisorOptions: { endpointLabel?: string; initialBackoffMs: number; maxBackoffMs: number }
  ): Promise<void> {
    await this.runStreamSupervisor("event", stream.name, supervisorOptions, async (observer) => {
      const result = await runEventStreamProcessor(
        stream,
        { ...processorOptions, observer },
        this.abortController!.signal
      );
      return `processed ${result.eventsProcessed} event(s) in ${result.batchesCommitted} batch(es)`;
    });
  }

  private async runAccountStreamSupervisor(
    stream: AccountStream,
    processorOptions: Omit<Parameters<typeof runAccountStreamProcessor>[1], "observer">,
    supervisorOptions: { endpointLabel?: string; initialBackoffMs: number; maxBackoffMs: number }
  ): Promise<void> {
    await this.runStreamSupervisor("account", stream.name, supervisorOptions, async (observer) => {
      const result = await runAccountStreamProcessor(
        stream,
        { ...processorOptions, observer },
        this.abortController!.signal
      );
      return `processed ${result.accountsProcessed} account event(s), updated ${result.accountsUpdated}, deleted ${result.accountsDeleted}`;
    });
  }

  private async runStreamSupervisor(
    kind: IndexerStreamKind,
    name: string,
    options: { endpointLabel?: string; initialBackoffMs: number; maxBackoffMs: number },
    runOnce: (observer: ProcessorStatusObserver) => Promise<string>
  ): Promise<void> {
    let attempt = 0;
    const status = this.statusFor(kind, name);

    while (!this.abortController?.signal.aborted) {
      const observer = this.createObserver(kind, name, options.endpointLabel);
      status.state = attempt === 0 ? "starting" : "retrying";
      status.lastStartedAt = new Date().toISOString();

      try {
        const summary = await runOnce(observer);
        if (this.abortController?.signal.aborted) {
          status.state = "stopped";
          console.log(`[indexer] ${kind} stream "${name}" stopped: ${summary}`);
          return;
        }

        throw new Error(`${kind} stream "${name}" completed unexpectedly: ${summary}`);
      } catch (error) {
        if (this.abortController?.signal.aborted) {
          status.state = "stopped";
          return;
        }

        status.restartCount++;
        status.state = "retrying";
        status.lastErrorAt = new Date().toISOString();
        if (!status.lastError || status.lastError.phase === "supervisor") {
          status.lastError = normalizeIndexerError({
            error,
            phase: "supervisor",
            streamName: name,
            streamKind: kind,
            endpointLabel: options.endpointLabel,
          });
        }

        const backoffMs = this.supervisorBackoffMs(attempt, options.initialBackoffMs, options.maxBackoffMs);
        console.error(
          `[indexer] ${kind} stream "${name}" failed; restarting in ${backoffMs}ms:`,
          error
        );
        attempt++;
        await this.delay(backoffMs, this.abortController!.signal);
      }
    }

    status.state = "stopped";
  }

  private supervisorBackoffMs(attempt: number, initialMs: number, maxMs: number): number {
    const base = Math.min(maxMs, initialMs * Math.pow(2, attempt));
    const jitter = Math.floor(base * 0.2 * Math.random());
    return base + jitter;
  }

  private isStreamStale(stream: IndexerStreamStatus, nowMs: number): boolean {
    const staleMs = this.config.streamStaleMs ?? 300000;
    if (staleMs <= 0 || stream.state !== "running") {
      return false;
    }

    const activityAt = stream.lastEventAt ?? stream.lastStartedAt;
    if (!activityAt) {
      return true;
    }

    const activityMs = Date.parse(activityAt);
    return !Number.isFinite(activityMs) || nowMs - activityMs > staleMs;
  }

  private delay(ms: number, signal: AbortSignal): Promise<void> {
    if (ms <= 0 || signal.aborted) return Promise.resolve();
    return new Promise((resolve) => {
      const onAbort = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      timer.unref?.();
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }
}
