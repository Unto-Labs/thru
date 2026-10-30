import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { connectIndexer, encodeIndexerCursor, type IndexerBatch } from './index';
class Source extends EventTarget {
  static all: Source[] = [];
  onerror: (() => void) | null = null;
  onopen: (() => void) | null = null;
  closed = false;
  constructor(readonly url: URL) { super(); Source.all.push(this); }
  close() { this.closed = true; }
  batch(seq: string, messages: { operation: string }[] = [], generation = '1') {
    this.dispatchEvent(new MessageEvent('batch', { lastEventId: cursor(seq, generation), data: JSON.stringify({
      namespace: 'n', sourceGeneration: '1', projectionGeneration: generation, messages,
    }) }));
  }
}
const cursor = (seq: string, generation = '1') => encodeIndexerCursor({ namespace: 'n', sourceGeneration: '1',
  projectionGeneration: generation, filter: 'market', cuts: { market: seq, owner: '20' } });
const schema = { parse: (v: unknown) => v as IndexerBatch };
const connections: {close(): void}[] = [];
function connect(applyBatch = vi.fn(), onResync = vi.fn()) {
  const c = connectIndexer({ url: 'https://app.example/api/perps/v1/stream', scope: {topics: ['market', 'owner']},
    resume: cursor('10'), schema, applyBatch, onResync });
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
it('requires a new bootstrap for generation changes and expired history', async () => {
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
