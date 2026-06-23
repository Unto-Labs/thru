/**
 * Runtime status and health types for the indexer supervisor.
 */

export type IndexerStreamKind = "event" | "account";

export type IndexerStreamState =
  | "idle"
  | "starting"
  | "running"
  | "retrying"
  | "stopped";

export type IndexerErrorPhase =
  | "starting"
  | "backfill"
  | "live"
  | "parse"
  | "commit"
  | "filterBatch"
  | "onCommit"
  | "supervisor";

export interface NormalizedIndexerError {
  name: string;
  message: string;
  code?: string | number;
  phase: IndexerErrorPhase;
  retryable: boolean;
  streamName: string;
  streamKind: IndexerStreamKind;
  startSlot?: string;
  checkpointSlot?: string;
  endpointLabel?: string;
}

export interface IndexerStreamCounters {
  eventsReceived: number;
  parserNulls: number;
  parserErrors: number;
  parseValidationErrors: number;
  commitErrors: number;
  filterBatchErrors: number;
  onCommitErrors: number;
  recordsProcessed: number;
  batchesCommitted: number;
}

export interface IndexerStreamStatus {
  name: string;
  kind: IndexerStreamKind;
  state: IndexerStreamState;
  checkpointSlot: string | null;
  lastProcessedSlot: string | null;
  lastEventAt: string | null;
  stale: boolean;
  restartCount: number;
  lastStartedAt: string | null;
  lastErrorAt: string | null;
  lastError: NormalizedIndexerError | null;
  counters: IndexerStreamCounters;
}

export interface IndexerStatus {
  running: boolean;
  shutdownRequested: boolean;
  startedAt: string | null;
  uptimeMs: number;
  healthy: boolean;
  streams: IndexerStreamStatus[];
}

export interface ProcessorStatusObserver {
  onStart?(info: {
    startSlot?: bigint;
    checkpointSlot?: bigint | null;
  }): void;
  onRecord?(info: {
    slot?: bigint | null;
    id?: string | null;
  }): void;
  onParserNull?(): void;
  onParserError?(error: unknown): void;
  onParseValidationError?(error: string): void;
  onBatchCommitted?(info: {
    slot: bigint;
    count: number;
  }): void;
  onCheckpoint?(info: {
    slot: bigint;
  }): void;
  onError?(phase: IndexerErrorPhase, error: unknown): void;
}

export function emptyStreamCounters(): IndexerStreamCounters {
  return {
    eventsReceived: 0,
    parserNulls: 0,
    parserErrors: 0,
    parseValidationErrors: 0,
    commitErrors: 0,
    filterBatchErrors: 0,
    onCommitErrors: 0,
    recordsProcessed: 0,
    batchesCommitted: 0,
  };
}

export function cloneStreamStatus(status: IndexerStreamStatus): IndexerStreamStatus {
  return {
    ...status,
    lastError: status.lastError ? { ...status.lastError } : null,
    counters: { ...status.counters },
  };
}

export function normalizeIndexerError(input: {
  error: unknown;
  phase: IndexerErrorPhase;
  streamName: string;
  streamKind: IndexerStreamKind;
  startSlot?: bigint | null;
  checkpointSlot?: bigint | null;
  endpointLabel?: string;
}): NormalizedIndexerError {
  const err = input.error;
  const maybeRecord = err && typeof err === "object" ? err as Record<string, unknown> : {};
  const name = err instanceof Error ? err.name : typeof maybeRecord.name === "string" ? maybeRecord.name : "Error";
  const message = err instanceof Error ? err.message : String(err);
  const code = typeof maybeRecord.code === "string" || typeof maybeRecord.code === "number"
    ? maybeRecord.code
    : undefined;
  const retryable = isRetryablePhase(input.phase);

  return {
    name,
    message,
    code,
    phase: input.phase,
    retryable,
    streamName: input.streamName,
    streamKind: input.streamKind,
    startSlot: input.startSlot === undefined || input.startSlot === null ? undefined : input.startSlot.toString(),
    checkpointSlot: input.checkpointSlot === undefined || input.checkpointSlot === null ? undefined : input.checkpointSlot.toString(),
    endpointLabel: input.endpointLabel,
  };
}

function isRetryablePhase(phase: IndexerErrorPhase): boolean {
  switch (phase) {
    case "starting":
    case "backfill":
    case "live":
    case "commit":
    case "supervisor":
      return true;
    case "parse":
    case "filterBatch":
    case "onCommit":
      return false;
  }
}
