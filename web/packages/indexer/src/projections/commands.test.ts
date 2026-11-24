import { afterEach, describe, expect, it, vi } from 'vitest';
import { listEventRange, runReconcile, setDivergence } from './commands';

describe('reconcile building blocks', () => {
  afterEach(() => { process.exitCode = 0; vi.restoreAllMocks(); });
  it('reports a set difference with samples and counts, or nothing', () => {
    expect(setDivergence('seats', 'm', ['a', 'b'], ['a', 'b'])).toBeNull();
    expect(setDivergence('seats', 'm', ['a', 'b'], ['b', 'c'])).toEqual({
      check: 'seats', market: 'm', detail: { missingFromIndexer: ['a'], extraInIndexer: ['c'], missing: 1, extra: 1 },
    });
  });
  it('lists the events of a slot range page by page, and refuses an unbounded pass', async () => {
    const requests: any[] = [];
    const pages = [
      { events: [{ eventId: 'a', slot: 4n }, { eventId: 'b', slot: 5n }], page: { nextPageToken: 't' } },
      { events: [{ eventId: 'c', slot: 9n }, { eventId: 'd', slot: 11n }], page: {} },
    ];
    const client = { listEvents: async (r: any) => { requests.push(r); return pages[requests.length - 1]; } };
    const events = await listEventRange(client as any, { expression: 'p' }, 5n, 10n, 10);
    expect(events.map(e => e.eventId)).toEqual(['b', 'c']);
    expect(requests.map(r => [r.filter.expression, r.page.pageToken])).toEqual([
      ['(event.slot >= uint(5)) && (event.slot <= uint(10)) && (p)', undefined], ['(event.slot >= uint(5)) && (event.slot <= uint(10)) && (p)', 't'],
    ]);
    requests.length = 0;
    await expect(listEventRange(client as any, { expression: 'p' }, 0n, 99n, 1)).rejects.toThrow('History too large');
  });
  it('exits 0 when consistent, 2 on a divergence and 1 on an error', async () => {
    const lines: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((l: any) => { lines.push(String(l)); return true; });
    await runReconcile('svc', async () => ({ ok: true }));
    expect(process.exitCode).toBe(0);
    await runReconcile('svc', async () => ({ ok: false }));
    expect(process.exitCode).toBe(2);
    await runReconcile('svc', async () => { throw new Error('rpc down'); });
    expect(process.exitCode).toBe(1);
    expect(lines.map(l => JSON.parse(l))).toEqual([
      { event: 'indexer_reconcile', service: 'svc', ok: true }, { event: 'indexer_reconcile', service: 'svc', ok: false },
      { event: 'indexer_reconcile_failed', service: 'svc', message: 'rpc down' },
    ]);
  });
});
