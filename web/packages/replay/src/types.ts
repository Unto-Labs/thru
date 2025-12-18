export type Slot = bigint;

export interface BackfillPage<T, Cursor = unknown> {
  items: T[];
  cursor?: Cursor;
  done?: boolean;
}

export type BackfillFetcher<T, Cursor = unknown> = (params: {
  startSlot: Slot;
  cursor?: Cursor;
}) => Promise<BackfillPage<T, Cursor>>;

export type LiveSubscriber<T> = (startSlot: Slot) => AsyncIterable<T>;

export interface ReplayLogger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export interface ReplayMetrics {
  bufferedItems: number;
  emittedBackfill: number;
  emittedLive: number;
  discardedDuplicates: number;
}

export interface ReplayConfig<T, Cursor = unknown> {
  startSlot: Slot;
  safetyMargin: bigint;
  fetchBackfill: BackfillFetcher<T, Cursor>;
  subscribeLive: LiveSubscriber<T>;
  extractSlot: (item: T) => Slot;
  extractKey?: (item: T) => string;
  logger?: ReplayLogger;
  resubscribeOnEnd?: boolean;
}
