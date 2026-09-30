import { Code, ConnectError } from '@connectrpc/connect';
import type { ThruClientContext } from '../../core/client';
import { AccountView } from '@thru/sdk/proto';
import { getRawAccount } from '../accounts';
import { currentVersionContext, currentOrHistoricalVersionContext } from '../consensus';
import { Pubkey } from '../../domain/primitives';
import { CompressionError, type AccountImage } from './types';
function notFound(error: unknown): boolean { return error instanceof ConnectError && error.code === Code.NotFound; }
export function cancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new CompressionError('CANCELLED', 'Compression operation cancelled');
}
export async function readAccount(ctx: ThruClientContext, address: string, historical: boolean, signal?: AbortSignal): Promise<AccountImage | undefined> {
    cancelled(signal);
    try {
      const value = await getRawAccount(ctx, address, {
        view: historical ? AccountView.FULL : AccountView.META_ONLY,
        versionContext: historical ? currentOrHistoricalVersionContext() : currentVersionContext(),
      });
      cancelled(signal);
      if (value.rawMeta.length !== 64)
        throw new CompressionError("INVALID_IMAGE", "RPC returned invalid runtime metadata", { address });
      const meta = value.rawMeta;
      const flags = meta[3]!;
      const view = new DataView(meta.buffer, meta.byteOffset, meta.byteLength);
      return { address: Pubkey.from(address).toThruFmt(), meta, data: value.rawData ?? new Uint8Array(),
        slot: value.versionContext?.slot, dataSize: view.getUint32(4, true),
        balance: view.getBigUint64(48, true), nonce: view.getBigUint64(56, true),
        deleted: !!(flags & 0x10), uncompressable: !!(flags & 0x04), ephemeral: !!(flags & 0x08), isNew: !!(flags & 0x20) };
    } catch (error) {
      if (notFound(error)) return undefined;
      throw error;
    }
  }
