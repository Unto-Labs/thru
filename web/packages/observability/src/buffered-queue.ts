import { utf8ByteLength } from './utf8';

export const DEFAULT_MAX_BATCH_EVENTS = 20;
export const DEFAULT_MAX_BATCH_BYTES = 60 * 1024;
export const DEFAULT_FLUSH_INTERVAL_MS = 2_000;
export const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
export const DEFAULT_MAX_QUEUED_EVENTS = 200;

/**
 * The result of one batch upload attempt.
 * - 'success': the batch was accepted; the queue drains further batches.
 * - 'retry': a transient failure; events are restored for a later attempt.
 * - 'drop': a permanent rejection; the batch is discarded without retrying.
 */
export type UploadOutcome = 'success' | 'retry' | 'drop';

export interface BatchTransport {
  /** Upload one serialized batch. Must never throw synchronously. */
  send(body: string, signal: AbortSignal | undefined): Promise<UploadOutcome>;
  /**
   * Optional synchronous best-effort upload used during page teardown
   * (e.g. navigator.sendBeacon). Returns whether the batch was handed off.
   */
  sendSync?(body: string): boolean;
}

export interface BufferedEventQueueOptions<TEvent> {
  transport: BatchTransport;
  /** Serialize a batch of events into the request body. */
  serializeBatch(events: TEvent[]): string;
  /** Maximum events per upload. Defaults to 20. */
  maxBatchEvents?: number;
  /** Maximum serialized batch size in UTF-8 bytes. Defaults to 60 KiB. */
  maxBatchBytes?: number;
  /** Background flush cadence. Defaults to 2000ms. */
  flushIntervalMs?: number;
  /** Per-upload abort timeout. Defaults to 10s. */
  requestTimeoutMs?: number;
  /** Ring-buffer capacity; oldest events are dropped first. Defaults to 200. */
  maxQueuedEvents?: number;
  /**
   * Eagerly upload whenever a full batch is queued (and keep draining full
   * batches after a success) instead of waiting for the flush timer.
   */
  flushOnFullBatch?: boolean;
  /**
   * Cap for exponential retry backoff after transient failures. When omitted
   * or 0, failed batches simply wait for the next flush without backoff.
   */
  maxRetryDelayMs?: number;
  /** First retry backoff delay. Defaults to 2000ms. */
  initialRetryDelayMs?: number;
  now?: () => number;
}

/**
 * Transport-agnostic delivery pipeline shared by every telemetry producer:
 * a bounded ring buffer with size/byte-capped batches, a lazy background
 * flush timer, single-flight uploads with abort timeouts, optional
 * exponential retry backoff, and a synchronous teardown path.
 *
 * Delivery is best effort and at-least-once: events may be dropped under
 * pressure and may be duplicated when a timed-out upload actually landed.
 */
export class BufferedEventQueue<TEvent> {
  private readonly transport: BatchTransport;
  private readonly serializeBatch: (events: TEvent[]) => string;
  private readonly maxBatchEvents: number;
  private readonly maxBatchBytes: number;
  private readonly flushIntervalMs: number;
  private readonly requestTimeoutMs: number;
  private readonly maxQueuedEvents: number;
  private readonly flushOnFullBatch: boolean;
  private readonly maxRetryDelayMs: number;
  private readonly initialRetryDelayMs: number;
  private readonly now: () => number;

  private queue: TEvent[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private flushing = false;
  private generation = 0;
  private activeAbortController: AbortController | null = null;
  private consecutiveFailures = 0;
  private retryNotBefore = 0;

  constructor(options: BufferedEventQueueOptions<TEvent>) {
    this.transport = options.transport;
    this.serializeBatch = options.serializeBatch;
    this.maxBatchEvents = options.maxBatchEvents ?? DEFAULT_MAX_BATCH_EVENTS;
    this.maxBatchBytes = options.maxBatchBytes ?? DEFAULT_MAX_BATCH_BYTES;
    this.flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.maxQueuedEvents = options.maxQueuedEvents ?? DEFAULT_MAX_QUEUED_EVENTS;
    this.flushOnFullBatch = options.flushOnFullBatch ?? false;
    this.maxRetryDelayMs = options.maxRetryDelayMs ?? 0;
    this.initialRetryDelayMs = options.initialRetryDelayMs ?? DEFAULT_FLUSH_INTERVAL_MS;
    this.now = options.now ?? Date.now;
  }

  get size(): number {
    return this.queue.length;
  }

  /** A copy of the currently queued events, oldest first. */
  snapshot(): TEvent[] {
    return [...this.queue];
  }

  /** Queue an event, dropping the oldest when the ring buffer is full. */
  enqueue(event: TEvent): void {
    while (this.queue.length >= this.maxQueuedEvents) {
      this.queue.shift();
    }
    this.queue.push(event);
    this.startTimer();
    if (this.flushOnFullBatch && this.queue.length >= this.maxBatchEvents) {
      void this.flush();
    }
  }

  /**
   * Upload at most one batch. Uploads are single-flight; remaining events
   * wait for the next flush or timer tick. This promise intentionally never
   * rejects.
   */
  async flush(ignoreRetryDelay = false): Promise<void> {
    if (
      this.flushing ||
      this.queue.length === 0 ||
      (!ignoreRetryDelay && this.now() < this.retryNotBefore)
    ) {
      return;
    }

    this.flushing = true;
    const generation = this.generation;
    const { events, body } = this.takeBatch();
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    this.activeAbortController = controller;
    const timeout = controller
      ? setTimeout(() => controller.abort(), this.requestTimeoutMs)
      : null;
    let outcome: UploadOutcome = 'retry';
    try {
      outcome = await this.transport.send(body, controller?.signal);
    } catch {
      outcome = 'retry';
    } finally {
      if (timeout) clearTimeout(timeout);
      if (this.activeAbortController === controller) this.activeAbortController = null;
      this.flushing = false;
    }

    if (generation !== this.generation) {
      return;
    }
    if (outcome === 'retry') {
      this.restoreFailedBatch(events);
      this.scheduleRetry();
    } else {
      this.resetRetryState();
    }
    if (this.queue.length === 0) {
      this.stopTimer();
    } else if (
      this.flushOnFullBatch &&
      outcome === 'success' &&
      this.queue.length >= this.maxBatchEvents
    ) {
      void this.flush();
    }
  }

  /**
   * Synchronously hand off every queued batch via the transport's teardown
   * path. Returns whether the queue fully drained; callers should fall back
   * to flush(true) when it did not.
   */
  flushSync(): boolean {
    if (this.queue.length === 0) return true;
    if (!this.transport.sendSync) return false;

    while (this.queue.length > 0) {
      const { events, body } = this.takeBatch();
      let sent = false;
      try {
        sent = this.transport.sendSync(body);
      } catch {
        sent = false;
      }
      if (!sent) {
        this.restoreFailedBatch(events);
        return false;
      }
    }
    this.resetRetryState();
    this.stopTimer();
    return true;
  }

  /** Abort any in-flight upload and discard all queued events. */
  clear(): void {
    this.generation += 1;
    this.activeAbortController?.abort();
    this.queue = [];
    this.resetRetryState();
    this.stopTimer();
  }

  /** Stop the background flush timer without touching queued events. */
  stopTimer(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  private startTimer(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.flush(), this.flushIntervalMs);
    /* Avoid keeping Node-based test and server-side processes alive. */
    const timerWithUnref = this.timer as unknown as { unref?: () => void };
    timerWithUnref.unref?.();
  }

  private takeBatch(): { events: TEvent[]; body: string } {
    const events: TEvent[] = [];
    let body = this.serializeBatch(events);

    while (events.length < this.maxBatchEvents && this.queue.length > 0) {
      const next = this.queue[0];
      const candidateBody = this.serializeBatch([...events, next]);
      if (events.length > 0 && utf8ByteLength(candidateBody) > this.maxBatchBytes) {
        break;
      }
      events.push(next);
      this.queue.shift();
      body = candidateBody;
    }

    return { events, body };
  }

  private restoreFailedBatch(events: TEvent[]): void {
    this.queue = [...events, ...this.queue].slice(0, this.maxQueuedEvents);
  }

  private scheduleRetry(): void {
    if (this.maxRetryDelayMs <= 0) return;
    this.consecutiveFailures += 1;
    const delay = Math.min(
      this.maxRetryDelayMs,
      this.initialRetryDelayMs * 2 ** (this.consecutiveFailures - 1),
    );
    this.retryNotBefore = this.now() + delay;
  }

  private resetRetryState(): void {
    this.consecutiveFailures = 0;
    this.retryNotBefore = 0;
  }
}
