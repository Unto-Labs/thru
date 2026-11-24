/* gRPC/Connect codes that mean the source could not be reached or shed the
   call, not that it answered: DeadlineExceeded (4), ResourceExhausted (8, a
   rate limit), Unavailable (14; a refused connection arrives as
   "[unavailable] connect ECONNREFUSED"). */
const UNREACHABLE_CODES = new Set([4, 8, 14]);
/* Node and undici errors of a connection that failed or broke. */
const UNREACHABLE_SYSTEM = new Set([
  "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EHOSTUNREACH", "ENETUNREACH", "EAI_AGAIN", "ENOTFOUND", "EPIPE",
  "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET",
]);

/** A connection-level failure to reach the source (the RPC), anywhere in
    the error's cause chain: retrying it at once only repeats it, so callers
    back off (`SourceBackoff`, or the runtime supervisor) instead. */
export function isSourceUnreachable(error: unknown, depth = 0): boolean {
  if (!error || typeof error !== "object" || depth > 8) return false;
  const e = error as { code?: unknown; cause?: unknown };
  if (typeof e.code === "number" && UNREACHABLE_CODES.has(e.code)) return true;
  if (typeof e.code === "string" && UNREACHABLE_SYSTEM.has(e.code)) return true;
  return e.cause !== undefined && e.cause !== error && isSourceUnreachable(e.cause, depth + 1);
}

/** Bounded exponential backoff with jitter, as the runtime supervisor's:
    `initialMs * 2^n` capped at `maxMs`, plus up to 20 % random jitter. */
export class SourceBackoff {
  private attempt = 0;
  constructor(private readonly options: { initialMs?: number; maxMs?: number; random?: () => number } = {}) {}
  /** The delay before the next attempt after another failure. */
  next(): number {
    const initial = this.options.initialMs ?? 1000, max = this.options.maxMs ?? 30_000;
    const base = Math.min(max, initial * 2 ** this.attempt);
    this.attempt++;
    return base + Math.floor(base * 0.2 * (this.options.random ?? Math.random)());
  }
  /** After a success: the next failure waits `initialMs` again. */
  reset() {
    this.attempt = 0;
  }
  /** The wait before reopening a stream: `steadyMs` after one that opened
      (the backoff starts over) or that failed for another reason, the next
      step after one that could not reach the source. */
  retryDelay(opened: boolean, failure: unknown, steadyMs: number): number {
    if (opened) this.reset();
    return !opened && isSourceUnreachable(failure) ? this.next() : steadyMs;
  }
  /** Failures since the last success. */
  get failures() {
    return this.attempt;
  }
}
