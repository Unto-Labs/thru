import type { ThruClientContext } from '../../core/client';
import { readAccount } from './accounts';
import { CompressionError, type AccountImage, type AccountState } from "./types";

export type AccountCompressionStatus = {
  address: string;
  status: "ACTIVE" | "COMPRESSED" | "DOES_NOT_EXIST";
  /** Compression archive slot, when the RPC supplies it. */
  compressionSlot?: bigint;
  retrySlot?: bigint;
};

export async function lookupAccount(ctx: ThruClientContext, options: { signal?: AbortSignal }, address: string): Promise<{
  current?: AccountState; image?: AccountImage;
}> {
  if (options.signal?.aborted) throw new CompressionError("CANCELLED", "Compression operation cancelled");
  const current = await readAccount(ctx, address, false, options.signal);
  if (current) return { current };
  const image = await readAccount(ctx, address, true, options.signal);
  // Historical reads clear COMPRESSED. A retained DELETED marker is distinct
  // from a compression archive. Recheck current in case restoration just landed.
  const recheck = await readAccount(ctx, address, false, options.signal);
  return recheck ? { current: recheck } : { image: image?.deleted ? undefined : image };
}

/** Preserves input order and duplicates. RPC errors propagate; absence is never inferred from an outage. */
export async function getAccountStatuses(ctx: ThruClientContext, options: { signal?: AbortSignal } & {
  accounts: readonly string[];
}): Promise<AccountCompressionStatus[]> {
  const statuses = new Map<string, AccountCompressionStatus>();
  for (const address of new Set(options.accounts)) {
    const { current, image } = await lookupAccount(ctx, options, address);
    statuses.set(address, current ? { address, status: "ACTIVE" } : image ? {
      address, status: "COMPRESSED", compressionSlot: image.slot,
      retrySlot: image.slot === undefined ? undefined : image.slot + 384n,
    } : { address, status: "DOES_NOT_EXIST" });
  }
  return options.accounts.map(address => ({ ...statuses.get(address)! }));
}
