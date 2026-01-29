/**
 * Retry utilities for stream reconnection with exponential backoff.
 */

export interface RetryConfig {
  /** Initial delay before first retry (default: 1000ms) */
  initialDelayMs: number;
  /** Maximum delay between retries (default: 30000ms) */
  maxDelayMs: number;
  /** Timeout for connection/read operations (default: 30000ms) */
  connectionTimeoutMs: number;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  connectionTimeoutMs: 30000,
};

/**
 * Calculate exponential backoff delay for a given attempt number.
 * Starts at initialDelayMs and doubles each attempt, capped at maxDelayMs.
 *
 * @param attempt - Zero-based attempt number (0 = first retry)
 * @param config - Retry configuration
 * @returns Delay in milliseconds
 */
export function calculateBackoff(attempt: number, config: RetryConfig): number {
  const delay = config.initialDelayMs * Math.pow(2, attempt);
  return Math.min(delay, config.maxDelayMs);
}

/**
 * Wrap a promise with a timeout. Rejects with TimeoutError if the promise
 * doesn't resolve within the specified time.
 *
 * @param promise - Promise to wrap
 * @param timeoutMs - Timeout in milliseconds
 * @returns Promise that resolves with the original value or rejects on timeout
 */
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new TimeoutError(`Operation timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

/**
 * Error thrown when an operation times out.
 */
export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimeoutError";
  }
}

/**
 * Delay execution for a specified number of milliseconds.
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
