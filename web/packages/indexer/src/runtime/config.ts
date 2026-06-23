/**
 * Indexer configuration types.
 */

import type { ChainClientFactory } from "@thru/replay";
import type { DatabaseClient } from "../schema/types";
import type { EventStream } from "../streams/types";
import type { AccountStream } from "../accounts/types";

/**
 * Configuration for the Indexer runtime.
 */
export interface IndexerConfig {
  /** Database client */
  db: DatabaseClient;

  /** Factory to create fresh chain clients for reconnection */
  clientFactory: ChainClientFactory;

  /** Event streams to run */
  eventStreams?: EventStream[];

  /** Account streams to run */
  accountStreams?: AccountStream[];

  /** Default start slot if no checkpoint exists (default: 0n) */
  defaultStartSlot?: bigint;

  /** Safety margin for finality in slots (default: 64) */
  safetyMargin?: number;

  /** Page size for fetching events (default: 512) */
  pageSize?: number;

  /** Log level (default: "info") */
  logLevel?: "debug" | "info" | "warn" | "error";

  /** Human-readable endpoint label included in normalized stream errors */
  endpointLabel?: string;

  /** Initial supervisor restart backoff in milliseconds (default: 1000) */
  supervisorInitialBackoffMs?: number;

  /** Maximum supervisor restart backoff in milliseconds (default: 30000) */
  supervisorMaxBackoffMs?: number;

  /** Mark running streams unhealthy when no activity is seen for this long (default: 300000, disabled with 0) */
  streamStaleMs?: number;

  /**
   * Validate parse output at runtime using Zod schemas.
   * Useful for development to catch type mismatches early.
   * Disabled by default for performance in production.
   * @default false
   */
  validateParse?: boolean;
}
