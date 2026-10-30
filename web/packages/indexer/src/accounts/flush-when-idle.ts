/* Resolves true if `pending` is still unsettled after `ms`. */
function idleFor(pending: Promise<unknown>, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(true), ms);
    const settle = () => {
      clearTimeout(timer);
      resolve(false);
    };
    pending.then(settle, settle);
  });
}

/* Yields `source` unchanged, and calls `flush` whenever `hasPending()` is true
   and no item has arrived for `idleMs`. The next item is requested only after
   the consumer has handled the previous one, so `flush` never runs alongside
   the consumer's own writes. */
export async function* flushWhenIdle<T>(
  source: AsyncIterable<T>,
  idleMs: number,
  hasPending: () => boolean,
  flush: () => Promise<void>,
): AsyncGenerator<T> {
  const iterator = source[Symbol.asyncIterator]();
  let next: Promise<IteratorResult<T>> | null = null;
  try {
    for (;;) {
      next = iterator.next();
      while (hasPending() && (await idleFor(next, idleMs))) await flush();
      const result = await next;
      next = null;
      if (result.done) return;
      yield result.value;
    }
  } finally {
    /* A next() still pending (a failed flush) would hold return() back until
       the source ends, so close without waiting on it then. */
    const closing = iterator.return?.()?.catch(() => {});
    if (!next) await closing;
  }
}
