import type { ProjectionRuntime } from "../projections/define";
import type { ChainClientFactory, ReplayLogger } from "@thru/replay";
import type { DatabaseClient } from "../schema/types";
import type { EventStream } from "../streams/types";
import type { AccountStream } from "../accounts/types";

/**
 * Configuration for the Indexer runtime.
 */
export interface IndexerConfig {
  /** Optional best-effort metrics observer. Stream labels are deployment-owned. */
  telemetry?: { record(name: "apps.indexer.consumed" | "apps.indexer.checkpoint" | "apps.indexer.last_progress_timestamp" | "apps.indexer.records" | "apps.indexer.retries" | "apps.dependency.requests" | "apps.dependency.errors" | "apps.dependency.duration", attributes: Record<string, unknown>, value?: number): void };
  /** Required for ordinary account/event streams; projections own their writer. */
  db?: DatabaseClient;

  /** Factory to create fresh chain clients for reconnection */
  clientFactory: ChainClientFactory;

  /** Transactional projections share the ordinary stream supervisor. */
  projections?: ProjectionRuntime[];

  /** Event streams to run */
  eventStreams?: EventStream<any>[];

  /** Account streams to run */
  accountStreams?: AccountStream<any>[];

  /** Default start slot if no checkpoint exists (default: 0n) */
  defaultStartSlot?: bigint;

  /** Safety margin for finality in slots (default: 64) */
  safetyMargin?: number;

  /** Page size for fetching events (default: 512) */
  pageSize?: number;

  /** Log level (default: "info") */
  logLevel?: "debug" | "info" | "warn" | "error";

  /** Optional structured logger for runtime, processor, and replay lifecycle logs. */
  logger?: ReplayLogger;

  /** Human-readable endpoint label included in normalized stream errors */
  endpointLabel?: string;

  /** Initial supervisor restart backoff in milliseconds (default: 1000) */
  supervisorInitialBackoffMs?: number;

  /** Maximum supervisor restart backoff in milliseconds (default: 30000) */
  supervisorMaxBackoffMs?: number;

  /** Mark running streams stale when no activity is seen for this long (disabled by default, also disabled with 0) */
  streamStaleMs?: number;

  /**
   * Mark a stream stalled, and the indexer unhealthy, when one batch has spent
   * this long in filterBatch or commit. Unlike streamStaleMs it does not
   * depend on event volume, so it suits sparse streams. Set it above any
   * bounded work a filterBatch hook does. Disabled by default, also disabled
   * with 0.
   */
  streamPhaseStallMs?: number;

  /**
   * Validate parse output at runtime using Zod schemas.
   * Useful for development to catch type mismatches early.
   * Disabled by default for performance in production.
   * @default false
   */
  validateParse?: boolean;
}
