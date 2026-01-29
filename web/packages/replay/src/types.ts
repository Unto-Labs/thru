export type Slot = bigint;

/**
 * Options for providing a client instance, a factory, or both.
 * At least one of client or clientFactory must be provided.
 */
export interface ClientOrFactory<T> {
  /** Client instance for initial connection. Optional if clientFactory provided. */
  client?: T;
  /** Factory to create fresh clients on reconnection. Enables robust reconnection. */
  clientFactory?: () => T;
}

/**
 * Resolve a client from ClientOrFactory options.
 * Prefers clientFactory if available, falls back to client.
 * @throws Error if neither client nor clientFactory is provided
 */
export function resolveClient<T>(
  opts: ClientOrFactory<T>,
  optionsName: string
): T {
  if (opts.clientFactory) {
    return opts.clientFactory();
  }
  if (!opts.client) {
    throw new Error(`${optionsName} requires either client or clientFactory`);
  }
  return opts.client;
}

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
  emittedReconnect: number;
  discardedDuplicates: number;
}

/**
 * Data sources returned by onReconnect callback.
 * Provides fresh functions that use a new client/transport.
 */
export interface ReconnectSources<T, Cursor = unknown> {
  subscribeLive: LiveSubscriber<T>;
  fetchBackfill?: BackfillFetcher<T, Cursor>;
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
  /**
   * Called on reconnection to get fresh data sources.
   * When provided, creates new client/transport for each reconnection attempt.
   */
  onReconnect?: () => ReconnectSources<T, Cursor>;
}
