import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { connectIndexer, encodeIndexerCursor, type IndexerBatch } from './index';
class Source extends EventTarget {
  static all: Source[] = [];
  onerror: (() => void) | null = null;
  onopen: (() => void) | null = null;
  closed = false;
  readyState = 0;
  constructor(readonly url: URL) { super(); Source.all.push(this); }
  close() { this.closed = true; this.readyState = 2; }
  /** The server answered with another status than 200: the source closes before it opens. */
  refuse() { this.readyState = 2; this.onerror?.(); }
  batch(seq: string, messages: { operation: string }[] = [], epoch = '1') {
    this.dispatchEvent(new MessageEvent('batch', { lastEventId: cursor(seq, epoch), data: JSON.stringify({
      epoch, messages,
    }) }));
  }
}
const cursor = (seq: string, epoch = '1') => encodeIndexerCursor({ epoch, filter: 'market', cuts: { market: seq, owner: '20' } });
const schema = { parse: (v: unknown) => v as IndexerBatch };
const connections: {close(): void}[] = [];
function connect(applyBatch = vi.fn(), onResync = vi.fn(), onError?: (e: unknown) => void) {
  const c = connectIndexer({ url: 'https://app.example/api/perps/v1/stream', scope: {topics: ['market', 'owner']},
    resume: cursor('10'), schema, applyBatch, onResync, onError });
  connections.push(c);
  return c;
}
beforeEach(() => { Source.all = []; vi.useFakeTimers(); vi.stubGlobal('EventSource', Source); });
afterEach(() => { for (const c of connections.splice(0)) c.close(); vi.unstubAllGlobals(); vi.useRealTimers(); });
it('reconnects from the last fully applied cursor after application failure', async () => {
  const apply = vi.fn().mockImplementationOnce(() => {}).mockImplementationOnce(() => { throw new Error('apply failed'); });
  const c = connect(apply);
  Source.all[0].batch('11');
  await vi.advanceTimersByTimeAsync(0);
  Source.all[0].batch('12');
  await vi.advanceTimersByTimeAsync(1000);
  expect(c.resume).toBe(cursor('11'));
  expect(Source.all[0].closed).toBe(true);
  expect(Source.all[1].url.searchParams.get('after')).toBe(cursor('11'));
  Source.all[1].batch('12');
  await vi.advanceTimersByTimeAsync(0);
  expect(c.resume).toBe(cursor('12'));
});
it('serializes async application and advances empty filtered batches without losing per-topic positions', async () => {
  let release!: () => void;
  const first = new Promise<void>(resolve => { release = resolve; });
  const apply = vi.fn().mockReturnValueOnce(first);
  const c = connect(apply);
  Source.all[0].batch('11'); Source.all[0].batch('12');
  await vi.advanceTimersByTimeAsync(0);
  expect(apply).toHaveBeenCalledTimes(1);
  expect(c.resume).toBe(cursor('10'));
  release();
  await vi.advanceTimersByTimeAsync(0);
  expect(apply).toHaveBeenCalledTimes(2);
  expect(c.resume).toBe(cursor('12'));
});
it('does not advance an obsolete connection after a scope change or disconnect', async () => {
  let release!: () => void;
  const c = connect(vi.fn(() => new Promise<void>(r => { release = r; })));
  Source.all[0].batch('11');
  await vi.advanceTimersByTimeAsync(0);
  c.close();
  const next = connect();
  release();
  await vi.advanceTimersByTimeAsync(50000);
  expect(c.resume).toBe(cursor('10'));
  expect(next.resume).toBe(cursor('10'));
  expect(Source.all).toHaveLength(2);
});
it('requires a new bootstrap for an epoch change (reset) and expired history', async () => {
  const reset = vi.fn(), apply = vi.fn();
  const c = connect(apply, reset);
  Source.all[0].batch('11', [], '2');
  await vi.advanceTimersByTimeAsync(0);
  expect(reset).toHaveBeenCalledTimes(1); expect(apply).not.toHaveBeenCalled();
  expect(c.resume).toBe(cursor('10'));
  connect(apply, reset);
  Source.all[1].dispatchEvent(new Event('resync_required'));
  expect(reset).toHaveBeenCalledTimes(2);
});
it('reconnects on network errors without native EventSource advancing application state', async () => {
  const c = connect();
  Source.all[0].onerror!();
  await vi.advanceTimersByTimeAsync(1000);
  expect(Source.all[0].closed).toBe(true);
  expect(Source.all[1].url.searchParams.get('after')).toBe(c.resume);
  c.close();
  await vi.advanceTimersByTimeAsync(60000);
  expect(Source.all).toHaveLength(2);
});
it('uses heartbeats to detect dead connections and disposes the watchdog', async () => {
  const reset = vi.fn();
  connect(vi.fn(), reset);
  await vi.advanceTimersByTimeAsync(30000);
  Source.all[0].dispatchEvent(new Event('heartbeat'));
  await vi.advanceTimersByTimeAsync(30000);
  expect(reset).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(15000);
  expect(reset).toHaveBeenCalledTimes(1);
  expect(Source.all[0].closed).toBe(true);
});
it('ignores queued events from a closed source after reconnection', async () => {
  const apply = vi.fn(), reset = vi.fn();
  const c = connect(apply, reset);
  const old = Source.all[0];
  old.onerror!();
  await vi.advanceTimersByTimeAsync(1000);
  old.batch('11');
  old.onerror!();
  old.dispatchEvent(new Event('resync_required'));
  await vi.advanceTimersByTimeAsync(0);
  expect(apply).not.toHaveBeenCalled();
  expect(reset).not.toHaveBeenCalled();
  expect(Source.all[1].closed).toBe(false);
  expect(c.resume).toBe(cursor('10'));
  c.close();
  old.dispatchEvent(new Event('heartbeat'));
  expect(vi.getTimerCount()).toBe(0);
});
/* F-E2: a resume cursor of another scope is a client error (400
   CURSOR_SCOPE_MISMATCH), not a reset (409 EPOCH_CHANGED). EventSource hides
   the status; the transport reads it once and reports a 400 instead of
   reconnecting into a resync. */
const answer = (status: number, body: unknown) => vi.fn(async () => Response.json(body, { status }));
it('reports a stream refused with 400 as a client error: no resync, no retry', async () => {
  const fetch = answer(400, { error: { code: 'CURSOR_SCOPE_MISMATCH', message: 'The resume cursor was issued for another stream scope' } });
  vi.stubGlobal('fetch', fetch);
  const reset = vi.fn(), error = vi.fn();
  const c = connect(vi.fn(), reset, error);
  Source.all[0].refuse();
  await vi.advanceTimersByTimeAsync(0);
  expect(String((fetch.mock.calls[0] as unknown[])[0])).toBe(String(Source.all[0].url));
  expect(error).toHaveBeenCalledWith({ status: 400, code: 'CURSOR_SCOPE_MISMATCH', message: 'The resume cursor was issued for another stream scope' });
  await vi.advanceTimersByTimeAsync(60000);
  expect(reset).not.toHaveBeenCalled();
  expect(Source.all).toHaveLength(1);
  expect(c.resume).toBe(cursor('10'));
});
it('reconnects as before when a refused stream is not a client error', async () => {
  vi.stubGlobal('fetch', answer(503, { error: { code: 'NOT_READY', message: 'No ready epoch' } }));
  const reset = vi.fn(), error = vi.fn();
  connect(vi.fn(), reset, error);
  for (let i = 0; i < 3; i++) {
    Source.all[i].refuse();
    await vi.advanceTimersByTimeAsync(10000);
  }
  expect(error).not.toHaveBeenCalled();
  expect(Source.all).toHaveLength(3);
  expect(reset).toHaveBeenCalledTimes(1);
});
it('does not probe without an error handler, nor for a stream that had opened', async () => {
  const fetch = answer(400, { error: { code: 'CURSOR_SCOPE_MISMATCH', message: 'x' } });
  vi.stubGlobal('fetch', fetch);
  connect();
  Source.all[0].refuse();
  await vi.advanceTimersByTimeAsync(1000);
  const error = vi.fn();
  connect(vi.fn(), vi.fn(), error);
  const opened = Source.all.at(-1)!;
  opened.onopen!();
  opened.refuse();
  await vi.advanceTimersByTimeAsync(1000);
  expect(fetch).not.toHaveBeenCalled();
  expect(error).not.toHaveBeenCalled();
  expect(Source.all).toHaveLength(4);
});
