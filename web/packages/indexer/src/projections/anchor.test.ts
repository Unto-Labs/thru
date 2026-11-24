import { describe, expect, it } from 'vitest';
import { BlockView } from '@thru/sdk/proto';
import { blockHashReader, defineAnchorRefresh, highestSlot, latestAnchor } from './anchor';

describe('chain anchor reads', () => {
  const header = (slot: bigint) => ({ header: { slot, blockHash: { value: new Uint8Array([Number(slot % 256n), 1]) } } });
  it('asks for block headers only and returns the hash at the slot, or null', async () => {
    const requests: any[] = [];
    const client = { listBlocks: async (r: any) => { requests.push(r); return { blocks: r.filter.params.slot.kind.value === 7n ? [header(7n)] : [] }; } };
    expect(await blockHashReader(client as any)(7n)).toBe('0701');
    expect(await blockHashReader(client as any)(8n)).toBeNull();
    expect(requests.map(r => r.view)).toEqual([BlockView.HEADER_ONLY, BlockView.HEADER_ONLY]);
  });
  it('anchors to the finalized head or the nearest block below it', async () => {
    const client = { getHeight: async () => ({ finalized: 10n }), listBlocks: async (r: any) => ({ blocks: r.filter.params.slot.kind.value === 8n ? [header(8n)] : [] }) };
    expect(await latestAnchor(client as any)).toEqual({ slot: 8n, hash: '0801' });
  });
  it('takes the highest of the finalized and executed heights', () => {
    expect(highestSlot({ finalized: 5n, locallyExecuted: 9n, clusterExecuted: 7n })).toBe(9n);
    expect(highestSlot({ finalized: 5n })).toBe(5n);
  });
  it('moves the anchor only once the epoch serves reads', async () => {
    const recorded: [bigint, string][] = [];
    const writer = { epochReady: false, anchorHolds: async () => true, recordAnchor: async (slot: bigint, hash: string) => { recorded.push([slot, hash]); return true; } };
    const client = { getHeight: async () => ({ finalized: 9n }), listBlocks: async (r: any) => ({ blocks: [header(r.filter.params.slot.kind.value)] }), close() {} };
    const refresh = async () => {
      const lane = defineAnchorRefresh({ name: 'anchor', writer: writer as any, intervalMs: 60_000 });
      const stop = new AbortController();
      const run = lane.run(() => client as any, stop.signal, { onRecord: () => stop.abort() });
      await run;
    };
    await refresh();
    expect(recorded).toEqual([]);
    writer.epochReady = true;
    await refresh();
    expect(recorded).toEqual([[9n, '0901']]);
  });
});
