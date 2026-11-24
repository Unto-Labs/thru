import type { ChainClient } from '@thru/replay';
import { BlockView } from '@thru/sdk/proto';
import { defineRefresh } from './define';
import type { ProjectionWriter } from './writer';
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
/** The block hash at `slot` (hex), or null when the RPC has no block there. */
export function blockHashReader(client: Pick<ChainClient, 'listBlocks'>) {
  return async (slot: bigint): Promise<string | null> => {
    const page = await client.listBlocks({
      filter: { expression: 'block.header.slot == params.slot', params: { slot: { kind: { case: 'uintValue', value: slot } } } } as any,
      page: { pageSize: 1 } as any,
      /* Only the hash is needed; an unspecified view makes the RPC load the block body too. */
      view: BlockView.HEADER_ONLY,
    });
    const header = page.blocks?.[0]?.header;
    return header && header.slot === slot && header.blockHash?.value ? hex(header.blockHash.value) : null;
  };
}
/** A recent block to anchor the dataset to: the finalized head, or the
    nearest block below it (a slot may have none). */
export async function latestAnchor(client: Pick<ChainClient, 'listBlocks' | 'getHeight'>, lookback = 32) {
  const hashAt = blockHashReader(client);
  const { finalized } = await client.getHeight();
  for (let slot = finalized; slot > 0n && finalized - slot < BigInt(lookback); slot--) {
    const hash = await hashAt(slot);
    if (hash) return { slot, hash };
  }
  return null;
}
/** The chain's highest reported slot: the largest of the finalized and the
    executed heights an RPC reports (AcquireOptions.height, rewind checks). */
export function highestSlot(height: { finalized: bigint; locallyExecuted?: bigint; clusterExecuted?: bigint }): bigint {
  return [height.finalized, height.locallyExecuted, height.clusterExecuted]
    .filter((s): s is bigint => typeof s === 'bigint')
    .reduce((a, b) => (b > a ? b : a), 0n);
}
/** Moves the dataset's chain anchor to a recent finalized block every
    `intervalMs` once the writer's epoch serves reads; the next start checks it
    (AcquireOptions.anchor). Each move first checks that the stored anchor is
    still the chain's (ProjectionWriter.anchorHolds): a replacement chain that
    is already taller stops the worker instead of taking over the anchor. */
export function defineAnchorRefresh(options: {
  name: string; writer: ProjectionWriter; intervalMs: number; onError?: (error: unknown) => void;
}) {
  return defineRefresh({ name: options.name, intervalMs: options.intervalMs, onError: options.onError, async refresh(source) {
    if (!options.writer.epochReady || !await options.writer.anchorHolds(blockHashReader(source))) return;
    const anchor = await latestAnchor(source);
    if (anchor) await options.writer.recordAnchor(anchor.slot, anchor.hash);
  } });
}
