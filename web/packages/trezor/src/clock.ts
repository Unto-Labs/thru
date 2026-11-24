/**
 * Time, injected so that tests control it. The link, the busy back-off and
 * the call timeout read the clock and set timers only through this interface.
 */
export interface Clock {
  /** Milliseconds on a clock that only moves forward. */
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** The platform's clock. */
export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Outcome of {@link waitFor}. */
export type Waited<T> = { kind: 'value'; value: T } | { kind: 'timeout' } | { kind: 'aborted' };

/**
 * Waits for `promise`, at most `ms` milliseconds on `clock`, and gives up at
 * once when `signal` fires. The promise itself is left alone: a timeout does
 * not cancel what it waits for.
 */
export function waitFor<T>(
  clock: Clock,
  promise: Promise<T>,
  ms: number,
  signal?: AbortSignal,
): Promise<Waited<T>> {
  return new Promise<Waited<T>>((resolve, reject) => {
    if (signal?.aborted) {
      resolve({ kind: 'aborted' });
      return;
    }
    let settled = false;
    const finish = (): void => {
      settled = true;
      clock.clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = (): void => {
      if (settled) return;
      finish();
      resolve({ kind: 'aborted' });
    };
    const timer = clock.setTimeout(() => {
      if (settled) return;
      finish();
      resolve({ kind: 'timeout' });
    }, Math.max(0, ms));
    signal?.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        if (settled) return;
        finish();
        resolve({ kind: 'value', value });
      },
      (error: unknown) => {
        if (settled) return;
        finish();
        reject(error);
      },
    );
  });
}

/** Sleeps `ms` milliseconds on `clock`; resolves `false` when `signal` fired first. */
export async function sleep(clock: Clock, ms: number, signal?: AbortSignal): Promise<boolean> {
  const never = new Promise<never>(() => undefined);
  const waited = await waitFor(clock, never, ms, signal);
  return waited.kind !== 'aborted';
}

/**
 * Settles with `promise`, or rejects with `onAbort()` as soon as `signal`
 * fires. The promise itself is left alone, as with {@link waitFor}.
 */
export function abortable<T>(promise: Promise<T>, signal: AbortSignal | undefined, onAbort: () => Error): Promise<T> {
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(onAbort());
      return;
    }
    const listener = (): void => reject(onAbort());
    signal.addEventListener('abort', listener, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', listener);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', listener);
        reject(error);
      },
    );
  });
}
